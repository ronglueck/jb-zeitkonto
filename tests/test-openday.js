/* Regressionstest: ein angefangener Tag darf die Summen nicht verfälschen */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const OUT = "./output";

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

// Feste Uhr: Donnerstag, 20.08.2026, 10:12 Uhr
const NOW = new Date(2026, 7, 20, 10, 12, 0);
const BREAK = { bStart: "12:30", bEnd: "13:00" };
const w = (start, end) => Object.assign({ type: "work", start, end, note: "" }, BREAK);

// Mo–Mi abgeschlossen (je +0:52), Do läuft noch
const entries = {
  "2026-08-17": w("07:01", "15:23"),
  "2026-08-18": w("07:01", "15:23"),
  "2026-08-19": w("07:01", "15:23"),
  "2026-08-20": { type: "work", start: "07:04", bStart: "", bEnd: "", end: "", note: "" }
};

const state = {
  settings: {
    employer: "Muster GmbH",
    soll: { 1: 420, 2: 420, 3: 420, 4: 420, 5: 420, 6: 0, 7: 0 },
    urlaubsanspruch: 30, showWeekend: false, showTotalSaldo: true,
    fixedBreak: { min: 30, start: "12:30" },
    reminders: { start: "07:45", pause: "", end: "15:30", endFri: "", day: "20:00" }
  },
  entries
};

async function open(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("https://zeitkonto-push.h1n15r15.workers.dev/**",
    r => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await ctx.clock.install({ time: NOW });
  await ctx.addInitScript(([st]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("stundenbuch_v1", JSON.stringify(st));
      localStorage.setItem("zeitkonto_seen_version", "99");
      sessionStorage.setItem("seeded", "1");
    }
  }, [seed || state]);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("  FAIL JS-Fehler: " + e.message); });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#stampWrap .stamp");
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---------- 1) Summen während des laufenden Tages ----------
  console.log("\n1) Laufender Tag verfälscht die Summen nicht");
  {
    const { ctx, page } = await open(browser);
    const monat = (await page.textContent("#monthSaldo")).trim();
    const gesamt = (await page.textContent("#totalSaldo")).trim();
    const woche = (await page.textContent("#weekTotal")).trim();
    check("Monatssaldo = +2:36 (3 × +0:52)", monat === "+2:36", monat);
    check("Gesamtsaldo = +2:36", gesamt === "+2:36", gesamt);
    check("Diese Woche = 23:36 Std (3 Tage)", woche.startsWith("23:36"), woche);
    check("kein Minus in der Fußzeile", !monat.startsWith("−"), monat);
    await page.screenshot({ path: OUT + "/openday-fix.png" });
    await ctx.close();
  }

  // ---------- 2) Tageszeile zeigt den Zustand statt eines Saldos ----------
  console.log("\n2) Die Tageszeile sagt, was los ist");
  {
    const { ctx, page } = await open(browser);
    const row = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#weeks .day")];
      const r = rows.find(x => x.textContent.includes("20.08"));
      return r ? r.textContent : null;
    });
    check("heutiger Tag zeigt 'läuft'", row && row.includes("läuft"), row);
    check("kein −7:00 in der Zeile", row && !row.includes("7:00"), row);
    await ctx.close();
  }
  {
    // Derselbe Zustand an einem vergangenen Tag = vergessenes Ende
    const seed = JSON.parse(JSON.stringify(state));
    delete seed.entries["2026-08-20"];
    seed.entries["2026-08-19"] = { type: "work", start: "07:04", bStart: "", bEnd: "", end: "", note: "" };
    const { ctx, page } = await open(browser, seed);
    const row = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#weeks .day")];
      const r = rows.find(x => x.textContent.includes("19.08"));
      return r ? r.textContent : null;
    });
    check("vergangener Tag zeigt 'Ende fehlt'", row && row.includes("Ende fehlt"), row);
    check("Nachtrag-Banner ist da", await page.isVisible(".openday"));
    const monat = (await page.textContent("#monthSaldo")).trim();
    check("auch hier kein falsches Minus (+1:44)", monat === "+1:44", monat);
    await ctx.close();
  }

  // ---------- 3) Nach dem Feierabend zählt der Tag normal mit ----------
  console.log("\n3) Nach dem Feierabend zählt der Tag");
  {
    const { ctx, page } = await open(browser);
    await ctx.clock.setSystemTime(new Date(2026, 7, 20, 15, 23, 0));
    await page.click('[data-act="end"]');
    await page.waitForTimeout(200);
    const monat = (await page.textContent("#monthSaldo")).trim();
    // 07:04–15:23 = 499 min − 30 Pause = 469; Soll 420 -> +0:49. Dazu 3 × +0:52
    check("Monatssaldo jetzt +3:25", monat === "+3:25", monat);
    const e = await page.evaluate(() => JSON.parse(localStorage.getItem("stundenbuch_v1")).entries["2026-08-20"]);
    check("Tag ist abgeschlossen", !!e.end && !!e.bStart, e);
    await ctx.close();
  }

  // ---------- 4) Monatsbericht bleibt konsistent ----------
  console.log("\n4) Monatsbericht zeigt den offenen Tag als unvollständig");
  {
    const { ctx, page } = await open(browser);
    // #report ist am Bildschirm ausgeblendet -> Tabelle strukturiert auslesen
    const rows = await page.evaluate(() => {
      buildReport();
      return [...document.querySelectorAll("#report tbody tr")].map(tr => [...tr.cells].map(td => td.textContent.trim()));
    });
    const zeile = rows.find(r => r[0] && r[0].startsWith("20.08"));
    check("Zeile für den laufenden Tag vorhanden", !!zeile, zeile);
    check("Eintrag als offen markiert (07:04 – ?)", zeile && zeile[1].indexOf("?") >= 0, zeile);
    check("Ist und Saldo bleiben leer", zeile && zeile[2] === "—" && zeile[4] === "—", zeile);
    check("Soll wird trotzdem genannt", zeile && zeile[3] === "7:00", zeile);
    const summe = rows.find(r => r[0] === "Summe");
    check("Summenzeile passt zur Fußzeile (+2:36)", summe && summe[summe.length - 1] === "+2:36", summe);
    const fertig = rows.find(r => r[0] && r[0].startsWith("17.08"));
    check("abgeschlossener Tag wird normal gerechnet", fertig && fertig[4] === "+0:52", fertig);
    await ctx.close();
  }

  // ---------- 5) Urlaub/Krank bleiben unberührt ----------
  console.log("\n5) Markierte Tage zählen weiterhin voll");
  {
    const seed = JSON.parse(JSON.stringify(state));
    seed.entries["2026-08-19"] = { type: "urlaub", note: "" };
    const { ctx, page } = await open(browser, seed);
    const monat = (await page.textContent("#monthSaldo")).trim();
    check("Urlaub ist saldo-neutral, Rest bleibt (+1:44)", monat === "+1:44", monat);
    const woche = (await page.textContent("#weekTotal")).trim();
    check("Urlaub zählt beim Ist mit (22:44 Std)", woche.startsWith("22:44"), woche);
    await ctx.close();
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
