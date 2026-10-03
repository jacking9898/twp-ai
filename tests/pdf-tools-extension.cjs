async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),errors=[];
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-tools-profile-')),{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set("pdfLayoutMode","flow");twpConfig.set("pdfSyncScroll",false);twpConfig.set('targetLanguage','zh-CN');globalThis.pdfRequests=[];translationService.translateText=async(service,source,target,texts)=>{globalThis.pdfRequests.push(texts);await new Promise(r=>setTimeout(r,100));return texts.map(s=>'译文：'+s);};});
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');
    await expect(p.locator('#pdf-layout-mode')).toHaveCount(0);
    await expect(p.locator('input[type=checkbox]')).toHaveCount(0);
    await expect(p.locator('#bilingual-document')).toHaveAttribute('aria-pressed','true'); // Migrate the former paragraph-reading preference.
    const synthetic=pdfFixture({pages:[[
      {text:'Reading methods',x:100,y:750,size:22},
      {text:'There are two different ways to study this subject.',x:45,y:710,size:12},
      {text:'Bottom-up: Start with foundations and gradually build',x:56,y:674,size:12,bullet:true},
      {text:'towards advanced ideas. Keep this continuation together.',x:56,y:659,size:12},
      {text:'Top-down: Begin with a concrete question and learn',x:56,y:642,size:12,bullet:true},
      {text:'the required concepts as you work on the question.',x:56,y:627,size:12}
    ],['Second chapter','Further reading and practical exercises.'],['Third chapter','An independent page to translate.']],outline:true});
    await p.locator('#document-file').setInputFiles({name:'tools.pdf',mimeType:'application/pdf',buffer:synthetic});
    await expect(p.locator('.pdf-translation-page[data-page="1"] [data-kind=list]')).toHaveCount(2);
    await expect(p.locator('.pdf-translation-page[data-page="1"] [data-kind=list]').first()).toContainText('Keep this continuation together');
    await expect(p.locator('.pdf-translation-page[data-page="1"] [data-kind=list]').first()).not.toContainText('Top-down');
    const requests=()=>worker.evaluate(()=>globalThis.pdfRequests.length);
    // A mostly visible next page is translated even when the previous page has a sliver at the top.
    await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop=document.querySelector('.pdf-page-row[data-page="2"]').offsetTop-80);
    await expect(p.locator('.pdf-translation-page[data-page="2"] .translation').first()).toBeAttached();
    await expect(p.locator('#pdf-page')).toHaveValue('2');
    // Right-pane reading also translates, while leaving the source position unchanged.
    const left=await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop);
    await p.locator('#pdf-translation-scroll').evaluate(n=>n.scrollTop=document.querySelector('.pdf-translation-page[data-page="3"]').offsetTop);
    await expect(p.locator('.pdf-translation-page[data-page="3"] .translation').first()).toBeAttached();
    expect(await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop)).toBe(left);
    await p.locator('#pdf-page').fill('1');await p.locator('#pdf-page').press('Tab');
    await p.locator('#pdf-text-tool').click();
    await expect(p.locator('.pdf-source-page[data-page="1"] .pdf-text-layer span').first()).toBeVisible();
    const selectable=await p.locator('.pdf-source-page[data-page="1"] .pdf-text-layer span').first().evaluate(node=>{const r=document.createRange();r.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(r);return getSelection().toString();});expect(selectable).toContain('Reading');
    await p.locator('[data-pdf-mode=text]').click();
    const source=p.locator('.pdf-source-page[data-page="1"] .pdf-canvas-slot'),box=await source.boundingBox();
    await p.mouse.click(box.x+100,box.y+300);await p.locator('#pdf-note-text').fill('Review this paragraph');await p.locator('#pdf-note-save').click();
    await expect(source.locator('.pdf-notes text')).toContainText('Review this paragraph');
    await p.locator('#pdf-draw-tool').click();await p.mouse.move(box.x+90,box.y+350);await p.mouse.down();await p.mouse.move(box.x+220,box.y+370,{steps:8});await p.mouse.up();
    await expect(source.locator('.pdf-notes polyline')).toHaveCount(1);
    const download=p.waitForEvent('download');await p.locator('#pdf-save-notes').click();const file=await download,notes=fs.readFileSync(await file.path());expect(JSON.parse(notes).notes).toHaveLength(2);
    await p.locator('#pdf-undo').click();await expect(source.locator('.pdf-notes polyline')).toHaveCount(0);
    await p.locator('#pdf-load-notes').setInputFiles({name:'notes.json',mimeType:'application/json',buffer:notes});await expect(source.locator('.pdf-notes polyline')).toHaveCount(1);
    await p.locator('[data-pdf-mode=erase]').click();const stroke=await source.locator('.pdf-notes polyline').boundingBox();await p.mouse.click(stroke.x+stroke.width/2,stroke.y+stroke.height/2);await expect(source.locator('.pdf-notes polyline')).toHaveCount(0);
    await p.locator('#pdf-edit-close').click();const beforeStyle=await requests();
    const styledText=p.locator('.pdf-translation-page[data-page="1"] [data-kind=list] .translation').first();
    const initialFontSize=await styledText.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
    await p.locator('#pdf-style-tool').click();
    await setToggle(p.locator('#pdf-style-original'),false);await expect(p.locator('#bilingual-document')).toHaveAttribute('aria-pressed','false');
    await expect(p.locator('.pdf-translation-page[data-page="1"] .original')).toHaveCount(0);
    await setToggle(p.locator('#pdf-style-original'),true);await expect(p.locator('#bilingual-document')).toHaveAttribute('aria-pressed','true');
    await p.locator('#pdf-style-compact').focus();await p.keyboard.press('Space');
    await expect(p.locator('#pdf-style-compact')).toHaveAttribute('aria-pressed','true');
    await expect(p.locator('#pdf-style-compact .pdf-toggle-state')).toHaveText('开启');
    await p.keyboard.press('Enter');await expect(p.locator('#pdf-style-compact')).toHaveAttribute('aria-pressed','false');
    await p.locator('#pdf-style-size').fill('20');await setToggle(p.locator('#pdf-style-indent'),true);await p.locator('#pdf-style-font').selectOption('serif');await p.locator('[data-close-dialog="pdf-style-dialog"]').click();
    expect(await styledText.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeCloseTo(initialFontSize*20/14,2);expect(await requests()).toBe(beforeStyle);
    await p.locator('#pdf-hide-top').click();await expect(p.locator('.reader-header')).toBeHidden();await expect(p.locator('#pdf-hide-top')).toHaveText('显示顶部');await p.locator('#pdf-hide-top').click();await expect(p.locator('.reader-header')).toBeVisible();
    await p.locator('#pdf-search-tool').click();await p.locator('#pdf-search-query').fill('Top-down');await p.locator('#pdf-search-form button[type=submit], #pdf-search-form .primary').click();await expect(p.locator('#pdf-search-status')).toContainText('搜索完成');await expect(p.locator('#pdf-search-results button')).toHaveCount(1);await p.locator('#pdf-search-results button').click();await expect(p.locator('.selected-chunk')).toContainText('Top-down');
    await p.locator('#pdf-setup-tool').click();await p.locator('#pdf-last-page').click();await expect(p.locator('#pdf-page')).toHaveValue('3');
    await p.locator('#pdf-setup-tool').click();await p.locator('[data-pdf-mode=hand]').click();await p.locator('#pdf-scroll').hover();const handStart=await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop);const pane=await p.locator('#pdf-scroll').boundingBox();await p.mouse.move(pane.x+60,pane.y+100);await p.mouse.down();await p.mouse.move(pane.x+60,pane.y+200,{steps:4});await p.mouse.up();expect(await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop)).toBeLessThan(handStart);
    await p.locator('#pdf-edit-close').click();
    // Optional integration with the exact 417-page book used in the user's report.
    if(process.env.TWP_PDF_SAMPLE){
      await p.locator('#pdf-style-tool').click();await p.locator('#pdf-style-reset').click();await p.locator('[data-close-dialog="pdf-style-dialog"]').click();
      await setToggle(p.locator('#pdf-auto-translate'),false);await p.locator('#document-file').setInputFiles(process.env.TWP_PDF_SAMPLE);
      await expect(p.locator('#document-name')).toContainText('417 页');
      await p.locator('#pdf-page').fill('19');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const lists=p.locator('.pdf-translation-page[data-page="19"] [data-kind=list]');await expect(lists).toHaveCount(5);await expect(lists.nth(3)).toContainText('Bottom-up');await expect(lists.nth(3)).not.toContainText('Top-down');await expect(lists.nth(4)).toContainText('Top-down');
      await expect(p.locator('.pdf-source-page[data-page="19"] .pdf-canvas-slot')).toHaveAttribute('data-state','ready');
      await p.locator('.pdf-source-page[data-page="19"] .pdf-source-chunk[aria-label*="Bottom-up"]').click();
      await expect(p.locator('#pdf-reading-position')).toContainText('19');
      await p.screenshot({path:path.resolve('build/pdf-real-list.png')});
      await setToggle(p.locator('#pdf-auto-translate'),true);await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop=document.querySelector('.pdf-page-row[data-page="20"]').offsetTop-80);await expect(p.locator('.pdf-translation-page[data-page="20"] .translation').first()).toBeAttached();
      await p.locator('#pdf-align-page').click();await p.screenshot({path:path.resolve('build/pdf-real-tools.png')});
    }
    for(const width of [384,720,1600]){await p.setViewportSize({width,height:1000});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect(errors).toEqual([]);console.log('PDF tools passed: vector lists, both scroll panes, text selection, notes/drawing/export/import/undo/erase, style, hide top, search, navigation, hand tool and optional real-book regression.');
  }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
