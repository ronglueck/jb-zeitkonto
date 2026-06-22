# Push-Erinnerung deployen – Schritt-fuer-Schritt

Dieses Dokument erklaert, wie du den Cloudflare Worker fuer die taegliche
20-Uhr-Erinnerung einrichtest und die PWA damit verbindest.

Vorausgesetzt: Node.js >= 18 ist installiert, du hast ein GitHub-Konto und
die App laeuft bereits unter https://ronglueck.github.io/jb-zeitkonto/.

Der Worker-Code liegt **fertig und geprueft** in `C:\Users\Ron\jb-zeitkonto\worker\`
(Dateien `worker.js` und `wrangler.toml`). Es muss nichts neu angelegt werden –
nur die Platzhalter in `wrangler.toml` ausfuellen und deployen.

---

## 1. Kostenlosen Cloudflare-Account anlegen

1. Oeffne https://dash.cloudflare.com/sign-up.
2. E-Mail-Adresse und Passwort eingeben, Account bestaetigen.
3. Den kostenlosen Plan behalten – Workers & KV sind darin enthalten.

---

## 2. Wrangler einloggen

Oeffne ein PowerShell-Fenster (Win+R → `powershell`).

```powershell
npx wrangler login
```

Der Befehl oeffnet den Browser. Dort Cloudflare-Account bestaetigen.
In der Konsole erscheint anschliessend: `Successfully logged in.`

> **Hinweis:** Die Einstellung "API access for this member" muss im
> Cloudflare-Dashboard **nicht** aktiviert werden. Der OAuth-Login
> genuegt vollstaendig fuer den Account-Eigentuemer.

---

## 3. VAPID-Schluessel erzeugen

```powershell
npx web-push generate-vapid-keys
```

Ausgabe (Beispiel – deine Werte sind andere):

```
Public Key:
BNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Private Key:
yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

**Beide Werte sofort notieren / sicher ablegen.**
Der Private Key wird danach nicht mehr angezeigt.
Er kommt in Schritt 5 als Secret in Cloudflare.

---

## 4. KV-Namespace erstellen und ID eintragen

```powershell
cd C:\Users\Ron\jb-zeitkonto\worker
npx wrangler kv namespace create PUSH_KV
```

Ausgabe (Beispiel):

```
Add the following to your configuration file in your kv_namespaces array:
{ binding = "PUSH_KV", id = "abc123def456abc123def456abc123de" }
```

Oeffne `worker\wrangler.toml` und ersetze den Platzhalter:

```toml
[[kv_namespaces]]
binding = "PUSH_KV"
id      = "abc123def456abc123def456abc123de"   # deine echte ID
```

---

## 5. Variablen in wrangler.toml setzen

Die Datei `worker\wrangler.toml` enthaelt bereits alle Felder.
Trage deinen generierten Public Key ein – die anderen Werte sind
bereits korrekt vorausgefuellt:

```toml
[vars]
VAPID_PUBLIC_KEY = "BNxxx..."              # Public Key aus Schritt 3
VAPID_SUBJECT    = "mailto:h1n15r15@gmail.com"
ALLOW_ORIGIN     = "https://ronglueck.github.io"
```

Den **Private Key** niemals in eine Datei schreiben, die ins Repo kommt.
Stattdessen als Cloudflare-Secret hinterlegen (im selben PowerShell-Fenster,
Verzeichnis `worker\`):

```powershell
npx wrangler secret put VAPID_PRIVATE_KEY
```

Wrangler fragt: `Enter a secret value:` – dort den Private Key einfuegen
(beim Eintippen unsichtbar), Enter druecken.

```
Successfully created secret VAPID_PRIVATE_KEY.
```

---

## 6. Worker deployen

```powershell
npx wrangler deploy
```

Ausgabe am Ende:

```
Published zeitkonto-push (xx sec)
  https://zeitkonto-push.<dein-subdomain>.workers.dev
```

Diese URL notieren – sie wird in Schritt 7 benoetigt.

> **Zur Worker-Datei:** Der vollstaendige, gepruefter Worker liegt bereits in
> `worker/worker.js` – nicht aendern, nur deployen. Der Code ist in
> `worker/wrangler.toml` bereits als `main = "worker.js"` eingetragen.

---

## 7. index.html mit Worker-URL und Public Key verbinden

Oeffne `C:\Users\Ron\jb-zeitkonto\index.html` in einem Editor.
Suche am Anfang des Push-Blocks nach:

```js
const PUSH_CONFIG = {
  workerUrl: "",          // z. B. "https://zeitkonto-push.sub.workers.dev"
  vapidPublicKey: ""      // base64url-VAPID-Public-Key (vom Worker)
};
```

Ersetze die leeren Strings mit deinen Werten:

```js
const PUSH_CONFIG = {
  workerUrl:      "https://zeitkonto-push.<dein-subdomain>.workers.dev",
  vapidPublicKey: "BNxxx...",  // der Public Key aus Schritt 3
};
```

Dann committen und pushen:

```powershell
cd C:\Users\Ron\jb-zeitkonto
git add index.html
git commit -m "Push-Erinnerung aktivieren: PUSH_CONFIG ausgefuellt"
git push
```

GitHub Pages deployt automatisch. Nach ca. einer Minute ist die Aenderung live.

---

## 8. Auf dem Geraet (z. B. A55) aktivieren

1. App im Browser (Chrome/Edge) oeffnen:
   https://ronglueck.github.io/jb-zeitkonto/
2. Einstellungen oeffnen (Zahnrad-Icon).
3. Abschnitt **Erinnerung** → Schalter **Taegliche Erinnerung um 20 Uhr**
   einschalten.
4. Browser fragt nach Benachrichtigungs-Erlaubnis → **Zulassen** tippen.
5. Kurze Bestaetigung erscheint (Toast). Der Schalter bleibt aktiv.

---

## 9. Test

### Stufe A – Schnell, ohne Server (prueft Berechtigung, SW-Handler und Icon)

1. App im Chrome auf dem Testgeraet (oder Desktop) oeffnen.
2. DevTools oeffnen (F12) → Reiter **Application** → **Service Workers**.
3. Im Feld **Push** einen beliebigen Text eingeben und auf **Push** klicken.
4. Die Notification muss sofort erscheinen – mit Icon und dem eingegebenen Text.

Dieser Test benutzt keinen Cloudflare-Server. Er genuegt, um
Benachrichtigungs-Berechtigung, Service-Worker-Handler und das Icon zu pruefen.

### Stufe B – Echter Server-Push gegen die echte KV

Dieser Test sendet eine echte Push-Nachricht ueber den deploierten Worker und
die gespeicherten Abos in der Cloudflare KV.

**Vorbereitung:** In `worker\worker.js` die folgende Zeile voruebergehend
auskommentieren (Zeile 293):

```js
// if (berlinHour !== 20) {
//   console.log(`Cron: Berlin-Stunde ist ${berlinHour}, kein Versand.`);
//   return;
// }
```

Dann im ersten PowerShell-Fenster:

```powershell
cd C:\Users\Ron\jb-zeitkonto\worker
npx wrangler dev --remote
```

`--remote` ist wichtig: Es nutzt die echte KV und die echten Abos (nicht eine
lokale Emulation).

In einem **zweiten** PowerShell-Fenster den Cron manuell ausloesen:

```powershell
curl "http://localhost:8787/__scheduled?cron=0+18+*+*+*"
```

Wenn fuer heute noch kein Zeiteintrag erfasst ist, kommt die Push-Nachricht
aufs Geraet.

**Nachher zwingend:**
1. `wrangler dev` mit Strg+C beenden.
2. Die drei auskommentierten Zeilen in `worker\worker.js` **wieder aktivieren**
   (Kommentarzeichen entfernen).

> **Warnung:** NICHT mit auskommentierter Stunden-Pruefung erneut
> `npx wrangler deploy` ausfuehren – sonst wuerde der Worker bei jedem
> Cron-Durchlauf (18 UTC und 19 UTC) eine Push senden, unabhaengig von der
> Berliner Uhrzeit.

Die echte automatische Pruefung laeuft jeden Tag um 18:00 UTC (= 20:00 MESZ
im Sommer) und 19:00 UTC (= 20:00 MEZ im Winter). Wenn um 20:00 Berliner
Zeit noch kein Eintrag fuer heute vorhanden ist, kommt die Push-Meldung.

---

## Datenschutz-Hinweis

Der Server (Cloudflare Worker) speichert **ausschliesslich**:
- Den SHA-256-Hash des Push-Endpunkts (kein Klartextname, kein Nutzername).
- Das Datum des letzten erfassten Eintrags (`lastLogged`, Format YYYY-MM-DD).

Die eigentlichen Arbeitszeiten, Stundenwerte oder sonstige Inhalte verlassen
das Geraet nicht. Der Heartbeat uebermittelt nur "heute wurde ein Eintrag
gespeichert", nicht was erfasst wurde.

---

## Bekannte Grenzen

| Situation | Verhalten |
|---|---|
| Geraet war offline beim Speichern | Heartbeat wird nicht gesendet; Push kommt trotzdem um 20 Uhr. Beim naechsten Online-Gang sendet die App den Heartbeat nicht rueckwirkend. |
| Android schraenkt Hintergrunddienste ein | Push-Zustellung kann verzoegert sein oder bei aktivem Energiesparmodus ausbleiben. Unter Einstellungen → Apps → Chrome → Akku → "Uneingeschraenkt" setzen. |
| Mehrere Geraete | Jedes Geraet registriert ein eigenes Abo. Beide erhalten die Erinnerung, sofern der Heartbeat nicht von einem der Geraete gesendet wurde. |
| Subscription laeuft ab | Der Worker loescht abgelaufene Eintraege automatisch (HTTP 404/410). Beim naechsten Oeffnen der Einstellungen kann der Schalter neu aktiviert werden. |
