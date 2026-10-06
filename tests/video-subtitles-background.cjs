// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'), assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
function fixture({login=false,bad=false,expired=false,session={},wrongVideo=false,wrongPlayer=false}={}){
  let listener,removed,observe;const requests=[];
  const sandbox={URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:{randomUUID},Date:expired?class extends Date{static now(){return fixture.time||0;}}:Date,twpVideoSubtitles:require('../src/lib/videoSubtitles.js'),chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removed=fn;}}}},fetch:async(url,options)=>{
    requests.push({url,options});const path=new URL(url).pathname;
    let data;if(path==='/x/web-interface/view')data={code:0,data:{bvid:wrongVideo?'BVother':new URL(url).searchParams.get('bvid')||'BV123456',aid:123,title:'course',pages:[{page:1,cid:10},{page:2,cid:20}]}};
    else if(path==='/pgc/view/web/season')data={code:0,result:{title:'series',episodes:[{id:4,aid:124,cid:40,title:'4'}]}};
    else if(path==='/x/player/v2')data={code:0,data:{...(wrongPlayer?{bvid:'BVother'}:{}),need_login_subtitle:login,subtitle:{subtitles:login?[]:[{lan:'en',lan_doc:'English',subtitle_url:bad?'https://evil.example/bfs/subtitle/test.json':'//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/test.json'}]}}};
    else data={body:[{from:1,to:2,content:'Hello'}]};return {ok:true,text:async()=>JSON.stringify(data)};
  }};
  sandbox.chrome.storage={session:{get:async key=>({[key]:session[key]}),set:async values=>Object.assign(session,values),remove:async key=>{delete session[key];}}};
  sandbox.chrome.webRequest={onBeforeRequest:{addListener(fn){observe=fn;}}};
  vm.runInNewContext(fs.readFileSync('src/background/videoSubtitles.js','utf8'),sandbox);
  const sender={id:'test',frameId:0,url:'https://www.bilibili.com/video/BV123456?p=2',tab:{id:1}};
  const send=(request,identity=sender)=>new Promise(resolve=>listener(request,identity,resolve));return {send,sender,requests,removed,observe};
}
test('Bilibili selects the current part and reads only the issued safe subtitle URL',async()=>{
  const f=fixture(),list=await f.send({action:'videoSubtitlesList'});assert.equal(list.ok,true);assert.equal(list.videoKey,'bilibili:123:20');assert.equal(list.tracks.length,1);assert.match(f.requests[1].url,/cid=20/);
  const result=await f.send({action:'videoSubtitlesRead',token:list.tracks[0].token});assert.equal(result.cues[0].text,'Hello');assert.equal(f.requests[2].options.credentials,'omit');
  assert.equal((await f.send({action:'videoSubtitlesRead',token:list.tracks[0].token},{...f.sender,tab:{id:2}})).ok,false);
  assert.equal((await f.send({action:'videoSubtitlesRead',token:list.tracks[0].token,pageURL:'https://www.bilibili.com/video/BV123456?p=1'})).ok,false);
  f.removed(1);assert.equal((await f.send({action:'videoSubtitlesRead',token:list.tracks[0].token})).ok,false);
});

test('Bilibili rejects metadata and player lists belonging to another BV video',async()=>{
  for(const options of [{wrongVideo:true},{wrongPlayer:true}]){
    const f=fixture(options),result=await f.send({action:'videoSubtitlesList'});
    assert.equal(result.ok,false);assert.match(result.error,/其他视频|不匹配/);
    assert.equal(result.tracks,undefined);
  }
});
test('login restriction, episodes, trust checks and hostile CDN locations are explicit',async()=>{
  const login=await fixture({login:true}).send({action:'videoSubtitlesList'});assert.match(login.notice,/登录/);assert.equal(login.tracks.length,0);
  assert.equal((await fixture({bad:true}).send({action:'videoSubtitlesList'})).tracks.length,0);
  const f=fixture();assert.equal((await f.send({action:'videoSubtitlesList'},{...f.sender,url:'https://evil.example/video/BV123456'})).ok,false);assert.equal((await f.send({action:'videoSubtitlesList'},{...f.sender,frameId:1})).ok,false);
  const episode=await f.send({action:'videoSubtitlesList',pageURL:'https://www.bilibili.com/bangumi/play/ep4'});assert.equal(episode.videoKey,'bilibili:124:40');
});
test('expired tokens cannot download subtitles',async()=>{
  fixture.time=0;const f=fixture({expired:true}),list=await f.send({action:'videoSubtitlesList'});fixture.time=600001;assert.equal((await f.send({action:'videoSubtitlesRead',token:list.tracks[0].token})).ok,false);
});
test('page login fallback is bound to the requesting tab and still validates CDN locations',async()=>{
  const f=fixture({login:true}),list=await f.send({action:'videoSubtitlesList'});
  assert.equal(list.aid,123);assert.equal(list.cid,20);assert.ok(list.pageToken);
  assert.equal((await f.send({action:'videoSubtitlesRead',token:list.pageToken})).ok,false);
  const tracks=[{lan:'en',subtitle_url:'//aisubtitle.hdslb.com/bfs/subtitle/test.json'},{lan:'zh',subtitle_url:'https://evil.example/bfs/subtitle/test.json'}];
  assert.equal((await f.send({action:'videoSubtitlesPageList',token:list.pageToken,tracks},{...f.sender,tab:{id:2}})).ok,false);
  const restored=await f.send({action:'videoSubtitlesPageList',token:list.pageToken,tracks});assert.equal(restored.ok,true);assert.equal(restored.tracks.length,1);
  assert.equal((await f.send({action:'videoSubtitlesRead',token:restored.tracks[0].token})).cues[0].text,'Hello');
  assert.equal((await f.send({action:'videoSubtitlesPageList',token:list.pageToken,tracks})).ok,false);
});
test('nonempty lists still issue a web-session token and retain distinct same-language identities',async()=>{
  const f=fixture(),list=await f.send({action:'videoSubtitlesList'});assert.ok(list.pageToken);
  const tracks=[{id_str:'one',lan:'en',subtitle_url:'//aisubtitle.hdslb.com/bfs/subtitle/one.json'},{id_str:'two',lan:'en',subtitle_url:'//aisubtitle.hdslb.com/bfs/subtitle/two.json'}];
  const result=await f.send({action:'videoSubtitlesPageList',token:list.pageToken,tracks});
  assert.deepEqual(Array.from(result.tracks,track=>track.trackId),['one','two']);
});

test('downloaded tracks survive a page refresh and worker restart, scoped to tab and video',async()=>{
  const session={},first=fixture({session}),list=await first.send({action:'videoSubtitlesList'});
  await first.send({action:'videoSubtitlesRead',token:list.tracks[0].token});
  const restarted=fixture({session,login:true}),restored=await restarted.send({action:'videoSubtitlesList'});
  assert.equal(restored.tracks.length,1);assert.equal(restored.tracks[0].language,'en');assert.equal(restored.tracks[0].cues[0].text,'Hello');
  assert.match(restored.notice,/保留此前已读取/);
  assert.equal((await restarted.send({action:'videoSubtitlesList'},{...restarted.sender,tab:{id:2}})).tracks.length,0);
  assert.equal((await restarted.send({action:'videoSubtitlesList',pageURL:'https://www.bilibili.com/video/BV123456?p=1'})).tracks.length,0);
  restarted.removed(1);assert.equal(Object.keys(session).length,0);
});

test('player requests from another tab or another part cannot become source tracks',async()=>{
  const f=fixture(),url='https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=20';
  f.observe({tabId:2,frameId:0,url:url+'&w_rid=other-tab'});
  f.observe({tabId:1,frameId:0,url:'https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=10'});
  assert.deepEqual(Array.from((await f.send({action:'videoSubtitlesList'})).playerURLs),[]);
  f.observe({tabId:1,frameId:0,url});
  const list=await f.send({action:'videoSubtitlesList'});assert.deepEqual(Array.from(list.playerURLs),[url]);
  assert.equal((await f.send({action:'videoSubtitlesPageList',token:list.pageToken,aid:123,cid:10,tracks:[]})).ok,false);
});
