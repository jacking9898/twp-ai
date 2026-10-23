// SPDX-License-Identifier: MPL-2.0
// Isolated browser + explicit model/native bridge fixtures. Never controls the
// user's browser or sends stop/start commands to their actual model service.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function wav(seconds){const rate=16000,bytes=Buffer.alloc(44+rate*seconds*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);for(let i=0;i<rate*seconds;i++)bytes.writeInt16LE(Math.round(Math.sin(i/7)*5000),44+i*2);return bytes;}
(async()=>{
 const audio=wav(60),speech=wav(1),calls=[],errors=[];let online=true,stopDelay=0,refuseStop=false;
 const server=http.createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',async()=>{
  const body=JSON.parse(raw||'{}');calls.push({path:req.url,body});res.setHeader('content-type','application/json');
  if(req.url.startsWith('/native/')){const action=req.url.split('/').at(-1);if(action==='stop'){if(refuseStop)return res.end(JSON.stringify({ok:true,state:'error',message:'Fixture refused to stop'}));if(stopDelay)await new Promise(resolve=>setTimeout(resolve,stopDelay));online=false;}if(action==='start')online=true;return res.end(JSON.stringify({ok:true,state:online?'ready':'stopped',message:online?'Fixture ready':'Fixture stopped'}));}
  if(!online){res.statusCode=503;return res.end(JSON.stringify({detail:'Fixture offline'}));}
  const data=req.url==='/session'?{token:'fixture-token',capabilities:['live-reference','external-translation']}:
   req.url==='/profiles/list'?{profiles:[]}:
   {text:'Welcome to this English lesson.',translated:'欢迎来到英语课堂。',audio:speech.toString('base64'),duration:1,voiceSource:'speaker',timings:{recognition:.1,speech:.1}};
  res.end(JSON.stringify(data));
 });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 let context;const out=path.join(root,'.local-data/voice/evaluation/auto-stop');fs.mkdirSync(out,{recursive:true});
 try{
  context=await chromium.launchPersistentContext(path.join(out,'profile-'+Date.now()),{channel:'chromium',headless:true,viewport:{width:1350,height:1000},args:[`--disable-extensions-except=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,`--load-extension=${path.join(root,'build/TWP_AI_0.1.0_Chromium_MV3')}`,'--autoplay-policy=no-user-gesture-required']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async port=>{
   const original=globalThis.fetch;let fixtureOnline=true;globalThis.fetch=(url,options)=>{if(typeof url==='string'&&url.startsWith('http://127.0.0.1:8765/')){if(!fixtureOnline)return Promise.reject(new TypeError('Fixture service stopped'));url=url.replace(':8765/',':'+port+'/');}return original(url,options);};
   chrome.runtime.sendNativeMessage=(host,message,callback)=>original(`http://127.0.0.1:${port}/native/${message.action}`,{method:'POST',body:'{}'}).then(response=>response.json()).then(result=>{if(['ready','stopped'].includes(result.state))fixtureOnline=result.state==='ready';callback(result);});
   await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('showFloatingButton','yes');
   twpConfig.set('videoTranslationPreferences',{'www.youtube.com':{disabledVideos:['youtube:abcdefghijk','youtube:nextvideo12']}});
  },port);
  await context.route('https://www.youtube.com/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/audio.wav')return route.fulfill({contentType:'audio/wav',body:audio});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Model lifecycle fixture</title><style>body{margin:0;background:#202224;color:white}.html5-video-player{position:relative;width:900px;height:500px;margin:40px}video{width:900px;height:500px}.ytp-right-controls{position:absolute;bottom:4px;right:0;width:200px;height:35px}</style><div class="html5-video-player"><video controls loop src="/audio.wav"></video><div class="ytp-right-controls"><button>设置 全屏</button></div></div>'});
  });
  const openVideo=async()=>{const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('https://www.youtube.com/watch?v=abcdefghijk');const panel=page.locator('#twp-video-translator');await expect(panel).toHaveCount(1);await panel.locator('#player-icon').hover();await panel.locator('#player-settings').click();await panel.locator('#player-more').click();await expect(panel.locator('#voice-auto-stop')).toBeChecked();await panel.locator('#voice-mode').selectOption('audio');await panel.locator('#voice-watch-mode').selectOption('direct');await panel.locator('#voice-translation-mode').selectOption('local');return {page,panel,video:page.locator('video')};};
  const start=async v=>{await v.video.evaluate(video=>video.play());await v.panel.locator('#voice-start').click();await expect(v.panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');};
  const count=action=>calls.filter(row=>row.path==='/native/'+action).length;
  const active=()=>worker.evaluate(async()=>((await chrome.storage.session.get('localVoiceActiveSessions')).localVoiceActiveSessions||[]).length);
  const a=await openVideo(),floating=a.page.locator('#twp-floating');await a.panel.locator('#close').click();
  await floating.locator('#toggle').hover();await floating.locator('#settings').click();
  await expect(floating.locator('#voice-auto-stop')).toBeChecked();
  await expect(floating.locator('#voice-manager')).toBeInViewport();
  const [manager]=await Promise.all([context.waitForEvent('page'),floating.locator('#voice-manager').click()]);
  await manager.waitForLoadState();await expect(manager.locator('#auto-stop')).toBeChecked();
  await manager.locator('#auto-stop').uncheck();await expect(floating.locator('#voice-auto-stop')).not.toBeChecked();await expect(a.panel.locator('#voice-auto-stop')).not.toBeChecked();
  await floating.locator('#voice-auto-stop').check();await expect(manager.locator('#auto-stop')).toBeChecked();
  await floating.locator('#panel').screenshot({path:path.join(out,'floating-entry.png')});await floating.locator('#close').click();
  await a.panel.locator('#player-icon').hover();if(await a.panel.locator('#player-settings').getAttribute('aria-expanded')!=='true')await a.panel.locator('#player-settings').click();await a.panel.locator('#player-more').click();
  console.log('Visible controls and preference sync passed');
  await a.panel.locator('#settings-panel').evaluate(el=>el.scrollTop=0);await expect(a.panel.locator('#voice-manager')).toBeInViewport();await a.panel.locator('#settings-panel').screenshot({path:path.join(out,'video-entry.png')});
  await start(a);await expect.poll(()=>a.video.evaluate(v=>v.muted),{timeout:15000}).toBe(true);await expect.poll(active).toBe(1);
  await a.video.evaluate(v=>v.pause());await new Promise(resolve=>setTimeout(resolve,200));expect(count('stop')).toBe(0);await a.video.evaluate(v=>{v.currentTime=12;return v.play();});expect(count('stop')).toBe(0);
  console.log('First real audio capture and pause/seek passed');const b=await openVideo();await start(b);await expect.poll(active).toBe(2);
  await a.panel.locator('#voice-start').click();await expect.poll(active).toBe(1);expect(count('stop')).toBe(0);await expect(b.panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
  await b.page.close();await expect.poll(()=>count('stop')).toBe(1);await expect.poll(()=>online).toBe(false);
  console.log('Multiple tabs and tab close release passed');await start(a);await expect.poll(()=>count('start')).toBe(1);await expect.poll(()=>a.video.evaluate(v=>v.muted),{timeout:15000}).toBe(true);
  await a.panel.locator('#voice-auto-stop').uncheck();await a.panel.locator('#voice-start').click();await expect.poll(active).toBe(0);expect(count('stop')).toBe(1);expect(online).toBe(true);
  await a.panel.locator('#voice-auto-stop').check();await start(a);await expect.poll(active).toBe(1);
  console.log('Model restart and switch-off retain passed');stopDelay=500;await a.panel.locator('#voice-start').click();await expect.poll(()=>count('stop')).toBe(2);await a.panel.locator('#voice-start').click();
  await expect.poll(()=>count('start')).toBe(2);await expect.poll(active).toBe(1);await expect(a.panel.locator('#voice-start')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>a.video.evaluate(v=>v.muted),{timeout:15000}).toBe(true);stopDelay=0;
  refuseStop=true;await a.panel.locator('#voice-start').click();await expect(a.panel.locator('#voice-status')).toContainText('自动释放内存失败');expect(online).toBe(true);refuseStop=false;await start(a);await expect.poll(active).toBe(1);
  await a.page.goto('https://www.youtube.com/results?search_query=english');await expect.poll(()=>count('stop')).toBe(4);await expect.poll(()=>online).toBe(false);await expect.poll(active).toBe(0);
  expect(errors).toEqual([]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({nativeFixture:true,realModels:false,stops:count('stop'),starts:count('start'),checks:['visible controls','preference sync','real audio capture','pause/seek retain','multiple tabs','tab close release','restart','switch off retain','rapid restart','native refusal surfaced','navigation release']},null,2));
  console.log('Auto-stop browser passed: visible entries, cross-panel settings, real audio capture, pause/seek, multi-tab safety, tab close/navigation, reload models and rapid restart. Explicit model/native fixtures.');
 }finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
