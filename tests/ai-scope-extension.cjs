// SPDX-License-Identifier: MPL-2.0
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
 const calls=[],errors=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw);calls.push(body);const input=JSON.parse(body.messages[1].content);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:'译文 '+s.text}))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),profile=fs.mkdtempSync(path.resolve('build/ai-scope-profile-'));
 const launch=()=>chromium.launchPersistentContext(profile,{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1600,height:1100},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 let context=await launch();
 const track=()=>context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));track();
 try {
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=`chrome-extension://${worker.url().split('/')[2]}`;
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('pageTranslatorService','openai');twpConfig.set('targetLanguage','zh-CN');twpConfig.set('aiTranslationSettings',{domain:'general',styleId:'faithful',glossaryId:'public-default',acronyms:'keep',glossary:[['attention','全局注意力']]});});
  const settings=await context.newPage();await settings.goto(base+'/options/ai.html');
  await settings.locator('#profile-name').fill('Scope model');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('scope-model');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  const webURL='https://scope.test/article?a=1';
  // Upgrade the existing usage/terms database in place, retaining saved terms.
  await settings.evaluate(async url=>{
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))].map(v=>v.toString(16).padStart(2,'0')).join('');
   await new Promise((resolve,reject)=>{const r=indexedDB.open('TWP_AI_INSIGHTS',1);r.onupgradeneeded=()=>{for(const name of ['totals','events','terms'])r.result.createObjectStore(name,{keyPath:'key'});};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('terms','readwrite');t.objectStore('terms').put({key:'web:'+digest+':zh-CN',revision:1,entries:[['model','升级保留的网页词条'],['attention','本页注意力']]});t.oncomplete=()=>{db.close();resolve();};};});
  },webURL);
  const route=()=>context.route('https://scope.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><head><title>Domain guide</title></head><body><h1>Machine Learning guide</h1><p>Machine Learning uses an Algorithm, model and attention.</p></body></html>'}));await route();
  async function web(url) {const p=await context.newPage();await p.goto(url);await p.locator('#twp-floating #toggle').hover();await p.locator('#twp-floating #settings').click();await expect(p.locator('#twp-floating #domain')).toBeEnabled();return p;}
  const a=await web(webURL),b=await web('https://scope.test/article?a=2');
  async function select(p,id,value,notice) {await p.locator(id).selectOption(value);await expect(p.locator(id)).toBeEnabled();await expect(p.locator(notice)).toContainText('已保存');}
  const choose=(p,id,value)=>select(p,'#twp-floating #'+id,value,'#twp-floating #page-ai-notice');
  await choose(a,'domain','ml');await choose(a,'page-glossary','public-tech');await choose(a,'page-style','academic');
  await expect(b.locator('#twp-floating #domain')).toHaveValue('');
  expect(await worker.evaluate(()=>twpConfig.get('aiTranslationSettings').domain)).toBe('general');
  const translateWeb=async p=>{await p.locator('#twp-floating #translate').click();await expect(p.locator('#twp-floating #toggle')).toHaveAttribute('data-state','translated');};
  await translateWeb(a);let prompt=calls.at(-1).messages[0].content;
  expect(prompt).toContain('Use established machine learning');expect(prompt).toContain('formal, restrained academic');expect(prompt).toContain('机器学习');expect(prompt).toContain('升级保留的网页词条');expect(prompt).toContain('全局注意力');expect(prompt).not.toContain('本页注意力');
  await translateWeb(b);expect(calls.at(-1).messages[0].content).not.toContain('升级保留的网页词条');
  const count=calls.length;await a.locator('#twp-floating #translate').click();await translateWeb(a);expect(calls.length).toBe(count);
  await choose(a,'domain','software');await translateWeb(a);expect(calls.length).toBeGreaterThan(count);expect(calls.at(-1).messages[0].content).toContain('Use software engineering terminology');
  await choose(a,'domain','ml');const cached=calls.length;await translateWeb(a);expect(calls.length).toBe(cached);
  await worker.evaluate(()=>twpConfig.set('aiTranslationSettings',{...twpConfig.get('aiTranslationSettings'),domain:'software'}));
  await expect(b.locator('#twp-floating #domain option').first()).toContainText('软件开发');await expect(a.locator('#twp-floating #domain')).toHaveValue('ml');
  await choose(a,'domain','');await translateWeb(a);expect(calls.at(-1).messages[0].content).toContain('Use software engineering terminology');
  await choose(a,'domain','ml');
  await worker.evaluate(()=>{twpConfig.set('aiCustomExperts',[{id:'custom-scope',name:'自建专家',prompt:'SCOPED_CUSTOM_EXPERT: translate faithfully.'}]);twpConfig.set('aiCustomGlossaries',[{id:'custom-scope-terms',name:'自建术语库',entries:[['Algorithm','自建算法']]}]);});
  await choose(a,'domain','custom-scope');await choose(a,'page-glossary','custom-scope-terms');await translateWeb(a);expect(calls.at(-1).messages[0].content).toContain('SCOPED_CUSTOM_EXPERT');expect(calls.at(-1).messages[0].content).toContain('自建算法');
  await choose(a,'domain','ml');await choose(a,'page-glossary','public-tech');
  // Scoped selections survive refresh; another URL retains inherited defaults.
  await a.reload();await a.locator('#twp-floating #toggle').hover();await a.locator('#twp-floating #settings').click();await expect(a.locator('#twp-floating #domain')).toBeEnabled();await expect(a.locator('#twp-floating #domain')).toHaveValue('ml');
  await a.screenshot({path:path.resolve('build/web-ai-scope-preview.png')});
  const buffer=pdfFixture({pages:[['Machine Learning uses an Algorithm, model and attention.'],['Machine Learning on the second page.']]});
  const key='pdf:'+crypto.createHash('sha256').update(buffer).digest('hex');
  const pdf=await context.newPage();await pdf.goto(base+'/options/pdf.html');await pdf.locator('#document-file').setInputFiles({name:'original.pdf',mimeType:'application/pdf',buffer});await expect(pdf.locator('#pdf-ai-settings')).toBeEnabled();await pdf.locator('#pdf-ai-settings').click();await expect(pdf.locator('#pdf-expert')).toBeEnabled();
  const paused=calls.length;await pdf.evaluate(()=>twpConfig.set('pdfAutoTranslate',true));
  await select(pdf,'#pdf-expert','software','#pdf-ai-notice');await select(pdf,'#pdf-glossary','public-tech','#pdf-ai-notice');await select(pdf,'#pdf-ai-style','technical','#pdf-ai-notice');
  await pdf.waitForTimeout(850);expect(calls.length).toBe(paused);await pdf.evaluate(()=>twpConfig.set('pdfAutoTranslate',false));
  await pdf.locator('#pdf-ai-close').click();
  const next=context.waitForEvent('page');await pdf.locator('#ai-insights').click();const terms=await next;await terms.waitForLoadState();await expect(terms.locator('#terms')).toBeEnabled();
  await terms.locator('#terms').fill('Machine Learning = PDF专属机器学习\nmodel = PDF模型\nattention = PDF注意力');await terms.locator('#save-terms').click();await expect(terms.locator('#notice')).toContainText('已保存');
  await pdf.locator('#translate-document').click();await expect(pdf.locator('#task-status')).toContainText('PDF 翻译完成');prompt=calls.at(-1).messages[0].content;
  expect(prompt).toContain('Use software engineering terminology');expect(prompt).toContain('PDF专属机器学习');expect(prompt).toContain('算法');expect(prompt).toContain('PDF模型');expect(prompt).toContain('全局注意力');expect(prompt).not.toContain('PDF注意力');expect(prompt).not.toContain('升级保留的网页词条');
  // Reopened/renamed files keep their selection; a different file inherits defaults.
  await pdf.locator('#document-file').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer});await expect(pdf.locator('#pdf-ai-settings')).toBeEnabled();await pdf.locator('#pdf-ai-settings').click();await expect(pdf.locator('#pdf-expert')).toBeEnabled();await expect(pdf.locator('#pdf-expert')).toHaveValue('software');await pdf.locator('#pdf-ai-close').click();
  await pdf.locator('#document-file').setInputFiles({name:'different.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[['Other content.']]})});await expect(pdf.locator('#pdf-ai-settings')).toBeEnabled();await pdf.locator('#pdf-ai-settings').click();await expect(pdf.locator('#pdf-expert')).toBeEnabled();await expect(pdf.locator('#pdf-expert')).toHaveValue('');await pdf.locator('#pdf-ai-close').click();
  // Settings pages cannot supply arbitrary source identities; unknown preset IDs are rejected.
  await expect(settings.evaluate(documentKey=>twpAIClient.call({action:'aiScopeRead',documentKey}),key)).rejects.toThrow('请从网页控制面板');
  await expect(pdf.evaluate(documentKey=>twpAIClient.call({action:'aiScopeSave',documentKey,settings:{expertId:'missing'},revision:0}),key)).rejects.toThrow('已删除');
  await a.locator('#twp-floating #page-ai-reset').click();await expect(a.locator('#twp-floating #domain')).toHaveValue('');await expect(a.locator('#twp-floating #domain')).toBeEnabled();
  const before=await pdf.evaluate(documentKey=>twpAIClient.call({action:'aiScopeRead',documentKey}),key);expect(before.settings.expertId).toBe('software');
  await expect(pdf.evaluate(({documentKey,revision})=>twpAIClient.call({action:'aiScopeSave',documentKey,settings:{},revision:revision-1}),{documentKey:key,revision:before.revision})).rejects.toThrow('另一窗口');
  await context.close();context=await launch();track();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const reopened=await context.newPage();await reopened.goto(base+'/options/pdf.html');await reopened.locator('#engine').selectOption('openai');await reopened.locator('#document-file').setInputFiles({name:'restart.pdf',mimeType:'application/pdf',buffer});await expect(reopened.locator('#pdf-ai-settings')).toBeEnabled();await reopened.locator('#pdf-ai-settings').click();await expect(reopened.locator('#pdf-expert')).toBeEnabled();await expect(reopened.locator('#pdf-expert')).toHaveValue('software');await expect(reopened.locator('#pdf-glossary')).toHaveValue('public-tech');
  await reopened.screenshot({path:path.resolve('build/pdf-ai-scope-preview.png')});
  expect(errors).toEqual([]);console.log('Scoped AI settings passed: webpage/PDF UI, global isolation, glossary priority, DB upgrade, cache separation/reuse, reset, rename/restart persistence, source authorization and revision conflicts.');
 } finally {await context.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
