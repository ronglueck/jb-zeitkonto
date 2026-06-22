# STUFE 1 — PWA-Prompt (überarbeitet, geprüft)

## Kontext
In diesem Ordner (`jb-zeitkonto`) liegt `stundenbuch.html` — eine eigenständige,
offline-fähige Arbeitszeit-App (deutsch, vanilla JS, Daten in `localStorage` unter
dem Key `stundenbuch_v1`, mit Soll/Ist, Wochen- und Monatssaldo, Freitag-Sonderfall
und Export/Import-Sicherung). Sie ist bereits mobil ausgelegt
(`viewport-fit=cover`, `env(safe-area-inset-*)`, `theme-color`, Portrait-Layout).
Relevante Code-Anker: `loadState()` ist **synchron** und läuft beim Modul-Init
(`let state = loadState()`); Markenzeichen `.mark` = „SB"; Tap-Ziele heute
`.iconbtn` = 38 px, `.monthbar button` = 40 px (Rest ≥ 48 px).

**Primäres Zielgerät:** Samsung Galaxy A55 (Android, Chrome / Samsung Internet,
6,6″ Super-AMOLED, 120 Hz, FHD+, mittiges Punch-Hole). Trotzdem **geräteneutral-
responsiv** bauen — nichts auf genau ein Gerät hartkodieren.

## Ziel
Mach daraus eine installierbare, voll offline-fähige **PWA (Stufe 1)** und bereite
sie für das spätere Verpacken als Android-APK via **PWABuilder/TWA (Stufe 2)** vor.
Gehostet auf GitHub Pages unter: https://ronglueck.github.io/jb-zeitkonto/

---

## HARTE SCHUTZREGELN (nicht verletzen)
- **Rechenkern, deutsches UI und Datenformat unverändert.** Keine Änderung an
  Soll/Ist-Logik, Saldo, ISO-Woche, an der bestehenden `migrate()`-Funktion, am
  `localStorage`-Key `stundenbuch_v1` oder am JSON-Export/Import-Format.
- **KEIN Wechsel der Speichertechnik.** `localStorage` bleibt die Datenquelle.
  Persistenz wird **allein** über `navigator.storage.persist()` abgesichert
  (siehe Punkt 5). **IndexedDB ist in Stufe 1 ausdrücklich NICHT umzusetzen** —
  der synchrone Init-Fluss würde sonst den eingefrorenen Rechenkern berühren und
  Datenverlust/Format-Bruch riskieren.
- **Konservativ: helles UI exakt wie jetzt. KEIN Dunkelmodus, keine visuelle
  Neugestaltung.** Erlaubte Eingriffe nur: PWA-Technik (Manifest/SW/Icons),
  `color-scheme`-Meta, **optik-neutrale** Vergrößerung der Trefferflächen (Punkt 7).
- **Alle Pfade RELATIV (`./...`).** GitHub Pages serviert aus dem Unterordner
  `/jb-zeitkonto/` — absolute Pfade (`/...`) brechen App, Manifest, Icons und
  Service-Worker-Scope dort. **Generell gilt: JEDER neu hinzugefügte Pfad in HTML,
  Manifest, SW oder JS ist relativ (`./...`); absolute Pfade (`/...`) sind verboten.**
- **Offline-first:** keine externen CDNs, keine Web-Fonts von außen, keine neuen
  **Laufzeit**-Abhängigkeiten der App. (Build-Hilfen wie `sharp` zur Icon-Erzeugung
  sind keine Laufzeit-Abhängigkeit und erlaubt — siehe Punkt 3.)
- **Keine Nutzerdaten verlieren.** Bestehende `stundenbuch_v1`-Daten müssen erhalten
  bleiben; eine **vor** dem Umbau erzeugte Sicherungsdatei muss **nach** dem Umbau
  unverändert importierbar sein.

---

## UMZUSETZEN

### 1. `index.html` (die einzige ausgelieferte App)
`index.html` ist die einzige ausgelieferte Datei (GitHub Pages sucht `index.html`).
Inhalt = die bestehende App + die PWA-Ergänzungen unten. **`stundenbuch.html` danach
löschen** (oder durch identischen Inhalt/Weiterleitung ersetzen), damit nicht zwei
divergierende Kopien entstehen. Bestehende Funktionen, Rechenlogik, deutsches UI und
Datenformat unverändert lassen.

Im `<head>` ergänzen (relativ!):
- `<link rel="manifest" href="./manifest.json">`
- `<meta name="color-scheme" content="light">` — signalisiert dem Browser ein
  ausschließlich helles Schema für UA-Defaults/Form-Controls und reduziert ungewollte
  automatische Verdunkelung. **Keine Garantie** gegen geräteseitig erzwungenen
  Dark-Mode (Samsung Internet „Dunkles Layout"/Chrome „Auto Dark Theme") — nur
  korrekt einordnen, nicht überbewerten.
- `<link rel="apple-touch-icon" href="./icons/icon-192.png">` (passend zu den bereits
  vorhandenen `apple-mobile-web-app-*`-Metas; Primärziel ist Android, schadet aber
  nicht).

Am Seitenende: Service-Worker registrieren **mit Feature-Check und relativem Scope**:
`if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' })`.
Zusätzlich einmaliges, sauberes Update der offenen Seite: per
`navigator.serviceWorker.addEventListener('controllerchange', …)` **genau einmal**
`location.reload()` auslösen (mit Guard-Flag gegen Reload-Schleifen). So ist nach
einem neuen Upload auch der bereits offene Tab konsistent auf der neuen Version.

### 2. `manifest.json` — **reines JSON, keine Kommentare**
```json
{
  "name": "Janettes Zeitkonto",
  "short_name": "Zeitkonto",
  "lang": "de",
  "dir": "ltr",
  "id": "./",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0f1b24",
  "background_color": "#eef1f4",
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
Hinweise:
- `theme_color: "#0f1b24"` spiegelt **bewusst** die dunkle Topbar-/Statusleisten-Farbe
  (nicht die helle Fläche) — nicht „korrigieren". `background_color: "#eef1f4"` ist die
  helle Splash-Fläche, passend zum UI.
- `id: "./"` bindet die App-Identität an den aktuellen Unterpfad. Bei einem späteren
  URL-Umzug muss `id` stabil gehalten oder bewusst migriert werden, sonst gilt die PWA
  als neue App. Für Stufe 1 so korrekt.
- **Kein** `display_override` (mit nur `"standalone"` wäre es redundant/wirkungslos).

### 3. App-Icons — verbindliches Motiv + reproduzierbare Erzeugung
**Motiv = „JB"** (Bezug zum Repo-/Ordnernamen `jb-zeitkonto`). Dunkler Grund,
goldener Akzent `#caa64a`. (Hinweis: Das in der App sichtbare Markenzeichen `.mark`
zeigt „SB"; das Installer-Icon trägt bewusst „JB" — gewollt, nicht angleichen.)

Lege diese **zwei SVG-Master** an und generiere daraus die PNGs.

`./icons/icon.svg` (für `any`, 192 + 512):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16323a"/><stop offset="1" stop-color="#0c161d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <rect x="10" y="10" width="492" height="492" rx="104" fill="none"
        stroke="#caa64a" stroke-opacity=".45" stroke-width="6"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"
        font-weight="800" font-size="230" letter-spacing="6" fill="#caa64a">JB</text>
</svg>
```

`./icons/icon-maskable.svg` (für `maskable`, 512) — **Vollbild ohne Rundung**, Motiv
in der inneren Safe-Zone (~80 %), damit der Android-Masken-Crop (Kreis/Squircle, ~10 %
pro Seite) das „SB" nicht beschneidet:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16323a"/><stop offset="1" stop-color="#0c161d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"
        font-weight="800" font-size="170" letter-spacing="5" fill="#caa64a">JB</text>
</svg>
```
(Falls das Rendering die Vertikale leicht verschiebt: „SB" optisch zentrieren.)

**Ausgabedateien (exakte Namen, in `./icons/`):**
`icon-192.png` (192×192, aus `icon.svg`), `icon-512.png` (512×512, aus `icon.svg`),
`icon-maskable-512.png` (512×512, aus `icon-maskable.svg`).

**Erzeugung — deterministische Verzweigung:**
1. `node --version` prüfen. **Nur** wenn Node vorhanden **und** `sharp`
   offline/installierbar ist → `tools/make-icons.mjs` mit `sharp` schreiben, das die
   beiden SVGs in die drei PNGs in den o. g. Maßen rendert. (`sharp` ist reine
   **Build**-Hilfe, keine Laufzeit-Abhängigkeit.)
2. Sonst → `tools/icon-generator.html`: zeichnet dieselben Motive per Canvas und bietet
   drei Download-Links an, deren `download`-Attribut **exakt** `icon-192.png`,
   `icon-512.png`, `icon-maskable-512.png` lautet. **Nutzer-Schritt:** die drei
   Dateien aus dem Download-Ordner nach `./icons/` verschieben.

**Danach verifizieren** (keine Platzhalter, reale Dateien, korrekte Maße). Windows
ohne Toolchain:
`Add-Type -AssemblyName System.Drawing; ([System.Drawing.Image]::FromFile('icons/icon-192.png')).Size`
(analog für 512). Mindestens Dateigröße > 0 und korrekte Pixelmaße prüfen.

### 4. Service Worker `sw.js` (Wurzelverzeichnis, relative Pfade)
Versionierter Cache-Name, z. B. `const CACHE = "zeitkonto-v1"` (bei jeder
Inhaltsänderung erhöhen).
- **`install`:** Pflicht-Shell cachen — **`./`** (= das Navigationsdokument, kanonischer
  Schlüssel) und `./manifest.json`. `self.skipWaiting()`. Die **Icons** in einem
  **fehlertoleranten** Schritt nachcachen (z. B. `Promise.allSettled` / try-catch pro
  Datei) — `cache.addAll` ist atomar, ein fehlendes Icon darf die SW-Installation und
  damit die Offline-Fähigkeit **nicht** kippen.
- **`activate`:** alte Caches (≠ `CACHE`) löschen, `clients.claim()`.
- **`fetch`:**
  - **Navigation** (`request.mode === "navigate"`): **network-first** → bei Erfolg die
    Antwort klonen und unter dem **kanonischen Schlüssel `./`** in `CACHE` zurückschreiben
    (`cache.put('./', resp.clone())`), dann zurückgeben; bei Netzwerkfehler
    `cache.match('./')` liefern. So bleibt der Offline-Fallback bei jedem Online-Besuch
    aktuell (nicht für immer die Install-Version). **Nur** `./` als Navigationsdokument
    führen — `./index.html` **nicht** zusätzlich cachen (sonst divergieren die Keys).
  - **übrige GET, same-origin (Icons/Manifest):** **stale-while-revalidate**
    (sofort aus Cache, im Hintergrund aktualisieren).

### 5. Persistenter Speicher
Beim Laden `navigator.storage.persist()` anfragen — **mit Feature-Check**
(`navigator.storage && navigator.storage.persist`). Kein UI-Bruch und keine
Fehlermeldung, falls abgelehnt oder nicht unterstützt.

### 6. Konservative A55-Optimierungen (UI bleibt optisch 1:1)
- `color-scheme: light` (siehe Punkt 1) — Begründung dort, nicht überbewerten.
- **Trefferflächen ≥ 48×48 px** für `.iconbtn` (38 px) und `.monthbar button` (40 px)
  — Android-/A55-Ergonomie. **Verbindliche, optik-neutrale Technik** (kein „z. B.",
  keine Alternative, die die sichtbare Box ändert):
  1. `.iconbtn { position: relative }` **und** `.monthbar button { position: relative }`
     ergänzen (sonst ankert das `::after` am nächsten positionierten Vorfahren
     `.top`/`.monthbar` statt am Button → falsch sitzende Klickfläche).
  2. Pro Button ein unsichtbares, **exakt 48×48 px großes, zentriertes** `::after`:
     `content:""; position:absolute; top:50%; left:50%; width:48px; height:48px;
     transform:translate(-50%,-50%)`.
  3. **Verboten:** `width`/`height`/`padding` der sichtbaren Buttons ändern. Sichtbare
     Maße bleiben 38 px bzw. 40 px.
  4. Nach Umsetzung mit echten Taps prüfen, dass die transparente Fläche **keine**
     Nachbar-Buttons und nicht das mittlere Monatslabel abfängt (Überlappung vermeiden).
- Safe-Areas / `viewport-fit=cover` / `theme-color` sind vorhanden — beibehalten,
  nicht verschlechtern.
- **Kein Dunkelmodus**, keine Farb-/Layoutänderung darüber hinaus.

---

## STUFE-2-VORBEREITUNG (jetzt nur sicherstellen, nicht umsetzen)
Korrekte `manifest.json` (`id`/`scope`/`start_url` relativ, Icons inkl. maskable) und
sauberer SW machen das spätere PWABuilder-/TWA-Verpacken reibungslos. Hinweis für
später: Eine verifizierte TWA (Play Store / ohne Browser-Adressleiste) braucht
zusätzlich `/.well-known/assetlinks.json` mit dem SHA-256 des App-Signaturschlüssels.
**Out of scope für Stufe 1.**

---

## TESTEN / AKZEPTANZKRITERIEN (DoD)
- **Server:** Windows `python -m http.server 8000` (Launcher-Alternative
  `py -m http.server 8000`; ohne Python `npx http-server`). `file://` reicht für den
  Service Worker **nicht**.
- **Installierbarkeit:** Chrome DevTools → **Application → Manifest** (Felder ok, Icons
  laden) + Installability-/„Add to home screen"-Status. **Hinweis:** Die separate
  **Lighthouse-„PWA"-Kategorie gibt es seit Lighthouse 12 nicht mehr** — nicht danach
  suchen, den Application-Tab nutzen.
- **Offline (richtige Reihenfolge!):** Zuerst **online** einmal laden, in
  Application → Service Workers warten bis Status „activated and is running" und Cache
  befüllt ist, **dann** Network → „Offline" setzen und neu laden → App lädt und
  funktioniert (network-first fällt korrekt auf den Cache-Eintrag `./` zurück).
- **Daten/Backup:** Bestehende `stundenbuch_v1`-Daten bleiben erhalten. Eine mit der
  **bisherigen** App erzeugte Sicherungsdatei lässt sich nach dem Umbau **unverändert**
  importieren; das exportierte JSON-Schema (`stundenbuch_v1` → `settings/soll/entries`)
  ist strukturell identisch zur Vorversion. Export erzeugt eine Datei, Import stellt sie
  wieder her.
- **Konservativer Scope erfüllt:** Sichtbare Pixelmaße von `.iconbtn` (38 px) und
  `.monthbar button` (40 px) **unverändert**; nur die unsichtbare Tap-Fläche ist
  ≥ 48 px (per DevTools-Overlay prüfbar). Keine Dunkelmodus-/Farb-/Layoutänderung.
- **A55-Smoke-Test:** auf dem Gerät (oder Chrome-Geräte-Emulation) installieren —
  Standalone-Start, korrektes Icon/Name, Portrait, kein Layout-Bruch an
  Punch-Hole/Statusleiste.
- Danach bereit, die URL in PWABuilder einzugeben und eine APK zu erzeugen.
