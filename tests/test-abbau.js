/* Ganzer Tag Überstundenabbau: echte Berechnung, Editor und Monatsbericht. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('OK ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 800 } });
    await ctx.clock.install({ time: new Date('2026-10-15T15:00:00+02:00') });
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const calls = [];
    await ctx.route('**/*', async route => {
      const request = route.request();
      if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: html });
      if (request.url().endsWith('/heartbeat')) {
        calls.push(JSON.parse(request.postData()));
        return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.abort();
    });
    await ctx.addInitScript(() => localStorage.setItem('zeitkonto_seen_version', '999'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(1500);
    await page.goto('http://localhost:8123/index.html');
    async function seed(entries = {}) {
      calls.length = 0;
      await page.evaluate(entries => {
        state = migrate({ settings: {}, entries });
        saveState(); hideSheets(); view = new Date(2026, 9, 1); render();
        savePushState({ enabled: false, endpoint: null });
      }, entries);
    }

    await test('Ganzer freier Donnerstag zieht 7:30 vom Guthaben ab', async () => {
      await seed({ '2026-10-15': { type: 'abbau', note: 'Wenig Aufträge' } });
      const result = await page.evaluate(() => ({
        ist: dayIst(parseYmd('2026-10-15'), state.entries['2026-10-15']),
        saldo: aggregate(monthKeys(2026, 9)).saldo,
        count: aggregate(monthKeys(2026, 9)).count,
        urlaub: countTypeInYear('urlaub', 2026)
      }));
      assert.deepEqual(result, { ist: 0, saldo: -450, count: 1, urlaub: 0 });
    });
    await test('Freitag zieht nur das Freitagssoll ab, Samstag nichts', async () => {
      await seed({ '2026-10-16': { type: 'abbau' }, '2026-10-17': { type: 'abbau' } });
      assert.deepEqual(await page.evaluate(() => [
        dayDiff(parseYmd('2026-10-16'), state.entries['2026-10-16']),
        dayDiff(parseYmd('2026-10-17'), state.entries['2026-10-17'])
      ]), [-300, 0]);
    });
    await test('20 Stunden Guthaben werden zu 12:30, andere Abwesenheiten bleiben neutral', async () => {
      await seed({
        '2026-10-12': { type: 'work', start: '00:00', end: '17:30' },
        '2026-10-13': { type: 'work', start: '00:00', end: '17:30' },
        '2026-10-14': { type: 'urlaub' }, '2026-10-15': { type: 'abbau' },
        '2026-10-16': { type: 'krank' }, '2026-10-19': { type: 'feiertag' }
      });
      assert.equal(await page.locator('#totalSaldo').textContent(), '+12:30');
      assert.equal(await page.evaluate(() => countTypeInYear('urlaub', 2026)), 1);
    });
    await test('Editor speichert ohne Arbeitszeiten und behält Notiz nach erneutem Laden', async () => {
      await seed();
      await page.evaluate(() => openDay('2026-10-15'));
      const choice = page.getByRole('button', { name: 'Überstundenabbau', exact: true });
      assert.equal(await choice.count(), 1, 'Tagestyp fehlt');
      await choice.click();
      assert.equal(await page.locator('#workFields').isVisible(), false);
      assert.equal(await page.locator('#pIst').textContent(), '0:00');
      assert.equal(await page.locator('#pSoll').textContent(), '7:30');
      assert.equal(await page.locator('#pDiff').textContent(), '−7:30');
      await page.locator('#fNote').fill('Wenig Aufträge');
      await page.locator('#saveDay').click();
      assert.deepEqual(await page.evaluate(() => state.entries['2026-10-15']), { type: 'abbau', note: 'Wenig Aufträge' });
      await page.reload();
      assert.deepEqual(await page.evaluate(() => state.entries['2026-10-15']), { type: 'abbau', note: 'Wenig Aufträge' });
      await page.evaluate(() => openDay('2026-10-15'));
      assert.equal(await page.locator('#pDiff').textContent(), '−7:30');
      assert.equal(await page.locator('#fNote').inputValue(), 'Wenig Aufträge');
    });
    await test('Heute, Tageszeile und Bericht zeigen Abbau mit korrekter Bilanz', async () => {
      await seed({ '2026-10-15': { type: 'abbau', note: 'Wenig Aufträge' } });
      const today = await page.locator('#stampWrap').textContent();
      assert.match(today, /Überstundenabbau/);
      assert.match(today, /−7:30/);
      assert.doesNotMatch(today, /gutgeschrieben|KOMMEN/);
      const row = page.locator('.day.today');
      assert.match(await row.textContent(), /Überstundenabbau/);
      assert.equal(await row.locator('.diff').textContent(), '−7:30');
      await page.evaluate(() => buildReport());
      const cells = await page.locator('#report tbody tr').filter({ hasText: '15.10.' }).locator('td').allTextContents();
      assert.deepEqual(cells.slice(1), ['Überstundenabbau', '0:00', '7:30', '−7:30']);
      assert.equal(await page.locator('#monthSaldo').textContent(), '−7:30');
    });
    await test('Abbau beendet die heutigen Erinnerungen; Löschen stellt den offenen Status wieder her', async () => {
      await seed({ '2026-10-15': { type: 'abbau' } });
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/heartbeat')),
        page.evaluate(() => {
          savePushState({ enabled: true, endpoint: 'https://example.invalid/test' });
          pushHeartbeat();
        })
      ]);
      assert.equal(calls.at(-1).logged, true);
      assert.deepEqual(calls.at(-1).status, { hasStart: true, hasBreak: true, hasEnd: true });
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/heartbeat')),
        page.evaluate(() => { openDay('2026-10-15'); $('delDay').onclick(); })
      ]);
      assert.equal(calls.at(-1).logged, false);
      assert.equal(await page.locator('#totalSaldo').textContent(), '+0:00');
    });
    await test('Typauswahl und Tageszeile passen auf schmale Handys', async () => {
      await seed({ '2026-10-15': { type: 'abbau' } });
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => openDay('2026-10-15'));
        const choice = page.getByRole('button', { name: 'Überstundenabbau', exact: true });
        assert.equal(await choice.count(), 1);
        assert.equal(await choice.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => hideSheets());
        assert.equal(await page.locator('.day.today .daytimes').evaluate(element => element.scrollWidth <= element.clientWidth), true);
      }
    });
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
