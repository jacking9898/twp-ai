async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),errors=[];
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-typeset-profile-')),{channel:process.env.TWP_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('targetLanguage','zh-CN');globalThis.pdfRequests=0;globalThis.pdfLong=false;
      translationService.translateText=async(service,source,target,texts)=>{globalThis.pdfRequests++;await new Promise(r=>setTimeout(r,100));return texts.map(s=>{
        if(globalThis.pdfLong)return '完整的长译文，需要展开查看所有内容。'.repeat(120);
        if(s==='Foreword')return '前言';
        if(s.startsWith('Why Another'))return '为什么还要再写一本关于机器学习的书？';
        if(s.startsWith('Who Is'))return '目标受众是谁？';
        if(s.startsWith('“Math')||s.startsWith('A margin'))return '数学与恐惧和焦虑联系在一起。（Strogatz，2014，第281页）';
        return '这是保留原文区域位置的译文。'+('机器学习建立在数学语言的基础上，帮助读者理解概念及其应用。'.repeat(Math.max(1,Math.ceil(s.length/120))));
      });};});
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');
    await expect(p.locator('#pdf-layout-mode')).toHaveCount(0);await expect(p.locator('#bilingual-document')).toHaveAttribute('aria-pressed','false');
    await p.locator('#document-file').setInputFiles({name:'regions.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[[
      {text:'3',x:490,y:765,size:10},{text:'Foreword',x:140,y:765,size:10},
      {text:'Why Another Book?',x:210,y:705,size:18},
      {text:'A body paragraph remains in its own column.',x:140,y:665,size:12},
      {text:'More body text on the next line.',x:140,y:650,size:12},
      {text:'A margin note',x:35,y:650,size:9},{text:'beside the body.',x:35,y:638,size:9},
      {text:'This continuation belongs to the body.',x:140,y:635,size:12},
      {text:'Who Is the Target Audience?',x:190,y:580,size:18},
      {text:'The next paragraph must not overlap the heading.',x:140,y:550,size:12},
      {text:'Draft footer and publication information.',x:140,y:80,size:8}
    ],['Second page','A new page for automatic translation.']],outline:true})});
    const surface=p.locator('.pdf-translation-page[data-page="1"] .pdf-layout-surface');
    await expect(surface).toBeAttached();
    const source=p.locator('.pdf-source-page[data-page="1"] .pdf-canvas-slot');await expect(source).toHaveAttribute('data-state','ready');
    const num=surface.locator('[data-page-number]');await expect(num.locator('.translation')).toHaveText('3');
    const find=(text)=>surface.locator('.pdf-positioned-chunk').filter({hasText:text}).first();
    const rect=async node=>node.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
    let frame=await rect(surface),number=await rect(num),header=await rect(find('前言'));
    expect(Math.abs(number.y-header.y)).toBeLessThan(2);expect(number.x-frame.x).toBeGreaterThan(frame.w*.8);
    const note=await rect(find('数学与恐惧')),body=await rect(surface.locator('[data-chunk="3"]'));
    expect(note.x+note.w).toBeLessThan(body.x);
    // Coordinates, including page number and sidebar, stay tied to the original at every zoom.
    const checkCoordinates=async()=>{
      const positions=await p.evaluate(()=>{const original=document.querySelector('.pdf-source-page[data-page="1"] .pdf-canvas-slot'),translated=document.querySelector('.pdf-translation-page[data-page="1"] .pdf-layout-surface');const a=original.getBoundingClientRect(),b=translated.getBoundingClientRect();return [...translated.children].map(n=>{const match=original.querySelector(`[data-chunk="${n.dataset.chunk}"]`),x=match.getBoundingClientRect(),y=n.getBoundingClientRect();return {dx:Math.abs(x.x-a.x-(y.x-b.x)),dy:(y.y-b.y)-(x.y-a.y),dw:Math.abs(x.width-y.width)};});});
      for(const r of positions){expect(r.dx).toBeLessThan(2);expect(r.dy).toBeGreaterThan(-2);expect(r.dw).toBeLessThan(2);}
    };
    await checkCoordinates();
    await p.locator('#pdf-zoom').selectOption('1.5');await expect(source).toHaveAttribute('data-state','ready');await checkCoordinates();
    await p.locator('#pdf-zoom').selectOption('fit');await expect(source).toHaveAttribute('data-state','ready');
    const count=await worker.evaluate(()=>globalThis.pdfRequests);
    await setToggle(p.locator('#bilingual-document'),true);await expect(surface.locator('.original').first()).toBeAttached();await expect(p.locator('#pdf-style-original')).toHaveAttribute('aria-pressed','true');
    await setToggle(p.locator('#bilingual-document'),false);await expect(surface.locator('.original')).toHaveCount(0);await expect(surface).toBeAttached();expect(await worker.evaluate(()=>globalThis.pdfRequests)).toBe(count);
    await worker.evaluate(()=>globalThis.pdfLong=true);await p.locator('#translate-document').click();
    await expect(p.locator('#translate-document')).toBeEnabled();
    await expect(surface.locator('.pdf-positioned-chunk:not([data-page-number]) .translation').first()).toHaveText('完整的长译文，需要展开查看所有内容。'.repeat(120));
    await expect(surface.locator('.pdf-layout-expand:visible')).toHaveCount(0);
    expect(await surface.evaluate(n=>n.offsetHeight)).toBeGreaterThan(await source.evaluate(n=>n.offsetHeight));
    expect(await surface.locator('.pdf-positioned-text').evaluateAll(nodes=>nodes.every(n=>n.scrollHeight<=n.parentElement.clientHeight+1))).toBe(true);
    await worker.evaluate(()=>globalThis.pdfLong=false);
    await p.locator('#pdf-scroll').evaluate(n=>n.scrollTop=document.querySelector('.pdf-page-row[data-page="2"]').offsetTop+100);
    await expect(p.locator('.pdf-translation-page[data-page="2"] .pdf-layout-surface')).toBeAttached();
    await expect(p.locator('#pdf-page')).toHaveValue('2');
    await expect(p.locator('.pdf-source-page[data-page="2"] .pdf-source-chunk').first()).toBeAttached();
    await p.locator('.pdf-source-page[data-page="2"] .pdf-source-chunk').first().click();
    await expect(p.locator('.pdf-translation-page[data-page="2"] .selected-chunk')).toHaveCount(1);
    await setToggle(p.locator('#pdf-auto-translate'),false);
    await p.locator('#document-file').setInputFiles({name:'mixed-sizes.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:Array.from({length:10},(_,i)=>[`Page ${i+1}`,'Some text in a page of this document.']),sizes:Array.from({length:10},(_,i)=>i===9?[720,1000]:[595,842])})});
    await expect(p.locator('#document-name')).toContainText('mixed-sizes.pdf');
    await p.locator('#pdf-scope').selectOption('all');await p.locator('#translate-document').click();
    const finalSurface=p.locator('.pdf-translation-page[data-page="10"] .pdf-layout-surface');await expect(finalSurface).toBeAttached({timeout:15000});
    const finalSize=await rect(finalSurface);expect(finalSize.h/finalSize.w).toBeGreaterThanOrEqual(1000/720-.002);
    await expect(p.locator('#translate-document')).toBeEnabled();await p.locator('#pdf-scope').selectOption('page');
    if(process.env.TWP_PDF_SAMPLE){
      await worker.evaluate(()=>globalThis.pdfLong=false);await setToggle(p.locator('#pdf-auto-translate'),false);await p.locator('#document-file').setInputFiles(process.env.TWP_PDF_SAMPLE);await expect(p.locator('#document-name')).toContainText('417 页');
      await p.locator('#pdf-page').fill('8');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const page=p.locator('.pdf-translation-page[data-page="8"]'),s=page.locator('.pdf-layout-surface');await expect(s).toBeAttached();
      const sidebar=s.locator('.pdf-positioned-chunk').filter({hasText:'数学与恐惧'});
      const br=await rect(sidebar),sr=await rect(s);expect((br.x-sr.x)/sr.w).toBeLessThan(.15);expect(br.w/sr.w).toBeLessThan(.15);
      await expect(s.locator('[data-page-number] .translation')).toHaveText('2');
      const merged=await rect(p.locator('.pdf-source-page[data-page="8"] .pdf-source-chunk[aria-label*="This book"]'));
      expect(merged.h/sr.h).toBeGreaterThan(.3);
      await p.screenshot({path:path.resolve('build/pdf-layout-book-page8.png')});
      const beforeBilingual=await worker.evaluate(()=>globalThis.pdfRequests);
      await setToggle(p.locator('#bilingual-document'),true);
      await expect(s.locator('.original').first()).toBeAttached();
      expect(await s.locator('.pdf-positioned-chunk').evaluateAll(nodes=>nodes.every(n=>n.scrollHeight<=n.clientHeight+1))).toBe(true);
      await p.screenshot({path:path.resolve('build/pdf-layout-book-page8-bilingual.png')});
      await setToggle(p.locator('#bilingual-document'),false);
      expect(await worker.evaluate(()=>globalThis.pdfRequests)).toBe(beforeBilingual);
      await p.locator('#pdf-page').fill('9');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const p9=p.locator('.pdf-translation-page[data-page="9"] .pdf-layout-surface');await expect(p9).toBeAttached();
      const nr=await rect(p9.locator('[data-page-number]')),hr=await rect(p9.locator('.pdf-positioned-chunk').filter({hasText:'前言'}));expect(nr.x).toBeGreaterThan(hr.x);expect(Math.abs(nr.y-hr.y)).toBeLessThan(2);
      await p.screenshot({path:path.resolve('build/pdf-layout-book-page9.png')});
      await worker.evaluate(()=>{const original=translationService.translateText;translationService.translateText=async(...args)=>(await original(...args)).map((value,i)=>args[3][i].startsWith('To compute the inverse')?'为了计算逆矩阵，我们需要求解相应的线性方程组。这里的上标和下标属于同一个正文段落，译文变长时应完整显示，并让后续公式自动向下排列。'.repeat(8):value);});
      await p.locator('#pdf-page').fill('39');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const p39=p.locator('.pdf-translation-page[data-page="39"] .pdf-layout-surface');await expect(p39).toBeAttached();
      const inverse=p39.locator('.pdf-positioned-chunk').filter({hasText:'为了计算逆矩阵'});await expect(inverse).toHaveCount(1);
      const originalInverse=p.locator('.pdf-source-page[data-page="39"] .pdf-source-chunk[aria-label*="To compute the inverse"]');
      expect((await inverse.boundingBox()).height).toBeGreaterThan((await originalInverse.boundingBox()).height);
      expect(await inverse.evaluate(n=>n.firstElementChild.scrollHeight<=n.clientHeight+1)).toBe(true);
      expect(await p39.evaluate(surface=>{const n=[...surface.children].find(n=>n.textContent.includes('为了计算逆矩阵')),r=n.getBoundingClientRect(),next=[...surface.children].filter(other=>other!==n&&Number(other.dataset.chunk)>Number(n.dataset.chunk)&&other.dataset.kind==='formula')[0]?.getBoundingClientRect();return !!next&&next.top>=r.bottom;})).toBe(true);
      await inverse.scrollIntoViewIfNeeded();await p.screenshot({path:path.resolve('build/pdf-layout-book-page39-growth.png')});
      // Preserve example panels and source alignment, even after translated text grows.
      expect(await p39.evaluate(n=>getComputedStyle(n).backgroundImage)).toContain('rgb(245, 245, 245)');
      await worker.evaluate(()=>{translationService.translateText=async(service,source,target,texts)=>{globalThis.pdfRequests++;return texts.map(s=>{
        if(s.startsWith('Example 2.9'))return '例 2.9（用高斯消元法计算逆矩阵）';
        if(s==='Moore-Penrose pseudo-inverse')return '摩尔－彭罗斯伪逆';
        if(s.startsWith('and use the Moore-Penrose'))return '利用摩尔－彭罗斯伪逆求解线性方程组，并保持边注独立。'.repeat(4);
        return '测试译文：保留原来的段落位置，内容变长时自动向下扩展。';
      });};});
      await p.locator('#pdf-page').fill('40');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const p40=p.locator('.pdf-translation-page[data-page="40"] .pdf-layout-surface');await expect(p40).toBeAttached();
      const example=p40.locator('[data-kind=heading]').filter({hasText:'例 2.9'});await expect(example).toHaveCount(1);
      expect(await example.evaluate(n=>getComputedStyle(n).textAlign)).toBe('left');
      expect(await p40.evaluate(n=>getComputedStyle(n).backgroundImage)).toContain('rgb(245, 245, 245)');
      await p.locator('#pdf-align-page').click();await p.screenshot({path:path.resolve('build/pdf-layout-book-page40-panel.png')});
      const originalPanelHeight=await p40.evaluate(n=>parseFloat(n.style.backgroundSize.split(' ')[1]));
      await setToggle(p.locator('#bilingual-document'),true);
      expect(await p40.evaluate(n=>parseFloat(n.style.backgroundSize.split(' ')[1]))).toBeGreaterThan(originalPanelHeight);
      await setToggle(p.locator('#bilingual-document'),false);
      await p.locator('#pdf-page').fill('41');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
      const p41=p.locator('.pdf-translation-page[data-page="41"] .pdf-layout-surface');await expect(p41).toBeAttached();
      const source41=p.locator('.pdf-source-page[data-page="41"]');
      const noteSource=source41.locator('.pdf-source-chunk[aria-label*="块译文：Moore-Penrose"]');await expect(noteSource).toHaveCount(1);
      const noteID=await noteSource.getAttribute('data-chunk');
      const note41=p41.locator(`[data-chunk="${noteID}"]`),body41=p41.locator('.pdf-positioned-chunk').filter({hasText:'利用摩尔'});
      expect(await body41.getAttribute('data-kind')).toBe('paragraph');
      const nr41=await rect(note41),br41=await rect(body41);
      expect(nr41.x).toBeGreaterThan(br41.x+br41.w);expect(Math.abs(nr41.y-br41.y)).toBeLessThan(25);
      await p.locator('#pdf-align-page').click();await p.screenshot({path:path.resolve('build/pdf-layout-book-page41-margin.png')});
    }
    await setToggle(p.locator('#bilingual-document'),true);await p.reload();await expect(p.locator('#bilingual-document')).toHaveAttribute('aria-pressed','true');await expect(p.locator('#pdf-style-original')).toHaveAttribute('aria-pressed','true');await expect(p.locator('#pdf-layout-mode')).toHaveCount(0);
    expect(errors).toEqual([]);console.log('PDF typesetting passed: aligned headings, positioned headers/numbers/sidebar/body, zoom, bilingual growth, persistence and optional real-book pages 8/9/39/40/41 with expanding panels and separate margin notes.');
  }finally{await context.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
