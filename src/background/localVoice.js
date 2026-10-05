// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const base = 'http://127.0.0.1:8765';
  const pending = new Map();
  let token, connecting;
  async function request(path, body, signal) {
    let response;
    try {
      response = await fetch(base + path, {method:'POST', credentials:'omit', redirect:'error', signal,
        headers:{'Content-Type':'application/json','X-Yedu-Voice':'1',...(token&&path!=='/session'?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    } catch (error) {if(error.name==='AbortError')throw error;throw new Error('本地配音服务未启动或仍在加载，请运行 local-voice/start.ps1，显示 Ready 后重试连接。');}
    const data = await response.json();
    if(!response.ok){if(response.status===401)token=null;throw new Error(typeof data.detail==='string'?data.detail:'本地服务请求失败');}
    return data;
  }
  async function connect(signal) {
    if(!connecting)connecting=request('/session',{},signal).then(data=>{token=data.token;return data;}).finally(()=>{connecting=null;});
    return connecting;
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['localVoiceConnect','localVoiceDub','localVoiceRecognize','localVoiceCancel'].includes(message.action))return;
    const tab=sender.tab?.id;
    // Content scripts only, supported origins including a YouTube SPA whose
    // original sender.url may still be the homepage. Never proxy arbitrary URLs.
    let allowed=false;try{const url=new URL(sender.url);allowed=url.protocol==='https:'&&['www.youtube.com','m.youtube.com','www.bilibili.com','m.bilibili.com'].includes(url.hostname);}catch{}
    if(!allowed||!Number.isInteger(tab)||sender.frameId!==0){reply({ok:false,error:'只能在兼容的视频页面使用本地配音'});return;}
    const key=tab+':'+sender.documentId;
    if(message.action==='localVoiceCancel'){for(const controller of pending.get(key)||[])controller.abort();pending.delete(key);reply({ok:true});return;}
    if(message.action==='localVoiceDub'&&(typeof message.text!=='string'||!message.text.trim()||message.text.length>500||!['en','auto','zh','zh-CN','zh-TW'].includes(message.language))){reply({ok:false,error:'第一版支持英语 → 中文，或中文字幕直接配音'});return;}
    if(message.action==='localVoiceRecognize'&&(typeof message.audio!=='string'||message.audio.length>520000)){reply({ok:false,error:'音频分段过大'});return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    if(!pending.has(key))pending.set(key,new Set());pending.get(key).add(controller);
    void(async()=>{
      if(message.action==='localVoiceConnect')return connect(controller.signal);
      if(!token)await connect(controller.signal);
      return request(message.action==='localVoiceDub'?'/dub':'/recognize-dub',message.action==='localVoiceDub'?{text:message.text,language:message.language}:{audio:message.audio},controller.signal);
    })().then(data=>reply({ok:true,...data})).catch(error=>reply({ok:false,error:error.name==='AbortError'?'本地配音已取消或超时':error.message})).finally(()=>{clearTimeout(timer);pending.get(key)?.delete(controller);if(!pending.get(key)?.size)pending.delete(key);});
    return true;
  });
  chrome.tabs.onRemoved.addListener(tab=>{for(const[key,controllers]of pending)if(key.startsWith(tab+':')){for(const controller of controllers)controller.abort();pending.delete(key);}});
})();
