const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),pdfFixture=require('./pdf-fixture.cjs');
(async()=>{
  const calls=[],timers=new Set(),errors=[];let mode='normal',attempt=0;
  const server=http.createServer((req,res)=>{let raw='';req.on('data',s=>raw+=s);req.on('end',()=>{
    const body=JSON.parse(raw),payload=JSON.parse(body.messages.find(m=>m.role==='user').content),extract=body.messages[0].content.startsWith('Extract');
    calls.push({model:body.model,extract,mode});attempt++;
    const status=mode==='retry'&&attempt===1?503:typeof mode==='number'?mode:200;
    res.writeHead(status,{'content-type':'application/json'});
    if(status!==200)return res.end(JSON.stringify({error:{message:'private-provider-detail SECRET-KEY source-material',type:'error'}}));
    const reply=()=>res.end(JSON.stringify(mode==='invalid-api'?{choices:'private incompatible response'}:{choices:[{message:{role:'assistant',content:mode==='invalid-json'?'not JSON':JSON.stringify(extract?{terms:[['attention','注意力'],['Attention','重复词条'],{source:'translation',translation:'翻译'},['invented','虚构']]}:{translations:payload.segments.map(s=>({id:s.id,text:body.model+'译：'+s.text}))})},finish_reason:mode==='length'?'length':'stop'}],usage:{prompt_tokens:25,completion_tokens:15,total_tokens:40}}));
    if(mode==='slow'){
      // DeepSeek-style non-streaming keep-alives while inference is still running.
      res.write('\n');const timer=setTimeout(()=>{timers.delete(timer);reply();},32000);timers.add(timer);
    }else reply();
  });});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('build/ai-resilience-profile-')),{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1500,height:1050},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pdfAutoTranslate',false);globalThis.freeCalls=0;translationService.translateText=async(service,source,target,texts)=>{freeCalls++;return texts.map(s=>'免费译：'+s);};});
    const settings=await context.newPage();await settings.goto(base+'/options/ai.html');
    const profiles=[];
    for(const model of ['model-a','model-b']){
      if(profiles.length)await settings.getByRole('button',{name:'添加服务',exact:true}).click();
      await settings.locator('#profile-name').fill(model);await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill(model);
      await settings.getByRole('button',{name:'保存服务',exact:true}).click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');profiles.push(await settings.locator('#profiles').inputValue());
    }
    async function request(text){return settings.evaluate(text=>twpAIClient.call({action:'aiTranslate',id:crypto.randomUUID(),segments:[{id:'0',text}],targetLanguage:'zh-CN'}),text);}
    for(const status of [401,402,429,503]){
      mode=status;await expect(request('error-'+status)).rejects.toThrow('HTTP '+status);
    }
    mode='invalid-json';await expect(request('invalid-format')).rejects.toThrow('模型返回格式不正确');
    mode='length';await expect(request('length-limit')).rejects.toThrow('长度上限');
    mode='retry';attempt=0;const retry=await request('temporary-error');expect(retry.cached).toBe(false);expect(attempt).toBe(2);
    mode='normal';
    const reader=await context.newPage();await reader.goto(base+'/options/pdf.html');await reader.locator('#engine').selectOption('openai');await reader.locator('#profile').selectOption(profiles[0]);
    await reader.locator('#document-file').setInputFiles({name:'cache-isolation.pdf',mimeType:'application/pdf',buffer:pdfFixture({pages:[['attention explains translation.']]})});
    const result=reader.locator('.pdf-translation-page[data-page="1"] .translation');
    async function translate(){await reader.locator('#translate-document').click();await expect(reader.locator('#task-status')).toContainText('PDF 翻译完成',{timeout:15000});}
    await translate();await expect(result).toContainText('model-a译：');const aCalls=calls.length;
    await reader.locator('#engine').selectOption('google');await expect(result).toHaveCount(0);await translate();await expect(result).toContainText('免费译：');expect(calls.length).toBe(aCalls);
    await reader.locator('#engine').selectOption('openai');await expect(result).toHaveCount(0);await translate();await expect(result).toContainText('model-a译：');expect(calls.length).toBe(aCalls);
    await reader.locator('#profile').selectOption(profiles[1]);await translate();await expect(result).toContainText('model-b译：');expect(calls.length).toBe(aCalls+1);
    await reader.locator('#profile').selectOption(profiles[0]);await translate();await expect(result).toContainText('model-a译：');expect(calls.length).toBe(aCalls+1);
    const next=context.waitForEvent('page');await reader.locator('#ai-insights').click();const insight=await next;await insight.waitForLoadState();
    mode=503;await insight.locator('#extract').click();await expect(insight.locator('#notice')).toContainText('HTTP 503',{timeout:15000});await expect(insight.locator('#notice')).not.toContainText('SECRET-KEY');
    mode='normal';await insight.locator('#extract').click();await expect(insight.locator('#notice')).toContainText('尚未保存');await expect(insight.locator('#terms')).toHaveValue('attention = 注意力\ntranslation = 翻译');
    // Exercise two concurrent requests past the old 25-second body deadline.
    mode='slow';
    await insight.locator('#extract').click();await reader.locator('#retranslate-document').click();
    await expect(insight.locator('#notice')).toContainText('尚未保存',{timeout:45000});await expect(reader.locator('#task-status')).toContainText('PDF 翻译完成',{timeout:45000});
    mode='normal';const count=calls.length;await translate();expect(calls.length).toBe(count);
    // A genuinely invalid HTTP payload gives a safe API diagnostic, not source data.
    mode='invalid-api';await expect(request('incompatible-api-response')).rejects.toThrow('不兼容');
    expect(errors).toEqual([]);console.log('AI resilience passed: safe nested HTTP errors, transient retry, incomplete output, candidate deduplication, 32-second terms/translation responses, free/AI/profile cache isolation and valid-result reuse.');
  }finally{await context.close();for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
