const {chromium}=require('playwright'),{expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),sample=process.env.TWP_PDF_SAMPLE||path.join(process.env.TEMP,'twp-mml-book.pdf');
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-cover-profile-')),{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1800,height:1150},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{
      await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('pdfReaderBilingual',false);
      globalThis.coverInputs=[];
      translationService.translateText=async(service,source,target,texts)=>{
        coverInputs.push(...texts);
        const values={'MATHEMATICS FOR':'数学','MACHINE LEARNING':'机器学习','Marc Peter Deisenroth':'马克·彼得·戴森罗斯','A. Aldo Faisal':'A. 阿尔多·费萨尔','Cheng Soon Ong':'Cheng Soon Ong（作者）'};
        return texts.map(s=>values[s]||s);
      };
    });
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');await p.locator('#document-file').setInputFiles(sample);
    await expect(p.locator('#document-name')).toContainText('417 页');await p.locator('#translate-document').click();
    const surface=p.locator('.pdf-translation-page[data-page="1"] .pdf-layout-surface'),artwork=surface.locator('[data-kind="artwork"] .pdf-formula-image');
    await expect(artwork).toHaveAttribute('data-state','ready');await expect(surface.locator('.translation').first()).toHaveText('数学');
    const source=p.locator('.pdf-source-page[data-page="1"] .pdf-canvas-slot');await expect(source).toHaveAttribute('data-state','ready');
    expect(await worker.evaluate(()=>coverInputs)).toEqual(['MATHEMATICS FOR','MACHINE LEARNING','Marc Peter Deisenroth','A. Aldo Faisal','Cheng Soon Ong']);
    // The title band is teal in the artwork, while the source has white letters.
    // Using raw getOperatorList indices used to leave both these letters and the
    // clipped back-cover text in the background (and drop graphics transforms).
    const white=canvas=>canvas.evaluate(c=>{
      const x=0,y=Math.floor(c.height*.12),w=c.width,h=Math.floor(c.height*.26),data=c.getContext('2d').getImageData(x,y,w,h).data;
      let count=0;for(let i=0;i<data.length;i+=4)if(Math.min(data[i],data[i+1],data[i+2])>230)count++;
      return count/(w*h);
    });
    const originalWhite=await white(source.locator('canvas').first()),backgroundWhite=await white(artwork.locator('canvas'));
    expect(originalWhite).toBeGreaterThan(.025);expect(backgroundWhite).toBeLessThan(originalWhite*.08);
    async function fits(){
      const boxes=await surface.evaluate(s=>{
        const frame=s.getBoundingClientRect();
        return [...s.querySelectorAll('.pdf-positioned-chunk:not([data-kind="artwork"])')].map(n=>{
          const r=n.getBoundingClientRect(),texts=[...n.querySelectorAll('.pdf-positioned-text')];
          return {x:r.x-frame.x,y:r.y-frame.y,right:r.right-frame.x,bottom:r.bottom-frame.y,w:frame.width,h:frame.height,
            textHeight:texts.reduce((h,t)=>h+t.getBoundingClientRect().height,0),height:r.height,overflow:texts.some(t=>t.scrollWidth>n.clientWidth+1)};
        });
      });
      const frame=await surface.evaluate(s=>{const a=s.getBoundingClientRect(),b=s.parentElement.getBoundingClientRect();return {dx:a.x-b.x,dy:a.y-b.y,dw:a.width-b.width};});
      expect(Math.abs(frame.dx)).toBeLessThan(1);expect(Math.abs(frame.dy)).toBeLessThan(1);expect(Math.abs(frame.dw)).toBeLessThan(1);
      expect(boxes).toHaveLength(5);
      for(const box of boxes){expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.y).toBeGreaterThanOrEqual(-1);expect(box.right).toBeLessThanOrEqual(box.w+1);expect(box.bottom).toBeLessThanOrEqual(box.h+1);expect(box.textHeight).toBeLessThanOrEqual(box.height+.6);expect(box.overflow).toBe(false);}
      for(let i=1;i<boxes.length;i++)expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i-1].bottom-1);
    }
    await fits();await p.screenshot({path:path.resolve('build/pdf-cover-translated.png')});
    await p.locator('#bilingual-document').click();await fits();
    for(const zoom of ['1','1.5']){await p.locator('#pdf-zoom').selectOption(zoom);await expect(artwork).toHaveAttribute('data-state','ready');await fits();expect(await white(artwork.locator('canvas'))).toBeLessThan(originalWhite*.08);}
    await p.screenshot({path:path.resolve('build/pdf-cover-bilingual.png')});
    // Stress longer names after a fresh translation; cover boxes must still fit.
    await worker.evaluate(()=>{translationService.translateText=async(service,source,target,texts)=>texts.map(s=>s.startsWith('MATHEMATICS')?'面向机器学习的数学基础与方法':s.startsWith('MACHINE')?'机器学习理论与实践':'这是一位姓名较长的作者·完整译名');});
    await p.locator('#translate-document').click();await expect(surface.locator('.translation').first()).toHaveText('面向机器学习的数学基础与方法');await fits();
    expect(errors).toEqual([]);console.log('Cover: clipped backdrop without original letters, five visible text blocks, Chinese title/names, bilingual, zoom and long names passed.');
  }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
