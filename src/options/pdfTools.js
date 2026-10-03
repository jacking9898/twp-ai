// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFTools = (() => {
  function create({reader,status}) {
    const $=id=>document.getElementById(id),root=$("pdf-reader"),svgNS="http://www.w3.org/2000/svg";
    let mode="navigate",notes=[],history=[],active=null,metadata=null,searchVersion=0,frame;
    const snapshot=()=>{history.push(JSON.stringify(notes));if(history.length>50)history.shift();};
    const svg=(tag,attributes)=>{const node=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
    function refresh() {
      for(const record of reader.records()) for(const [side,host] of [["source",record.slot],["translation",record.translation]]) {
        let layer=host.querySelector(':scope > .pdf-notes');
        const pageNotes=notes.filter(n=>n.page===record.number && n.side===side);
        if(!pageNotes.length){layer?.remove();continue;}
        if(!layer){layer=svg("svg",{class:"pdf-notes",viewBox:"0 0 1000 1000",preserveAspectRatio:"none","aria-label":"阅读批注"});host.append(layer);}
        layer.replaceChildren();
        for(const note of pageNotes) {
          const node=note.type==="draw"?svg("polyline",{points:note.points.map(p=>p.join(',')).join(' '),fill:"none",stroke:note.color,"stroke-width":note.width,"stroke-linecap":"round","stroke-linejoin":"round","vector-effect":"non-scaling-stroke"}):svg("text",{x:note.x,y:note.y,fill:note.color,"font-size":23});
          if(note.type==="text") for(const [i,line] of note.text.split('\n').entries()) {const span=svg("tspan",{x:note.x,dy:i?28:0});span.textContent=line;node.append(span);}
          node.dataset.note=note.id;layer.append(node);
        }
      }
      $("pdf-undo").disabled=!history.length;$("pdf-save-notes").disabled=!notes.length;
    }
    function requestRefresh(){cancelAnimationFrame(frame);frame=requestAnimationFrame(refresh);}
    document.addEventListener("twp-pdf-render",requestRefresh);
    document.addEventListener("twp-pdf-close",()=>{notes=[];history=[];active=null;metadata=null;searchVersion++;$("pdf-search-results").replaceChildren();requestRefresh();});
    document.addEventListener("twp-pdf-open",event=>{metadata=event.detail;requestRefresh();});
    function setMode(value) {
      mode=value;root.dataset.tool=value;active=null;reader.setTextSelection(value==="select");
      $("pdf-draw-tool").setAttribute("aria-pressed",String(value==="draw"));
      for(const button of document.querySelectorAll('[data-pdf-mode]'))button.setAttribute('aria-pressed',String(button.dataset.pdfMode===value));
      $("pdf-edit-bar").hidden=false;$("pdf-text-tool").setAttribute('aria-expanded','true');
      if($("pdf-setup-dialog").open)$("pdf-setup-dialog").close();
      const messages={navigate:"点击原文文字块定位译文",select:"拖动选择原文，按 Ctrl+C 复制",text:"点击原文或译文空白位置添加文字批注",draw:"按住鼠标或触控笔自由绘制",erase:"点击批注删除",hand:"按住鼠标拖动任意一侧阅读"};status(messages[value]);
    }
    for(const button of document.querySelectorAll('[data-pdf-mode]'))button.onclick=()=>setMode(button.dataset.pdfMode);
    $("pdf-text-tool").onclick=()=>setMode("select");$("pdf-draw-tool").onclick=()=>setMode(mode==="draw"?"navigate":"draw");
    $("pdf-edit-close").onclick=()=>{setMode("navigate");$("pdf-edit-bar").hidden=true;$("pdf-text-tool").setAttribute('aria-expanded','false');};
    function location(event) {
      const host=event.target.closest('.pdf-canvas-slot,.pdf-translation-page');if(!host)return null;
      const rect=host.getBoundingClientRect(),side=host.classList.contains('pdf-canvas-slot')?'source':'translation';
      const page=Number(host.closest('[data-page]').dataset.page);
      return {host,side,page,x:Math.max(0,Math.min(1000,(event.clientX-rect.left)/rect.width*1000)),y:Math.max(0,Math.min(1000,(event.clientY-rect.top)/rect.height*1000))};
    }
    root.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      if(mode==='hand') {const pane=event.target.closest('#pdf-scroll,#pdf-translation-scroll');if(!pane)return;active={hand:true,pane,x:event.clientX,y:event.clientY,left:pane.scrollLeft,top:pane.scrollTop};root.setPointerCapture(event.pointerId);event.preventDefault();return;}
      if(!['draw','text','erase'].includes(mode))return;
      const point=location(event);if(!point)return;event.preventDefault();event.stopPropagation();
      if(mode==='erase'){const id=event.target.closest('[data-note]')?.dataset.note;if(id){snapshot();notes=notes.filter(n=>n.id!==id);refresh();}return;}
      if(notes.length>=200){status('批注已达到 200 条，请先下载保存或删除部分批注',true);return;}
      const note={id:crypto.randomUUID(),page:point.page,side:point.side,type:mode,color:$("pdf-ink-color").value,width:Number($("pdf-ink-width").value),x:point.x,y:point.y};
      if(mode==='text'){active=note;$("pdf-note-text").value='';$("pdf-note-dialog").showModal();$("pdf-note-text").focus();return;}
      snapshot();note.points=[[point.x,point.y]];notes.push(note);active={note,host:point.host};root.setPointerCapture(event.pointerId);refresh();
    },true);
    root.addEventListener('pointermove',event=>{
      if(active?.hand){active.pane.scrollLeft=active.left-(event.clientX-active.x);active.pane.scrollTop=active.top-(event.clientY-active.y);return;}
      if(!active?.note || active.note.points.length>=4000)return;
      const r=active.host.getBoundingClientRect();active.note.points.push([Math.max(0,Math.min(1000,(event.clientX-r.left)/r.width*1000)),Math.max(0,Math.min(1000,(event.clientY-r.top)/r.height*1000))]);requestRefresh();
    });
    function end(event){if(active?.note || active?.hand){active=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);}}
    root.addEventListener('pointerup',end);root.addEventListener('pointercancel',end);
    $("pdf-note-dialog").addEventListener('close',()=>{if($("pdf-note-dialog").returnValue==='save' && active && $("pdf-note-text").value.trim()){snapshot();notes.push({...active,text:$("pdf-note-text").value.trim()});refresh();}active=null;});
    $("pdf-undo").onclick=()=>{if(history.length){notes=JSON.parse(history.pop());refresh();}};
    $("pdf-save-notes").onclick=()=>{if(!metadata)return;const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,fingerprint:metadata.fingerprint,notes},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=metadata.fileName.replace(/\.pdf$/i,'')+'.notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    $("pdf-load-notes").onchange=async()=>{
      try{const file=$("pdf-load-notes").files[0];if(!file)return;if(file.size>2000000)throw new Error('批注文件过大');const data=JSON.parse(await file.text());
        if(!metadata || data.version!==1 || data.fingerprint!==metadata.fingerprint || !Array.isArray(data.notes) || data.notes.length>200)throw new Error('批注与当前 PDF 不匹配');
        const coord=n=>Number.isFinite(n)&&n>=0&&n<=1000;
        for(const n of data.notes)if(!Number.isInteger(n.page)||n.page<1||n.page>metadata.pages||!['source','translation'].includes(n.side)||!/^#[0-9a-f]{6}$/i.test(n.color)||!coord(n.x)||!coord(n.y)||!(n.width>=1&&n.width<=10)||!(n.type==='text'?typeof n.text==='string'&&n.text.length<=1000:n.type==='draw'&&Array.isArray(n.points)&&n.points.length<=4000&&n.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(coord))))throw new Error('批注文件格式无效');
        snapshot();notes=data.notes.map(n=>({...n,id:crypto.randomUUID()}));refresh();status('已导入批注');
      }catch(error){status(error.message || '无法导入批注',true);}finally{$("pdf-load-notes").value='';}
    };
    $("pdf-hide-top").onclick=()=>{const hidden=document.body.classList.toggle('pdf-top-hidden');$("pdf-hide-top").textContent=hidden?'显示顶部':'隐藏顶部';$("pdf-hide-top").setAttribute('aria-expanded',String(!hidden));};
    for(const [button,dialog] of [['pdf-style-tool','pdf-style-dialog'],['pdf-search-tool','pdf-search-dialog'],['pdf-setup-tool','pdf-setup-dialog']])$(button).onclick=()=>$(dialog).showModal();
    for(const button of document.querySelectorAll('[data-close-dialog]'))button.onclick=()=>$(button.dataset.closeDialog).close();
    const defaults={font:'sans-serif',size:14,line:1.8,gap:14,margin:28,indent:false,compact:false};
    function styleValues(){return {font:$("pdf-style-font").value,size:Number($("pdf-style-size").value),line:Number($("pdf-style-line").value),gap:Number($("pdf-style-gap").value),margin:Number($("pdf-style-margin").value),indent:twpPDFToggle.get($("pdf-style-indent")),compact:twpPDFToggle.get($("pdf-style-compact"))};}
    function applyStyle(save=true){const v=styleValues();for(const [key,value] of Object.entries({font:v.font,size:v.size+'px',line:v.line,gap:(v.compact?4:v.gap)+'px',margin:v.margin+'px',indent:v.indent?'2em':'0'}))$("pdf-translations").style.setProperty('--reader-'+key,value);$("pdf-style-size-value").value=v.size+' px';if(save)twpConfig.set('pdfReaderStyle',v);reader.fitTranslations();}
    function loadStyle(value){for(const [key,initial] of Object.entries(defaults)){const field=$('pdf-style-'+key);if(typeof initial==='boolean')twpPDFToggle.set(field,!!value[key]);else field.value=value[key]??initial;}applyStyle(false);}
    loadStyle({...defaults,...twpConfig.get('pdfReaderStyle')});
    for(const key of Object.keys(defaults))$('pdf-style-'+key).oninput=()=>applyStyle();
    $("pdf-style-reset").onclick=()=>{loadStyle(defaults);applyStyle();};
    $("pdf-style-original").onchange=()=>{twpPDFToggle.set($("bilingual-document"),twpPDFToggle.get($("pdf-style-original")));$("bilingual-document").dispatchEvent(new Event('change'));};
    $("bilingual-document").addEventListener('change',()=>{twpPDFToggle.set($("pdf-style-original"),twpPDFToggle.get($("bilingual-document")));});
    $("pdf-search-stop").onclick=()=>{searchVersion++;$("pdf-search-status").textContent='搜索已停止，保留已找到的结果';};
    $("pdf-search-dialog").addEventListener('close',()=>{searchVersion++;});
    $("pdf-search-form").onsubmit=async event=>{
      event.preventDefault();const query=$("pdf-search-query").value.trim().toLocaleLowerCase(),token=++searchVersion;$("pdf-search-results").replaceChildren();let count=0;
      if(!query || !reader.pageCount()){$("pdf-search-status").textContent='请先打开 PDF';return;}
      try {for(let page=1;page<=reader.pageCount()&&count<200;page++) {
        const layout=await reader.getLayout(page);if(token!==searchVersion)return;
        for(const chunk of layout.blocks)if(chunk.text.toLocaleLowerCase().includes(query)&&count<200){count++;const button=document.createElement('button');button.textContent=`第 ${page} 页 · ${chunk.text.slice(0,180)}`;button.onclick=()=>{$("pdf-search-dialog").close();reader.goTo(page);reader.selectChunk(page,chunk.id);};$("pdf-search-results").append(button);}
        $("pdf-search-status").textContent=`已搜索 ${page} / ${reader.pageCount()} 页，找到 ${count} 个文字块`;await new Promise(resolve=>setTimeout(resolve,0));
      }if(token===searchVersion)$("pdf-search-status").textContent=`搜索完成 · ${count} 个结果${count===200?'（最多显示 200 个）':''}`;}catch{if(token===searchVersion)$("pdf-search-status").textContent='搜索中断，请重试';}
    };
    $("pdf-first-page").onclick=()=>{reader.goTo(1);$("pdf-setup-dialog").close();};$("pdf-last-page").onclick=()=>{reader.goTo(reader.pageCount());$("pdf-setup-dialog").close();};
    $("pdf-fullscreen").onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();$("pdf-setup-dialog").close();}catch{status('当前环境无法进入全屏',true);}};
    $("pdf-properties").onclick=()=>{$("pdf-properties-content").textContent=metadata?`${metadata.fileName}\n${metadata.pages} 页\n批注 ${notes.length} 条\n本地解析，原 PDF 不上传`:'尚未打开 PDF';};
    refresh();
  }
  return {create};
})();
