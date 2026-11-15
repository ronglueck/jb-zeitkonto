/* Weihnachts-Icon: Datumsregel, Manifest-Umstellung, Icon-Dateien, Seite und Service Worker.
   Der Seitenteil braucht den lokalen Server (python -m http.server 8123). */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { iconSeason, todayBerlin, applySeason } from "../tools/saison-icon.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, "tools", "saison-icon.mjs");
const NORMAL = "./icons/icon-192.png", XMAS = "./icons/xmas/icon-192.png";

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// Grenztage: [Datum, erwartete Saison]
const DAYS = [
  ["2026-11-15", "normal"], ["2026-11-29", "normal"], ["2026-11-30", "normal"],
  ["2026-12-01", "weihnachten"], ["2026-12-24", "weihnachten"], ["2026-12-26", "weihnachten"],
  ["2026-12-27", "normal"], ["2026-12-31", "normal"], ["2027-01-01", "normal"], ["2027-12-01", "weihnachten"]
];

console.log("\nA) Datumsregel");
for (const [d, want] of DAYS) check(d + " -> " + want, iconSeason(d) === want, iconSeason(d));
check("Mitternacht in Deutschland zaehlt, nicht UTC (30.11. 23:30 UTC = 1.12.)",
  todayBerlin(new Date("2026-11-30T23:30:00Z")) === "2026-12-01", todayBerlin(new Date("2026-11-30T23:30:00Z")));
check("30.11. 22:30 UTC ist noch der 30.11.", todayBerlin(new Date("2026-11-30T22:30:00Z")) === "2026-11-30");

console.log("\nB) Manifest umstellen");
const original = readFileSync(join(ROOT, "manifest.json"), "utf8");
const srcs = text => { const m = JSON.parse(text); return [...m.icons, ...m.shortcuts.flatMap(s => s.icons)].map(i => i.src); };
check("Manifest im Repo zeigt auf das Icon, das zum heutigen Datum passt",
  original === applySeason(original, iconSeason(todayBerlin())));
const xmas = applySeason(original, "weihnachten");
check("Weihnachten: alle Icons liegen unter icons/xmas/", srcs(xmas).every(s => s.startsWith("./icons/xmas/icon-")), srcs(xmas));
check("Weihnachten: sonst nichts geaendert", xmas.replace(/icons\/xmas\//g, "icons/") === applySeason(original, "normal"));
check("zweimal anwenden aendert nichts", applySeason(xmas, "weihnachten") === xmas);
check("zurueck ergibt wieder den Normalstand", applySeason(xmas, "normal") === applySeason(original, "normal"));
check("Normal: kein Icon unter icons/xmas/", srcs(applySeason(xmas, "normal")).every(s => !s.includes("xmas")));
check("jede im Manifest genannte Icon-Datei gibt es in beiden Saetzen",
  [...srcs(xmas), ...srcs(applySeason(xmas, "normal"))].every(s => existsSync(join(ROOT, s))));

// PNG-Groesse aus dem Dateikopf lesen
const pngSize = p => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const mx = JSON.parse(xmas);
for (const ic of mx.icons) {
  const [w, h] = pngSize(join(ROOT, ic.src));
  check(ic.src + " ist " + ic.sizes, w + "x" + h === ic.sizes, [w, h]);
}
// Maskierbares Icon: randlos, also keine durchsichtige Ecke (Farbtyp 2 = RGB ohne Alpha)
check("maskierbares Weihnachts-Icon ist randlos (ohne Transparenz)",
  readFileSync(join(ROOT, "icons/xmas/icon-maskable-512.png"))[25] === 2);

console.log("\nC) Skript auf der Kommandozeile");
const tmp = join(mkdtempSync(join(tmpdir(), "saison-")), "manifest.json");
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--manifest", tmp, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout + r.stderr).trim(), text: readFileSync(tmp, "utf8") };
};
writeFileSync(tmp, applySeason(original, "normal"));
let r = run("--date", "2026-11-30");
check("30.11.: unveraendert", r.code === 0 && /unveraendert/.test(r.out) && !r.text.includes("xmas"), r.out);
r = run("--date", "2026-12-01");
check("1.12.: umgestellt auf Weihnachten", r.code === 0 && /umgestellt auf: weihnachten/.test(r.out) && r.text === xmas, r.out);
r = run("--date", "2026-12-02");
check("2.12.: schon umgestellt, unveraendert", r.code === 0 && /unveraendert/.test(r.out) && r.text === xmas, r.out);
r = run("--date", "2026-12-27");
check("27.12.: zurueck auf normal", r.code === 0 && /umgestellt auf: normal/.test(r.out) && r.text === applySeason(original, "normal"), r.out);
r = run("--mode", "weihnachten", "--date", "2026-07-01");
check("Modus weihnachten erzwingt das Weihnachts-Icon", r.code === 0 && r.text === xmas, r.out);
r = run("--mode", "normal", "--date", "2026-12-10");
check("Modus normal erzwingt das normale Icon", r.code === 0 && !r.text.includes("xmas"), r.out);
r = run("--mode", "quatsch");
check("unbekannter Modus bricht mit Fehler ab", r.code === 2 && !r.text.includes("xmas"), r);
r = run("--date", "1.12.2026");
check("falsches Datumsformat bricht mit Fehler ab", r.code !== 0 && !r.text.includes("xmas"), r.code);

console.log("\nD) Service Worker: Benachrichtigungs-Icon");
const day = ymd => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d, 12, 0); };
const swCtx = vm.createContext({ self: { addEventListener() {}, location: { origin: "http://x" } }, URL, Response: class {}, console });
vm.runInContext(readFileSync(join(ROOT, "sw.js"), "utf8"), swCtx);
for (const [d, want] of DAYS) {
  const got = swCtx.seasonIcon(day(d));
  check("sw.js " + d + " -> " + want, got === (want === "weihnachten" ? XMAS : NORMAL), got);
}

console.log("\nE) Seite: Icon fuer Benachrichtigung und iPhone-Startbildschirm");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ channel: "msedge" });
try {
  for (const [d, want] of DAYS) {
    const ctx = await browser.newContext({ viewport: { width: 384, height: 800 } });
    await ctx.clock.install({ time: day(d) });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push(e.message));
    await page.goto("http://localhost:8123/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#stampWrap .stamp");
    const got = await page.evaluate(() => ({
      fn: seasonIconUrl(),
      touch: document.querySelector('link[rel="apple-touch-icon"]').getAttribute("href")
    }));
    const url = want === "weihnachten" ? XMAS : NORMAL;
    check("Seite " + d + " -> " + want, got.fn === url && got.touch === url && errs.length === 0, { got, errs });
    if (d === "2026-12-01") {
      const ok = await page.evaluate(async u => (await fetch(u)).ok, XMAS);
      check("Weihnachts-Icon wird vom Server ausgeliefert", ok);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log("\n" + pass + " bestanden, " + fail + " fehlgeschlagen");
process.exit(fail ? 1 : 0);
