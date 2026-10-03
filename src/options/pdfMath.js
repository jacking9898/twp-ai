// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFMath = (() => {
  // Recognize display mathematics conservatively. Prose on the same baseline is
  // a boundary, so an inline variable never turns its whole paragraph into an image.
  function detect(items, styles, viewport) {
    if (!viewport) return [];
    const glyphs=items.filter(i=>i.str?.trim() && i.transform && Math.abs(i.transform[1])<.01);
    const weights=new Map();
    for(const item of glyphs){const h=Math.round(item.height||Math.abs(item.transform[0]));weights.set(h,(weights.get(h)||0)+item.str.length);}
    const size=[...weights].sort((a,b)=>b[1]-a[1])[0]?.[0]||12, rows=[];
    for(const item of [...glyphs].sort((a,b)=>b.transform[5]-a.transform[5])) {
      const y=item.transform[5];let row=rows.at(-1);
      if(!row || row.y-y>size*.75) {row={y,low:y,items:[],math:false,prose:false};rows.push(row);}
      row.low=Math.min(row.low,y);
      row.items.push(item);
      const font=styles[item.fontName]?.fontFamily||"";
      const mathFont=/CM(?:MI|SY|EX)|MS[AB]M|dsrom|math|symbol/i.test(font);
      row.math ||= mathFont || /[\u2200-\u22ff\u239b-\u23ad\uf8ee-\uf8fe]/.test(item.str);
      row.prose ||= !mathFont && /[a-zA-Z]{3}|[\u3400-\u9fff]{2}/.test(item.str);
    }
    // A raised TeX sum can occupy its own geometric row above inline prose.
    // It is not a display equation when body text brackets it on the next row.
    for(let i=0;i<rows.length-1;i++) {
      const row=rows[i],below=rows[i+1];
      const sum=row.items.find(item=>item.str==='P' && /CMEX/i.test(styles[item.fontName]?.fontFamily||''));
      if(sum && below.prose && row.y-below.y<size*1.2 &&
        below.items.some(item=>item.transform[4]+item.width<=sum.transform[4]) &&
        below.items.some(item=>item.transform[4]>sum.transform[4]+sum.width))row.prose=true;
    }
    const proseGlyphs=rows.filter(r=>r.prose).flatMap(r=>r.items);
    for(const row of rows)if(!row.prose && row.items.every(item=>
      (item.height||size)<size*.82 && proseGlyphs.some(base=>{
        const h=base.height||size,dx=item.transform[4]-(base.transform[4]+base.width),dy=Math.abs(item.transform[5]-base.transform[5]);
        return h>size*.9 && dx>=-h*.3 && dx<h*1.4 && dy>h*.1 && dy<h*1.2;
      })))row.prose=true;
    const groups=[];let group;
    for(let index=0;index<rows.length;index++) {
      const row=rows[index];
      if(row.prose) {group=null;continue;}
      if(!group || group.at(-1).low-row.y>size*1.9) {group=[];groups.push(group);}
      group.push(row);
    }
    return groups.filter(g=>g.some(r=>r.math)).map(g=>{
      const members=g.flatMap(r=>r.items),first=g[0],last=g.at(-1);
      let x=Math.min(...members.map(i=>i.transform[4]))-2;
      let right=Math.max(...members.map(i=>i.transform[4]+i.width))+2;
      let top=Math.max(...members.map(i=>i.transform[5]+(i.height||size)));
      let bottom=Math.min(...members.map(i=>i.transform[5]-(i.height||size)));
      // Extension-font bracket pieces can descend farther than their reported
      // font ascent. Include the full formula band, stopping before nearby prose.
      const before=rows[rows.indexOf(first)-1],after=rows[rows.indexOf(last)+1];
      if(before) top=Math.min(top,(before.y+first.y)/2);
      if(after) bottom=Math.max(bottom,(after.y+last.y)/2+size*.2);
      const corners=[[x,top],[right,top],[x,bottom],[right,bottom]].map(p=>viewport.convertToViewportPoint(...p));
      const left=Math.max(0,Math.min(...corners.map(p=>p[0]))),upper=Math.max(0,Math.min(...corners.map(p=>p[1])));
      const bounds={x:left/viewport.width,y:upper/viewport.height,width:(Math.min(viewport.width,Math.max(...corners.map(p=>p[0])))-left)/viewport.width,height:(Math.min(viewport.height,Math.max(...corners.map(p=>p[1])))-upper)/viewport.height};
      return {items:new Set(members),bounds,fontSize:size,top,bottom};
    }).filter(r=>r.bounds.width>0 && r.bounds.height>0);
  }

  // Only rasterize visible formula crops. Independent of the left pane's canvas:
  // right-only scrolling, zoom changes and source-page eviction remain safe.
  function renderer(root,getPDF) {
    const nodes=new Map();let running=false;
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const state=nodes.get(entry.target);if(!state)continue;state.visible=entry.isIntersecting;
        if(!state.visible){state.task?.cancel();state.ready=false;state.canvas.width=state.canvas.height=0;state.node.dataset.state='waiting';state.label.hidden=false;}}
      void pump();
    },{root,rootMargin:'500px 0px'});
    async function pump(){
      if(running)return;running=true;
      try {while(true){
        const state=[...nodes.values()].find(s=>s.visible&&!s.ready&&!s.failed);if(!state)break;
        const pdf=getPDF();if(!pdf)break;
        try {
          const page=await pdf.getPage(state.number);
          if(!nodes.has(state.node)||!state.visible||getPDF()!==pdf)continue;
          const base=page.getViewport({scale:1}),b=state.bounds;
          const scale=Math.min(3,Math.max(1.5,state.node.clientWidth/(b.width*base.width)*(devicePixelRatio||1)),Math.sqrt(2000000/(b.width*base.width*b.height*base.height)));
          const viewport=page.getViewport({scale});
          state.canvas.width=Math.ceil(b.width*viewport.width);state.canvas.height=Math.ceil(b.height*viewport.height);
          state.task=page.render({canvasContext:state.canvas.getContext('2d'),viewport,transform:[1,0,0,1,-b.x*viewport.width,-b.y*viewport.height],background:'white'});
          await state.task.promise;
          if(nodes.has(state.node)&&state.visible&&getPDF()===pdf){state.ready=true;state.node.dataset.state='ready';state.label.hidden=true;}
        }catch(error){if(error.name!=='RenderingCancelledException'&&nodes.has(state.node)){state.failed=true;state.label.textContent='公式显示失败，点击重试';state.label.hidden=false;}}
        finally{state.task=null;}
      }}finally{running=false;}
    }
    function node(record,block){
      const node=document.createElement('div');node.className='pdf-formula-image';node.dataset.state='waiting';
      node.style.aspectRatio=String(block.bounds.width*record.base.width/(block.bounds.height*record.base.height));
      const canvas=document.createElement('canvas');canvas.width=canvas.height=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`第 ${record.number} 页原始公式（保留图形）`);
      const label=document.createElement('button');label.className='pdf-formula-status';label.textContent='正在加载原始公式…';
      node.append(canvas,label);const state={node,canvas,label,number:record.number,bounds:block.bounds,ready:false,visible:false};
      label.onclick=()=>{state.failed=false;void pump();};nodes.set(node,state);observer.observe(node);return node;
    }
    function clear(container){for(const [node,state] of nodes)if(!container||container.contains(node)){observer.unobserve(node);state.task?.cancel();state.canvas.width=state.canvas.height=0;nodes.delete(node);}}
    function resize(){for(const state of nodes.values()){state.task?.cancel();state.ready=false;state.failed=false;state.node.dataset.state='waiting';state.label.textContent='正在加载原始公式…';state.label.hidden=false;}void pump();}
    return {node,clear,resize};
  }
  return {detect,renderer};
})();
if(typeof module!=="undefined")module.exports=twpPDFMath;
