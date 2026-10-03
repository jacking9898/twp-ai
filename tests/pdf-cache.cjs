const {test} = require("node:test");
const assert = require("node:assert/strict");
const {extractText} = require("../src/options/pdfDocument.js");
const {extract} = require("../src/options/pdfLayout.js");
test('raised TeX inline sums and overlapping limits remain in one prose block',()=>{
  const row=(str,x,y,width,size=10.5,fontName='normal',hasEOL=false)=>({str,fontName,transform:[size,0,0,size,x,y],height:size,width,hasEOL});
  const layout=extract([row('For all ',72,412,35),row('R',108,412,9,10.5,'ds'),row(', use 0 = ',118,412,65),
    row('P',185,420,11,10.5,'cmex'),row('k',196,417.5,4,7,'math',true),row('i',196,409,3,7,'math'),row('=1',199,409,10,7,'math'),
    row('0',211,412,6),row('x',217,412,7),row('i',224,410.3,3,7,'math'),row(' in the same sentence.',232,412,110,10.5,'normal',true)],
    {normal:{fontFamily:'Times'},cmex:{fontFamily:'CMEX10',ascent:.04},ds:{fontFamily:'dsrom10'},math:{fontFamily:'CMMI10'}},
    {width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.equal(layout.blocks.length,1);assert.equal(layout.blocks[0].kind,'paragraph');
  assert.equal(layout.blocks[0].text,'For all ℝ, use 0 = ∑ᵏᵢ₌₁ 0xᵢ in the same sentence.');
});
test('same-baseline small margin note stays separate and mixed emphasis stays in the body',()=>{
  const row=(str,x,y,width,size=12,fontName='normal',hasEOL=false)=>({str,fontName,transform:[size,0,0,size,x,y],height:size,width,hasEOL});
  const layout=extract([row('We use ',72,700,40),row('the pseudo-inverse',115,700,95,12,'italic'),row(' to solve this equation.',214,700,180),row('Moore-Penrose',406,700,60,9,'normal',true),row('pseudo-inverse',406,688,61,9,'normal'),row('and continue the body paragraph.',72,685,322,12,'normal',true)],{normal:{fontFamily:'Times'},italic:{fontFamily:'Times-Italic'}},{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.equal(layout.blocks.length,2);
  const body=layout.blocks[0],note=layout.blocks[1];
  assert.equal(body.kind,'paragraph');assert.equal(body.italic,false);
  assert.match(body.text,/continue the body/);assert.doesNotMatch(body.text,/Moore-Penrose/);
  assert.equal(note.text,'Moore-Penrose pseudo-inverse');
  assert.equal(note.anchorId,body.id);
  assert.ok(body.bounds.x+body.bounds.width<note.bounds.x);
});
test('headings preserve left, centered and right header alignment',()=>{
  const row=(str,x,y,width,fontName='normal')=>({str,fontName,transform:[12,0,0,12,x,y],height:12,width,hasEOL:true});
  const layout=extract([row('Chapter',72,725,110,'italic'),row('Right header',310,725,90,'italic'),row('Example 2.9',72,650,220,'bold'),row('The example body starts at the left.',72,630,328),row('Centered section',190,580,92,'bold'),row('Another ordinary body paragraph.',72,555,328)],{normal:{fontFamily:'Times'},italic:{fontFamily:'Times-Italic'},bold:{fontFamily:'Times-Bold'}},{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  const align=text=>layout.blocks.find(b=>b.text===text).align;
  assert.equal(align('Chapter'),'left');assert.equal(align('Right header'),'right');assert.equal(align('Example 2.9'),'left');assert.equal(align('Centered section'),'center');
});
test('light rectangle panels retain color and transformed coordinates, dark artwork is excluded',()=>{
  const {vectorBackgrounds}=require('../src/options/pdfLayout.js');
  const OPS={save:1,restore:2,transform:3,setFillRGBColor:4,constructPath:5,fill:6,eoFill:7,setFillGray:8};
  const rect=[6,[new Float32Array([0,0,0,1,300,0,1,300,200,1,0,200,4])],new Float32Array([0,0,300,200])];
  const panels=vectorBackgrounds({fnArray:[1,4,3,5,2,5],argsArray:[[],['#f5f5f5'],[1,0,0,1,50,400],rect,[],rect]},OPS,{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.deepEqual(panels,[{x:50/600,y:.25,width:.5,height:.25,color:'#f5f5f5'}]);
});
test('expanded regions push following text and formulas down without moving another column',()=>{
  const {arrange}=require('../src/options/pdfTypeset.js');
  const out=arrange([{x:100,y:100,width:300,originalHeight:40,height:100},{x:100,y:160,width:300,originalHeight:30,height:30},{x:10,y:160,width:60,originalHeight:20,height:20},{x:100,y:210,width:300,originalHeight:30,height:30}],800);
  assert.deepEqual(out.boxes.map(b=>b.top),[100,160,220,270]);assert.equal(out.height,860);
});
test('margin notes follow their body anchor when preceding text grows',()=>{
  const {arrange}=require('../src/options/pdfTypeset.js');
  const result=arrange([{id:0,x:100,y:30,width:250,originalHeight:20,height:70},{id:1,x:100,y:80,width:250,originalHeight:80,height:200},{id:2,anchorId:1,x:365,y:85,width:60,originalHeight:25,height:30}],800);
  const body=result.boxes.find(b=>b.id===1),note=result.boxes.find(b=>b.id===2);
  assert.equal(note.top-body.top,5);assert.equal(body.top,130);
});
test('inline superscripts and subscripts stay in the body paragraph rather than becoming formula crops',()=>{
  const row=(str,x,y,size=12,fontName='text',hasEOL=false)=>({str,fontName,transform:[size,0,0,size,x,y],height:size,width:str.length*size*.45,hasEOL});
  const layout=extract([row('We find inverse A',40,700),row('−',132,705,8,'math'),row('1',136,705,8),row(' and matrix I',143,700),row('n',211,698,8,'math'),row(' for the solution.',216,700,12,'text',true),row('This paragraph continues here.',40,685,12,'text',true)],{math:{fontFamily:'CMMI7'},text:{fontFamily:'Times'}},{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.equal(layout.blocks.length,1);assert.equal(layout.blocks[0].kind,'paragraph');assert.match(layout.text,/A⁻¹/);assert.match(layout.text,/Iₙ/);assert.match(layout.text,/continues here/);
});
test('display formulas preserve glyph groups while adjacent prose stays translatable',()=>{
  const row=(str,x,y,fontName='text')=>({str,fontName,transform:[12,0,0,12,x,y],height:12,width:str.length*6,hasEOL:true});
  const layout=extract([row('Text introducing the matrix.',40,740),row('\uf8ee',60,714,'math'),row('1 0',80,705),row('0 1',80,690),row('\uf8f0',60,689,'math'),row('Text after the matrix.',40,650)],{math:{fontFamily:'CMEX10'},text:{fontFamily:'Times'}},{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.deepEqual(layout.blocks.map(b=>b.kind),['paragraph','formula','paragraph']);assert.doesNotMatch(layout.text,/[\uf8ee-\uf8fe]/);assert.match(layout.text,/Text after/);
  const b=layout.blocks[1].bounds;assert.ok(b.height>.04);assert.ok(b.y>.08);
});
test('inline mathematics does not swallow surrounding prose or ordinary numbers',()=>{
  const row=(str,x,y,fontName='text')=>({str,fontName,transform:[12,0,0,12,x,y],height:12,width:str.length*5});
  const layout=extract([row('We solve ',40,700),row('x',90,700,'math'),row(' in this equation.',100,700),row('12',40,750)],{math:{fontFamily:'CMMI10'},text:{fontFamily:'Times'}},{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.equal(layout.blocks.some(b=>b.kind==='formula'),false);assert.match(layout.text,/We solve/);
});
test("body paragraphs resume across marginal notes without losing the note's coordinates",()=>{
  const row=(str,x,y,width,size=12)=>({str,transform:[size,0,0,size,x,y],height:size,width,hasEOL:true});
  const layout=extract([row('We mo-',150,650,330),row('A side note',45,645,65,9),row('stays here.',45,633,65,9),row('tivate the reader.',150,635,330)],{},
    {width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
  assert.equal(layout.blocks.length,2);
  assert.equal(layout.blocks[0].text,'We motivate the reader.');
  assert.equal(layout.blocks[1].text,'A side note stays here.');
  assert.ok(layout.blocks[1].bounds.x+layout.blocks[1].bounds.width<layout.blocks[0].bounds.x);
});
test("page regions reserve separate columns, header numbers and the next heading",()=>{
  const {regions}=require('../src/options/pdfTypeset.js');
  const blocks=[{id:0,text:'3',fontSize:12,bounds:{x:.85,y:.1,width:.02,height:.015}},
    {id:1,text:'Body',fontSize:12,bounds:{x:.25,y:.2,width:.55,height:.2}},
    {id:2,text:'Margin',fontSize:9,bounds:{x:.05,y:.25,width:.15,height:.12}},
    {id:3,text:'Heading',fontSize:14,bounds:{x:.35,y:.42,width:.3,height:.02}}];
  const result=regions(blocks,800);
  assert.equal(result[0].number,true);assert.equal(result[0].x,.85);
  assert.ok(result[1].y+result[1].height<result[3].y);
  assert.equal(result[2].x,.05);assert.equal(result[2].width,.15);
});
test("drawn bullet markers split lists while equal-indent continuation lines stay joined", () => {
  const {vectorMarkers}=require("../src/options/pdfLayout.js");
  const OPS={save:1,restore:2,transform:3,constructPath:4,fill:5,eoFill:6};
  const markers=vectorMarkers({fnArray:[1,3,4,2,1,3,4,2],argsArray:[[],[1,0,0,1,48,702],[5,[],new Float32Array([0,0,3,3])],[],[],[1,0,0,1,48,669],[5,[],new Float32Array([0,0,3,3])],[]]},OPS);
  const row=(text,y)=>({str:text,transform:[12,0,0,12,56,y],height:12,width:250,hasEOL:true});
  const result=extract([row("Bottom-up: Start with the foundations",700),row("and build progressively towards advanced ideas.",685),row("Top-down: Start with a problem",667),row("and learn the required concepts.",652)],{},null,markers);
  assert.deepEqual(result.blocks.map(b=>b.kind),['list','list']);
  assert.match(result.blocks[0].text,/advanced ideas/);assert.doesNotMatch(result.blocks[0].text,/Top-down/);
});
test("PDF layout keeps headings, list items, paragraph indents and column blocks addressable", () => {
  const row=(str,x,y,height=12)=>({str,transform:[height,0,0,height,x,y],height,width:str.length*5,hasEOL:true});
  const viewport={width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]};
  const layout=extract([
    row("Introduction",80,740,22),
    row("This paragraph explains the foundations of learning.",40,710),
    row("Its wrapped continuation stays in the same paragraph.",40,694),
    row("An indented new paragraph starts here.",56,678),
    row("This is its continuation at the main margin.",40,662),
    row("1. Programming languages",40,630),row("2. Data analysis tools",40,614),
    row("3. Mathematics and statistics",40,598),
    row("A separate note in the margin",360,598,10)
  ],{},viewport);
  assert.deepEqual(layout.blocks.map(block=>block.kind),["heading","paragraph","paragraph","list","list","list","paragraph"]);
  assert.match(layout.blocks[1].text,/learning\. Its wrapped/);
  assert.match(layout.blocks[2].text,/here\. This is its/);
  assert.equal(layout.blocks[4].marker,"2.");
  assert.equal(layout.blocks[0].bounds.x,80/600);
  assert.ok(layout.blocks[0].bounds.y>0 && layout.blocks[0].bounds.y<1);
  for (const block of layout.blocks) assert.equal(layout.text.slice(block.start,block.end),block.text);
});
test("PDF chunk rectangles honor rotated viewport coordinates", () => {
  const layout=extract([{str:"Rotated",transform:[12,0,0,12,40,700],height:12,width:70,hasEOL:true}],{},
    {width:800,height:600,convertToViewportPoint:(x,y)=>[y,x]});
  assert.equal(layout.blocks[0].bounds.y,40/600);
  assert.ok(Math.abs(layout.blocks[0].bounds.height-70/600)<1e-10);
});
test("PDF wrapped lines join while paragraph gaps and column changes stay separated", () => {
  const row = (str,x,y,hasEOL=true) => ({str,transform:[12,0,0,12,x,y],height:12,width:str.length*6,hasEOL});
  assert.equal(extractText([row("A wrapped",40,700),row("sentence.",40,685),row("New paragraph.",40,650),row("Other column.",320,650)]), "A wrapped sentence.\n\nNew paragraph.\n\nOther column.");
  assert.equal(extractText([row("中文",40,700),row("换行",40,685)]), "中文换行");
  assert.equal(extractText([{type:"beginMarkedContent"}]), "");
});
test("cache TTL is enforced at the boundary and when the user shortens retention", async () => {
  const {cachePolicy, isFresh, digest} = await import("../extension/translation-cache.js");
  const now = 100000000;
  assert.equal(cachePolicy().ttl, 7*24*3600000);
  assert.ok(isFresh({createdAt:now-3600000}, cachePolicy({ttlHours:24}), now));
  assert.ok(!isFresh({createdAt:now-3600000}, cachePolicy({ttlHours:1}), now));
  assert.ok(!isFresh({createdAt:now+1}, cachePolicy(), now));
  assert.ok(!isFresh({createdAt:now}, cachePolicy({enabled:false}), now));
  assert.match(await digest("private source"), /^[a-f0-9]{64}$/);
  assert.notEqual(await digest("source A"), await digest("source B"));
});
