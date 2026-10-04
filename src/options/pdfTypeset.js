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
        height:Math.max(.001,bottom-b.y),number:/^(?:\d+|[ivxlcdm]+)$/i.test(block.text.trim()) && (b.y<.2 || b.y>.8)};
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
      if(['formula','figure','artwork'].includes(block.kind)) {node.style.height=block.bounds.height*100+'%';node.append(formulaNode(record,block));surface.append(node);if(block.kind==='artwork')surface.classList.add('pdf-layout-cover');continue;}
      node.style.fontWeight=block.bold?'700':'400';node.style.fontStyle=block.italic?'italic':'normal';
      node.style.textAlign=block.align || 'left';
      if(block.kind==='heading') {node.setAttribute('role','heading');node.setAttribute('aria-level','2');}
      if(region.number) node.dataset.pageNumber='true';
      if(block.entry) {
        const entry=block.entry,scale=record.scale||1;
        node.classList.add('pdf-entry-row');
        if(entry.prefix){const label=document.createElement('span');label.className='pdf-entry-label';label.textContent=entry.prefix.trim();label.style.width=entry.labelWidth*scale+'px';node.append(label);}
        const title=document.createElement('div');title.className='pdf-entry-title';
        if(bilingual){const original=document.createElement('div');original.className='original pdf-positioned-text';twpPDFInlineMath.append(original,entry.title);title.append(original);}
        const text=document.createElement('div');text.className='translation pdf-positioned-text';text.lang=target;
        twpPDFInlineMath.append(text,pair.translation.slice(entry.prefix.length,-entry.suffix.length));title.append(text);
        const page=document.createElement('span');page.className='pdf-entry-page';page.textContent=entry.page;page.style.minWidth=entry.pageWidth*scale+'px';
        node.append(title,page);surface.append(node);continue;
      }
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
    if(surface.classList.contains('pdf-layout-cover')) {
      fitCover(record,surface,pageWidth,pageHeight,size);
      return;
    }
    const boxes=[];
    for(const node of surface.children) {
      const block=record.layout.blocks[Number(node.dataset.chunk)],b=block.bounds;
      const x=b.x*(pageWidth-2*marginDelta)+marginDelta,width=Math.max(1,b.width*(pageWidth-2*marginDelta));
      node.style.left=x+'px';node.style.width=width+'px';
      node.style.top=b.y*pageHeight+'px';node.style.height='auto';
      let height=b.height*pageHeight*(width/(b.width*pageWidth));
      if(block.kind==='artwork'){node.style.height=height+'px';continue;}
      if(!['formula','figure'].includes(block.kind)) {
        node.style.fontSize=block.fontSize*record.scale*(size/14)+'px';node.style.lineHeight=String(1.18*spacing/1.8);
        for(const text of node.querySelectorAll('.pdf-positioned-text')){text.style.fontSize=block.fontSize*record.scale*(size/14)*(text.classList.contains('original')?.9:1)+'px';text.style.lineHeight=String(1.18*spacing/1.8);}
        if(block.entry){const label=node.querySelector('.pdf-entry-label');if(label)label.style.width=block.entry.labelWidth*record.scale*(size/14)+'px';node.querySelector('.pdf-entry-page').style.minWidth=block.entry.pageWidth*record.scale*(size/14)+'px';}
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
  // Cover lettering sits on artwork, so keep its original boxes and fit the
  // translated lettering inside them. Body pages still grow with their text.
  function fitCover(record,surface,pageWidth,pageHeight,size) {
    surface.style.height=pageHeight+'px';
    for(const node of surface.children) {
      const block=record.layout.blocks[Number(node.dataset.chunk)],b=block.bounds;
      Object.assign(node.style,{left:b.x*pageWidth+'px',top:b.y*pageHeight+'px',width:b.width*pageWidth+'px',height:b.height*pageHeight+'px'});
      if(['artwork','figure','formula'].includes(block.kind))continue;
      node.style.textAlign=b.x>.5?'right':block.align||'left';
      const texts=[...node.querySelectorAll('.pdf-positioned-text')];
      if(block.lineCount===1)for(const text of texts)text.style.whiteSpace='nowrap';
      const setSize=value=>{
        node.style.fontSize=value+'px';node.style.lineHeight='1.1';
        for(const text of texts){text.style.fontSize=value+'px';text.style.lineHeight='1.1';}
      };
      const fits=()=>texts.reduce((h,text)=>h+text.getBoundingClientRect().height,0)<=b.height*pageHeight+.5 && texts.every(text=>text.scrollWidth<=node.clientWidth+1);
      let low=.5*record.scale,high=Math.max(low,block.fontSize*record.scale*(size/14));
      setSize(high);
      if(!fits()) {
        for(let i=0;i<14;i++){const middle=(low+high)/2;setSize(middle);if(fits())low=middle;else high=middle;}
        setSize(low);
      }
    }
  }
  return {regions,render,fit,arrange};
})();
if(typeof module!=="undefined")module.exports=twpPDFTypeset;
