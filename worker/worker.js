/**
 * Zeitkonto Push Worker
 *
 * Cloudflare Worker (ES-Module) fuer Web-Push-Benachrichtigungen.
 *
 * Endpunkte:
 *   OPTIONS *          -> 204 CORS-Preflight
 *   GET  /             -> 200 "Zeitkonto Push OK" (Health-Check)
 *   POST /subscribe    -> Abo speichern
 *   POST /heartbeat    -> lastLogged aktualisieren
 *   POST /unsubscribe  -> Abo loeschen
 *
 * KV-Binding: env.PUSH_KV
 *   Key: "s:" + sha256hex(endpoint)
 *   Val: JSON { subscription: {...}, lastLogged: "YYYY-MM-DD" | null, workdays: number[] | null }
 *
 * Secrets (wrangler secret put):
 *   VAPID_PRIVATE_KEY  base64url, 32-Byte d
 *
 * Vars (wrangler.toml [vars]):
 *   VAPID_PUBLIC_KEY   base64url, 65-Byte uncompressed P-256
 *   VAPID_SUBJECT      mailto: oder https: URI
 *   ALLOW_ORIGIN       z.B. "https://ronglueck.github.io"
 */

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** SHA-256 eines Strings als Hex-String (WebCrypto). */
async function sha256hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** base64url-Encoding ohne Padding. */
function b64url(buf) {
  // buf kann ArrayBuffer oder Uint8Array sein
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** base64url-Decoding (mit oder ohne Padding). */
function b64urlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Normalisiert eine Arbeitstage-Liste auf eindeutige Ints 1..7 (ISO Mo=1..So=7), sonst null. */
function normWorkdays(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const v of input) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 7 && !out.includes(n)) out.push(n);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// VAPID / Push
// ---------------------------------------------------------------------------

/**
 * Importiert den VAPID-Privatschluessel aus dem base64url-codierten 32-Byte-d.
 * Der oeffentliche Schluessel wird benoetigt, um x und y fuer das JWK zu berechnen.
 */
async function importVapidPrivateKey(privateKeyB64url, publicKeyB64url) {
  // Oeffentlichen Schluesselpunkt dekodieren: 0x04 || x (32 Byte) || y (32 Byte)
  const pubBytes = b64urlDecode(publicKeyB64url);
  if (pubBytes[0] !== 0x04 || pubBytes.length !== 65) {
    throw new Error("VAPID_PUBLIC_KEY muss ein 65-Byte uncompressed P-256-Punkt sein (0x04...)");
  }
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));
  const d = privateKeyB64url; // bereits base64url

  const jwk = {
    kty: "EC",
    crv: "P-256",
    d,
    x,
    y,
    key_ops: ["sign"],
    ext: true,
  };

  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

/**
 * Erstellt ein VAPID JWT ES256 fuer die angegebene Audience (Push-Endpoint-Origin).
 * Gibt den vollstaendigen Authorization-Header-Wert zurueck.
 */
async function buildVapidAuthorization(audience, env) {
  const privateKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: nowSec + 12 * 3600, // 12 Stunden Gueltigkeit
    sub: env.VAPID_SUBJECT,
  };

  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // ECDSA P-256 / SHA-256 — liefert DER-codierten Wert, wir brauchen RAW r||s
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  // WebCrypto liefert fuer ECDSA bereits RAW r||s (64 Byte), KEIN DER
  const sigB64 = b64url(sigBuf);
  const jwt = `${signingInput}.${sigB64}`;

  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Sendet eine payloadlose Web-Push-Benachrichtigung an ein Abo.
 * Gibt true bei Erfolg zurueck; false bei 404/410 (abgelaufenes Abo).
 * Wirft bei anderen HTTP-Fehlern (damit der Caller entscheiden kann).
 */
async function sendPush(subscription, env) {
  const endpointUrl = new URL(subscription.endpoint);
  const audience = endpointUrl.origin; // z.B. "https://fcm.googleapis.com"

  const authorization = await buildVapidAuthorization(audience, env);

  const resp = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      TTL: "86400",
      Urgency: "normal",
      // Kein Content-Type, kein Body (payloadless)
    },
  });

  if (resp.status === 404 || resp.status === 410) {
    // Abo abgelaufen / nicht mehr gueltig
    return false;
  }
  if (!resp.ok) {
    throw new Error(`Push-Fehler: HTTP ${resp.status} fuer ${subscription.endpoint}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(response, env) {
  const hdrs = corsHeaders(env);
  for (const [k, v] of Object.entries(hdrs)) {
    response.headers.set(k, v);
  }
  return response;
}

function jsonResponse(data, status, env) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    env
  );
}

// ---------------------------------------------------------------------------
// Fetch-Handler (HTTP-Endpunkte)
// ---------------------------------------------------------------------------

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // CORS-Preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  // Health-Check
  if (method === "GET" && url.pathname === "/") {
    return withCors(new Response("Zeitkonto Push OK", { status: 200 }), env);
  }

  // ---------- POST /subscribe ----------
  if (method === "POST" && url.pathname === "/subscribe") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, env);
    }

    const subscription = body?.subscription;
    if (!subscription?.endpoint) {
      return jsonResponse({ ok: false, error: "subscription.endpoint fehlt" }, 400, env);
    }

    const key = "s:" + (await sha256hex(subscription.endpoint));
    const record = { subscription, lastLogged: null, workdays: normWorkdays(body?.workdays) };
    await env.PUSH_KV.put(key, JSON.stringify(record));

    return jsonResponse({ ok: true }, 200, env);
  }

  // ---------- POST /heartbeat ----------
  if (method === "POST" && url.pathname === "/heartbeat") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, env);
    }

    const endpoint = body?.endpoint;
    if (!endpoint) {
      return jsonResponse({ ok: false, error: "endpoint erforderlich" }, 400, env);
    }
    const date = body?.date;
    const logged = body?.logged;

    const key = "s:" + (await sha256hex(endpoint));
    const raw = await env.PUSH_KV.get(key);
    if (raw) {
      // Nur aktualisieren, wenn das Abo bekannt ist
      const record = JSON.parse(raw);
      // Arbeitstage aktualisieren, falls mitgeschickt
      if (Array.isArray(body?.workdays)) record.workdays = normWorkdays(body.workdays);
      // lastLogged nur setzen, wenn heute erfasst (logged===true).
      // Alte Clients ohne logged-Flag: vorhandenes date impliziert "erfasst".
      if (date && (logged === true || logged === undefined)) {
        record.lastLogged = date;
      }
      await env.PUSH_KV.put(key, JSON.stringify(record));
    }
    // Unbekanntes Abo: ignorieren, trotzdem 200

    return jsonResponse({ ok: true }, 200, env);
  }

  // ---------- POST /unsubscribe ----------
  if (method === "POST" && url.pathname === "/unsubscribe") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, env);
    }

    const endpoint = body?.endpoint;
    if (!endpoint) {
      return jsonResponse({ ok: false, error: "endpoint erforderlich" }, 400, env);
    }

    const key = "s:" + (await sha256hex(endpoint));
    await env.PUSH_KV.delete(key);

    return jsonResponse({ ok: true }, 200, env);
  }

  // Fallback: 404
  return jsonResponse({ ok: false, error: "Not found" }, 404, env);
}

// ---------------------------------------------------------------------------
// Scheduled-Handler (Cron)
// ---------------------------------------------------------------------------

async function handleScheduled(event, env) {
  // Berlin-Stunde bestimmen (DST-sicher)
  const berlinHour = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10
  );

  // Nur weitermachen, wenn es gerade 20 Uhr Berlin-Zeit ist
  // (verhindert Doppelversand: Worker laeuft 18 UTC = 20 CEST und 19 UTC = 20 CET)
  if (berlinHour !== 20) {
    console.log(`Cron: Berlin-Stunde ist ${berlinHour}, kein Versand.`);
    return;
  }

  // Heutiges Datum in Berlin
  const todayBerlin = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date()); // "YYYY-MM-DD"

  // ISO-Wochentag (1=Mo .. 7=So) fuer das Berlin-Datum (Mittag-UTC vermeidet TZ-Raender)
  const isoWeekday = ((new Date(todayBerlin + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;

  console.log(`Cron: Berlin 20 Uhr, Datum ${todayBerlin} (ISO-Wochentag ${isoWeekday}) — starte Push-Versand.`);

  // Alle "s:"-Keys laden
  let cursor;
  let sentCount = 0;
  let cleanedCount = 0;

  do {
    const listResult = await env.PUSH_KV.list({ prefix: "s:", cursor });
    cursor = listResult.cursor;

    for (const kvKey of listResult.keys) {
      const raw = await env.PUSH_KV.get(kvKey.name);
      if (!raw) continue;

      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        console.warn(`Cron: Ungueltige KV-Daten fuer ${kvKey.name}, ueberspringe.`);
        continue;
      }

      const { subscription, lastLogged } = record;

      // Nur an Arbeitstagen erinnern (Default Mo-Fr, falls noch keine Arbeitstage gemeldet)
      const workdays = (Array.isArray(record.workdays) && record.workdays.length)
        ? record.workdays
        : [1, 2, 3, 4, 5];
      if (!workdays.includes(isoWeekday)) {
        continue; // heute kein Arbeitstag (z.B. Sa/So) -> keine Erinnerung
      }

      // Wenn heute bereits geloggt: kein Push noetig
      if (lastLogged === todayBerlin) {
        continue;
      }

      // Payloadless Push senden
      try {
        const alive = await sendPush(subscription, env);
        if (!alive) {
          // Abo abgelaufen (404/410) -> aufraaeumen
          await env.PUSH_KV.delete(kvKey.name);
          cleanedCount++;
          console.log(`Cron: Abgelaufenes Abo geloescht: ${kvKey.name}`);
        } else {
          sentCount++;
        }
      } catch (err) {
        // Transiente Fehler: nur loggen, nicht abbrechen
        console.error(`Cron: Push-Fehler fuer ${kvKey.name}:`, err.message);
      }
    }
  } while (cursor);

  console.log(
    `Cron: Fertig. Versandt: ${sentCount}, abgelaufene Abos geloescht: ${cleanedCount}.`
  );
}

// ---------------------------------------------------------------------------
// Export (ES-Module-Worker)
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
