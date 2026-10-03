// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFInlineMath = (() => {
  const supers='⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱʲᵏˣ', subs='₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢⱼₖₓ';
  const normal='0123456789+−=()nijkx';
  const scriptPattern=new RegExp(`([\\^_])\\{([^{}\\r\\n]+)\\}|([${supers}]+)|([${subs}]+)`,'gu');
  // Protect mathematical expressions and connected lists containing scripts.
  // Prose, URLs, arbitrary markup and standalone punctuation stay ordinary text.
  function parts(text) {
    const result=[];let end=0;
    const candidate=/[A-Za-z0-9\u0370-\u03ffℝℂℕℤℚ*∗⊤×·∈∥∞∂∇√∑∏∫≠≤≥()[\]{}^_+−=⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱʲᵏˣ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢⱼₖₓ-]+/gu;
    const atoms=[...text.matchAll(candidate)];
    const scripted=s=>[...s.matchAll(scriptPattern)].length>0;
    const mathematical=s=>scripted(s)||/^[A-Za-z]$/.test(s)||!/[^0-9\u0370-\u03ffℝℂℕℤℚ∑∏∫≠≤≥∈+−=×·()[\]]/u.test(s);
    for(let i=0;i<atoms.length;i++) {
      const first=atoms[i];if(!mathematical(first[0]))continue;
      let stop=first.index+first[0].length,hasScript=scripted(first[0]);
      // Keep variable lists, ellipses, domain relations and sum operands together.
      // Multi-letter prose words terminate the expression; punctuation at the end
      // of a sentence is never absorbed without another mathematical atom.
      while(i+1<atoms.length && mathematical(atoms[i+1][0]) && /^[ \t,.;…⋯]*$/.test(text.slice(stop,atoms[i+1].index))) {
        const next=atoms[++i];stop=next.index+next[0].length;hasScript ||= scripted(next[0]);
      }
      if(!hasScript)continue;
      if(first.index>end)result.push({text:text.slice(end,first.index),math:false});
      result.push({text:text.slice(first.index,stop),math:true});end=stop;
    }
    if(end<text.length)result.push({text:text.slice(end),math:false});
    return result;
  }
  async function protect(text) {
    const pieces=parts(text);let prefix='__TWP_MATH_';while(text.includes(prefix))prefix+='X';
    const math=[];let masked='';
    for(const piece of pieces) {
      if(!piece.math){masked+=piece.text;continue;}
      // Include formula content in persistent translation cache keys, even when
      // the surrounding sentence is identical for two different formulas.
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(piece.text));
      const hash=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
      const token=`${prefix}${math.length}_${hash}__`;
      math.push({token,text:piece.text});masked+=token;
    }
    return {pieces,math,masked};
  }
  function restore(value,record) {
    if(record.math.some(m=>value.split(m.token).length!==2))return null;
    for(const m of record.math)value=value.replace(m.token,()=>m.text);
    return value;
  }
  async function translate(texts,request,current=()=>true) {
    const records=await Promise.all(texts.map(protect)),result=Array(texts.length);
    const check=()=>{if(!current())throw new Error('已取消翻译');};
    async function batches(entries) {
      const values=[];
      for(let i=0;i<entries.length;){check();const batch=[];let size=0;
        while(i<entries.length && batch.length<20 && (size+entries[i].length<=8000 || !batch.length)){size+=entries[i].length;batch.push(entries[i++]);}
        const translated=await request(batch);check();values.push(...translated);
      }
      return values;
    }
    const pending=[];
    records.forEach((r,i)=>{
      if(r.math.length && !r.pieces.some(p=>!p.math && /[\p{L}\p{N}]/u.test(p.text)))result[i]=texts[i];
      else if(r.masked.length<=8000)pending.push(i);
    });
    const values=await batches(pending.map(i=>records[i].masked));
    pending.forEach((i,j)=>{result[i]=restore(values[j],records[i]);});
    // A service may alter/remove markers. Translate only the prose in that case;
    // never guess a damaged expression or expose an internal marker to the user.
    for(let i=0;i<records.length;i++)if(result[i]==null){
      const pieces=records[i].pieces,prose=pieces.filter(p=>!p.math && /[\p{L}\p{N}]/u.test(p.text));
      const translated=await batches(prose.map(p=>p.text.trim()));let index=0;
      result[i]=pieces.map(p=>{
        if(!prose.includes(p))return p.text;
        return p.text.match(/^\s*/)[0]+translated[index++].trim()+p.text.match(/\s*$/)[0];
      }).join('');
    }
    check();return result;
  }
  function append(container,text) {
    for(const piece of parts(text)) {
      if(!piece.math){container.append(document.createTextNode(piece.text));continue;}
      const span=document.createElement('span');span.className='pdf-inline-math';span.setAttribute('aria-label',piece.text);
      let end=0,limits=null;
      for(const match of piece.text.matchAll(scriptPattern)) {
        const plain=piece.text.slice(end,match.index);
        if(plain) {
          limits=null;
          if(/[∑∏∫]$/.test(plain)) {
            span.append(document.createTextNode(plain.slice(0,-1)));
            const operator=document.createElement('span');operator.className='pdf-inline-operator';
            operator.append(document.createTextNode(plain.slice(-1)));
            limits=document.createElement('span');limits.className='pdf-inline-limits';operator.append(limits);span.append(operator);
          } else span.append(document.createTextNode(plain));
        }
        const superScript=match[1]==='^'||!!match[3],node=document.createElement(superScript?'sup':'sub');
        node.textContent=match[2]??[...(match[3]||match[4])].map(c=>normal[(superScript?supers:subs).indexOf(c)]).join('');
        (limits||span).append(node);end=match.index+match[0].length;
      }
      span.append(document.createTextNode(piece.text.slice(end)));container.append(span);
    }
  }
  return {parts,protect,restore,translate,append};
})();
if(typeof module!=='undefined')module.exports=twpPDFInlineMath;
