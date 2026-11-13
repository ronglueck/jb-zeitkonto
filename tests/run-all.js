/**
 * Führt alle Testsuiten nacheinander aus.
 *
 *   1. Im Repo-Wurzelverzeichnis einen statischen Server starten:
 *        python -m http.server 8123
 *   2. Hier:  node run-all.js
 */
const { spawnSync } = require("child_process");
const http = require("http");

const BASE = "http://localhost:8123/index.html";
const SUITES = [
  ["test-notifications.js", "Benachrichtigungsanzeige und Diagnose"],
  ["test-abbau.js", "Überstundenabbau"],
  ["test-corrections.js", "Korrekturen, Pausenpruefung und Push-Anmeldung"],
  ["test-openday.js", "Laufender Tag & Summen"],
  ["test-stamp.js", "Stempeluhr"],
  ["test-return.js", "Wieder kommen & Unterbrechungen"],
  ["test-themes.js", "Aussehen (Themes)"],
  ["test-fixedbreak.js", "Feste Pause"],
  ["test-reminders.js", "Erinnerungen & Heartbeat"],
  ["test-worker.mjs", "Worker-Logik (ohne Browser)"]
];

function serverLaeuft() {
  return new Promise(resolve => {
    const req = http.get(BASE, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  if (!(await serverLaeuft())) {
    console.error("\nKein Server auf http://localhost:8123 erreichbar.");
    console.error("Im Wurzelverzeichnis des Repos starten:  python -m http.server 8123\n");
    process.exit(2);
  }

  const ergebnis = [];
  for (const [datei, titel] of SUITES) {
    console.log("\n" + "=".repeat(60));
    console.log("  " + titel + "  (" + datei + ")");
    console.log("=".repeat(60));
    const r = spawnSync(process.execPath, [datei], { stdio: "inherit", cwd: __dirname });
    ergebnis.push({ titel, ok: r.status === 0 });
    // Dem vorherigen Browser einen Moment zum Beenden geben, sonst kann der
    // naechste Start vereinzelt scheitern
    await new Promise(r => setTimeout(r, 750));
  }

  console.log("\n" + "=".repeat(60));
  for (const e of ergebnis) console.log((e.ok ? "  bestanden  " : "  FEHLER     ") + e.titel);
  const fehler = ergebnis.filter(e => !e.ok).length;
  console.log("=".repeat(60));
  console.log(fehler === 0 ? "Alle Suiten bestanden.\n" : fehler + " Suite(n) fehlgeschlagen.\n");
  process.exit(fehler ? 1 : 0);
})();
