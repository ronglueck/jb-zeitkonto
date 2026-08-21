"use strict";

const CACHE = "zeitkonto-v1";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Pflicht-Shell: Navigation-Dokument und Manifest atomar cachen
      await cache.addAll(["./", "./manifest.json"]);

      // Icons fehlertolerant nachcachen — ein fehlendes Icon darf die Installation nicht kippen
      const icons = [
        "./icons/icon-192.png",
        "./icons/icon-512.png",
        "./icons/icon-maskable-512.png"
      ];
      await Promise.allSettled(
        icons.map(url =>
          cache.add(url).catch(() => {/* Icon fehlt — ignorieren */})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Nur GET-Anfragen behandeln
  if (req.method !== "GET") return;

  // Navigation: network-first, Fallback auf gecachtes "./"
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(resp => {
        // Nur gültige Antworten (resp.ok) zurückschreiben — keine 4xx/5xx-Fehlerseiten
        // dürfen den kanonischen Offline-Eintrag "./" überschreiben/vergiften
        if (resp.ok) {
          return caches.open(CACHE).then(cache => {
            cache.put("./", resp.clone());
            return resp;
          });
        }
        return resp;
      }).catch(() =>
        caches.open(CACHE).then(cache => cache.match("./"))
      )
    );
    return;
  }

  // Übrige same-origin GET (Icons, Manifest): stale-while-revalidate
  if (req.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req).then(cached => {
          const networkFetch = fetch(req).then(resp => {
            if (resp.ok) cache.put(req, resp.clone());
            return resp;
          }).catch(() => cached);
          // Sofort aus Cache antworten, im Hintergrund aktualisieren
          return cached || networkFetch;
        })
      )
    );
  }
});

/* ============================================================
   PUSH-ERINNERUNG — additiv (install/activate/fetch unveraendert)

   Der Push kommt ohne Payload an. Worum es geht, fragt der Service
   Worker beim Worker nach (/pending); faellt das aus, wird der Anlass
   aus der Uhrzeit abgeleitet.
============================================================ */

// Muss zu PUSH_CONFIG.workerUrl in index.html passen.
const PUSH_WORKER_URL = "https://zeitkonto-push.h1n15r15.workers.dev";

const REMINDERS = {
  start: {
    title: "Guten Morgen ☀️",
    body: "Der Arbeitsbeginn ist noch nicht gestempelt.",
    actions: [
      { action: "stamp-start", title: "Jetzt stempeln" },
      { action: "later", title: "Später" }
    ]
  },
  pause: {
    title: "Pause?",
    body: "Pausenbeginn noch nicht gestempelt.",
    actions: [
      { action: "stamp-break", title: "Pause stempeln" },
      { action: "later", title: "Später" }
    ]
  },
  end: {
    title: "Feierabend 🏁",
    body: "Das Arbeitsende fehlt noch.",
    actions: [
      { action: "stamp-end", title: "Feierabend" },
      { action: "later", title: "Später" }
    ]
  },
  day: {
    title: "Zeitkonto",
    body: "⏰ Heute ist noch nichts erfasst – jetzt eintragen?",
    actions: [
      { action: "open", title: "Eintragen" },
      { action: "later", title: "Später" }
    ]
  },
  test: {
    title: "Zeitkonto",
    body: "✅ Test – die Erinnerungen kommen auf diesem Gerät an.",
    actions: [{ action: "open", title: "App öffnen" }]
  }
};

/**
 * Notbehelf, wenn der Anlass nicht erfragt werden konnte.
 * Die Pause wird nicht mehr gestempelt (feste Pause), taucht hier also
 * nicht auf — REMINDERS.pause bleibt nur fuer alte Serverdaten stehen.
 */
function kindFromClock() {
  const h = new Date().getHours();
  if (h < 11) return "start";
  if (h < 18) return "end";
  return "day";
}

/** Fragt den Worker, welche Erinnerung gerade ausgeloest wurde. */
async function currentKind() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return kindFromClock();
    const resp = await fetch(PUSH_WORKER_URL + "/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    if (!resp.ok) return kindFromClock();
    const data = await resp.json();
    return (data && data.kind && REMINDERS[data.kind]) ? data.kind : kindFromClock();
  } catch (e) {
    return kindFromClock();
  }
}

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const kind = await currentKind();
    const r = REMINDERS[kind] || REMINDERS.day;
    await self.registration.showNotification(r.title, {
      body: r.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "zeitkonto-reminder",
      renotify: true,
      actions: r.actions,
      data: { kind: kind }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  const action = event.action;
  event.notification.close();
  if (action === "later") return;

  // "stamp-start" -> "start", "stamp-break" -> "break", "stamp-end" -> "end"
  const stamp = (action && action.indexOf("stamp-") === 0) ? action.slice(6) : null;
  const target = stamp ? "./?stamp=" + stamp : "./";

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url && client.url.startsWith(self.registration.scope) && "focus" in client) {
        // App laeuft schon: fokussieren und den Stempel direkt melden
        if (stamp) client.postMessage({ type: "stamp", kind: stamp });
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
