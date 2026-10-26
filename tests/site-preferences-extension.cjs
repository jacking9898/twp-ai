// SPDX-License-Identifier: MPL-2.0
// Real extension/browser/model-request path. The model server is a local fixture.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const out=path.resolve('.local-data/site-preferences');fs.mkdirSync(out,{recursive:true});const calls=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',s=>raw+=s);req.on('end',()=>{const body=JSON.parse(raw),input=JSON.parse(body.messages.find(m=>m.role==='user').content);calls.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:'测试译文：'+s.text}))})},finish_reason:'stop'}]}));});});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),profile=fs.mkdtempSync(path.join(out,'profile-'));
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1500,height:1150},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});let context;
 const route=async()=>{for(const host of ['site-preferences.test','other-preferences.test'])await context.route('https://'+host+'/**',r=>{
  const u=new URL(r.request().url()),slug=u.pathname.split('/').pop();return r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>${slug}</title><style>body{font:18px/1.5 sans-serif;margin:40px;max-width:800px}</style></head><body><nav><a id="next" href="/course/two">Next chapter</a></nav><main><h1>Chapter ${slug}</h1><p>Machine Learning, Artificial intelligence and LLM enable useful models in chapter ${slug}.</p></main></body></html>`});
 });};
 const box=p=>p.locator('#twp-floating'),field=(p,id)=>box(p).locator('#'+id);
 const open=async p=>{await field(p,'toggle').hover();await field(p,'settings').click();await expect(field(p,'domain')).toBeEnabled();};
 const select=async(p,id,value)=>{await field(p,id).selectOption(value);await expect(field(p,'page-ai-notice')).toContainText('已保存');await expect(field(p,id)).toBeEnabled();};
 const verify=async(p,values=['ml','builtin-llm-ai','academic'])=>{for(const [i,id]of ['domain','page-glossary','page-style'].entries())await expect(field(p,id)).toHaveValue(values[i]);};
 const translate=async p=>{await field(p,'retranslate').click();await expect(field(p,'toggle')).toHaveAttribute('data-state','translated',{timeout:15000});};
 const prompt=()=>calls.at(-1).messages[0].content;
 try{
  context=await launch();let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('targetLanguages',['zh-CN','en','es']);twpConfig.set('targetLanguage','zh-CN');twpConfig.set('pageTranslatorService','openai');});
  const settings=await context.newPage();await settings.goto('chrome-extension://'+new URL(worker.url()).host+'/options/ai.html');await settings.locator('#profile-name').fill('Site preferences fixture');await settings.locator('#base-url').fill('http://127.0.0.1:'+server.address().port+'/v1');await settings.locator('#model').fill('site-fixture');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  await route();let page=await context.newPage();await page.goto('https://site-preferences.test/course/one');await open(page);
  await select(page,'domain','ml');await select(page,'page-glossary','builtin-llm-ai');await select(page,'page-style','academic');await translate(page);
  expect(prompt()).toContain('Use established machine learning');expect(prompt()).toContain('formal, restrained academic');expect(prompt()).toContain('大语言模型（LLM）');
  await field(page,'close').click();await page.locator('#next').click();await expect(field(page,'toggle')).toHaveAttribute('data-state','translated');await open(page);await verify(page);
  expect(prompt()).toContain('Use established machine learning');expect(prompt()).toContain('formal, restrained academic');expect(prompt()).toContain('大语言模型（LLM）');
  console.log('Website choices survive the next article and enter its actual model request.');
  await expect(field(page,'ai-setting-scope')).toHaveValue('site');
  await field(page,'ai-setting-scope').selectOption('page');await expect(field(page,'domain')).toBeEnabled();await expect(field(page,'domain option').first()).toContainText('跟随网站 · 机器学习');await select(page,'domain','software');await translate(page);expect(prompt()).toContain('Use software engineering terminology');expect(prompt()).toContain('大语言模型（LLM）');
  const next=await context.newPage();await next.goto('https://site-preferences.test/course/three');await open(next);await verify(next);
  const other=await context.newPage();await other.goto('https://other-preferences.test/course/one');await open(other);await verify(other,['','','']);
  expect(await worker.evaluate(()=>twpConfig.get('aiTranslationSettings').domain)).toBe('general');
  await field(page,'page-ai-reset').click();await expect(field(page,'domain')).toHaveValue('');await expect(field(page,'domain')).toBeEnabled();await translate(page);expect(prompt()).toContain('Use established machine learning');
  console.log('Page overrides, inherited glossary/style, reset, other-site and global isolation passed.');
  // Older page-only settings stay visible and can be explicitly promoted.
  await page.goto('https://site-preferences.test/course/legacy');await open(page);await field(page,'ai-setting-scope').selectOption('page');await expect(field(page,'domain')).toBeEnabled();await select(page,'domain','software');
  await page.reload();await open(page);await expect(field(page,'ai-setting-scope')).toHaveValue('page');await expect(field(page,'domain')).toHaveValue('software');await field(page,'ai-setting-scope').selectOption('site');await expect(field(page,'page-ai-notice')).toContainText('已保存本网站');await verify(page,['software','builtin-llm-ai','academic']);
  await translate(page);expect(prompt()).toContain('Use software engineering terminology');
  await select(page,'domain','ml');await translate(page);expect(prompt()).toContain('Use established machine learning');
  await page.reload();await open(page);await verify(page);
  // A stale website edit must not clear an independently changed page override.
  const cdp=await context.newCDPSession(page),worlds=[];cdp.on('Runtime.executionContextCreated',e=>worlds.push(e.context));await cdp.send('Runtime.enable');
  const world=worlds.find(w=>w.name===new URL(worker.url()).host||w.origin==='chrome-extension://'+new URL(worker.url()).host);expect(world).toBeTruthy();
  const send=async request=>{const result=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:`chrome.runtime.sendMessage(${JSON.stringify(request)})`,awaitPromise:true,returnByValue:true});return result.result.value;};
  const site=await send({action:'aiScopeRead',scope:'site'}),own=await send({action:'aiScopeRead',scope:'page'});
  expect((await send({action:'aiScopeSave',scope:'page',revision:own.revision,settings:{expertId:'software'}})).ok).toBe(true);
  expect((await send({action:'aiScopeSave',scope:'site',revision:site.revision,pageRevision:site.pageRevision,settings:{expertId:'ml'}})).ok).toBe(false);
  expect((await send({action:'aiScopeRead',scope:'page'})).settings.expertId).toBe('software');
  // Fresh website edits deliberately replace this page's older overrides.
  const fresh=await send({action:'aiScopeRead',scope:'site'});expect((await send({action:'aiScopeSave',scope:'site',revision:fresh.revision,pageRevision:fresh.pageRevision,settings:site.settings})).ok).toBe(true);
  await worker.evaluate(()=>twpConfig.set('aiCustomExperts',[{id:'custom-removed',name:'Temporary',prompt:'Temporary expert.'}]));
  await page.reload();await open(page);await field(page,'ai-setting-scope').selectOption('page');await expect(field(page,'domain')).toBeEnabled();await select(page,'domain','custom-removed');
  await worker.evaluate(()=>twpConfig.set('aiCustomExperts',[]));await translate(page);expect(prompt()).toContain('Use established machine learning');
  await context.close();context=await launch();await route();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();await page.goto('https://site-preferences.test/course/after-restart');await open(page);await verify(page);
  await field(page,'page-ai-reset').click();await expect(field(page,'domain')).toBeEnabled();await verify(page,['','','']);await translate(page);expect(prompt()).not.toContain('Use established machine learning');
  console.log('Legacy page promotion, atomic revision conflicts, removed presets, browser restart and website reset passed.');
  if(process.argv.includes('--live')){
   await page.goto('https://huggingface.co/learn/deep-rl-course/unit1/introduction',{waitUntil:'domcontentloaded',timeout:60000});await open(page);await select(page,'domain','ml');await select(page,'page-glossary','builtin-llm-ai');await select(page,'page-style','academic');await translate(page);await field(page,'close').click();
   for(const slug of ['what-is-rl','rl-framework']){await page.locator(`a[href="/learn/deep-rl-course/unit1/${slug}"]`).first().click();await expect(page).toHaveURL(new RegExp('/unit1/'+slug+'$'));await page.locator('h1').last().scrollIntoViewIfNeeded();await expect(page.locator('h1').last().locator('[data-twp-bilingual]')).toContainText('测试译文',{timeout:20000});await open(page);await verify(page);await field(page,'close').click();}
   await open(page);await page.screenshot({path:path.join(out,'huggingface-site-preferences.png')});
   console.log('Real Hugging Face course: three articles retain Machine Learning expert, LLM / AI glossary and academic style; local model fixture.');
  }
  console.log('Site preferences regression passed.');
 }finally{await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
