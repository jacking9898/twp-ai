// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const youtube=require('../src/lib/youtubeSubtitles.js'),subtitles=require('../src/lib/videoSubtitles.js');
const id='abcdefghijk',base=`https://www.youtube.com/api/timedtext?v=${id}&lang=en`,response={videoDetails:{videoId:id},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:base,languageCode:'en',name:{simpleText:'English'},vssId:'.en'},{baseUrl:base+'&kind=asr',languageCode:'en',name:{runs:[{text:'English'}]},kind:'asr',vssId:'a.en'}]}}};
test('YouTube IDs, signed URLs and original tracks are restricted to the current video',()=>{
  for(const path of ['/watch?v='+id,'/shorts/'+id,'/embed/'+id])assert.equal(youtube.videoId('https://www.youtube.com'+path),id);
  assert.equal(youtube.videoId('https://youtube.com.evil/watch?v='+id),null);
  assert.equal(youtube.trackURL(base+'&fmt=srv3',id),base+'&fmt=srv3');
  assert.equal(youtube.trackURL(base,id),base);
  for(const url of [base.replace(id,'other______'),base+'&tlang=zh',base.replace('www.youtube.com','evil.example'),base.replace('/api/timedtext','/redirect')])assert.throws(()=>youtube.trackURL(url,id));
  const tracks=youtube.tracks(response,id,[base+'&pot=existing-session']);assert.equal(tracks.length,2);assert.equal(new URL(tracks[0].url).searchParams.get('pot'),'existing-session');assert.equal(tracks[1].automatic,true);assert.notEqual(tracks[0].trackId,tracks[1].trackId);
  assert.throws(()=>youtube.tracks(response,'other______'));
});
test('JSON3 joins segments and appended ASR words, clips rolling windows and preserves timing',()=>{
  const rows=youtube.parseJSON3({events:[{tStartMs:1000,dDurationMs:3000,wWinId:1,segs:[{utf8:'Hello '},{utf8:'world'}]},{tStartMs:2000,dDurationMs:2000,wWinId:1,aAppend:1,segs:[{utf8:' again'}]},{tStartMs:3500,dDurationMs:2500,wWinId:1,segs:[{utf8:'Next line'}]},{tStartMs:7000,dDurationMs:2000,segs:[{utf8:'\n'}]}]});
  assert.deepEqual(subtitles.normalize(rows).map(({start,end,text})=>({start,end,text})),[{start:1,end:3.5,text:'Hello world again'},{start:3.5,end:6,text:'Next line'}]);
  assert.throws(()=>youtube.parseJSON3({}));assert.throws(()=>youtube.parseJSON3({events:[{tStartMs:'bad',segs:[{utf8:'bad'}]}]}));
});
function fixture(){
  let listener,removed;const injected=[];
  const sandbox={URL,Date,crypto:{randomUUID},twpVideoSubtitles:subtitles,twpYouTubeSubtitles:youtube,chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removed=fn;}}},scripting:{async executeScript(request){injected.push(request);return [{frameId:0,result:request.args[0]==='list'?{videoId:id,title:'Lesson',response,observed:[]}:{videoId:id,text:JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Hello'}]}]})}}];}}}};
  vm.runInNewContext(fs.readFileSync('src/background/youtubeSubtitles.js','utf8'),sandbox);
  const sender={id:'test',frameId:0,documentId:'current-document',tab:{id:1},url:'https://www.youtube.com/watch?v='+id};
  return {sender,injected,removed,send:(request,identity=sender)=>new Promise(resolve=>listener(request,identity,resolve))};
}
test('YouTube bridge is bound to tab, document, video and issued track token',async()=>{
  const f=fixture(),list=await f.send({action:'youtubeSubtitlesList'});assert.equal(list.ok,true);assert.equal(list.tracks.length,2);assert.equal(list.tracks[0].url,undefined);
  assert.equal(f.injected[0].world,'MAIN');assert.equal(f.injected[0].target.tabId,1);assert.deepEqual(Array.from(f.injected[0].target.documentIds),['current-document']);assert.equal(f.injected[0].args[2],null);
  assert.equal((await f.send({action:'youtubeSubtitlesRead',token:list.tracks[0].token},{...f.sender,tab:{id:2}})).ok,false);
  assert.equal((await f.send({action:'youtubeSubtitlesRead',token:list.tracks[0].token,pageURL:'https://www.youtube.com/watch?v=other______'})).ok,false);
  assert.equal((await f.send({action:'youtubeSubtitlesList'},{...f.sender,url:'https://evil.example/watch?v='+id})).ok,false);
  assert.equal((await f.send({action:'youtubeSubtitlesList'},{...f.sender,frameId:1})).ok,false);
  const read=await f.send({action:'youtubeSubtitlesRead',token:list.tracks[0].token});assert.equal(read.cues[0].text,'Hello');
  f.removed(1);assert.equal((await f.send({action:'youtubeSubtitlesRead',token:list.tracks[0].token})).ok,false);
});

test('passive caption capture preserves fetch and excludes other videos, translations and expired data',async()=>{
  const events={},location={href:'https://www.youtube.com/watch?v='+id};
  class XHR {open(){} send(){}}
  const pending=Promise.resolve(new Response('{"events":[]}'));
  const window={fetch:()=>pending,addEventListener:(name,fn)=>events[name]=fn};
  const sandbox={window,location,URL,Date,Event,XMLHttpRequest:XHR,document:{dispatchEvent:()=>{},addEventListener:(name,fn)=>events[name]=fn}};
  vm.runInNewContext(fs.readFileSync('src/contentScript/youtubeCaptionCapture.js','utf8'),sandbox);
  const cache=window.__yeduYouTubeCaptionsV1;
  assert.equal(window.fetch(base),pending);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(cache.read(base),'{"events":[]}');
  assert.equal(cache.read(base+'&kind=asr'),null);
  assert.equal(cache.read(base+'&tlang=zh'),null);
  location.href='https://www.youtube.com/watch?v=lmnopqrstuv';
  assert.equal(cache.read(base),null);
  location.href='https://www.youtube.com/watch?v='+id;
  events['yt-navigate-start']();assert.equal(cache.read(base),null);
  window.fetch(base+'&tlang=zh');window.fetch(base.replace(id,'lmnopqrstuv'));
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(cache.read(base),null);
  window.fetch(base);await new Promise(resolve=>setTimeout(resolve,20));
  sandbox.Date={now:()=>Date.now()+1800001};assert.equal(cache.read(base),null);
});
