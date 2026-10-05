// SPDX-License-Identifier: MPL-2.0
"use strict";
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
  function halt(s) {if(s.node){s.node.stop();s.node=null;}s.playing=null;}
  function clearLive(s){s.pending=[];s.speechSamples=0;s.quietSamples=0;for(const row of s.queue)dispose(row);s.queue=[];}
  function restore(s){if(s.mutedByUs&&s.video.muted)s.video.muted=s.originalMuted;s.mutedByUs=false;}
  function silence(s){if(!s.video.muted){s.video.muted=true;s.mutedByUs=true;}}
  function stop(message='已关闭本地配音，恢复原声。',error=false) {
    const s=session;if(!s)return;session=null;s.generation++;
    clearInterval(s.timer);halt(s);restore(s);
    clearLive(s);for(const row of s.cache.values())dispose(row);s.cache.clear();
    for(const remove of s.listeners)remove();
    if(s.processor){s.processor.onaudioprocess=null;s.processor.disconnect();s.input.disconnect();s.gain.disconnect();}
    for(const track of s.stream?.getTracks()||[])track.stop();
    void s.context.close().catch(()=>{});void call({action:'localVoiceCancel'}).catch(()=>{});
    s.status(message,error);s.onState(false);
  }
  function play(s,row,cue=null) {
    if(session!==s||s.video.paused||s.video.seeking||ad(s.video))return;
    // AudioBufferSource changes pitch when sped up. Media elements provide
    // browser time stretching, so fitting a subtitle does not change timbre.
    const audio=new Audio(row.url);audio.preservesPitch=true;audio.mozPreservesPitch=true;audio.webkitPreservesPitch=true;
    // The subtitle's complete [start, end) interval owns this audio. A global
    // speaking speed must not make a short recording end before its cue.
    let fit=cue?row.duration/(cue.end-cue.start):s.speed;
    let correctedAt=0;
    audio.playbackRate=Math.max(.0625,Math.min(16,fit*s.video.playbackRate));
    const source=s.context.createMediaElementSource(audio);source.connect(s.output);
    const node={pause(){audio.pause();},resume(){return audio.play();},sync(force=false){
      if(!cue)return;
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
    },stop(){audio.onended=null;audio.onerror=null;audio.pause();source.disconnect();if(!cue)dispose(row);}};
    s.node=node;s.playing=cue?.id||'live';
    audio.onended=()=>{if(s.node===node){node.stop();s.node=null;s.playing=null;if(!cue)playQueued(s);}};
    audio.onerror=()=>{if(session===s&&s.node===node)stop('本地配音音频播放失败，请重试。',true);};
    // Always derive the voice position from the video timeline; sequential
    // playback accumulates lag whenever a translated phrase is longer.
    node.sync(true);
    void audio.play().then(()=>{if(session===s&&s.node===node)silence(s);}).catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});
  }
  async function prepare(s,row){
    const bytes=Uint8Array.from(atob(row.audio),char=>char.charCodeAt(0));
    const buffer=await s.context.decodeAudioData(bytes.buffer.slice(0));
    return {translated:row.translated,duration:buffer.duration,url:URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))};
  }
  function playQueued(s){if(session!==s||s.node||s.video.paused||s.video.seeking||ad(s.video))return;const row=s.queue.shift();if(row)play(s,row);}
  async function tick(s) {
    if(session!==s)return;
    if(location.href!==s.url||!s.video.isConnected){stop('视频已切换，已恢复原声。');return;}
    if(ad(s.video)){if(!s.advertising){s.advertising=true;s.generation++;s.chunks=[];s.samples=0;halt(s);clearLive(s);restore(s);void call({action:'localVoiceCancel'}).catch(()=>{});}return;}s.advertising=false;
    if(s.video.paused||s.video.seeking){if(s.video.seeking){halt(s);return;}s.node?.pause();}
    if(!s.cues.length){playQueued(s);return;}
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
      const row=await call({action:'localVoiceDub',text:next.text,language:s.language,voiceProfileId:s.voiceProfileId});
      if(session!==s||generation!==s.generation)return;
      const prepared=await prepare(s,row);
      if(session!==s||generation!==s.generation){dispose(prepared);return;}
      s.cache.set(next.id,prepared);
      s.status('配音已准备 · '+row.translated);
    }catch(error){if(session===s&&generation===s.generation)stop(error.message,true);}
    finally{if(session===s)s.busy=false;}
  }
  async function recognize(s,samples) {
    if(s.busy){
      // Keep a small ordered backlog instead of discarding every segment that
      // arrives during inference. Bound it when the GPU cannot keep up.
      if(s.pending.length>=2){s.pending.shift();s.status('本地模型处理跟不上播放，已跳过过期音频；建议使用字幕配音。');}
      s.pending.push(samples);return;
    }
    s.busy=true;const generation=s.generation,started=Date.now();
    try{
      const row=await call({action:'localVoiceRecognize',audio:wav(samples,s.context.sampleRate),voiceProfileId:s.voiceProfileId});
      if(session!==s||generation!==s.generation||s.video.paused||ad(s.video))return;
      if(row.audio){const prepared=await prepare(s,row);if(session===s&&generation===s.generation&&!s.video.paused){if(s.queue.length>=2)dispose(s.queue.shift());s.queue.push(prepared);playQueued(s);s.status('实时配音 · '+row.translated+' · 本段处理 '+((Date.now()-started)/1000).toFixed(1)+' 秒');}else dispose(prepared);}
      else if(!s.heard&&Date.now()-s.started>15000)stop('未捕获到语音。受保护或跨域音频可能不可读取，请使用字幕轨道或导入 SRT。',true);
      if(row.audio)s.heard=true;
    }catch(error){if(session===s&&generation===s.generation)stop(error.message,true);}
    finally{if(session===s){s.busy=false;const next=s.pending.shift();if(next)void recognize(s,next);}}
  }
  async function start({video,loadCues,language='en',speed=1.25,voiceProfileId='',status,onState}) {
    stop();
    if(!video)throw new Error('请先打开视频');
    const context=new AudioContext();await context.resume();
    const output=context.createGain();output.gain.value=video.volume;output.connect(context.destination);
    const s={video,context,output,language,voiceProfileId,speed:voiceSpeed(speed),status,onState,url:location.href,originalMuted:video.muted,mutedByUs:false,listeners:[],cache:new Map(),cues:[],generation:0,started:Date.now(),chunks:[],samples:0,pending:[],queue:[],quietSamples:0,speechSamples:0};session=s;onState(true);status('连接本地模型，准备中文配音…');
    try{
      await call({action:'localVoiceConnect'});if(session!==s)return;
      s.cues=await loadCues();if(session!==s)return;
      onState(true,s.cues.length?'subtitles':'audio');
      if(s.cues.length&&!['en','auto','zh','zh-CN','zh-TW'].includes(language))throw new Error('第一版支持英语 → 中文，或中文字幕直接配音');
      if(s.cues.some(cue=>cue.text.length>500))throw new Error('字幕段落过长，请使用每段不超过 500 字的字幕');
      const listen=(name,fn)=>{video.addEventListener(name,fn);s.listeners.push(()=>video.removeEventListener(name,fn));};
      const reset=()=>{
        s.generation++;s.chunks=[];s.samples=0;s.last=null;s.missing=null;halt(s);clearLive(s);restore(s);
        // Aborting HTTP cannot interrupt GPU inference. In subtitle mode let
        // it finish (the generation discards its result) before the next cue,
        // avoiding a competing request after a seek while the model is busy.
        if(!s.cues.length)void call({action:'localVoiceCancel'}).catch(()=>{});
      };
      listen('pause',()=>{if(s.cues.length)s.node?.pause();else reset();});listen('seeking',reset);listen('ratechange',()=>{if(s.cues.length)s.node?.sync();else reset();});listen('ended',()=>stop());listen('emptied',()=>stop('播放器已切换，已恢复原声。'));
      listen('play',()=>{void context.resume();if(s.cues.length&&s.node&&!s.waiting){const node=s.node;node.sync(true);void node.resume().catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});}});
      listen('waiting',()=>{s.waiting=true;if(s.cues.length)s.node?.pause();});listen('playing',()=>{s.waiting=false;if(s.cues.length&&s.node&&!video.paused){const node=s.node;node.sync(true);void node.resume().catch(error=>{if(session===s&&s.node===node)stop(error.message,true);});}});
      listen('volumechange',()=>{output.gain.value=video.volume;});
      if(!s.cues.length){
        const capture=video.captureStream||video.mozCaptureStream;if(!capture)throw new Error('浏览器不支持视频音频读取，请使用字幕配音');
        s.stream=capture.call(video);const audio=s.stream.getAudioTracks();
        if(!audio.length)throw new Error('视频没有可读取的音轨，请播放后重试，或使用字幕配音');
        // Capture belongs to the media element, so synthesized output is not
        // captured again. Element mute does not mute the captured audio track.
        s.input=context.createMediaStreamSource(new MediaStream(audio));s.processor=context.createScriptProcessor(4096,1,1);s.gain=context.createGain();s.gain.gain.value=0;
        s.input.connect(s.processor);s.processor.connect(s.gain);s.gain.connect(context.destination);
        s.processor.onaudioprocess=event=>{
          if(session!==s||video.paused||video.seeking||ad(video)){s.chunks=[];s.samples=0;s.quietSamples=0;s.speechSamples=0;return;}
          const chunk=event.inputBuffer.getChannelData(0).slice();let energy=0;for(const value of chunk)energy+=value*value;
          const voiced=Math.sqrt(energy/chunk.length)>.012;
          if(!voiced&&!s.samples)return;
          s.chunks.push(chunk);s.samples+=chunk.length;
          if(voiced){s.quietSamples=0;s.speechSamples+=chunk.length;}else s.quietSamples+=chunk.length;
          // Prefer a pause at a phrase boundary. Eight seconds is the hard
          // latency/input limit for uninterrupted speech.
          if(s.samples>=context.sampleRate*8||(s.samples>=context.sampleRate*2&&s.quietSamples>=context.sampleRate*.45)){
            if(s.speechSamples>=context.sampleRate*.2){const samples=new Float32Array(s.samples);let offset=0;for(const part of s.chunks){samples.set(part,offset);offset+=part.length;}void recognize(s,samples);}
            s.chunks=[];s.samples=0;s.quietSamples=0;s.speechSamples=0;
          }
        };
        status('实时识别配音已开启 · 按语音停顿分段，连续播放，仍有处理延迟。');
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
