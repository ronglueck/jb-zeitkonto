/* E2E-Test der Erinnerungs-Einstellungen und des Heartbeats */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const OUT = "./output";
const WORKER = "https://zeitkonto-push.h1n15r15.workers.dev";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/TEST-ENDPOINT";

const pad = n => String(n).padStart(2, "0");
const d0 = new Date();
const today = d0.getFullYear() + "-" + pad(d0.getMonth() + 1) + "-" + pad(d0.getDate());
const dayBefore = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

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
  const calls = [];
  // Worker-Aufrufe abfangen, damit der Test nichts nach draußen schickt
  await ctx.route(WORKER + "/**", async route => {
    let body = null;
    try { body = JSON.parse(route.request().postData() || "null"); } catch (e) {}
    calls.push({ url: route.request().url(), body });
    await route.fulfill({ status: opts.workerStatus || 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
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

const readSettings = page => page.evaluate(() => JSON.parse(localStorage.getItem("stundenbuch_v1")).settings);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---------- 11) Erinnerungszeiten in den Einstellungen ----------
  console.log("\n11) Erinnerungszeiten sind sichtbar und voreingestellt");
  {
    const { ctx, page } = await openApp(browser, {});
    await page.click("#settingsBtn");
    await page.waitForTimeout(250);
    check("Erinnerungsbereich sichtbar", await page.isVisible("#pushSection"));
    check("Beginn 07:45 vorbelegt", await page.inputValue("#rStart") === "07:45", await page.inputValue("#rStart"));
    check("Pausen-Erinnerung entfällt (feste Pause)", (await page.locator("#rPause").count()) === 0);
    check("Feierabend 15:45 vorbelegt", await page.inputValue("#rEnd") === "15:45");
    check("Tagescheck 20:00 vorbelegt", await page.inputValue("#rDay") === "20:00");
    check("Testknopf vorhanden", await page.isVisible("#testPushBtn"));
    await page.screenshot({ path: OUT + "/settings-reminders.png", fullPage: true });
    await ctx.close();
  }

  // ---------- 12) Zeiten ändern und speichern ----------
  console.log("\n12) Geänderte Zeiten werden gespeichert");
  {
    const { ctx, page, calls } = await openApp(browser, { push: { enabled: true, endpoint: ENDPOINT } });
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.fill("#rStart", "06:20");
    await page.click("#saveSet");
    await page.waitForTimeout(300);
    const st = await readSettings(page);
    check("Beginn gespeichert", st.reminders.start === "06:20", st.reminders);
    check("Pause bleibt abgeschaltet", st.reminders.pause === "", st.reminders);
    check("übrige Zeiten unverändert", st.reminders.end === "15:45" && st.reminders.day === "20:00", st.reminders);
    const hb = calls.filter(c => c.url.endsWith("/heartbeat")).pop();
    check("Heartbeat meldet die neue Startzeit", hb && hb.body.times.start === "06:20", hb && hb.body.times);
    check("Heartbeat meldet keine Pausenzeit", hb && hb.body.times.pause === "", hb && hb.body.times);
    await ctx.close();
  }

  // ---------- 13) Heartbeat meldet den Tagesstatus ----------
  console.log("\n13) Heartbeat meldet Beginn/Pause/Ende");
  {
    const { ctx, page, calls } = await openApp(browser, {
      push: { enabled: true, endpoint: ENDPOINT },
      entries: { [today]: { type: "work", start: "07:30", bStart: "12:30", bEnd: "13:00", end: "", note: "" } }
    });
    await page.waitForTimeout(300);
    const hb = calls.filter(c => c.url.endsWith("/heartbeat"))[0];
    check("Heartbeat gesendet", !!hb);
    check("hasStart true", hb && hb.body.status.hasStart === true, hb && hb.body.status);
    check("hasBreak true", hb && hb.body.status.hasBreak === true, hb && hb.body.status);
    check("hasEnd false", hb && hb.body.status.hasEnd === false, hb && hb.body.status);
    check("logged false (Ende fehlt)", hb && hb.body.logged === false, hb && hb.body.logged);
    check("Arbeitstage Mo–Fr", hb && JSON.stringify(hb.body.workdays) === "[1,2,3,4,5]", hb && hb.body.workdays);

    // Feierabend stempeln -> neuer Heartbeat mit hasEnd
    await page.click('[data-act="end"]');
    await page.waitForTimeout(300);
    const hb2 = calls.filter(c => c.url.endsWith("/heartbeat")).pop();
    check("nach Feierabend: hasEnd true", hb2 && hb2.body.status.hasEnd === true, hb2 && hb2.body.status);
    const eAfter = await page.evaluate(k => JSON.parse(localStorage.getItem("stundenbuch_v1")).entries[k], today);
    check("vorhandene Pause 12:30–13:00 unverändert", eAfter.bStart === "12:30" && eAfter.bEnd === "13:00", eAfter);
    check("nach Feierabend: logged true", hb2 && hb2.body.logged === true, hb2 && hb2.body.logged);
    await ctx.close();
  }

  // ---------- 14) Urlaub gilt als erledigt ----------
  console.log("\n14) Markierter Tag meldet sich als erledigt");
  {
    const { ctx, page, calls } = await openApp(browser, {
      push: { enabled: true, endpoint: ENDPOINT },
      entries: { [today]: { type: "urlaub", note: "" } }
    });
    await page.waitForTimeout(300);
    const hb = calls.filter(c => c.url.endsWith("/heartbeat"))[0];
    check("alle Schritte erledigt", hb && hb.body.status.hasStart && hb.body.status.hasBreak && hb.body.status.hasEnd,
      hb && hb.body.status);
    check("logged true", hb && hb.body.logged === true);
    await ctx.close();
  }

  // ---------- 15) Test-Benachrichtigung ----------
  console.log("\n15) Test-Benachrichtigung");
  {
    const { ctx, page } = await openApp(browser, {});   // ohne Abo
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.click("#testPushBtn");
    await page.waitForTimeout(200);
    check("Hinweis ohne Abo", (await page.textContent("#toast")).includes("zuerst einschalten"),
      await page.textContent("#toast"));
    await ctx.close();
  }
  {
    const { ctx, page, calls } = await openApp(browser, { push: { enabled: true, endpoint: ENDPOINT } });
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.click("#testPushBtn");
    await page.waitForTimeout(400);
    const tp = calls.filter(c => c.url.endsWith("/testpush"))[0];
    check("Testpush wird angefordert", !!tp && tp.body.endpoint === ENDPOINT, tp && tp.body);
    check("Rückmeldung an die Nutzerin", (await page.textContent("#toast")).length > 0, await page.textContent("#toast"));
    await ctx.close();
  }
  {
    const { ctx, page } = await openApp(browser, { push: { enabled: true, endpoint: ENDPOINT }, workerStatus: 429 });
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.click("#testPushBtn");
    await page.waitForTimeout(400);
    check("Bremse wird verständlich gemeldet", (await page.textContent("#toast")).includes("warten"),
      await page.textContent("#toast"));
    await ctx.close();
  }

  // ---------- 16) Alte Sicherung ohne Erinnerungszeiten ----------
  console.log("\n16) Alte Sicherung bekommt die Voreinstellungen");
  {
    const alt = { settings: { employer: "Alt", soll: { 1: 450, 2: 450, 3: 450, 4: 450, 5: 300, 6: 0, 7: 0 }, urlaubsanspruch: 25 },
                  entries: { "2026-08-03": { start: "07:30", bStart: "", bEnd: "", end: "15:30", note: "" } } };
    const { ctx, page } = await openApp(browser, { rawState: alt });
    // migrate() arbeitet im Speicher; localStorage zieht erst beim naechsten Speichern nach
    const st = await page.evaluate(() => state.settings);
    check("reminders ergänzt", st.reminders && st.reminders.start === "07:45", st.reminders);
    check("alte Werte erhalten", st.employer === "Alt" && st.urlaubsanspruch === 25, st);
    const e = await page.evaluate(() => state.entries["2026-08-03"]);
    check("Eintrag ohne type wird zu work", e.type === "work", e);
    // ... und nach dem naechsten Speichern steht es auch in der Sicherung
    await page.click("#settingsBtn");
    await page.waitForTimeout(200);
    await page.click("#saveSet");
    await page.waitForTimeout(200);
    const persisted = await readSettings(page);
    check("nach dem Speichern persistiert", persisted.reminders && persisted.reminders.start === "07:45", persisted.reminders);
    await ctx.close();
  }

  // ---------- 17) Einstellungen bleiben auf 320 px bedienbar ----------
  console.log("\n17) Einstellungen bei 320 px");
  {
    const { ctx, page } = await openApp(browser, { viewport: { width: 320, height: 800 } });
    await page.click("#settingsBtn");
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => {
      const el = document.querySelector("#setSheet");
      return { sheet: el.scrollWidth > el.clientWidth + 1, body: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    check("kein horizontaler Überlauf", !over.sheet && !over.body, over);
    const b = await page.locator("#rStart").boundingBox();
    check("Zeitfeld groß genug", b && b.width >= 120 && b.height >= 40, b);
    await ctx.close();
  }

  // ---------- 18) Eigene Feierabend-Zeit für Freitag ----------
  console.log("\n18) Feierabend-Zeit für Freitag");
  {
    const { ctx, page, calls } = await openApp(browser, { push: { enabled: true, endpoint: ENDPOINT } });
    await page.click("#settingsBtn");
    await page.waitForTimeout(250);
    check("Feld für Freitag vorhanden", await page.isVisible("#rEndFri"));
    check("Freitagsfeld ist leer voreingestellt", await page.inputValue("#rEndFri") === "",
      await page.inputValue("#rEndFri"));
    check("Mo–Do-Feld beschriftet", (await page.textContent("#pushSection")).includes("Feierabend Mo"));
    await page.fill("#rEndFri", "12:10");
    await page.click("#saveSet");
    await page.waitForTimeout(300);
    const st = await readSettings(page);
    check("Freitagszeit gespeichert", st.reminders.endFri === "12:10", st.reminders);
    check("Mo–Do-Zeit unverändert", st.reminders.end === "15:45", st.reminders);
    const hb = calls.filter(c => c.url.endsWith("/heartbeat")).pop();
    check("Heartbeat meldet endFri", hb && hb.body.times.endFri === "12:10", hb && hb.body.times);
    await ctx.close();
  }

  // ---------- 19) Vorbelegung aus der Historie ----------
  console.log("\n19) Vorbelegung: wie zuletzt gestempelt");
  {
    const sameDow = dayBefore(7);    // gleicher Wochentag
    const otherDow = dayBefore(3);   // anderer Wochentag, jünger
    const { ctx, page } = await openApp(browser, {
      entries: {
        [sameDow]:  { type: "work", start: "06:15", bStart: "11:00", bEnd: "11:30", end: "16:40", note: "alt" },
        [otherDow]: { type: "work", start: "09:00", bStart: "", bEnd: "", end: "14:00", note: "" }
      }
    });
    await page.click('[data-act="edit"]');
    await page.waitForTimeout(250);
    check("Beginn vom letzten gleichen Wochentag", await page.inputValue("#fStart") === "06:15",
      await page.inputValue("#fStart"));
    check("Ende vom letzten gleichen Wochentag", await page.inputValue("#fEnd") === "16:40");
    check("Pause übernommen", await page.inputValue("#fBStart") === "11:00" && await page.inputValue("#fBEnd") === "11:30");
    check("Notiz wird NICHT übernommen", await page.inputValue("#fNote") === "", await page.inputValue("#fNote"));
    await page.click("#cancelDay");
    await ctx.close();
  }
  {
    // Nur ein anderer Wochentag vorhanden -> der zählt als Rückfallebene
    const otherDow = dayBefore(3);
    const { ctx, page } = await openApp(browser, {
      entries: { [otherDow]: { type: "work", start: "09:00", bStart: "", bEnd: "", end: "14:00", note: "" } }
    });
    await page.click('[data-act="edit"]');
    await page.waitForTimeout(250);
    check("greift auf anderen Wochentag zurück", await page.inputValue("#fStart") === "09:00",
      await page.inputValue("#fStart"));
    await ctx.close();
  }
  {
    // Gar keine Historie -> eingebauter Standard wie bisher
    const { ctx, page } = await openApp(browser, { entries: {} });
    await page.click('[data-act="edit"]');
    await page.waitForTimeout(250);
    const v = await page.inputValue("#fStart");
    check("ohne Historie: eingebauter Standard", v === "07:30" || v === "", v);
    await ctx.close();
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
