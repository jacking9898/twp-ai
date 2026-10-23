// SPDX-License-Identifier: MPL-2.0
"use strict";
// A single VP8 track with absolute millisecond timestamps. Each encoded frame
// is a complete Cluster, so MSE can append immediately and trim at known keys.
function twpWebMVideo(width,height) {
  const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
  const uint=value=>{const bytes=[];do{bytes.unshift(value%256);value=Math.floor(value/256);}while(value);return Uint8Array.from(bytes);};
  const text=value=>Uint8Array.from(value,c=>c.charCodeAt(0));
  const element=(id,data)=>{let length=1;while(data.length>=2**(7*length)-1)length++;const size=uint(data.length),encoded=new Uint8Array(length);encoded.set(size,length-size.length);encoded[0]|=1<<(8-length);return join([uint(id),encoded,data]);};
  const number=(id,value)=>element(id,uint(value));
  const header=join([
    element(0x1a45dfa3,join([number(0x4286,1),number(0x42f7,1),number(0x42f2,4),number(0x42f3,8),element(0x4282,text('webm')),number(0x4287,4),number(0x4285,2)])),
    Uint8Array.of(0x18,0x53,0x80,0x67,0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff),
    element(0x1549a966,join([number(0x2ad7b1,1000000),element(0x4d80,text('Yedu')),element(0x5741,text('Yedu'))])),
    element(0x1654ae6b,element(0xae,join([number(0xd7,1),number(0x73c5,1),number(0x83,1),element(0x86,text('V_VP8')),number(0x23e383,33333333),element(0xe0,join([number(0xb0,width),number(0xba,height)]))])))
  ]);
  let pending,previous=0;
  function frame(chunk,duration){
    const data=new Uint8Array(chunk.byteLength+4);data.set([0x81,0,0,0]);chunk.copyTo(data.subarray(4));
    const stamp=Math.round(chunk.timestamp/1000),ref=new Uint8Array(4);new DataView(ref.buffer).setInt32(0,previous-stamp);previous=stamp;
    const block=element(0xa0,join([element(0xa1,data),number(0x9b,Math.max(1,Math.round(duration/1000))),...(chunk.type==='key'?[]:[element(0xfb,ref)])]));
    return element(0x1f43b675,join([number(0xe7,stamp),block]));
  }
  return {header,write(chunk){const out=pending?frame(pending,chunk.timestamp-pending.timestamp):null;pending=chunk;return out;},flush(){const out=pending?frame(pending,pending.duration||33333):null;pending=null;return out;}};
}
const twpVideoDubbing = (() => {
  let session;
  const call = request => twpAIClient.call(request);
  const ad = video => video.closest('.html5-video-player')?.classList.contains('ad-showing');
  const voiceSpeed=value=>Number.isFinite(Number(value))?Math.max(.75,Math.min(2,Number(value))):1.25;
  function wav(samples,rate) {
    const length=Math.floor(samples.length*16000/rate),bytes=new Uint8Array(44+length*2),view=new DataView(bytes.buffer);
    const write=(offset,text)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);};
    write(0,'RIFF');view.setUint32(4,bytes.length-8,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++){
      const start=Math.floor(i*rate/16000),end=Math.min(samples.length,Math.max(start+1,Math.floor((i+1)*rate/16000)));
      let sample=0;for(let j=start;j<end;j++)sample+=samples[j];sample=Math.max(-1,Math.min(1,sample/(end-start)));
      view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);
    }
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
  }
  function dispose(row){if(row?.url)URL.revokeObjectURL(row.url);}
  // A separate, video-only local recording lets the source keep feeding ASR
  // while the displayed picture follows the generated speech. No recording
  // leaves memory. Both encoded input and decoded playback history are bounded.
  function pictureBuffer(s) {
    const mime='video/webm;codecs=vp8';
    if(typeof VideoEncoder==='undefined'||typeof MediaStreamTrackProcessor==='undefined'||typeof MediaSource==='undefined'||!MediaSource.isTypeSupported(mime))throw new Error('当前浏览器不支持画面缓冲，请选择「画面直接播放」');
    const tracks=s.stream.getVideoTracks();
    if(!tracks.length)throw new Error('视频画面无法读取，请选择「画面直接播放」');
    const parent=s.video.parentElement,position=parent.style.position;
    if(getComputedStyle(parent).position==='static')parent.style.position='relative';
    const host=document.createElement('div');host.setAttribute('data-yedu-sync-host','');host.dataset.syncController='9';host.style.cssText='position:absolute;inset:0;z-index:1;pointer-events:none;background:black';
    const player=s.video.closest('.bpx-player-container,.bilibili-player-video-wrap,.html5-video-player')||parent;
    const tag=s.streamId,previousTag=player.getAttribute('data-yedu-sync-active'),captions=document.createElement('style');
    player.setAttribute('data-yedu-sync-active',tag);
    captions.textContent=['.bili-subtitle-x-subtitle-panel','.bili-subtitle-x-subtitle-rawmeat-wrap','.bpx-player-subtitle-panel','.bilibili-player-video-subtitle','.caption-window'].map(selector=>'[data-yedu-sync-active="'+tag+'"] '+selector).join(',')+'{visibility:hidden!important}';document.head.append(captions);
    const restoreCaptions=()=>{captions.remove();if(player.getAttribute('data-yedu-sync-active')===tag){if(previousTag===null)player.removeAttribute('data-yedu-sync-active');else player.setAttribute('data-yedu-sync-active',previousTag);}};
    const shadow=host.attachShadow({mode:'open'}),screen=document.createElement('video'),notice=document.createElement('span');
    screen.muted=true;screen.playsInline=true;screen.tabIndex=-1;screen.setAttribute('aria-hidden','true');screen.style.cssText='display:block;width:100%;height:100%;object-fit:contain;background:black';
    notice.textContent='正在缓冲中文配音…';notice.style.cssText='position:absolute;inset:0;display:grid;place-items:center;color:white;font:16px system-ui;text-shadow:0 1px 3px black';shadow.append(screen,notice);parent.append(host);
    const media=new MediaSource(),url=URL.createObjectURL(media);screen.src=url;
    const ownTracks=tracks.map(track=>track.clone());
    let encoder,reader,mux,buffer,closed=false,origin=null,active,queue=[],keyframes=[],bytes=0,trimmed=0,corrected=0;
    const rate=s.video.playbackRate;
    const fail=error=>{if(!closed&&session===s){s.video.dataset.yeduPictureError=JSON.stringify({phase:'buffer',error:error?.error?.message||error?.message||error?.type||'buffer',mediaError:screen.error?.message,source:s.video.currentTime,keyframes,queued:queue.length,bytes});stop('画面缓冲失败，请切换「画面直接播放」后重试。',true);}};
    const enqueue=chunk=>{if(closed||!chunk)return;bytes+=chunk.byteLength;if(bytes>8000000||queue.length>=180){fail(new Error('Picture queue limit'));return;}queue.push(chunk);pump();};
    const pump=()=>{
      if(closed||!buffer||buffer.updating||media.readyState!=='open')return;
      try{
        const end=buffer.buffered.length?buffer.buffered.end(buffer.buffered.length-1):0;
        const playing=active?Math.min(at(active.row.sourceStart)-1,screen.currentTime-1):end-24;
        const cutoff=Math.max(0,Math.min(end-24,playing));
        const boundary=[...keyframes].reverse().find(time=>time<=cutoff&&time>trimmed+.5);
        if(boundary!==undefined){trimmed=boundary;keyframes=keyframes.filter(time=>time>=trimmed-.1);buffer.remove(0,Math.max(0,boundary-.005));return;}
        // Retain the current speech even if it is unusually long, with a
        // hard bound if inference or playback stops making progress.
        if(end-trimmed>60){fail(new Error('Picture history limit'));return;}
        if(queue.length){const chunk=queue.shift();bytes-=chunk.byteLength;buffer.appendBuffer(chunk);}
      }catch(error){fail(error);}
    };
    media.addEventListener('sourceopen',()=>{if(closed)return;try{buffer=media.addSourceBuffer(mime);buffer.addEventListener('updateend',pump);buffer.addEventListener('error',fail);pump();}catch(error){fail(error);}},{once:true});
    try{
      const width=s.video.videoWidth||1280,height=s.video.videoHeight||720,scale=Math.min(1,1280/width,720/height);
      const config={codec:'vp8',width:Math.max(2,Math.round(width*scale/2)*2),height:Math.max(2,Math.round(height*scale/2)*2),bitrate:2500000,framerate:30,latencyMode:'realtime'};
      mux=twpWebMVideo(config.width,config.height);enqueue(mux.header);
      encoder=new VideoEncoder({output:chunk=>{if(closed)return;if(chunk.type==='key')keyframes.push(chunk.timestamp/1000000);enqueue(mux.write(chunk));},error:fail});
      encoder.configure(config);
      reader=new MediaStreamTrackProcessor({track:ownTracks[0],maxBufferSize:1}).readable.getReader();
      let last=-Infinity,key=-Infinity;
      void (async()=>{
        while(!closed){
          const {value:frame,done}=await reader.read();if(done)break;
          try{
            if(closed||s.video.paused||s.video.seeking||s.waiting||ad(s.video))continue;
            if(origin===null)origin=s.video.currentTime;
            // Use the source media clock, not a capture wall clock: pause and
            // network stalls must never leave holes in the recorded timeline.
            const timestamp=Math.max(0,Math.round((s.video.currentTime-origin)/rate*1000000));
            if(timestamp-last<1000000/30||encoder.encodeQueueSize>=4)continue;
            const input=new VideoFrame(frame,{timestamp});
            try{const force=timestamp-key>=1000000;encoder.encode(input,{keyFrame:force});if(force)key=timestamp;last=timestamp;}finally{input.close();}
          }finally{frame.close();}
        }
      })().catch(fail);
    }catch(error){closed=true;void reader?.cancel().catch(()=>{});if(encoder&&encoder.state!=='closed')encoder.close();for(const track of ownTracks)track.stop();host.remove();restoreCaptions();parent.style.position=position;URL.revokeObjectURL(url);throw error;}
    function recording(){if(!closed&&(s.video.paused||s.waiting))void encoder.flush().then(()=>enqueue(mux.flush())).catch(fail);}
    recording();screen.addEventListener('error',fail);
    const at=source=>Math.max(0,(source-(origin??source))/rate);
    function sync(force=false){
      if(closed||!active||(!force&&s.video.paused&&!s.sourceEnded))return;
      const {audio,row}=active,start=at(row.sourceStart),duration=Math.max(.1,at(row.sourceEnd)-start);
      const expected=start+duration*Math.min(1,audio.currentTime/row.duration);
      const drift=expected-screen.currentTime;
      if(force||(!screen.seeking&&Math.abs(drift)>.45&&Date.now()-corrected>750)){screen.currentTime=expected;corrected=Date.now();}
      // Small drift is cheaper to correct with a gentle rate adjustment than
      // by repeatedly making a hardware decoder seek through a long GOP.
      screen.playbackRate=Math.max(.1,Math.min(16,duration/row.duration*audio.playbackRate+Math.max(-.3,Math.min(.3,drift*.8))));
      host.dataset.pictureTime=String((origin??0)+screen.currentTime*rate);host.dataset.expectedTime=String((origin??0)+expected*rate);
      host.dataset.bufferSeconds=String(Math.max(0,s.video.currentTime-((origin??0)+screen.currentTime*rate)));
    }
    function playPicture(){
      const current=active;
      void screen.play().catch(error=>{
        if(closed||active!==current||error.name==='AbortError'&&screen.paused)return;
        fail(error);
      });
    }
    return {
      recording,
      async ready(row){
        const deadline=Date.now()+6000;
        while(!closed&&Date.now()<deadline){const start=at(row.sourceStart),end=at(row.sourceEnd);for(let i=0;i<screen.buffered.length;i++)if(screen.buffered.start(i)<=start+.1&&screen.buffered.end(i)>=end-.1)return;await new Promise(resolve=>setTimeout(resolve,50));}
        if(!closed)s.video.dataset.yeduPictureError=JSON.stringify({source:s.video.currentTime,origin,rate,requested:[at(row.sourceStart),at(row.sourceEnd)],ranges:Array.from({length:screen.buffered.length},(_,i)=>[screen.buffered.start(i),screen.buffered.end(i)]),keyframes,encoder:encoder.state,queued:queue.length,bytes});
        throw new Error('画面未能及时缓冲，请选择「画面直接播放」或降低视频倍速');
      },
      align(row,progress=0){
        if(closed)return Promise.resolve();
        const target=at(row.sourceStart+(row.sourceEnd-row.sourceStart)*Math.min(1,progress));
        screen.pause();
        return new Promise((resolve,reject)=>{
          let timer;
          const finish=()=>{clearTimeout(timer);screen.removeEventListener('seeked',finish);resolve();};
          screen.addEventListener('seeked',finish);
          timer=setTimeout(()=>{screen.removeEventListener('seeked',finish);if(closed)resolve();else reject(new Error('画面定位超时，请降低视频倍速后重试。'));},3000);
          screen.currentTime=target;if(!screen.seeking)finish();
        });
      },
      follow(audio,row){active={audio,row};notice.style.display='none';sync();playPicture();},sync,
      pause(){screen.pause();},resume(){if(active)playPicture();},release(){active=null;screen.pause();},
      close(){if(closed)return;closed=true;active=null;queue=[];keyframes=[];bytes=0;void reader.cancel().catch(()=>{});if(encoder.state!=='closed')encoder.close();for(const track of ownTracks)track.stop();screen.pause();screen.removeAttribute('src');screen.load();host.remove();restoreCaptions();URL.revokeObjectURL(url);if(parent.style.position==='relative'&&position!=='relative')parent.style.position=position;}
    };
  }
  function releaseCapture(s){
    s.picture?.close();s.picture=null;
    if(s.processor){s.processor.onaudioprocess=null;s.processor.disconnect();s.input?.disconnect();s.gain?.disconnect();s.processor=null;s.input=null;s.gain=null;}
    for(const track of s.stream?.getTracks()||[])track.stop();s.stream=null;
  }
  function suspendCapture(s,message){
    s.reconnecting=true;s.sourceEnded=false;s.generation++;s.streamId=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);s.voicePrimed=false;s.chunks=[];s.samples=0;s.last=null;s.missing=null;
    halt(s);clearLive(s);releaseCapture(s);restore(s);void call({action:'localVoiceCancel'}).catch(()=>{});s.status(message);
  }
  function captureLive(s){
    const {video,context}=s;
    const capture=video.captureStream||video.mozCaptureStream;if(!capture)throw new Error('浏览器不支持视频音频读取，请使用字幕配音');
    s.stream=capture.call(video);const audio=s.stream.getAudioTracks();
    if(!audio.length)throw new Error('视频没有可读取的音轨，请播放后重试，或使用字幕配音');
    if(s.watchMode==='sync'){s.picture=pictureBuffer(s);silence(s);}
    // Capture belongs to the media element, so synthesized output is not
    // captured again. Element mute does not mute the captured audio track.
    s.input=context.createMediaStreamSource(new MediaStream(audio));s.processor=context.createScriptProcessor(4096,1,1);s.gain=context.createGain();s.gain.gain.value=0;
    s.input.connect(s.processor);s.processor.connect(s.gain);s.gain.connect(context.destination);
    s.processor.onaudioprocess=event=>{
      if(session!==s||video.paused||video.seeking||s.waiting||ad(video)){s.chunks=[];s.samples=0;s.quietSamples=0;s.speechSamples=0;return;}
      const chunk=event.inputBuffer.getChannelData(0).slice();let energy=0;for(const value of chunk)energy+=value*value;
      const voiced=Math.sqrt(energy/chunk.length)>.006;
      if(!voiced&&!s.samples)return;
      if(!s.samples)s.segmentStart=Math.max(0,video.currentTime-chunk.length/context.sampleRate*video.playbackRate);
      s.chunks.push(chunk);s.samples+=chunk.length;
      if(voiced){s.quietSamples=0;s.speechSamples+=chunk.length;}else s.quietSamples+=chunk.length;
      // Prefer a word gap after three seconds; bound continuous speech to
      // 4.5 seconds so capture alone cannot add six seconds of latency.
      const prime=s.autoVoice&&!s.voicePrimed;
      if((prime&&s.samples>=context.sampleRate*3.5)||
          (prime&&s.samples>=context.sampleRate*3&&s.quietSamples>=context.sampleRate*.08)||
          s.samples>=context.sampleRate*4.5||
          (s.samples>=context.sampleRate*3&&s.quietSamples>=context.sampleRate*.12)||
          (s.samples>=context.sampleRate*1.2&&s.quietSamples>=context.sampleRate*.45)){
        flushCaptured(s);
      }
    };
  }
  function halt(s) {if(s.node){s.node.stop();s.node=null;}s.playing=null;s.onTranscript(null);}
  function clearLive(s){s.pending=[];s.speechSamples=0;s.quietSamples=0;for(const row of s.queue)dispose(row);s.queue=[];for(const row of s.live?.ready.values()||[])dispose(row);s.live={running:0,issued:0,next:0,ready:new Map()};if(!s.cues.length)s.busy=false;}
  function restore(s){if(s.mutedByUs&&s.video.muted)s.video.muted=s.originalMuted;s.mutedByUs=false;}
  function silence(s){if(!s.video.muted){s.video.muted=true;s.mutedByUs=true;}}
  function stop(message='已关闭本地配音，恢复原声。',error=false) {
    const s=session;if(!s)return;session=null;s.generation++;
    clearInterval(s.timer);halt(s);releaseCapture(s);restore(s);
    clearLive(s);for(const row of s.cache.values())dispose(row);s.cache.clear();
    for(const remove of s.listeners)remove();
    void s.context.close().catch(()=>{});void call({action:'localVoiceCancel'}).catch(()=>{});
    s.status(message,error);s.onState(false);
  }
  function play(s,row,cue=null) {
    if(session!==s||(s.video.paused&&!s.sourceEnded)||s.video.seeking||ad(s.video))return;
    // AudioBufferSource changes pitch when sped up. Media elements provide
    // browser time stretching, so fitting a subtitle does not change timbre.
    const audio=new Audio(row.url);audio.preservesPitch=true;audio.mozPreservesPitch=true;audio.webkitPreservesPitch=true;
    // The subtitle's complete [start, end) interval owns this audio. A global
    // speaking speed must not make a short recording end before its cue.
    const lag=Number.isFinite(row.sourceEnd)?Math.max(0,s.video.currentTime-row.sourceEnd):0;
    const sourceDuration=Math.max(.5,(row.sourceEnd||0)-(row.sourceStart||0));
    const catchup=Math.min(1.35,Math.max(1,lag>4?1.15:1,row.duration/sourceDuration));
    let fit=cue?row.duration/(cue.end-cue.start):(s.speed===1?catchup:s.speed);
    let correctedAt=0,announced=false;
    audio.playbackRate=Math.max(.0625,Math.min(16,fit*s.video.playbackRate));
    const source=s.context.createMediaElementSource(audio);source.connect(s.output);
    const node={pause(){audio.pause();s.picture?.pause();},resume(){return playAudio();},sync(force=false){
      if(!cue){s.picture?.sync(force);return;}
      const expected=Math.max(0,Math.min(row.duration-.001,(s.video.currentTime-cue.start)*fit));
      // Repeated seeks chop words and can stall the media decoder. Correct
      // discontinuities immediately, but tolerate ordinary clock jitter.
      if(force||(!s.video.paused&&!s.waiting&&Math.abs(audio.currentTime-expected)/fit>.5&&Date.now()-correctedAt>2000)){
        audio.currentTime=expected;correctedAt=Date.now();
      }
      audio.playbackRate=Math.max(.0625,Math.min(16,fit*s.video.playbackRate));
    },setSpeed(){
      // Manual pace applies only to audio recognition without a timeline.
      if(cue)return;
      fit=s.speed;
      audio.playbackRate=Math.max(.0625,Math.min(16,fit*s.video.playbackRate));
    },stop(){audio.onended=null;audio.onerror=null;audio.pause();s.picture?.release();source.disconnect();if(!cue)dispose(row);}};
    s.node=node;s.playing=cue?.id||'live';
    audio.onended=()=>{if(s.node===node){node.stop();s.node=null;s.playing=null;s.onTranscript(null);if(!cue){playQueued(s);if(!s.node&&!s.picture)restore(s);}}};
    audio.onerror=()=>{if(session===s&&s.node===node)stop('本地配音音频播放失败，请重试。',true);};
    // Always derive the voice position from the video timeline; sequential
    // playback accumulates lag whenever a translated phrase is longer.
    node.sync(true);
    async function playAudio(){
      if(announced&&!audio.paused)return;
      if(s.picture)await s.picture.align(row,audio.currentTime/row.duration);
      if(session!==s||s.node!==node||s.video.paused&&!s.sourceEnded)return;
      return audio.play().then(()=>{
        if(session!==s||s.node!==node||audio.paused)return;
        silence(s);
        if(announced)s.picture?.resume();
        if(!cue&&!announced){announced=true;s.picture?.follow(audio,row);const delay=Math.max(0,s.video.currentTime-row.sourceStart);s.onTranscript({text:row.text,translated:row.translated,start:row.sourceStart,end:row.sourceEnd,delay,synchronized:!!s.picture,timings:row.timings,voiceSource:row.voiceSource});s.status('正在配音 · '+row.translated+' · '+(s.picture?'画面同步，整体缓冲约 ':'内容延迟约 ')+delay.toFixed(1)+' 秒');}
      }).catch(error=>{if(error.name==='AbortError'&&audio.paused)return;throw error;});
    }
    void playAudio().catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});
  }
  async function prepare(s,row){
    const bytes=Uint8Array.from(atob(row.audio),char=>char.charCodeAt(0));
    const buffer=await s.context.decodeAudioData(bytes.buffer.slice(0));
    return {text:row.text,translated:row.translated,timings:row.timings,voiceSource:row.voiceSource,duration:buffer.duration,url:URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))};
  }
  function expired(s,row){return Number.isFinite(row.sourceEnd)&&s.video.currentTime-row.sourceEnd>12;}
  function playQueued(s){
    if(session!==s||s.node||(s.video.paused&&!s.sourceEnded)||s.video.seeking||(s.waiting&&!s.picture)||ad(s.video))return;
    while(s.queue.length){const row=s.queue.shift();if(expired(s,row)){dispose(row);continue;}play(s,row);break;}
  }
  async function tick(s) {
    if(session!==s)return;
    if(location.href!==s.url||!s.video.isConnected){stop('视频已切换，已恢复原声。');return;}
    if(ad(s.video)){if(!s.advertising){s.advertising=true;if(!s.cues.length)suspendCapture(s,'广告播放中，结束后自动继续语音翻译。');else{halt(s);restore(s);}}return;}
    if(!s.cues.length&&s.reconnecting){
      if(s.video.readyState<2||s.video.seeking)return;
      try{captureLive(s);s.reconnecting=false;s.waiting=false;s.status('已重新连接视频原声，正在准备中文配音…');}catch(error){stop(error.message,true);return;}
    }
    s.advertising=false;
    if((s.video.paused&&!s.sourceEnded)||s.video.seeking){if(s.video.seeking){halt(s);return;}s.node?.pause();}
    if(!s.cues.length){s.picture?.sync();playQueued(s);if(s.sourceEnded&&!s.node&&!s.busy&&!s.queue.length&&!s.pending.length)stop('视频翻译播放结束。');return;}
    const time=s.video.currentTime;
    const active=s.cues.find(cue=>cue.start<=time&&cue.end>time);
    if(s.node&&s.playing!==active?.id)halt(s);
    if(active&&!s.cache.has(active.id)){
      // Slow inference must never freeze the video or queue an expired line.
      restore(s);
      if(s.missing!==active.id){s.missing=active.id;s.status('当前段配音仍在准备，暂用原声；视频继续播放。');}
    }else{
      s.missing=null;
      if(!s.video.paused&&!s.waiting&&active&&s.last!==active.id){s.last=active.id;const row=s.cache.get(active.id);play(s,row,active);s.status('字幕同步配音 · '+row.translated);}
      if(s.node&&s.playing===active?.id)s.node.sync();
    }
    if(s.busy)return;
    // Keep recent cues for a short backwards seek, and bound the lookahead by
    // count as well as time without evicting the cue currently being spoken.
    for(const cue of s.cues)if(cue.end<time-8&&s.cache.has(cue.id)){dispose(s.cache.get(cue.id));s.cache.delete(cue.id);}
    if(s.cache.size>=64)return;
    const next=s.cues.find(cue=>cue.end>time&&cue.start<time+60&&!s.cache.has(cue.id));
    if(!next)return;
    s.busy=true;const generation=s.generation;
    try{
      const row=await call({action:'localVoiceDub',text:next.text,language:s.language,translationMode:s.translationMode,aiProfileId:s.aiProfileId,voiceProfileId:s.voiceProfileId});
      if(session!==s||generation!==s.generation)return;
      const prepared=await prepare(s,row);
      if(session!==s||generation!==s.generation){dispose(prepared);return;}
      s.cache.set(next.id,prepared);
      s.status('配音已准备 · '+row.translated);
    }catch(error){if(session===s&&generation===s.generation)stop(error.message,true);}
    finally{if(session===s)s.busy=false;}
  }
  function drainReady(s,live){
    if(session!==s||s.live!==live)return;
    while(live.ready.has(live.next)){
      const row=live.ready.get(live.next);live.ready.delete(live.next++);
      if(!row)continue;
      if(expired(s,row)){dispose(row);continue;}
      if(s.queue.length>=2)dispose(s.queue.shift());s.queue.push(row);
    }
    playQueued(s);
  }
  async function recognize(s,segment) {
    const live=s.live;
    if(expired(s,segment)){if(segment.sequence!==undefined){live.ready.set(segment.sequence,null);drainReady(s,live);}return;}
    if(segment.sequence===undefined)segment.sequence=live.issued++;
    if(live.running>=(s.translationMode==='custom'?2:1)){
      // Keep a small ordered backlog instead of discarding every segment that
      // arrives during inference. Bound it when the GPU cannot keep up.
      if(s.pending.length>=2){live.ready.set(s.pending.shift().sequence,null);drainReady(s,live);s.status('本地模型处理跟不上播放，已跳过过期音频，可降低视频倍速改善连续性。');}
      s.pending.push(segment);return;
    }
    live.running++;s.busy=true;const generation=s.generation;
    try{
      const row=await call({action:'localVoiceRecognize',audio:wav(segment.samples,s.context.sampleRate),voiceProfileId:s.voiceProfileId,streamId:s.streamId,autoVoice:s.autoVoice,translationMode:s.translationMode,aiProfileId:s.aiProfileId});
      if(session!==s||generation!==s.generation||(s.video.paused&&!s.picture)||ad(s.video))return;
      if(expired(s,segment)){s.status('本段处理超出实时窗口，已跳过旧配音，继续识别当前原声。');return;}
      if(row.audio){const prepared={...await prepare(s,row),sourceStart:segment.sourceStart,sourceEnd:segment.sourceEnd};try{await s.picture?.ready(prepared);}catch(error){dispose(prepared);throw error;}if(session===s&&generation===s.generation&&(!s.video.paused||s.picture)){live.ready.set(segment.sequence,prepared);drainReady(s,live);}else dispose(prepared);}
      else if(row.preparingVoice)s.status('正在从当前视频建立原讲者参考音色，暂用原声…');
      else if(!s.heard&&Date.now()-s.started>15000)s.status('当前未检测到清晰的英语讲话，继续等待原声。');
      if(row.audio)s.heard=true;
    }catch(error){if(session===s&&generation===s.generation){if(/本地模型正在处理/.test(error.message))s.status('本地模型忙，跳过本段，继续识别当前原声。');else stop(error.message,true);}}
    finally{if(session===s&&s.live===live){if(segment.sequence>=live.next&&!live.ready.has(segment.sequence))live.ready.set(segment.sequence,null);live.running--;s.busy=live.running>0;drainReady(s,live);const next=s.pending.shift();if(next)void recognize(s,next);}}
  }
  function flushCaptured(s){
    if(s.samples&&s.speechSamples>=s.context.sampleRate*.2){
      const samples=new Float32Array(s.samples);let offset=0;for(const part of s.chunks){samples.set(part,offset);offset+=part.length;}
      if(s.autoVoice&&s.samples>=s.context.sampleRate*3)s.voicePrimed=true;
      void recognize(s,{samples,sourceStart:s.segmentStart,sourceEnd:s.video.currentTime});
    }
    s.chunks=[];s.samples=0;s.quietSamples=0;s.speechSamples=0;
  }
  async function start({video,loadCues=async()=>[],prepareVoice,watchMode='direct',translationMode='custom',aiProfileId='',language='en',speed=1,voiceProfileId='',autoVoice=false,status,onState,onTranscript=()=>{}}) {
    stop();
    if(!video)throw new Error('请先打开视频');
    delete video.dataset.yeduPictureError;
    const context=new AudioContext();await context.resume();
    const output=context.createGain();output.gain.value=video.volume;output.connect(context.destination);
    const s={video,context,output,watchMode,translationMode,aiProfileId,language,voiceProfileId,autoVoice,onTranscript,streamId:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),speed:voiceSpeed(speed),status,onState,url:location.href,originalMuted:video.muted,mutedByUs:false,listeners:[],cache:new Map(),cues:[],generation:0,started:Date.now(),chunks:[],samples:0,pending:[],queue:[],live:{running:0,issued:0,next:0,ready:new Map()},quietSamples:0,speechSamples:0};session=s;onState(true);status('连接本地模型，准备中文配音…');
    try{
      const connection=await call({action:'localVoiceConnect',translationMode,aiProfileId});if(session!==s)return;
      if(prepareVoice){const voice=await prepareVoice();if(session!==s)return;s.voiceProfileId=voice.voiceProfileId;s.autoVoice=voice.autoVoice;}
      if(s.autoVoice&&!connection.capabilities?.includes('live-reference'))throw new Error('本地服务版本不支持跟随原讲者，请更新并重启 local-voice 服务。');
      s.cues=await loadCues();if(session!==s)return;
      onState(true,s.cues.length?'subtitles':watchMode==='sync'?'audio-sync':'audio');
      if(s.cues.length&&!['en','auto','zh','zh-CN','zh-TW'].includes(language))throw new Error('第一版支持英语 → 中文，或中文字幕直接配音');
      if(s.cues.some(cue=>cue.text.length>500))throw new Error('字幕段落过长，请使用每段不超过 500 字的字幕');
      const listen=(name,fn)=>{video.addEventListener(name,fn);s.listeners.push(()=>video.removeEventListener(name,fn));};
      const reset=()=>{
        s.sourceEnded=false;s.generation++;s.streamId=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);s.voicePrimed=false;s.chunks=[];s.samples=0;s.last=null;s.missing=null;halt(s);clearLive(s);restore(s);
        if(s.picture){s.picture.close();s.picture=null;if(!ad(video)&&!s.reconnecting)try{s.picture=pictureBuffer(s);silence(s);}catch(error){stop(error.message,true);}}
        // Aborting HTTP cannot interrupt GPU inference. In subtitle mode let
        // it finish (the generation discards its result) before the next cue,
        // avoiding a competing request after a seek while the model is busy.
        if(!s.cues.length)void call({action:'localVoiceCancel'}).catch(()=>{});
      };
      listen('pause',()=>{if(s.cues.length||s.picture){s.node?.pause();s.picture?.recording();if(s.picture)flushCaptured(s);}else reset();});listen('seeking',reset);listen('seeked',()=>s.picture?.recording());listen('ratechange',()=>{if(s.cues.length)s.node?.sync();else reset();});listen('ended',()=>{if(ad(video)||s.advertising||s.reconnecting)return;if(s.picture){s.sourceEnded=true;flushCaptured(s);s.picture.recording();void s.node?.resume().catch(error=>{if(session===s)stop(error.message,true);});}else stop();});listen('emptied',()=>{if(!s.cues.length&&video.closest('.html5-video-player')&&location.href===s.url)suspendCapture(s,'播放器正在切换音轨，正片就绪后继续翻译。');else stop('播放器已切换，已恢复原声。');});
      listen('play',()=>{void context.resume();s.picture?.recording();if((s.cues.length||s.picture)&&s.node&&!s.waiting){const node=s.node;node.sync(true);void node.resume().catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});}});
      listen('waiting',()=>{s.waiting=true;if(s.picture)s.picture.recording();else if(s.cues.length)s.node?.pause();else reset();});listen('playing',()=>{s.waiting=false;s.picture?.recording();if(s.cues.length&&s.node&&!video.paused){const node=s.node;node.sync(true);void node.resume().catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});}});
      listen('volumechange',()=>{output.gain.value=video.volume;});
      if(!s.cues.length){
        if(ad(video)){s.advertising=true;s.reconnecting=true;status('广告播放中，结束后自动开始语音翻译。');}
        else{captureLive(s);status(s.picture?'实时识别与同步观看已开启 · 正在缓冲中文配音，首次需要等待。':'实时识别配音已开启 · 按语音停顿分段，连续播放，仍有处理延迟。');}
      }else status('字幕同步配音已开启 · 按每条字幕起止时间播放，提前准备约 60 秒。');
      s.timer=setInterval(()=>void tick(s),25);void tick(s);
    }catch(error){if(session===s)stop(error.message,true);}
  }
  function setSpeed(value){if(session){session.speed=voiceSpeed(value);session.node?.setSpeed();}}
  async function captureReference({video,signal,onProgress=()=>{}}){
    if(!video||video.paused||video.seeking||ad(video))throw new Error('请先播放一段清晰的单人原声，再开始采集');
    if(video.playbackRate!==1)throw new Error('采集原声前，请把视频倍速调回 1 倍');
    const capture=video.captureStream||video.mozCaptureStream;if(!capture)throw new Error('此浏览器无法采集视频音轨，请导入参考音频');
    const context=new AudioContext();let stream,input,processor,gain,timer;const removers=[];
    try{
      await context.resume();stream=capture.call(video);
      const tracks=stream.getAudioTracks();if(!tracks.length)throw new Error('未找到可读取的音轨，请导入参考音频');
      input=context.createMediaStreamSource(new MediaStream(tracks));processor=context.createScriptProcessor(4096,1,1);gain=context.createGain();gain.gain.value=0;
      input.connect(processor);processor.connect(gain);gain.connect(context.destination);
      return await new Promise((resolve,reject)=>{
        const parts=[],limit=Math.floor(context.sampleRate*7);let count=0;
        const cancel=()=>reject(new Error('已取消原声采集'));
        for(const name of ['pause','seeking','ratechange','emptied','ended']){video.addEventListener(name,cancel);removers.push(()=>video.removeEventListener(name,cancel));}
        signal?.addEventListener('abort',cancel,{once:true});removers.push(()=>signal?.removeEventListener('abort',cancel));if(signal?.aborted){cancel();return;}
        timer=setTimeout(()=>reject(new Error('无法读取原声，请导入参考音频')),15000);
        processor.onaudioprocess=event=>{
          if(ad(video)){cancel();return;}
          const part=event.inputBuffer.getChannelData(0).slice(0,limit-count);parts.push(part);count+=part.length;onProgress(Math.min(7,Math.floor(count/context.sampleRate)));
          if(count>=limit){const samples=new Float32Array(count);let offset=0;for(const row of parts){samples.set(row,offset);offset+=row.length;}resolve({audio:wav(samples,context.sampleRate),duration:7});processor.onaudioprocess=null;}
        };
      });
    }finally{
      clearTimeout(timer);for(const remove of removers)remove();if(processor){processor.onaudioprocess=null;processor.disconnect();}input?.disconnect();gain?.disconnect();for(const track of stream?.getTracks()||[])track.stop();await context.close();
    }
  }
  async function referenceFromFile(file){
    if(file.size>10000000)throw new Error('参考音频文件过大，请使用 3–10 秒片段');
    const context=new AudioContext();
    try{
      const buffer=await context.decodeAudioData(await file.arrayBuffer());
      if(buffer.duration<3||buffer.duration>10)throw new Error('参考原声需要 3–10 秒');
      const samples=new Float32Array(buffer.length);for(let channel=0;channel<buffer.numberOfChannels;channel++){const values=buffer.getChannelData(channel);for(let i=0;i<samples.length;i++)samples[i]+=values[i]/buffer.numberOfChannels;}
      return {audio:wav(samples,buffer.sampleRate),duration:buffer.duration};
    }finally{await context.close();}
  }
  return {start,stop,setSpeed,captureReference,referenceFromFile,get active(){return !!session;}};
})();
