// SPDX-License-Identifier: MPL-2.0
const {test}=require('node:test'), assert=require('node:assert/strict');
const subtitles=require('../src/lib/videoSubtitles.js');
test('normalize preserves overlapping cues, sorts timings and removes exact duplicates',()=>{
  const cues=subtitles.normalize([{from:2,to:4,content:'second'},{start:0,end:3,text:'<b>First &amp; second</b>'},{start:0,end:3,text:'<b>First &amp; second</b>'}]);
  assert.equal(cues.length,2);assert.equal(cues[0].text,'First & second');assert.equal(subtitles.active(cues,2.5).length,2);assert.equal(subtitles.active(cues,4).length,0);
});
test('prefetch only selects untranslated cues inside the next minute, including active cues',()=>{
  const cues=subtitles.normalize([{start:0,end:5,text:'active'},{start:10,end:12,text:'cached'},{start:59,end:63,text:'ahead'},{start:100,end:102,text:'later'}]);
  const cache=new Map([[cues[1].id,'译文']]);assert.deepEqual(subtitles.upcoming(cues,3,cache).map(c=>c.text),['active','ahead']);assert.deepEqual(subtitles.upcoming(cues,100,cache).map(c=>c.text),['later']);
});
test('SRT and VTT imports and partial export retain time axis and literal text safely',()=>{
  const srt='1\r\n00:00:01,050 --> 00:00:03,200\r\nHello\r\nworld\r\n\r\n2\r\n00:01:20,000 --> 00:01:22,000\r\nNext\r\n';
  const cues=subtitles.parseFile(srt), translated=new Map([[cues[0].id,'你好\n世界']]);
  assert.equal(cues[0].start,1.05);assert.equal(subtitles.exportSRT(cues,translated),'1\n00:00:01,050 --> 00:00:03,200\nHello\nworld\n你好\n世界\n');
  assert.equal(subtitles.parseFile('WEBVTT\n\nNOTE info\nmetadata\n\ncue-id\n00:01.000 --> 00:03.000 align:start\n<b>Hello</b>')[0].text,'Hello');
});
test('invalid, empty and oversized subtitle payloads fail explicitly',()=>{
  for(const rows of [[{start:-1,end:2,text:'bad'}],[{start:2,end:1,text:'bad'}],[{start:NaN,end:2,text:'bad'}],[{start:1,end:2,text:'a'.repeat(3001)}]])assert.throws(()=>subtitles.normalize(rows));
  assert.throws(()=>subtitles.parseFile('plain text'));assert.throws(()=>subtitles.parseFile('WEBVTT'));assert.throws(()=>subtitles.parseFile('x'.repeat(200001)));
});
test('subtitle markup is removed without eating mathematical comparisons or injecting HTML',()=>{
  assert.equal(subtitles.clean('If x < 2 and y > 3, <i>compare</i> &amp; check<br>again.'),'If x < 2 and y > 3, compare & check\nagain.');
  assert.equal(subtitles.clean('<c.yellow>Text</c> <00:01.000>next'),'Text next');
  assert.equal(subtitles.clean('<img src=x onerror=alert(1)>'),'<img src=x onerror=alert(1)>');
});
test('source selection prefers an original language, and same-language bilingual text is not duplicated',()=>{
  const sources=[{language:'ai-zh',key:'chinese'},{language:'en',key:'english'}];
  assert.equal(subtitles.preferredSource(sources,'zh-CN'),1);
  assert.equal(subtitles.preferredSource(sources,'zh-CN','chinese'),0);
  assert.equal(subtitles.preferredSource([{language:'zh-TW'}],'zh-CN'),0);
  assert.equal(subtitles.displayText({text:'我喜欢鱼。'},'我喜欢鱼。'),'我喜欢鱼。');
  assert.equal(subtitles.displayText({text:'原文'},'译文','translated'),'译文');
  assert.equal(subtitles.displayText({text:'Hello'},undefined,'translated'),'');
  assert.equal(subtitles.preferredSource([{kind:'native',language:'en',key:'injected'},{kind:'bilibili',language:'en',key:'site'}],'zh-CN'),1);
  assert.equal(subtitles.preferredSource([{kind:'bilibili',language:'en',key:'first'},{kind:'bilibili',language:'en',key:'second'}],'zh-CN','second'),1);
  assert.equal(subtitles.preferredSource([{kind:'youtube',language:'ja'},{kind:'youtube',language:'en-US',automatic:true}],'zh-CN'),1);
  assert.equal(subtitles.preferredSource([{kind:'youtube',language:'en',automatic:true},{kind:'youtube',language:'en-GB'}],'zh-CN'),1);
  assert.equal(subtitles.preferredSource([{language:'zh'},{language:'ja'}],'zh-CN'),1);
  assert.equal(subtitles.preferredSource([{language:'zh'}],'zh-CN'),0);
});

test('player request URLs match the exact video/part and fixed Bilibili endpoints',()=>{
  const signed='https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=20&w_rid=existing',byBV='https://api.bilibili.com/x/player/wbi/v2?bvid=BV123&cid=20';
  assert.deepEqual(subtitles.playerAPIURLs([signed,byBV,signed,
    'https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=10',
    'https://api.bilibili.com/x/player/v2?aid=124&cid=20',
    'https://api.bilibili.com/x/player/wbi/v2?bvid=BVother&cid=20',
    'https://evil.example/x/player/v2?aid=123&cid=20',
    'https://api.bilibili.com/other?aid=123&cid=20'],{aid:123,cid:20,bvid:'BV123'}),[signed,byBV]);
});

 test('remembered enable state identifies a video, part or episode, ignoring tracking and playback time',()=>{
  const key=subtitles.preferenceKey;
  assert.equal(key('https://www.youtube.com/watch?v=abcdefghijk&t=12'),key('https://www.youtube.com/watch?v=abcdefghijk&list=playlist'));
  assert.notEqual(key('https://www.youtube.com/watch?v=abcdefghijk'),key('https://www.youtube.com/watch?v=lmnopqrstuv'));
  assert.equal(key('https://www.bilibili.com/video/BV1dQbu68ENM/?spm_id_from=tracking'),key('https://www.bilibili.com/video/BV1dQbu68ENM/?p=1'));
  assert.notEqual(key('https://www.bilibili.com/video/BV1dQbu68ENM/?p=1'),key('https://www.bilibili.com/video/BV1dQbu68ENM/?p=2'));
  assert.notEqual(key('https://www.bilibili.com/bangumi/play/ep123'),key('https://www.bilibili.com/bangumi/play/ep456'));
  assert.equal(key('https://www.bilibili.com/'),'');assert.equal(key('https://example.com/video'),'');
 });
