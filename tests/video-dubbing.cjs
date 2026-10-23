// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function setup(){
  const requests=[],nodes=[],tracks=[],intervals=[],messages=[],states=[];let fail=false,pending,now=10000;
  function Audio(url){this.src=url;this.currentTime=0;nodes.push(this);this.play=async()=>{this.started=true;this.paused=false;};this.pause=()=>{this.stopped=true;this.paused=true;};}
  const video=new EventTarget();Object.assign(video,{dataset:{},paused:false,seeking:false,currentTime:1.2,volume:.8,playbackRate:1,muted:false,isConnected:true,closest:()=>null});
  video.pause=()=>{video.paused=true;video.dispatchEvent(new Event('pause'));};video.play=async()=>{video.paused=false;video.dispatchEvent(new Event('play'));};
  const context={sampleRate:16000,currentTime:0,destination:{},resume:async()=>{},close:async()=>{},decodeAudioData:async()=>({duration:1}),createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),createBufferSource(){const node={playbackRate:{value:1},connect(){},disconnect(){},start(){node.started=true;},stop(){node.stopped=true;}};nodes.push(node);return node;},createMediaStreamSource:()=>({connect(){},disconnect(){}}),createScriptProcessor(){this.processor={connect(){},disconnect(){}};return this.processor;}};
  context.createMediaElementSource=()=>({connect(){},disconnect(){}});
  const sandbox={Audio,Blob,URL,AudioContext:function(){return context;},MediaStream:function(){},location:{href:'https://www.youtube.com/watch?v=abcdefghijk'},setInterval:fn=>{intervals.push(fn);return fn;},clearInterval:()=>{},setTimeout,clearTimeout,console,Uint8Array,DataView,Float32Array,Date:class extends Date{static now(){return now;}},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),twpAIClient:{call:async request=>{requests.push(request);if(fail&&request.action!=='localVoiceCancel')throw new Error('Disconnected');if(pending&&request.action==='localVoiceDub')return pending;return {audio:'YWJj',translated:'你好',capabilities:['live-reference']};}}};
  video.captureStream=()=>({getAudioTracks:()=>[{}],getTracks:()=>tracks});tracks.push({stop(){this.stopped=true;}});
  vm.runInNewContext(fs.readFileSync('src/contentScript/videoDubbing.js','utf8')+';globalThis.app=twpVideoDubbing;',sandbox);
  return {app:sandbox.app,video,context,nodes,requests,tracks,messages,states,sandbox,advance:ms=>now+=ms,fail:()=>{fail=true;},hold:()=>{pending=new Promise(()=>{});},start:async(cues=[{id:'a',start:1,end:3,text:'Hello'}],speed=1)=>{await sandbox.app.start({video,loadCues:async()=>cues,speed,status:(...args)=>messages.push(args),onState:value=>states.push(value)});await new Promise(resolve=>setImmediate(resolve));},tick:async()=>{await intervals.at(-1)();await new Promise(resolve=>setImmediate(resolve));}};
}
test('subtitle audio mutes only after ready and stop restores original state',async()=>{const s=await setup();await s.start();assert.equal(s.video.muted,false);await s.tick();assert.equal(s.video.muted,true);assert.equal(s.nodes.length,1);s.app.stop();assert.equal(s.video.muted,false);assert.equal(s.nodes[0].stopped,true);assert.equal(s.states.at(-1),false);assert.ok(s.requests.some(row=>row.action==='localVoiceEnd'));const connect=s.requests.find(row=>row.action==='localVoiceConnect'),end=s.requests.find(row=>row.action==='localVoiceEnd');assert.equal(end.voiceSessionId,connect.voiceSessionId);});
test('pause and seek stop old audio and seek can replay cached cue',async()=>{const s=await setup();await s.start();await s.tick();for(const name of ['pause','seeking']){s.video.dispatchEvent(new Event(name));assert.equal(s.nodes.at(-1).stopped,true);await s.tick();}s.app.stop();});
test('navigation and service failures restore original sound',async()=>{const s=await setup();await s.start();await s.tick();s.sandbox.location.href='https://www.youtube.com/watch?v=newvideo123';await s.tick();assert.equal(s.app.active,false);assert.equal(s.video.muted,false);const failed=await setup();failed.fail();await failed.start();assert.equal(failed.app.active,false);assert.equal(failed.messages.at(-1)[1],true);});
test('live PCM is bounded and capture survives muting without recording synthesized output',async()=>{const s=await setup();await s.start([]);const samples=new Float32Array(4096).fill(.25);for(let i=0;i<32;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>samples}});await new Promise(resolve=>setImmediate(resolve));const request=s.requests.find(row=>row.action==='localVoiceRecognize');assert.ok(request);const wav=Buffer.from(request.audio,'base64');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readInt16LE(44),8192);assert.equal(s.video.muted,true);s.app.stop();assert.equal(s.video.muted,false);assert.equal(s.tracks[0].stopped,true);});
test('seeking discards a late synthesis result',async()=>{const s=await setup();let resolve;s.sandbox.twpAIClient.call=async request=>request.action==='localVoiceDub'?new Promise(r=>{resolve=r;}):{};await s.start();s.video.dispatchEvent(new Event('seeking'));resolve({audio:'YWJj',translated:'old'});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(s.video.muted,false);assert.equal(s.nodes.length,0);s.app.stop();});
test('paused subtitle mode prepares audio without muting or speaking until play',async()=>{const s=await setup();s.video.paused=true;await s.start();assert.ok(s.requests.some(row=>row.action==='localVoiceDub'));await s.tick();assert.equal(s.nodes.length,0);assert.equal(s.video.muted,false);s.video.paused=false;s.video.dispatchEvent(new Event('play'));await s.tick();assert.equal(s.nodes.length,1);assert.equal(s.video.muted,true);s.app.stop();});
test('pausing subtitle speech resumes at the video position instead of restarting the phrase',async()=>{const s=await setup();await s.start();await s.tick();const audio=s.nodes[0];s.video.currentTime=1.7;audio.currentTime=.35;s.video.pause();await s.tick();await s.video.play();await s.tick();assert.equal(s.nodes.length,1);assert.ok(Math.abs(audio.currentTime-.35)<.001);s.app.stop();});
test('long subtitles fit their own time window with pitch preserved and never queue old phrases',async()=>{const s=await setup();s.context.decodeAudioData=async()=>({duration:5});await s.start([{id:'a',start:1,end:3,text:'First.'},{id:'b',start:3,end:5,text:'Next.'}]);await s.tick();await s.tick();await s.tick();const first=s.nodes[0];assert.equal(first.preservesPitch,true);assert.equal(first.playbackRate,2.5);assert.ok(Math.abs(first.currentTime-.5)<.001);s.video.currentTime=3.1;await s.tick();assert.equal(first.stopped,true);assert.equal(s.nodes.length,2);assert.ok(Math.abs(s.nodes[1].currentTime-.25)<.001);s.video.currentTime=5.5;await s.tick();assert.equal(s.nodes[1].stopped,true);assert.equal(s.nodes.length,2);s.app.stop();});
test('subtitle text stays in its original cue instead of speaking a future subtitle early',async()=>{const s=await setup();await s.start([{id:'a',start:1,end:2,text:'Hello,'},{id:'b',start:2,end:3,text:'this is a sentence.'}]);await s.tick();await s.tick();assert.equal(s.requests.find(r=>r.action==='localVoiceDub').text,'Hello,');assert.ok(s.requests.some(r=>r.text==='this is a sentence.'));assert.equal(s.nodes.length,1);s.app.stop();});
test('slow synthesis never pauses the video and a late result joins its current timestamp',async()=>{const s=await setup();let resolve;s.sandbox.twpAIClient.call=async request=>request.action==='localVoiceDub'?new Promise(r=>{resolve=r;}):{};await s.start();assert.equal(s.video.paused,false);assert.equal(s.video.muted,false);s.video.currentTime=2;resolve({audio:'YWJj',translated:'ready'});await new Promise(r=>setImmediate(r));await s.tick();assert.equal(s.video.paused,false);assert.equal(s.nodes.length,1);assert.equal(s.nodes[0].currentTime,.5);s.app.stop();const stopped=await setup();stopped.video.paused=true;stopped.hold();await stopped.start();stopped.app.stop();assert.equal(stopped.video.paused,true);});
test('video speed, large drift and player buffering recalibrate the same subtitle audio',async()=>{const s=await setup();s.context.decodeAudioData=async()=>({duration:4});await s.start();await s.tick();const audio=s.nodes[0];s.advance(2100);s.video.currentTime=1.8;audio.currentTime=.1;await s.tick();assert.ok(Math.abs(audio.currentTime-1.6)<.001);s.video.playbackRate=1.5;s.video.dispatchEvent(new Event('ratechange'));assert.equal(audio.playbackRate,3);assert.equal(s.nodes.length,1);s.video.dispatchEvent(new Event('waiting'));assert.equal(audio.paused,true);s.video.dispatchEvent(new Event('playing'));await new Promise(r=>setImmediate(r));assert.equal(audio.paused,false);s.app.stop();});
test('live phrases use silence boundaries and new audio waits for the previous phrase',async()=>{const s=await setup();await s.start([]);const feed=(value,count)=>{for(let i=0;i<count;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(value)}});};feed(0,20);assert.equal(s.requests.filter(r=>r.action==='localVoiceRecognize').length,0);feed(.25,8);feed(0,2);await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,1);feed(.25,8);feed(0,2);await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,1);assert.equal(s.nodes[0].stopped,undefined);s.nodes[0].onended();await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,2);s.app.stop();});
test('offline inference stays serial and seeking clears its backlog',async()=>{const s=await setup();let resolve,recognized=0;s.sandbox.twpAIClient.call=async request=>{if(request.action==='localVoiceRecognize'){recognized++;if(recognized===1)return new Promise(r=>{resolve=r;});return {audio:'YWJj',translated:'second'};}return {};};await s.app.start({video:s.video,translationMode:'local',status:()=>{},onState:()=>{}});const feed=()=>{for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});};feed();feed();assert.equal(recognized,1);resolve({audio:'YWJj',translated:'first'});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(recognized,2);assert.equal(s.nodes.length,1);s.video.dispatchEvent(new Event('seeking'));assert.equal(s.nodes[0].stopped,true);s.app.stop();});
test('short speech fills its subtitle interval and manual pace cannot override timestamps',async()=>{const s=await setup();s.context.decodeAudioData=async()=>({duration:3});await s.start([{id:'a',start:1,end:5,text:'Hello'}],2);await s.tick();const audio=s.nodes[0];assert.equal(audio.playbackRate,.75);assert.ok(Math.abs(audio.currentTime-.15)<.001);s.app.setSpeed(1.5);assert.equal(audio.playbackRate,.75);assert.ok(Math.abs(audio.currentTime-.15)<.001);s.video.currentTime=4;audio.currentTime=2.25;await s.tick();assert.equal(audio.paused,false);assert.equal(audio.preservesPitch,true);s.app.stop();});
test('a slower chosen pace still fits the remaining subtitle time',async()=>{const s=await setup();s.context.decodeAudioData=async()=>({duration:5});await s.start();await s.tick();const audio=s.nodes[0];s.app.setSpeed(.75);assert.ok(Math.abs(audio.playbackRate-2.5)<.001);assert.ok(Math.abs(audio.currentTime-.5)<.001);s.app.stop();});

test('ordinary clock jitter does not seek and chop speech on every tick',async()=>{const s=await setup();s.context.decodeAudioData=async()=>({duration:4});await s.start();await s.tick();const audio=s.nodes[0];let position=audio.currentTime,seeks=0;Object.defineProperty(audio,'currentTime',{get:()=>position,set:value=>{position=value;seeks++;}});for(let i=0;i<12;i++){s.advance(100);s.video.currentTime=1.2+i*.05;position=(s.video.currentTime-1)*2-.3;await s.tick();}assert.equal(seeks,0);s.app.stop();});

test('expired synthesis never spills into another subtitle or a subtitle gap',async()=>{const s=await setup();let resolve;s.sandbox.twpAIClient.call=async request=>request.action==='localVoiceDub'?new Promise(r=>{resolve=r;}):{};await s.start([{id:'a',start:1,end:2,text:'First'},{id:'b',start:4,end:6,text:'Second'}]);s.video.currentTime=2.5;resolve({audio:'YWJj',translated:'first'});await new Promise(r=>setImmediate(r));await s.tick();assert.equal(s.nodes.length,0);assert.equal(s.video.muted,false);assert.equal(s.video.paused,false);resolve({audio:'YWJj',translated:'second'});await new Promise(r=>setImmediate(r));await s.tick();assert.equal(s.nodes.length,0);s.video.currentTime=4;await s.tick();assert.equal(s.nodes.length,1);assert.equal(s.nodes[0].currentTime,0);assert.equal(s.nodes[0].playbackRate,.5);s.app.stop();});

test('future subtitles are synthesized ahead of time but never played early',async()=>{const s=await setup();await s.start([{id:'a',start:1,end:3,text:'Current'},{id:'b',start:45,end:48,text:'Future'}]);await s.tick();await s.tick();assert.ok(s.requests.some(r=>r.text==='Future'));assert.equal(s.nodes.length,1);s.video.currentTime=44;await s.tick();assert.equal(s.nodes.length,1);s.video.currentTime=45;await s.tick();assert.equal(s.nodes.length,2);assert.equal(s.nodes[1].currentTime,0);s.app.stop();});

test('live speech is bounded to 4.5 seconds plus one audio block and ends restore original sound',async()=>{
  const s=await setup();await s.start([]);const chunk=new Float32Array(4096).fill(.25);
  for(let i=0;i<24;i++){s.video.currentTime+=4096/16000;s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>chunk}});}
  await new Promise(r=>setImmediate(r));
  const request=s.requests.find(row=>row.action==='localVoiceRecognize');assert.ok(request);
  assert.ok(Buffer.from(request.audio,'base64').readUInt32LE(40)<=4.8*16000*2);
  assert.match(request.streamId,/^[a-z0-9_]+$/);assert.equal(s.nodes.length,1);assert.equal(s.video.muted,true);
  s.nodes[0].onended();assert.equal(s.video.muted,false);s.app.stop();
});

test('expired live inference never plays or displays a stale translation',async()=>{
  const s=await setup();let resolve;const captions=[];
  s.sandbox.twpAIClient.call=async request=>request.action==='localVoiceRecognize'?new Promise(r=>{resolve=r;}):{};
  await s.app.start({video:s.video,loadCues:async()=>[],status:(...x)=>s.messages.push(x),onState:()=>{},onTranscript:row=>captions.push(row)});
  for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
  s.video.currentTime=20;resolve({audio:'YWJj',translated:'old'});await new Promise(r=>setImmediate(r));
  assert.equal(s.nodes.length,0);assert.equal(s.video.muted,false);assert.ok(!captions.some(row=>row?.translated==='old'));s.app.stop();
});

test('live captions match playing speech and buffering clears them with the old voice',async()=>{
  const s=await setup(),captions=[];
  await s.app.start({video:s.video,loadCues:async()=>[],autoVoice:true,status:()=>{},onState:()=>{},onTranscript:row=>captions.push(row)});
  for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
  await new Promise(r=>setImmediate(r));assert.equal(captions.at(-1).translated,'你好');
  const stream=s.requests.find(row=>row.action==='localVoiceRecognize').streamId;
  s.video.dispatchEvent(new Event('waiting'));assert.equal(captions.at(-1),null);assert.equal(s.video.muted,false);
  const before=s.requests.length;
  for(let i=0;i<20;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
  assert.equal(s.requests.length,before);s.video.dispatchEvent(new Event('playing'));
  for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
  await new Promise(r=>setImmediate(r));const next=s.requests.filter(row=>row.action==='localVoiceRecognize').at(-1);
  assert.equal(next.autoVoice,true);assert.notEqual(next.streamId,stream);s.app.stop();
});

test('speaker priming submits early and reported delay includes the capture interval',async()=>{
  const s=await setup(),captions=[];
  await s.app.start({video:s.video,autoVoice:true,status:()=>{},onState:()=>{},onTranscript:row=>captions.push(row)});
  for(let i=0;i<14;i++){s.video.currentTime+=4096/16000;s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});}
  await new Promise(r=>setImmediate(r));const request=s.requests.find(row=>row.action==='localVoiceRecognize');assert.ok(request);
  const duration=Buffer.from(request.audio,'base64').readUInt32LE(40)/32000;
  assert.ok(duration>=3&&duration<=3.6);assert.ok(captions.at(-1).delay>=duration-.01);s.app.stop();
});

test('temporary model contention does not disable ongoing live translation',async()=>{
  const s=await setup();let tries=0;
  s.sandbox.twpAIClient.call=async request=>{if(request.action==='localVoiceRecognize'&&tries++===0)throw new Error('本地模型正在处理，请稍后重试');return {audio:'YWJj',translated:'已恢复'};};
  await s.start([]);
  const feed=()=>{for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});};
  feed();await new Promise(r=>setImmediate(r));assert.equal(s.app.active,true);assert.equal(s.video.muted,false);
  feed();await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,1);assert.equal(s.video.muted,true);s.app.stop();
});

test('custom AI overlaps two phrases but plays out-of-order completions in source order',async()=>{
 const s=await setup(),pending=[],captions=[];
 s.sandbox.twpAIClient.call=async request=>request.action==='localVoiceRecognize'?new Promise(resolve=>pending.push(resolve)):{};
 await s.app.start({video:s.video,translationMode:'custom',onTranscript:row=>{if(row)captions.push(row.translated);},status:()=>{},onState:()=>{}});
 for(let i=0;i<36;i++){s.video.currentTime+=4096/16000;s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});}
 assert.equal(pending.length,2);pending[1]({audio:'YWJj',translated:'second'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.nodes.length,0);
 pending[0]({audio:'YWJj',translated:'first'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.nodes.length,1);assert.deepEqual(captions,['first']);
 s.nodes[0].onended();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(captions,['first','second']);s.app.stop();
});

test('pausing pending audio play is normal cancellation and resume still starts playback',async()=>{
 const s=await setup();
 s.sandbox.Audio=function(){this.currentTime=0;this.paused=true;s.nodes.push(this);this.play=()=>{this.paused=false;return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});};this.pause=()=>{this.paused=true;const error=new Error('Play interrupted by pause');error.name='AbortError';this.reject?.(error);};};
 await s.start();await s.tick();assert.equal(s.nodes.length,1);s.video.pause();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.app.active,true);
 await s.video.play();s.nodes[0].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.app.active,true);assert.equal(s.video.muted,true);s.app.stop();
});

test('YouTube starts during an ad without capturing or training on advertising audio',async()=>{
 const s=await setup();let advertising=true,captures=0;
 s.video.closest=()=>({classList:{contains:()=>advertising}});s.video.readyState=4;
 const native=s.video.captureStream;s.video.captureStream=()=>{captures++;return native();};
 await s.start([]);assert.equal(s.app.active,true);assert.equal(captures,0);assert.equal(s.video.muted,false);
 s.video.dispatchEvent(new Event('ended'));await s.tick();assert.equal(s.app.active,true);
 advertising=false;s.video.readyState=0;await s.tick();assert.equal(captures,0);
 s.video.readyState=4;await s.tick();assert.equal(captures,1);
 for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
 await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,1);s.app.stop();
});
test('YouTube mid-roll discards stale voice and reacquires the post-ad media stream',async()=>{
 const s=await setup();let advertising=false,captures=0;
 s.video.closest=()=>({classList:{contains:()=>advertising}});s.video.readyState=4;
 const native=s.video.captureStream;s.video.captureStream=()=>{captures++;return native();};
 await s.start([]);const old=s.context.processor;
 for(let i=0;i<24;i++)old.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
 await new Promise(r=>setImmediate(r));assert.equal(s.video.muted,true);
 advertising=true;await s.tick();assert.equal(old.onaudioprocess,null);assert.equal(s.nodes[0].stopped,true);assert.equal(s.video.muted,false);
 s.video.dispatchEvent(new Event('emptied'));await s.tick();assert.equal(s.app.active,true);assert.equal(captures,1);
 advertising=false;await s.tick();assert.equal(captures,2);assert.notEqual(s.context.processor,old);
 for(let i=0;i<24;i++)s.context.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.25)}});
 await new Promise(r=>setImmediate(r));assert.equal(s.nodes.length,2);s.app.stop();
});
test('YouTube same-page media replacement reconnects, but navigation ends the old voice session',async()=>{
 const s=await setup();s.video.closest=()=>({classList:{contains:()=>false}});s.video.readyState=4;
 await s.start([]);const old=s.context.processor;
 s.video.readyState=0;s.video.dispatchEvent(new Event('emptied'));assert.equal(old.onaudioprocess,null);await s.tick();assert.equal(s.app.active,true);
 s.video.readyState=4;await s.tick();assert.notEqual(s.context.processor,old);
 s.sandbox.location.href='https://www.youtube.com/watch?v=nextvideo12';await s.tick();assert.equal(s.app.active,false);assert.equal(s.video.muted,false);
});

test('pause and seek cancel work without releasing the model session; final stop releases the stable session',async()=>{
 const s=await setup();await s.start([]);const id=s.requests.find(row=>row.action==='localVoiceConnect').voiceSessionId;
 s.video.pause();s.video.currentTime=12;s.video.dispatchEvent(new Event('seeking'));await s.video.play();await s.tick();
 assert.equal(s.requests.some(row=>row.action==='localVoiceEnd'),false);
 assert.equal(s.requests.filter(row=>row.action==='localVoiceCancel').every(row=>row.voiceSessionId===id),true);
 s.app.stop();assert.equal(s.requests.find(row=>row.action==='localVoiceEnd').voiceSessionId,id);
});
