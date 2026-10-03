async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),errors=[];
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-sync-profile-')),{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{
      await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set("pdfLayoutMode","flow");twpConfig.set('targetLanguage','zh-CN');
      globalThis.pdfRequests=[];globalThis.pdfDelay=100;
      translationService.translateText=async(service,source,target,texts)=>{
        globalThis.pdfRequests.push(texts);await new Promise(r=>setTimeout(r,globalThis.pdfDelay));
        return texts.map(s=>('扩展后的译文段落，用于验证不同页面高度时的对应阅读位置。'+s).repeat(9));
      };
    });
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');
    const file={name:'sync.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:Array.from({length:5},(_,i)=>Array.from({length:8},(_,j)=>({text:`Page ${i+1} paragraph ${j+1}. Read the corresponding translated paragraph.`,x:45,y:750-j*82,size:12}))),sizes:[[595,842],[595,842],[595,1000],[595,842],[595,842]]})};
    const left=p.locator('#pdf-scroll'),right=p.locator('#pdf-translation-scroll');
    const leftChunk=(page,id)=>p.locator(`.pdf-source-page[data-page="${page}"] .pdf-source-chunk[data-chunk="${id}"]`);
    const rightChunk=(page,id)=>p.locator(`.pdf-translation-page[data-page="${page}"] .pdf-chunk[data-chunk="${id}"]`).first();
    const offset=async(locator,pane)=>locator.evaluate((node,id)=>node.getBoundingClientRect().top-document.getElementById(id).getBoundingClientRect().top,pane);
    const place=async(locator,pane)=>locator.evaluate((node,id)=>{const host=document.getElementById(id);host.scrollTop+=node.getBoundingClientRect().top-host.getBoundingClientRect().top-200;},pane);
    await expect(p.locator('#pdf-sync-scroll')).toHaveAttribute('aria-pressed','true');
    await p.locator('#document-file').setInputFiles(file);
    await expect(rightChunk(1,0)).toBeAttached();
    // Real wheel movement follows to the same page before its translation exists.
    await left.hover();await p.mouse.wheel(0,1100);
    await expect.poll(()=>right.evaluate(n=>n.scrollTop)).toBeGreaterThan(500);
    await expect(p.locator('#pdf-page')).toHaveValue('2');
    await expect(rightChunk(2,0)).toBeAttached();
    // Drive to a new page, wait on a delayed result, and verify paragraph alignment after reflow.
    await worker.evaluate(()=>globalThis.pdfDelay=1500);
    await left.evaluate(n=>n.scrollTop=document.querySelector('.pdf-page-row[data-page="3"]').offsetTop+280);
    await expect(leftChunk(3,4)).toBeAttached();
    await place(leftChunk(3,4),'pdf-scroll');
    await expect(p.locator('#pdf-page')).toHaveValue('3');
    const sourceBefore=await left.evaluate(n=>n.scrollTop);
    await expect(rightChunk(3,4)).toBeAttached({timeout:10000});
    // Scroll offsets are integer CSS pixels; a long translated paragraph magnifies subpixel rounding.
    await expect.poll(async()=>Math.abs(await offset(rightChunk(3,4),'pdf-translation-scroll')-200)).toBeLessThan(6);
    expect(Math.abs(await left.evaluate(n=>n.scrollTop)-sourceBefore)).toBeLessThan(2);
    expect(await p.locator('.pdf-translation-page[data-page="3"]').evaluate(n=>n.offsetHeight)).toBeGreaterThan(await p.locator('.pdf-page-row[data-page="3"]').evaluate(n=>n.offsetHeight)*1.5);
    // Reverse direction: right-side paragraph boundaries map back to original coordinates.
    await place(rightChunk(3,5),'pdf-translation-scroll');
    await expect.poll(async()=>Math.abs(await offset(leftChunk(3,5),'pdf-scroll')-200)).toBeLessThan(3);
    const stable=await p.evaluate(()=>[document.getElementById('pdf-scroll').scrollTop,document.getElementById('pdf-translation-scroll').scrollTop]);
    const requestCount=await worker.evaluate(()=>globalThis.pdfRequests.length);
    await p.waitForTimeout(1100); // Observe beyond the automatic-translation debounce for feedback loops.
    expect(await worker.evaluate(()=>globalThis.pdfRequests.length)).toBe(requestCount);
    expect(await p.evaluate(()=>[document.getElementById('pdf-scroll').scrollTop,document.getElementById('pdf-translation-scroll').scrollTop])).toEqual(stable);
    // Source-led alignment survives font-size changes without making another translation request.
    await place(leftChunk(3,4),'pdf-scroll');
    await p.locator('#pdf-style-tool').click();await p.locator('#pdf-style-size').fill('22');await p.locator('[data-close-dialog="pdf-style-dialog"]').click();
    await expect.poll(async()=>Math.abs(await offset(rightChunk(3,4),'pdf-translation-scroll')-200)).toBeLessThan(6);
    // Independent mode remains available, in both directions, and persists after reopening.
    await setToggle(p.locator('#pdf-sync-scroll'),false);
    const r=await right.evaluate(n=>n.scrollTop);await left.hover();await p.mouse.wheel(0,-160);
    await p.waitForTimeout(250);expect(await right.evaluate(n=>n.scrollTop)).toBe(r);
    const l=await left.evaluate(n=>n.scrollTop);await right.hover();await p.mouse.wheel(0,180);
    await p.waitForTimeout(250);expect(await left.evaluate(n=>n.scrollTop)).toBe(l);
    await p.reload();await expect(p.locator('#pdf-sync-scroll')).toHaveAttribute('aria-pressed','false');
    await p.locator('#document-file').setInputFiles(file);await expect(rightChunk(1,0)).toBeAttached({timeout:10000});
    await left.evaluate(n=>n.scrollTop=document.querySelector('.pdf-page-row[data-page="2"]').offsetTop+100);
    await expect(p.locator('#pdf-page')).toHaveValue('2');await setToggle(p.locator('#pdf-sync-scroll'),true);
    await expect.poll(()=>right.evaluate(n=>n.scrollTop)).toBeGreaterThan(1000);
    await p.locator('#pdf-hide-top').click();await expect(p.locator('#pdf-sync-scroll')).toBeVisible();
    await p.screenshot({path:path.resolve('build/pdf-sync.png')});
    expect(errors).toEqual([]);
    console.log('PDF sync passed: default on, wheel following, delayed reflow, unequal heights, reverse paragraph mapping, no feedback loops, style changes, independent mode and persisted toggle.');
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
