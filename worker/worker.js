/**
 * Zeitkonto Push Worker
 *
 * Cloudflare Worker (ES-Module) fuer Web-Push-Benachrichtigungen.
 *
 * Endpunkte:
 *   OPTIONS *          -> 204 CORS-Preflight
 *   GET  /             -> 200 "Zeitkonto Push OK" (Health-Check)
 *   POST /subscribe    -> Abo speichern
 *   POST /heartbeat    -> Tagesstatus + Erinnerungszeiten aktualisieren
 *   POST /pending      -> welcher Anlass zuletzt gesendet wurde (fuer den Service Worker)
 *   POST /testpush     -> Sofort-Push zum Pruefen der Zustellung
 *   POST /unsubscribe  -> Abo loeschen
 *
 * KV-Binding: env.PUSH_KV
 *   Key: "s:" + sha256hex(endpoint)
 *   Val: JSON {
 *     subscription: {...},
 *     lastLogged:  "YYYY-MM-DD" | null,     // Tag vollstaendig erfasst
 *     workdays:    number[] | null,          // ISO 1=Mo .. 7=So
 *     times:       { start, pause, end, endFri, day } | null,  // "HH:MM", leer = aus
 *                  // endFri: eigener Feierabend fuer Freitag; leer = "end" gilt auch dann
 *     status:      { date, hasStart, hasBreak, hasEnd } | null,
 *     sent:        { date, kinds: string[], lastKind, testAt } | null
 *   }
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
// Konstanten
// ---------------------------------------------------------------------------

/** Erinnerungsanlaesse in der Reihenfolge, in der sie am Tag auftreten. */
const KINDS = ["start", "pause", "end", "day"];

/**
 * Alle gespeicherten Uhrzeit-Felder. "endFri" ist kein eigener Anlass, sondern
 * eine Sonderzeit fuer den Feierabend am Freitag (leer = Mo-Do-Zeit gilt auch dann).
 */
const TIME_KEYS = ["start", "pause", "end", "endFri", "day"];

/** ISO-Wochentag, fuer den "endFri" gilt. */
const FRIDAY = 5;

/** Voreinstellung, falls ein Abo noch keine Zeiten gemeldet hat. */
const DEFAULT_TIMES = { start: "07:45", pause: "12:35", end: "15:45", endFri: "", day: "20:00" };

/**
 * Zeitfenster nach der eingestellten Uhrzeit, in dem noch erinnert wird.
 * Grosszuegig genug, um einen ausgefallenen Cron-Lauf zu ueberbruecken;
 * gegen Doppelversand schuetzt die "sent"-Liste.
 */
const WINDOW_MIN = 30;

/** Mindestabstand zwischen zwei Test-Benachrichtigungen (Missbrauchsbremse). */
const TEST_COOLDOWN_MS = 60 * 1000;

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

/** "HH:MM" -> Minuten seit Mitternacht, sonst null. */
function hhmmToMin(str) {
  if (typeof str !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Normalisiert die gemeldeten Erinnerungszeiten.
 * Leerer/ungueltiger Wert = dieser Anlass ist abgeschaltet.
 * Gibt null zurueck, wenn gar nichts Brauchbares dabei war.
 */
function normTimes(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  let any = false;
  for (const key of TIME_KEYS) {
    const min = hhmmToMin(input[key]);
    if (min == null) {
      out[key] = "";
    } else {
      out[key] = input[key].trim();
      any = true;
    }
  }
  return any ? out : { start: "", pause: "", end: "", endFri: "", day: "" };
}

/** Tagesstatus aus dem Request normalisieren. */
function normStatus(input, date) {
  if (!input || typeof input !== "object") return null;
  return {
    date: date || null,
    hasStart: !!input.hasStart,
    hasBreak: !!input.hasBreak,
    hasEnd: !!input.hasEnd,
  };
}

/** Aktueller Zeitpunkt in Europe/Berlin: {date:"YYYY-MM-DD", min, isoWeekday}. */
function berlinNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [h, m] = hm.split(":").map(Number);
  // Mittag-UTC vermeidet Zeitzonen-Raender bei der Wochentagsberechnung
  const isoWeekday = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  return { date, min: h * 60 + m, isoWeekday };
}

/**
 * Uhrzeit fuer einen Anlass. Freitags gilt fuer den Feierabend "endFri",
 * sofern dort etwas Gueltiges steht.
 */
function timeForKind(kind, times, isoWeekday) {
  if (kind === "end" && isoWeekday === FRIDAY && hhmmToMin(times.endFri) != null) {
    return times.endFri;
  }
  return times[kind];
}

/**
 * Entscheidet, welche Erinnerung fuer ein Abo gerade faellig ist.
 * Gibt den Anlass ("start" | "pause" | "end" | "day") zurueck oder null.
 */
function dueKind(record, now) {
  const times = record.times && typeof record.times === "object" ? record.times : DEFAULT_TIMES;

  // Tagesstatus gilt nur fuer den heutigen Tag
  const st = record.status && record.status.date === now.date
    ? record.status
    : { hasStart: false, hasBreak: false, hasEnd: false };
  const loggedToday = record.lastLogged === now.date;

  // Bereits heute gesendete Anlaesse nicht wiederholen
  const sentKinds = record.sent && record.sent.date === now.date && Array.isArray(record.sent.kinds)
    ? record.sent.kinds
    : [];

  // Spaetesten faelligen Anlass gewinnen lassen (KINDS ist chronologisch)
  let due = null;
  for (const kind of KINDS) {
    const t = hhmmToMin(timeForKind(kind, times, now.isoWeekday));
    if (t == null) continue;                       // abgeschaltet
    if (now.min < t || now.min >= t + WINDOW_MIN) continue;  // nicht im Fenster
    if (sentKinds.includes(kind)) continue;        // heute schon erinnert

    // Nur erinnern, wenn der Schritt tatsaechlich noch fehlt
    let missing = false;
    if (kind === "start") missing = !st.hasStart && !st.hasEnd && !loggedToday;
    else if (kind === "pause") missing = st.hasStart && !st.hasBreak && !st.hasEnd;
    else if (kind === "end") missing = st.hasStart && !st.hasEnd;
    else if (kind === "day") missing = !loggedToday;

    if (missing) due = kind;
  }
  return due;
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
    const record = {
      subscription,
      lastLogged: null,
      workdays: normWorkdays(body?.workdays),
      times: normTimes(body?.times) || { ...DEFAULT_TIMES },
      status: null,
      sent: null,
    };
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
      // Erinnerungszeiten aktualisieren, falls mitgeschickt
      const times = normTimes(body?.times);
      if (times) record.times = times;
      // Tagesstatus (Beginn/Pause/Ende) uebernehmen
      const status = normStatus(body?.status, date);
      if (status) record.status = status;
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

  // ---------- POST /pending ----------
  // Der Service Worker fragt beim Eintreffen eines (payloadlosen) Push,
  // worum es gerade geht — so braucht die Benachrichtigung keinen Payload.
  if (method === "POST" && url.pathname === "/pending") {
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
    const raw = await env.PUSH_KV.get(key);
    if (!raw) return jsonResponse({ ok: true, kind: null }, 200, env);

    const record = JSON.parse(raw);
    const now = berlinNow();
    const kind = record.sent && record.sent.date === now.date ? record.sent.lastKind || null : null;
    return jsonResponse({ ok: true, kind }, 200, env);
  }

  // ---------- POST /testpush ----------
  // Diagnose: schickt sofort eine Benachrichtigung an genau dieses Abo.
  if (method === "POST" && url.pathname === "/testpush") {
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
    const raw = await env.PUSH_KV.get(key);
    if (!raw) return jsonResponse({ ok: false, error: "Abo unbekannt" }, 404, env);

    const record = JSON.parse(raw);
    const sent = record.sent || {};
    if (sent.testAt && Date.now() - sent.testAt < TEST_COOLDOWN_MS) {
      return jsonResponse({ ok: false, error: "Bitte kurz warten" }, 429, env);
    }

    // "test" als Anlass hinterlegen, damit der Service Worker den Text kennt
    const now = berlinNow();
    record.sent = {
      date: now.date,
      kinds: sent.date === now.date && Array.isArray(sent.kinds) ? sent.kinds : [],
      lastKind: "test",
      testAt: Date.now(),
    };
    await env.PUSH_KV.put(key, JSON.stringify(record));

    try {
      const alive = await sendPush(record.subscription, env);
      if (!alive) {
        await env.PUSH_KV.delete(key);
        return jsonResponse({ ok: false, error: "Abo abgelaufen" }, 410, env);
      }
    } catch (err) {
      return jsonResponse({ ok: false, error: err.message }, 502, env);
    }
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
// Scheduled-Handler (Cron, alle 5 Minuten)
// ---------------------------------------------------------------------------

async function handleScheduled(event, env) {
  const now = berlinNow();

  // Alle "s:"-Keys durchgehen
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

      // Nur an Arbeitstagen erinnern (Default Mo-Fr, falls noch keine Arbeitstage gemeldet)
      const workdays = (Array.isArray(record.workdays) && record.workdays.length)
        ? record.workdays
        : [1, 2, 3, 4, 5];
      if (!workdays.includes(now.isoWeekday)) {
        continue; // heute kein Arbeitstag (z.B. Sa/So) -> keine Erinnerung
      }

      const kind = dueKind(record, now);
      if (!kind) continue;

      // Vor dem Senden vermerken — ein Fehlschlag darf keine Wiederholschleife ausloesen
      const prevSent = record.sent && record.sent.date === now.date ? record.sent : { kinds: [] };
      record.sent = {
        date: now.date,
        kinds: (prevSent.kinds || []).concat([kind]),
        lastKind: kind,
        testAt: prevSent.testAt || null,
      };
      await env.PUSH_KV.put(kvKey.name, JSON.stringify(record));

      try {
        const alive = await sendPush(record.subscription, env);
        if (!alive) {
          // Abo abgelaufen (404/410) -> aufraeumen
          await env.PUSH_KV.delete(kvKey.name);
          cleanedCount++;
          console.log(`Cron: Abgelaufenes Abo geloescht: ${kvKey.name}`);
        } else {
          sentCount++;
          console.log(`Cron: "${kind}"-Erinnerung gesendet an ${kvKey.name}`);
        }
      } catch (err) {
        // Transiente Fehler: nur loggen, nicht abbrechen
        console.error(`Cron: Push-Fehler fuer ${kvKey.name}:`, err.message);
      }
    }
  } while (cursor);

  if (sentCount || cleanedCount) {
    console.log(
      `Cron ${now.date} ${Math.floor(now.min / 60)}:${String(now.min % 60).padStart(2, "0")} — ` +
      `versandt: ${sentCount}, abgelaufene Abos geloescht: ${cleanedCount}.`
    );
  }
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

// Fuer Tests exportiert (im Worker-Betrieb ungenutzt)
export { dueKind, normTimes, hhmmToMin, berlinNow, timeForKind, DEFAULT_TIMES, WINDOW_MIN };
