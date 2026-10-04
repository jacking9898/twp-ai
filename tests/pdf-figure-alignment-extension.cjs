const {chromium}=require('playwright'),{expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
  const calls=[],errors=[];let long=false;
  const server=http.createServer((req,res)=>{let raw='';req.on('data',s=>raw+=s);req.on('end',()=>{
    const payload=JSON.parse(JSON.parse(raw).messages.find(m=>m.role==='user').content);calls.push(payload);
    const translate=s=>{
      if(s==='4.1 Determinant and Trace')return '4.1 行列式与迹';
      if(s.startsWith('Figure 4.1'))return '图 4.1 本章概念的思维导图，以及它们在本书其他章节中的应用。';
      if(s.startsWith('The determinant notation'))return s.replace('The determinant notation','行列式记号').replace('must not be confused with the absolute value.','不能与绝对值混淆。');
      if(s.startsWith('both subsequent'))return '既出现在后续的数学章节中，例如第六章，也出现在应用章节中，例如第十章的降维和第十一章的密度估计。本章的整体结构如图 4.1 所示。'.repeat(long?18:1);
      const markers=s.match(/__TWP_MATH_\d+__/g)||[];
      if(s.startsWith('Determinants are important'))return '行列式是线性代数中的重要概念，也是分析和求解线性方程组的数学对象。行列式只对方阵定义，即行数与列数相同的矩阵。本书使用下列记号：'+markers.join(' ');
      return '测试译文：'+s;
    };
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:payload.segments.map(s=>({id:s.id,text:translate(s.text)}))})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}}));
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),sample=process.env.TWP_PDF_SAMPLE||path.join(process.env.TEMP,'twp-mml-book.pdf');
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/pdf-figure-alignment-profile-')),{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1800,height:1150},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);twpConfig.set('pdfReaderBilingual',false);});
    const settings=await context.newPage();await settings.goto(base+'/options/ai.html');await settings.locator('#profile-name').fill('Figure alignment test');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('alignment-test');await settings.getByRole('button',{name:'保存服务',exact:true}).click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
    const p=await context.newPage();await p.goto(base+'/options/pdf.html');await p.locator('#engine').selectOption('openai');
    await p.locator('#document-file').setInputFiles(sample);await expect(p.locator('#document-name')).toContainText('417 页');
    await p.locator('#pdf-page').fill('105');await p.locator('#pdf-page').press('Tab');await p.locator('#translate-document').click();
    const surface=p.locator('.pdf-translation-page[data-page="105"] .pdf-layout-surface'),source=p.locator('.pdf-source-page[data-page="105"] .pdf-canvas-slot');
    await expect(surface.locator('.pdf-positioned-chunk[data-kind="figure"]')).toHaveCount(1);await expect(source).toHaveAttribute('data-state','ready');
    const ids={};
    for(const [key,text]of Object.entries({header:'4.1 Determinant and Trace',note:'The determinant notation',body:'Determinants are important',lead:'both subsequent'}))ids[key]=await source.locator(`.pdf-source-chunk[aria-label*="译文：${text}"]`).first().getAttribute('data-chunk');
    const target=key=>surface.locator(`[data-chunk="${ids[key]}"]`),original=key=>source.locator(`[data-chunk="${ids[key]}"]`);
    await expect(target('header')).toHaveText('4.1 行列式与迹');await expect(target('note')).toContainText('不能与绝对值混淆');
    const rect=node=>node.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};});
    async function aligned(){
      const header=await rect(target('header')),figure=await rect(surface.locator('.pdf-positioned-chunk[data-kind="figure"]')),page=await rect(surface.locator('[data-page-number]'));
      expect(header.bottom).toBeLessThanOrEqual(figure.y+1);expect(Math.abs(header.y-page.y)).toBeLessThan(2);
      const note=await rect(target('note')),body=await rect(target('body')),sn=await rect(original('note')),sb=await rect(original('body'));
      expect(note.x).toBeGreaterThan(body.right);expect(Math.abs((note.y-body.y)-(sn.y-sb.y))).toBeLessThan(2);
      const caption=await rect(surface.locator('.pdf-positioned-chunk').filter({hasText:'图 4.1 本章概念'}));expect(Math.abs(caption.y-figure.y)).toBeLessThan(3);
      return note.y;
    }
    const baseline=await aligned();await p.locator('#pdf-align-page').click();await p.screenshot({path:path.resolve('build/pdf-figure-page105-aligned.png')});
    const input=calls.flatMap(p=>p.segments.map(s=>s.text));expect(input).toContain('4.1 Determinant and Trace');expect(input).not.toContain('99');expect(input).not.toContain('Eigenvalues');expect(input.some(s=>s.startsWith('The determinant notation'))).toBe(true);
    const before=calls.length;await p.locator('#translate-document').click();await expect(p.locator('#translate-document')).toBeEnabled();expect(calls.length).toBe(before);await aligned();
    long=true;await p.locator('#retranslate-document').click();await expect(p.locator('#retranslate-document')).toBeEnabled();
    await expect(target('lead')).toContainText('密度估计');expect(await aligned()).toBeGreaterThan(baseline+100);
    await target('body').scrollIntoViewIfNeeded();await p.screenshot({path:path.resolve('build/pdf-figure-page105-note-growth.png')});
    await p.locator('#bilingual-document').click();await expect(target('header').locator('.original')).toBeAttached();await aligned();
    await p.locator('#pdf-zoom').selectOption('1.5');await aligned();
    expect(errors).toEqual([]);console.log('Page 105: AI translation/cache, header above complete diagram, page number preserved, captions and marginal notes anchored through long prose, bilingual and zoom passed.');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
