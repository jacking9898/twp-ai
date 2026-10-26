// SPDX-License-Identifier: MPL-2.0
// Actual extension + isolated Chromium. Local model fixture verifies navigation
// and requests; --live also navigates the real public Hugging Face course.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const out=path.resolve('.local-data/reading-navigation');fs.mkdirSync(out,{recursive:true});
 const calls=[],errors=[];let hold=false,release;
 const server=http.createServer((req,res)=>{let raw='';req.on('data',s=>raw+=s);req.on('end',()=>{
  const body=JSON.parse(raw),input=JSON.parse(body.messages.find(m=>m.role==='user').content);calls.push({system:body.messages[0].content,segments:input.segments});
  const reply=()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:'测试译文：'+s.text}))})},finish_reason:'stop'}]}));}};
  if(hold){hold=false;release=reply;}else reply();
 });});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 let context;
 try{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
  context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(out,'profile-')),{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('targetLanguages',['zh-CN','en','es']);twpConfig.set('targetLanguage','zh-CN');twpConfig.set('pageTranslatorService','openai');});
  const settings=await context.newPage();await settings.goto('chrome-extension://'+new URL(worker.url()).host+'/options/ai.html');
  await settings.locator('#profile-name').fill('Reading navigation fixture');await settings.locator('#base-url').fill('http://127.0.0.1:'+server.address().port+'/v1');await settings.locator('#model').fill('reading-fixture');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  const fixture=url=>{
   const u=new URL(url),spa=u.pathname.startsWith('/spa/'),name=u.pathname.split('/').pop(),next=name==='one'?'two':'three';
   return `<!doctype html><html lang="en"><head><title>Chapter ${name}</title><style>body{font:18px/1.6 sans-serif;margin:40px;max-width:800px}</style></head><body><nav><a id="next" href="${spa?'/spa/':'/chapter/'}${next}">Next article</a> <a id="external" href="https://unrelated-reading.test/chapter/one">Other website</a> <a id="new-tab" target="_blank" href="/chapter/two">New tab</a> <a id="anchor" href="#details">Section</a></nav><main><h1>Chapter ${name}</h1><p id="prose">Chapter ${name} discusses Machine Learning and model evaluation.</p><p id="details">Learning the foundations of this chapter takes practice.</p></main>${spa?`<script>document.querySelector('#next').onclick=e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);document.title='Chapter ${next}';document.querySelector('main').innerHTML='<h1>Chapter ${next}</h1><p id="prose">Chapter ${next} discusses Software Engineering and deployment.</p>';};</script>`:''}</body></html>`;
  };
  for(const host of ['reading.test','unrelated-reading.test'])await context.route('https://'+host+'/**',r=>r.fulfill({contentType:'text/html',body:fixture(r.request().url())}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const floating=p=>p.locator('#twp-floating'),toggle=p=>floating(p).locator('#toggle');
  const translated=async p=>{await expect(p.locator('main [data-twp-bilingual]').first()).toContainText('测试译文',{timeout:15000});await expect(toggle(p)).toHaveAttribute('data-state','translated');};
  const original=async p=>{await expect(toggle(p)).toHaveAttribute('data-state','original');await p.waitForTimeout(900);await expect(p.locator('[data-twp-bilingual]')).toHaveCount(0);};
  const open=async p=>{await toggle(p).hover();await floating(p).locator('#settings').click();await expect(floating(p).locator('#domain')).toBeEnabled();};
  const read=()=>page.goto('https://reading.test/chapter/one');
  await read();await original(page);await toggle(page).click();await translated(page);
  await page.locator('#next').click();await expect(page).toHaveURL('https://reading.test/chapter/two');await translated(page);
  console.log('Full navigation automatically translates the next article after one manual start.');
  const warm=calls.length;await page.reload();await translated(page);expect(calls.length).toBe(warm);
  await page.locator('#anchor').click();await page.waitForTimeout(600);expect(calls.length).toBe(warm);
  const popup=page.waitForEvent('popup');await page.locator('#new-tab').click();const separate=await popup;await original(separate);await separate.close();
  await toggle(page).click();await page.locator('#next').click();await original(page);
  await worker.evaluate(()=>twpConfig.set('aiCacheSettings',{enabled:false,ttlHours:168}));
  await read();await toggle(page).click();await translated(page);await page.locator('#next').click();await translated(page);
  console.log('Reload/cache reuse, section anchors, separate tabs, restore and disabled-cache continuation passed.');
  await open(page);await floating(page).locator('#continue-reading').uncheck();await floating(page).locator('#close').click();await page.locator('#next').click();await original(page);
  await worker.evaluate(()=>twpConfig.set('continueReadingTranslation',true));
  await toggle(page).click();await translated(page);await page.locator('#external').click();await original(page);await read();await original(page);
  // Leaving for a browser-internal page must also clear intent; it has no
  // content script that could perform a recall/cleanup of its own.
  await toggle(page).click();await translated(page);await page.goto('about:blank');await read();await original(page);
  await toggle(page).click();await translated(page);await worker.evaluate(()=>twpConfig.set('neverTranslateSites',['reading.test']));await page.locator('#next').click();await original(page);await worker.evaluate(()=>twpConfig.set('neverTranslateSites',[]));
  console.log('Opt-out, cross-origin isolation and never-translate sites passed.');
  // Distinct chapter preferences must reach the model after an SPA route change.
  const configured=await context.newPage();await configured.goto('https://reading.test/spa/two');await open(configured);await floating(configured).locator('#ai-setting-scope').selectOption('page');await expect(floating(configured).locator('#domain')).toBeEnabled();await floating(configured).locator('#domain').selectOption('software');await expect(floating(configured).locator('#page-ai-notice')).toContainText('已保存');await configured.close();
  await page.goto('https://reading.test/spa/one');await open(page);await floating(page).locator('#domain').selectOption('ml');await expect(floating(page).locator('#page-ai-notice')).toContainText('已保存');await floating(page).locator('#close').click();
  await worker.evaluate(()=>twpConfig.set('translateDynamicallyCreatedContent','no'));
  await toggle(page).click();await translated(page);expect(calls.at(-1).system).toContain('Use established machine learning');
  await open(page);await page.evaluate(()=>document.querySelector('#next').click());await expect(page).toHaveURL('https://reading.test/spa/two');await translated(page);expect(calls.at(-1).system).toContain('Use software engineering terminology');await floating(page).locator('#ai-setting-scope').selectOption('page');await expect(floating(page).locator('#domain')).toHaveValue('software');await floating(page).locator('#close').click();
  await expect(page.locator('#prose [data-twp-bilingual]')).toContainText('Software Engineering');
  console.log('SPA navigation with dynamic translation disabled uses the new chapter and its own expert.');
  await toggle(page).click();await read();hold=true;const before=calls.length;await toggle(page).click();await expect.poll(()=>calls.length).toBeGreaterThan(before);await page.locator('#next').click();await translated(page);release();await page.waitForTimeout(400);await expect(page.locator('main')).not.toContainText('Chapter one');
  console.log('Navigating while translation is pending continues and rejects the old response.');
  // Traditional providers share the same reading intent, without cloud calls.
  await toggle(page).click();await worker.evaluate(()=>{twpConfig.set('pageTranslatorService','google');translationService.translateHTML=async(_s,_from,_to,paragraphs)=>paragraphs.map(p=>p.map(t=>'测试译文：'+t));});
  await read();await toggle(page).click();await translated(page);await page.locator('#next').click();await translated(page);await toggle(page).click();
  console.log('Traditional Google-provider navigation passed with a deterministic translation fixture.');
  if(process.argv.includes('--live')){
   await worker.evaluate(()=>{twpConfig.set('pageTranslatorService','openai');twpConfig.set('translateDynamicallyCreatedContent','yes');});
   await page.goto('https://huggingface.co/learn/deep-rl-course/unit1/introduction',{waitUntil:'domcontentloaded',timeout:60000});
   await page.getByText('Welcome to the most fascinating topic in Artificial Intelligence:',{exact:false}).first().scrollIntoViewIfNeeded();await toggle(page).click();
   await expect(page.locator('[data-twp-bilingual]').first()).toContainText('测试译文',{timeout:20000});
   for(const slug of ['what-is-rl','rl-framework']){
    const link=page.locator(`a[href="/learn/deep-rl-course/unit1/${slug}"]`).first();await link.click();await expect(page).toHaveURL(new RegExp('/unit1/'+slug+'$'));
    const article=page.locator('h1').last();await article.scrollIntoViewIfNeeded();await expect(article.locator('[data-twp-bilingual]')).toContainText('测试译文',{timeout:20000});
    await page.screenshot({path:path.join(out,'huggingface-'+slug+'.png')});
   }
   console.log('Real Hugging Face course: introduction → what-is-rl → rl-framework translated after a single manual start; local model fixture.');
  }
  expect(errors).toEqual([]);console.log('Reading navigation regression passed.');
 }finally{await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
