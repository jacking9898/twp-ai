const {test}=require('node:test'),assert=require('node:assert/strict');
const math=require('../src/options/pdfInlineMath.js');
test('variable lists and sum operands remain single protected expressions',async()=>{
  const text='with λ₁, . . . , λₖ ∈ ℝ, use the vectors x₁, . . . , xₖ.';
  const r=await math.protect(text);
  assert.deepEqual(r.math.map(m=>m.text),['λ₁, . . . , λₖ ∈ ℝ','x₁, . . . , xₖ']);
  const translated=await math.translate([text],async ([s])=>{
    const tokens=s.match(/__TWP_MATH_\d+_[a-f0-9]+__/g);
    return [`向量 ${tokens[1]} 的系数满足 ${tokens[0]}。`];
  });
  assert.equal(translated[0],'向量 x₁, . . . , xₖ 的系数满足 λ₁, . . . , λₖ ∈ ℝ。');
  assert.deepEqual(math.parts('because 0 = ∑ᵏᵢ₌₁ λᵢxᵢ is zero.').filter(p=>p.math).map(p=>p.text),['0 = ∑ᵏᵢ₌₁ λᵢxᵢ']);
});
test('protect complete transpose/inverse expressions and recover them exactly',async()=>{
  const source='Use (A^{⊤}A)⁻¹A^{⊤} and x_{∗} in R^{n×n}.';
  const record=await math.protect(source);
  assert.equal(record.math.length,3);assert.ok(!record.masked.includes('⊤'));
  assert.equal(math.restore(record.masked,record),source);
  assert.equal(math.restore(record.masked.replace(record.math[0].token,''),record),null);
  assert.equal(math.restore(record.masked+record.math[0].token,record),null);
  const other=await math.protect(source.replace('⁻¹','⁻²'));assert.notEqual(record.masked,other.masked);
});
test('markers survive intact and changed/duplicated markers fall back to prose-only translation',async()=>{
  const source='Use A^{⊤}A to solve x_{∗}.';let calls=[];
  const result=await math.translate([source],async texts=>{calls.push(texts);return texts.map(s=>'译文 '+s);});
  assert.deepEqual(result,['译文 '+source]);assert.equal(calls.length,1);
  calls=[];
  const fallback=await math.translate([source],async texts=>{calls.push(texts);return texts.map(s=>s.includes('__TWP_MATH_')?'破坏的占位符':'译文 '+s);});
  assert.equal(calls.length,2);assert.deepEqual(calls[1],['Use','to solve']);
  assert.ok(fallback[0].includes('A^{⊤}A'));assert.ok(fallback[0].includes('x_{∗}'));assert.ok(!fallback[0].includes('破坏'));
});
test('formula-only segments make no request; cancellation stops recovery requests',async()=>{
  let calls=0;assert.deepEqual(await math.translate(['(A^{⊤}A)⁻¹A^{⊤}'],async()=>{calls++;}),['(A^{⊤}A)⁻¹A^{⊤}']);assert.equal(calls,0);
  let active=true;await assert.rejects(math.translate(['Use x_{∗}.'],async texts=>{calls++;active=false;return texts.map(()=>'?');},()=>active),/已取消/);assert.equal(calls,1);
});
test('plain text and punctuation are unchanged and dense math stays within batch limits',async()=>{
  assert.deepEqual(math.parts('Some ordinary prose.'),[{text:'Some ordinary prose.',math:false}]);
  const source='Use '+('x_{n} and '.repeat(120))+'finish.';
  const result=await math.translate([source],async texts=>{assert.ok(texts.join('').length<=8000);return texts;});
  assert.deepEqual(result,[source]);
});
