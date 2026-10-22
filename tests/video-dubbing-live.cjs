// SPDX-License-Identifier: MPL-2.0
// Explicit opt-in: real public page, real captureStream, real local inference.
const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
(async()=>{
  const url=process.env.YEDU_LIVE_VIDEO;
  if(!url||!/^https:\/\/(www\.bilibili\.com\/video\/BV[\w]+|www\.youtube\.com\/watch\?v=[\w-]+)/.test(url))throw new Error('Set YEDU_LIVE_VIDEO to a public Bilibili or YouTube video URL.');
  const name=url.includes('bilibili')?'bilibili':'youtube';
  const folder=path.join(root,'.local-data/voice/evaluation',name+'-browser');fs.mkdirSync(folder,{recursive:true});
  const rows=[],errors=[];let context,page,manager,firstPlayback,startupSeconds;
  const testAutoStart=process.env.YEDU_TEST_AUTOSTART==='1';
  const browserProfile=path.join(folder,'profile-'+Date.now());
  try{
    context=await chromium.launchPersistentContext(browserProfile,{
      channel:process.env.TWP_BROWSER_CHANNEL||'chromium',headless:true,
      ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),
      viewport:{width:1440,height:1000},
      args:[`--disable-extensions-except=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,
        `--load-extension=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,
        '--autoplay-policy=no-user-gesture-required','--mute-audio'],
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    if(testAutoStart){
      const extensionId=new URL(worker.url()).host;
      execFileSync(path.join(root,'.local-data/voice/.venv/bin/python'),[path.join(root,'local-voice/install_bridge.py'),'--browser-root',browserProfile,'--extension-id',extensionId]);
      manager=await context.newPage();await manager.goto(`chrome-extension://${extensionId}/options/voice-service.html`);
      await expect(manager.locator('#state')).toHaveText(/已就绪|未启动/,{timeout:15000});
      if(await manager.locator('#state').textContent()==='未启动'){await manager.locator('#start').click();await expect(manager.locator('#state')).toHaveText('已就绪',{timeout:180000});}
      await manager.locator('#stop').click();await expect(manager.locator('#state')).toHaveText('未启动',{timeout:15000});
      await manager.locator('#auto-start').uncheck();
    }
    // Observe only local model responses, never credentials or browser state.
    worker.on('console',message=>{
      const value=message.text();if(!value.startsWith('YEDU_LIVE_RESULT '))return;
      const row=JSON.parse(value.slice(17));rows.push(row);
      if(row.audio&&!rows.slice(0,-1).some(item=>item.duration>0))fs.writeFileSync(path.join(folder,'first-dub.wav'),Buffer.from(row.audio,'base64'));
      delete row.audio;console.log(JSON.stringify(row));
    });
    await worker.evaluate(async()=>{
      await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');
      const original=globalThis.fetch;
      globalThis.fetch=async(...args)=>{
        const response=await original(...args);
        if(String(args[0]).endsWith('/recognize-dub')){
          const row=await response.clone().json();
          console.log('YEDU_LIVE_RESULT '+JSON.stringify({status:response.status,...row}));
        }
        return response;
      };
    });
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',req=>{if(!req.url().includes('log'))console.log('NETWORK '+new URL(req.url()).hostname+' '+new URL(req.url()).pathname.slice(0,120)+' '+req.failure()?.errorText);});await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('video').first().waitFor({timeout:30000});
    const videos=await page.locator('video').all();let video=videos[0];
    for(const candidate of videos)if(await candidate.evaluate(v=>v.getBoundingClientRect().width>300)){video=candidate;break;}
    // Starting/stopping only the isolated browser's player is part of this test.
    await video.evaluate(async v=>{v.currentTime=0;v.muted=false;await Promise.race([v.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Real video did not start within 25 seconds')),25000))]);});
    const panel=page.locator('#twp-video-translator');await expect(panel).toHaveCount(1,{timeout:20000});
    console.log(JSON.stringify(await video.evaluate(v=>({time:v.currentTime,ready:v.readyState,paused:v.paused,parent:v.parentElement.className,controls:document.querySelectorAll('.bpx-player-control-bottom-right').length}))));await page.bringToFront();const bounds=await video.boundingBox();await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.move(bounds.x+bounds.width-160,bounds.y+bounds.height-20,{steps:8});await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await video.evaluate(v=>v.pause());await page.screenshot({path:path.join(folder,'before-start.png')});
    await panel.locator('#voice-mode').selectOption('audio');
    if(!testAutoStart){await panel.locator('#voice-profiles-refresh').click();await expect(panel.locator('#voice-profile')).toHaveValue('source');}
    if(testAutoStart){
      await panel.locator('#voice-start').click();await expect(panel.locator('#voice-status')).toContainText('模型服务未运行',{timeout:15000});
      await expect(manager.locator('#state')).not.toHaveText('启动中');
      await manager.locator('#auto-start').check();await expect(manager.locator('#auto-start')).toBeEnabled();
    }
    const startupStarted=Date.now();
    await panel.locator('#voice-start').click();
    if(testAutoStart){await expect(manager.locator('#state')).toHaveText('启动中',{timeout:15000});await manager.screenshot({path:path.join(folder,'model-starting.png')});}
    await expect(panel.locator('#player-voice')).toContainText('实时识别',{timeout:testAutoStart?180000:15000});
    if(testAutoStart){startupSeconds=(Date.now()-startupStarted)/1000;console.log('MODEL_STARTUP '+startupSeconds);}
    const playbackStarted=Date.now();await video.evaluate(async v=>{v.currentTime=0;await v.play();});console.log('Live player started: '+await page.title());
    await expect(page.locator('[data-yedu-live-voice]')).toBeVisible({timeout:20000});firstPlayback={wallSeconds:(Date.now()-playbackStarted)/1000,videoTime:await video.evaluate(v=>v.currentTime),caption:await page.locator('[data-yedu-live-voice]').textContent()};console.log('FIRST_PLAYBACK '+JSON.stringify(firstPlayback));
    for(let interval=0;interval<2;interval++){
      await page.waitForTimeout(20000);
      const state={at:await video.evaluate(v=>v.currentTime),paused:await video.evaluate(v=>v.paused),
        status:await panel.locator('#voice-status').textContent(),transcript:await panel.locator('#voice-live-text').textContent()};
      console.log(JSON.stringify(state));
      await page.screenshot({path:path.join(folder,`playing-${interval}.png`)});
      if(manager){await expect(manager.locator('#original')).not.toHaveText('尚无输出');await expect(manager.locator('#events')).toContainText('开始配音');await manager.screenshot({path:path.join(folder,'model-ready-live.png')});}
      if(await panel.locator('#voice-start').getAttribute('aria-pressed')!=='true')throw new Error('Voice translation stopped: '+state.status);
    }
    if(!rows.some(row=>row.audioSeconds||row.duration>0))throw new Error('No real translated speech returned.');
    const voiced=rows.filter(row=>row.duration>0);
    if(voiced.some(row=>row.status!==200||row.voiceSource!=='speaker'))throw new Error('Inference did not use the real speaker reference.');
    await video.evaluate(v=>v.pause());await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
    await video.evaluate(async v=>{v.currentTime=10;await v.play();});await page.waitForTimeout(10000);
    await page.screenshot({path:path.join(folder,'after-seek.png')});
    await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
    if(manager){
      await manager.locator('#stop').click();await expect(manager.locator('#state')).toHaveText('未启动',{timeout:15000});
      await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');
      if(await video.evaluate(v=>v.muted))throw new Error('Stopping the model did not restore the original audio.');
      await manager.locator('#clear').click();await expect(manager.locator('#events')).toBeEmpty();
      // Cancel a genuine cold start, then start again. This covers the process
      // creation race as well as a user stopping an already-ready service.
      await manager.locator('#start').click();await expect(manager.locator('#state')).toHaveText('启动中',{timeout:15000});
      await manager.locator('#stop').click();await expect(manager.locator('#state')).toHaveText('未启动',{timeout:15000});
      await expect(manager.locator('#start')).toBeEnabled({timeout:15000});
      await manager.locator('#start').click();await expect(manager.locator('#state')).toHaveText('已就绪',{timeout:180000});
      await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');
    }
    await video.evaluate(v=>v.pause());await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
    if(!manager)await panel.locator('#voice-start').click();await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');
    if(await video.evaluate(v=>v.muted))throw new Error('Original sound was not restored.');
    fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({url,title:await page.title(),startupSeconds,firstPlayback,rows,errors},null,2));
    console.log('Real browser voice pipeline passed (quality requires review): '+voiced.length+' spoken segments.');
  }catch(error){
    if(page&&!page.isClosed()){await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({error:error.message,state:await page.evaluate(()=>({text:document.body.innerText.slice(0,5000),videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,ready:v.readyState,paused:v.paused,error:v.error?.code}))})).catch(()=>null)},null,2));}
    throw error;
  }finally{
    fs.writeFileSync(path.join(folder,'observations.json'),JSON.stringify({firstPlayback,rows,errors},null,2));
    await context?.close();
  }
// This is a standalone CLI. After the browser has closed and artifacts have
// been written, do not let leftover automation timers retain the test process.
})().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
