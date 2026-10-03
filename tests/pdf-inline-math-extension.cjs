const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const calls=[],errors=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',s=>raw+=s);req.on('end',()=>{
  const payload=JSON.parse(JSON.parse(raw).messages.find(m=>m.role==='user').content);calls.push(payload);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:payload.segments.map(s=>({id:s.id,text:'测试译文：'+s.text}))})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-inline-profile-')),{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1800,height:1100},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('targetLanguage','zh-CN');globalThis.inlineInputs=[];globalThis.damageMarkers=false;translationService.translateText=async(service,source,target,texts)=>{inlineInputs.push(...texts);return texts.map(s=>damageMarkers&&s.includes('__TWP_MATH_')?'损坏标记':'测试译文：'+s);};});
  const p=await context.newPage();await p.goto(base+'/options/pdf.html');await p.locator('#engine').selectOption('google');
  await p.locator('#document-file').setInputFiles(process.env.TWP_PDF_SAMPLE||path.join(process.env.TEMP,'twp-mml-book.pdf'));
  await expect(p.locator('#document-name')).toContainText('417 页');await p.locator('#pdf-page').fill('41');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
  const page=p.locator('.pdf-translation-page[data-page="41"]');
  const expression=page.locator('.translation .pdf-inline-math[aria-label="(A^{⊤}A)⁻¹A^{⊤}"]');
  await expect(expression).toHaveCount(1);await expect(expression.locator('sup')).toHaveText(['⊤','−1','⊤']);
  await expect(page.locator('.translation .pdf-inline-math[aria-label="x_{∗}"]').first().locator('sub')).toHaveText('∗');
  expect(await worker.evaluate(()=>inlineInputs.join('\n'))).not.toContain('A^{⊤}');
  expect(await worker.evaluate(()=>inlineInputs.join('\n'))).toContain('__TWP_MATH_');
  await expect(page).not.toContainText('__TWP_MATH_');await expect(page.locator('.translation').first()).not.toContainText('^{');
  const scriptPosition=await expression.evaluate(n=>{const range=document.createRange();range.selectNode(n.firstChild);return {base:range.getBoundingClientRect().y,sup:n.querySelector('sup').getBoundingClientRect().y};});expect(scriptPosition.sup).toBeLessThan(scriptPosition.base);
  await expect(p.locator('.pdf-source-page[data-page="41"] .pdf-canvas-slot')).toHaveAttribute('data-state','ready');
  await expect(page.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
  await p.screenshot({path:path.resolve('build/pdf-inline-page41.png')});
  await p.locator('#bilingual-document').click();await expect(page.locator('.original sup').first()).toBeAttached();
  await p.locator('#pdf-zoom').selectOption('1.5');await expect(expression.locator('sup')).toHaveText(['⊤','−1','⊤']);await p.locator('#pdf-zoom').selectOption('fit');
  await worker.evaluate(()=>globalThis.damageMarkers=true);await p.locator('#translate-document').click();await expect(p.locator('#translate-document')).toBeEnabled();await expect(expression).toHaveCount(1);await expect(page).not.toContainText('损坏标记');
  // Safe rendering: formulas are DOM text + sup/sub, never interpreted HTML.
  expect(await p.evaluate(()=>{const n=document.createElement('div');twpPDFInlineMath.append(n,'<img src=x onerror=alert(1)> x_{*}');return {images:n.querySelectorAll('img').length,sub:n.querySelector('sub').textContent};})).toEqual({images:0,sub:'*'});
  const settings=await context.newPage();await settings.goto(base+'/options/ai.html');await settings.locator('#profile-name').fill('Inline math test');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('inline-test');await settings.getByRole('button',{name:'保存服务',exact:true}).click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
  await p.locator('#engine').selectOption('openai');await expect(p.locator('#profile')).not.toHaveValue('');await p.locator('#translate-document').click();await expect(expression).toHaveCount(1);await expect(p.locator('#translate-document')).toBeEnabled();
  expect(calls.length).toBeGreaterThan(0);expect(JSON.stringify(calls)).toContain('__TWP_MATH_');expect(JSON.stringify(calls)).not.toContain('A^{⊤}');
  const before=calls.length;await p.locator('#translate-document').click();await expect(p.locator('#translate-document')).toBeEnabled();expect(calls.length).toBe(before);await expect(expression.locator('sup')).toHaveText(['⊤','−1','⊤']);
  const download=p.waitForEvent('download');await p.locator('#pdf-export').click();const saved=await download,text=fs.readFileSync(await saved.path(),'utf8');expect(text).toContain('(A^{⊤}A)⁻¹A^{⊤}');expect(text).not.toContain('__TWP_MATH_');
  // Regression: real page 46 has raised CMEX sums with overlapping upper/lower
  // limits and variable lists. None may escape into orphan paragraph blocks.
  await worker.evaluate(()=>globalThis.damageMarkers=false);
  await p.locator('#engine').selectOption('google');
  await p.locator('#pdf-page').fill('46');await p.locator('#pdf-page').press('Tab');
  await p.locator('#translate-document').click();await expect(p.locator('#translate-document')).toBeEnabled();
  const sumPage=p.locator('.pdf-translation-page[data-page="46"]');
  await expect(sumPage.locator('.translation .pdf-inline-operator')).toHaveCount(2);
  await expect(sumPage.locator('.translation .pdf-inline-limits sup')).toHaveText(['k','k']);
  await expect(sumPage.locator('.translation .pdf-inline-limits sub')).toHaveText(['i=1','i=1']);
  await expect(sumPage.locator('.translation .pdf-inline-math[aria-label="λ₁, . . . , λₖ ∈ ℝ"]')).toHaveCount(1);
  await expect(sumPage.locator('.translation .pdf-inline-math[aria-label="x₁, . . . , xₖ"]').first()).toBeAttached();
  const sumChunks=sumPage.locator('.pdf-positioned-chunk').filter({has:p.locator('.pdf-inline-operator')});
  await expect(sumChunks).toHaveCount(2);
  await expect(sumChunks.first()).toContainText('is always true. In the following,');
  await expect(sumChunks.last()).toContainText('with at least one');
  await expect(sumPage).not.toContainText('Pₖ');
  await expect(sumPage.locator('.pdf-formula-image')).toHaveCount(1);
  await sumPage.locator('.translation .pdf-inline-operator').first().scrollIntoViewIfNeeded();
  await p.screenshot({path:path.resolve('build/pdf-inline-page46.png')});
  expect(errors).toEqual([]);console.log('Inline math passed: pages 41/46, traditional and AI requests, complete variable lists, inline sums/limits, no orphan blocks, zoom/bilingual, AI cache and TXT export.');
 }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
