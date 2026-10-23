// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpLocalVoiceService = (() => {
  const host = 'com.yedu.local_voice', key = 'localVoiceServiceState';
  const stopListeners=new Set();
  let starting, startingGeneration=0, generation=0, snapshot = {state:'unknown',message:'尚未检测',events:[]}, writes = Promise.resolve();
  const restored = chrome.storage.session?.get(key).then(data=>{if(data[key])snapshot=data[key];}).catch(()=>{});
  async function record(event) {
    await restored;
    snapshot = {...snapshot,events:[...snapshot.events,{...event,at:Date.now()}].slice(-80)};
    const data = snapshot;
    writes = writes.catch(()=>{}).then(()=>chrome.storage.session?.set({[key]:data}));
    await writes;
  }
  async function update(value) {
    await restored;
    const changed = value.state!==snapshot.state||value.message!==snapshot.message;
    snapshot = {...snapshot,...value};
    if(changed)await record({kind:'service',message:value.message});
    return snapshot;
  }
  function native(action) {
    return new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>reject(new Error('本机连接组件响应超时，请重新检测')),10000);
      if(!chrome.runtime.sendNativeMessage){clearTimeout(timer);reject(new Error('当前浏览器不支持本机连接组件'));return;}
      chrome.runtime.sendNativeMessage(host,{action},result=>{
        clearTimeout(timer);
        if(chrome.runtime.lastError){const error=new Error('尚未安装或未授权本机连接组件，请打开模型服务页面完成首次安装');error.bridgeUnavailable=true;reject(error);return;}
        if(!result?.ok){reject(new Error(result?.message||'本机连接失败'));return;}
        resolve(result);
      });
    });
  }
  async function status() {
    try {const result=await native('status');return update({...result,bridge:true});}
    catch(error){
      // Manually started services remain usable even without the helper.
      try {
        const response=await fetch('http://127.0.0.1:8765/status',{method:'POST',credentials:'omit',redirect:'error',
          headers:{'Content-Type':'application/json','X-Yedu-Voice':'1'},body:'{}',signal:AbortSignal.timeout(2000)});
        const data=await response.json();
        if(response.ok&&data.model&&data.state==='ready')return update({state:'ready',message:'模型已就绪；自动启动组件尚未连接',model:data.model,bridge:false});
      } catch {}
      return update({state:'unavailable',message:error.message,bridge:false});
    }
  }
  async function start() {
    if(starting&&startingGeneration===generation)return starting;
    const current=++generation;
    startingGeneration=current;
    starting=(async()=>{
      await update({state:'starting',message:'正在连接本机启动组件…'});
      try {
        let result=await native('start');await update({...result,bridge:true});
        const deadline=Date.now()+180000;
        while(result.state==='starting'&&Date.now()<deadline){
          await new Promise(resolve=>setTimeout(resolve,1000));
          if(current!==generation)throw new Error('已取消模型启动');
          result=await native('status');await update({...result,bridge:true});
        }
        if(result.state!=='ready')throw new Error(result.state==='starting'?'模型仍在加载，请在模型服务页面查看进度':result.message);
        return result;
      } catch(error){if(current===generation)await update({state:'error',message:error.message,...(error.bridgeUnavailable?{bridge:false}:{})});throw error;}
      finally{if(startingGeneration===current)starting=null;}
    })();
    return starting;
  }
  async function ensureStarted() {
    const settings=await chrome.storage.local.get('localVoiceAutoStart');
    if(settings.localVoiceAutoStart===false)throw new Error('模型服务未运行；请在模型服务页面点击启动，或开启按需自动启动');
    return start();
  }
  async function clear() {
    await restored;snapshot={...snapshot,events:[]};await writes.catch(()=>{});await chrome.storage.session?.set({[key]:snapshot});
    return {ok:true};
  }
  const managerURL=()=>chrome.runtime.getURL('options/voice-service.html');
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['localVoiceServiceStatus','localVoiceServiceStart','localVoiceServiceStop','localVoiceServiceClear','localVoiceServiceSettings','localVoiceAITranslate','localVoiceAIInfo'].includes(message?.action))return;
    if(sender.id!==chrome.runtime.id||sender.url?.split('?')[0]!==managerURL()){
      reply({ok:false,error:'请从模型服务页面操作'});return;
    }
    void(async()=>{
      if(message.action==='localVoiceAIInfo'){await twpConfig.onReady();return {profiles:twpConfig.get('aiProfiles').map(({id,name,model})=>({id,name,model})),active:twpConfig.get('aiActiveProfile')};}
      if(message.action==='localVoiceAITranslate'){
        if(typeof message.text!=='string'||!message.text.trim()||message.text.length>2000||message.context!==undefined&&typeof message.context!=='string'||message.profileId!==undefined&&(typeof message.profileId!=='string'||message.profileId.length>100))throw new Error('无效翻译测试');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{return {translated:await globalThis.twpAIVoiceTranslate({text:message.text,context:(message.context||'').slice(-600),profileId:message.profileId},controller.signal)};}finally{clearTimeout(timer);}
      }
      if(message.action==='localVoiceServiceSettings'){
        if(typeof message.autoStart!=='boolean')throw new Error('无效自动启动设置');
        await chrome.storage.local.set({localVoiceAutoStart:message.autoStart});return {ok:true};
      }
      if(message.action==='localVoiceServiceClear')return clear();
      if(message.action==='localVoiceServiceStop'){
        generation++;
        const result=await native('stop');
        if(result.state==='stopped'){
          for(const listener of stopListeners)listener();
          for(const tab of await chrome.tabs.query({}))void chrome.tabs.sendMessage(tab.id,{action:'localVoiceServiceStopped'},{frameId:0}).catch(()=>{});
        }
        return update({...result,bridge:true});
      }
      if(message.action==='localVoiceServiceStart')return start();
      return status();
    })().then(data=>reply({ok:true,...data,events:undefined}),error=>reply({ok:false,error:error.message}));
    return true;
  });
  return {ensureStarted,record,status,managerURL,onStop:listener=>stopListeners.add(listener)};
})();
