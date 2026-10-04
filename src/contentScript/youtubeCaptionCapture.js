// SPDX-License-Identifier: MPL-2.0
// MAIN world, document_start. Observe only caption responses the player already
// requested. No extra requests, extension settings, or credentials are exposed.
(() => {
  const key='__yeduYouTubeCaptionsV1';
  if(window[key])return;
  let records=[];
  const current=()=>{const url=new URL(location.href);return url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];};
  function safe(value){try{const url=new URL(value,location.href);return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)&&url.pathname==='/api/timedtext'&&url.searchParams.get('v')===current()&&!url.searchParams.has('tlang')?url:null;}catch{return null;}}
  function save(value,text){
    const url=safe(value);
    if(!url||typeof text!=='string'||!text.trim()||text.length>3000000||!/^[\s]*[<{]/.test(text))return;
    const changed=!records.some(row=>row.url===url.href&&row.text===text&&Date.now()-row.time<1800000);
    records=records.filter(row=>row.id===current()&&row.url!==url.href&&Date.now()-row.time<1800000);
    records.push({id:current(),url:url.href,text,time:Date.now()});
    while(records.length>8||records.reduce((sum,row)=>sum+row.text.length,0)>4000000)records.shift();
    if(changed)document.dispatchEvent(new Event('yedu-youtube-captions-ready'));
  }
  Object.defineProperty(window,key,{value:{read(value){const url=safe(value);if(!url)return null;const names=['v','lang','kind','name'];return [...records].reverse().find(row=>row.id===current()&&Date.now()-row.time<1800000&&names.every(name=>new URL(row.url).searchParams.get(name)===url.searchParams.get(name)))?.text||null;}},configurable:true});
  const originalFetch=window.fetch;
  window.fetch=function(...args){
    const promise=Reflect.apply(originalFetch,this,args);
    try{const value=typeof args[0]==='string'||args[0] instanceof URL?String(args[0]):args[0]?.url;if(safe(value))void promise.then(response=>{if(response.ok&&safe(response.url||value))return response.clone().text().then(text=>save(response.url||value,text));}).catch(()=>{});}catch{}
    return promise;
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,urls=new WeakMap();
  XMLHttpRequest.prototype.open=function(...args){const result=Reflect.apply(open,this,args);urls.set(this,args[1]);return result;};
  XMLHttpRequest.prototype.send=function(...args){
    if(safe(urls.get(this)))this.addEventListener('load',()=>{try{if(this.status>=200&&this.status<300)save(this.responseURL||urls.get(this),this.responseType==='json'?JSON.stringify(this.response):this.responseText);}catch{}},{once:true});
    return Reflect.apply(send,this,args);
  };
  document.addEventListener('yt-navigate-start',()=>{records=[];});
  window.addEventListener('pagehide',()=>{records=[];});
})();
