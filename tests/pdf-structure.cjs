const {test}=require('node:test'),assert=require('node:assert/strict');
const layout=require('../src/options/pdfLayout.js'),graphics=require('../src/options/pdfGraphics.js');
const viewport={width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]};
const item=(str,x,y,fontName='body',size=10)=>({str,transform:[size,0,0,size,x,y],width:str.length*size*.45,height:size,fontName,hasEOL:true});
const styles={body:{fontFamily:'Times'},math:{fontFamily:'CMMI10'}};
test('contents bind each title to its section and page, even when cells arrive in column order',()=>{
  const items=[item('Contents',80,760)];
  for(let i=1;i<=8;i++)items.push(item(`2.${i}`,80,700-i*15),item(`Topic number ${i}`,110,700-i*15));
  for(let i=1;i<=8;i++)items.push(item(String(10+i),500,700-i*15));
  const result=layout.extract(items,styles,viewport),entries=result.blocks.filter(b=>b.entry);
  assert.equal(result.structure,'contents');assert.equal(entries.length,8);
  assert.deepEqual(entries.map(b=>[b.entry.prefix.trim(),b.entry.title,b.entry.page]),Array.from({length:8},(_,i)=>[`2.${i+1}`,`Topic number ${i+1}`,String(i+11)]));
  assert(entries.every(b=>b.lineCount===1));
});
test('two-column index keeps every term and its page references independently',()=>{
  const items=[item('Index',270,760)];
  for(let col=0;col<2;col++)for(let i=0;i<12;i++)items.push(item(`term ${col}-${i}, ${100+i}, ${200+i}`,80+col*240,700-i*15));
  const result=layout.extract(items,styles,viewport);
  assert.equal(result.structure,'index');assert.equal(result.blocks.filter(b=>b.entry).length,24);
  assert.equal(result.blocks[1].entry.title,'term 0-0');assert.equal(result.blocks[1].entry.page,'100, 200');
});
test('ordinary-font exp and log remain inside a display equation',()=>{
  const items=[item('Some preceding prose.',80,730),item('p',150,680,'math'),item('exp',175,680),item('log',200,680),item('x',230,680,'math'),item('Some following prose.',80,640)];
  const result=layout.extract(items,styles,viewport);
  assert.equal(result.blocks.filter(b=>b.kind==='formula').length,1);
  assert(!result.blocks.some(b=>/exp|log/.test(b.text)));
});
test('graphics respect nested form clipping instead of preserving invisible full-page paths',()=>{
  const OPS={save:10,restore:11,transform:12,constructPath:91,fill:22,eoFill:23,fillStroke:24,endPath:28,clip:29,eoClip:30,paintFormXObjectBegin:74,paintFormXObjectEnd:75,beginGroup:76,endGroup:77,paintImageXObject:85};
  const ops={fnArray:[74,12,85,75],argsArray:[[null,[50,50,100,100]],[600,0,0,800,0,0],['image',600,800],[]]};
  const boxes=graphics.painted(ops,OPS,viewport);assert.deepEqual(boxes,[{x:50,y:700,right:100,bottom:750,image:true}]);
  const region=graphics.detect(ops,OPS,viewport,[],{});assert.equal(region.length,1);assert.equal(region[0].kind,'figure');
  assert(region[0].bounds.width<.1 && region[0].bounds.height<.1);
});

test('graph crop excludes the running page number and title just above it',()=>{
  const OPS={transform:12,paintImageXObject:85},ops={fnArray:[12,85],argsArray:[[400,0,0,350,80,370],['diagram',400,350]]};
  const header=item('4.1 Determinant and Trace',80,730),number=item('99',480,730),label=item('Eigenvalues',110,680);
  const pictures=graphics.detect(ops,OPS,viewport,[header,number,label],styles);
  assert.equal(pictures.length,1);assert(!pictures[0].items.has(header));assert(!pictures[0].items.has(number));assert(pictures[0].items.has(label));
  assert(pictures[0].bounds.y>.095);
});

test('marginal note one line above its paragraph follows the paragraph, while the figure caption follows the figure',()=>{
  const bodyText='Determinants are important concepts in the solution of linear equations.';
  const items=[item('4.1 Determinant and Trace',80,280),item('Figure 4.1 A mind map',430,620,'body',8),
    item('The determinant',430,234,'body',8),item('notation must not',430,224,'body',8),item('be confused.',430,214,'body',8),item(bodyText,80,220)];
  const picture={kind:'figure',items:new Set(),bounds:{x:.13,y:.2,width:.55,height:.35},fontSize:10};
  const result=layout.extract(items,styles,viewport,[],[picture]),note=result.blocks.find(b=>b.text.startsWith('The determinant')),
    body=result.blocks.find(b=>b.text===bodyText),figure=result.blocks.find(b=>b.kind==='figure'),caption=result.blocks.find(b=>b.text.startsWith('Figure 4.1'));
  assert.equal(note.anchorId,body.id);assert.equal(caption.anchorId,figure.id);
});
