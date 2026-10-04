// SPDX-License-Identifier: MPL-2.0
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
  const calls=[],errors=[],apiRequests=[];let delay=0,fail=false,emptyList=false,partialList=false,pageFallback=false,pageReads=0;
  // Generated silent media gives the real browser a seekable 160-second timeline.
  const samples=8000*160,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const rows=[...Array.from({length:10},(_,i)=>({start:1+i*2,end:2.8+i*2,text:`Early sentence ${i}: vector space and eigenvalues.`})),...Array.from({length:4},(_,i)=>({start:100+i*2,end:101.8+i*2,text:`Later sentence ${i}: matrix decomposition.`}))];
  const stamp=n=>`00:${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(3).padStart(6,'0')}`;
  const vtt='WEBVTT\n\n'+rows.map((row,i)=>`${i}\n${stamp(row.start)} --> ${stamp(row.end)}\n${row.text}\n`).join('\n');
  const html=tracks=>`<!doctype html><meta charset="utf-8"><title>Video translation fixture</title><style>body{background:#181613;color:white;margin:40px}video{width:720px;height:400px;background:#292622}#player{width:720px;position:relative}.bpx-player-control-bottom-right{position:absolute;right:0;bottom:4px;display:flex;align-items:center;height:32px;gap:8px}.native-controls{width:300px;font:12px Arial}</style><h1>Timed video subtitles</h1><div id="player" class="${tracks?'':'bpx-player-container'}"><video ${tracks?'controls':''} muted preload="auto" src="/video.wav">${tracks?'<track kind="subtitles" src="/english.vtt" label="English" srclang="en" default><track kind="subtitles" src="/japanese.vtt" label="Japanese" srclang="ja">':''}</video>${tracks?'':'<div class="bpx-player-control-bottom-right"><span class="native-controls">4K 超高清　倍速　字幕　音量　设置　全屏</span></div>'}</div>`;
  const media=(req,res)=>{
    const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
    res.writeHead(range?206:200,{'content-type':'audio/wav','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1));
  };
  const server=http.createServer((req,res)=>{
    if(req.url==='/video.wav')return media(req,res);
    if(req.url==='/english.vtt'||req.url==='/japanese.vtt'){res.writeHead(200,{'content-type':'text/vtt'});return res.end(req.url==='/english.vtt'?vtt:vtt.replace(/Early sentence/g,'Japanese cue').replace(/Later sentence/g,'Later Japanese cue'));}
    if(!req.url.startsWith('/v1/')){res.writeHead(200,{'content-type':'text/html'});return res.end(html(true));}
    let raw='';req.on('data',part=>raw+=part);req.on('end',async()=>{
      const body=JSON.parse(raw),input=JSON.parse(body.messages.find(message=>message.role==='user').content);calls.push({body,input});
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(fail){res.writeHead(401,{'content-type':'application/json'});return res.end('{"error":{"message":"unauthorized"}}');}
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({translations:input.segments.map(segment=>({id:segment.id,text:'视频译文：'+segment.text}))})},finish_reason:'stop'}]}));
    });
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3'),profile=fs.mkdtempSync(path.resolve('build/video-profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:process.platform==='win32'?'msedge':'chromium',headless:true,viewport:{width:1280,height:940},colorScheme:'dark',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');});
    const settings=await context.newPage();await settings.goto(base+'/options/ai.html');
    await settings.locator('#profile-name').fill('Video AI');await settings.locator('#base-url').fill(origin+'/v1');await settings.locator('#model').fill('video-model');await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('已保存');
    const profileId=await settings.locator('#profiles').inputValue();await settings.locator('#active-profile').selectOption(profileId);await settings.locator('#engine').selectOption('openai');await settings.locator('#preferences-form button[type=submit]').click();
    const page=await context.newPage();await page.goto(origin+'/video');await expect.poll(()=>page.evaluate(()=>document.querySelector('video').readyState)).toBeGreaterThan(0);
    const dock=page.locator('#twp-floating'),panel=page.locator('#twp-video-translator');
    const playerClick=async id=>{await panel.locator('#player-icon').hover();await panel.locator('#'+id).click();};
    const open=async()=>{await dock.locator('#toggle').hover();await dock.locator('#settings').click();await dock.locator('#video-tool').click();await expect(panel.locator('#source option')).toHaveCount(2);};
    // The player entrance is automatic, but neither detection nor translation runs before a click.
    let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
    await expect(panel.locator('#player-tools')).toBeVisible();await expect(panel.locator('#settings-panel')).toBeHidden();expect(calls.length).toBe(0);
    const entranceRect=await panel.locator('#player-tools').boundingBox(),videoRect=await page.locator('video').boundingBox();expect(entranceRect.y).toBeGreaterThanOrEqual(videoRect.y+videoRect.height);expect(entranceRect.y).toBeLessThanOrEqual(videoRect.y+videoRect.height+12);
    // Services edited after automatic entrance creation are still available in settings.
    await worker.evaluate(()=>twpConfig.set('aiProfiles',twpConfig.get('aiProfiles').map(profile=>({...profile,name:profile.name+' updated'}))));
    await expect(panel.locator('#profile option')).toContainText(['Video AI updated']);
    await playerClick('player-settings');await expect(panel.locator('#source option')).toHaveCount(2);await expect(panel.locator('#start')).toBeEnabled();await expect(panel.locator('#profile')).toHaveValue(profileId);await expect(panel.locator('#display')).toHaveValue('translated');
    for(const id of ['expert','glossary','style'])await expect(panel.locator('#'+id)).toBeVisible();
    await panel.locator('#close').click();await page.evaluate(()=>{document.querySelector('video').currentTime=1.2;});await playerClick('player-toggle');
    await expect(panel.locator('#status')).toContainText('已翻译 10 / 14',{timeout:20000});
    expect(calls.length).toBe(2);expect(calls[0].input.segments.length).toBe(8);expect(calls.every(call=>call.body.model==='video-model')).toBe(true);
    await expect(panel.locator('#current')).toContainText('视频译文：Early sentence 0');
    await expect(panel.locator('#captions')).toBeVisible();await expect(panel.locator('#captions')).toContainText('视频译文：Early sentence 0');
    await expect(panel.locator('#settings-panel')).toBeHidden();await expect(panel.locator('#player-toggle')).toHaveAttribute('aria-checked','true');expect(await panel.locator('#captions').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');expect((await panel.locator('.caption-line').first().boundingBox()).width).toBeLessThan(videoRect.width);
    expect(navigations).toBe(0);expect(await page.evaluate(()=>document.querySelector('video').currentTime)).toBeCloseTo(1.2,1);
    await page.screenshot({path:path.resolve('build/video-immersive-preview.png')});
    await playerClick('player-settings');await expect(panel.locator('#settings-panel')).toBeVisible();expect(calls.length).toBe(2);
    const trackState=()=>page.evaluate(()=>[...document.querySelector('video').textTracks].map(track=>({label:track.label,mode:track.mode,cues:[...(track.cues||[])].map(cue=>({start:cue.startTime,end:cue.endTime,text:cue.text}))})));
    let tracks=await trackState();expect(tracks[0].mode).toBe('showing');expect(tracks.at(-1).label).toBe('页渡 · 双语字幕');expect(tracks.at(-1).cues[0].text).toContain('Early sentence 0');expect(tracks.at(-1).cues[0].text).toContain('视频译文');
    await page.locator('video').evaluate(video=>video.requestFullscreen());await expect.poll(async()=>(await trackState()).at(-1).mode).toBe('showing');await expect(panel.locator('#captions')).toBeHidden();await page.evaluate(()=>document.exitFullscreen());await expect(panel.locator('#captions')).toBeVisible();
    await page.locator('#player').evaluate(player=>player.requestFullscreen());await expect(panel.locator('#player-tools')).toBeVisible();await expect(panel.locator('#captions')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.querySelector('#twp-video-translator').parentElement.id)).toBe('player');await page.evaluate(()=>document.exitFullscreen());
    const partialDownload=page.waitForEvent('download');await panel.locator('#export').click();const partial=await partialDownload;expect(partial.suggestedFilename()).toBe('video.partial.bilingual.srt');const content=fs.readFileSync(await partial.path(),'utf8');expect(content).toContain('00:00:01,000 --> 00:00:02,800');expect(content).not.toContain('Later sentence');
    await panel.locator('#display').selectOption('translated');tracks=await trackState();expect(tracks.at(-1).cues[0].text).toBe('视频译文：Early sentence 0: vector space and eigenvalues.');await expect(panel.locator('#captions')).toBeVisible();await expect(panel.locator('#captions')).toHaveText('视频译文：Early sentence 0: vector space and eigenvalues.');await panel.locator('#display').selectOption('bilingual');expect((await trackState())[0].mode).toBe('hidden');
    await page.evaluate(()=>{const video=document.querySelector('video');video.currentTime=100.2;video.playbackRate=2;});await expect(panel.locator('#current')).toContainText('Later sentence 0');await expect(panel.locator('#status')).toContainText('已翻译 14 / 14');expect(calls.length).toBe(3);
    await panel.locator('#all').click();await expect(panel.locator('#status')).toContainText('全部字幕已完成');
    const exported=page.waitForEvent('download');await panel.locator('#export').click();expect((await exported).suggestedFilename()).toBe('video.bilingual.srt');
    await page.screenshot({path:path.resolve('build/video-translation-preview.png')});
    await playerClick('player-toggle');tracks=await trackState();expect(tracks[0].mode).toBe('showing');expect(tracks.at(-1).mode).toBe('disabled');expect(tracks.at(-1).cues.length).toBe(0);expect(navigations).toBe(0);expect(await page.evaluate(()=>document.querySelector('video').currentTime)).toBeCloseTo(100.2,1);
    // Reopening uses persistent per-segment AI cache, beyond the panel's in-memory results.
    await panel.locator('#close').click();await page.evaluate(()=>document.querySelector('video').currentTime=1.2);await open();await panel.locator('#start').click();await expect(panel.locator('#status')).toContainText('已翻译 10 / 14');expect(calls.length).toBe(3);
    await panel.locator('#close').click();await expect(panel.locator('#settings-panel')).toBeHidden();await expect(panel.locator('#captions')).toBeVisible();await expect(panel.locator('#player-toggle')).toHaveAttribute('aria-checked','true');await playerClick('player-settings');await panel.locator('#start').click();
    // A late request cannot restore subtitles after Stop; changing tracks isolates language/cache.
    await panel.locator('#source').selectOption('1');delay=1200;const before=calls.length;await panel.locator('#start').click();await expect.poll(()=>calls.length).toBeGreaterThan(before);await panel.locator('#start').click();await page.waitForTimeout(1400);expect((await trackState()).at(-1).cues.length).toBe(0);await expect(panel.locator('#current')).toHaveText('');delay=0;
    // Failed requests stop automatic retries and preserve a manual retry affordance.
    fail=true;await panel.locator('#start').click();await expect(panel.locator('#retry')).toBeVisible();const failedCount=calls.length;await page.waitForTimeout(900);expect(calls.length).toBe(failedCount);fail=false;await panel.locator('#retry').click();await expect(panel.locator('#status')).toContainText('已翻译 10 / 14');await panel.locator('#start').click();
    // Import subtitles onto the current player, translating without platform support.
    await panel.locator('#import').setInputFiles({name:'lecture.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:04,000\nImported lecture line.\n')});await expect(panel.locator('#status')).toContainText('已导入 1 条');
    await worker.evaluate(()=>{translationService.translateText=async(service,source,target,texts)=>{self.videoFree={service,source,target,texts};return texts.map(text=>'免费字幕：'+text);};});
    await panel.locator('#service').selectOption('bing');await panel.locator('#start').click();await expect(panel.locator('#current')).toContainText('免费字幕：Imported lecture line.');expect((await worker.evaluate(()=>self.videoFree)).service).toBe('bing');await panel.locator('#start').click();
    await page.setViewportSize({width:384,height:880});expect(await panel.boundingBox()).toMatchObject({width:294});expect(await page.evaluate(()=>document.querySelector('#twp-video-translator').getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);await panel.screenshot({path:path.resolve('build/video-panel-narrow.png')});await panel.locator('#close').click();
    // Real extension background + deterministic Bilibili metadata and subtitle network replies.
    await context.route('https://www.bilibili.com/**',route=>{
      if(new URL(route.request().url()).pathname==='/video.wav'){
        const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
        return route.fulfill({status:range?206:200,headers:{'content-type':'audio/wav','accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1)});
      }return route.fulfill({contentType:'text/html',body:html(false)});
    });
    await context.route('https://api.bilibili.com/**',route=>{
      const url=new URL(route.request().url());apiRequests.push(url.href);const data=url.pathname==='/x/web-interface/view'?{aid:123,title:'Bilibili subtitle fixture',pages:[{page:1,cid:10},{page:2,cid:20}]}:{need_login_subtitle:emptyList,subtitle:{subtitles:emptyList?[]:[{lan:'zh',lan_doc:'中文',subtitle_url:'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/chinese.json'},{lan:'en',lan_doc:'English',subtitle_url:'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/test.json'}]}};
      if(partialList&&data.subtitle)data.subtitle.subtitles=data.subtitle.subtitles.slice(0,1);return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
    });
    await context.route('https://aisubtitle.hdslb.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({body:route.request().url().includes('chinese.json')?Array.from({length:31},(_,i)=>({from:i*2,to:i*2+2,content:'我喜欢鱼。'})):rows.map(row=>({from:row.start,to:row.end,content:row.text}))})}));
    await page.route('https://api.bilibili.com/x/player/v2*',async route=>{
      if(!pageFallback)return route.fallback();pageReads++;
      const headers=await route.request().allHeaders();expect(headers.origin).toBe('https://www.bilibili.com');expect(headers.cookie).toContain('video_test=session');
      return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh',lan_doc:'中文',subtitle_url:'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/chinese.json'},{lan:'en',lan_doc:'English',subtitle_url:'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/test.json'}]}}})});
    });
    await context.addCookies([{name:'video_test',value:'session',domain:'.bilibili.com',path:'/',secure:true,sameSite:'Lax'}]);emptyList=false;partialList=true;pageFallback=true;
    await page.setViewportSize({width:1280,height:940});await page.goto('https://www.bilibili.com/video/BV1T84y167U9?p=2');await expect.poll(()=>page.evaluate(()=>document.querySelector('video').readyState)).toBeGreaterThan(0);
    await expect(panel.locator('#player-tools')).toBeVisible();expect(apiRequests.length).toBe(0);await page.evaluate(()=>document.querySelector('video').currentTime=1.2);await playerClick('player-toggle');await expect(panel.locator('#source option')).toHaveCount(2);await expect(panel.locator('#source')).toHaveValue('1');expect(apiRequests.some(url=>url.includes('cid=20'))).toBe(true);
    await expect(panel.locator('#status')).toContainText('已翻译 10 / 14');await expect(panel.locator('#current')).toContainText('视频译文');await expect(panel.locator('#settings-panel')).toBeHidden();await playerClick('player-settings');
    expect(pageReads).toBe(1);pageFallback=false;emptyList=false;partialList=false;
    // Player-only English is absent from the generic endpoint. Observe a real
    // page request before opening settings, then replay that exact signed URL.
    const playerURL='https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=20&w_rid=fixture-player';
    let playerReads=0;
    await page.route('https://api.bilibili.com/x/player/wbi/v2*',route=>{
      playerReads++;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify({code:0,data:{aid:123,cid:20,subtitle:{subtitles:[{lan:'en',lan_doc:'English',subtitle_url:'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/player-only.json'}]}}})});
    });
    await page.evaluate(endpoint=>fetch(endpoint,{credentials:'include'}).then(response=>response.json()),playerURL);
    partialList=true;await panel.locator('#detect').click();await expect(panel.locator('#source option')).toHaveCount(3);
    expect(playerReads).toBeGreaterThanOrEqual(2);
    await expect(panel.locator('#source option').nth(2)).toContainText('English');
    // Restore the baseline; the new, unread track is not retained on reload.
    await page.unroute('https://api.bilibili.com/x/player/wbi/v2*');
    partialList=false;await page.reload();await expect.poll(()=>page.evaluate(()=>document.querySelector('video').readyState)).toBeGreaterThan(0);
    await page.evaluate(()=>document.querySelector('video').currentTime=1.2);await playerClick('player-toggle');await expect(panel.locator('#current')).toContainText('Early sentence 0');await playerClick('player-settings');
    // The row's padding is not the visible label centre (actual Bilibili layout).
    await page.locator('.native-controls').evaluate(el=>{el.style.transform='translateY(-7px)';});
    await expect.poll(async()=>{
      const icon=await panel.locator('#player-icon img').boundingBox();
      const label=await page.locator('.native-controls').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const r=range.getBoundingClientRect();return {y:r.y,height:r.height};});
      return Math.abs(icon.y+icon.height/2-label.y-label.height/2);
    }).toBeLessThan(1);
    const bilibiliEntrance=await panel.locator('#player-tools').boundingBox(),bilibiliVideo=await page.locator('video').boundingBox();expect(bilibiliEntrance.y+bilibiliEntrance.height).toBeLessThanOrEqual(bilibiliVideo.y+bilibiliVideo.height);expect(bilibiliEntrance.x+bilibiliEntrance.width).toBeLessThan(bilibiliVideo.x+bilibiliVideo.width-300);
    await expect(page.locator('.yedu-video-control-slot')).toHaveCount(1);await panel.locator('#close').click();await panel.locator('#player-icon').hover();await page.screenshot({path:path.resolve('build/video-icon-preview.png')});await playerClick('player-settings');
    for(const mode of ['translated','bilingual','translated','bilingual']){await panel.locator('#display').selectOption(mode);await expect(panel.locator('#captions')).toBeVisible();expect(await panel.locator('#captions').innerText()).toBe(mode==='translated'?'视频译文：Early sentence 0: vector space and eigenvalues.':'Early sentence 0: vector space and eigenvalues.\n视频译文：Early sentence 0: vector space and eigenvalues.');}
    // Full reload destroys the content-script memory. A partial API response
    // must still offer the English timeline read earlier in this tab.
    partialList=true;await page.reload();await expect.poll(()=>page.evaluate(()=>document.querySelector('video').readyState)).toBeGreaterThan(0);
    await page.evaluate(()=>document.querySelector('video').currentTime=1.2);await playerClick('player-toggle');
    await expect(panel.locator('#source option')).toHaveCount(2);await expect(panel.locator('#source')).toHaveValue('1');
    await expect(panel.locator('#current')).toContainText('Early sentence 0');await playerClick('player-settings');partialList=false;
    await panel.locator('#start').click();await panel.locator('#source').selectOption('0');const beforeChinese=calls.length;await panel.locator('#start').click();await expect(panel.locator('#captions')).toHaveText('我喜欢鱼。');await expect(panel.locator('#current')).toContainText('源字幕：我喜欢鱼。');await expect(panel.locator('#source-info')).toContainText('31 条');expect(calls.length).toBe(beforeChinese);await expect(panel.locator('#status')).toContainText('未调用翻译服务');
    await panel.locator('#display').selectOption('translated');await expect(panel.locator('#captions')).toBeVisible();await expect(panel.locator('#captions')).toHaveText('我喜欢鱼。');
    partialList=true;await panel.locator('#detect').click();await expect(panel.locator('#source option')).toHaveCount(2);await panel.locator('#start').click();partialList=false;
    await page.evaluate(()=>document.querySelector('video').currentTime=100.2);await expect(panel.locator('#current')).toContainText('该轨道已结束');await expect(panel.locator('#captions')).toBeHidden();
    // The track selector remains usable while translating, even during an
    // in-flight batch; switching cancels the old run and starts the chosen one.
    await expect(panel.locator('#source')).toBeEnabled();await panel.locator('#source').selectOption('1');
    await expect(panel.locator('#current')).toContainText('Later sentence 0');await expect(panel.locator('#captions')).toBeVisible();
    await panel.locator('#source').selectOption('0');await expect(panel.locator('#current')).toContainText('该轨道已结束');
    emptyList=true;await panel.locator('#detect').click();await expect(panel.locator('#status')).toContainText('保留此前已读取');await expect(panel.locator('#source option')).toHaveCount(2);await page.evaluate(()=>document.querySelector('video').currentTime=1.2);await panel.locator('#start').click();await expect(panel.locator('#captions')).toHaveText('我喜欢鱼。');await expect(panel.locator('#captions')).toBeVisible();
    // Visual fixture uses the supplied example wording; no real translator is billed.
    await panel.locator('#start').click();
    await panel.locator('#import').setInputFiles({name:'visual.srt',mimeType:'text/plain',buffer:Buffer.from("1\n00:00:01,000 --> 00:00:04,000\nyou're looking at it, right?\n")});
    await worker.evaluate(()=>{translationService.translateText=async()=>['你正在看着它，对吧？'];});
    await panel.locator('#service').selectOption('bing');await panel.locator('#display').selectOption('translated');await panel.locator('#start').click();
    await expect(panel.locator('#captions')).toHaveText('你正在看着它，对吧？');await expect(panel.locator('.caption-line')).toHaveCount(1);expect((await trackState()).at(-1).cues).toHaveLength(1);
    await page.locator('video').evaluate(video=>video.requestFullscreen());await expect.poll(async()=>(await trackState()).at(-1).mode).toBe('showing');const finalCues=(await trackState()).at(-1).cues;expect(finalCues).toHaveLength(1);expect(finalCues[0].text).toBe('你正在看着它，对吧？');await page.evaluate(()=>document.exitFullscreen());await expect(panel.locator('#captions')).toBeVisible();await expect.poll(async()=>(await trackState()).at(-1).mode).toBe('hidden');
    await panel.locator('#close').click();
    await page.evaluate(()=>{const original=document.createElement('div');original.id='fixture-original';original.className='bpx-player-subtitle-panel';original.textContent="you're looking at it, right?";original.style.cssText='position:absolute;bottom:52px;left:50%;transform:translateX(-50%);width:max-content;padding:2px 10px;background:rgba(18,22,23,.84);color:white;font:20px/1.35 Arial;border-radius:3px';document.querySelector('#player').append(original);document.querySelector('.bpx-player-control-bottom-right').style.visibility='hidden';});
    await panel.locator('#player-icon').press('Escape');await page.mouse.move(900,800);
    await page.screenshot({path:path.resolve('build/video-captions-preview.png')});
    await page.evaluate(()=>document.querySelector('.bpx-player-control-bottom-right').style.visibility='visible');
    await panel.locator('#player-icon').hover();await page.screenshot({path:path.resolve('build/video-icon-preview.png')});await playerClick('player-settings');
    // Reproduce Bilibili moving native subtitles when the controls fade out.
    await panel.locator('#close').click();
    await page.evaluate(()=>{
      const player=document.querySelector('#player'),original=document.querySelector('#fixture-original');
      original.style.bottom='12px';original.style.setProperty('translate','2px 1px','important');
      const progress=document.createElement('div');progress.className='bpx-player-progress-wrap';progress.style.cssText='position:absolute;bottom:48px;width:100%;height:3px;background:#19adff';player.append(progress);
      const style=document.createElement('style');style.textContent='#player:not(:hover) .bpx-player-control-bottom-right,#player:not(:hover) .bpx-player-progress-wrap{opacity:0}#player:hover #fixture-original{bottom:82px!important}';document.head.append(style);
    });
    const nonOverlap=async()=>{
      const original=await page.locator('#fixture-original').boundingBox(),translation=await panel.locator('#captions').boundingBox();
      return original.y+original.height<=translation.y-5;
    };
    await page.mouse.move(900,800);await expect.poll(nonOverlap).toBe(true);
    await page.screenshot({path:path.resolve('build/video-no-hover-preview.png')});
    await page.mouse.move(100,200);await expect.poll(nonOverlap).toBe(true);
    await expect.poll(async()=>{const caption=await panel.locator('#captions').boundingBox(),progress=await page.locator('.bpx-player-progress-wrap').boundingBox();return caption.y+caption.height<=progress.y-6;}).toBe(true);
    await page.screenshot({path:path.resolve('build/video-hover-preview.png')});
    // Repeated transitions must not accumulate the lift. Multi-line source text
    // and container fullscreen keep the same separation rules.
    for(let i=0;i<3;i++){await page.mouse.move(900,800);await expect.poll(nonOverlap).toBe(true);await page.mouse.move(100,200);await expect.poll(nonOverlap).toBe(true);}
    await page.evaluate(()=>{const original=document.querySelector('#fixture-original');original.style.width='300px';original.style.whiteSpace='normal';original.textContent="They look nice and they're awkward to work with, especially when we move them.";});
    await expect.poll(nonOverlap).toBe(true);await page.locator('#player').evaluate(player=>player.requestFullscreen());await expect.poll(nonOverlap).toBe(true);await page.evaluate(()=>document.exitFullscreen());
    await playerClick('player-settings');await panel.locator('#start').click();
    expect(await page.locator('#fixture-original').evaluate(el=>[el.style.getPropertyValue('translate'),el.style.getPropertyPriority('translate')])).toEqual(['2px 1px','important']);
    // Current Bilibili uses subtitle-x: a full-player panel, a positioned block,
    // and inline text spans, not the legacy bpx-player-subtitle-panel node.
    // Structure and positioning checked against its public player module 990.
    await page.evaluate(()=>{
      document.querySelector('#fixture-original').remove();
      const wrap=document.createElement('div');wrap.className='bpx-player-subtitle-wrap';
      wrap.innerHTML='<div class="bili-subtitle-x-subtitle-panel"><div id="fixture-original" class="bili-subtitle-x-subtitle-panel-position" data-position="bottom" data-textalign="center"><div class="bili-subtitle-x-subtitle-panel-major-group"><span class="bili-subtitle-x-subtitle-panel-text">I\'m not describing it well.</span></div></div></div>';
      const style=document.createElement('style');style.textContent='.bpx-player-subtitle-wrap,.bili-subtitle-x-subtitle-panel{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.bili-subtitle-x-subtitle-panel-position{position:absolute;left:5%;width:90%;bottom:14px;text-align:center;font:28px/1.5 Arial}.bili-subtitle-x-subtitle-panel-text{position:relative;padding:2px 12px;background:#171d20e0;border-radius:4px;box-decoration-break:clone;white-space:normal}';
      document.head.append(style);document.querySelector('#player').append(wrap);
    });
    await panel.locator('#start').click();await expect(panel.locator('#captions')).toBeVisible();
    const currentRendererSeparated=async()=>{
      const original=await page.locator('.bili-subtitle-x-subtitle-panel-text').boundingBox(),translation=await panel.locator('#captions').boundingBox();
      return original.y+original.height<=translation.y-5;
    };
    await panel.locator('#close').click();await page.mouse.move(900,800);await expect.poll(currentRendererSeparated).toBe(true);
    await page.screenshot({path:path.resolve('build/video-subtitle-x-no-hover.png')});
    await page.mouse.move(100,200);await expect.poll(currentRendererSeparated).toBe(true);
    await page.screenshot({path:path.resolve('build/video-subtitle-x-hover.png')});
    await playerClick('player-settings');await panel.locator('#display').selectOption('bilingual');
    await expect(page.locator('.bili-subtitle-x-subtitle-panel-text')).toBeHidden();
    await panel.locator('#display').selectOption('translated');await expect(page.locator('.bili-subtitle-x-subtitle-panel-text')).toBeVisible();await expect.poll(currentRendererSeparated).toBe(true);
    // Site renderers replace positioned nodes between lines. Track new nodes,
    // including wrapped text, without accumulating old transforms.
    await page.evaluate(()=>{const old=document.querySelector('#fixture-original'),replacement=old.cloneNode(true);replacement.style.removeProperty('translate');replacement.style.width='60%';replacement.style.left='20%';replacement.querySelector('span').textContent="I'm not describing it well, especially when I try to explain how it works.";old.replaceWith(replacement);});
    await expect.poll(currentRendererSeparated).toBe(true);await page.locator('#player').evaluate(player=>player.requestFullscreen());await expect.poll(currentRendererSeparated).toBe(true);await page.evaluate(()=>document.exitFullscreen());
    await panel.locator('#start').click();expect(await page.locator('#fixture-original').evaluate(el=>el.style.translate)).toBe('');await expect(page.locator('.bili-subtitle-x-subtitle-panel-text')).toBeVisible();
    await panel.locator('#start').click();await expect.poll(currentRendererSeparated).toBe(true);
    await page.evaluate(()=>history.pushState({},'', '?p=1'));await expect(panel.locator('#status')).toContainText('切换视频');expect((await trackState()).at(-1).cues.length).toBe(0);await expect(panel.locator('#start')).toBeDisabled();
    await panel.locator('#close').click();expect(errors).toEqual([]);
    console.log('Video translation passed: bottom controls, original-language preference, Chinese deduplication, display switching, page-login fallback with same-site credentials, retention after empty lists, track coverage diagnostics, both fullscreen modes, lookahead, cache, cancellation, imports, exports and SPA cleanup.');
  }finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
