// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpVideoTranslator = (() => {
  let ui, root, scope, video, videos = [], sources = [], selected, cues = [], output;
  let epoch = 0, discovery = 0, enabled = false, running = false, failed = false, all = false, legacyCancel, clock, routeClock, pageURL;
  let scopeReady, scopeBusy = false, quickStarting = false, entranceClock, suspended = false, playerSlot, chosenSourceKey, detecting = false;
  let translated = new Map(), outputCues = new Map(), changedModes = [], changedCueLines = [], listeners = [];
  const ownTracks = new WeakSet(), outputTracks = new WeakMap();
  const liftedSubtitles = new Map();
  // Current Bilibili uses subtitle-x. Its panel fills the whole video; move the
  // inner positioning block, and measure its inline text rather than the panel.
  const playerSelector='.bpx-player-container, .bilibili-player-video-wrap, .html5-video-player';
  const subtitlePositions='.bili-subtitle-x-subtitle-panel-position, .bili-subtitle-x-subtitle-rawmeat-wrap, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle, .html5-video-player .caption-window';
  const subtitleText='.bili-subtitle-x-subtitle-panel-text, .bili-subtitle-x-subtitle-rawmeat-text, .bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle-item, .ytp-caption-segment';
  const subtitleLayers='.bili-subtitle-x-subtitle-panel, .bili-subtitle-x-subtitle-rawmeat-wrap, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle, .html5-video-player .caption-window';
  let captionFrame;
  let removeMenuListeners;
  let voiceCapture,voicePreview;
  function clearVoicePreview(){if(voicePreview){voicePreview.audio.onended=null;voicePreview.audio.pause();URL.revokeObjectURL(voicePreview.url);voicePreview=null;}}
  function voiceScopeKey(kind){
    const url=new URL(location.href);
    if(kind==='series'){
      if(twpYouTubeSubtitles.videoId(url.href)){const playlist=url.searchParams.get('list');return playlist&&/^[\w-]{1,100}$/.test(playlist)?'youtube:series:'+playlist:twpVideoSubtitles.preferenceKey(url.href);}
      return twpVideoSubtitles.preferenceKey(url.href)?.replace(/:p\d+$/,'')||null;
    }
    const links=twpYouTubeSubtitles.videoId(url.href)?document.querySelectorAll('ytd-watch-metadata #owner a[href], #upload-info #channel-name a[href]'):document.querySelectorAll('.up-info-container a[href], .up-name[href]');
    for(const link of links){try{const owner=new URL(link.href,url.href);
      if(['www.youtube.com','m.youtube.com'].includes(owner.hostname)&&/^\/(?:@[^/]+|channel\/[\w-]+)\/?$/.test(owner.pathname))return 'youtube:speaker:'+owner.pathname.replace(/\/$/,'');
      if(owner.hostname==='space.bilibili.com'&&/^\/\d+\/?$/.test(owner.pathname))return 'bilibili:speaker:'+owner.pathname.replace(/\/$/,'');
    }catch{}}
    return null;
  }
  let autoAttempts=0,autoNext=0,autoRestoring=false,captionWakeups=0,entranceAvailable;
  const savedVideoSettings=()=>{const saved=twpConfig.get('videoTranslationPreferences')?.[location.hostname]||{},key=twpVideoSubtitles.preferenceKey(location.href);return {...saved,enabled:!!key&&!(Array.isArray(saved.disabledVideos)&&saved.disabledVideos.includes(key))};};
  function rememberVideo(on) {
    if(chrome.extension?.inIncognitoContext)return;
    const entries=Object.entries(twpConfig.get('videoTranslationPreferences')||{}).filter(([host])=>host!==location.hostname).slice(-49);
    const key=twpVideoSubtitles.preferenceKey(location.href),saved=savedVideoSettings();
    let disabledVideos=Array.isArray(saved.disabledVideos)?saved.disabledVideos:[];
    if(typeof on==='boolean'&&key){disabledVideos=disabledVideos.filter(value=>value!==key);if(!on)disabledVideos.push(key);}
    twpConfig.set('videoTranslationPreferences',Object.fromEntries([...entries,[location.hostname,{disabledVideos:disabledVideos.slice(-100),service:$('service').value,profileId:$('profile').value,targetLanguage:$('target').value,display:$('display').value,position:$('position').value,voiceSpeed:Number($('voice-speed').value)}]]));
  }
  const $ = id => root.getElementById(id), escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const timeLabel = seconds => new Date(Math.max(0,seconds)*1000).toISOString().slice(11,23);
  const sameLanguage = config => {
    const source=twpVideoSubtitles.language(config.sourceLanguage),target=twpVideoSubtitles.language(config.targetLanguage);
    return source!=='auto'&&(source===target||(source.startsWith('zh-')&&target.startsWith('zh-')));
  };
  function status(message, error = false) {if (!ui) return;$('status').textContent = message;$('status').dataset.error = String(error);$('player-state').textContent = !error&&$('player-state').dataset.gap==='true' ? $('current').textContent : message;$('player-state').dataset.error=String(error);}
  function options() {
    const language=selected?.language || 'auto', normalized=/^zh(?:-|$)/i.test(language)?(twpVideoSubtitles.language(language)==='zh-hant'?'zh-TW':'zh-CN'):twpLang.fixTLanguageCode(language), sourceLanguage=twpLang.getLanguageList()[normalized] ? normalized : 'auto';
    return {service:$('service').value, profileId:$('profile').value || undefined, expertId:$('expert').value || undefined, glossaryId:$('glossary').value || undefined, styleId:$('style').value || undefined, targetLanguage:$('target').value, sourceLanguage};
  }
  function controls() {
    $('start').textContent = enabled ? '停止视频翻译' : '开始翻译字幕';
    for (const id of ['video', 'import']) $(id).disabled = enabled || running || detecting;
    for (const id of ['service', 'profile', 'target']) $(id).disabled = detecting || scopeBusy;
    $('source').disabled = detecting || !sources.length;
    $('detect').disabled = detecting;
    $('start').disabled = !enabled && (running || detecting || scopeBusy || !video || !sources.length);
    $('all').disabled = !enabled || all || failed;
    $('retry').hidden = !failed;
    $('export').disabled = !translated.size;
    const usesAI=$('service').value==='openai';
    $('profile-row').hidden = !usesAI;
    $('ai-service-hint').textContent=usesAI?'专家、术语库和风格将用于本页的 AI 字幕翻译。':'当前服务不使用 AI 专家、术语库和风格；可先配置，切换到「AI · 自定义模型」后生效。';
    $('use-ai').hidden=usesAI;
    $('use-ai').disabled=detecting||scopeBusy;
    syncQuickSettings();
    $('player-toggle').setAttribute('aria-checked', String(enabled));
    $('player-toggle').disabled = quickStarting || scopeBusy || detecting || (!enabled && running);
    $('player-toggle').title = enabled ? '关闭字幕翻译，恢复原字幕' : '开启字幕翻译，不刷新页面';
    $('player-toggle').firstElementChild.textContent = quickStarting || (running && !enabled) ? '准备中…' : '开启字幕翻译';
    $('player-icon').dataset.enabled=String(enabled);
    $('player-icon').title=enabled?'页渡字幕 · 已开启':'页渡字幕翻译';
    // Background restoration can find no tracks when revisiting a video on the same
    // site. Keep its diagnostic in settings, without an inactive-player toast.
    $('player-state').dataset.active=String(enabled||(!autoRestoring&&(quickStarting||running)));
    $('player-state').dataset.busy=String((quickStarting || running) && !translated.size);
  }
  function cancelPending() {epoch++;running = false;twpAIClient.cancel('video');legacyCancel?.();legacyCancel = null;}
  function clearOutput() {
    if(!output)return;
    // Disabled TextTracks expose cues as null in Chromium. Make the list
    // readable BEFORE removing cues, otherwise every restart accumulates it.
    output.mode='hidden';
    for(const cue of [...(output.cues||[])])output.removeCue(cue);
    output.mode='disabled';outputCues.clear();
  }
  function stop(message = '已停止翻译，恢复原字幕。') {
    voiceCapture?.abort();voiceCapture=null;clearVoicePreview();
    twpVideoDubbing.stop();
    cancelPending();enabled = all = failed = false;clearInterval(clock);
    cancelAnimationFrame(captionFrame);restoreSubtitlePositions();
    for (const remove of listeners.splice(0)) remove();
    clearOutput();
    for(const [cue,line] of changedCueLines.splice(0))cue.line=line;
    for (const [track, previous] of changedModes.splice(0)) if (track.mode === 'hidden') track.mode = previous;
    document.documentElement.removeAttribute('data-yedu-video-running');
    if (video) video.removeAttribute('data-yedu-captions');
    if (ui) {controls();$('current').textContent = '';$('captions').hidden = true;$('player-state').dataset.gap='false';status(message);}
  }
  function close() {voiceCapture?.abort();voiceCapture=null;clearVoicePreview();discovery++;detecting=false;stop();clearInterval(routeClock);removeMenuListeners?.();removeMenuListeners=null;playerSlot?.remove();playerSlot=null;ui?.remove();ui = null;root = null;}
  function hidePanel() {if (!ui) return;$('settings-panel').hidden=true;$('player-more').setAttribute('aria-expanded','false');positionEntrance();}
  function showPanel() {if (!ui) return;setPlayerMenu(false);$('settings-panel').hidden=false;$('player-more').setAttribute('aria-expanded','true');}
  function syncQuickSettings() {
    for(const id of ['display','position','target','service','voice-speed']){
      const original=$(id),quick=$('quick-'+id);
      if(quick.options.length!==original.options.length)quick.replaceChildren(...[...original.options].map(option=>new Option(option.text,option.value)));
      quick.value=original.value;quick.disabled=original.disabled;
    }
    $('quick-hint').textContent=enabled?'切换服务或语言后，将从当前播放位置重新翻译。':'模型、专家、术语和风格在「更多设置」中调整。';
  }
  function setPlayerMenu(open) {if(!ui)return;$('player-menu').hidden=!open;$('player-icon').setAttribute('aria-expanded',String(open));positionEntrance();}
  function positionEntrance() {
    if (!ui) return;
    if(!twpVideoSubtitles.isSupportedPage(location.href)){$('player-tools').hidden=true;return;}
    let rect=video?.isConnected ? video.getBoundingClientRect() : null;const dock=$('player-tools');
    const youtubePlayer=video?.closest('.html5-video-player');
    if(rect&&youtubePlayer)rect=youtubePlayer.getBoundingClientRect();
    dock.hidden=!rect || rect.width<120 || rect.height<80 || rect.bottom<80 || rect.top>innerHeight-40 || rect.right<0 || rect.left>innerWidth || document.fullscreenElement===video;
    if(dock.hidden)return;
    const player=video.closest(playerSelector),youtube=player?.classList.contains('html5-video-player');
    const bar=player?.querySelector('.bpx-player-control-bottom-right, .bilibili-player-video-btn-start + .bilibili-player-video-control-bottom-right, .ytp-right-controls');
    // During refresh the video often exists before its player controls. Do not
    // place a platform button using the generic below-video fallback or a stale slot.
    const platformPlayer=player||/(^|\.)(bilibili\.com|youtube\.com)$/.test(location.hostname);
    if(platformPlayer&&!bar){playerSlot?.remove();playerSlot=null;dock.hidden=true;return;}
    // Bilibili mounts the empty row before its controls/CSS. Our own slot gives
    // that empty row a size, so slot/bar dimensions alone cannot prove readiness.
    // Require a site-owned control, independent of anything inserted by Yedu.
    const nativeControls=[...(bar?.children||[])].filter(element=>element!==playerSlot&&!element.classList.contains('yedu-video-control-slot'));
    const neighbour=nativeControls.find(element=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);return box.width>=8&&box.height>=8&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0;});
    if(platformPlayer&&!neighbour){playerSlot?.remove();playerSlot=null;dock.hidden=true;return;}
    // Reserve a real slot in the control row, then align our isolated Shadow DOM
    // button to it. The site's quality/fullscreen controls retain their space.
    if(playerSlot?.parentElement!==bar){playerSlot?.remove();playerSlot=null;if(bar){playerSlot=document.createElement('span');playerSlot.className='yedu-video-control-slot';playerSlot.setAttribute('aria-hidden','true');playerSlot.style.cssText='display:inline-block;flex:0 0 32px;width:32px;height:32px;align-self:center;';bar.prepend(playerSlot);}}
    if(playerSlot&&youtube)playerSlot.style.float='left';
    const slotRect=playerSlot?.getBoundingClientRect(), barRect=bar?.getBoundingClientRect();
    if(platformPlayer&&(!barRect?.width||!barRect.height||!slotRect?.width||!slotRect.height||slotRect.left<rect.left-8||slotRect.right>rect.right+8||barRect.top<rect.top+rect.height/2||barRect.bottom>rect.bottom+12)){dock.hidden=true;return;}
    // Native children can arrive before the CSS that right-aligns the row.
    if(platformPlayer&&barRect.right<rect.right-Math.max(48,rect.width*.12)){dock.hidden=true;return;}
    // Bilibili's row includes padding below its visible labels. Align to the
    // neighbouring control's rendered text, rather than the row's box centre.
    let anchorRect=neighbour?.getBoundingClientRect();
    if(neighbour){
      const walker=document.createTreeWalker(neighbour,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.textContent.trim()&&visibleInPlayer(node.parentElement,player)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
      const text=walker.nextNode();
      if(text){const range=document.createRange();range.selectNodeContents(text);const bounds=range.getBoundingClientRect();if(bounds.height&&bounds.width)anchorRect=bounds;}
    }
    const left=slotRect?.width?slotRect.left-(youtube?0:8):rect.right-(player?Math.min(430,rect.width*.45):12)-32;
    const alignRect=anchorRect?.height?anchorRect:barRect;
    const top=alignRect?.height?alignRect.top+(alignRect.height-32)/2:player?rect.bottom-40:rect.bottom+8;
    const x=Math.max(8,Math.min(innerWidth-40,left));
    Object.assign(dock.style,{width:'32px',left:x+'px',top:Math.max(8,Math.min(innerHeight-40,top))+'px'});
    if(bar){let hidden=!slotRect?.width;for(let node=bar;node&&node!==player;node=node.parentElement){const style=getComputedStyle(node);hidden ||= style.visibility==='hidden'||style.display==='none'||Number(style.opacity)===0;}dock.hidden=hidden&&$('player-menu').hidden;}
    const menu=$('player-menu'),quick=$('quick-settings');
    menu.style.left=Math.max(8-x,Math.min(-196,innerWidth-x-240))+'px';
    if(!menu.hidden){
      // Extra settings must scroll inside their section, not push the caption
      // switch beyond the viewport. Keep the switches outside this scroll area.
      const headerHeight=menu.offsetHeight-quick.offsetHeight;
      const above=Math.max(0,parseFloat(dock.style.top)-18),below=Math.max(0,innerHeight-parseFloat(dock.style.top)-50);
      const minimum=headerHeight+(quick.hidden?0:Math.min(120,quick.scrollHeight));
      const under=above<minimum&&below>above,available=under?below:above;
      quick.style.maxHeight=Math.max(0,available-headerHeight)+'px';
      menu.dataset.placement=under?'below':'above';
      menu.style.top=under?'42px':'auto';menu.style.bottom=under?'auto':'42px';
      const bounds=menu.getBoundingClientRect();
      if(bounds.top<8||bounds.bottom>innerHeight-8){menu.style.top=(Math.max(8,Math.min(bounds.top,innerHeight-bounds.height-8))-parseFloat(dock.style.top))+'px';menu.style.bottom='auto';}
    }
  }
  async function toggleFromPlayer() {
    autoAttempts=3;
    if (enabled) {rememberVideo(false);stop();return;}
    if (quickStarting || running) return;
    quickStarting=true;controls();const url=location.href;
    try {
      await scopeReady;
      if (!sources.length) await detect();
      if (!ui || location.href!==url) return;
      if (!sources.length) {showPanel();return;}
      await start();
      if (!enabled) showPanel();
    } catch(error) {if(ui){status(error.message || '字幕翻译启动失败',true);showPanel();}}
    finally {quickStarting=false;if(ui)controls();}
  }
  function restoreSubtitlePositions(disconnectedOnly=false) {
    for(const [element, saved] of liftedSubtitles){
      if(disconnectedOnly&&element.isConnected)continue;
      if(element.style.getPropertyValue('translate')===saved.applied){
        if(saved.value)element.style.setProperty('translate',saved.value,saved.priority);
        else element.style.removeProperty('translate');
      }
      liftedSubtitles.delete(element);
    }
  }
  function visibleInPlayer(element, player) {
    for(let node=element;node;node=node.parentElement){
      const style=getComputedStyle(node);
      if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.05)return false;
      if(node===player)break;
    }
    return !!element.getBoundingClientRect().height;
  }
  function layoutCaptions() {
    if(!ui||!enabled||!video?.isConnected)return;
    restoreSubtitlePositions(true);
    const overlay=$('captions'),rect=video.getBoundingClientRect();
    if(overlay.hidden){restoreSubtitlePositions();return;}
    const player=video.closest(playerSelector);
    const position=$('position').value,fontSize=Math.max(18,Math.min(42,rect.width*.028));
    const candidates=[...(player?.querySelectorAll(subtitlePositions)||[])];
    const originals=candidates.filter(element=>!candidates.some(parent=>parent!==element&&parent.contains(element))&&element.textContent.trim()&&visibleInPlayer(element,player));
    let bottom=Math.min(innerHeight-12,rect.bottom-12);
    // Both progress and button rows occupy space while visible. Inspect actual
    // geometry/ancestor opacity, including the site's hover/fade transitions.
    for(const control of player?.querySelectorAll('.bpx-player-control-bottom, .bpx-player-control-bottom-right, .bpx-player-progress-wrap, .bilibili-player-video-control-bottom, .bilibili-player-video-progress, .ytp-chrome-bottom, .ytp-progress-bar-container')||[]){
      const box=control.getBoundingClientRect();
      if(box.top>rect.top+rect.height/2&&box.top<rect.bottom&&visibleInPlayer(control,player))bottom=Math.min(bottom,box.top-8);
    }
    if(!player&&video.controls)bottom=Math.min(bottom,rect.bottom-60);
    // Burned-in captions are video pixels, so no DOM subtitle can be lifted.
    // Reserve a bottom band on Bilibili instead of treating an empty/disabled
    // platform subtitle layer as evidence that the picture has no captions.
    const reserve=position==='raised'||(position==='auto'&&/(^|\.)bilibili\.com$/.test(location.hostname)&&!originals.length);
    if(reserve)bottom=Math.min(bottom,rect.bottom-Math.min(rect.height*.4,Math.max(72,fontSize*3.5,rect.height*.22)));
    const left=Math.max(0,rect.left),width=Math.max(0,Math.min(rect.right,innerWidth)-left);
    Object.assign(overlay.style,{left:left+'px',top:bottom+'px',width:width+'px',fontSize:fontSize+'px'});
    if(position==='top'){
      restoreSubtitlePositions();
      overlay.style.top=Math.max(12,rect.top+Math.min(24,rect.height*.06))+overlay.getBoundingClientRect().height+'px';
      return;
    }
    if($('display').value!=='translated'){restoreSubtitlePositions();return;}
    const ceiling=overlay.getBoundingClientRect().top-6;
    for(const element of originals){
      if(!element.textContent.trim()||!visibleInPlayer(element,player))continue;
      let saved=liftedSubtitles.get(element);
      if(saved&&element.style.getPropertyValue('translate')!==saved.applied){liftedSubtitles.delete(element);saved=null;}
      if(!saved){
        const base=getComputedStyle(element).translate;
        saved={value:element.style.getPropertyValue('translate'),priority:element.style.getPropertyPriority('translate'),base:base==='none'?['0px','0px']:base.split(' '),offset:0,applied:element.style.getPropertyValue('translate')};
        liftedSubtitles.set(element,saved);
      }
      const texts=[...element.querySelectorAll(subtitleText)].filter(text=>text.textContent.trim()&&visibleInPlayer(text,player));
      const boxes=(texts.length?texts:[element]).map(text=>text.getBoundingClientRect());
      const box={top:Math.min(...boxes.map(box=>box.top)),bottom:Math.max(...boxes.map(box=>box.bottom))};box.height=box.bottom-box.top;
      if(!box.height||box.height>rect.height/2)continue;
      const offset=Math.min(0,ceiling-(box.bottom-saved.offset));
      if(Math.abs(offset-saved.offset)>.25){
        const [x,y='0px',z]=saved.base;
        element.style.setProperty('translate',`${x} calc(${y} + ${offset}px)${z?' '+z:''}`,'important');
        saved.offset=offset;saved.applied=element.style.getPropertyValue('translate');
      }
    }
  }
  function followCaptionLayout() {
    if(!enabled)return;
    layoutCaptions();captionFrame=requestAnimationFrame(followCaptionLayout);
  }
  function render() {
    if (!enabled || !video) return;
    if(selected?.kind==='youtube'){
      const ad=video.closest('.html5-video-player')?.classList.contains('ad-showing');
      document.documentElement.toggleAttribute('data-yedu-video-running',!ad&&$('display').value==='bilingual');
      if(ad){$('captions').hidden=true;output.mode='hidden';restoreSubtitlePositions();return;}
    }
    const active = twpVideoSubtitles.active(cues, video.currentTime);
    const next=cues.find(cue=>cue.start>video.currentTime);
    const passthrough=sameLanguage(options());
    $('current').textContent = active.length ? active.map(cue => `${timeLabel(cue.start)} – ${timeLabel(cue.end)}\n源字幕：${cue.text}\n${passthrough?'源语言与目标语言相同，直接显示源字幕。':'译文：'+(translated.get(cue.id)||'准备中…')}`).join('\n\n') : `当前 ${timeLabel(video.currentTime)} 没有对应的源字幕。${next?'下一条从 '+timeLabel(next.start)+' 开始。':'该轨道已结束，请选择另一字幕轨道。'}`;
    $('player-state').dataset.gap=String(!active.length&&!next&&video.currentTime<video.duration-2);
    if($('player-state').dataset.gap==='true')$('player-state').textContent=$('current').textContent;
    const directFullscreen = document.fullscreenElement === video, rect = video.getBoundingClientRect(), overlay = $('captions');
    output.mode = directFullscreen ? 'showing' : 'hidden';
    const lines=[...new Set(active.flatMap(cue => twpVideoSubtitles.displayText(cue,translated.get(cue.id),$('display').value).split('\n')).filter(Boolean))];
    overlay.hidden = directFullscreen || !lines.length || rect.bottom < 0 || rect.top > innerHeight;
    const signature=JSON.stringify(lines);
    if(overlay.dataset.lines!==signature){overlay.dataset.lines=signature;overlay.replaceChildren(...lines.map(text=>{const line=document.createElement('div');line.className='caption-line';line.textContent=text;return line;}));}
    layoutCaptions();
    for (const cue of active) {
      const target = outputCues.get(cue.id);if (target) target.text = caption(cue);
    }
  }
  function caption(cue) {
    const text = translated.get(cue.id);
    return escape(twpVideoSubtitles.displayText(cue,text,$('display').value));
  }
  function syncNativeCaptions() {
    if(!enabled)return;
    const bilingual=$('display').value==='bilingual';
    document.documentElement.toggleAttribute('data-yedu-video-running',bilingual);
    for(const [cue,line] of changedCueLines.splice(0))cue.line=line;
    for(const [track,previous] of changedModes)if(previous==='showing')track.mode=bilingual?'hidden':'showing';
    if(!bilingual)for(const [track,previous] of changedModes)if(previous==='showing')for(const cue of track.cues||[]){if(cue.line==='auto'){changedCueLines.push([cue,cue.line]);cue.line=-3;}}
    for(const cue of outputCues.values())cue.line=$('position').value==='top'?1:($('position').value==='raised'||($('position').value==='auto'&&/(^|\.)bilibili\.com$/.test(location.hostname)))?-5:bilingual?-3:-1;
  }
  function translate(texts, config) {
    if (sameLanguage(config)) return Promise.resolve(texts);
    if (config.service === 'openai') return twpAIClient.translate(texts, config.targetLanguage, 'Video subtitles: ' + selected.key, 'video', {...config, cacheBySegment:true, cacheLabel:document.title + ' · 视频字幕'});
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, values) => {if (done) return;done = true;clearTimeout(timer);legacyCancel = null;error ? reject(error) : resolve(values);};
      const timer = setTimeout(() => finish(new Error('字幕翻译超时，请重试或更换服务')), 30000);
      legacyCancel = () => finish(new Error('已取消翻译'));
      try {chrome.runtime.sendMessage({action:'translateText', translationService:config.service, sourceLanguage:config.sourceLanguage, targetLanguage:config.targetLanguage, sourceArray:texts}, values => {
        const error = chrome.runtime.lastError;
        if (error || !Array.isArray(values) || values.length !== texts.length || values.some(text => typeof text !== 'string' || !text.trim())) finish(new Error('字幕翻译失败，请检查网络或更换服务'));
        else finish(null, values);
      });} catch {finish(new Error('扩展连接已断开，请刷新网页'));}
    });
  }
  async function pump() {
    if(selected?.kind==='youtube'&&video?.closest('.html5-video-player')?.classList.contains('ad-showing'))return;
    if (!enabled || running || failed || !video?.isConnected) return;
    const token = epoch, candidates = all ? cues.filter(cue => !translated.has(cue.id)) : twpVideoSubtitles.upcoming(cues, video.currentTime, translated);
    const batch = [];let size = 0;
    for (const cue of candidates) {if (batch.length >= 8 || size + cue.text.length > 3000 && batch.length) break;batch.push(cue);size += cue.text.length;}
    if (!batch.length) {status(sameLanguage(options())?'正在显示源字幕 · 源语言与目标语言相同，未调用翻译服务。':`已翻译 ${translated.size} / ${cues.length} 条 · ${all ? '全部字幕已完成' : '随播放提前翻译约 60 秒'}`);return;}
    running = true;const started = Date.now();
    const progress = () => {if (epoch === token && enabled) status(`正在翻译 · 已完成 ${translated.size} / ${cues.length} 条 · 本批已等待 ${Math.floor((Date.now() - started) / 1000)} 秒`);};
    progress();const ticker = setInterval(progress, 1000);
    try {
      const values = await translate(batch.map(cue => cue.text), options());
      if (token !== epoch || !enabled) return;
      if (values.length !== batch.length) throw new Error('字幕译文不完整，请重试');
      batch.forEach((cue, index) => {translated.set(cue.id, values[index]);const target = outputCues.get(cue.id);if (target) target.text = caption(cue);});
      render();controls();
    } catch (error) {
      if (token === epoch && enabled) {failed = true;status((error.message || '字幕翻译失败') + '；已有结果保留，点击「重试」。', true);controls();}
    } finally {clearInterval(ticker);if (token === epoch) {running = false;controls();}}
  }
  async function start() {
    if (enabled) {rememberVideo(false);stop();return;}
    if (running || scopeBusy || !video || !sources[$('source').value]) return;
    selected = sources[$('source').value];const source=selected, config = options();
    if (config.service === 'openai' && !config.profileId && !sameLanguage(config)) {status('请先在模型与术语设置中添加 AI 服务。', true);return;}
    const token = ++epoch;running = true;controls();status('正在载入字幕时间轴…');
    try {
      let loaded;
      if (source.kind === 'native') {
        if (source.track.mode === 'disabled') {changedModes.push([source.track, 'disabled']);source.track.mode = 'hidden';}
        const deadline = Date.now() + 8000;
        while (!source.track.cues?.length && Date.now() < deadline && epoch === token) await new Promise(resolve => setTimeout(resolve, 150));
        loaded = twpVideoSubtitles.normalize([...(source.track.cues || [])].map(cue => ({start:cue.startTime, end:cue.endTime, text:cue.text})));
      } else if (['bilibili','youtube'].includes(source.kind)) loaded = source.cues?.length && source.pageURL===pageURL && source.video===video ? source.cues : (await twpAIClient.call({action:source.kind==='youtube'?'youtubeSubtitlesRead':'videoSubtitlesRead', token:source.token, pageURL:location.href})).cues;
      else loaded = source.cues;
      if (token !== epoch || !ui) return;
      cues = loaded;
      if (!cues.length) throw new Error('没有可读取的文字字幕，请开启网站字幕后重新检测，或导入 SRT / VTT。');
      if(['bilibili','youtube'].includes(source.kind)){source.cues=loaded;source.video=video;source.pageURL=pageURL;}
      $('source-info').textContent=`${source.label} · ${cues.length} 条 · 时间范围 ${new Date(cues[0].start*1000).toISOString().slice(11,19)} – ${new Date(Math.max(...cues.map(cue=>cue.end))*1000).toISOString().slice(11,19)}`;
      // Restart goes through the shared cache so updated saved terminology and
      // cache deletions are respected, rather than reusing stale panel results.
      translated = new Map();
      output = outputTracks.get(video);
      if (!output) {output = video.addTextTrack('subtitles', '页渡 · 双语字幕', config.targetLanguage);ownTracks.add(output);outputTracks.set(video, output);}
      clearOutput();
      for (const track of video.textTracks) if (track !== output && ['subtitles','captions'].includes(track.kind) && track.mode === 'showing') {changedModes.push([track, 'showing']);track.mode = 'hidden';}
      for (const cue of cues) {const target = new VTTCue(cue.start, cue.end, caption(cue));target.line = -3;output.addCue(target);outputCues.set(cue.id, target);}
      video.setAttribute('data-yedu-captions','');document.documentElement.setAttribute('data-yedu-video-running','');output.mode = 'hidden';
      enabled = true;running = false;failed = all = false;syncNativeCaptions();
      rememberVideo(true);
      const listen = (event, callback) => {video.addEventListener(event, callback);listeners.push(()=>video.removeEventListener(event, callback));};
      for (const event of ['timeupdate','play','pause','ratechange']) listen(event, render);
      listen('seeking', () => {cancelPending();render();void pump();});
      listen('emptied', () => {stop('播放器已切换视频，请重新检测字幕。');sources=[];$('source').replaceChildren();controls();});
      if (source.kind === 'native') {const change = () => {try {const updated=twpVideoSubtitles.normalize([...(source.track.cues || [])].map(cue=>({start:cue.startTime,end:cue.endTime,text:cue.text})));if(updated.length!==cues.length||updated.some(cue=>!outputCues.has(cue.id))){stop('字幕轨道已更新，请重新开始翻译。');}else render();}catch {stop('字幕轨道格式已变化，请重新检测。');}};source.track.addEventListener('cuechange',change);listeners.push(()=>source.track.removeEventListener('cuechange',change));}
      clock = setInterval(() => {if (location.href !== pageURL || !video.isConnected) {stop('视频页面已变化，请重新检测字幕。');return;}render();void pump();}, 300);
      controls();render();followCaptionLayout();void pump();
    } catch (error) {if (epoch === token && ui) stop(error.message || '字幕载入失败，请重试');}
    finally {if (epoch === token && ui && !enabled) {running = false;controls();}}
  }
  async function detect() {
    const token = ++discovery, preferred=video;stop('正在检测视频与字幕…');pageURL = location.href;
    videos = [...document.querySelectorAll('video')].filter(element => element.isConnected && element.getBoundingClientRect().width > 20).slice(0,20);
    $('video').replaceChildren(...videos.map((element,index)=>new Option(`视频 ${index+1}${element.title ? ' · '+element.title : ''}`,String(index))));
    $('video').value=String(Math.max(0,videos.indexOf(preferred)));
    video = videos[Number($('video').value || 0)];
    await detectSources(token);
  }
  async function detectSources(token = ++discovery) {
    detecting=true;$('video-info').textContent='';controls();
    const previousVideo=video, previous=sources[$('source').value], previousSources=sources, found=[];video = videos[Number($('video').value || 0)];
    if (!video) {detecting=false;sources=[];status('当前页面未找到视频播放器。请在视频所在页面打开此功能。', true);$('source').replaceChildren();controls();return;}
    for (const [index, track] of [...video.textTracks].entries()) if (!ownTracks.has(track) && ['subtitles','captions'].includes(track.kind)) found.push({kind:'native', track, video, language:track.language || 'auto', label:track.label || track.language || `字幕 ${index+1}`, key:pageURL+':track:'+index});
    let notice = '';
    if(twpYouTubeSubtitles.videoId(location.href)){
      status('正在读取当前 YouTube 播放器字幕…');
      try {
        const result=await twpAIClient.call({action:'youtubeSubtitlesList',pageURL:location.href});
        if(token!==discovery||!ui)return;
        notice=result.notice;$('video-info').textContent='字幕来源视频：'+result.title;
        found.push(...result.tracks.map(track=>({...track,kind:'youtube',video,pageURL,key:result.videoKey+':'+track.trackId})));
      }catch(error){notice=error.message;}
    }
    if (/(^|\.)bilibili\.com$/.test(location.hostname)) {
      status('正在读取 B 站字幕列表…');
      try {
        let result=await twpAIClient.call({action:'videoSubtitlesList',pageURL:location.href});if(token!==discovery||!ui)return;
        // Content-script fetch uses the video's web origin and its same-site login
        // state. Only fixed API IDs from the background are used, never a page URL.
        if(result.pageToken){
          status('正在使用当前网页登录状态读取字幕…');
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000),url=location.href;
          try {
            // The actual player may use a signed /wbi/v2 request with a fuller
            // list than the generic v2 call. Reuse only URLs observed in THIS
            // tab and matching the resolved video/part; never generate tokens.
            const observed=twpVideoSubtitles.playerAPIURLs([...(result.playerURLs||[]),...performance.getEntriesByType('resource').map(entry=>entry.name)],result);
            const urls=[...new Set(['https://api.bilibili.com/x/player/v2?'+new URLSearchParams({aid:result.aid,cid:result.cid}),...observed])];
            const replies=await Promise.allSettled(urls.map(async endpoint=>{
              const response=await fetch(endpoint,{credentials:'include',signal:controller.signal,redirect:'error'});
              const text=await response.text();if(!response.ok||text.length>3000000)throw new Error('字幕读取失败');
              const data=JSON.parse(text),body=data.data;
              if(data.code!==0||(body?.aid!=null&&String(body.aid)!==String(result.aid))||(body?.cid!=null&&String(body.cid)!==String(result.cid)))return [];
              return Array.isArray(body?.subtitle?.subtitles)?body.subtitle.subtitles:[];
            }));
            const tracks=[...new Map(replies.flatMap(reply=>reply.status==='fulfilled'?reply.value:[]).map(track=>[String(track.id_str||track.id||track.subtitle_url),track])).values()].slice(0,50);
            if(token!==discovery||!ui||location.href!==url)return;
            if(Array.isArray(tracks)&&tracks.length){
              const pageResult=await twpAIClient.call({action:'videoSubtitlesPageList',pageURL:url,token:result.pageToken,aid:result.aid,cid:result.cid,tracks});
              const merged=new Map([...result.tracks,...pageResult.tracks].map(track=>[track.trackId,track]));
              result={...result,...pageResult,tracks:[...merged.values()]};
            }
          }catch{/* Retain the background's login notice and any downloaded timeline. */}
          finally{clearTimeout(timer);}
        }
        if(token!==discovery||!ui)return;notice=result.notice;$('video-info').textContent='字幕来源视频：'+result.title;found.push(...result.tracks.map(track=>({...track,kind:'bilibili',video,pageURL,key:result.videoKey+':'+track.trackId})));
      }
      catch (error) {notice = error.message;}
    }
    if (token !== discovery || !ui) return;
    // Transient empty API responses must not discard a previously downloaded timeline.
    const retained=previousSources.filter(source=>source.video===video&&source.pageURL===pageURL&&source.cues?.length);
    if(!found.length&&retained.length){sources=retained;notice=(notice||'字幕接口暂未返回轨道')+'；保留此前已读取的字幕。';}
    else {
      // Keep downloaded tracks through partial as well as completely empty lists.
      sources=found.map(source=>{const old=retained.find(item=>item.key===source.key);return old?{...old,...source}:source;}).concat(retained.filter(source=>!found.some(item=>item.key===source.key)));
    }
    if(previousVideo!==video || !sources.some(source=>source.key===previous?.key)){translated=new Map();cues=[];}
    $('source').replaceChildren(...sources.map((source,index)=>new Option(source.label+` · ${source.kind==='native'?'网页轨道':source.kind==='import'?'已导入':source.kind==='youtube'?'YouTube':'B 站'}`,String(index))));
    $('source').value=String(twpVideoSubtitles.preferredSource(sources,$('target').value,previousVideo===video?chosenSourceKey:undefined));
    detecting=false;
    $('source-info').textContent=sources.length===1?`只检测到 ${sources[0].label} 一条文字轨道。画面中的英文不一定有独立字幕轨道；可重新检测或导入英文 SRT / VTT。`:`检测到 ${sources.length} 条轨道，翻译中也可直接切换。`;
    status(sources.length ? notice || `检测到 ${sources.length} 个字幕轨道，默认优先选择原语言字幕。` : notice || '暂未获取到可读取的字幕轨道。请在网站字幕菜单确认并开启轨道后重试，或导入 SRT / VTT。画面中的文字可能是视频内嵌字幕，并不代表存在文字轨道。', !sources.length);controls();
  }
  function mount(initial) {
    initial={...savedVideoSettings(),...initial};
    ui = document.createElement('div');ui.id='twp-video-translator';ui.className='notranslate';ui.setAttribute('translate','no');
    ui.style.cssText='all:initial!important;position:fixed!important;right:70px!important;top:24px!important;z-index:2147483647!important;';root=ui.attachShadow({mode:'open'});
    root.innerHTML=`<style>:host{font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}section{width:360px;max-width:calc(100vw - 90px);max-height:calc(100vh - 48px);overflow:auto;padding:18px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 40px #0005}h2{font-size:18px;margin:0}header{display:flex;align-items:center;justify-content:space-between}button,select,input{font:inherit;color:inherit}button,select{cursor:pointer}button{border:1px solid var(--border);border-radius:9px;padding:9px 12px;background:var(--surface)}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}label{display:block;color:var(--muted);font-size:12px;margin:10px 0 4px}select{width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.row button{flex:1}#start{width:100%;margin-top:14px;background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:650}#status{font-size:12px;color:var(--muted);white-space:pre-wrap}#status[data-error=true]{color:var(--error)}.hint{font-size:11px;color:var(--muted)}#current{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);border-radius:8px;padding:10px;max-height:140px;overflow:auto;font-size:13px}#close{border:0;background:none;padding:2px;font-size:12px}#import{max-width:100%;font-size:11px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}</style><link rel="stylesheet" href="${chrome.runtime.getURL('lib/brandTheme.css')}"><section role="dialog" aria-label="视频字幕翻译"><header><h2>视频字幕翻译</h2><button id="close">关闭</button></header><label for="video">当前播放器</label><select id="video"></select><label for="source">原字幕轨道</label><select id="source"></select><button id="detect" style="width:100%;margin-top:8px">重新检测字幕</button><label for="import">或导入此视频的 SRT / VTT</label><input id="import" type="file" accept=".srt,.vtt"><div class="pair"><div><label for="service">翻译服务</label><select id="service"><option value="bing">微软翻译</option><option value="google">谷歌翻译</option><option value="yandex">Yandex</option><option value="openai">AI · 自定义模型</option></select></div><div><label for="target">目标语言</label><select id="target"></select></div></div><div id="profile-row"><label for="profile">模型服务</label><select id="profile"></select></div><div id="ai-options"><label for="expert">此视频页面的 AI 专家</label><select id="expert"></select><label for="glossary">术语库</label><select id="glossary"></select><label for="style">翻译风格</label><select id="style"></select><p id="scope-notice" class="hint"></p><button id="scope-reset">恢复跟随全局</button></div><label for="display">字幕显示</label><select id="display"><option value="bilingual">原文 + 译文</option><option value="translated">仅译文</option></select><button id="start" disabled>开始翻译字幕</button><p id="status" role="status" aria-live="polite"></p><button id="retry" hidden>重试</button><div id="current"></div><div class="row"><button id="all" disabled>翻译全部字幕</button><button id="export" disabled>导出双语 SRT</button></div><p class="hint">默认提前翻译约 60 秒。翻译全部会处理整条字幕轨道；AI 按所选服务计费。原视频和音频不上传。</p></section>`;
    document.documentElement.append(ui);
    $('close').textContent='收起';
    $('close').title='收起设置，字幕翻译继续运行';
    root.querySelector('section').id='settings-panel';
    root.querySelector('section > .hint:last-child').textContent='字幕翻译默认提前约 60 秒，AI 按所选服务计费。在线字幕翻译不上传视频音频；本地配音仅发送字幕或音频分段到本机服务。';
    const sourceInfo=document.createElement('p');sourceInfo.id='source-info';sourceInfo.className='hint';$('source').after(sourceInfo);
    const voiceSettings=document.createElement('template');voiceSettings.innerHTML='<div id="local-voice-options"><label for="voice-mode">本地中文配音 · 实验版</label><select id="voice-mode"><option value="auto">优先字幕同步；无字幕时音频识别（有延迟）</option><option value="subtitles">字幕同步配音（按起止时间）</option><option value="audio">实时英语音频识别（与画面有延迟）</option></select><button id="voice-start" type="button" aria-pressed="false">开启本地配音</button><button id="voice-connect" type="button">测试本地连接</button><p id="voice-status" class="hint" role="status" aria-live="polite">先运行 local-voice/start.ps1。字幕配音按每条字幕起止时间播放，提前合成；未准备好时暂用原声，视频继续播放。实时音频识别存在延迟。关闭后恢复原声。只发送字幕或音频分段到本机。</p></div>';$('import').after(voiceSettings.content);
    const videoInfo=document.createElement('p');videoInfo.id='video-info';videoInfo.className='hint';$('video').after(videoInfo);
    const voicePace=document.createElement('template');voicePace.innerHTML='<label for="voice-speed">实时识别配音语速</label><select id="voice-speed"><option value="0.75">0.75 倍 · 慢速</option><option value="1">1 倍 · 原速</option><option value="1.25">1.25 倍 · 默认</option><option value="1.5">1.5 倍</option><option value="1.75">1.75 倍</option><option value="2">2 倍</option></select><p class="hint">仅用于没有字幕时间轴的实时识别。字幕同步模式自动匹配每条字幕时长，保留音调；倍速跟随视频播放器。</p>';$('voice-mode').after(voicePace.content);
    const speakerOptions=document.createElement('template');speakerOptions.innerHTML='<label for="voice-profile">人物音色</label><select id="voice-profile"><option value="">默认中文音色</option></select><button id="voice-profiles-refresh" type="button">读取本机人物音色</button><button id="voice-preview" type="button">试听中文音色</button><details id="voice-learning"><summary>采集原声，保存人物或系列音色</summary><p class="hint">选择清晰的单人原声，避免背景音乐。保存后只存于本机，供后续视频复用；无需重新训练模型。</p><label for="voice-name">人物或系列名称</label><input id="voice-name" maxlength="80" placeholder="例如：Bob 英语系列"><label for="voice-ref-language">原声语言</label><select id="voice-ref-language"><option value="en">英语</option><option value="zh">中文</option></select><button id="voice-capture" type="button">采集当前视频 7 秒原声</button><label for="voice-ref-file">或导入 3–10 秒参考音频</label><input id="voice-ref-file" type="file" accept="audio/*"><label for="voice-ref-text">原声实际说出的文字（请核对）</label><textarea id="voice-ref-text" rows="3" maxlength="500"></textarea><button id="voice-save-profile" type="button" disabled>保存人物音色到本机</button></details><label for="voice-bind-scope">音色复用范围</label><select id="voice-bind-scope"><option value="speaker">同一位讲者</option><option value="series">当前视频系列（B 站分 P / YouTube 播放列表）</option></select><button id="voice-bind" type="button">记住此人物或系列的音色</button><p id="voice-profile-status" class="hint" role="status" aria-live="polite"></p>';$('voice-start').before(speakerOptions.content);
    const speakerStyle=document.createElement('style');speakerStyle.textContent='#voice-learning{margin-top:12px;padding:10px;border:1px solid var(--border);border-radius:10px}#voice-learning summary{cursor:pointer;font-size:12px}#voice-name,#voice-ref-text{width:100%;font:inherit;color:var(--fg);background:var(--surface);padding:8px;border:1px solid var(--border);border-radius:8px}#voice-ref-text{resize:vertical}#voice-ref-file{width:100%;font-size:11px}#voice-learning button,#voice-bind{margin-top:8px}';root.append(speakerStyle);
    const positionSettings=document.createElement('template');positionSettings.innerHTML='<label for="position">字幕位置</label><select id="position"><option value="auto">自动避让</option><option value="raised">上移，避开画面字幕</option><option value="top">顶部</option></select><p class="hint">画面内嵌字幕无法移动；仍有重叠时可选择「上移」或「顶部」。</p>';$('display').after(positionSettings.content);
    const aiIntro=document.createElement('div');aiIntro.innerHTML='<p id="ai-service-hint" class="hint"></p><button id="use-ai" type="button">切换到 AI 翻译</button><button id="manage-ai" type="button">管理模型与术语 ↗</button>';$('ai-options').prepend(aiIntro);
    const entrance=document.createElement('template');entrance.innerHTML=`<style>
      #settings-panel{position:relative;z-index:3}
      #player-tools{position:fixed;z-index:2;width:32px;height:32px;color:#f5efe8;pointer-events:auto}
      #player-tools button{background:transparent;color:inherit;border:0;white-space:nowrap;font-size:12px;border-radius:7px;cursor:pointer}
      #player-tools button:focus-visible{outline:2px solid #ffad73;outline-offset:2px}
      #player-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:5px;opacity:.85}
      #player-icon img{display:block;width:22px;height:22px}
      #player-icon:hover,#player-icon[aria-expanded=true]{background:#ffffff25;opacity:1}
      #player-icon[data-enabled=true]{opacity:1;box-shadow:inset 0 -2px #ffad73}
      #player-menu{position:absolute;bottom:calc(100% + 10px);width:236px;padding:8px;background:rgba(22,27,29,.96);border:1px solid #ffffff1c;border-radius:16px;box-shadow:0 6px 24px #0005}
      #player-menu:after{content:'';position:absolute;top:100%;left:0;right:0;height:12px}
      #player-menu[data-placement=below]:after{top:auto;bottom:100%}
      #player-toggle,#player-voice,#player-settings,#player-more{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:40px;padding:10px 12px;text-align:left}
      #player-toggle:hover,#player-voice:hover,#player-settings:hover,#player-more:hover{background:#ffffff12}
      #player-voice .voice-label{display:flex;flex-direction:column;gap:3px;min-width:0}
      #player-voice-mode{font-size:10px;line-height:1.4;color:#c5beb6}
      #player-settings[aria-expanded=true]{background:#ffffff12}
      #quick-settings{padding:2px 10px 8px;border-top:1px solid #ffffff20;max-height:calc(100vh - 180px);overflow:auto}
      #quick-settings label{color:#d4cec7;margin:8px 0 4px}
      #quick-settings select{background:#292e30;color:#fff;border:1px solid #ffffff40;font-size:12px;padding:6px;min-width:0}
      #quick-settings select:disabled{opacity:.55}
      #quick-hint{font-size:11px;line-height:1.5;color:#c5beb6;margin:8px 0}
      #player-more{border-top:1px solid #ffffff20!important;border-radius:0!important;color:#ffbd8e!important}
      #ai-options{margin-top:12px;padding:10px;border:1px solid var(--border);border-radius:10px}
      #ai-service-hint{margin-top:0}
      #use-ai,#manage-ai{font-size:12px;margin:0 4px 4px 0;padding:6px 8px}
      .switch{display:block;width:32px;height:18px;border-radius:12px;background:#736b62;position:relative;flex:none}
      .switch:before{content:'';position:absolute;left:3px;top:3px;width:12px;height:12px;background:white;border-radius:50%;transition:transform .16s}
      #player-tools [role=switch][aria-checked=true] .switch{background:#ffad73}
      #player-tools [role=switch][aria-checked=true] .switch:before{transform:translateX(14px);background:#29170b}
      #player-state{display:none;position:absolute;bottom:calc(100% + 10px);right:0;width:236px;margin:0;padding:8px 12px;border-radius:8px;background:#201d1a;color:#f5efe8;font-size:11px;overflow-wrap:anywhere}
      #player-state[data-active=true][data-error=true],#player-state[data-active=true][data-busy=true],#player-state[data-active=true][data-gap=true]{display:block}
      #player-menu:not([hidden])~#player-state{display:none}
      #player-state[data-error=true]{color:#ffaaa0}
      #captions{position:fixed;z-index:1;transform:translateY(-100%);pointer-events:none;display:flex;flex-direction:column;align-items:center;text-align:center;color:white;font:32px/1.35 Arial,"Microsoft YaHei",sans-serif;text-shadow:0 1px 2px #0008;max-height:45vh;overflow:hidden;background:transparent;padding:0}
      .caption-line{flex:none;width:fit-content;max-width:90%;padding:2px 10px;background:rgba(18,22,23,.84);border-radius:3px;white-space:pre-wrap;overflow-wrap:anywhere}
      #import::file-selector-button{font:inherit;background:var(--surface);color:var(--fg);border:1px solid var(--border);padding:6px 10px;border-radius:7px;cursor:pointer;margin-right:8px}
      @media(prefers-reduced-motion:reduce){.switch:before{transition:none}}
    </style><div id="player-tools" aria-label="页渡字幕翻译"><button id="player-icon" aria-label="页渡字幕翻译" aria-controls="player-menu" aria-expanded="false"><img alt="" src="${chrome.runtime.getURL('/icons/reading.png')}"></button><div id="player-menu" hidden><button id="player-toggle" role="switch" aria-checked="false"><span>开启字幕翻译</span><span class="switch" aria-hidden="true"></span></button><button id="player-settings" aria-controls="quick-settings" aria-expanded="false" title="调整字幕显示、语言和翻译服务">字幕设置<span aria-hidden="true">⌄</span></button><div id="quick-settings" hidden><label for="quick-display">字幕显示</label><select id="quick-display"></select><label for="quick-target">目标语言</label><select id="quick-target"></select><label for="quick-service">翻译服务</label><select id="quick-service"></select><p id="quick-hint"></p><button id="player-more" aria-controls="settings-panel" aria-expanded="false">更多设置<span aria-hidden="true">›</span></button></div></div><p id="player-state" role="status" aria-live="polite"></p></div>`;root.append(entrance.content);
    const captions=document.createElement('div');captions.id='captions';captions.hidden=true;root.append(captions);
    const voiceQuick=document.createElement('button');voiceQuick.id='player-voice';voiceQuick.type='button';voiceQuick.setAttribute('role','switch');voiceQuick.setAttribute('aria-checked','false');voiceQuick.setAttribute('aria-labelledby','player-voice-label');voiceQuick.setAttribute('aria-describedby','player-voice-mode');voiceQuick.innerHTML='<span class="voice-label"><span id="player-voice-label">本地中文配音</span><small id="player-voice-mode" hidden></small></span><span class="switch" aria-hidden="true"></span>';$('player-toggle').after(voiceQuick);
    const voiceStatus=(message,error=false)=>{if(!ui)return;$('voice-status').textContent=message;$('voice-status').style.color=error?'#ffaaa0':'';$('player-voice').title=message;};
    const voiceState=(active,mode)=>{if(!ui)return;$('voice-start').textContent=active?(mode==='audio'?'关闭实时配音（与画面有延迟）':mode==='subtitles'?'关闭字幕同步配音':'关闭本地配音，恢复原声'):'开启本地中文配音';$('voice-start').setAttribute('aria-pressed',String(active));$('player-voice').setAttribute('aria-checked',String(active));$('player-voice-mode').hidden=!active;$('player-voice-mode').textContent=active?(mode==='audio'?'实时识别 · 与画面有延迟':mode==='subtitles'?'字幕同步':'连接模型…'):'';$('voice-mode').disabled=active;$('voice-profile').disabled=active;$('voice-speed').disabled=active&&mode==='subtitles';syncQuickSettings();};
    const voiceRoot=root;let voiceReference,profilesLoaded=false,profilesURL='',referenceBusy=false;
    const profileStatus=message=>{if(root===voiceRoot)$('voice-profile-status').textContent=message;};
    const savedVoice=()=>{const bindings=twpConfig.get('videoVoiceProfiles')||{};return bindings[voiceScopeKey('series')]??bindings[voiceScopeKey('speaker')]??'';};
    const refreshVoices=async preferred=>{
      const result=await twpAIClient.call({action:'localVoiceProfiles'});if(root!==voiceRoot)return;
      const id=preferred??(profilesLoaded&&profilesURL===location.href?$('voice-profile').value:savedVoice());
      $('voice-profile').replaceChildren(new Option('默认中文音色',''),...(result.profiles||[]).slice(0,50).map(row=>new Option(row.name,row.id)));
      if(id&&![...$('voice-profile').options].some(option=>option.value===id))throw new Error('已绑定的人物音色不在这台电脑上，请重新选择');
      $('voice-profile').value=id;profilesLoaded=true;profilesURL=location.href;
    };
    const bindVoice=()=>{
      if(chrome.extension?.inIncognitoContext){profileStatus('无痕窗口不保存人物或系列绑定');return;}
      const key=voiceScopeKey($('voice-bind-scope').value);if(!key){profileStatus('当前页未识别到讲者，请选择视频系列，或手动选择人物音色');return;}
      const bindings={...(twpConfig.get('videoVoiceProfiles')||{})};delete bindings[key];bindings[key]=$('voice-profile').value;
      twpConfig.set('videoVoiceProfiles',Object.fromEntries(Object.entries(bindings).slice(-100)));profileStatus('已记住此人物或系列的音色，后续视频开启配音时自动选择');
    };
    const loadReferenceText=async(reference,referenceURL)=>{
      $('voice-ref-text').value='';
      if($('voice-ref-language').value==='en'){
        profileStatus('原声已采集，正在本机识别文字…');
        const result=await twpAIClient.call({action:'localVoiceReferenceText',audio:reference.audio});if(root!==voiceRoot||referenceURL!==location.href)return;$('voice-ref-text').value=result.text;
      }
      profileStatus('参考原声 '+reference.duration.toFixed(1)+' 秒。请核对原声文字，再保存人物音色');
    };
    $('voice-profiles-refresh').onclick=async()=>{try{await refreshVoices();profileStatus('已读取本机人物音色');}catch(error){profileStatus(error.message);}};
    $('voice-bind').onclick=bindVoice;
    $('voice-capture').onclick=async()=>{
      if(voiceCapture){voiceCapture.abort();return;}if(referenceBusy)return;
      twpVideoDubbing.stop();clearVoicePreview();voiceReference=null;referenceBusy=true;const referenceURL=location.href,controller=new AbortController();voiceCapture=controller;$('voice-capture').textContent='取消原声采集';$('voice-save-profile').disabled=true;
      try{const reference=await twpVideoDubbing.captureReference({video,signal:controller.signal,onProgress:seconds=>profileStatus('采集原声 · '+seconds+' / 7 秒')});if(root!==voiceRoot||referenceURL!==location.href)return;voiceReference=reference;await loadReferenceText(reference,referenceURL);}
      catch(error){profileStatus(error.message);}
      finally{if(voiceCapture===controller)voiceCapture=null;referenceBusy=false;if(root===voiceRoot){$('voice-capture').textContent='采集当前视频 7 秒原声';$('voice-save-profile').disabled=!voiceReference;}}
    };
    $('voice-ref-file').onchange=async()=>{
      const file=$('voice-ref-file').files[0];if(!file||referenceBusy)return;voiceReference=null;referenceBusy=true;const referenceURL=location.href;$('voice-save-profile').disabled=true;
      try{twpVideoDubbing.stop();clearVoicePreview();const reference=await twpVideoDubbing.referenceFromFile(file);if(root!==voiceRoot||referenceURL!==location.href)return;voiceReference=reference;await loadReferenceText(reference,referenceURL);}
      catch(error){profileStatus(error.message);}
      finally{referenceBusy=false;if(root===voiceRoot)$('voice-save-profile').disabled=!voiceReference;}
    };
    $('voice-save-profile').onclick=async()=>{
      if(!voiceReference||referenceBusy)return;referenceBusy=true;const referenceURL=location.href;$('voice-save-profile').disabled=true;
      try{const result=await twpAIClient.call({action:'localVoiceProfileCreate',name:$('voice-name').value,language:$('voice-ref-language').value,text:$('voice-ref-text').value,audio:voiceReference.audio});if(root!==voiceRoot||referenceURL!==location.href)return;await refreshVoices(result.profile.id);bindVoice();}
      catch(error){profileStatus(error.message);}
      finally{referenceBusy=false;if(root===voiceRoot)$('voice-save-profile').disabled=!voiceReference;}
    };
    $('voice-preview').onclick=async()=>{
      if(referenceBusy)return;referenceBusy=true;const previewURL=location.href;twpVideoDubbing.stop();clearVoicePreview();$('voice-preview').disabled=true;
      try{if(!profilesLoaded||profilesURL!==previewURL)await refreshVoices();if(root!==voiceRoot||previewURL!==location.href)return;profileStatus('正在准备中文试听…');const result=await twpAIClient.call({action:'localVoiceDub',text:'你好，这是我的中文配音。欢迎继续学习。',language:'zh',voiceProfileId:$('voice-profile').value});if(root!==voiceRoot||previewURL!==location.href)return;const bytes=Uint8Array.from(atob(result.audio),char=>char.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})),audio=new Audio(url);voicePreview={audio,url};audio.onended=clearVoicePreview;await audio.play();profileStatus('正在试听所选人物的中文配音');}
      catch(error){clearVoicePreview();profileStatus(error.message);}
      finally{referenceBusy=false;if(root===voiceRoot)$('voice-preview').disabled=false;}
    };
    const voiceStart=async()=>{
      if(twpVideoDubbing.active){twpVideoDubbing.stop();return;}
      if(referenceBusy){voiceStatus('请先完成原声采集或音色保存');return;}
      clearVoicePreview();
      const source=sources[$('source').value],mode=$('voice-mode').value,url=location.href,currentVideo=video;
      const language=source?.language&&/^zh/i.test(source.language)?'zh':source?.language?.split('-')[0]||'auto';
      const loadCues=async()=>{
        if(mode==='audio')return [];
        if(!source){if(mode==='subtitles')throw new Error('请检测字幕或导入 SRT / VTT');return [];}
        if(source.kind==='native'){
          const previous=source.track.mode;if(previous==='disabled')source.track.mode='hidden';
          try{const deadline=Date.now()+5000;while(!source.track.cues?.length&&Date.now()<deadline&&twpVideoDubbing.active&&location.href===url)await new Promise(resolve=>setTimeout(resolve,100));return twpVideoSubtitles.normalize([...(source.track.cues||[])].map(cue=>({start:cue.startTime,end:cue.endTime,text:cue.text})));}
          finally{if(previous==='disabled'&&source.track.mode==='hidden')source.track.mode=previous;}
        }
        try{return source.cues?.length&&source.video===currentVideo&&source.pageURL===url?source.cues:source.kind==='import'?source.cues:(await twpAIClient.call({action:source.kind==='youtube'?'youtubeSubtitlesRead':'videoSubtitlesRead',token:source.token,pageURL:url})).cues;}
        catch(error){if(mode==='subtitles')throw error;voiceStatus('字幕不可读取，切换到英语音频识别…');return [];}
      };
      try{if(!profilesLoaded||profilesURL!==url)await refreshVoices();if(root!==voiceRoot||location.href!==url)return;await twpVideoDubbing.start({video:currentVideo,language:mode==='audio'?'en':language,speed:Number($('voice-speed').value),voiceProfileId:$('voice-profile').value,loadCues:async()=>{const result=await loadCues();if(mode==='subtitles'&&!result?.length)throw new Error('当前字幕轨道没有文字，请重新检测');return result||[];},status:voiceStatus,onState:voiceState});}
      catch(error){voiceStatus(error.message,true);}
    };
    $('voice-start').onclick=voiceStart;$('player-voice').onclick=voiceStart;
    $('voice-connect').onclick=async()=>{$('voice-connect').disabled=true;try{const result=await twpAIClient.call({action:'localVoiceConnect'});voiceStatus('已连接本地模型 · '+result.model);}catch(error){voiceStatus(error.message,true);}finally{if(ui)$('voice-connect').disabled=false;}};
    const style=document.createElement('style');style.id='yedu-video-cue-style';style.textContent='video[data-yedu-captions]::cue{background:rgba(0,0,0,.82);color:white;font:20px sans-serif}'+subtitleLayers.split(',').map(selector=>'html[data-yedu-video-running] '+selector.trim()).join(',')+'{visibility:hidden!important}';document.getElementById(style.id)?.remove();document.head.append(style);
    $('service').value=initial.service||pageTranslator.getService();
    $('display').value=initial.display==='bilingual'?'bilingual':'translated';
    $('position').value=['raised','top'].includes(initial.position)?initial.position:'auto';
    $('voice-speed').value=String([.75,1,1.25,1.5,1.75,2].includes(Number(initial.voiceSpeed))?Number(initial.voiceSpeed):1.25);
    const quickPosition=document.createElement('template');quickPosition.innerHTML='<label for="quick-position">字幕位置</label><select id="quick-position"></select>';$('quick-display').after(quickPosition.content);
    const quickVoicePace=document.createElement('template');quickVoicePace.innerHTML='<label for="quick-voice-speed">实时识别配音语速</label><select id="quick-voice-speed"></select>';$('quick-position').after(quickVoicePace.content);
    $('target').replaceChildren(...Object.entries(twpLang.getLanguageList()).map(([code,label])=>new Option(label,code)));$('target').value=initial.targetLanguage||'zh-CN';
    $('profile').replaceChildren(...twpConfig.get('aiProfiles').map(profile=>new Option(profile.name+' · '+profile.model,profile.id)));$('profile').value=initial.profileId||twpConfig.get('aiActiveProfile');
    scope=twpAIScopeControls.create({root,fields:{expertId:'expert',glossaryId:'glossary',styleId:'style'},notice:'scope-notice',reset:'scope-reset',scopeLabel:'此视频页面',onSaved:()=>stop('AI 设置已更新，请重新开始翻译。'),onBusy:busy=>{scopeBusy=busy;if(ui)controls();}});scopeReady=scope.load();
    $('close').onclick=hidePanel;$('player-toggle').onclick=()=>void toggleFromPlayer();
    $('player-settings').onclick=()=>{const expanded=$('quick-settings').hidden;$('quick-settings').hidden=!expanded;$('player-settings').setAttribute('aria-expanded',String(expanded));syncQuickSettings();positionEntrance();};
    $('player-more').onclick=()=>void open();
    for(const id of ['display','position','target','service','voice-speed'])$('quick-'+id).onchange=()=>{const original=$(id);if(original.disabled)return;original.value=$('quick-'+id).value;original.dispatchEvent(new Event('change'));syncQuickSettings();};
    $('voice-speed').onchange=()=>{twpVideoDubbing.setSpeed(Number($('voice-speed').value));syncQuickSettings();rememberVideo();};
    $('use-ai').onclick=()=>{$('service').value='openai';$('service').dispatchEvent(new Event('change'));};
    $('manage-ai').onclick=()=>void twpAIClient.call({action:'aiOpenSettings'}).catch(error=>status(error.message,true));
    $('player-icon').onclick=()=>setPlayerMenu($('player-menu').hidden);
    $('player-tools').onmouseenter=()=>setPlayerMenu(true);
    $('player-tools').addEventListener('focusout',()=>{queueMicrotask(()=>{if(ui&&!$('player-tools').contains(root.activeElement)&&!$('player-tools').matches(':hover'))setPlayerMenu(false);});});
    // Outside events never enter our ShadowRoot. Listen on the document and
    // inspect the composed path so interacting with menu controls stays inside.
    const outside=event=>{if(ui&&!event.composedPath().includes($('player-tools')))setPlayerMenu(false);};
    // Real page pointer movement dismisses the menu regardless of retained
    // button/select focus. Native select popups do not dispatch these events,
    // so opening a language dropdown does not itself dismiss its parent menu.
    const pointerAway=event=>{if(ui&&!$('player-menu').hidden&&event.pointerType!=='touch')outside(event);};
    const escapeMenu=event=>{if(!ui||event.key!=='Escape'||($('player-menu').hidden&&$('settings-panel').hidden))return;const inside=event.composedPath().includes(ui);hidePanel();setPlayerMenu(false);if(inside){$('player-icon').focus();event.stopPropagation();}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('pointermove',pointerAway,true);document.addEventListener('keydown',escapeMenu,true);
    removeMenuListeners=()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('pointermove',pointerAway,true);document.removeEventListener('keydown',escapeMenu,true);};
    $('start').onclick=start;$('detect').onclick=()=>void detect();$('video').onchange=()=>{chosenSourceKey=undefined;stop();void detectSources();};$('source').onchange=()=>{const resume=enabled||running;chosenSourceKey=sources[$('source').value]?.key;stop('已切换字幕轨道。');translated=new Map();cues=[];$('source-info').textContent='';controls();if(resume)void start();};
    for(const id of ['service','profile','target'])$(id).onchange=()=>{
      const resume=enabled||running;
      stop(resume?'翻译设置已切换，正在从当前位置重新翻译…':'翻译设置已更新。');
      translated=new Map();controls();
      if(resume)void start();
    };
    $('display').onchange=()=>{syncNativeCaptions();for(const cue of cues){const target=outputCues.get(cue.id);if(target)target.text=caption(cue);}render();syncQuickSettings();rememberVideo();};
    $('position').onchange=()=>{restoreSubtitlePositions();syncNativeCaptions();render();syncQuickSettings();rememberVideo();};
    $('retry').onclick=()=>{failed=false;controls();void pump();};$('all').onclick=()=>{all=true;controls();void pump();};
    $('import').onchange=async()=>{
      const file=$('import').files[0];if(!file)return;stop();const token=++discovery;
      try {if(!/\.(srt|vtt)$/i.test(file.name)||file.size>200000)throw new Error('请选择不超过 200 KB 的 SRT / VTT 文件');const imported=twpVideoSubtitles.parseFile(await file.text());if(!ui||token!==discovery)return;sources.push({kind:'import',label:file.name,language:'auto',video,pageURL,key:pageURL+':import:'+file.name,cues:imported});$('source').append(new Option(file.name+' · 已导入',String(sources.length-1)));$('source').value=String(sources.length-1);chosenSourceKey=sources[sources.length-1].key;translated=new Map();status(`已导入 ${imported.length} 条字幕，请开始翻译。`);controls();}catch(error){if(ui&&token===discovery)status(error.message,true);}
    };
    $('export').onclick=()=>{
      const text=twpVideoSubtitles.exportSRT(cues,translated);if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='video'+(translated.size<cues.length?'.partial':'')+'.bilingual.srt';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    };
    pageURL=location.href;controls();routeClock=setInterval(()=>{if(!ui)return;positionEntrance();if(location.href!==pageURL){autoAttempts=0;captionWakeups=0;autoNext=Date.now()+1500;detecting=false;stop('已切换视频，请重新检测字幕。');discovery++;pageURL=location.href;sources=[];translated=new Map();$('source').replaceChildren();$('source-info').textContent='';$('video-info').textContent='';controls();scopeReady=scope.load();}},500);
  }
  async function open(initial={}) {
    if(!twpVideoSubtitles.isSupportedPage(location.href))return;
    if(!ui)mount(initial);
    else if(!enabled && !running){
      refreshProfiles();
      if(initial.service)$('service').value=initial.service;
      if(initial.profileId)$('profile').value=initial.profileId;
      if(initial.targetLanguage)$('target').value=initial.targetLanguage;
      controls();
    }
    showPanel();if(!sources.length && !running)await detect();
  }
  function findPlayer() {return [...document.querySelectorAll('video')].find(element=>{const rect=element.getBoundingClientRect();return element.isConnected&&rect.width>=200&&rect.height>=100&&rect.bottom>0&&rect.top<innerHeight;});}
  function refreshProfiles() {
    const profiles=twpConfig.get('aiProfiles'),previous=$('profile').value;
    $('profile').replaceChildren(...profiles.map(profile=>new Option(profile.name+' · '+profile.model,profile.id)));
    $('profile').value=profiles.some(profile=>profile.id===previous)?previous:twpConfig.get('aiActiveProfile');
  }
  function discoverEntrance() {
    if(suspended)return;
    try {if(!chrome.runtime.id){suspended=true;clearInterval(entranceClock);close();return;}}catch{suspended=true;clearInterval(entranceClock);close();return;}
    const compatible=twpVideoSubtitles.isSupportedPage(location.href);
    if(compatible!==entranceAvailable){entranceAvailable=compatible;document.dispatchEvent(new Event('yedu-video-availability-changed'));}
    if(!compatible){
      if(ui){close();video=null;videos=[];sources=[];cues=[];translated=new Map();chosenSourceKey=undefined;autoAttempts=0;captionWakeups=0;autoNext=0;}
      return;
    }
    if(!ui){const found=findPlayer();if(!found)return;mount({});video=found;videos=[found];hidePanel();positionEntrance();}
    else if(!enabled && !running && !video?.isConnected){video=findPlayer();sources=[];positionEntrance();}
    if(ui&&!twpVideoDubbing.active&&!enabled&&!running&&!detecting&&!autoRestoring&&video?.readyState>=1&&autoAttempts<3&&Date.now()>=autoNext&&savedVideoSettings().enabled&&!chrome.extension?.inIncognitoContext){
      autoAttempts++;autoNext=Date.now()+4000;autoRestoring=true;const url=location.href;
      void (async()=>{await scopeReady;if(!ui||url!==location.href)return;await detect();if(!ui||url!==location.href)return;if(savedVideoSettings().enabled&&sources.length)await start();else if(!sources.length)status('自动检测尚未获取可读字幕，当前未开启翻译。'+$('status').textContent,true);})().catch(error=>{if(ui)status(error.message,true);}).finally(()=>{autoRestoring=false;if(ui)controls();});
    }
  }
  // A signed YouTube caption replay can be empty even though the track exists.
  // Retry after the player's own response arrives, without toggling website CC.
  // This is only a wake-up hint: the background still validates video/track data.
  document.addEventListener('yedu-youtube-captions-ready',()=>{
    if(suspended||enabled||!twpYouTubeSubtitles.videoId(location.href)||!savedVideoSettings().enabled||captionWakeups>=3)return;
    captionWakeups++;autoAttempts=Math.min(autoAttempts,2);autoNext=Math.max(autoNext,Date.now()+1500);
  });
  void pageTranslator.ready.then(()=>{if(suspended)return;discoverEntrance();entranceClock=setInterval(discoverEntrance,1500);});
  window.addEventListener('pagehide',()=>{suspended=true;clearInterval(entranceClock);close();});
  window.addEventListener('pageshow',event=>{if(event.persisted){autoAttempts=0;captionWakeups=0;autoNext=0;suspended=false;discoverEntrance();entranceClock=setInterval(discoverEntrance,1500);}});
  document.addEventListener('yt-navigate-start',()=>{if(!ui||!twpYouTubeSubtitles.videoId(location.href))return;autoNext=Date.now()+4000;detecting=false;discovery++;stop('正在切换 YouTube 视频，请重新检测字幕。');sources=[];cues=[];translated=new Map();$('source').replaceChildren();$('source-info').textContent='';$('video-info').textContent='';controls();});
  document.addEventListener('fullscreenchange',()=>{if(ui){const element=document.fullscreenElement;((element&&element.tagName!=='VIDEO')?element:document.documentElement).append(ui);positionEntrance();render();}});
  twpConfig.onChanged(name=>{if(!ui)return;if(enabled&&['aiActiveProfile','aiTranslationSettings','aiProfiles','aiCustomExperts','aiCustomGlossaries','aiCacheSettings'].includes(name))stop('模型或缓存设置已变化，请重新开始翻译。');if(['aiProfiles','aiActiveProfile'].includes(name)){refreshProfiles();controls();}});
  return {open,close};
})();
