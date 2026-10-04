// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto').webcrypto;
function fixture() {
  const data={},tabs=[],draws=[],calls=[];let listener,active={id:8,url:'https://example.test/image'},width=2400,height=1800;
  const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async key=>key===null?{...data}:{[key]:data[key]},set:async values=>Object.assign(data,values),remove:async keys=>{for(const key of [].concat(keys))delete data[key];}}},tabs:{query:async()=>[active],captureVisibleTab:async(windowId)=>{calls.push(windowId);return 'data:image/png;base64,cGl4ZWxz';},create:async values=>{tabs.push(values);return {id:9};}}};
  class Canvas{constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage:(...args)=>draws.push(args.slice(1))};}async convertToBlob(){return new Blob(['cropped']);}}
  vm.runInNewContext(fs.readFileSync('src/background/imageCapture.js','utf8'),{chrome,crypto,fetch:async()=>({blob:async()=>new Blob(['screenshot'])}),createImageBitmap:async()=>({width,height,close(){}}),OffscreenCanvas:Canvas,Blob,Uint8Array,btoa,Date,Set});
  const sender={id:'test',url:active.url,frameId:0,tab:{id:8,url:active.url,title:'Example image',windowId:3}},request={action:'captureTranslationRegion',rect:{x:100,y:200,width:300,height:400},viewport:{width:1200,height:900},options:{service:'openai',profileId:'demo',apiKey:'never-copy'}};
  const send=(input=request,from=sender)=>new Promise(resolve=>listener(input,from,resolve));
  return {data,tabs,draws,calls,sender,request,send,setActive:value=>active=value,setSize:(w,h)=>{width=w;height=h;}};
}
test('capture crops by actual screenshot dimensions and transfers only the crop in the same window',async()=>{
  const f=fixture();assert.equal((await f.send()).ok,true);assert.deepEqual(f.draws[0],[200,400,600,800,0,0,600,800]);assert.deepEqual(f.calls,[3]);assert.equal(f.tabs[0].windowId,3);
  const keys=Object.keys(f.data);assert.equal(keys.length,1);const image=f.data[keys[0]];assert.equal(image.options.apiKey,undefined);assert.equal(image.dataURL,'data:image/png;base64,Y3JvcHBlZA==');
  const token=keys[0].slice('regionImage:'.length),read={action:'regionImageRead',token},sender={id:'test',url:'chrome-extension://test/options/sidepanel.html?view=image'};
  assert.equal((await f.send(read,sender)).image.title,'Example image');assert.equal(Object.keys(f.data).length,0);assert.equal((await f.send(read,sender)).ok,false);
});
test('large crops shrink to 2000 pixels without changing aspect ratio',async()=>{
  const f=fixture();f.setSize(4800,3600);f.request.rect={x:0,y:0,width:1200,height:900};assert.equal((await f.send()).ok,true);assert.deepEqual(f.draws[0],[0,0,4800,3600,0,0,2000,1500]);
});
test('foreign pages, child frames, invalid geometry and inactive tabs never capture',async()=>{
  const f=fixture();for(const sender of [{...f.sender,id:'other'},{...f.sender,frameId:1},{...f.sender,url:'chrome://extensions'}])assert.equal((await f.send(f.request,sender)).ok,false);
  for(const rect of [{x:-1,y:0,width:30,height:30},{x:0,y:0,width:NaN,height:30},{x:1190,y:0,width:30,height:30}])assert.equal((await f.send({...f.request,rect})).ok,false);
  f.setActive({id:10,url:f.sender.url});assert.equal((await f.send()).ok,false);assert.equal(f.calls.length,0);
});
test('only the image workbench can consume a token and expired crops are removed',async()=>{
  const f=fixture();await f.send();const key=Object.keys(f.data)[0],token=key.slice('regionImage:'.length),read={action:'regionImageRead',token};
  assert.equal((await f.send(read)).ok,false);assert.ok(f.data[key]);f.data[key].time=Date.now()-6*60000;assert.equal((await f.send(read,{id:'test',url:'chrome-extension://test/options/sidepanel.html'})).ok,false);assert.equal(f.data[key],undefined);
});
