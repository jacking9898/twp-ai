// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('src/background/localVoiceService.js','utf8');
function harness({installed=true,autoStart=true,slowStart=false,autoStop=true,session={},stopHook,stopFails=false}={}){
  let handler,state='stopped',starts=0,stops=0;const local={localVoiceAutoStart:autoStart,localVoiceAutoStop:autoStop};
  const runtime={id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>handler=fn},sendNativeMessage(host,message,callback){
    assert.equal(host,'com.yedu.local_voice');
    if(!installed){runtime.lastError={message:'not found'};callback();delete runtime.lastError;return;}
    if(message.action==='start'){starts++;state=slowStart&&starts===1?'starting':'ready';}if(message.action==='stop'){stops++;if(stopFails){callback({ok:true,state:'error',message:'该服务不是本组件启动的，无法安全停止'});return;}if(stopHook)return stopHook(()=>{state='stopped';callback({ok:true,state,message:state});});state='stopped';}
    callback({ok:true,state,message:state});
  }};
  const chrome={runtime,storage:{local:{get:async()=>local,set:async data=>Object.assign(local,data)},session:{get:async()=>session,set:async data=>Object.assign(session,data)}},tabs:{query:async()=>[],sendMessage:async()=>{}}};
  const context=vm.createContext({chrome,console,URL,Promise,Date,AbortSignal,AbortController,setTimeout,clearTimeout,twpConfig:{onReady:async()=>{},get:key=>key==='aiProfiles'?[{id:'model',name:'Custom AI',model:'configured-model',apiKey:'private-fixture-key'}]:'model'},twpAIVoiceTranslate:async()=> '自定义模型译文',fetch:async()=>{throw new Error('offline');}});
  vm.runInContext(source+'\nglobalThis.service=twpLocalVoiceService;',context);
  const send=(action,url='chrome-extension://test/options/voice-service.html',extra={})=>new Promise(resolve=>handler({action,...extra},{id:'test',url},resolve));
  return {service:context.service,session,send,starts:()=>starts,stops:()=>stops,local};
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

test('last voice session automatically stops models by default and notifies clients',async()=>{
 const h=harness();let notified=0;h.service.onStop(()=>notified++);
 await h.service.begin('3:doc','one');await h.service.end('3:doc','one');
 assert.equal(h.stops(),1);assert.equal(notified,1);assert.equal(h.session.localVoiceServiceState.state,'stopped');
 await h.service.end('3:doc','one');assert.equal(h.stops(),1);
});
test('automatic release can be disabled without disabling automatic startup',async()=>{
 const h=harness({autoStop:false});await h.service.begin('3:doc','one');await h.service.end('3:doc','one');assert.equal(h.stops(),0);
 await h.service.ensureStarted();assert.equal(h.starts(),1);
 await h.send('localVoiceServiceSettings',undefined,{autoStop:true});assert.equal(h.local.localVoiceAutoStart,true);
 await h.service.begin('3:doc','two');await h.service.end('3:doc','two');assert.equal(h.stops(),1);
});
test('closing one tab cannot stop another active video, including after a worker restart',async()=>{
 const h=harness();await h.service.begin('3:doc','one');await h.service.begin('4:doc','two');
 const restarted=harness({session:h.session});await restarted.service.releaseTab(3);assert.equal(restarted.stops(),0);
 await restarted.service.releaseTab(4);assert.equal(restarted.stops(),1);
});
test('an obsolete stop cannot release the new voice session in the same document',async()=>{
 const h=harness();await h.service.begin('3:doc','old');await h.service.begin('3:doc','new');
 await h.service.end('3:doc','old');assert.equal(h.stops(),0);
 await h.service.end('3:doc','new');assert.equal(h.stops(),1);
});
test('a new session waits for an in-flight model stop before claiming the service',async()=>{
 let finish,entered;const stopped=new Promise(resolve=>entered=resolve);
 const h=harness({stopHook:done=>{finish=done;entered();}});await h.service.begin('3:doc','old');
 const ending=h.service.end('3:doc','old');await stopped;
 let claimed=false;const begin=h.service.begin('4:doc','new').then(()=>claimed=true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(claimed,false);finish();await ending;await begin;
 assert.equal(claimed,true);assert.equal(h.session.localVoiceActiveSessions.length,1);assert.equal(h.session.localVoiceActiveSessions[0][1],'new');
});
test('closing while models load cancels startup and releases memory',async()=>{
 const h=harness({slowStart:true});await h.service.begin('3:doc','one');
 const starting=h.service.ensureStarted();const rejected=assert.rejects(starting,/取消/);
 await new Promise(resolve=>setImmediate(resolve));await h.service.end('3:doc','one');await rejected;
 assert.equal(h.stops(),1);assert.equal(h.session.localVoiceServiceState.state,'stopped');
});
test('automatic release failures are reported and recorded instead of claiming freed memory',async()=>{
 const h=harness({installed:false});await h.service.begin('3:doc','one');
 await assert.rejects(h.service.end('3:doc','one'),/首次安装/);
 assert.match(h.session.localVoiceServiceState.events.at(-1).message,/自动释放内存失败/);
 assert.notEqual(h.session.localVoiceServiceState.state,'stopped');
});
test('auto-stop preference accepts only booleans and untrusted callers cannot change it',async()=>{
 const h=harness();assert.equal((await h.send('localVoiceServiceSettings',undefined,{autoStop:'yes'})).ok,false);
 assert.equal((await h.send('localVoiceServicePreferences','https://untrusted.example',{autoStop:false})).ok,false);
 assert.equal((await h.send('localVoiceServicePreferences')).autoStop,true);
 assert.equal((await h.send('localVoiceServicePreferences',undefined,{autoStop:false})).autoStop,false);
});

test('native refusal to stop an unmanaged service is surfaced as a release failure',async()=>{
 const h=harness({stopFails:true});await h.service.begin('3:doc','one');
 await assert.rejects(h.service.end('3:doc','one'),/无法安全停止/);
 assert.equal(h.session.localVoiceServiceState.state,'error');
 assert.match(h.session.localVoiceServiceState.events.at(-1).message,/自动释放内存失败/);
});
