// SPDX-License-Identifier: MPL-2.0
// Explicit opt-in. Uses the existing extension through visible public-page
// controls; never opens an extension page or reads private configuration.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs'),path=require('node:path');
const run=promisify(execFile),session=process.env.YEDU_CHROME_SESSION||'yedu-ai-voice';
if(!/^[a-zA-Z0-9-]{1,80}$/.test(session))throw new Error('Invalid browser session');
const activate=process.env.YEDU_CHROME_ACTIVATE==='1';
const nativeActivate=process.env.YEDU_CHROME_NATIVE_ACTIVATE==='1';
const reuseFirst=process.env.YEDU_CHROME_REUSE==='1';
const bound=process.env.YEDU_CHROME_BOUND==='1',keepSession=process.env.YEDU_CHROME_KEEP_SESSION==='1';
const watchMode=process.env.YEDU_CHROME_WATCH||'sync',youtube=process.env.YEDU_CHROME_PLATFORM==='youtube';
if(!['sync','direct'].includes(watchMode))throw new Error('Invalid watch mode');
const folder=path.resolve('.local-data/voice/evaluation/'+(youtube?'youtube-':'')+(watchMode==='sync'?'sync-watch':'direct-watch'));
const cases=youtube?[{label:'youtube-thankful',url:'https://www.youtube.com/watch?v=93gOOsREkLQ',start:15},{label:'youtube-pca',url:'https://www.youtube.com/watch?v=HMOI_lkzW08',start:35},{label:'youtube-food-court',url:'https://www.youtube.com/watch?v=EebIaiwNh9k',start:15}]:[{label:'idioms',url:'https://www.bilibili.com/video/BV13rpN6FEmj/',start:0},
  {label:'airport',url:'https://www.bilibili.com/video/BV1htARzYE82/',start:60},
  {label:'thankful',url:'https://www.bilibili.com/video/BV186pZ66Ebm/',start:15},
  {label:'thankful-family',url:'https://www.bilibili.com/video/BV186pZ66Ebm/',start:45}];
if(process.env.YEDU_CHROME_VIDEO_URL){
 const u=new URL(process.env.YEDU_CHROME_VIDEO_URL);if(!youtube||u.protocol!=='https:'||u.hostname!=='www.youtube.com'||u.pathname!=='/watch'||! /^[\w-]{11}$/.test(u.searchParams.get('v')||''))throw new Error('Invalid explicit YouTube sample');
 cases.unshift({label:'youtube-spa-next',url:'https://www.youtube.com/watch?v='+u.searchParams.get('v'),start:15});
}
const seconds=Number(process.env.YEDU_CHROME_SECONDS||35);
if(!Number.isFinite(seconds)||seconds<20||seconds>120)throw new Error('Invalid sample duration');
const samples=process.env.YEDU_CHROME_SAMPLE?cases.filter(sample=>process.env.YEDU_CHROME_SAMPLE.split(',').includes(sample.label)):cases;
if(!samples.length)throw new Error('Unknown sample');
async function cli(...args){const {stdout}=await run('opencli',['browser',...args,'--session',session],{timeout:65000,maxBuffer:1024*1024});const value=JSON.parse(stdout);if(!value.ok)throw new Error(value.error?.message||'Browser command failed');return value.data;}
const evaluate=fn=>cli('eval',typeof fn==='string'?fn:'('+fn.toString()+')()');
(async()=>{
 if(process.env.YEDU_TEST_EXISTING_CHROME!=='1')throw new Error('Explicit YEDU_TEST_EXISTING_CHROME=1 required');
 fs.mkdirSync(folder,{recursive:true});
 try{for(const [index,sample] of samples.entries()){
  if(!reuseFirst||index)await cli('open',sample.url,'--window',activate?'foreground':'background');
  await evaluate(()=>{const v=document.querySelector('video');if(!v)throw new Error('Video missing');v.pause();globalThis.__yeduTestOriginalVolume=v.volume;globalThis.__yeduTestOriginalMuted=v.muted;v.volume=0;return {ready:v.readyState};});
  let ready=false;
  for(let attempt=0;attempt<30;attempt++){
   ready=await evaluate(()=>!!document.getElementById('twp-video-translator')?.shadowRoot?.getElementById('voice-translation-mode')&&document.querySelector('video')?.readyState>=2);
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error('Real video or extension did not load');
  if(activate||nativeActivate){
   // The foreground option requires explicit permission. Native activation
   // alone uses the existing test window and never changes its focus/state.
   await cli('click',youtube?'.ytp-play-button':'.bpx-player-ctrl-play');
   await evaluate(()=>{document.querySelector('video').pause();return {activation:navigator.userActivation.hasBeenActive};});
  }
  if(youtube){
   await evaluate(async()=>{const v=document.querySelector('video');await v.play();return true;});
   let main=false;
   for(let attempt=0;attempt<75;attempt++){
    const state=await evaluate(()=>({ad:document.querySelector('.html5-video-player')?.classList.contains('ad-showing'),ready:document.querySelector('video')?.readyState,error:document.querySelector('.ytp-error')?.innerText}));
    if(state.error?.trim())throw new Error('YouTube refused playback: '+state.error);
    if(!state.ad&&state.ready>=2){main=true;break;}
    if(attempt%10===0)console.log(JSON.stringify({sample:sample.label,waiting:'normal advertisement/content loading',state}));
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!main)throw new Error('YouTube content did not load after normal advertisement waiting');
  }
  await evaluate(`(()=>{const v=document.querySelector('video'),r=document.getElementById('twp-video-translator').shadowRoot;v.pause();v.currentTime=${sample.start};r.getElementById('voice-watch-mode').value=${JSON.stringify(watchMode)};const mode=r.getElementById('voice-translation-mode');if(mode.value!=='custom')throw new Error('Custom AI is not the default');if(r.getElementById('voice-mode').value!=='audio')throw new Error('Test must read the audio track');globalThis.__yeduVoiceObservation={url:location.href,title:document.title,started:Date.now(),models:[...r.getElementById('voice-ai-profile').options].map(o=>o.textContent),rows:[],states:[],pictureSamples:[]};globalThis.__yeduPictureTimer=setInterval(()=>{const h=document.querySelector('[data-yedu-sync-host]');if(h&&h.dataset.pictureTime){const screen=h.shadowRoot.querySelector('video');__yeduVoiceObservation.pictureSamples.push({bufferStart:screen.buffered.length?screen.buffered.start(0):null,bufferEnd:screen.buffered.length?screen.buffered.end(screen.buffered.length-1):null,source:v.currentTime,picture:Number(h.dataset.pictureTime),expected:Number(h.dataset.expectedTime),buffer:Number(h.dataset.bufferSeconds)});}},200);const last={};globalThis.__yeduTestObserver=new MutationObserver(()=>{for(const id of ['voice-live-text','voice-status']){const text=r.getElementById(id).textContent;if(last[id]!==text){last[id]=text;__yeduVoiceObservation[id==='voice-live-text'?'rows':'states'].push({at:v.currentTime,wall:(Date.now()-__yeduVoiceObservation.started)/1000,text});}}});__yeduTestObserver.observe(r,{subtree:true,childList:true,characterData:true});r.getElementById('player-more').click();r.getElementById('voice-start').scrollIntoView({block:'center'});return true;})()`);
  await evaluate(()=>{document.getElementById('twp-video-translator').shadowRoot.getElementById('voice-start').click();return true;});
  let connected=false;
  for(let attempt=0;attempt<20;attempt++){
   const state=await evaluate(()=>{const r=document.getElementById('twp-video-translator').shadowRoot;return {mode:r.getElementById('player-voice').textContent,status:r.getElementById('voice-status').textContent,active:r.getElementById('voice-start').getAttribute('aria-pressed')};});
   if(state.mode.includes('实时识别')){connected=true;break;}if(state.active==='false'&&attempt>2)throw new Error('后台页面未完成音频激活，本轮未验收：'+state.status);await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!connected)throw new Error('Voice capture failed to connect');
  await evaluate(`(async()=>{const v=document.querySelector('video');v.currentTime=${sample.start};__yeduVoiceObservation.started=Date.now();await v.play();return {paused:v.paused,ready:v.readyState};})()`);
  for(let elapsed=0;elapsed<seconds;elapsed+=15){
   await new Promise(resolve=>setTimeout(resolve,Math.min(15,seconds-elapsed)*1000));
   const progress=await evaluate(()=>{const r=document.getElementById('twp-video-translator').shadowRoot;return {time:document.querySelector('video').currentTime,status:r.getElementById('voice-status').textContent,active:r.getElementById('voice-start').getAttribute('aria-pressed'),rows:__yeduVoiceObservation.rows.filter(row=>row.text.startsWith('识别：')).length};});console.log(JSON.stringify({sample:sample.label,progress:Math.min(elapsed+15,seconds),state:progress}));if(progress.active!=='true')throw new Error('Real voice stopped: '+progress.status);
  }
  await cli('screenshot',path.join(folder,sample.label+'-playing.png')).catch(()=>{});
  const pause=await evaluate(()=>{const v=document.querySelector('video'),h=document.querySelector('[data-yedu-sync-host]');v.pause();return {source:v.currentTime,picture:h?.shadowRoot?.querySelector('video')?.currentTime};});
  await new Promise(resolve=>setTimeout(resolve,1200));
  const held=await evaluate(()=>{const h=document.querySelector('[data-yedu-sync-host]');return {source:document.querySelector('video').currentTime,picture:h?.shadowRoot?.querySelector('video')?.currentTime,paused:h?.shadowRoot?.querySelector('video')?.paused};});
  if(Math.abs(held.source-pause.source)>.05||watchMode==='sync'&&(!held.paused||Math.abs(held.picture-pause.picture)>.15))throw new Error('Pause did not hold synchronized playback');
  await evaluate(async()=>{await document.querySelector('video').play();return true;});
  await new Promise(resolve=>setTimeout(resolve,3000));
  const resumed=await evaluate(()=>({source:document.querySelector('video').currentTime,paused:document.querySelector('video').paused}));
  if(resumed.paused||resumed.source<held.source+1)throw new Error('Playback did not resume');
  const seek=await evaluate(async()=>{const v=document.querySelector('video');const before=__yeduVoiceObservation.rows.length;v.currentTime=90;await v.play();return {before};});
  await new Promise(resolve=>setTimeout(resolve,16000));
  const seeked=await evaluate(()=>({time:document.querySelector('video').currentTime,rows:__yeduVoiceObservation.rows,host:!!document.querySelector('[data-yedu-sync-host]')}));
  if(!seeked.rows.slice(seek.before).some(row=>row.text.startsWith('识别：')&&row.at>=90)||watchMode==='sync'&&!seeked.host)throw new Error('Seek did not restart real speech and picture');
  const result=await evaluate(()=>{const v=document.querySelector('video'),r=document.getElementById('twp-video-translator').shadowRoot;clearInterval(__yeduPictureTimer);const result={...__yeduVoiceObservation,controller:document.querySelector('[data-yedu-sync-host]')?.dataset.syncController,time:v.currentTime,paused:v.paused,active:r.getElementById('voice-start').getAttribute('aria-pressed')};const lastSpoken=result.rows.filter(row=>row.text.startsWith('识别：')).at(-1);result.lastSpeechGap=lastSpoken?v.currentTime-lastSpoken.at:null;result.playbackStatus=result.paused?'partial-playback-interrupted':result.lastSpeechGap===null||result.lastSpeechGap>16?'partial-speech-gap-needs-review':'sample-completed-quality-needs-review';v.pause();if(result.active==='true')r.getElementById('voice-start').click();result.captionAfterStop=!!document.querySelector('[data-yedu-live-voice]');result.pictureAfterStop=!!document.querySelector('[data-yedu-sync-host]');result.restoredMuted=v.muted===__yeduTestOriginalMuted;result.restoredCaptions=!document.querySelector('[data-yedu-sync-active]');__yeduTestObserver.disconnect();v.volume=__yeduTestOriginalVolume;return result;});
  result.checks={pauseHeld:true,resumed:true,seekRebuilt:true};
  result.pictureClockErrorP95=result.pictureSamples.map(row=>Math.abs(row.picture-row.expected)).sort((a,b)=>a-b)[Math.floor(result.pictureSamples.length*.95)];
  fs.writeFileSync(path.join(folder,sample.label+'-existing-chrome.json'),JSON.stringify(result,null,2));
  const spoken=result.rows.filter(row=>row.text.startsWith('识别：'));
  if(watchMode==='sync'&&result.pictureClockErrorP95>.5)throw new Error('Picture clock P95 exceeded 0.5 seconds');
  if(watchMode==='sync'&&(!result.pictureSamples.length||result.pictureSamples.some(row=>Math.abs(row.picture-row.expected)>.6)))throw new Error('Picture synchronization failed: '+sample.label);
  if(spoken.length<3||result.active!=='true'||result.captionAfterStop||result.pictureAfterStop||!result.restoredMuted||!result.restoredCaptions||result.playbackStatus!=='sample-completed-quality-needs-review')throw new Error('Incomplete real speech playback: '+sample.label);
  console.log(JSON.stringify({sample:sample.label,playbackStatus:result.playbackStatus,segments:spoken.length,first:spoken[0],last:spoken.at(-1),pictureClockErrorP95:result.pictureClockErrorP95,checks:result.checks}));
 }}catch(error){
  const failure=await evaluate(()=>({observation:globalThis.__yeduVoiceObservation,pictureError:document.querySelector('video')?.dataset.yeduPictureError,status:document.getElementById('twp-video-translator')?.shadowRoot?.getElementById('voice-status')?.textContent})).catch(()=>null);
  const consoleState=await cli('console','--level','warning').catch(()=>null);
  fs.writeFileSync(path.join(folder,'latest-failure.json'),JSON.stringify({message:error.message,...failure,console:consoleState},null,2));
  throw error;
 }finally{if(!keepSession)await cli(bound?'unbind':'close').catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
