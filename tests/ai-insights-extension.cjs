const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
 let missing=false,bad=false,calls=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);calls.push(body);const payload=JSON.parse(body.messages.find(m=>m.role==='user').content),extract=body.messages[0].content.startsWith('Extract');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:bad?'invalid':JSON.stringify(extract?{terms:[['attention','注意力'],['hallucinated-term','假词']]}:{translations:payload.segments.map(s=>({id:s.id,text:'译文：'+s.text}))})},finish_reason:'stop'}],...(missing?{}:{usage:{prompt_tokens:25,completion_tokens:15,total_tokens:40,prompt_tokens_details:{cached_tokens:5},completion_tokens_details:{reasoning_tokens:3}}})}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),profile=fs.mkdtempSync(path.resolve('build/ai-insights-profile-')),errors=[];
 const launch=()=>chromium.launchPersistentContext(profile,{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1500,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 let context=await launch();context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=`chrome-extension://${worker.url().split('/')[2]}`;
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('targetLanguage','zh-CN');});
  const settings=await context.newPage();await settings.goto(base+'/options/ai.html');await settings.locator('#profile-name').fill('Usage model');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('usage-model');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  await settings.locator('#engine').selectOption('openai');await settings.locator('#preferences-form button[type=submit]').click();
  await expect(settings.evaluate(()=>twpAIClient.call({action:'aiInsightRead'}))).rejects.toThrow('请从 AI 用量与术语页面操作');
  const request=async(text,force=false)=>settings.evaluate(async({text,force})=>twpAIClient.call({action:'aiTranslate',id:crypto.randomUUID(),targetLanguage:'zh-CN',forceRefresh:force,segments:[{id:'0',text}]}),{text,force});
  await Promise.all([request('one attention'),request('two attention')]);
  const overview=await context.newPage();await overview.goto(base+'/options/insights.html');await expect(overview.locator('#all-total')).toHaveText('80');
  await request('one attention');await overview.locator('#refresh').click();await expect(overview.locator('#all-total')).toHaveText('80');await expect(overview.locator('#all-detail')).toContainText('本地缓存 1 次');
  missing=true;await request('unknown');missing=false;bad=true;await expect(request('invalid response')).rejects.toThrow('模型返回格式不正确');bad=false;
  await overview.locator('#refresh').click();await expect(overview.locator('#all-total')).toHaveText('120');await expect(overview.locator('#all-detail')).toContainText('1 次用量未知');
  await context.route('https://terms.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><head><title>Attention guide</title></head><body><h1>Attention guide</h1><p>attention helps the model focus.</p><input value="private input"></body></html>'}));
  const page=await context.newPage();await page.goto('https://terms.test/article?a=1');await page.locator('#twp-floating #toggle').hover();await page.locator('#twp-floating #settings').click();
  async function openWeb(){const next=context.waitForEvent('page');await page.locator('#twp-floating #ai-insights').click();const p=await next;await p.waitForLoadState();return p;}
  const web=await openWeb();await web.locator('#extract').click();await expect(web.locator('#notice')).toContainText('尚未保存');await expect(web.locator('#terms')).toHaveValue('attention = 注意力');expect(calls.at(-1).messages[1].content).not.toContain('private input');await expect(web.locator('#current-total')).toHaveText('40');
  await web.locator('#terms').fill('attention = 本页专用译法');await web.locator('#save-terms').click();await expect(web.locator('#notice')).toContainText('已保存');
  await web.screenshot({path:path.resolve('build/ai-insights-preview.png'),fullPage:true});
  await page.locator('#twp-floating #engine').selectOption('openai');await page.locator('#twp-floating #translate').click();await expect(page.locator('[data-twp-bilingual]').first()).toBeAttached({timeout:15000});expect(calls.at(-1).messages[0].content).toContain('本页专用译法');
  await page.goto('https://terms.test/article?a=2');await page.locator('#twp-floating #toggle').hover();await page.locator('#twp-floating #settings').click();const other=await openWeb();await expect(other.locator('#terms')).toHaveValue('');
  const reader=await context.newPage();await reader.goto(base+'/options/pdf.html');await reader.locator('#engine').selectOption('openai');
  const buffer=pdfFixture({pages:[['attention explains this document.'],['attention on another page.']]});
  await reader.locator('#document-file').setInputFiles({name:'a.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#document-name')).toContainText('a.pdf · 2 页');
  async function openPDF(){const next=context.waitForEvent('page');await reader.locator('#ai-insights').click();const p=await next;await p.waitForLoadState();return p;}
  const pdf=await openPDF();await pdf.locator('#extract').click();await expect(pdf.locator('#notice')).toContainText('尚未保存');await pdf.locator('#terms').fill('attention = 文件专属译法');await pdf.locator('#save-terms').click();await expect(pdf.locator('#notice')).toContainText('已保存');
  await reader.locator('#translate-document').click();await expect(reader.locator('#task-status')).toContainText('PDF 翻译完成');expect(calls.at(-1).messages[0].content).toContain('文件专属译法');expect(calls.at(-1).messages[0].content).not.toContain('本页专用译法');
  await reader.locator('#document-file').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#document-name')).toContainText('renamed.pdf · 2 页');const renamed=await openPDF();await expect(renamed.locator('#terms')).toHaveValue('attention = 文件专属译法');await renamed.locator('#target').selectOption('en');await expect(renamed.locator('#terms')).toHaveValue('');
  await reader.locator('#document-file').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[['attention in changed file.']]})});await expect(reader.locator('#document-name')).toContainText('renamed.pdf · 1 页');const changed=await openPDF();await expect(changed.locator('#terms')).toHaveValue('');
  const snapshotToken=new URL(changed.url()).searchParams.get('snapshot');await changed.close();await expect.poll(()=>worker.evaluate(async token=>(await chrome.storage.session.get('aiInsightSnapshot:'+token))['aiInsightSnapshot:'+token]||null,snapshotToken)).toBe(null);
  const before=await overview.evaluate(async()=> (await twpAIClient.call({action:'aiInsightRead'})).stats.total.total);
  await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const reopened=await context.newPage();await reopened.goto(base+'/options/insights.html');await expect(reopened.locator('#all-total')).toHaveText(before.toLocaleString());
  const newReader=await context.newPage();await newReader.goto(base+'/options/pdf.html');await newReader.locator('#document-file').setInputFiles({name:'again.pdf',mimeType:'application/pdf',buffer});await expect(newReader.locator('#document-name')).toContainText('again.pdf · 2 页');const newPage=context.waitForEvent('page');await newReader.locator('#ai-insights').click();const restored=await newPage;await expect(restored.locator('#terms')).toHaveValue('attention = 文件专属译法');
  expect(errors).toEqual([]);console.log('AI insights passed: concurrent usage, cache zero-cost, unknown and invalid response usage, scoped extraction/review, webpage isolation, PDF rename/target isolation, applied prompts and restart persistence.');
 }finally{await context.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
