/* E2E-Test "Wieder kommen" (zweites Kommen / Unterbrechungen) — playwright-core + Edge */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const K = "2026-08-20";                                   // Donnerstag, Soll 7:30
const at = (h, m) => new Date(2026, 7, 20, h, m, 0);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 360, height: 800 } });
  await ctx.clock.install({ time: opts.clockTime || at(7, 0) });
  const st = {
    settings: { employer: "Testfirma", soll: { 1: 450, 2: 450, 3: 450, 4: 450, 5: 300, 6: 0, 7: 0 },
                urlaubsanspruch: 30, showWeekend: true, showTotalSaldo: true },
    entries: opts.entries || {}
  };
  await ctx.addInitScript(([s]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("stundenbuch_v1", JSON.stringify(s));
      localStorage.setItem("zeitkonto_seen_version", "99");
      sessionStorage.setItem("seeded", "1");
    }
  }, [st]);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("  FAIL JS-Fehler: " + e.message); });
  await page.goto(opts.url || BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#stampWrap .stamp");
  return { ctx, page };
}
const readEntry = page => page.evaluate(k => JSON.parse(localStorage.getItem("stundenbuch_v1")).entries[k], K);
const card = page => page.textContent("#stampWrap");
async function tap(ctx, page, time, act) {
  await ctx.clock.setSystemTime(time);
  await page.evaluate(() => renderToday());
  await page.click('[data-act="' + act + '"]');
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  console.log("\n1) Sohn abholen: Kommen, Feierabend, Wieder kommen, Feierabend");
  {
    const { ctx, page } = await openApp(browser);
    await tap(ctx, page, at(7, 4), "start");
    await tap(ctx, page, at(11, 32), "end");
    let e = await readEntry(page);
    check("erster Feierabend 11:32 mit automatischer Pause", e.end === "11:32" && e.bStart === "09:03" && e.bAuto === true, e);
    check("Karte bietet WIEDER KOMMEN", (await card(page)).includes("WIEDER KOMMEN"));

    await tap(ctx, page, at(12, 40), "return");
    e = await readEntry(page);
    check("Unterbrechung 11:32–12:40 erfasst", JSON.stringify(e.gaps) === '[{"from":"11:32","to":"12:40"}]', e);
    check("Tag läuft wieder (Ende leer, Beginn unverändert)", e.end === "" && e.start === "07:04", e);
    check("automatische Pause verworfen", e.bStart === "" && e.bEnd === "" && !("bAuto" in e), e);
    check("Karte zeigt FEIERABEND und die Unterbrechung",
      (await card(page)).includes("FEIERABEND") && (await card(page)).includes("weg 11:32–12:40"), await card(page));
    check("Tageszeile: läuft + Unterbrechung",
      (await page.textContent(".day.today")).includes("läuft") && (await page.textContent(".day.today")).includes("Unterbrechung 11:32–12:40"));

    await ctx.clock.setSystemTime(at(14, 0));
    await page.evaluate(() => renderToday());
    check("14:00 — laufende Dauer 5:18 (Unterbrechung und Pause abgezogen)",
      (await page.textContent(".stamp-state .big")).trim().startsWith("5:18"), (await page.textContent(".stamp-state .big")).trim());

    await tap(ctx, page, at(16, 10), "end");
    e = await readEntry(page);
    check("Feierabend 16:10", e.end === "16:10", e);
    check("Pause liegt im längsten Arbeitsabschnitt, nicht in der Unterbrechung", e.bStart === "09:03" && e.bEnd === "09:33", e);
    const calc = await page.evaluate(k => ({ net: netMin(state.entries[k]), diff: dayDiff(parseYmd(k), state.entries[k]) }), K);
    check("Ist 7:28 = 9:06 − 1:08 weg − 0:30 Pause", calc.net === 448, calc);
    check("Saldo −0:02", calc.diff === -2, calc);
    check("Karte erfasst: Unterbrechung und 7:28", (await card(page)).includes("Unterbrechung 11:32–12:40") && (await card(page)).includes("7:28"), await card(page));
    const row = await page.textContent(".day.today");
    check("Tageszeile zeigt Unterbrechung und Ist", row.includes("Unterbrechung 11:32–12:40") && row.includes("7:28"), row);
    const week = await page.evaluate(k => aggregate([k]), K);
    check("Wochensumme rechnet mit 7:28", JSON.stringify(week).includes("448"), week);

    await page.reload(); await page.waitForSelector("#stampWrap .stamp");
    e = await readEntry(page);
    check("übersteht Neuladen", e.gaps && e.gaps.length === 1 && e.end === "16:10", e);
    await ctx.close();
  }

  console.log("\n2) Pause zur eingestellten Uhrzeit, zwei Unterbrechungen");
  {
    const { ctx, page } = await openApp(browser);
    await tap(ctx, page, at(7, 0), "start");
    await tap(ctx, page, at(10, 0), "end");
    await tap(ctx, page, at(10, 45), "return");
    await tap(ctx, page, at(14, 0), "end");
    let e = await readEntry(page);
    check("Pause 12:30–13:00 passt in den zweiten Abschnitt", e.bStart === "12:30" && e.bEnd === "13:00", e);
    await tap(ctx, page, at(14, 20), "return");
    e = await readEntry(page);
    check("zweite Unterbrechung angehängt", e.gaps.length === 2 && e.gaps[1].from === "14:00" && e.gaps[1].to === "14:20", e);
    await tap(ctx, page, at(15, 30), "end");
    e = await readEntry(page);
    const net = await page.evaluate(k => netMin(state.entries[k]), K);
    check("Ist 6:55 = 8:30 − 0:45 − 0:20 − 0:30", net === 415, { net, e });
    check("Pause bleibt 12:30–13:00", e.bStart === "12:30" && e.bEnd === "13:00", e);
    await ctx.close();
  }

  console.log("\n3) Grenzfälle der Stempeluhr");
  {
    const { ctx, page } = await openApp(browser);
    await tap(ctx, page, at(7, 0), "start");
    await tap(ctx, page, at(15, 30), "end");
    await tap(ctx, page, at(15, 30), "return");
    let e = await readEntry(page);
    check("Wieder kommen in derselben Minute nimmt den Feierabend zurück, ohne Unterbrechung", e.end === "" && !e.gaps, e);
    await tap(ctx, page, at(15, 31), "end");
    e = await readEntry(page);
    check("danach normaler Feierabend 15:31 mit Pause", e.end === "15:31" && e.bStart === "12:30" && !e.gaps, e);

    await page.evaluate(() => stampNow("start"));
    e = await readEntry(page);
    check("Verknüpfung „Kommen“ öffnet einen fertigen Tag nicht wieder", e.end === "15:31" && !e.gaps, e);

    // Von Hand erfasste Pause bleibt beim Wieder kommen erhalten
    await page.evaluate(k => { delete state.entries[k].bAuto; state.entries[k].bStart = "12:00"; state.entries[k].bEnd = "12:30"; saveState(); render(); }, K);
    await tap(ctx, page, at(16, 0), "return");
    e = await readEntry(page);
    check("von Hand erfasste Pause bleibt", e.bStart === "12:00" && e.bEnd === "12:30" && e.gaps.length === 1, e);
    await ctx.close();
  }

  console.log("\n4) Tag-Editor: Unterbrechung von Hand");
  {
    const { ctx, page } = await openApp(browser, { clockTime: at(18, 0), entries: {
      [K]: { type: "work", start: "07:00", bStart: "12:30", bEnd: "13:00", end: "15:30", note: "" } } });
    await page.click('[data-act="edit"]');
    check("anfangs keine Unterbrechungszeile", (await page.locator(".gaprow").count()) === 0);
    await page.click("#addGap");
    await page.fill("#gFrom0", "10:00");
    check("unvollständige Unterbrechung wird gemeldet", (await page.textContent("#dayFeedbackText")).includes("beide Zeiten"));
    await page.fill("#gTo0", "09:50");
    check("Rückkehr vor Weggehen wird gemeldet", (await page.textContent("#dayFeedbackText")).includes("Rückkehr"));
    await page.fill("#gTo0", "12:45");
    check("Überschneidung mit der Pause wird gemeldet", (await page.textContent("#dayFeedbackText")).includes("überschneiden"));
    await page.fill("#gTo0", "16:00");
    check("außerhalb der Arbeitszeit wird gemeldet", (await page.textContent("#dayFeedbackText")).includes("innerhalb der Arbeitszeit"));
    await page.click("#saveDay");
    let e = await readEntry(page);
    check("ungültige Unterbrechung wird nicht gespeichert", !e.gaps, e);
    await page.fill("#gTo0", "10:50");
    check("Vorschau Ist 7:10", (await page.textContent("#pIst")).trim() === "7:10", await page.textContent("#pIst"));
    await page.click("#addGap");
    await page.fill("#gFrom1", "08:00"); await page.fill("#gTo1", "08:15");
    await page.click("#saveDay");
    e = await readEntry(page);
    check("zwei Unterbrechungen gespeichert, zeitlich sortiert",
      JSON.stringify(e.gaps) === '[{"from":"08:00","to":"08:15"},{"from":"10:00","to":"10:50"}]', e);

    await page.click(".day.today");
    check("Editor zeigt beide Zeilen wieder", (await page.locator(".gaprow").count()) === 2 && (await page.inputValue("#gFrom1")) === "10:00");
    await page.click('.gDel[data-i="0"]');
    await page.click("#saveDay");
    e = await readEntry(page);
    check("eine Unterbrechung entfernt", e.gaps.length === 1 && e.gaps[0].from === "10:00", e);

    await page.evaluate(() => { buildReport(); });
    const rep = await page.evaluate(() => document.body.innerHTML);
    check("Monatsbericht nennt die Unterbrechung", rep.includes("weg 10:00–10:50"));
    await ctx.close();
  }

  console.log("\n5) Layout bei 320 / 360 / 384 px");
  for (const w of [320, 360, 384]) {
    const { ctx, page } = await openApp(browser, { viewport: { width: w, height: 800 }, clockTime: at(18, 0), entries: {
      [K]: { type: "work", start: "07:04", bStart: "09:03", bEnd: "09:33", end: "16:10", note: "",
             gaps: [{ from: "11:32", to: "12:40" }] } } });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(w + " px: kein seitliches Überlaufen", over <= 0, over);
    const btn = await page.locator('[data-act="return"]').boundingBox();
    check(w + " px: WIEDER KOMMEN sichtbar und groß genug", btn && btn.height >= 44 && btn.x >= 0 && btn.x + btn.width <= w, btn);
    await page.click('[data-act="edit"]');
    const del = await page.locator(".gDel").boundingBox();
    check(w + " px: Editorzeile passt in die Breite", del && del.x + del.width <= w, del);
    await page.screenshot({ path: "./output/return-editor-" + w + ".png" });
    await page.click("#cancelDay");
    await page.screenshot({ path: "./output/return-card-" + w + ".png" });
    await ctx.close();
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
