// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('src/background/localVoiceService.js','utf8');
function harness({installed=true,autoStart=true,slowStart=false}={}){
  let handler,state='stopped',starts=0;const session={},local={localVoiceAutoStart:autoStart};
  const runtime={id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>handler=fn},sendNativeMessage(host,message,callback){
    assert.equal(host,'com.yedu.local_voice');
    if(!installed){runtime.lastError={message:'not found'};callback();delete runtime.lastError;return;}
    if(message.action==='start'){starts++;state=slowStart&&starts===1?'starting':'ready';}if(message.action==='stop')state='stopped';
    callback({ok:true,state,message:state});
  }};
  const chrome={runtime,storage:{local:{get:async()=>local,set:async data=>Object.assign(local,data)},session:{get:async()=>session,set:async data=>Object.assign(session,data)}},tabs:{query:async()=>[],sendMessage:async()=>{}}};
  const context=vm.createContext({chrome,console,Promise,Date,AbortSignal,AbortController,setTimeout,clearTimeout,twpConfig:{onReady:async()=>{},get:key=>key==='aiProfiles'?[{id:'model',name:'Custom AI',model:'configured-model',apiKey:'private-fixture-key'}]:'model'},twpAIVoiceTranslate:async()=> '自定义模型译文',fetch:async()=>{throw new Error('offline');}});
  vm.runInContext(source+'\nglobalThis.service=twpLocalVoiceService;',context);
  const send=(action,url='chrome-extension://test/options/voice-service.html',extra={})=>new Promise(resolve=>handler({action,...extra},{id:'test',url},resolve));
  return {service:context.service,session,send,starts:()=>starts};
}
test('disabled automatic startup never launches a process',async()=>{const h=harness({autoStart:false});await assert.rejects(h.service.ensureStarted(),/未运行/);assert.equal(h.starts(),0);});
test('simultaneous startup requests share a single native launch',async()=>{const h=harness();await Promise.all([h.service.ensureStarted(),h.service.ensureStarted()]);assert.equal(h.starts(),1);});
test('service control is restricted to its exact extension page',async()=>{const h=harness();assert.equal((await h.send('localVoiceServiceStart','https://www.bilibili.com/video/')).ok,false);assert.equal(h.starts(),0);assert.equal((await h.send('localVoiceServiceStart')).ok,true);});
test('missing bridge returns actionable setup state and never claims readiness',async()=>{const h=harness({installed:false});const result=await h.service.status();assert.equal(result.state,'unavailable');assert.equal(result.bridge,false);assert.match(result.message,/首次安装/);});
test('transcripts remain bounded in session storage and can be cleared',async()=>{const h=harness();for(let i=0;i<100;i++)await h.service.record({kind:'recognized',text:String(i)});assert.equal(h.session.localVoiceServiceState.events.length,80);await h.send('localVoiceServiceClear');assert.equal(h.session.localVoiceServiceState.events.length,0);});
test('restart immediately after cancel does not reuse the cancelled startup promise',async()=>{const h=harness({slowStart:true});const first=h.send('localVoiceServiceStart');await new Promise(resolve=>setImmediate(resolve));await h.send('localVoiceServiceStop');const next=await h.send('localVoiceServiceStart');assert.equal(next.state,'ready');assert.equal(h.starts(),2);assert.equal((await first).ok,false);assert.equal(h.session.localVoiceServiceState.state,'ready');});

test('manager exposes only public model metadata and its text test is unavailable to websites',async()=>{
  const h=harness(),info=await h.send('localVoiceAIInfo');
  assert.equal(info.ok,true);assert.equal(info.profiles[0].model,'configured-model');assert.equal(JSON.stringify(info).includes('private-fixture-key'),false);
  assert.equal((await h.send('localVoiceAITranslate','https://www.bilibili.com/video/',{text:'Hello'})).ok,false);
  assert.equal((await h.send('localVoiceAITranslate',undefined,{text:'Hello'})).translated,'自定义模型译文');
  assert.equal((await h.send('localVoiceAITranslate',undefined,{text:'x'.repeat(2001)})).ok,false);
});
