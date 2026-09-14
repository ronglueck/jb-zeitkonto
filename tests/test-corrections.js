/* Regressionen: Tageskorrekturen und bestaetigte Push-Anmeldung.
 * Alle Browseranfragen werden lokal beantwortet; keine echten Abos/Zeiten.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { pathToFileURL } = require('node:url');
let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('OK ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const entry = (extra = {}) => ({type:'work',start:'07:00',end:'15:00',bStart:'12:30',bEnd:'13:00',note:'',...extra});

(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const ctx = await browser.newContext({serviceWorkers:'block', viewport:{width:320,height:800}});
    await ctx.clock.install({time:new Date('2026-09-14T15:00:00+02:00')});
    const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    await ctx.route('**/*', r => r.request().resourceType() === 'document'
      ? r.fulfill({contentType:'text/html',body:html}) : r.abort());
    await ctx.addInitScript(() => localStorage.setItem('zeitkonto_seen_version','999'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(1500);
    await page.goto('http://localhost:8123/index.html');
    async function seed(entries) {
      await page.evaluate(entries => {
        state = migrate({settings:{soll:{1:420,2:420,3:420,4:420,5:420,6:0,7:0}},entries});
        saveState(); hideSheets(); render();
      }, entries);
    }
    for (const [name, bStart, bEnd] of [
      ['rueckwaerts','13:00','12:30'], ['ausserhalb','06:00','06:30'],
      ['nach Feierabend','15:00','15:30'], ['unvollstaendig','12:30','']
    ]) {
      await test('Pause ' + name + ' wird blockiert und markiert', async () => {
        const original = entry(); await seed({'2026-07-14':original});
        await page.evaluate(({bStart,bEnd}) => {
          openDay('2026-07-14'); $('fBStart').value=bStart; $('fBEnd').value=bEnd; $('saveDay').onclick();
        }, {bStart,bEnd});
        assert.deepEqual(await page.evaluate(()=>state.entries['2026-07-14']), original);
        assert.ok(await page.locator('#daySheet [aria-invalid="true"]').count());
        assert.equal(await page.locator('#dayFeedback').isVisible(),true);
        assert.equal(await page.locator('#pIst').textContent(),'—');
      });
    }
    await test('Nachgetragenes Ende bietet feste Pause vor dem Speichern an', async () => {
      await seed({'2026-07-14':entry({end:'',bStart:'',bEnd:''})});
      await page.evaluate(()=>{openDay('2026-07-14');$('fEnd').value='15:00';$('saveDay').onclick();});
      assert.equal(await page.evaluate(()=>state.entries['2026-07-14'].end),'');
      assert.equal(await page.locator('#applyFixedBreak').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await ctx.clock.runFor(350);
      await page.locator('#dayFeedback').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#daySheet > .actions .btn').evaluateAll(buttons=>buttons.every(b=>{
        const rect=b.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth;
      })),true);
      await page.screenshot({path:path.join(__dirname,'output/correction-pause-320.png')});
      await page.locator('#applyFixedBreak').click();
      await page.locator('#saveDay').click();
      assert.equal(await page.evaluate(()=>netMin(state.entries['2026-07-14'])),450);
      assert.equal(await page.evaluate(()=>state.entries['2026-07-14'].bStart),'12:30');
    });
    await test('Bewusst ohne Pause ist ausdruecklich speicherbar', async () => {
      await seed({'2026-07-14':entry({bStart:'',bEnd:''})});
      await page.evaluate(()=>{openDay('2026-07-14');$('saveDay').onclick();});
      await page.locator('#saveWithoutBreak').click();
      assert.equal(await page.evaluate(()=>netMin(state.entries['2026-07-14'])),480);
      assert.equal(await page.locator('#daySheet').getAttribute('aria-hidden'),'true');
    });
    await test('Korrektur Juli aktualisiert Gesamt, August bleibt erhalten', async () => {
      const august = entry({note:'bleibt'});
      await seed({'2026-07-14':entry(),'2026-08-03':august});
      await page.evaluate(()=>{openDay('2026-07-14');$('fEnd').value='14:30';$('saveDay').onclick();});
      assert.equal(await page.evaluate(()=>aggregate(Object.keys(state.entries)).saldo),30);
      assert.equal(await page.evaluate(()=>aggregate(monthKeys(2026,6)).saldo),0);
      assert.deepEqual(await page.evaluate(()=>state.entries['2026-08-03']),august);
      assert.match(await page.locator('#toast').textContent(),/−0:30/);
    });
    await test('Abweichende gueltige Pause bleibt erhalten', async () => {
      await seed({'2026-07-14':entry({bStart:'10:00',bEnd:'10:20'})});
      await page.evaluate(()=>{openDay('2026-07-14');$('fEnd').value='14:30';$('saveDay').onclick();});
      assert.equal(await page.evaluate(()=>netMin(state.entries['2026-07-14'])),430);
    });
    await test('Loeschen meldet heutigen Status an den Erinnerungsdienst', async () => {
      await seed({'2026-09-14':entry()});
      const calls = await page.evaluate(()=>{
        window.reviewCalls=[];
        window.fetch=async(url,opts)=>{reviewCalls.push({url,body:JSON.parse(opts.body)});return new Response('{"ok":true}')};
        savePushState({enabled:true,endpoint:'https://example.invalid/test'});
        openDay('2026-09-14');$('delDay').onclick();return reviewCalls;
      });
      assert.equal(calls.length,1); assert.equal(calls[0].body.logged,false);
    });
    for (const mode of ['network','http','success']) {
      await test('Push-Anmeldung: ' + mode, async () => {
        const result = await page.evaluate(async mode => {
          savePushState({enabled:false,endpoint:null});
          window.cancelledSubscription=false;
          Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=> 'granted'});
          Object.defineProperty(navigator.serviceWorker,'ready',{configurable:true,value:Promise.resolve({pushManager:{
            getSubscription:async()=>null,
            subscribe:async()=>({endpoint:'https://example.invalid/test',unsubscribe:async()=>{cancelledSubscription=true;return true;},toJSON:()=>({endpoint:'https://example.invalid/test'})})
          }})});
          window.reviewCalls=[];
          window.fetch=async(url,opts)=>{
            reviewCalls.push({url,body:JSON.parse(opts.body)});
            if(mode==='network') throw new Error('offline');
            return new Response(JSON.stringify({ok:mode==='success'}),{status:mode==='http'?503:200});
          };
          await pushSubscribe();return {ps:loadPushState(),toast:$('toast').textContent,calls:reviewCalls,cancelled:cancelledSubscription};
        },mode);
        assert.equal(result.ps.enabled,mode==='success');
        if(mode!=='success') {
          assert.doesNotMatch(result.toast,/^Erinnerung aktiviert$/);
          assert.equal(result.cancelled,true,'Abo muss auch bei verlorener Serverantwort storniert werden');
        }
        else {
          const subscription = result.calls.find(c=>c.url.endsWith('/subscribe'));
          assert.equal(subscription.body.date,'2026-09-14');
          assert.deepEqual(subscription.body.status,{hasStart:false,hasBreak:false,hasEnd:false});
          assert.equal(subscription.body.logged,false);
        }
      });
    }
    await test('Browser-Abo mit altem Schluessel wird ersetzt', async () => {
      const result=await page.evaluate(async()=>{
        savePushState({enabled:false,endpoint:null});
        window.oldCancelled=false;window.newSubscribed=false;
        Object.defineProperty(navigator.serviceWorker,'ready',{configurable:true,value:Promise.resolve({pushManager:{
          getSubscription:async()=>({endpoint:'https://example.invalid/old',options:{applicationServerKey:new Uint8Array([1,2]).buffer},unsubscribe:async()=>{oldCancelled=true;return true;},toJSON:()=>({endpoint:'https://example.invalid/old'})}),
          subscribe:async()=>{newSubscribed=true;return {endpoint:'https://example.invalid/new',unsubscribe:async()=>true,toJSON:()=>({endpoint:'https://example.invalid/new'})};}
        }})});
        window.fetch=async()=>new Response('{"ok":true}');
        await pushSubscribe();return {oldCancelled,newSubscribed,ps:loadPushState()};
      });
      assert.equal(result.oldCancelled,true);assert.equal(result.newSubscribed,true);
      assert.equal(result.ps.endpoint,'https://example.invalid/new');
    });
    await test('Unklare Stornierung bleibt fuer Statusmeldungen erreichbar', async () => {
      const result=await page.evaluate(async()=>{
        savePushState({enabled:false,endpoint:null});
        Object.defineProperty(navigator.serviceWorker,'ready',{configurable:true,value:Promise.resolve({pushManager:{
          getSubscription:async()=>null,
          subscribe:async()=>({endpoint:'https://example.invalid/uncertain',unsubscribe:async()=>{throw new Error('offline')},toJSON:()=>({endpoint:'https://example.invalid/uncertain'})})
        }})});
        window.fetch=async()=>{throw new Error('lost response')};
        await pushSubscribe();return {ps:loadPushState(),toast:$('toast').textContent};
      });
      assert.equal(result.ps.endpoint,'https://example.invalid/uncertain');
      assert.equal(result.ps.enabled,true);
      assert.match(result.toast,/unklar/);
    });
    await ctx.close();
  } finally { await browser.close(); }
  const {default:worker,pendingInfo,dueKind} = await import(pathToFileURL(path.join(__dirname,'../worker/worker.js')));
  await test('Anmeldung uebernimmt einen bereits abgeschlossenen Tag', async () => {
    let record;
    const env={ALLOW_ORIGIN:'https://example.invalid',PUSH_KV:{put:async(k,v)=>{record=JSON.parse(v)}}};
    await worker.fetch(new Request('https://example.invalid/subscribe',{method:'POST',body:JSON.stringify({subscription:{endpoint:'https://example.invalid/test'},date:'2026-09-14',logged:true,status:{hasStart:true,hasBreak:true,hasEnd:true}})}),env,{});
    assert.equal(pendingInfo(record,{date:'2026-09-14'}).done,true);
    assert.equal(record.status.hasEnd,true);
  });
  await test('Geloeschter Tag ist im Worker wieder offen', async () => {
    let record={lastLogged:'2026-09-14',status:null,times:{day:'20:00'},sent:null};
    const env={ALLOW_ORIGIN:'https://example.invalid',PUSH_KV:{get:async()=>JSON.stringify(record),put:async(k,v)=>{record=JSON.parse(v)}}};
    await worker.fetch(new Request('https://example.invalid/heartbeat',{method:'POST',body:JSON.stringify({endpoint:'https://example.invalid/test',date:'2026-09-14',logged:false,status:{hasStart:false,hasBreak:false,hasEnd:false}})}),env,{});
    assert.equal(pendingInfo(record,{date:'2026-09-14'}).done,false);
    assert.equal(dueKind(record,{date:'2026-09-14',min:1200,isoWeekday:1}),'day');
  });
  console.log(`${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exitCode = failed ? 1 : 0;
})().catch(e=>{console.error(e);process.exitCode=1});
