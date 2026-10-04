const {chromium}=require('playwright'),{expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),sample=process.env.TWP_PDF_SAMPLE||path.join(process.env.TEMP,'twp-mml-book.pdf');
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-structure-profile-')),{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1800,height:1150},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('pdfReaderBilingual',false);globalThis.structureInputs=[];translationService.translateText=async(service,source,target,texts)=>{structureInputs.push(...texts);return texts.map(s=>'译文：'+s);};});
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');await p.locator('#document-file').setInputFiles(sample);await expect(p.locator('#document-name')).toContainText('417 页');
    if(await p.locator('#bilingual-document').getAttribute('aria-pressed')==='true')await p.locator('#bilingual-document').click();
    async function page(number){await worker.evaluate(()=>{structureInputs=[];});await p.locator('#pdf-page').fill(String(number));await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();const surface=p.locator(`.pdf-translation-page[data-page="${number}"] .pdf-layout-surface`);await expect(surface).toBeAttached();await expect(p.locator('#task-status')).toContainText(`第 ${number} 页`);return surface;}
    for(const number of [3,4,413]){
      const surface=await page(number),rows=surface.locator('.pdf-entry-row');await expect(rows).toHaveCount(number===3?31:number===4?42:89);
      const positions=await rows.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),p=n.querySelector('.pdf-entry-page').getBoundingClientRect();return {x:r.x,y:r.y,b:r.bottom,pageY:p.y,page:n.querySelector('.pdf-entry-page').textContent};}));
      for(const row of positions)expect(Math.abs(row.y-row.pageY)).toBeLessThan(2);
      for(let i=1;i<positions.length;i++)if(Math.abs(positions[i].x-positions[i-1].x)<20)expect(positions[i].y).toBeGreaterThanOrEqual(positions[i-1].b-1);
      const input=await worker.evaluate(()=>structureInputs);expect(input).not.toContain('ii');expect(input).not.toContain('181');
      if(number===4){expect(input).toContain('Eigenvalues and Eigenvectors');expect(input.some(t=>/4\.2 Eigenvalues/.test(t))).toBe(false);await p.screenshot({path:path.resolve('build/pdf-contents-page4.png')});}
    }
    // Row height may grow, but title, label and page must keep their association.
    await worker.evaluate(()=>{translationService.translateText=async(service,source,target,texts)=>texts.map(s=>'长译文条目，保留编号和页码。'.repeat(8));});
    await p.locator('#pdf-page').fill('4');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
    const longRows=p.locator('.pdf-translation-page[data-page="4"] .pdf-entry-row');await expect(longRows.first()).toContainText('长译文条目');
    const grown=await longRows.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),page=n.querySelector('.pdf-entry-page').getBoundingClientRect();return {y:r.y,b:r.bottom,pageY:page.y};}));
    for(let i=0;i<grown.length;i++){expect(Math.abs(grown[i].y-grown[i].pageY)).toBeLessThan(2);if(i)expect(grown[i].y).toBeGreaterThanOrEqual(grown[i-1].b-1);}
    await worker.evaluate(()=>{translationService.translateText=async(service,source,target,texts)=>{structureInputs.push(...texts);return texts.map(s=>'译文：'+s);};});
    for(const [number,minFigures] of [[47,1],[87,1],[161,4],[178,1],[242,2],[331,1],[345,1],[380,1],[1,1]]){
      const surface=await page(number),figures=surface.locator('[data-kind="figure"].pdf-positioned-chunk,[data-kind="artwork"].pdf-positioned-chunk');await expect(figures).toHaveCount(minFigures);
      for(const figure of await figures.all()){
        await figure.scrollIntoViewIfNeeded();await expect(figure.locator('.pdf-formula-image')).toHaveAttribute('data-state','ready');
        const pixels=await figure.locator('canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let colored=0;for(let i=0;i<d.length;i+=4)if(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])>45)colored++;return {colored,w:c.width,h:c.height};});
        expect(pixels.colored,`page ${number}: figure colors`).toBeGreaterThan(100);expect(pixels.h).toBeGreaterThan(35);
      }
      const inputs=await worker.evaluate(()=>structureInputs),input=inputs.join('\n');if(number===47){expect(inputs).not.toContain('Kampala');expect(inputs).not.toContain('Nairobi');expect(inputs).not.toContain('374 km Southwest');}if(number===345)expect(inputs).not.toContain('Number of PCs');
      if(number===161)expect(inputs).not.toContain('illustrated above.');
      if(number===161 || number===47)await p.screenshot({path:path.resolve(`build/pdf-figures-page${number}.png`)});
      if(number===1){await expect(surface).toHaveClass(/pdf-layout-cover/);await expect(surface.locator('.translation').first()).toContainText('译文');}
    }
    const surface=await page(220);await expect(surface.locator('[data-kind="formula"].pdf-positioned-chunk')).toHaveCount(3);
    const inputs=await worker.evaluate(()=>structureInputs);expect(inputs).not.toContain('exp');expect(inputs).not.toContain('α log');expect(inputs.some(t=>/^p\(μ/.test(t))).toBe(false);
    await surface.locator('.pdf-formula-image').first().scrollIntoViewIfNeeded();await expect(surface.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
    await p.locator('#pdf-zoom').selectOption('1.5');await expect(surface.locator('.pdf-formula-image').first()).toHaveAttribute('data-state','ready');
    await p.screenshot({path:path.resolve('build/pdf-formulas-page220.png')});
    expect(errors).toEqual([]);console.log('Real PDF: contents/index rows, nine figure pages, cover, exp/log equations, zoom and page errors passed.');
  }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
