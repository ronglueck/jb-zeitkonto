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
============================================================ */

self.addEventListener("push", event => {
  event.waitUntil(
    self.registration.showNotification("Zeitkonto", {
      body: "⏰ Heute noch keine Zeit erfasst – bis 20 Uhr eintragen?",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "zeitkonto-reminder",
      data: { url: "./" }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url && client.url.startsWith(self.registration.scope) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
