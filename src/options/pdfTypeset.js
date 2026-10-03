// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFTypeset = (() => {
  function regions(blocks, pageHeight) {
    return blocks.filter(b=>b.bounds).map(block=>{
      const b=block.bounds, line=block.fontSize*1.25/pageHeight;
      let bottom=Math.min(1,b.y+Math.max(b.height,line)+line*2);
      for(const other of blocks) {
        const r=other.bounds;
        if(!r || other===block || r.y<=b.y+.001) continue;
        if(Math.min(b.x+b.width,r.x+r.width)>Math.max(b.x,r.x)+.002) bottom=Math.min(bottom,r.y-1/pageHeight);
      }
      return {block,x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.min(1-b.x,b.width),
        height:Math.max(.001,bottom-b.y),number:/^\d+$/.test(block.text.trim()) && (b.y<.2 || b.y>.8)};
    });
  }
  function render(record, pairs, target, bilingual, formulaNode) {
    const surface=document.createElement('div');surface.className='pdf-layout-surface';
    surface.style.width=record.slot.style.width;surface.style.height=record.slot.style.height;
    const values=new Map(pairs.map(p=>[p.chunkId,p]));
    for(const region of regions(record.layout.blocks,record.base.height)) {
      const {block}=region,pair=values.get(block.id);if(!pair) continue;
      const node=document.createElement('div');node.className='pdf-chunk pdf-positioned-chunk';node.dataset.chunk=block.id;node.dataset.kind=block.kind;
      Object.assign(node.style,{left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'});
      if(block.kind==='formula') {node.style.height=block.bounds.height*100+'%';node.append(formulaNode(record,block));surface.append(node);continue;}
      node.style.fontWeight=block.bold?'700':'400';node.style.fontStyle=block.italic?'italic':'normal';
      node.style.textAlign=block.align || 'left';
      if(block.kind==='heading') {node.setAttribute('role','heading');node.setAttribute('aria-level','2');}
      if(region.number) node.dataset.pageNumber='true';
      if(bilingual && !region.number){const original=document.createElement('div');original.className='original pdf-positioned-text';twpPDFInlineMath.append(original,pair.text);node.append(original);}
      const text=document.createElement('div');text.className='translation pdf-positioned-text';text.lang=target;
      let value=region.number?block.text:pair.translation;
      if(block.kind==='list' && block.marker && !/^\s*(?:[•●▪■◦‣]|\d+[.)])/.test(value)) value=block.marker+' '+value;
      twpPDFInlineMath.append(text,value);
      node.append(text);
      surface.append(node);
    }
    return surface;
  }
  // Retain horizontal coordinates, but let longer translations push later
  // regions down in the same column. Side notes in other columns stay independent.
  function arrange(boxes, pageHeight) {
    const ordered=[...boxes].sort((a,b)=>a.y-b.y || a.x-b.x),resolved=new Map(),visiting=new Set();
    const byId=new Map(boxes.filter(b=>b.id!==undefined).map(b=>[b.id,b]));
    function place(box) {
      if(resolved.has(box))return resolved.get(box);
      if(visiting.has(box))return {...box,top:box.y};
      visiting.add(box);
      let top=box.y;
      const anchor=byId.get(box.anchorId);
      if(anchor && anchor!==box)top=Math.max(top,place(anchor).top+box.y-anchor.y);
      for(const other of ordered) {
        if(box.y<=other.y+.5 || Math.min(box.x+box.width,other.x+other.width)<=Math.max(box.x,other.x)+.5)continue;
        const previous=place(other);
        top=Math.max(top,previous.top+previous.height+Math.max(0,box.y-previous.y-previous.originalHeight+(box.gapDelta||0)));
      }
      const result={...box,top};resolved.set(box,result);visiting.delete(box);return result;
    }
    const placed=ordered.map(place);
    const originalBottom=Math.max(0,...boxes.map(b=>b.y+b.originalHeight));
    const bottom=Math.max(0,...placed.map(b=>b.top+b.height));
    return {boxes:placed,height:Math.max(pageHeight,bottom+Math.max(0,pageHeight-originalBottom))};
  }
  function fit(record) {
    const surface=record.translation.querySelector('.pdf-layout-surface');if(!surface) return;
    const pageWidth=record.base.width*record.scale,pageHeight=record.base.height*record.scale;
    surface.style.width=record.slot.style.width;
    const settings=getComputedStyle(record.translation),size=Number.parseFloat(settings.getPropertyValue('--reader-size'))||14;
    const spacing=Number.parseFloat(settings.getPropertyValue('--reader-line'))||1.8;
    const marginDelta=((Number.parseFloat(settings.getPropertyValue('--reader-margin'))||28)-28)*record.scale;
    const gapValue=Number.parseFloat(settings.getPropertyValue('--reader-gap'));
    const gapDelta=(Number.isFinite(gapValue)?gapValue-14:0)*record.scale;
    const boxes=[];
    for(const node of surface.children) {
      const block=record.layout.blocks[Number(node.dataset.chunk)],b=block.bounds;
      const x=b.x*(pageWidth-2*marginDelta)+marginDelta,width=Math.max(1,b.width*(pageWidth-2*marginDelta));
      node.style.left=x+'px';node.style.width=width+'px';
      node.style.top=b.y*pageHeight+'px';node.style.height='auto';
      let height=b.height*pageHeight*(width/(b.width*pageWidth));
      if(block.kind!=='formula') {
        for(const text of node.children){text.style.fontSize=block.fontSize*record.scale*(size/14)*(text.classList.contains('original')?.9:1)+'px';text.style.lineHeight=String(1.18*spacing/1.8);}
        height=Math.max(b.height*pageHeight,node.scrollHeight+1);
      }
      boxes.push({node,id:block.id,anchorId:block.anchorId,x,y:b.y*pageHeight,width,originalHeight:b.height*pageHeight,height,gapDelta});
    }
    const layout=arrange(boxes,pageHeight);
    for(const box of layout.boxes){box.node.style.top=box.top+'px';box.node.style.height=box.height+'px';}
    const panels=(record.layout.backgrounds || []).map(b=>{
      const x=b.x*(pageWidth-2*marginDelta)+marginDelta,width=b.width*(pageWidth-2*marginDelta),y=b.y*pageHeight,height=b.height*pageHeight;
      const inside=layout.boxes.filter(box=>box.x+box.width/2>=x && box.x+box.width/2<=x+width && box.y>=y-2 && box.y+box.originalHeight<=y+height+2);
      if(!inside.length)return null;
      const first=inside.reduce((a,c)=>a.y<c.y?a:c),top=y+first.top-first.y;
      const bottom=Math.max(...inside.map(box=>box.top+box.height));
      const padding=Math.max(0,y+height-Math.max(...inside.map(box=>box.y+box.originalHeight)));
      return {color:b.color,x,y:top,width,height:Math.max(1,bottom+padding-top)};
    }).filter(Boolean).reverse();
    surface.style.backgroundImage=panels.map(b=>`linear-gradient(${b.color},${b.color})`).join(',');
    surface.style.backgroundPosition=panels.map(b=>`${b.x}px ${b.y}px`).join(',');
    surface.style.backgroundSize=panels.map(b=>`${b.width}px ${b.height}px`).join(',');
    surface.style.backgroundRepeat='no-repeat';
    surface.style.height=Math.ceil(layout.height)+'px';
  }
  return {regions,render,fit,arrange};
})();
if(typeof module!=="undefined")module.exports=twpPDFTypeset;
