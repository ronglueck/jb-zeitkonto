/* E2E-Test "Aussehen" (Themes) — playwright-core + Edge */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8123/index.html";
const at = (h, m) => new Date(2026, 10, 13, h, m, 0);     // Freitag, 13.11.2026
const THEMES = ["klassisch", "ruhig", "nacht", "kraeftig", "weihnachten", "neujahr"];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

const ENTRIES = {
  "2026-11-09": { type: "work", start: "07:02", bStart: "12:30", bEnd: "13:00", end: "15:34", note: "" },
  "2026-11-10": { type: "work", start: "07:05", bStart: "12:30", bEnd: "13:00", end: "15:30", note: "" },
  "2026-11-11": { type: "work", start: "07:04", bStart: "12:30", bEnd: "13:00", end: "13:40", note: "Arzttermin" },
  "2026-11-12": { type: "urlaub", note: "" },
  "2026-11-13": { type: "work", start: "07:04", bStart: "", bEnd: "", end: "", note: "", gaps: [{ from: "11:32", to: "12:40" }] }
};

async function openApp(browser, theme, width, when, extra) {
  const ctx = await browser.newContext({ viewport: { width: width || 384, height: 800 } });
  await ctx.clock.install({ time: when || at(14, 0) });
  const st = { settings: { employer: "Testfirma", soll: { 1: 420, 2: 420, 3: 420, 4: 420, 5: 420, 6: 0, 7: 0 },
                           urlaubsanspruch: 30, showWeekend: false, showTotalSaldo: true }, entries: ENTRIES };
  if (theme) st.settings.theme = theme;
  Object.assign(st.settings, extra || {});
  await ctx.addInitScript(([s]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("stundenbuch_v1", JSON.stringify(s));
      localStorage.setItem("zeitkonto_seen_version", "99");
      sessionStorage.setItem("seeded", "1");
    }
  }, [st]);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("  FAIL JS-Fehler: " + e.message); });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#stampWrap .stamp");
  return { ctx, page };
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Kontrast (WCAG) zwischen Textfarbe und der ersten deckenden Hintergrundfarbe darunter
const contrast = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s); if (!el) return null;
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  let bg = null;
  for (let n = el; n && !bg; n = n.parentElement) {
    const c = rgb(getComputedStyle(n).backgroundColor);
    if (c.length >= 3 && (c.length === 3 || c[3] === 1)) bg = c;
  }
  bg = bg || [255, 255, 255];
  const a = lum(rgb(getComputedStyle(el).color)), b = lum(bg);
  return Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100;
}, sel);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  console.log("\n1) Umschalten in den Einstellungen");
  {
    const { ctx, page } = await openApp(browser);
    check("ohne Einstellung gilt Klassisch", await page.getAttribute("html", "data-theme") === "klassisch");
    await page.click("#settingsBtn");
    for (const t of ["nacht", "kraeftig", "ruhig"]) {
      await page.click('[data-theme-opt="' + t + '"]');
      check(t + ": wechselt sofort", await page.getAttribute("html", "data-theme") === t);
      check(t + ": Auswahl markiert", await page.getAttribute('[data-theme-opt="' + t + '"]', "aria-checked") === "true");
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stundenbuch_v1")).settings.theme);
    check("gespeichert ohne „Fertig“", saved === "ruhig", saved);
    await page.reload(); await page.waitForSelector("#stampWrap .stamp");
    check("bleibt nach Neuladen", await page.getAttribute("html", "data-theme") === "ruhig");
    check("Systemleiste folgt dem Aussehen", (await page.getAttribute('meta[name="theme-color"]', "content")) === "#F1F4EF");
    await ctx.close();
  }

  console.log("\n1b) Festtage");
  {
    const cases = [
      [new Date(2026, 10, 28, 9, 0), "ruhig", null, "Tag vor dem 1. Advent"],
      [new Date(2026, 10, 29, 9, 0), "weihnachten", "Schöne Adventszeit!", "1. Advent 2026"],
      [new Date(2026, 11, 24, 9, 0), "weihnachten", "Frohe Weihnachten!", "Heiligabend"],
      [new Date(2026, 11, 26, 9, 0), "weihnachten", "Frohe Weihnachten!", "2. Weihnachtstag"],
      [new Date(2026, 11, 27, 9, 0), "neujahr", "Guten Rutsch ins Jahr 2027!", "27. Dezember"],
      [new Date(2027, 0, 1, 9, 0), "neujahr", "Frohes neues Jahr 2027!", "Neujahr"],
      [new Date(2027, 0, 6, 9, 0), "neujahr", "Frohes neues Jahr 2027!", "6. Januar"],
      [new Date(2027, 0, 7, 9, 0), "ruhig", null, "7. Januar"],
      [new Date(2027, 10, 28, 9, 0), "weihnachten", "Schöne Adventszeit!", "1. Advent 2027 (28.11.)"]
    ];
    for (const [when, want, note, label] of cases) {
      const { ctx, page } = await openApp(browser, "ruhig", 384, when);
      const got = await page.getAttribute("html", "data-theme");
      check(label + ": " + want, got === want, got);
      const visible = await page.locator("#seasonNote").isVisible();
      const text = await page.textContent("#seasonNote");
      check(label + ": Gruß " + (note || "keiner"), note ? (visible && text === note) : !visible, text);
      await ctx.close();
    }
    {
      const { ctx, page } = await openApp(browser, "ruhig", 384, new Date(2026, 11, 10, 9, 0), { seasonal: false });
      check("Schalter aus: gewähltes Aussehen bleibt", await page.getAttribute("html", "data-theme") === "ruhig");
      await ctx.close();
    }
    {
      const { ctx, page } = await openApp(browser, "ruhig", 384, new Date(2026, 11, 10, 9, 0));
      await page.click("#settingsBtn");
      check("Schalter steht anfangs auf an", await page.isChecked("#seasonToggle"));
      await page.click('[data-theme-opt="nacht"]');
      check("ausdrückliche Wahl in der Adventszeit gewinnt", await page.getAttribute("html", "data-theme") === "nacht");
      await page.reload(); await page.waitForSelector("#stampWrap .stamp");
      check("… und bleibt nach Neuladen", await page.getAttribute("html", "data-theme") === "nacht");
      await ctx.clock.setSystemTime(new Date(2026, 11, 28, 9, 0));
      await page.reload(); await page.waitForSelector("#stampWrap .stamp");
      check("die nächste Saison (Neujahr) greift wieder von selbst", await page.getAttribute("html", "data-theme") === "neujahr");
      await page.click("#settingsBtn");
      await page.evaluate(() => document.getElementById("seasonToggle").click());
      check("Schalter aus stellt das gewählte Aussehen her", await page.getAttribute("html", "data-theme") === "nacht");
      await ctx.close();
    }
  }

  for (const t of THEMES) {
    console.log("\n2) " + t + ": Layout und Lesbarkeit");
    for (const w of [320, 360, 384]) {
      const { ctx, page } = await openApp(browser, t, w);
      check(w + " px: kein seitliches Überlaufen", (await overflow(page)) <= 0, await overflow(page));
      const btn = await page.locator('[data-act="end"]').boundingBox();
      check(w + " px: FEIERABEND passt und ist groß genug", btn && btn.height >= 44 && btn.x >= 0 && btn.x + btn.width <= w, btn);
      const last = await page.locator(".bottom .cell").last().boundingBox();
      check(w + " px: Fußzeile passt", last && last.x + last.width <= w, last);
      const art = await page.evaluate(async () => {
        const img = document.querySelector(".stamp-art");
        if (!img) return null;
        if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; });
        return img.naturalWidth;
      });
      const wantArt = ["ruhig", "kraeftig", "weihnachten", "neujahr"].includes(t);
      check(w + " px: Motiv in der Heute-Karte " + (wantArt ? "geladen" : "nicht vorhanden"), wantArt ? art > 0 : art === null, art);
      const orn = await page.locator(".orn").first().isVisible();
      check(w + " px: Weihnachtskugeln " + (t === "weihnachten" ? "sichtbar" : "ausgeblendet"), orn === (t === "weihnachten"));
      if (t === "weihnachten") {
        const hit = await page.evaluate(() => {
          const lab = document.querySelector(".monthbar .label .m").getBoundingClientRect();
          const span = document.createRange(); span.selectNodeContents(document.querySelector(".monthbar .label .m"));
          const txt = span.getBoundingClientRect();
          return [...document.querySelectorAll(".orn")].some(o => { const r = o.getBoundingClientRect(); return r.right > txt.left && r.left < txt.right; });
        });
        check(w + " px: Kugeln verdecken den Monatsnamen nicht", !hit);
      }
      if (w === 384) {
        // Klassisch bleibt unverändert; die Kontrastprüfung gilt den neuen Looks
        if (t !== "klassisch")
        for (const sel of [".stamp-state .big", ".stamp-state .sub", ".stamp-head .lbl", '[data-act="end"]', ".stamp-edit",
                           ".day .times", ".day .dom", ".diff.pos", ".diff.neg", ".badge.urlaub", ".week-sum .badge",
                           ".bottom .cell .k", ".bottom .cell .v", ".top h1", ".top .emp", ".monthbar .y"]) {
          const c = await contrast(page, sel);
          check("Kontrast " + sel + " ≥ 4,5", c !== null && c >= 4.5, c);
        }
        await page.screenshot({ path: "./output/theme-" + t + "-live.png" });
        await page.click(".day.today");
        await page.waitForTimeout(350);
        await page.screenshot({ path: "./output/theme-" + t + "-editor.png" });
        if (t !== "klassisch")
        for (const sel of ["#dayTitle", "#dayMeta", "#fStart", ".field > label", "#saveDay", "#cancelDay", ".typeseg .active-work"]) {
          const c = await contrast(page, sel);
          check("Editor-Kontrast " + sel + " ≥ 4,5", c !== null && c >= 4.5, c);
        }
        await page.click("#cancelDay");
        await page.evaluate(() => { stampNow("end"); });
        await page.waitForTimeout(350);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: "./output/theme-" + t + "-done.png" });
      }
      await ctx.close();
    }
  }

  await browser.close();
  console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ABBRUCH:", e); process.exit(2); });
