// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('src/background/localVoice.js','utf8');
function harness(translate=async()=> '我们把它叫作停车楼。',recognizeHook=async()=>{}) {
  let handler,stop;const calls=[],ai=[],events=[];
  const profiles=[{id:'selected',model:'configured-model'}];
  const context=vm.createContext({console,URL,AbortController,DOMException,performance,setTimeout,clearTimeout,
    chrome:{runtime:{onMessage:{addListener:fn=>handler=fn}},tabs:{onRemoved:{addListener(){}}}},
    twpConfig:{onReady:async()=>{},get:key=>key==='aiProfiles'?profiles:'selected'},
    twpLocalVoiceService:{onStop:fn=>stop=fn,record:async row=>events.push(row),begin:async()=>{},end:async()=>({stopped:false}),releaseTab:async()=>{}},
    twpAIVoiceTranslate:async(input,signal)=>{ai.push(input);return translate(input,signal);},
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});if(url.endsWith('/recognize-dub'))await recognizeHook(body);
      const data=url.endsWith('/session')?{token:'local-token',capabilities:['external-translation']}:
        url.endsWith('/recognize-dub')?{text:'We just call this the parking garage.',context:'There are many levels for cars.',ticket:'one-use',voiceSource:'speaker',timings:{recognition:.3}}:
        {text:'We just call this the parking garage.',translated:body.translated,audio:'wav',voiceSource:'speaker',timings:{speech:1}};
      return {ok:true,json:async()=>data};
    }});
  vm.runInContext(source,context);
  const sender={tab:{id:3,title:'Airport English'},frameId:0,documentId:'video-1',url:'https://www.bilibili.com/video/BVtest/'};
  const send=(message,from=sender)=>new Promise(resolve=>handler(message,from,resolve));
  return {send,calls,ai,events,stop:()=>stop()};
}
const segment={action:'localVoiceRecognize',audio:'source-wav',streamId:'video',autoVoice:true,translationMode:'custom',aiProfileId:'selected'};
test('voice pipeline uses configured AI with text context and speaks its exact translation locally',async()=>{
  const h=harness(),result=await h.send(segment);
  assert.equal(result.ok,true);assert.equal(result.translationSource,'custom');assert.equal(result.translationModel,'configured-model');
  assert.equal(h.calls[1].body.recognizeOnly,true);
  assert.deepEqual(h.calls[2].body,{ticket:'one-use',translated:'我们把它叫作停车楼。'});
  assert.equal(h.ai[0].profileId,'selected');assert.equal(h.ai[0].context,'There are many levels for cars.');
  assert.equal(h.ai[0].audio,undefined);assert.equal(h.calls.some(c=>'apiKey' in c.body),false);
  assert.equal(h.events[0].translated,result.translated);
});
test('custom provider failure never falls back to local translation or synthesizes a different sentence',async()=>{
  const h=harness(async()=>{throw new Error('AI 服务暂时不可用');}),result=await h.send(segment);
  assert.equal(result.ok,false);assert.match(result.error,/AI/);
  assert.equal(h.calls.some(c=>c.url.endsWith('/speak')||c.url.endsWith('/dub')),false);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/recognize-dub')).length,1);
});
test('pause or seek cancellation while AI is pending prevents subsequent local speech',async()=>{
  let entered,finish;const ready=new Promise(resolve=>entered=resolve);
  const h=harness(async()=>{entered();await new Promise(resolve=>finish=resolve);return '已经过期的配音';});
  const result=h.send(segment);await ready;await h.send({action:'localVoiceCancel'});finish();
  assert.equal((await result).ok,false);assert.equal(h.calls.some(c=>c.url.endsWith('/speak')),false);
});
test('website frames cannot invoke the voice proxy from another origin',async()=>{
  const h=harness();assert.equal((await h.send(segment,{url:'https://untrusted.example',tab:{id:1},frameId:0})).ok,false);
  assert.equal(h.calls.length,0);assert.equal(h.ai.length,0);
});

test('ASR keeps source order while the next recognition overlaps the previous AI wait',async()=>{
 let releaseASR,releaseAI,asrCalls=0,aiCalls=0,enteredASR,enteredAI;
 const asrStarted=new Promise(resolve=>enteredASR=resolve),aiStarted=new Promise(resolve=>enteredAI=resolve);
 const h=harness(async()=>{if(aiCalls++===0){enteredAI();await new Promise(resolve=>releaseAI=resolve);}return '正确顺序';},async()=>{if(asrCalls++===0){enteredASR();await new Promise(resolve=>releaseASR=resolve);}});
 const first=h.send(segment);await asrStarted;const second=h.send({...segment,audio:'second-wav'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(asrCalls,1);
 releaseASR();await aiStarted;await new Promise(resolve=>setImmediate(resolve));assert.equal(asrCalls,2);
 releaseAI();assert.equal((await first).ok,true);assert.equal((await second).ok,true);
});
