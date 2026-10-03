async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
 const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),errors=[];
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-math-profile-')),{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1800,height:1150},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);globalThis.mathInputs=[];translationService.translateText=async(service,source,target,texts)=>{globalThis.mathInputs.push(...texts);return texts.map(s=>'译文：'+('这里介绍线性代数的矩阵与方程。'.repeat(Math.max(1,Math.ceil(s.length/50)))));};});
  const p=await context.newPage();await p.goto(base+'/options/pdf.html');
  await p.locator('#document-file').setInputFiles({name:'formula-only.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[['x = 2']],fontName:'Symbol'})});await expect(p.locator('#document-name')).toContainText('1 页');
  await p.locator('#translate-document').click();await expect(p.locator('.pdf-formula-image[data-state=ready]')).toHaveCount(1);expect(await worker.evaluate(()=>mathInputs.length)).toBe(0);
  const sample=process.env.TWP_PDF_SAMPLE||path.join(process.env.TEMP,'twp-mml-book.pdf');
  if(!fs.existsSync(sample))throw new Error('Set TWP_PDF_SAMPLE to the MML book PDF for the real equation regression');
  await p.locator('#document-file').setInputFiles(sample);await expect(p.locator('#document-name')).toContainText('417 页');
  await p.locator('#pdf-page').fill('38');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
  const page=p.locator('.pdf-translation-page[data-page="38"]'),surface=page.locator('.pdf-layout-surface');await expect(surface).toBeAttached();
  await expect(page.locator('.pdf-formula-image')).toHaveCount(4);await expect(page.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
  const input=await worker.evaluate(()=>mathInputs.join('\n'));expect(input).not.toMatch(/[\uf8ee-\uf8fe\x00-\x08]/);expect(input).not.toContain('TXT 不包含');expect(input).toContain('To summarize');expect(input).toContain('where');
  await expect(page).not.toContainText('\uf8ee');
  await p.screenshot({path:path.resolve('build/pdf-math-page38.png')});
  // Retained formulas are real rendered pixels, not a blank replacement panel.
  expect(await page.locator('.pdf-formula-image canvas').first().evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i]<100&&d[i+1]<100&&d[i+2]<100&&d[i+3])dark++;return dark;})).toBeGreaterThan(300);
  await p.locator('#pdf-zoom').selectOption('1.5');await expect(page.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
  await p.locator('#pdf-zoom').selectOption('fit');
  const beforeToggle=await worker.evaluate(()=>mathInputs.length);
  await setToggle(p.locator('#bilingual-document'),true);await expect(surface).toBeAttached();await expect(page.locator('.original').first()).toBeAttached();await expect(page.locator('.pdf-formula-image')).toHaveCount(4);
  await page.locator('.pdf-formula-image').first().scrollIntoViewIfNeeded();await expect(page.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
  expect(await worker.evaluate(()=>mathInputs.length)).toBe(beforeToggle);
  const count=await worker.evaluate(()=>mathInputs.length);
  await setToggle(p.locator('#pdf-sync-scroll'),false);await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop=0);
  await expect(page.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');expect(await worker.evaluate(()=>mathInputs.length)).toBe(count);
  const download=p.waitForEvent('download');await p.locator('#pdf-export').click();const saved=await download;const text=fs.readFileSync(await saved.path(),'utf8');expect(text).toContain('TXT 不包含公式图像');expect(text).not.toMatch(/[\uf8ee-\uf8fe]/);
  // Closing/replacing the file discards pending formula renders and crops.
  await p.locator('#document-file').setInputFiles({name:'plain.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[['A plain text document.']]})});await expect(p.locator('#document-name')).toContainText('plain.pdf · 1 页');await expect(p.locator('.pdf-formula-image')).toHaveCount(0);
  expect(errors).toEqual([]);console.log('PDF math passed: formula-only page makes no requests, real page 38 preserves four regions, prose-only payloads, raster pixels, zoom/bilingual/independent scroll, TXT notice and file replacement.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
