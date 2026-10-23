// SPDX-License-Identifier: MPL-2.0
// Real YouTube SPA navigation on an explicitly authorized, optionally activated
// dedicated browser session. Uses public page controls only; no private settings.
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const fs=require('node:fs'),path=require('node:path'),run=promisify(execFile);
const session=process.env.YEDU_CHROME_SESSION||'yedu-youtube-owned';
if(process.env.YEDU_TEST_EXISTING_CHROME!=='1'||!/^[a-zA-Z0-9-]{1,80}$/.test(session))throw new Error('Explicit authorized browser session required');
const folder=path.resolve('.local-data/voice/evaluation/youtube-sync-watch');fs.mkdirSync(folder,{recursive:true});
async function cli(...args){const {stdout}=await run('opencli',['browser',...args,'--session',session],{timeout:65000,maxBuffer:1024*1024});const r=JSON.parse(stdout);if(!r.ok)throw new Error(r.error?.message);return r.data;}
const evaluate=fn=>cli('eval','('+fn.toString()+')()');
async function wait(fn,timeout=25000){
 const until=Date.now()+timeout;let checked=0;
 while(Date.now()<until){
  const value=await evaluate(fn);if(value)return value;
  if(Date.now()-checked>3000){
   checked=Date.now();
   const skip=await evaluate(()=>{
    const p=document.querySelector('.html5-video-player');if(!p?.classList.contains('ad-showing'))return null;
    for(const e of p.querySelectorAll('*')){const text=e.textContent?.trim();if(!/^(?:跳过(?:广告)?|Skip(?:\s+ads?)?)$/i.test(text||''))continue;
     const r=e.getBoundingClientRect(),style=getComputedStyle(e);if(!r.width||!r.height||style.visibility==='hidden'||style.display==='none')continue;
     const target=e.closest('button,[role="button"]')||e,classes=[...target.classList];if(!classes.length)continue;
     const selector='.html5-video-player '+target.localName+classes.map(name=>'.'+CSS.escape(name)).join('');
     if(document.querySelectorAll(selector).length===1)return {text,selector};
    }return null;
   });
   // Click the unique, visible Skip control actually offered by the site.
   // Never change the ad timeline, player flags, requests or access controls.
   if(skip){await cli('click',skip.selector);console.log('Clicked the website-provided advertisement Skip control.');}
  }
  await new Promise(r=>setTimeout(r,500));
 }
 throw new Error('YouTube state timeout: '+fn.toString().slice(0,100));
}
(async()=>{
 try{
  const opened=await cli('open','https://www.youtube.com/watch?v=93gOOsREkLQ','--window',process.env.YEDU_CHROME_ACTIVATE==='1'?'foreground':'background');
  if(process.env.YEDU_CHROME_ACTIVATE==='1')await cli('tab','select',opened.page,'--window','foreground');
  await wait(()=>!!document.getElementById('twp-video-translator')?.shadowRoot?.getElementById('voice-start')&&document.querySelector('video')?.readyState>=2);
  if(process.env.YEDU_CHROME_ACTIVATE==='1'){await cli('hover','.html5-video-player');await cli('click','.ytp-play-button');await cli('state','--window','background');}
  const before=await evaluate(async()=>{const v=document.querySelector('video'),r=document.getElementById('twp-video-translator').shadowRoot;if(!navigator.userActivation.hasBeenActive)throw new Error('Test requires prior audio activation');v.volume=0;await v.play().catch(error=>{if(error.name!=='AbortError')throw error;});if(r.getElementById('voice-start').getAttribute('aria-pressed')!=='true')r.getElementById('voice-start').click();globalThis.__yeduActualSpaMarker=Date.now();return {url:location.href,marker:__yeduActualSpaMarker};});
  await wait(()=>!!document.querySelector('[data-yedu-live-voice]'),150000);
  const target=await evaluate(()=>{
   const current=new URL(location.href).searchParams.get('v');
   const links=[...document.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.href),id=u.searchParams.get('v'),title=(a.getAttribute('aria-label')||a.getAttribute('title')||a.innerText||'').trim();if(u.hostname!=='www.youtube.com'||u.pathname!=='/watch'||! /^[\w-]{11}$/.test(id||'')||id===current||a.closest('.html5-video-player')||!/[A-Za-z]{3}/.test(title))return [];const card=a.closest('yt-lockup-view-model,ytd-compact-video-renderer');return [{link:a,id,title,bob:/Bob the Canadian/.test(card?.innerText||''),url:'https://www.youtube.com/watch?v='+id}];}catch{return [];}});
   const chosen=links.find(r=>r.id==='EebIaiwNh9k')||links.find(r=>r.bob)||links.find(r=>/English|Airport|Food Court/i.test(r.title));
   if(!chosen)throw new Error('No observed English recommendation available');
   globalThis.__yeduActualSpaTarget={id:chosen.id,url:chosen.url,title:chosen.title};chosen.link.click();return __yeduActualSpaTarget;
  });
  const after=await wait(()=>{const r=document.getElementById('twp-video-translator')?.shadowRoot,p=document.querySelector('.html5-video-player'),v=document.querySelector('video');if(new URL(location.href).searchParams.get('v')!==globalThis.__yeduActualSpaTarget?.id||p?.getVideoData?.().video_id!==globalThis.__yeduActualSpaTarget?.id||v?.readyState<2||p?.classList.contains('ad-showing'))return false;return {url:location.href,marker:globalThis.__yeduActualSpaMarker,oldActive:r?.getElementById('voice-start').getAttribute('aria-pressed'),oldPicture:!!document.querySelector('[data-yedu-sync-host]'),oldCaption:!!document.querySelector('[data-yedu-live-voice]'),oldTranscript:r?.getElementById('voice-live-text').textContent,restored:!v.muted,panelCount:document.querySelectorAll('#twp-video-translator').length};},150000);
  if(after.marker!==before.marker||after.oldActive!=='false'||after.oldPicture||after.oldCaption||after.oldTranscript?.startsWith('识别：')||!after.restored||after.panelCount!==1)throw new Error('SPA retained old voice or reloaded the document: '+JSON.stringify(after));
  fs.writeFileSync(path.join(folder,'spa-transition.json'),JSON.stringify({before,target,after,checks:{sameDocument:true,oldVoiceStopped:true,pictureRemoved:true,captionRemoved:true,sourceRestored:true,singlePanel:true,oldTranscriptCleared:true}},null,2));
  console.log('Real YouTube SPA transition passed: old speech stopped, source restored, same document and one extension panel.');
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve('tests/video-dubbing-chrome.cjs')],{env:{...process.env,YEDU_CHROME_ACTIVATE:'0',YEDU_CHROME_NATIVE_ACTIVATE:'0',YEDU_CHROME_PLATFORM:'youtube',YEDU_CHROME_SESSION:session,YEDU_CHROME_VIDEO_URL:target.url,YEDU_CHROME_SAMPLE:'youtube-spa-next',YEDU_CHROME_REUSE:'1',YEDU_CHROME_KEEP_SESSION:'1',YEDU_CHROME_SECONDS:process.env.YEDU_CHROME_SECONDS||'90'},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Post-SPA voice verification failed: '+code)));});
 }catch(error){await cli('screenshot',path.join(folder,'spa-failure.png')).catch(()=>{});throw error;}
 finally{await cli('open','about:blank','--window','background').catch(()=>{});await cli('close').catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
