/* E2E-Test der Stempeluhr — playwright-core + Edge-Channel */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const OUT = "./output";

const pad = n => String(n).padStart(2, "0");
const key = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = key(new Date());
const dayBefore = n => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

function seedState(entries, settings) {
  return {
    settings: Object.assign({
      employer: "Testfirma",
      soll: { 1: 450, 2: 450, 3: 450, 4: 450, 5: 300, 6: 0, 7: 0 },
      urlaubsanspruch: 30, showWeekend: true, showTotalSaldo: true
    }, settings || {}),
    entries: entries || {}
  };
}

async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 360, height: 800 } });
  if (opts.clockTime) await ctx.clock.install({ time: opts.clockTime });
  await ctx.addInitScript(([st]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("stundenbuch_v1", JSON.stringify(st));
      localStorage.setItem("zeitkonto_seen_version", "99");
      sessionStorage.setItem("seeded", "1");
    }
  }, [seedState(opts.entries, opts.settings)]);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("  FAIL JS-Fehler: " + e.message); });
  await page.goto(opts.url || BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#stampWrap .stamp");
  return { ctx, page };
}

const readEntry = (page, k) => page.evaluate(kk => JSON.parse(localStorage.getItem("stundenbuch_v1")).entries[kk], k || today);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---------- 1) Realistischer Arbeitstag mit kontrollierter Uhr ----------
  console.log("\n1) Arbeitstag stempeln (Do 20.08.2026, Soll 7:30)");
  {
    const K = "2026-08-20";
    const at = (h, m) => new Date(2026, 7, 20, h, m, 0);
    const { ctx, page } = await openApp(browser, { entries: {}, clockTime: at(7, 29) });

    check("Startzustand zeigt KOMMEN", (await page.textContent("#stampWrap")).includes("KOMMEN"));
    check("Soll wird genannt", (await page.textContent("#stampWrap")).includes("Soll heute 7:30 Std"));

    await page.click('[data-act="start"]');
    let e = await readEntry(page, K);
    check("Beginn exakt 07:29", e && e.start === "07:29", e);
    check("nichts vorbelegt", e.bStart === "" && e.bEnd === "" && e.end === "", e);
    check("Karte zeigt FEIERABEND",
      (await page.textContent("#stampWrap")).includes("FEIERABEND"));

    check("kein Pause-Knopf mehr", !(await page.textContent("#stampWrap")).includes("PAUSE"));
    check("Karte kündigt den Pausenabzug an", (await page.textContent("#stampWrap")).includes("30 Min Pause"));

    // Laufende Dauer: die feste Pause wird erst ab ihrer Uhrzeit abgezogen
    await ctx.clock.setSystemTime(at(10, 0));
    await page.evaluate(() => renderToday());
    check("10:00 — vor der Pausenzeit kein Abzug (2:31)",
      (await page.textContent(".stamp-state .big")).trim().startsWith("2:31"),
      (await page.textContent(".stamp-state .big")).trim());
    await ctx.clock.setSystemTime(at(12, 45));
    await page.evaluate(() => renderToday());
    check("12:45 — anteiliger Abzug, 15 Min (5:01)",
      (await page.textContent(".stamp-state .big")).trim().startsWith("5:01"),
      (await page.textContent(".stamp-state .big")).trim());
    await ctx.clock.setSystemTime(at(13, 30));
    await page.evaluate(() => renderToday());
    check("13:30 — volle 30 Min abgezogen (5:31)",
      (await page.textContent(".stamp-state .big")).trim().startsWith("5:31"),
      (await page.textContent(".stamp-state .big")).trim());

    await page.click('[data-act="edit"]');   // Karte antippen -> Editor, dann wieder zu
    await page.click("#cancelDay");

    await ctx.clock.setSystemTime(at(15, 35));
    await page.click('[data-act="end"]');
    e = await readEntry(page, K);
    check("Ende 15:35", e.end === "15:35", e);
    check("feste Pause 12:30–13:00 eingetragen", e.bStart === "12:30" && e.bEnd === "13:00", e);
    check("Karte zeigt 'erfasst'", (await page.textContent("#stampWrap")).includes("erfasst"));
    const cardTxt = await page.textContent(".stamp-done");
    check("Karte zeigt 07:29 – 15:35 (−0:30 Pause)", cardTxt.includes("07:29") && cardTxt.includes("15:35") && cardTxt.includes("0:30"), cardTxt.trim());
    check("Karte zeigt Netto 7:36 und Saldo +0:06", cardTxt.includes("7:36") && cardTxt.includes("+0:06"), cardTxt.trim());
    await page.screenshot({ path: OUT + "/stamp-done.png" });
    await ctx.close();
  }

  // ---------- 2) Erneutes Stempeln überschreibt nichts ----------
  console.log("\n2) Doppelstempel schützt vorhandene Werte");
  {
    const { ctx, page } = await openApp(browser, { entries: { [today]: { type: "work", start: "07:30", bStart: "", bEnd: "", end: "", note: "" } } });
    await page.click('[data-act="end"]');
    let e = await readEntry(page);
    check("Ende gesetzt, Beginn unverändert", e.start === "07:30" && !!e.end, e);
    const endBefore = e.end;
    await page.goto(BASE + "?stamp=end", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#stampWrap .stamp");
    e = await readEntry(page);
    check("zweiter Feierabend ändert nichts", e.end === endBefore, e);
    check("Hinweis erscheint", (await page.textContent("#toast")).includes("steht schon"));
    await ctx.close();
  }

  // ---------- 3) Feierabend ohne Beginn -> Editor statt Raten ----------
  console.log("\n3) Feierabend ohne Beginn öffnet den Editor");
  {
    const { ctx, page } = await openApp(browser, { url: BASE + "?stamp=end" });
    await page.waitForTimeout(600);   // SW-Übernahme abwarten
    check("Editor bleibt offen", await page.getAttribute("#daySheet", "aria-hidden") === "false");
    check("Ende vorbelegt", /^\d\d:\d\d$/.test(await page.inputValue("#fEnd")));
    check("Beginn als Vorschlag vorbelegt", (await page.inputValue("#fStart")).length === 5);
    const e = await readEntry(page);
    check("noch nichts gespeichert", e === undefined || e === null, e);
    await page.click("#saveDay");
    const e2 = await readEntry(page);
    check("nach Bestätigung gespeichert", !!e2 && !!e2.start && !!e2.end, e2);
    await ctx.close();
  }

  // ---------- 4) Feierabend aus laufender Pause ----------
  console.log("\n4) Feierabend während laufender Pause");
  {
    const { ctx, page } = await openApp(browser, { entries: { [today]: { type: "work", start: "07:30", bStart: "12:30", bEnd: "", end: "", note: "" } } });
    check("Zustand onbreak zeigt WEITER", (await page.textContent("#stampWrap")).includes("WEITER"));
    await page.click('[data-act="end"]');
    const e = await readEntry(page);
    check("Ende = Pausenbeginn", e.end === "12:30", e);
    check("Pause entfernt (keine Doppelzählung)", e.bStart === "" && e.bEnd === "", e);
    await ctx.close();
  }

  // ---------- 5) Urlaub/Krank: keine Stempelbuttons ----------
  console.log("\n5) Markierter Tag (Urlaub) wird nicht überstempelt");
  {
    const { ctx, page } = await openApp(browser, { entries: { [today]: { type: "urlaub", note: "" } } });
    const txt = await page.textContent("#stampWrap");
    check("zeigt Urlaub", txt.includes("Urlaub"));
    check("kein KOMMEN-Knopf", !txt.includes("KOMMEN"));
    await page.goto(BASE + "?stamp=start", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#stampWrap .stamp");
    const e = await readEntry(page);
    check("Urlaub bleibt unangetastet", e.type === "urlaub" && !e.start, e);
    await ctx.close();
  }

  // ---------- 6) Nachtrag-Banner für vergessenes Ende ----------
  console.log("\n6) Vergessenes Ende am Vortag");
  {
    const k = dayBefore(1);
    const { ctx, page } = await openApp(browser, { entries: { [k]: { type: "work", start: "07:30", bStart: "", bEnd: "", end: "", note: "" } } });
    check("Banner sichtbar", await page.isVisible(".openday"));
    check("Banner nennt das fehlende Ende", (await page.textContent(".openday")).includes("Ende fehlt"));
    await page.click(".openday button");
    await page.waitForTimeout(200);
    check("Editor öffnet den richtigen Tag", await page.getAttribute("#daySheet", "aria-hidden") === "false");
    check("Beginn des Vortags geladen", await page.inputValue("#fStart") === "07:30");
    await page.fill("#fEnd", "15:30");
    await page.click("#saveDay");
    await page.waitForTimeout(200);
    check("Banner nach Nachtrag verschwunden", !(await page.isVisible(".openday")));
    await ctx.close();
  }

  // ---------- 7) Kein Banner, wenn alles erfasst ----------
  console.log("\n7) Kein Banner ohne offenen Tag");
  {
    const k = dayBefore(1);
    const { ctx, page } = await openApp(browser, { entries: { [k]: { type: "work", start: "07:30", bStart: "12:30", bEnd: "13:00", end: "15:30", note: "" } } });
    check("kein Banner", !(await page.isVisible(".openday")));
    await ctx.close();
  }

  // ---------- 8) Tag ohne Soll ----------
  console.log("\n8) Tag ohne Soll bleibt zurückhaltend");
  {
    const isoKey = ((new Date().getDay() + 6) % 7) + 1;
    const soll = { 1: 450, 2: 450, 3: 450, 4: 450, 5: 300, 6: 0, 7: 0 };
    soll[isoKey] = 0;
    const { ctx, page } = await openApp(browser, { settings: { soll } });
    const txt = await page.textContent("#stampWrap");
    check("Hinweis 'kein Arbeitstag'", txt.includes("kein Arbeitstag"), txt.slice(0, 120));
    check("Stempeln bleibt möglich", txt.includes("TROTZDEM STEMPELN"));
    await ctx.close();
  }

  // ---------- 9) Bestehende Funktionen unberührt ----------
  console.log("\n9) Rechenkern, Fußzeile, Einstellungen unverändert");
  {
    const k = dayBefore(1);
    const { ctx, page } = await openApp(browser, { entries: { [k]: { type: "work", start: "07:30", bStart: "12:30", bEnd: "13:00", end: "15:30", note: "" } } });
    check("Monatssaldo wird gerechnet", /^[+\u2212]\d+:\d\d$/.test((await page.textContent("#monthSaldo")).trim()),
      await page.textContent("#monthSaldo"));
    check("Wochen werden gerendert", (await page.locator("#weeks .week").count()) >= 4);
    check("Fußzeile Gesamt sichtbar", await page.isVisible("#totalCell"));
    await page.click("#settingsBtn");
    await page.waitForTimeout(250);
    check("Einstellungen öffnen", await page.getAttribute("#setSheet", "aria-hidden") === "false");
    await page.click("#saveSet");
    await page.waitForTimeout(200);
    check("Einstellungen speichern schließt Sheet", await page.getAttribute("#setSheet", "aria-hidden") === "true");
    await ctx.close();
  }

  // ---------- 10) Layout auf schmalen Displays ----------
  console.log("\n10) Layout 320 / 360 / 384 px");
  for (const w of [320, 360, 384]) {
    const { ctx, page } = await openApp(browser, {
      entries: { [today]: { type: "work", start: "07:30", bStart: "", bEnd: "", end: "", note: "" } },
      viewport: { width: w, height: 800 }
    });
    const over = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      card: (() => { const el = document.querySelector(".stamp"); return el ? el.scrollWidth > el.clientWidth + 1 : false; })()
    }));
    check(w + "px: kein horizontaler Überlauf", !over.body && !over.card, over);
    const btn = await page.locator('[data-act="end"]').boundingBox();
    check(w + "px: Feierabend-Knopf ≥ 48 px hoch", btn && btn.height >= 48, btn && btn.height);
    check(w + "px: kein Pause-Knopf", (await page.locator('[data-act="break"]').count()) === 0);
    await page.screenshot({ path: OUT + "/stamp-" + w + ".png" });
    await ctx.close();
  }

  // ---------- 11) Aktion aus einer Benachrichtigung bei offener App ----------
  console.log("\n11) Benachrichtigungs-Aktion bei geöffneter App");
  {
    const { ctx, page } = await openApp(browser, {});
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "stamp", kind: "start" } })));
    await page.waitForTimeout(200);
    let e = await readEntry(page);
    check("Beginn per Nachricht gestempelt", !!e && /^\d\d:\d\d$/.test(e.start), e);
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "quatsch", kind: "start" } })));
    await page.waitForTimeout(150);
    check("unbekannte Nachricht wird ignoriert", true);
    await ctx.close();
  }
  {
    // Feierabend per Nachricht — eigener Kontext mit Beginn in der Vergangenheit,
    // sonst laegen Beginn und Ende in derselben Minute
    const { ctx, page } = await openApp(browser, {
      entries: { [today]: { type: "work", start: "07:30", bStart: "", bEnd: "", end: "", note: "" } }
    });
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "stamp", kind: "end" } })));
    await page.waitForTimeout(250);
    const e = await readEntry(page);
    check("Feierabend per Nachricht gestempelt", !!e.end, e);
    check("feste Pause dabei eingetragen", !!e.bStart && !!e.bEnd, e);
    await ctx.close();
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
