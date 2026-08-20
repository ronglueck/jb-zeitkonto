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
3. Abschnitt **Erinnerungen** → Schalter **Erinnerungen auf dieses Geraet**
   einschalten.
4. Browser fragt nach Benachrichtigungs-Erlaubnis → **Zulassen** tippen.
5. Kurze Bestaetigung erscheint (Toast). Der Schalter bleibt aktiv.
6. Darunter die vier Uhrzeiten pruefen und ggf. anpassen:

   | Feld | Voreinstellung | Meldet sich, wenn … |
   |---|---|---|
   | Arbeitsbeginn | 07:45 | bis dahin kein Beginn gestempelt wurde |
   | Pause | 12:35 | gestempelt wurde, aber noch keine Pause erfasst ist |
   | Feierabend | 15:45 | der Dienst laeuft, aber kein Ende erfasst ist |
   | Tagescheck | 20:00 | fuer den Tag noch gar nichts erfasst ist |

   Ein **leeres Feld schaltet die jeweilige Erinnerung ab**. Erinnert wird nur
   an Arbeitstagen (Wochentage mit Soll > 0) und nur, wenn der Schritt wirklich
   noch fehlt — wer morgens stempelt, bekommt mittags keine Beginn-Erinnerung.
7. **Sofort pruefen:** Knopf **Test-Benachrichtigung senden** tippen. Innerhalb
   weniger Sekunden muss die Meldung „Test – die Erinnerungen kommen auf diesem
   Geraet an" erscheinen. Kommt nichts, weiter bei
   [Abschnitt 10](#10-android-16--samsung-wenn-keine-meldung-ankommt).

---

## 9. Test

### Stufe A – Schnell, ohne Server (prueft Berechtigung, SW-Handler und Icon)

1. App im Chrome auf dem Testgeraet (oder Desktop) oeffnen.
2. DevTools oeffnen (F12) → Reiter **Application** → **Service Workers**.
3. Im Feld **Push** einen beliebigen Text eingeben und auf **Push** klicken.
4. Die Notification muss sofort erscheinen – mit Icon und dem eingegebenen Text.

Dieser Test benutzt keinen Cloudflare-Server. Er genuegt, um
Benachrichtigungs-Berechtigung, Service-Worker-Handler und das Icon zu pruefen.

### Stufe B – Echter Server-Push, direkt aus der App

Einstellungen → **Test-Benachrichtigung senden**. Der Knopf ruft
`POST /testpush` auf dem deploiten Worker auf; der schickt sofort eine echte
Push-Nachricht an genau dieses Geraet. Das prueft die komplette Kette:
Abo in der KV, VAPID-Signatur, Zustellung durch Google, Service Worker,
Anzeige auf dem Sperrbildschirm.

Zwischen zwei Tests liegt eine Minute Sperrzeit (der Worker antwortet sonst
mit HTTP 429, die App zeigt „Bitte eine Minute warten").

Moegliche Rueckmeldungen:

| Meldung in der App | Bedeutung |
|---|---|
| „Gesendet — die Meldung kommt gleich" | Worker hat den Push angenommen. Kommt trotzdem nichts an: [Abschnitt 10](#10-android-16--samsung-wenn-keine-meldung-ankommt). |
| „Abo abgelaufen — Erinnerung aus- und wieder einschalten" | Google hat das Abo verworfen (HTTP 410). Schalter aus/ein loest das. |
| „Kein Netz — Test nicht moeglich" | Geraet offline oder Worker nicht erreichbar. |
| „Erinnerungen zuerst einschalten" | Auf diesem Geraet ist gar kein Abo registriert. |

### Stufe C – Den Cron-Lauf selbst ausloesen

Nur noetig, wenn die Faelligkeits-Logik geprueft werden soll (welche Erinnerung
wann kommt). Anders als frueher ist **keine Code-Aenderung mehr noetig**.

1. In der App eine Erinnerungszeit auf „in den naechsten Minuten" stellen und
   speichern (die App meldet die neue Zeit sofort per Heartbeat).
2. Im ersten PowerShell-Fenster:

   ```powershell
   cd C:\Users\Ron\jb-zeitkonto\worker
   npx wrangler dev --remote
   ```

   `--remote` ist wichtig: Es nutzt die echte KV und die echten Abos.
3. Im **zweiten** Fenster den Cron manuell ausloesen:

   ```powershell
   curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
   ```

Der Worker entscheidet dann genau wie im Echtbetrieb, ob und welche Erinnerung
faellig ist. Danach `wrangler dev` mit Strg+C beenden — mehr ist nicht zu tun.

**Im Echtbetrieb** laeuft der Cron alle 5 Minuten. Pro Abo und Tag wird jeder
Anlass hoechstens einmal verschickt (`sent`-Liste in der KV). Nach der
eingestellten Uhrzeit bleibt ein Anlass noch 30 Minuten faellig — faellt ein
Cron-Lauf aus, geht die Erinnerung dadurch nicht verloren.

---

## 10. Android 16 / Samsung: wenn keine Meldung ankommt

Die Test-Benachrichtigung (Abschnitt 9, Stufe B) ist der schnellste Weg zur
Diagnose. Kommt sie nicht an, diese Punkte **in dieser Reihenfolge** pruefen —
die ersten drei sind die haeufigste Ursache auf Samsung-Geraeten.

**1. Ist die App wirklich installiert (nicht nur ein Lesezeichen)?**
Chrome → Menue (⋮) → *Zum Startbildschirm hinzufuegen* → **Installieren**.
Nur die installierte PWA bekommt einen eigenen Eintrag in den
Benachrichtigungs-Einstellungen. Test: Die App muss sich ohne Adressleiste
oeffnen.

**2. Benachrichtigungen fuer die App erlaubt?**
Einstellungen → *Benachrichtigungen* → *App-Benachrichtigungen* → **Zeitkonto**
(bzw. **Chrome**, falls die PWA dort einsortiert ist) → einschalten.
Dort ausserdem: *Benachrichtigungen als Pop-up anzeigen* aktivieren, sonst
landen sie lautlos in der Leiste.

**3. Akku-Optimierung abschalten** – der haeufigste Grund fuer „kommt manchmal,
manchmal nicht":
Einstellungen → *Akku* → *Nutzungslimits im Hintergrund* → **Nie
schlafende Apps** → „Zeitkonto" **und** „Chrome" hinzufuegen.
Zusaetzlich: Einstellungen → *Apps* → Zeitkonto → *Akku* → **Uneingeschraenkt**.

**4. „Adaptiver Akku" / Energiesparmodus**
Einstellungen → *Akku* → **Energiesparen aus**. Im Energiesparmodus verzoegert
Android Push-Nachrichten teils um Stunden.

**5. „Nicht stoeren"**
Falls Janette nachts oder bei der Arbeit „Nicht stoeren" nutzt: Zeitkonto als
Ausnahme eintragen (Einstellungen → *Benachrichtigungen* → *Nicht stoeren* →
*App-Ausnahmen*).

**6. Datensparmodus / eingeschraenkte Hintergrunddaten**
Einstellungen → *Verbindungen* → *Datennutzung* → *Datensparmodus* → Zeitkonto
und Chrome zulassen.

**7. Google Play Services**
Web-Push laeuft auf Android ueber Firebase. Ohne funktionierende Play Services
(z. B. abgemeldetes Google-Konto) kommt nichts an. Test: Kommt bei anderen
Apps etwas an?

**Wenn 1–7 stimmen und der Test trotzdem stumm bleibt:**
Erinnerungs-Schalter aus- und wieder einschalten. Das erzeugt ein neues Abo —
alte Abos werden von Google nach laengerer Inaktivitaet verworfen, der Worker
raeumt sie beim naechsten Lauf selbst weg (HTTP 404/410).

> **Unabhaengig von Push funktioniert immer:** App-Symbol auf dem
> Startbildschirm **gedrueckt halten** → *Kommen* / *Pause* / *Feierabend*.
> Das stempelt direkt, ohne dass eine Benachrichtigung noetig waere.

---

## Datenschutz-Hinweis

Der Server (Cloudflare Worker) speichert **ausschliesslich**:
- Den SHA-256-Hash des Push-Endpunkts als Schluessel (kein Name, kein Konto).
- Das Push-Abo selbst (von Google vergebene URL + Schluessel) – technisch noetig.
- Das Datum des letzten vollstaendig erfassten Tages (`lastLogged`).
- Die Arbeitstage als Wochentagsnummern (`workdays`, z. B. `[1,2,3,4,5]`).
- Die eingestellten **Erinnerungszeiten** (`times`) – daraus laesst sich die
  ungefaehre Lage des Arbeitstags ablesen, mehr nicht.
- Drei Ja/Nein-Merker fuer heute (`status`): Beginn gestempelt, Pause erfasst,
  Ende gestempelt – **ohne die Uhrzeiten selbst**.
- Welche Erinnerungen heute schon rausgingen (`sent`), gegen Doppelversand.

Die eigentlichen Arbeitszeiten, Stundenwerte, Notizen und Saldi verlassen das
Geraet **nicht**. Der Heartbeat uebermittelt „Beginn ja/nein", nie „Beginn um
07:29". Wer die Erinnerungen abschaltet, loescht mit dem Abo auch diesen
Datensatz (`POST /unsubscribe`).

---

## Bekannte Grenzen

| Situation | Verhalten |
|---|---|
| Geraet war offline beim Stempeln | Der Heartbeat geht verloren; die Erinnerung kommt trotzdem, obwohl schon gestempelt wurde. Beim naechsten Oeffnen der App wird der Status nachgemeldet. Nachtraeglich wird nichts wiederholt. |
| Android schraenkt Hintergrunddienste ein | Push kann verzoegert sein oder ausbleiben. Siehe [Abschnitt 10](#10-android-16--samsung-wenn-keine-meldung-ankommt). |
| Mehrere Geraete | Jedes Geraet hat ein eigenes Abo mit eigenem Status. Wird auf Geraet A gestempelt, erinnert Geraet B trotzdem, bis dort die App geoeffnet wird. |
| Subscription laeuft ab | Der Worker loescht abgelaufene Eintraege automatisch (HTTP 404/410). Schalter in den Einstellungen aus/ein legt ein neues Abo an. |
| Anlass wird nicht abgefragt | Der Push kommt ohne Text; der Service Worker fragt `POST /pending`, worum es geht. Faellt das aus (kein Netz im SW), leitet er den Anlass aus der Uhrzeit ab — der Text kann dann unpassend sein, die Aktions-Knoepfe stempeln aber weiterhin korrekt. |
| Sommer-/Winterzeit | Der Worker rechnet in `Europe/Berlin`; der 5-Minuten-Cron trifft die eingestellte Ortszeit ganzjaehrig. |
