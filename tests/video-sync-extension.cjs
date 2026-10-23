// SPDX-License-Identifier: MPL-2.0
// Real WebCodecs -> WebM -> MediaSource video, real Web Audio capture/playback.
// Inference is an explicit test fixture, not a model quality claim.
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),youtube=process.env.YEDU_SYNC_PLATFORM==='youtube'||process.argv.includes('--youtube'),origin=youtube?'https://www.youtube.com':'https://www.bilibili.com',folder=path.join(root,'.local-data/voice/evaluation/'+(youtube?'youtube-sync':'sync-watch'));
function wav(seconds=4){const bytes=Buffer.alloc(44+32000*seconds);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);for(let i=0;i<16000*seconds;i++)bytes.writeInt16LE(Math.sin(i/6)*5000,44+i*2);return bytes;}
(async()=>{
 fs.mkdirSync(folder,{recursive:true});if(!fs.existsSync(path.join(folder,'source-120.webm')))execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','120','-c:v','libvpx','-threads','2','-b:v','600k','-g','24','-c:a','libopus','-y',path.join(folder,'source-120.webm')]);const source=fs.readFileSync(path.join(folder,'source-120.webm')),speech=wav();const calls=[],errors=[];let context,page,longSpeechNext=false,shortSpeechNext=false;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);calls.push({path:req.url,body});let data;
  if(req.url==='/session')data={token:'fixture',capabilities:['live-reference','external-translation'],model:'sync-fixture'};
  else if(req.url==='/profiles/list')data={profiles:[]};
  else{const long=longSpeechNext,short=shortSpeechNext;longSpeechNext=false;shortSpeechNext=false;await new Promise(resolve=>setTimeout(resolve,1200));data={text:'Fixture speech',translated:'画面与中文配音一起播放。',audio:(long?wav(35):short?wav(.1):speech).toString('base64'),duration:long?35:short?.1:4,voiceSource:'speaker',timings:{recognition:.2,translationAndSpeech:1}};}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  context=await chromium.launchPersistentContext(path.join(folder,'profile-'+Date.now()),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,`--load-extension=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,'--autoplay-policy=no-user-gesture-required','--mute-audio']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async port=>{const native=fetch;globalThis.fetch=(url,options)=>native(typeof url==='string'&&url.startsWith('http://127.0.0.1:8765/')?url.replace(':8765/',':'+port+'/'):url,options);await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');},server.address().port);
  await context.route(origin+'/**',async route=>{
   if(new URL(route.request().url()).pathname==='/source.webm'){
    const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),source.length-1):source.length-1;
    return route.fulfill({status:range?206:200,contentType:'video/webm',headers:{'accept-ranges':'bytes','content-length':String(end-start+1),...(range?{'content-range':`bytes ${start}-${end}/${source.length}`}:{})},body:source.subarray(start,end+1)});
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Video synchronization fixture</title><style>body{margin:0}.fixture-player{position:relative;width:800px;height:450px}video{width:100%;height:100%}.fixture-controls{position:absolute;bottom:0;right:0;height:32px;display:flex;gap:8px}</style><div class="fixture-player '+(youtube?'html5-video-player':'bpx-player-container')+'"><video src="/source.webm" controls preload="auto"></video><div class="'+(youtube?'caption-window':'bpx-player-subtitle-panel')+'">Original timeline caption</div><div class="fixture-controls '+(youtube?'ytp-right-controls':'bpx-player-control-bottom-right')+'"><span>Controls</span></div></div>'});
  });await context.route('https://api.bilibili.com/**',route=>route.fulfill({json:{code:-1}}));
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+(youtube?'/watch?v=abcdefghijk':'/video/BV1PC4y1h7Vi/'));
  const video=page.locator('video').first(),panel=page.locator('#twp-video-translator'),nativeCaption=page.locator(youtube?'.caption-window':'.bpx-player-subtitle-panel');await expect(panel).toHaveCount(1);
  await video.evaluate(v=>v.play());await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();
  await panel.locator('#voice-translation-mode').selectOption('local');await expect(panel.locator('#voice-watch-mode')).toHaveValue('sync');if(youtube)await page.locator('.html5-video-player').evaluate(p=>p.classList.add('ad-showing'));
  await panel.locator('#voice-start').click();
  if(youtube){
   await expect(panel.locator('#voice-status')).toContainText('广告');await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(0);
   await page.waitForTimeout(600);if(calls.some(c=>c.path==='/recognize-dub'))throw new Error('Advertising audio reached recognition');
   await video.evaluate(v=>{v.dispatchEvent(new Event('ended'));v.load();v.closest('.html5-video-player').classList.remove('ad-showing');return v.play();});
  }
  await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(1);await expect(nativeCaption).toHaveCSS('visibility','hidden');
  await expect(page.locator('[data-yedu-live-voice]')).toHaveText('画面与中文配音一起播放。',{timeout:20000});
  const screen=page.locator('[data-yedu-sync-host] video');await expect.poll(()=>screen.evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
  const samples=[];for(let i=0;i<15;i++){samples.push(await page.locator('[data-yedu-sync-host]').evaluate(h=>({picture:Number(h.dataset.pictureTime),expected:Number(h.dataset.expectedTime),buffer:Number(h.dataset.bufferSeconds)})));await page.waitForTimeout(100);}
  if(samples.some(row=>Math.abs(row.picture-row.expected)>.5))throw new Error('Picture and speech clocks diverged');
  if(!samples.some(row=>row.buffer>2))throw new Error('Picture did not actually buffer behind the source');
  // A slow real decoder can start behind the audio clock. Do not wait two
  // seconds to recover; also avoid interrupting a seek still in progress.
  await screen.evaluate(v=>{v.currentTime=Math.max(0,v.currentTime-.7);});
  await expect.poll(()=>page.locator('[data-yedu-sync-host]').evaluate(h=>Math.abs(Number(h.dataset.pictureTime)-Number(h.dataset.expectedTime))),{timeout:1200,intervals:[100]}).toBeLessThan(.3);
  await expect.poll(()=>screen.evaluate(v=>v.seeking)).toBe(false);
  await video.evaluate(v=>v.pause());await expect.poll(()=>screen.evaluate(v=>v.paused)).toBe(true);
  const held=await screen.evaluate(v=>v.currentTime);await page.waitForTimeout(1500);if(Math.abs(await screen.evaluate(v=>v.currentTime)-held)>.1)throw new Error('Picture moved while user paused');
  await video.evaluate(v=>v.play());await expect.poll(()=>screen.evaluate(v=>v.paused)).toBe(false);await page.waitForTimeout(4000);if(await page.locator('[data-yedu-sync-host]').evaluate(h=>Math.abs(Number(h.dataset.pictureTime)-Number(h.dataset.expectedTime)))>.5)throw new Error('Picture drifted after pause/resume');
  await video.evaluate(v=>{v.currentTime=20;});await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
  await expect(page.locator('[data-yedu-live-voice]')).toHaveText('画面与中文配音一起播放。',{timeout:20000});
  if(youtube){
   // A YouTube mid-roll replaces media on the same video element. The old
   // capture must end, and the new stream must not contain advertising audio.
   await page.locator('.html5-video-player').evaluate(p=>p.classList.add('ad-showing'));
   await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(0);await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);
   await video.evaluate(v=>{v.src='/source.webm?ad=1';return v.play();});await page.waitForTimeout(600);
   const count=calls.filter(c=>c.path==='/recognize-dub').length;await page.waitForTimeout(1500);
   if(calls.filter(c=>c.path==='/recognize-dub').length!==count||await video.evaluate(v=>v.muted))throw new Error('Mid-roll was captured or muted');
   await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
   await video.evaluate(v=>{v.src='/source.webm?after-ad=1';v.closest('.html5-video-player').classList.remove('ad-showing');return v.play();});
   await expect(page.locator('[data-yedu-live-voice]')).toHaveText('画面与中文配音一起播放。',{timeout:20000});
   // Quality/source replacement without an advertisement also reacquires.
   await video.evaluate(v=>{v.src='/source.webm?quality=2';return v.play();});
   await expect(page.locator('[data-yedu-live-voice]')).toHaveText('画面与中文配音一起播放。',{timeout:20000});
   // Ordinary SPA navigation ends the old voice. A new explicit start uses
   // the new video, rather than continuing the previous speaker/reference.
   await page.evaluate(()=>{history.pushState({},'', '/watch?v=nextvideo12');document.dispatchEvent(new Event('yt-navigate-start'));});
   await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(0);await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(0);await expect(panel.locator('#voice-live-text')).not.toContainText('Fixture speech');
   await panel.locator('#voice-start').click();await expect(page.locator('[data-yedu-live-voice]')).toHaveText('画面与中文配音一起播放。',{timeout:20000});
  }
  await page.screenshot({path:path.join(folder,'synchronized.png')});
  await panel.locator('#voice-start').click();await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(0);await expect.poll(()=>video.evaluate(v=>v.muted)).toBe(false);await expect(nativeCaption).toHaveCSS('visibility','visible');
  // Keep the first original segment on screen while a deliberately long
  // translation plays. Live-edge eviction used to delete its keyframes.
  await video.evaluate(v=>{v.pause();v.currentTime=0;});longSpeechNext=true;
  await panel.locator('#voice-start').click();await video.evaluate(v=>v.play());
  await expect(page.locator('[data-yedu-live-voice]')).toHaveCount(1,{timeout:20000});
  await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:32000}).toBeGreaterThan(26);
  await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
  const retained=await page.locator('[data-yedu-sync-host]').evaluate(h=>{const v=h.shadowRoot.querySelector('video');return {time:v.currentTime,start:v.buffered.start(0),error:Math.abs(Number(h.dataset.pictureTime)-Number(h.dataset.expectedTime))};});
  if(retained.time>6||retained.start>retained.time||retained.error>.5)throw new Error('Live-edge cleanup evicted the picture still owned by long speech');
  await panel.locator('#voice-start').click();
  shortSpeechNext=true;
  // Exercise repeated history cleanup with speech arriving in source order.
  // The original recorder could remove through an unrequested keyframe near
  // second 36 when a row for seconds 26-31 was still waiting to play.
  await video.evaluate(v=>{v.pause();v.currentTime=0;});
  await panel.locator('#voice-start').click();await video.evaluate(v=>v.play());
  await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:105000}).toBeGreaterThan(100);
  await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
  const pruned=await page.locator('[data-yedu-sync-host]').evaluate(h=>{const v=h.shadowRoot.querySelector('video');return {start:v.buffered.start(0),time:v.currentTime,error:Math.abs(Number(h.dataset.pictureTime)-Number(h.dataset.expectedTime))};});
  if(pruned.start<65||pruned.start>pruned.time||pruned.error>.5)throw new Error('Keyframe cleanup lost pending picture or retained unlimited history');
  await panel.locator('#voice-start').click();
  // The source ends ahead of the displayed picture. Drain its final captured
  // words rather than cutting off the last few seconds of the translation.
  await video.evaluate(v=>{v.pause();v.currentTime=116;});await panel.locator('#voice-start').click();await video.evaluate(v=>v.play());
  await expect.poll(()=>video.evaluate(v=>v.ended),{timeout:10000}).toBe(true);
  await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-yedu-sync-host]')).toHaveCount(0,{timeout:15000});
  await expect(panel.locator('#voice-start')).toHaveAttribute('aria-pressed','false');
  if(!await video.evaluate(v=>v.paused)||await video.evaluate(v=>v.muted))throw new Error('End-of-video cleanup changed player state');
  if(errors.length)throw new Error(errors.join('\n'));
  fs.writeFileSync(path.join(folder,'fixture-results.json'),JSON.stringify({samples,retained,pruned,calls:calls.map(row=>({path:row.path,sourceBytes:row.body.audio?.length})),errors},null,2));
  console.log((youtube?'YouTube ads/source/SPA lifecycle passed. ':'')+'Synchronized picture passed: real encode/decode, <0.5s picture/speech clock error, pause/resume, seek reset, source sound restoration.');
 }catch(error){if(page){await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});console.error(await page.locator('video').first().evaluate(v=>v.dataset.yeduPictureError));console.error(await page.locator('#twp-video-translator').locator('#voice-status').textContent().catch(()=>''));}throw error;}
 finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
