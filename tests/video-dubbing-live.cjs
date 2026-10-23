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
  const label=process.env.YEDU_LIVE_LABEL||'';
  if(label&&!/^[a-zA-Z0-9_-]{1,80}$/.test(label))throw new Error('Invalid evaluation label');
  const startAt=Number(process.env.YEDU_LIVE_START||0),seconds=Number(process.env.YEDU_LIVE_SECONDS||40);
  if(!Number.isFinite(startAt)||startAt<0||startAt>36000||!Number.isFinite(seconds)||seconds<10||seconds>300)throw new Error('Invalid evaluation duration');
  const name=(url.includes('bilibili')?'bilibili':'youtube')+(label?'-'+label:'');
  const folder=path.join(root,'.local-data/voice/evaluation',name+'-browser');fs.mkdirSync(folder,{recursive:true});
  const rows=[],errors=[],events=[],states=[];let pictures=[];let context,page,manager,firstPlayback,startupSeconds,phase='continuous';
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
      const value=message.text();if(value.startsWith('YEDU_LIVE_FETCH ')){console.log(value);return;}
      if(value.startsWith('YEDU_LIVE_EVENT ')){events.push({...JSON.parse(value.slice(16)),phase});return;}
      if(!value.startsWith('YEDU_LIVE_RESULT '))return;
      const row={...JSON.parse(value.slice(17)),phase};rows.push(row);
      if(process.env.YEDU_CAPTURE_AUDIO==='1'){
        const id=String(rows.length).padStart(3,'0');
        if(row.sourceAudio){row.sourceFile=id+'-source.wav';fs.writeFileSync(path.join(folder,row.sourceFile),Buffer.from(row.sourceAudio,'base64'));}
        if(row.audio){row.dubFile=id+'-dub.wav';fs.writeFileSync(path.join(folder,row.dubFile),Buffer.from(row.audio,'base64'));}
      }
      if(row.audio&&!rows.slice(0,-1).some(item=>item.duration>0))fs.writeFileSync(path.join(folder,'first-dub.wav'),Buffer.from(row.audio,'base64'));
      delete row.audio;delete row.sourceAudio;console.log(JSON.stringify(row));
    });
    await worker.evaluate(async()=>{
      await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');
      const original=globalThis.fetch;
      let lastEvent;const sources=new Map();
      chrome.storage.onChanged.addListener((changes,area)=>{
        if(area!=='session'||!changes.localVoiceServiceState)return;
        const row=changes.localVoiceServiceState.newValue?.events?.at(-1),key=JSON.stringify(row);
        if(row&&key!==lastEvent){lastEvent=key;console.log('YEDU_LIVE_EVENT '+key);}
      });
      globalThis.fetch=async(...args)=>{
        const path=String(args[0]);if(path.startsWith('http://127.0.0.1:8765/'))console.log('YEDU_LIVE_FETCH '+path.split('/').at(-1)+' start');
        const response=await original(...args);
        if(path.startsWith('http://127.0.0.1:8765/'))console.log('YEDU_LIVE_FETCH '+path.split('/').at(-1)+' '+response.status);
        if(String(args[0]).endsWith('/recognize-dub')){
          const row=await response.clone().json();
          row.sourceAudio=JSON.parse(args[1].body).audio;
          if(row.ticket){sources.set(row.ticket,row);while(sources.size>64)sources.delete(sources.keys().next().value);}
          else console.log('YEDU_LIVE_RESULT '+JSON.stringify({status:response.status,...row}));
        }else if(String(args[0]).endsWith('/speak')){
          const request=JSON.parse(args[1].body),source=sources.get(request.ticket);sources.delete(request.ticket);
          const row=await response.clone().json();
          console.log('YEDU_LIVE_RESULT '+JSON.stringify({...source,...row,status:response.status}));
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
    await video.evaluate((v,position)=>{v.currentTime=position;},startAt);
    await video.evaluate(async v=>{
      v.currentTime=0;v.muted=false;
      for(let attempt=0;attempt<3;attempt++){
        try{await Promise.race([v.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Real video did not start within 25 seconds')),25000))]);return;}
        catch(error){if(error.name!=='AbortError'||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,500));}
      }
    });
    const panel=page.locator('#twp-video-translator');await expect(panel).toHaveCount(1,{timeout:20000});
    console.log(JSON.stringify(await video.evaluate(v=>({time:v.currentTime,ready:v.readyState,paused:v.paused,parent:v.parentElement.className,controls:document.querySelectorAll('.bpx-player-control-bottom-right').length}))));await page.bringToFront();const bounds=await video.boundingBox();await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.move(bounds.x+bounds.width-160,bounds.y+bounds.height-20,{steps:8});await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await video.evaluate(v=>v.pause());await page.screenshot({path:path.join(folder,'before-start.png')});
    await panel.locator('#voice-watch-mode').selectOption(process.env.YEDU_LIVE_SYNC==='1'?'sync':'direct');await panel.locator('#voice-mode').selectOption('audio');if(process.env.YEDU_TEST_LOCAL_TRANSLATION==='1')await panel.locator('#voice-translation-mode').selectOption('local');
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
    if(process.env.YEDU_LIVE_SYNC==='1')await page.evaluate(()=>{globalThis.__yeduPictureMetrics=[];globalThis.__yeduPictureClock=setInterval(()=>{const host=document.querySelector('[data-yedu-sync-host]'),screen=host?.shadowRoot?.querySelector('video');if(host?.dataset.pictureTime&&screen){const quality=screen.getVideoPlaybackQuality();__yeduPictureMetrics.push({at:performance.now(),picture:Number(host.dataset.pictureTime),expected:Number(host.dataset.expectedTime),buffer:Number(host.dataset.bufferSeconds),width:screen.videoWidth,height:screen.videoHeight,frames:quality.totalVideoFrames,dropped:quality.droppedVideoFrames});}},200);});
    const playbackStarted=Date.now();await video.evaluate(async(v,position)=>{v.currentTime=position;await v.play();},startAt);console.log('Live player started: '+await page.title());
    await expect(page.locator('[data-yedu-live-voice]')).toBeVisible({timeout:20000});firstPlayback={wallSeconds:(Date.now()-playbackStarted)/1000,videoTime:await video.evaluate(v=>v.currentTime),caption:await page.locator('[data-yedu-live-voice]').textContent()};console.log('FIRST_PLAYBACK '+JSON.stringify(firstPlayback));
    for(let interval=0;interval<2;interval++){
      await page.waitForTimeout(seconds*500);
      const bodyText=await page.locator('body').innerText();
      const state={at:await video.evaluate(v=>v.currentTime),paused:await video.evaluate(v=>v.paused),pictureError:await video.evaluate(v=>v.dataset.yeduPictureError),loginPrompt:/扫码|扫描二维码登录/.test(bodyText),paidPreview:/专属视频|充电后即可观看/.test(bodyText),
        status:await panel.locator('#voice-status').textContent(),transcript:await panel.locator('#voice-live-text').textContent()};
      console.log(JSON.stringify(state));
      states.push(state);
      await page.screenshot({path:path.join(folder,`playing-${interval}.png`)});
      if(state.paused&&(state.loginPrompt||state.paidPreview)){
        if(await panel.locator('#voice-start').getAttribute('aria-pressed')==='true')await panel.locator('#voice-start').click();
        fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({url,title:await page.title(),startAt,seconds,firstPlayback,states,events,rows,errors,playbackStatus:state.paidPreview?'partial-paid-preview':'partial-login-required'},null,2));
        console.log('Real browser voice pipeline partial: site access gate stopped playback.');return;
      }
      if(manager){await expect(manager.locator('#original')).not.toHaveText('尚无输出');await expect(manager.locator('#events')).toContainText('开始配音');await manager.screenshot({path:path.join(folder,'model-ready-live.png')});}
      if(await panel.locator('#voice-start').getAttribute('aria-pressed')!=='true')throw new Error('Voice translation stopped: '+state.status);
    }
    if(!rows.some(row=>row.audioSeconds||row.duration>0))throw new Error('No real translated speech returned.');
    const voiced=rows.filter(row=>row.duration>0);
    if(process.env.YEDU_LIVE_SYNC==='1'){pictures=await page.evaluate(()=>__yeduPictureMetrics);const drift=pictures.map(row=>Math.abs(row.picture-row.expected)).sort((a,b)=>a-b);if(drift.length<10||drift[Math.floor(drift.length*.95)]>.5||drift.at(-1)>1)throw new Error('Real video picture clock did not follow speech');}
    if(voiced.some(row=>row.status!==200||row.voiceSource!=='speaker'))throw new Error('Inference did not use the real speaker reference.');
    phase='seek';await video.evaluate(v=>v.pause());if(process.env.YEDU_LIVE_SYNC==='1')await expect.poll(()=>page.locator('[data-yedu-sync-host] video').evaluate(v=>v.paused)).toBe(true);else await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
    await video.evaluate(async(v,position)=>{v.currentTime=position+10;await v.play();},startAt);await page.waitForTimeout(10000);
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
    await video.evaluate(v=>v.pause());if(process.env.YEDU_LIVE_SYNC!=='1')await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
    if(!manager)await panel.locator('#voice-start').click();await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');
    if(await video.evaluate(v=>v.muted))throw new Error('Original sound was not restored.');
    const interrupted=states.some(state=>state.paused);
    fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({url,title:await page.title(),startAt,seconds,startupSeconds,firstPlayback,states,events,rows,errors,playbackStatus:interrupted?'partial-playback-interrupted':'sample-passed'},null,2));
    console.log('Real browser voice pipeline '+(interrupted?'partial (site paused playback)':'passed (quality requires review)')+': '+voiced.length+' spoken segments.');
  }catch(error){
    if(page&&!page.isClosed()){await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({error:error.message,state:await page.evaluate(()=>({text:document.body.innerText.slice(0,5000),voiceStatus:document.getElementById('twp-video-translator')?.shadowRoot?.getElementById('voice-status')?.textContent,voiceActive:document.getElementById('twp-video-translator')?.shadowRoot?.getElementById('voice-start')?.getAttribute('aria-pressed'),syncHost:!!document.querySelector('[data-yedu-sync-host]'),videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,ready:v.readyState,paused:v.paused,error:v.error?.code,pictureError:v.dataset.yeduPictureError}))})).catch(()=>null)},null,2));}
    throw error;
  }finally{
    if(page&&!page.isClosed())pictures=await page.evaluate(()=>{clearInterval(globalThis.__yeduPictureClock);return globalThis.__yeduPictureMetrics||[];}).catch(()=>pictures);
    fs.writeFileSync(path.join(folder,'observations.json'),JSON.stringify({startAt,seconds,firstPlayback,states,events,rows,pictures,errors},null,2));
    await context?.close();
  }
// This is a standalone CLI. After the browser has closed and artifacts have
// been written, do not let leftover automation timers retain the test process.
})().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
