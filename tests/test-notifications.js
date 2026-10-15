/* Regressionen für blockierte Meldungstexte und die Gerätediagnose.
 * Läuft gegen den echten Service-Worker-Handler und die echte App-Oberfläche;
 * nur Geräte-APIs und ausgehende Netzwerkaufrufe werden ersetzt.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright-core');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('OK ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function serviceWorker({ fetchImpl, getSubscription = async () => ({ endpoint: 'https://example.invalid/test' }) }) {
  const handlers = {}, notifications = [], timers = new Map(), requests = [];
  let now = 0, nextId = 0;
  const context = vm.createContext({
    AbortController,
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, registration: {
      pushManager: { getSubscription },
      showNotification: async (title, options) => { notifications.push({ title, ...options }); }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), context);
  return {
    notifications, requests, timers,
    push() { let completion; handlers.push({ waitUntil: promise => { completion = promise; } }); return completion; },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
      await flush();
    }
  };
}

(async () => {
  for (const stall of ['fetch', 'body', 'subscription']) {
    await test('Hängende Abfrage (' + stall + ') zeigt nach fünf Sekunden eine neutrale Meldung', async () => {
      const sw = serviceWorker({
        getSubscription: stall === 'subscription' ? () => new Promise(() => {}) : undefined,
        fetchImpl: stall === 'fetch' ? () => new Promise(() => {})
          : async () => ({ ok: true, json: () => new Promise(() => {}) })
      });
      const completion = sw.push();
      await flush();
      await sw.advance(4999);
      assert.equal(sw.notifications.length, 0);
      await sw.advance(1);
      assert.equal(sw.notifications.length, 1, 'Die Benachrichtigung darf nicht auf die Serverantwort warten');
      await completion;
      assert.equal(sw.notifications[0].data.kind, 'unbekannt');
      assert.match(sw.notifications[0].body, /Zeiten prüfen/);
      assert.deepEqual(Array.from(sw.notifications[0].actions, action => action.action), ['open']);
      if (sw.requests.length) assert.equal(sw.requests[0].options.signal.aborted, true);
      assert.equal(sw.timers.size, 0);
    });
  }
  await test('Eine verspätete Antwort erzeugt nach der Ersatzmeldung keine zweite Benachrichtigung', async () => {
    let release;
    const sw = serviceWorker({ fetchImpl: () => new Promise(resolve => { release = resolve; }) });
    const completion = sw.push();
    await flush(); await sw.advance(5000);
    assert.equal(sw.notifications.length, 1);
    await completion;
    release({ ok: true, json: async () => ({ kind: 'end', done: false }) });
    await flush(); await sw.advance(60000);
    assert.equal(sw.notifications.length, 1);
    assert.equal(sw.notifications[0].data.kind, 'unbekannt');
  });
  for (const [label, fetchImpl, expected] of [
    ['aktueller Feierabend', async () => ({ ok: true, json: async () => ({ kind: 'end', done: false }) }), 'end'],
    ['bereits erfasster Tag', async () => ({ ok: true, json: async () => ({ kind: 'end', done: true }) }), 'done'],
    ['Netzfehler', async () => { throw new Error('offline'); }, 'unbekannt']
  ]) {
    await test('Schnelle Antwort bleibt korrekt: ' + label, async () => {
      const sw = serviceWorker({ fetchImpl });
      await sw.push();
      assert.equal(sw.notifications.length, 1);
      assert.equal(sw.notifications[0].data.kind, expected);
      assert.equal(sw.timers.size, 0);
      await sw.advance(10000);
      assert.equal(sw.notifications.length, 1);
    });
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 800 } });
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const requests = [];
    const pushRequests = () => requests.filter(request => request.url.startsWith('https://zeitkonto-push.h1n15r15.workers.dev/'));
    let serverStatus = 200;
    await ctx.route('**/*', route => {
      const request = route.request();
      if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: html });
      requests.push({ url: request.url(), body: request.postDataJSON() });
      return request.url().endsWith('/testpush')
        ? route.fulfill({ status: serverStatus, contentType: 'application/json', body: JSON.stringify({ ok: serverStatus === 200 }) })
        : route.abort();
    });
    await ctx.addInitScript(() => localStorage.setItem('zeitkonto_seen_version', '999'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(1500);
    await page.goto('http://localhost:8123/index.html');
    await page.evaluate(() => { window.testNotificationAPI = window.Notification; });
    async function prepare({ permission = 'granted', registered = true, fails = false, supported = true } = {}) {
      requests.length = 0;
      await page.evaluate(({ permission, registered, fails, supported }) => {
        window.Notification = supported ? testNotificationAPI : undefined;
        if (supported) Object.defineProperty(Notification, 'permission', { configurable: true, value: permission });
        window.localNotifications = [];
        Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => registered ? {
          active: { state: 'activated' },
          showNotification: async (title, options) => {
            if (fails) throw new Error('device rejected notification');
            localNotifications.push({ title, options });
          }
        } : undefined });
        savePushState({ enabled: false, endpoint: null });
        hideSheets(); openSettings();
      }, { permission, registered, fails, supported });
    }
    async function localButton() {
      const button = page.getByRole('button', { name: 'Anzeige auf diesem Gerät testen', exact: true });
      assert.equal(await button.count(), 1, 'Der direkte Anzeigetest fehlt');
      return button;
    }
    await test('Direkter Test zeigt die lokale Meldung ohne Abo oder Serveraufruf', async () => {
      await prepare();
      await (await localButton()).click();
      await page.waitForFunction(() => document.getElementById('pushTestResult')?.textContent.includes('Anzeigetest ausgelöst'));
      const shown = await page.evaluate(() => localNotifications);
      assert.equal(shown.length, 1);
      assert.match(shown[0].options.body, /Lokaler Test/);
      assert.equal(shown[0].options.data.kind, 'local-test');
      assert.equal(pushRequests().length, 0, 'Ein direkter Anzeigetest darf keinen Erinnerungsserver benötigen');
      assert.equal(await page.evaluate(() => loadPushState().enabled), false);
      await page.waitForTimeout(1800);
      assert.equal(await page.locator('#pushTestResult').isVisible(), true, 'Diagnose muss nach dem Toast lesbar bleiben');
    });
    for (const [name, options, message] of [
      ['verweigerte Erlaubnis', { permission: 'denied' }, /blockiert/],
      ['noch nicht erteilte Erlaubnis', { permission: 'default' }, /zuerst.*Erinnerungen/i],
      ['fehlende Registrierung', { registered: false }, /neu.*öffnen|neu laden/i],
      ['nicht unterstützter Browser', { supported: false }, /Home-Bildschirm/],
      ['Anzeige vom Gerät abgelehnt', { fails: true }, /nicht.*angezeigt/i]
    ]) {
      await test('Direkter Test erklärt ' + name, async () => {
        await prepare(options);
        await (await localButton()).click();
        assert.match(await page.locator('#pushTestResult').textContent(), message);
        assert.equal(await page.evaluate(() => localNotifications.length), 0);
        assert.equal(pushRequests().length, 0);
      });
    }
    for (const [status, message] of [[200, /An Push-Dienst übergeben/], [429, /erneut/], [410, /abgelaufen/], [502, /fehlgeschlagen/]]) {
      await test('Servertest meldet Status ' + status + ' ohne Zustellung zu versprechen', async () => {
        await prepare(); serverStatus = status;
        await page.evaluate(async () => {
          savePushState({ enabled: true, endpoint: 'https://example.invalid/test' });
          await pushTest();
        });
        const feedback = page.locator('#pushTestResult');
        assert.equal(await feedback.count(), 1, 'Bleibendes Testergebnis fehlt');
        const text = await feedback.textContent();
        assert.match(text, message);
        assert.doesNotMatch(text, /kommt gleich|erfolgreich zugestellt/i);
        assert.equal(requests.filter(request => request.url.endsWith('/testpush')).length, 1);
      });
    }
    await test('Beide Diagnoseknöpfe und lange Ergebnisse passen auf schmale Handys', async () => {
      await prepare();
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await (await localButton()).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('#pushSection').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        await page.locator('#testPushBtn').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#testPushBtn').isVisible(), true);
      }
    });
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
