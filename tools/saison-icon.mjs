#!/usr/bin/env node
/* Stellt das App-Icon im Manifest je nach Datum um.

   Vom 1. bis 26. Dezember zeigt manifest.json auf icons/xmas/, sonst auf icons/.
   Die Seite liegt statisch auf GitHub Pages, deshalb erledigt das der Zeitplan
   .github/workflows/saison-icon.yml einmal taeglich. Das Skript aendert nur
   etwas, wenn der Stand nicht zum Datum passt.

   Aufruf im Repo-Wurzelverzeichnis:
     node tools/saison-icon.mjs                      Datum von heute (Europe/Berlin)
     node tools/saison-icon.mjs --mode weihnachten   erzwingen (auch: normal, auto)
     node tools/saison-icon.mjs --date 2026-12-01    fuer Tests
     node tools/saison-icon.mjs --manifest pfad      andere Manifest-Datei

   Dieselbe Datumsregel steht in sw.js (seasonIcon) und index.html
   (seasonIconUrl) fuer das Benachrichtigungs-Icon. Bei Aenderungen alle drei
   anpassen; tests/test-saison-icon.js prueft, dass sie uebereinstimmen. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** "weihnachten" vom 1. bis 26. Dezember, sonst "normal". ymd = "JJJJ-MM-TT". */
export function iconSeason(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Datum bitte als JJJJ-MM-TT: " + ymd);
  return (Number(m[2]) === 12 && Number(m[3]) <= 26) ? "weihnachten" : "normal";
}

/** Heutiges Datum in Deutschland, unabhaengig von der Zeitzone des Rechners. */
export function todayBerlin(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Setzt alle App-Icons im Manifest-Text auf die gewuenschte Saison. Die Formatierung bleibt erhalten. */
export function applySeason(manifestText, season) {
  const dir = season === "weihnachten" ? "xmas/" : "";
  return manifestText.replace(/"\.\/icons\/(?:xmas\/)?(icon-[a-z0-9-]+\.png)"/g, (_, file) => '"./icons/' + dir + file + '"');
}

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = arg("mode") || "auto";
  if (!["auto", "weihnachten", "normal"].includes(mode)) {
    console.error("Unbekannter Modus: " + mode + " (erlaubt: auto, weihnachten, normal)");
    process.exit(2);
  }
  const date = arg("date") || todayBerlin();
  const season = mode === "auto" ? iconSeason(date) : mode;
  const path = arg("manifest") || join(dirname(dirname(fileURLToPath(import.meta.url))), "manifest.json");
  const before = readFileSync(path, "utf8");
  const after = applySeason(before, season);
  JSON.parse(after);   // bricht ab, falls das Manifest danach kein gueltiges JSON waere
  if (after === before) {
    console.log("Icon unveraendert: " + season + " (" + (mode === "auto" ? date : "Modus " + mode) + ")");
  } else {
    writeFileSync(path, after);
    console.log("Icon umgestellt auf: " + season + " (" + (mode === "auto" ? date : "Modus " + mode) + ")");
  }
}
