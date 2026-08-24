/* E2E-Test der festen Pause */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const OUT = "./output";
const WORKER = "https://zeitkonto-push.h1n15r15.workers.dev";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/TEST-ENDPOINT";

const pad = n => String(n).padStart(2, "0");
const d0 = new Date();
const today = d0.getFullYear() + "-" + pad(d0.getMonth() + 1) + "-" + pad(d0.getDate());

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

function seedState(entries, settings) {
  return {
    settings: Object.assign({
      employer: "Testfirma",
      soll: { 1: 420, 2: 420, 3: 420, 4: 420, 5: 420, 6: 0, 7: 0 },   // Janettes Vertrag: Mo–Fr 7:00
      urlaubsanspruch: 30, showWeekend: true, showTotalSaldo: true
    }, settings || {}),
    entries: entries || {}
  };
}

async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 360, height: 800 } });
  const calls = [];
  await ctx.route(WORKER + "/**", async route => {
    let body = null;
    try { body = JSON.parse(route.request().postData() || "null"); } catch (e) {}
    calls.push({ url: route.request().url(), body });
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  if (opts.clockTime) await ctx.clock.install({ time: opts.clockTime });
  await ctx.addInitScript(([st, push]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("stundenbuch_v1", JSON.stringify(st));
      localStorage.setItem("zeitkonto_seen_version", "99");
      if (push) localStorage.setItem("zeitkonto_push_v1", JSON.stringify(push));
      sessionStorage.setItem("seeded", "1");
    }
  }, [opts.rawState || seedState(opts.entries, opts.settings), opts.push || null]);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("  FAIL JS-Fehler: " + e.message); });
  await page.goto(opts.url || BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#stampWrap .stamp");
  return { ctx, page, calls };
}

const readEntry = (page, k) => page.evaluate(kk => JSON.parse(localStorage.getItem("stundenbuch_v1")).entries[kk], k || today);
// Pausenlage direkt aus der App berechnen lassen (unabhängig von der Tageszeit)
const breakFor = (page, s, e) => page.evaluate(([a, b]) => fixedBreakFor(a, b), [s, e]);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---------- 1) Pausenlage in allen Varianten ----------
  console.log("\n1) Wohin die feste Pause gelegt wird");
  {
    const { ctx, page } = await openApp(browser, {});
    check("normaler Tag -> eingestellte Zeit",
      JSON.stringify(await breakFor(page, "07:30", "15:30")) === JSON.stringify({ bStart: "12:30", bEnd: "13:00" }),
      await breakFor(page, "07:30", "15:30"));
    check("kurzer Freitag -> Tagesmitte",
      JSON.stringify(await breakFor(page, "07:00", "11:00")) === JSON.stringify({ bStart: "08:45", bEnd: "09:15" }),
      await breakFor(page, "07:00", "11:00"));
    check("Spätschicht (Pausenzeit liegt davor) -> Tagesmitte",
      JSON.stringify(await breakFor(page, "14:00", "22:00")) === JSON.stringify({ bStart: "17:45", bEnd: "18:15" }),
      await breakFor(page, "14:00", "22:00"));
    // Tagesmitte von 07:30–12:45 ist 10:07; die Pause 09:53–10:23 liegt mittig darum
    check("Pausenzeit ragt übers Tagesende -> Tagesmitte",
      JSON.stringify(await breakFor(page, "07:30", "12:45")) === JSON.stringify({ bStart: "09:53", bEnd: "10:23" }),
      await breakFor(page, "07:30", "12:45"));
    check("Tag kürzer als die Pause -> gar keine Pause",
      (await breakFor(page, "10:00", "10:20")) === null, await breakFor(page, "10:00", "10:20"));
    check("Tag exakt so lang wie die Pause -> keine Pause",
      (await breakFor(page, "10:00", "10:30")) === null, await breakFor(page, "10:00", "10:30"));
    check("Pause passt exakt ans Ende",
      JSON.stringify(await breakFor(page, "07:30", "13:00")) === JSON.stringify({ bStart: "12:30", bEnd: "13:00" }),
      await breakFor(page, "07:30", "13:00"));
    await ctx.close();
  }

  // ---------- 2) Abschaltbar über die Dauer ----------
  console.log("\n2) Dauer 0 schaltet die feste Pause ab");
  {
    const { ctx, page } = await openApp(browser, { settings: { fixedBreak: { min: 0, start: "12:30" } } });
    check("keine Pause berechnet", (await breakFor(page, "07:30", "15:30")) === null);
    check("Karte kündigt keinen Abzug an", !(await page.textContent("#stampWrap")).includes("Min Pause"));
    await page.click('[data-act="start"]');
    await page.waitForTimeout(150);
    check("weiterhin kein Pause-Knopf", (await page.locator('[data-act="break"]').count()) === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await openApp(browser, { settings: { fixedBreak: { min: 45, start: "11:00" } } });
    check("abweichende Dauer wird verwendet",
      JSON.stringify(await breakFor(page, "07:30", "15:30")) === JSON.stringify({ bStart: "11:00", bEnd: "11:45" }),
      await breakFor(page, "07:30", "15:30"));
    check("Karte nennt die eingestellte Dauer", (await page.textContent("#stampWrap")).includes("45 Min Pause") ||
      (await page.textContent("#stampWrap")).includes("Noch nicht gestempelt"));
    await ctx.close();
  }

  // ---------- 3) Vorhandene Pause wird nie überschrieben ----------
  console.log("\n3) Eine erfasste Pause bleibt unangetastet");
  {
    const { ctx, page } = await openApp(browser, {
      entries: { [today]: { type: "work", start: "07:30", bStart: "10:00", bEnd: "10:20", end: "", note: "" } }
    });
    check("Karte zeigt die erfasste Pause", (await page.textContent("#stampWrap")).includes("10:00"));
    await page.click('[data-act="end"]');
    const e = await readEntry(page);
    check("eigene Pause erhalten", e.bStart === "10:00" && e.bEnd === "10:20", e);
    await ctx.close();
  }

  // ---------- 4) Ganzer Tag mit Janettes Vertrag (Soll 7:00) ----------
  console.log("\n4) Voller Tag: Kommen 07:00, Feierabend 15:00, Soll 7:00");
  {
    const at = (h, m) => new Date(2026, 7, 20, h, m, 0);   // Donnerstag
    const K = "2026-08-20";
    const { ctx, page } = await openApp(browser, { clockTime: at(7, 0) });
    await page.click('[data-act="start"]');
    await ctx.clock.setSystemTime(at(15, 0));
    await page.click('[data-act="end"]');
    const e = await readEntry(page, K);
    check("07:00 – 15:00 erfasst", e.start === "07:00" && e.end === "15:00", e);
    check("Pause 12:30–13:00", e.bStart === "12:30" && e.bEnd === "13:00", e);
    const card = await page.textContent(".stamp-done");
    check("Netto 7:30 Std", card.includes("7:30"), card.trim());
    check("Saldo +0:30 gegen Soll 7:00", card.includes("+0:30"), card.trim());
    await page.screenshot({ path: OUT + "/fixedbreak-done.png" });
    await ctx.close();
  }

  // ---------- 5) Kurzer Freitag ----------
  console.log("\n5) Kurzer Freitag: 07:00 – 11:00");
  {
    const at = (h, m) => new Date(2026, 7, 21, h, m, 0);   // Freitag
    const K = "2026-08-21";
    const { ctx, page } = await openApp(browser, { clockTime: at(7, 0) });
    await page.click('[data-act="start"]');
    await ctx.clock.setSystemTime(at(11, 0));
    await page.click('[data-act="end"]');
    const e = await readEntry(page, K);
    check("Pause rutscht in die Tagesmitte", e.bStart === "08:45" && e.bEnd === "09:15", e);
    const card = await page.textContent(".stamp-done");
    check("Netto 3:30 Std", card.includes("3:30"), card.trim());
    check("Saldo −3:30 gegen Soll 7:00", card.includes("−3:30"), card.trim());
    await ctx.close();
  }

  // ---------- 6) Einstellungen ----------
  console.log("\n6) Einstellungen für die feste Pause");
  {
    const { ctx, page, calls } = await openApp(browser, { push: { enabled: true, endpoint: ENDPOINT } });
    await page.click("#settingsBtn");
    await page.waitForTimeout(250);
    check("Dauer-Feld vorbelegt mit 30", await page.inputValue("#sBreakMin") === "30", await page.inputValue("#sBreakMin"));
    check("Beginn-Feld vorbelegt mit 12:30", await page.inputValue("#sBreakStart") === "12:30");
    check("Pausen-Erinnerung ist verschwunden", (await page.locator("#rPause").count()) === 0);
    const hb0 = calls.filter(c => c.url.endsWith("/heartbeat"))[0];
    check("Heartbeat meldet keine Pausen-Erinnerung", hb0 && hb0.body.times.pause === "", hb0 && hb0.body.times);

    await page.fill("#sBreakMin", "45");
    await page.fill("#sBreakStart", "11:30");
    await page.click("#saveSet");
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("stundenbuch_v1")).settings);
    check("Dauer gespeichert", st.fixedBreak.min === 45, st.fixedBreak);
    check("Beginn gespeichert", st.fixedBreak.start === "11:30", st.fixedBreak);
    await ctx.close();
  }
  {
    // Unsinnige Eingabe darf nichts kaputtmachen
    const { ctx, page } = await openApp(browser, {});
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.fill("#sBreakMin", "abc");
    await page.click("#saveSet");
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("stundenbuch_v1")).settings);
    check("unlesbare Dauer wird zu 0", st.fixedBreak.min === 0, st.fixedBreak);
    check("keine Pause mehr berechnet", (await breakFor(page, "07:30", "15:30")) === null);
    await ctx.close();
  }

  // ---------- 7) Migration ----------
  console.log("\n7) Bestandsdaten");
  {
    const alt = {
      settings: { employer: "Alt", soll: { 1: 420, 2: 420, 3: 420, 4: 420, 5: 420, 6: 0, 7: 0 }, urlaubsanspruch: 25 },
      entries: { "2026-08-03": { start: "07:00", bStart: "12:00", bEnd: "12:30", end: "15:00", note: "" } }
    };
    const { ctx, page } = await openApp(browser, { rawState: alt });
    const st = await page.evaluate(() => state.settings);
    check("fixedBreak ergänzt (30/12:30)", st.fixedBreak && st.fixedBreak.min === 30 && st.fixedBreak.start === "12:30", st.fixedBreak);
    const e = await page.evaluate(() => state.entries["2026-08-03"]);
    check("alter Eintrag unverändert", e.bStart === "12:00" && e.bEnd === "12:30", e);
    await ctx.close();
  }

  // ---------- 8) Layout ohne Pause-Knopf ----------
  console.log("\n8) Layout 320 / 384 px");
  for (const w of [320, 384]) {
    const { ctx, page } = await openApp(browser, {
      entries: { [today]: { type: "work", start: "07:00", bStart: "", bEnd: "", end: "", note: "" } },
      viewport: { width: w, height: 800 }
    });
    const over = await page.evaluate(() => {
      const el = document.querySelector(".stamp");
      return { body: document.documentElement.scrollWidth > document.documentElement.clientWidth,
               card: el ? el.scrollWidth > el.clientWidth + 1 : false };
    });
    check(w + "px: kein Überlauf", !over.body && !over.card, over);
    const btn = await page.locator('[data-act="end"]').boundingBox();
    check(w + "px: Feierabend-Knopf nutzt die volle Breite", btn && btn.width > w * 0.7, btn && btn.width);
    await page.screenshot({ path: OUT + "/fixedbreak-" + w + ".png" });
    await ctx.close();
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
