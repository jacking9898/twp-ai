// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const base = 'http://127.0.0.1:8765';
  const pending = new Map();
  const recognitions = new Map();
  let token, connecting;
  twpLocalVoiceService.onStop(()=>{token=null;for(const controllers of pending.values())for(const controller of controllers)if(!controller.waitingForLease)controller.abort();});
  async function request(path, body, signal) {
    let response;
    try {
      response = await fetch(base + path, {method:'POST', credentials:'omit', redirect:'error', signal,
        headers:{'Content-Type':'application/json','X-Yedu-Voice':'1',...(token&&path!=='/session'?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    } catch (error) {if(error.name==='AbortError')throw error;const unavailable=new Error('本地模型服务未连接，请打开模型服务页面查看启动状态');unavailable.unavailable=true;throw unavailable;}
    const data = await response.json();
    if(!response.ok){if(response.status===401)token=null;throw new Error(typeof data.detail==='string'?data.detail:'本地服务请求失败');}
    return data;
  }
  async function connect(signal) {
    if(!connecting)connecting=(async()=>{
      let data;
      try{data=await request('/session',{},signal);}catch(error){
        if(!error.unavailable||signal?.aborted)throw error;
        await twpLocalVoiceService.ensureStarted();
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        data=await request('/session',{},signal);
      }
      token=data.token;return data;
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  async function recognizeInOrder(key,body,signal){
    const previous=recognitions.get(key)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>{
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      return request('/recognize-dub',body,signal);
    });
    recognitions.set(key,next);
    try{return await next;}finally{if(recognitions.get(key)===next)recognitions.delete(key);}
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['localVoiceConnect','localVoiceEnd','localVoiceDub','localVoiceRecognize','localVoiceCancel','localVoiceProfiles','localVoiceProfileCreate','localVoiceReferenceText','localVoiceOpenManager','localVoicePlaybackEvent'].includes(message.action))return;
    const tab=sender.tab?.id;
    // Content scripts only, supported origins including a YouTube SPA whose
    // original sender.url may still be the homepage. Never proxy arbitrary URLs.
    let allowed=false;try{const url=new URL(sender.url);allowed=url.protocol==='https:'&&['www.youtube.com','m.youtube.com','www.bilibili.com','m.bilibili.com'].includes(url.hostname);}catch{}
    if(!allowed||!Number.isInteger(tab)||sender.frameId!==0){reply({ok:false,error:'只能在兼容的视频页面使用本地配音'});return;}
    if(message.action==='localVoiceOpenManager'){chrome.tabs.create({url:twpLocalVoiceService.managerURL()}).then(()=>reply({ok:true}),error=>reply({ok:false,error:error.message}));return true;}
    if(message.action==='localVoicePlaybackEvent'){
      const row=message.row;
      if(row!==null&&(!row||typeof row.text!=='string'||row.text.length>2000||typeof row.translated!=='string'||row.translated.length>2000||!Number.isFinite(row.delay)||row.delay<0||row.delay>3600)){reply({ok:false,error:'无效配音状态'});return;}
      twpLocalVoiceService.record(row?{kind:'playing',tab,text:row.text,translated:row.translated,delay:row.delay,synchronized:row.synchronized===true}:{kind:'idle',tab,message:'当前片段结束或已暂停'}).then(()=>reply({ok:true}));return true;
    }
    const key=tab+':'+sender.documentId;
    if(message.voiceSessionId!==undefined&&(typeof message.voiceSessionId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(message.voiceSessionId))){reply({ok:false,error:'无效语音会话'});return;}
    if(message.action==='localVoiceEnd'){
      if(!message.voiceSessionId){reply({ok:false,error:'缺少语音会话'});return;}
      for(const controller of pending.get(key)||[])if(controller.voiceSessionId===message.voiceSessionId)controller.abort();
      twpLocalVoiceService.end(key,message.voiceSessionId).then(data=>reply({ok:true,...data}),error=>reply({ok:false,error:error.message}));return true;
    }
    if(message.action==='localVoiceCancel'){for(const controller of pending.get(key)||[])controller.abort();pending.delete(key);reply({ok:true});return;}
    if(message.action==='localVoiceDub'&&(typeof message.text!=='string'||!message.text.trim()||message.text.length>500||!['en','auto','zh','zh-CN','zh-TW'].includes(message.language))){reply({ok:false,error:'第一版支持英语 → 中文，或中文字幕直接配音'});return;}
    if(message.action==='localVoiceRecognize'&&(typeof message.audio!=='string'||message.audio.length>520000||
        (message.streamId!==undefined&&(typeof message.streamId!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(message.streamId)))||
        (message.autoVoice!==undefined&&typeof message.autoVoice!=='boolean'))){reply({ok:false,error:'无效音频分段或会话'});return;}
    if(message.voiceProfileId!==undefined&&(typeof message.voiceProfileId!=='string'||(message.voiceProfileId&&!/^[a-f0-9]{32}$/.test(message.voiceProfileId)))){reply({ok:false,error:'无效人物音色'});return;}
    if(['localVoiceProfileCreate','localVoiceReferenceText'].includes(message.action)&&(typeof message.audio!=='string'||message.audio.length>430000)){reply({ok:false,error:'参考原声需要 3–10 秒'});return;}
    if(message.action==='localVoiceProfileCreate'&&(typeof message.name!=='string'||!message.name.trim()||message.name.length>80||typeof message.text!=='string'||!message.text.trim()||message.text.length>500||!['en','zh'].includes(message.language))){reply({ok:false,error:'请填写人物名称，并核对原声文字和语言'});return;}
    if(message.translationMode!==undefined&&!['custom','local'].includes(message.translationMode)){reply({ok:false,error:'无效翻译方式'});return;}
    if(message.aiProfileId!==undefined&&(typeof message.aiProfileId!=='string'||message.aiProfileId.length>100)){reply({ok:false,error:'无效 AI 模型'});return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    controller.voiceSessionId=message.voiceSessionId;
    controller.waitingForLease=message.action==='localVoiceConnect'&&!!message.voiceSessionId;
    if(!pending.has(key))pending.set(key,new Set());pending.get(key).add(controller);
    void(async()=>{
      if(message.action==='localVoiceConnect'){
        if(message.voiceSessionId)await twpLocalVoiceService.begin(key,message.voiceSessionId);
        controller.waitingForLease=false;
        if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
        if(message.translationMode==='custom'){
          await twpConfig.onReady();const selected=message.aiProfileId||twpConfig.get('aiActiveProfile');
          if(!twpConfig.get('aiProfiles').some(profile=>profile.id===selected))throw new Error('请先在 AI 设置中配置并选择自定义翻译模型');
        }
        const data=await connect(controller.signal);
        if(message.translationMode==='custom'&&!data.capabilities?.includes('external-translation'))throw new Error('请更新并重启本地语音服务，以使用自定义 AI 翻译');
        return data;
      }
      // Reconnect each new operation after a service stop/restart.
      if(!token)await connect(controller.signal);
      if(message.action==='localVoiceProfiles')return request('/profiles/list',{},controller.signal);
      if(message.action==='localVoiceProfileCreate')return request('/profiles/create',{name:message.name,audio:message.audio,text:message.text,language:message.language},controller.signal);
      if(message.action==='localVoiceReferenceText')return request('/reference-text',{audio:message.audio},controller.signal);
      if(message.action==='localVoiceDub'&&message.translationMode==='custom'&&!message.language.startsWith('zh')){
        const translated=await globalThis.twpAIVoiceTranslate({text:message.text,profileId:message.aiProfileId,title:sender.tab?.title,privateContext:!!sender.tab?.incognito},controller.signal);
        return {...await request('/dub',{text:translated,language:'zh',voiceProfileId:message.voiceProfileId||''},controller.signal),text:message.text,translated,translationSource:'custom'};
      }
      if(message.action==='localVoiceRecognize'&&message.translationMode!=='local'){
        const started=performance.now();
        const source=await recognizeInOrder(key,{audio:message.audio,streamId:message.streamId||'',autoVoice:message.autoVoice===true,voiceProfileId:message.voiceProfileId||'',recognizeOnly:true},controller.signal);
        if(!source.text||source.preparingVoice)return {...source,translationSource:'custom'};
        if(!source.ticket)throw new Error('本地服务尚未支持自定义翻译，请更新并重启');
        const aiProfileId=message.aiProfileId||twpConfig.get('aiActiveProfile');
        const translationStarted=performance.now();
        let translated,translationTimedOut=false;
        const translationTimer=setTimeout(()=>{translationTimedOut=true;controller.abort();},12000);
        try{translated=await globalThis.twpAIVoiceTranslate({text:source.text,context:source.context,profileId:aiProfileId,title:sender.tab?.title,privateContext:!!sender.tab?.incognito},controller.signal);}catch(error){if(translationTimedOut)throw new Error('自定义 AI 翻译超过 12 秒，请选择响应更快的模型后重试');throw error;}finally{clearTimeout(translationTimer);}
        const translatedAt=performance.now();
        if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
        const speech=await request('/speak',{ticket:source.ticket,translated},controller.signal);
        return {...source,...speech,translated,translationSource:'custom',translationModel:twpConfig.get('aiProfiles').find(profile=>profile.id===aiProfileId)?.model,timings:{recognition:source.timings.recognition,translation:(translatedAt-translationStarted)/1000,speech:speech.timings.speech,total:(performance.now()-started)/1000}};
      }
      return request(message.action==='localVoiceDub'?'/dub':'/recognize-dub',message.action==='localVoiceDub'?{text:message.text,language:message.language,voiceProfileId:message.voiceProfileId||''}:{audio:message.audio,voiceProfileId:message.voiceProfileId||'',streamId:message.streamId||'',autoVoice:message.autoVoice===true},controller.signal);
    })().then(async data=>{
      if(message.action==='localVoiceRecognize'&&data.text)await twpLocalVoiceService.record({kind:'recognized',tab,text:data.text.slice(0,2000),translated:(data.translated||'').slice(0,2000),timings:data.timings,voiceSource:data.voiceSource,translationSource:data.translationSource,translationModel:data.translationModel});
      reply({ok:true,...data});
    }).catch(error=>reply({ok:false,error:error.name==='AbortError'?'本地配音已取消或超时':error.message})).finally(()=>{clearTimeout(timer);pending.get(key)?.delete(controller);if(!pending.get(key)?.size)pending.delete(key);});
    return true;
  });
  function releaseTab(tab){for(const[key,controllers]of pending)if(key.startsWith(tab+':')){for(const controller of controllers)controller.abort();pending.delete(key);}void twpLocalVoiceService.releaseTab(tab).catch(()=>{});}
  chrome.tabs.onRemoved.addListener(releaseTab);
  chrome.tabs.onUpdated?.addListener((tab,change)=>{if(change.status==='loading')releaseTab(tab);});
})();
