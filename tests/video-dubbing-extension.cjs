// SPDX-License-Identifier: MPL-2.0
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function wav(seconds=20){const count=8000*seconds,bytes=Buffer.alloc(44+count*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*5000),44+i*2);return bytes;}
(async()=>{
  const calls=[],errors=[],profiles=[],audio=wav(),voice=wav(6),shortVoice=wav(2);let fail=false,delay=0;
  const service=http.createServer((req,res)=>{let raw='';req.on('data',data=>raw+=data);req.on('end',async()=>{
    const body=JSON.parse(raw);calls.push({path:req.url,body,headers:req.headers});if(delay)await new Promise(r=>setTimeout(r,delay));
    let result;if(req.url==='/session')result={token:'test-token',model:'local-fixture'};
    else if(req.url==='/profiles/list')result={profiles};
    else if(req.url==='/reference-text')result={text:'Hello, welcome to the video.'};
    else if(req.url==='/profiles/create'){const profile={id:'a'.repeat(32),name:body.name,language:body.language,duration:4};profiles.push(profile);result={profile};}
    else result={text:'Hello',translated:'你好，本地配音',audio:(body.text?.includes('second')?shortVoice:voice).toString('base64'),duration:.3};
    res.writeHead(fail?503:200,{'content-type':'application/json'});res.end(JSON.stringify(fail?{detail:'模拟模型断开'}:result));
  });});
  await new Promise((resolve,reject)=>service.once('error',reject).listen(0,'127.0.0.1',resolve));
  const fixturePort=service.address().port;
  let context;const profile=path.join(root,'.local-data/voice/browser-test-'+Date.now());
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:[`--disable-extensions-except=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,`--load-extension=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,'--autoplay-policy=no-user-gesture-required']});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async port=>{
      // Redirect this isolated test worker's loopback requests to its fixture;
      // never take down the user's running model service for browser tests.
      const nativeFetch=globalThis.fetch;
      globalThis.fetch=(input,options)=>nativeFetch(typeof input==='string'&&input.startsWith('http://127.0.0.1:8765/')?input.replace(':8765/',':'+port+'/'):input,options);
      await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('videoTranslationPreferences',{'www.youtube.com':{disabledVideos:['youtube:abcdefghijk']}});
    },fixturePort);
    const videoFixture=async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/audio.wav'){
        // A real media server supports byte ranges. Returning the whole WAV
        // to a range request makes Chromium reset its seek position to zero.
        const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;
        const body=audio.subarray(start,end+1),headers={'accept-ranges':'bytes','content-length':String(body.length)};
        if(range)headers['content-range']=`bytes ${start}-${end}/${audio.length}`;
        return route.fulfill({status:range?206:200,contentType:'audio/wav',headers,body});
      }
      if(url.pathname==='/english.vtt')return route.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nHello, welcome to the video.\n\n00:00:08.000 --> 00:00:12.000\nThis is a second sentence.\n'});
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local voice test</title><style>video{width:720px;height:400px}.html5-video-player{position:relative;width:720px}.bpx-player-control-bottom-right{position:absolute;right:0;bottom:4px;height:32px;display:flex;gap:8px}</style><div class="html5-video-player"><video controls preload="auto" src="/audio.wav"><track default kind="subtitles" srclang="en" label="English" src="/english.vtt"></video><div class="bpx-player-control-bottom-right"><span>字幕 设置 全屏</span></div></div><ytd-watch-metadata><div id="owner"><a href="/@FixtureBob">Bob</a></div></ytd-watch-metadata>'});
    };
    await context.route('https://www.youtube.com/**',videoFixture);
    await context.route('https://www.bilibili.com/**',videoFixture);
    await context.route('https://api.bilibili.com/**',route=>route.fulfill({contentType:'application/json',body:'{"code":-1,"message":"fixture has only a native track"}'}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page),worlds=[];cdp.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await cdp.send('Runtime.enable');
    await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
    const panel=page.locator('#twp-video-translator'),video=page.locator('video');
    await expect(panel).toHaveCount(1);await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await panel.locator('#detect').click();await expect(panel.locator('#source')).not.toBeDisabled();
    let world;for(const candidate of worlds){try{const probe=await cdp.send('Runtime.evaluate',{contextId:candidate.id,expression:'typeof twpVideoDubbing'});if(probe.result.value==='object'){world=candidate.id;break;}}catch{}}
    if(!world)throw new Error('Extension content world missing');
    await cdp.send('Runtime.evaluate',{contextId:world,expression:'globalThis.voiceAudios=[];globalThis.OriginalVoiceAudio=Audio;globalThis.Audio=function(src){const audio=new OriginalVoiceAudio(src);voiceAudios.push(audio);return audio;};'});
    const voiceState=async()=>{const row=await cdp.send('Runtime.evaluate',{contextId:world,returnByValue:true,expression:'(()=>{const a=voiceAudios.at(-1);return a?{time:a.currentTime,rate:a.playbackRate,paused:a.paused,pitch:a.preservesPitch}:null;})()'});return row.result.value;};
    await panel.locator('#voice-connect').click();await expect(panel.locator('#voice-status')).toContainText('已连接');
    // Import, transcribe, save and bind a named local voice without uploading
    // recordings to an online model or storing them in extension preferences.
    await panel.locator('#voice-learning summary').click();
    await panel.locator('#voice-ref-file').setInputFiles({name:'reference.wav',mimeType:'audio/wav',buffer:wav(4)});
    await expect(panel.locator('#voice-ref-text')).toHaveValue('Hello, welcome to the video.');
    await panel.locator('#voice-name').fill('Bob 英语系列');await panel.locator('#voice-save-profile').click();
    await expect(panel.locator('#voice-profile')).toHaveValue('a'.repeat(32));
    await expect(panel.locator('#voice-profile-status')).toContainText('已记住');
    await expect.poll(()=>worker.evaluate(()=>twpConfig.get('videoVoiceProfiles')['youtube:speaker:/@FixtureBob'])).toBe('a'.repeat(32));
    const created=calls.find(row=>row.path==='/profiles/create');if(created.body.text!=='Hello, welcome to the video.'||Buffer.from(created.body.audio,'base64').readUInt32LE(24)!==16000)throw new Error('Reference voice was not normalized or transcribed');
    // Capture cancellation leaves the video playing; a complete capture uses
    // seven seconds of the original media stream rather than the microphone.
    await video.evaluate(v=>{v.currentTime=.1;return v.play();});await panel.locator('#voice-capture').click();
    await expect(panel.locator('#voice-capture')).toHaveText('取消原声采集');await panel.locator('#voice-capture').click();
    await expect(panel.locator('#voice-profile-status')).toContainText('已取消');if(await video.evaluate(v=>v.paused))throw new Error('Cancelling a reference paused the video');
    await panel.locator('#voice-capture').click();await expect(panel.locator('#voice-profile-status')).toContainText('7.0 秒',{timeout:15000});
    const captured=calls.filter(row=>row.path==='/reference-text').at(-1),reference=Buffer.from(captured.body.audio,'base64');if(reference.readUInt32LE(40)!==7*16000*2)throw new Error('Reference capture was not seven seconds');
    await panel.locator('#voice-learning summary').click();
    await expect(panel.locator('#voice-speed')).toHaveValue('1.25');
    await video.evaluate(v=>{v.currentTime=1;v.muted=false;return v.play();});
    delay=800;await panel.locator('#voice-mode').selectOption('subtitles');await panel.locator('#voice-start').click();
    await expect.poll(()=>panel.locator('#voice-status').textContent()).toContain('暂用原声');
    const preparingAt=await video.evaluate(v=>v.currentTime);
    await new Promise(resolve=>setTimeout(resolve,350));if(await video.evaluate(v=>v.paused)||await video.evaluate(v=>v.currentTime)-preparingAt<.2)throw new Error('Synthesis incorrectly paused the video');
    await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(true);await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
    delay=0;await expect(panel.locator('#player-voice')).toContainText('字幕同步');
    if(calls.filter(row=>row.path==='/dub').some(row=>row.body.voiceProfileId!=='a'.repeat(32)))throw new Error('Selected reference voice was not used for subtitle dubbing');
    await expect.poll(async()=>{const state=await voiceState(),time=await video.evaluate(v=>v.currentTime);return state&&Math.abs(state.time-(time-1)*1.5)<.25;}).toBe(true);
    let state=await voiceState();if(state.rate!==1.5||!state.pitch)throw new Error('Speech duration or pitch not fitted to subtitle');
    await video.evaluate(v=>{v.playbackRate=1.5;});await expect.poll(async()=>(await voiceState()).rate).toBe(2.25);
    await video.evaluate(v=>{v.playbackRate=1;});
    await video.evaluate(v=>v.pause());await video.evaluate(v=>{v.currentTime=8.2;return v.play();});
    await expect.poll(()=>calls.filter(row=>row.path==='/dub').length).toBeGreaterThan(1);
    await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(8.15);
    await expect.poll(async()=>{const state=await voiceState(),time=await video.evaluate(v=>v.currentTime);return state&&!state.paused&&Math.abs(state.time-(time-8)*.5)<.25;}).toBe(true);
    await expect.poll(async()=>(await voiceState()).rate).toBe(.5);
    await expect(panel.locator('#voice-speed')).toBeDisabled();await expect(panel.locator('#quick-voice-speed')).toBeDisabled();
    await panel.locator('#voice-start').click();await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(false);
    await panel.locator('#voice-speed').selectOption('2');
    await expect(panel.locator('#quick-voice-speed')).toHaveValue('2');
    await expect.poll(()=>worker.evaluate(()=>twpConfig.get('videoTranslationPreferences')['www.youtube.com'].voiceSpeed)).toBe(2);
    await panel.locator('#voice-speed').selectOption('1.25');
    // Real captureStream and Web Audio, not a mocked media element. It still
    // produces nonzero PCM after our replacement audio mutes the video.
    await video.evaluate(v=>{v.currentTime=.1;return v.play();});await panel.locator('#voice-mode').selectOption('audio');await panel.locator('#voice-start').click();
    await expect(panel.locator('#player-voice')).toContainText('与画面有延迟');
    await expect.poll(()=>calls.filter(row=>row.path==='/recognize-dub').length,{timeout:22000}).toBeGreaterThan(1);
    for(const row of calls.filter(row=>row.path==='/recognize-dub')){const pcm=Buffer.from(row.body.audio,'base64');if(pcm.readUInt32LE(24)!==16000)throw new Error('Unexpected sample rate');let energy=0;for(let i=44;i<pcm.length;i+=2)energy+=Math.abs(pcm.readInt16LE(i));if(!energy)throw new Error('Mute incorrectly silenced captured audio');}
    await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(true);await panel.locator('#voice-start').click();await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(false);
    // Error recovery and SPA cleanup cannot leave the player muted.
    fail=true;await panel.locator('#voice-start').click();await expect(panel.locator('#voice-status')).toContainText('模拟模型断开');await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(false);fail=false;
    await panel.locator('#voice-start').click();await page.evaluate(()=>history.pushState({},'', '/results?search_query=hello'));await expect(panel).toHaveCount(0);await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(false);
    await page.goto('https://www.youtube.com/watch?v=abcdefghijk');await expect(panel).toHaveCount(1);await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await panel.locator('#voice-profiles-refresh').click();
    await expect(panel.locator('#voice-profile')).toHaveValue('a'.repeat(32));
    if(calls.filter(row=>row.path==='/recognize-dub').some(row=>row.body.voiceProfileId!=='a'.repeat(32)))throw new Error('Selected reference voice was not used for live dubbing');
    await worker.evaluate(()=>twpConfig.set('videoTranslationPreferences',{...twpConfig.get('videoTranslationPreferences'),'www.bilibili.com':{disabledVideos:['bilibili:BV1PC4y1h7Vi:p1','bilibili:BV1PC4y1h7Vi:p2']}}));
    await page.goto('https://www.bilibili.com/video/BV1PC4y1h7Vi/?p=1');await expect(panel).toHaveCount(1);await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await panel.locator('#voice-profiles-refresh').click();await panel.locator('#voice-profile').selectOption('a'.repeat(32));await panel.locator('#voice-bind-scope').selectOption('series');await panel.locator('#voice-bind').click();
    await expect.poll(()=>worker.evaluate(()=>twpConfig.get('videoVoiceProfiles')['bilibili:BV1PC4y1h7Vi'])).toBe('a'.repeat(32));
    await page.goto('https://www.bilibili.com/video/BV1PC4y1h7Vi/?p=2');await expect(panel).toHaveCount(1);await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await panel.locator('#voice-profiles-refresh').click();await expect(panel.locator('#voice-profile')).toHaveValue('a'.repeat(32));
    await panel.locator('#voice-learning summary').click();await panel.locator('#voice-name').scrollIntoViewIfNeeded();await panel.locator('#settings-panel').screenshot({path:path.join(root,'.local-data/voice/profile-settings-preview.png')});
    if(calls.some(row=>row.headers['x-yedu-voice']!=='1'||(row.path!=='/session'&&row.headers.authorization!=='Bearer test-token')))throw new Error('Missing local service authentication');
    if(errors.length)throw new Error(errors.join('\n'));
    console.log(`Local voice extension passed: named voice import/capture/cancel, speaker binding across reload, voice reuse in subtitles and live mode, VTT clock, real PCM, errors, SPA, ${calls.length} local requests`);
  }finally{await context?.close();await new Promise(resolve=>service.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
