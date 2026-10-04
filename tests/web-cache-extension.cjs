// SPDX-License-Identifier: MPL-2.0
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const calls=[],errors=[];let mode='valid',held;
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw),input=JSON.parse(body.messages[1].content);calls.push(body);
  const respond=()=>{if(res.destroyed)return;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:mode==='invalid'?'not JSON':JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:'译文 '+s.text+' '+('用于测试译文增加段落高度并改变可见区域。'.repeat(16))}))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));};
  if(mode==='hold')held=respond;else respond();
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),profile=fs.mkdtempSync(path.resolve('build/web-cache-profile-'));
 const launch=()=>chromium.launchPersistentContext(profile,{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1200,height:720},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 let context=await launch();context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try {
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=`chrome-extension://${worker.url().split('/')[2]}`;
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('targetLanguage','zh-CN');twpConfig.set('translateDynamicallyCreatedContent','yes');});
  let settings=await context.newPage();await settings.goto(base+'/options/ai.html');await settings.locator('#profile-name').fill('Web cache');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('web-cache-model');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');await settings.locator('#active-profile').selectOption(await settings.locator('#profiles').inputValue());await settings.locator('#engine').selectOption('openai');await settings.locator('#preferences-form button[type=submit]').click();await expect(settings.locator('#preferences-status')).toContainText('已保存');
  const fixture='<!doctype html><html lang="en"><head><title>Stable paragraph cache</title><style>body{margin:12px;width:720px;font:16px/1.5 sans-serif}p{margin:14px 0;padding:10px;min-height:60px}</style></head><body>'+Array.from({length:32},(_,i)=>`<p id="p${i}">Paragraph ${i}: Machine Learning uses an Algorithm with <em>model ${i}</em> and attention. Read https://example.test/${i} and $x_${i}^2$.</p>`).join('')+'</body></html>';
  const route=()=>context.route('https://web-cache.test/**',r=>r.fulfill({contentType:'text/html',body:fixture}));await route();
  let page=await context.newPage();await page.goto('https://web-cache.test/article');await page.bringToFront();
  const toggle=()=>page.locator('#twp-floating #toggle');
  const open=async()=>{await toggle().hover();await page.locator('#twp-floating #settings').click();await expect(page.locator('#twp-floating #domain')).toBeEnabled();};
  await open();await page.locator('#twp-floating #engine').selectOption('openai');await page.locator('#twp-floating #translate').click();
  for(let i=0;i<32;i++){await page.locator('#p'+i).scrollIntoViewIfNeeded();await expect(page.locator('#p'+i+' [data-twp-bilingual]')).toBeAttached();}
  await expect(toggle()).toHaveAttribute('data-state','translated');
  const warmed=calls.length;console.log('Warmed model requests:',warmed);
  await page.locator('#twp-floating #close').click();await toggle().click();await expect(toggle()).toHaveAttribute('data-state','original');
  await page.setViewportSize({width:1200,height:540});await page.locator('#p10').scrollIntoViewIfNeeded();await toggle().click();await expect(toggle()).toHaveAttribute('data-state','translated');
  expect(calls.length,'restoring and translating through the other button must reuse already translated paragraphs despite different visible batches').toBe(warmed);
  console.log('Different visible batches reused the cache across control-panel/floating buttons.');
  // Adding one visible paragraph should send only that paragraph, retaining known ones.
  await page.evaluate(()=>{const p=document.createElement('p');p.id='new-paragraph';p.textContent='A newly visible paragraph about a novel Algorithm.';document.querySelector('#p10').before(p);});
  await page.locator('#new-paragraph').scrollIntoViewIfNeeded();await expect(page.locator('#new-paragraph [data-twp-bilingual]')).toBeAttached();
  expect(calls.length).toBe(warmed+1);expect(JSON.parse(calls.at(-1).messages[1].content).segments).toHaveLength(1);
  // Explicit retranslation bypasses both cache paths, and normal translation reuses the update.
  await open();const beforeForce=calls.length;await page.locator('#twp-floating #retranslate').click();await expect(toggle()).toHaveAttribute('data-state','translated');expect(calls.length).toBeGreaterThan(beforeForce);
  await page.locator('#twp-floating #close').click();await toggle().click();const forced=calls.length;await toggle().click();await expect(toggle()).toHaveAttribute('data-state','translated');expect(calls.length).toBe(forced);
  // The cache is persistent across a browser restart, rather than a renderer-only memo.
  await toggle().click();await context.close();context=await launch();context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));await route();
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();await page.goto('https://web-cache.test/article');await page.bringToFront();await open();await page.locator('#twp-floating #engine').selectOption('openai');await page.locator('#twp-floating #close').click();await toggle().click();await expect(toggle()).toHaveAttribute('data-state','translated');expect(calls.length).toBe(forced);
  settings=await context.newPage();await settings.goto(base+'/options/ai.html');await settings.locator('#clear-ai-cache').click();await expect(settings.locator('#cache-status')).toContainText('已清空');await toggle().click();await toggle().click();await expect(toggle()).toHaveAttribute('data-state','translated');expect(calls.length).toBeGreaterThan(forced);
  await toggle().click();await expect(toggle()).toHaveAttribute('data-state','original');
  // Call the real content-script message path for cache lifecycle edge cases.
  const cdp=await context.newCDPSession(page),worlds=[];
  cdp.on('Runtime.executionContextCreated',e=>worlds.push(e.context));await cdp.send('Runtime.enable');
  const extensionId=base.split('/')[2],world=worlds.find(w=>w.name===extensionId||w.origin===base);expect(world).toBeTruthy();
  const send=async request=>{const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:`chrome.runtime.sendMessage(${JSON.stringify(request)})`,awaitPromise:true,returnByValue:true});expect(r.exceptionDetails).toBeUndefined();return r.result.value;};
  const request=(segments,options={})=>send({action:'aiTranslate',id:crypto.randomUUID(),cacheBySegment:true,targetLanguage:'zh-CN',context:'Cache edge cases',segments,...options});
  const text='Stable duplicate with `code` and $x^2$ at https://example.test/cache';
  let before=calls.length,r=await request([{id:'a',text},{id:'b',text}]);
  expect(r.ok).toBe(true);expect(r.translations[0]).toBe(r.translations[1]);expect(r.translations[0]).toContain('$x^2$');expect(r.translations[0]).toContain('https://example.test/cache');expect(r.translations[0]).not.toContain('__TWP_KEEP_');
  expect(calls.length).toBe(before+1);expect(JSON.parse(calls.at(-1).messages[1].content).segments).toHaveLength(1);
  r=await request([{id:'new-id',text:'A second source paragraph.'},{id:'old-id',text}]);expect(r.ok).toBe(true);expect(calls.length).toBe(before+2);expect(JSON.parse(calls.at(-1).messages[1].content).segments.map(s=>s.id)).toEqual(['new-id']);
  r=await request([{id:'changed-again',text},{id:'reordered',text:'A second source paragraph.'}]);expect(r.cached).toBe(true);expect(r.usage.total).toBe(0);expect(calls.length).toBe(before+2);
  mode='invalid';before=calls.length;
  for(let i=0;i<2;i++){r=await request([{id:String(i),text:'Invalid output is never cached.'}]);expect(r.ok).toBe(false);}
  expect(calls.length).toBe(before+2);mode='valid';r=await request([{id:'fixed',text:'Invalid output is never cached.'}]);expect(r.ok).toBe(true);expect(r.cached).toBe(false);
  // Clearing while a response is pending must invalidate both batch and paragraph tickets.
  mode='hold';before=calls.length;const pending=request([{id:'pending',text:'Clear while this paragraph is pending.'}]);
  await expect.poll(()=>calls.length).toBe(before+1);await settings.evaluate(()=>twpAIClient.call({action:'aiClearCache'}));mode='valid';held();expect((await pending).ok).toBe(true);
  r=await request([{id:'different-id',text:'Clear while this paragraph is pending.'}]);expect(r.cached).toBe(false);expect(calls.length).toBe(before+2);
  mode='hold';before=calls.length;const cancelled=request([{id:'0',text:'Cancelled paragraph.'}],{id:'cancel-web-cache'});
  await expect.poll(()=>calls.length).toBe(before+1);expect((await send({action:'aiCancel',ids:['cancel-web-cache']})).ok).toBe(true);expect((await cancelled).ok).toBe(false);mode='valid';held();
  r=await request([{id:'retry',text:'Cancelled paragraph.'}]);expect(r.cached).toBe(false);expect(calls.length).toBe(before+2);
  // Age cached rows without waiting days; the default seven-day TTL must expire them.
  await settings.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('TWP_AI_CACHE',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('translations','readwrite'),store=tx.objectStore('translations'),rows=store.getAll();rows.onsuccess=()=>rows.result.forEach(row=>store.put({...row,createdAt:Date.now()-8*86400000}));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
  before=calls.length;r=await request([{id:'expired',text:'Cancelled paragraph.'}]);expect(r.cached).toBe(false);expect(calls.length).toBe(before+1);
  await worker.evaluate(()=>twpConfig.set('aiCacheSettings',{enabled:false,ttlHours:168}));
  await expect.poll(async()=>(await settings.evaluate(()=>twpAIClient.call({action:'aiCacheStats'}))).count).toBe(0);
  before=calls.length;for(let i=0;i<2;i++){r=await request([{id:'disabled',text:'Disabled cache paragraph.'}]);expect(r.cached).toBe(false);}expect(calls.length).toBe(before+2);
  expect(errors).toEqual([]);console.log('Web cache passed: changed batches, both buttons, protected content, partial hits, deduplication, forced refresh, restart, expiry, disabled cache, malformed responses, cancellation and clear during a request.');
 } catch(error) {console.error('Requests:',calls.length,'Batch sizes:',calls.map(b=>JSON.parse(b.messages[1].content).segments.length));console.error('UI:',await Promise.all(context.pages().map(p=>p.evaluate(()=>({url:location.href,visibility:document.visibilityState,status:document.querySelector('#twp-floating')?.shadowRoot?.getElementById('status')?.textContent,engine:document.querySelector('#twp-floating')?.shadowRoot?.getElementById('engine')?.value})).catch(()=>''))));throw error;}
 finally {await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
