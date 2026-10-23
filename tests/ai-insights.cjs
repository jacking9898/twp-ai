const {test}=require('node:test'),assert=require('node:assert/strict');
test('term matching respects word boundaries and literal punctuation',async()=>{const {containsTerm}=await import('../extension/ai-insights.js');assert.equal(containsTerm('said something','AI'),false);assert.equal(containsTerm('AI uses C++ and attention.','ai'),true);assert.equal(containsTerm('AI uses C++ and attention.','C++'),true);assert.equal(containsTerm('a.b','a.b'),true);assert.equal(containsTerm('axb','a.b'),false);});
test('reported usage keeps unknown values and counts token subsets only once',async()=>{const {usageOf,addUsage}=await import('../extension/ai-insights.js');const usage=usageOf({inputTokens:25,outputTokens:15,totalTokens:40,inputTokenDetails:{cacheReadTokens:5},outputTokenDetails:{reasoningTokens:3}});let sum=addUsage({}, {usage,cached:false});assert.equal(sum.total,40);assert.equal(sum.reasoning,3);assert.equal(sum.cachedInput,5);sum=addUsage(sum,{usage:usageOf(),cached:true});assert.equal(sum.total,40);assert.equal(sum.unknown,0);sum=addUsage(sum,{usage:usageOf(),cached:false});assert.equal(sum.unknown,1);assert.equal(sum.total,40);assert.equal(usageOf({inputTokens:-1,outputTokens:NaN}).total,null);assert.equal(usageOf({inputTokens:8,outputTokens:2}).total,10);});
test('scoped glossary rejects duplicates, malformed and oversized data',async()=>{const {validateTerms}=await import('../extension/ai-insights.js');assert.deepEqual(validateTerms([[' Attention ',' 注意力 ']]),[['Attention','注意力']]);assert.throws(()=>validateTerms([['AI','一'],['ai','二']]));assert.throws(()=>validateTerms([['AI',null]]));assert.throws(()=>validateTerms(Array.from({length:201},(_,i)=>['term'+i,'词'])));});

test('usage origin labels features and hostname without retaining URL queries',async()=>{const {usageOrigin}=await import('../extension/ai-insights.js');assert.equal(usageOrigin({requestSource:'video'},{url:'https://www.youtube.com/watch?v=private&token=secret'}),'视频字幕 · www.youtube.com');assert.equal(usageOrigin({requestSource:'hover-123'},{url:'https://example.com/private'}),'悬停翻译 · example.com');assert.equal(usageOrigin({requestSource:'quick-selection'},{url:'https://example.com/'}),'划词翻译 · example.com');assert.equal(usageOrigin({requestSource:'image'},{url:'chrome-extension://id/options/sidepanel.html'}),'图片翻译');});

test('webpage preference identity ignores known tracking and article anchors but retains content and hash routes',async()=>{
 const {preferenceURL}=await import('../extension/ai-insights.js');
 assert.equal(preferenceURL('https://developers.google.com/lesson?_gl=one&utm_source=search#overview'),'https://developers.google.com/lesson');
 assert.equal(preferenceURL('https://developers.google.com/lesson?_gl=two&utm_medium=mail#exercise'),'https://developers.google.com/lesson');
 assert.equal(preferenceURL('https://example.com/article?q=machine%20learning&_gl=one'),preferenceURL('https://example.com/article?q=machine+learning'));
 for(const url of ['https://example.com/article?page=2','https://example.com/article?v=video123','https://example.com/article?lang=en','https://example.com/article?from=lesson2','https://example.com/article?a=1&a=2','https://example.com/article#/lesson/2','https://example.com/article#!/lesson/2'])assert.notEqual(preferenceURL(url),'https://example.com/article');
 assert.notEqual(preferenceURL('https://example.com/article?a=1'),preferenceURL('https://example.com/article?a=2'));
});
test('browser-supplied top SPA URL selects current preferences without importing the previous article',async()=>{
 const {preferenceSourcesOf,sourceOf}=await import('../extension/ai-insights.js');
 const previous=global.chrome;global.chrome={runtime:{getURL:path=>'chrome-extension://fixture/'+path}};try{
 const sender={url:'https://example.com/article?_gl=one',frameId:0,tab:{id:1,url:'https://example.com/article?_gl=two#part'}};
 const same=await preferenceSourcesOf({},sender);assert.equal(same.legacySource,await sourceOf({},sender));
 const next=await preferenceSourcesOf({documentKey:'web:untrusted'}, {...sender,tab:{id:1,url:'https://example.com/other'}});assert.notEqual(next.source,same.source);assert.equal(next.legacySource,'');
 const changedOrigin=await preferenceSourcesOf({}, {...sender,tab:{id:1,url:'https://different.example/other'}});assert.equal(changedOrigin.source,same.source);
 const frame=await preferenceSourcesOf({}, {...sender,frameId:1,tab:{id:1,url:'https://example.com/other'}});assert.equal(frame.source,same.source);
 }finally{global.chrome=previous;}
});
