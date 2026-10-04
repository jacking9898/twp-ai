// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const prefix = 'regionImage:', ttl = 5 * 60000, pending = new Set();
  function trustedImagePage(sender) {return sender.id===chrome.runtime.id && sender.url?.split('?')[0]===chrome.runtime.getURL('options/sidepanel.html');}
  async function handle(request,sender) {
    if(request.action==='regionImageRead') {
      if(!trustedImagePage(sender) || !/^[a-f0-9-]{36}$/.test(request.token||''))throw new Error('无法读取圈选图片');
      const key=prefix+request.token, entry=(await chrome.storage.session.get(key))[key];await chrome.storage.session.remove(key);
      if(!entry || Date.now()-entry.time>ttl)throw new Error('圈选图片已过期，请重新圈选');
      return {image:entry};
    }
    if(sender.id!==chrome.runtime.id || !sender.tab || sender.frameId!==0 || !/^https?:/.test(sender.url||''))throw new Error('请从网页圈选文字');
    if(!chrome.storage.session)throw new Error('此浏览器暂不支持圈选图片，请手动保存截图到图片工作台');
    if(pending.has(sender.tab.id))throw new Error('正在截取，请稍候');
    const rect=request.rect, viewport=request.viewport;
    if(!rect || !viewport || [rect.x,rect.y,rect.width,rect.height,viewport.width,viewport.height].some(v=>typeof v!=='number'||!Number.isFinite(v)) || viewport.width<1 || viewport.height<1 || viewport.width>20000 || viewport.height>20000 || rect.x<0 || rect.y<0 || rect.width<12 || rect.height<12 || rect.x+rect.width>viewport.width+1 || rect.y+rect.height>viewport.height+1)throw new Error('圈选坐标无效，请重新圈选');
    pending.add(sender.tab.id);
    let bitmap;
    try {
      const active=async()=>{const [tab]=await chrome.tabs.query({active:true,windowId:sender.tab.windowId});if(tab?.id!==sender.tab.id || tab.url!==sender.tab.url)throw new Error('当前网页已切换，请返回原网页重新圈选');};
      await active();
      const screenshot=await chrome.tabs.captureVisibleTab(sender.tab.windowId,{format:'png'});await active();
      bitmap=await createImageBitmap(await (await fetch(screenshot)).blob());
      const scaleX=bitmap.width/viewport.width,scaleY=bitmap.height/viewport.height;
      const width=Math.round(rect.width*scaleX),height=Math.round(rect.height*scaleY),ratio=Math.min(1,2000/Math.max(width,height));
      const canvas=new OffscreenCanvas(Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio)));
      canvas.getContext('2d').drawImage(bitmap,rect.x*scaleX,rect.y*scaleY,width,height,0,0,canvas.width,canvas.height);
      const blob=await canvas.convertToBlob({type:'image/png'});
      if(blob.size>5*1024*1024)throw new Error('截图过大，请缩小圈选区域');
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      const all=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.keys(all).filter(k=>k.startsWith(prefix)));
      const token=crypto.randomUUID(),options={};
      for(const key of ['service','profileId','expertId','glossaryId','styleId','sourceLanguage','targetLanguage'])if(typeof request.options?.[key]==='string')options[key]=request.options[key].slice(0,200);
      await chrome.storage.session.set({[prefix+token]:{dataURL:'data:image/png;base64,'+btoa(binary),name:'网页圈选.png',title:String(sender.tab.title||'').slice(0,200),options,time:Date.now()}});
      try {await chrome.tabs.create({windowId:sender.tab.windowId,url:chrome.runtime.getURL('options/sidepanel.html')+'?workspace=1&view=image&capture='+token});}
      catch {await chrome.storage.session.remove(prefix+token);throw new Error('无法打开图片工作台，请重试');}
      return {};
    } finally {bitmap?.close();pending.delete(sender.tab.id);}
  }
  chrome.runtime.onMessage.addListener((request,sender,respond)=>{
    if(!['captureTranslationRegion','regionImageRead'].includes(request?.action))return;
    handle(request,sender).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message||'圈选截图失败，请重试'}));return true;
  });
})();
