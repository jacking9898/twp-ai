// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFReader = (() => {
  function create({results, status, onRead, onTranslate, translationState}) {
    const $ = id => document.getElementById(id);
    const scroller = $("pdf-scroll"), list = $("pdf-pages");
    const translatedScroller = $("pdf-translation-scroll"), translatedList = $("pdf-translations");
    const silentScroll = new Map();
    let pdf = null, version = 0, current = 1, observer = null, frame = 0, resizeTimer;
    const formulas=twpPDFMath.renderer(translatedScroller,()=>pdf);
    let width = 0, rendering = false, outlineVersion = 0;
    let records = [], nearby = new Set();
    let selection = null, pendingAlignment = false;
    let textSelection=false;
    let lastReadingPane=scroller, selectionAligned=false;
    const syncToggle=$("pdf-sync-scroll");
    twpPDFToggle.set(syncToggle,twpConfig.get("pdfSyncScroll")!==false);
    const changed=()=>document.dispatchEvent(new Event("twp-pdf-render"));
    const paper = (className, label) => {
      const node = document.createElement("section"); node.className = className;
      node.setAttribute("aria-label", label); return node;
    };
    function navigation() {
      $("pdf-page").value = current;
      $("pdf-reading-position").textContent=pdf?`当前阅读 · 第 ${current} 页`:"译文 · 保留段落结构";
      $("pdf-count").textContent = `/ ${pdf?.numPages || 0} 页`;
      $("pdf-previous").disabled = !pdf || current <= 1;
      $("pdf-next").disabled = !pdf || current >= pdf.numPages;
      $("pdf-page").disabled = $("pdf-zoom").disabled = !pdf;
    }
    function anchor(pane = scroller, offset = 0) {
      const element = record => pane === scroller ? record.row : record.translation;
      // Binary search works for mixed page sizes and expanded translations.
      let low = 0, high = records.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (element(records[mid]).offsetTop <= pane.scrollTop + offset + 2) low = mid; else high = mid - 1;
      }
      const record = records[low];
      return record ? {record, fraction: (pane.scrollTop - element(record).offsetTop) / element(record).offsetHeight} : null;
    }
    function scrollTo(pane, top) { const before=pane.scrollTop;pane.scrollTop = top;if(Math.abs(before-pane.scrollTop)>.5) silentScroll.set(pane, pane.scrollTop); }
    function syncScroll(pane=lastReadingPane) {
      if (!pdf || !twpPDFToggle.get(syncToggle) || selectionAligned) return;
      const other=pane===scroller?translatedScroller:scroller;
      const focus=Math.min(pane.clientHeight*.35,other.clientHeight*.35,200);
      const record=anchor(pane,focus)?.record;
      if (!record) return;
      if (pane.scrollTop<=1) {scrollTo(other,0);return;}
      if (pane.scrollHeight>pane.clientHeight && pane.scrollHeight-pane.clientHeight-pane.scrollTop<=1) {
        scrollTo(other,other.scrollHeight);return;
      }
      const top=(node,parent)=>node.getBoundingClientRect().top-parent.getBoundingClientRect().top+parent.scrollTop;
      const sourceTop=top(record.row,scroller), targetTop=top(record.translation,translatedScroller);
      const next=records[record.number];
      const end=[next?top(next.row,scroller):sourceTop+record.row.offsetHeight,
        next?top(next.translation,translatedScroller):targetTop+record.translation.offsetHeight];
      const points=[[sourceTop,targetTop]];
      // Match paragraph boundaries when available; page-relative positions work before translation.
      // Keep anchors monotonic even for PDFs whose reading order includes side notes or columns.
      for (const block of record.layout?.blocks || []) {
        const targets=record.translation.querySelectorAll(`[data-chunk="${block.id}"]`);
        if (!block.bounds || !targets.length) continue;
        const sourceNode=record.overlay.querySelector(`[data-chunk="${block.id}"]`);
        const source=sourceNode?top(sourceNode,scroller):top(record.slot,scroller)+block.bounds.y*record.slot.getBoundingClientRect().height;
        const target=top(targets[0],translatedScroller), previous=points[points.length-1];
        if (source>previous[0]+1 && target>previous[1]+1 && source<end[0] && target<end[1]) points.push([source,target]);
      }
      points.push(end);
      const axis=pane===scroller?0:1, opposite=1-axis, position=pane.scrollTop+focus;
      let index=1;
      while(index<points.length-1 && points[index][axis]<position) index++;
      const start=points[index-1], finish=points[index];
      const fraction=Math.max(0,Math.min(1,(position-start[axis])/(finish[axis]-start[axis])));
      scrollTo(other,start[opposite]+fraction*(finish[opposite]-start[opposite])-focus);
    }
    function preservePosition(action) {
      const saved = [scroller, translatedScroller].map(pane=>({pane,position:anchor(pane)})); action();
      for (const {pane,position} of saved) if (position) {
        const node = pane === scroller ? position.record.row : position.record.translation;
        scrollTo(pane,node.offsetTop + position.fraction * node.offsetHeight);
      }
    }
    function visiblePage(pane) {
      if (!pdf || !pane.clientHeight) return;
      const position = anchor(pane, Math.min(pane.clientHeight*.35,200));
      if (position && current !== position.record.number) { current = position.record.number; navigation(); }
      onRead();
      $("pdf-reading-position").textContent=`${pane===scroller?"原文":"译文"} · 第 ${current} 页`;
    }
    function sizeRecord(record) {
      const fitWidth = Math.max(120, Math.min(scroller.clientWidth,translatedScroller.clientWidth) - 32);
      const scale = $("pdf-zoom").value === "fit" ? fitWidth / record.base.width : Number($("pdf-zoom").value);
      record.scale = scale;
      record.slot.style.width = `${record.base.width * scale}px`;
      record.slot.style.height = `${record.base.height * scale}px`;
      record.row.style.setProperty("--paper-width", `${record.base.width * scale}px`);
      record.row.style.setProperty("--paper-height", `${record.base.height * scale}px`);
      record.translation.style.setProperty("--paper-width", `${record.base.width * scale}px`);
      record.translation.style.setProperty("--paper-height", `${record.base.height * scale}px`);
      twpPDFTypeset.fit(record);
    }
    function release(record) {
      const task = record.task, page = record.page;
      task?.cancel(); record.task = null;
      if (record.canvas) { record.canvas.width = record.canvas.height = 0; record.canvas.remove(); record.canvas = null; }
      record.overlay.replaceChildren();
      record.textLayerTask?.cancel();record.textLayerTask=null;record.textLayer?.remove();record.textLayer=null;
      record.slot.dataset.state = "waiting";
      if (page) {
        const cleanup = () => {
          if (record.page === page && !record.task && !record.canvas) { page.cleanup(); record.page = null; }
        };
        if (task) void task.promise.catch(() => {}).then(cleanup).catch(() => {});
        else cleanup();
      }
    }
    function relayout() {
      if (!pdf || !scroller.clientWidth) return;
      version++;
      width = scroller.clientWidth;
      preservePosition(() => { for (const record of records) { release(record); sizeRecord(record); } });
      syncScroll();
      formulas.resize();
      void pump();
    }
    async function pump() {
      if (rendering || !pdf) return;
      rendering = true;
      try {
        while (pdf) {
          // Never keep a document's worth of canvases in memory.
          const sourcePage = anchor()?.record.number || 1;
          const wanted = [...nearby].sort((a,b) => Math.abs(a.number-sourcePage) - Math.abs(b.number-sourcePage)).slice(0, 6);
          for (const record of records) if (!wanted.includes(record) && (record.canvas || record.task)) release(record);
          const record = wanted.find(item => !item.canvas && !item.failed);
          if (!record) break;
          const token = version, activePDF = pdf;
          try {
            const page = await activePDF.getPage(record.number);
            if (token !== version || !nearby.has(record)) continue;
            record.page = page;
            const base = page.getViewport({scale: 1});
            if (record.base.width !== base.width || record.base.height !== base.height) {
              preservePosition(() => { record.base = base; sizeRecord(record); });
            }
            const viewport = page.getViewport({scale: record.scale});
            const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(6000000 / (viewport.width * viewport.height)));
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = "100%"; canvas.style.height = "100%";
            canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `PDF 原件第 ${record.number} 页`);
            record.canvas = canvas; record.slot.append(canvas); record.slot.dataset.state = "loading";
            const task = page.render({canvasContext: canvas.getContext("2d"), viewport, transform: [ratio,0,0,ratio,0,0]});
            record.task = task;
            await task.promise;
            if (token === version && record.canvas === canvas) {
              record.task = null; record.slot.dataset.state = "ready";
              await getLayout(record.number);
              if (token === version && record.canvas === canvas) renderChunks(record);
              if(textSelection && token===version) await renderTextLayer(record);
              changed();
            }
          } catch (error) {
            if (token === version && error.name !== "RenderingCancelledException") {
              release(record); record.failed = true; record.slot.dataset.state = "error";
              record.slot.setAttribute("aria-label", `第 ${record.number} 页显示失败，请调整缩放重试`);
              status(`PDF 第 ${record.number} 页显示失败，调整缩放可重试。`, true);
            }
          }
        }
      } finally { rendering = false; }
    }
    async function renderTextLayer(record) {
      if(!record.canvas || record.textLayer) return;
      const token=version,library=await twpLoadPDF();
      if(token!==version || !textSelection || !record.canvas) return;
      const container=document.createElement("div");container.className="pdf-text-layer";
      container.style.setProperty("--total-scale-factor",record.scale);
      record.textLayer=container;record.slot.append(container);
      const layer=new library.TextLayer({textContentSource:record.textContent,container,viewport:record.page.getViewport({scale:record.scale})});record.textLayerTask=layer;
      try {await layer.render();} catch(error) {if(error.name!=="AbortException") status("文字选择层加载失败，可切回文字块工具重试",true);}
    }
    function setTextSelection(enabled) {
      textSelection=enabled;
      for(const record of records) if(enabled && record.textContent) void renderTextLayer(record);
    }
    async function getLayout(number) {
      const record = records[number-1], activePDF = pdf;
      if (!record || !activePDF) throw new Error("PDF 已关闭");
      if (!record.layoutPromise) record.layoutPromise = (async () => {
        const page = await activePDF.getPage(number), content = await page.getTextContent();
        const operators=await page.getOperatorList(), library=await twpLoadPDF();
        const styles={...content.styles};
        for(const name of Object.keys(styles)) {try {const font=page.commonObjs.get(name);styles[name]={...styles[name],fontFamily:`${styles[name].fontFamily} ${font.name || ""}`};} catch { /* Font metadata is optional. */ }}
        const viewport=page.getViewport({scale:1});
        // Full-document translation can reach mixed-size pages before their canvases are rendered.
        if(pdf===activePDF && (record.base.width!==viewport.width || record.base.height!==viewport.height)) {
          preservePosition(()=>{record.base=viewport;sizeRecord(record);});
        }
        const layout = twpPDFLayout.extract(content.items,styles,viewport,twpPDFLayout.vectorMarkers(operators,library.OPS));
        layout.backgrounds=twpPDFLayout.vectorBackgrounds(operators,library.OPS,viewport);
        record.textContent=content;
        record.layout = layout;
        return layout;
      })().catch(error=>{record.layoutPromise=null;throw error;});
      return record.layoutPromise;
    }
    function renderChunks(record) {
      record.overlay.replaceChildren();
      for (const block of record.layout?.blocks || []) {
        if (!block.bounds) continue;
        const button = document.createElement("button"), rect = block.bounds;
        button.type="button"; button.className="pdf-source-chunk"; button.dataset.chunk=block.id;
        button.style.left=`${Math.max(0,rect.x)*100}%`; button.style.top=`${Math.max(0,rect.y)*100}%`;
        button.style.width=`${Math.min(1-rect.x,rect.width)*100}%`; button.style.height=`${rect.height*100}%`;
        button.setAttribute("aria-label",`定位第 ${record.number} 页第 ${block.id+1} 块译文：${block.text.slice(0,100)}`);
        button.setAttribute("aria-pressed",String(selection?.page===record.number && selection?.chunk===block.id));
        button.title="点击定位并高亮对应译文"; button.onclick=()=>selectChunk(record,block.id);
        record.overlay.append(button);
      }
    }
    function highlight() {
      for (const record of records) {
        for (const node of record.overlay.children) node.setAttribute("aria-pressed",String(selection?.page===record.number && Number(node.dataset.chunk)===selection?.chunk));
        for (const node of record.translation.querySelectorAll("[data-chunk]")) node.classList.toggle("selected-chunk",selection?.page===record.number && Number(node.dataset.chunk)===selection?.chunk);
      }
    }
    function alignSelection() {
      if (!selection) return;
      const record=records[selection.page-1]; if (!record) return;
      const target=record.translation.querySelector(`[data-chunk="${selection.chunk}"]`);
      const source=record.overlay.querySelector(`[data-chunk="${selection.chunk}"]`);
      const offset=source ? Math.max(16,Math.min(translatedScroller.clientHeight*.5,source.getBoundingClientRect().top-scroller.getBoundingClientRect().top)) : 16;
      const node=target || record.translation;
      scrollTo(translatedScroller,translatedScroller.scrollTop+node.getBoundingClientRect().top-translatedScroller.getBoundingClientRect().top-offset);
      if (target) pendingAlignment=false;
    }
    function selectChunk(record,chunk) {
      selectionAligned=true;
      selection={page:record.number,chunk};pendingAlignment=true;current=record.number;navigation();highlight();alignSelection();onRead();
      if (!results.has(record.number)) status(translationState().auto ? "已定位对应页，译文完成后将对齐所选文字块" : "本页尚未翻译，点击右侧“翻译本页”后将对齐所选文字块");
    }
    function renderTranslation(number) {
      const selected = number ? [records[number - 1]].filter(Boolean) : records;
      const state = translationState();
      preservePosition(() => {
        for (const record of selected) {
          const value = results.get(record.number), content = record.translation;
          formulas.clear(content);
          content.replaceChildren();
          content.classList.remove('pdf-original-layout');
          const heading = document.createElement("h3"); heading.textContent = `第 ${record.number} 页`;
          heading.className = "pdf-page-label"; content.append(heading);
          const pending = state.pending.has(record.number), error = state.errors.get(record.number);
          if (pending || error) {
            const notice = document.createElement("p"); notice.className = "pdf-page-message";
            notice.textContent = pending ? "正在翻译本页…" : error;
            notice.dataset.error = String(!!error); content.append(notice);
          }
          if (!value?.document) {
            const message = document.createElement("p"); message.className = "pdf-page-message";
            message.textContent = value ? "本页没有可提取的文字，可能是扫描页或空白页；扫描文字需要 OCR。" : "本页尚未翻译";
            if (!pending && !error) content.append(message);
            if (!value) {
              const hint = document.createElement("p"); hint.className = "pdf-page-hint";
              hint.textContent = error ? "自动重试已暂停，可以手动重试本页。" : state.auto ? "在本页停留片刻即自动翻译，已翻译页面会直接复用。" : "点击下方按钮翻译本页，或在顶部开启“滚动自动翻译”。";
              const button = document.createElement("button"); button.type = "button"; button.className = "primary pdf-translate-page";
              button.textContent = pending ? "正在翻译…" : error ? "重试本页" : "翻译本页";
              button.disabled = state.busy; button.onclick = () => onTranslate(record.number);
              content.append(hint, button);
            }
            continue;
          }
          if(record.layout?.blocks.length) {
            content.classList.add('pdf-original-layout');
            heading.className='pdf-source-label pdf-layout-label';
            const surface=twpPDFTypeset.render(record,twpDocumentTranslation.pairs(value.document,value.translations),value.target,twpPDFToggle.get($("bilingual-document")),formulas.node);
            content.prepend(surface);content.append(heading);
            twpPDFTypeset.fit(record);
            continue;
          }

        }
      });
      highlight();
      if (pendingAlignment && (!number || number===selection?.page)) alignSelection();
      syncScroll();
      changed();
    }
    function goTo(number) {
      if (!pdf) return;
      current = Math.max(1, Math.min(pdf.numPages, Math.trunc(Number(number)) || 1));
      navigation();
      pendingAlignment=false;
      selectionAligned=false;lastReadingPane=scroller;
      scrollTo(scroller,records[current - 1].row.offsetTop);
      scrollTo(translatedScroller,records[current - 1].translation.offsetTop);
      // Render immediately even if IntersectionObserver hasn't delivered yet.
      nearby.clear(); nearby.add(records[current - 1]); void pump();
      onRead();
    }
    async function outline(activePDF, token) {
      const container = $("pdf-outline-items");
      try {
        const items = await activePDF.getOutline();
        if (token !== outlineVersion) return;
        container.replaceChildren();
        if (!items?.length) { container.textContent = "这份 PDF 没有目录，可通过页码跳转。"; return; }
        let count = 0;
        function add(items, parent, depth) {
          if (depth > 20) return;
          for (const item of items) {
            if (++count > 5000) return;
            const button = document.createElement("button"); button.type = "button";
            button.textContent = item.title || "未命名章节";
            button.style.paddingInlineStart = `${12 + depth * 12}px`;
            button.disabled = !item.dest;
            button.onclick = async () => {
              try {
                const destination = typeof item.dest === "string" ? await activePDF.getDestination(item.dest) : item.dest;
                if (!destination) return;
                const number = Number.isInteger(destination[0]) ? destination[0] : await activePDF.getPageIndex(destination[0]);
                if (token === outlineVersion) goTo(number + 1);
              } catch { status("无法跳转到此章节，请使用页码导航。", true); }
            };
            parent.append(button); if (item.items?.length) add(item.items, parent, depth + 1);
          }
        }
        add(items, container, 0);
      } catch { if (token === outlineVersion) container.textContent = "目录暂不可用，请使用页码跳转。"; }
    }
    async function open(documentPDF) {
      close(); pdf = documentPDF;
      const token = version;
      const first = await pdf.getPage(1);
      if (token !== version) return;
      const base = first.getViewport({scale: 1});
      const fragment = document.createDocumentFragment(), translations = document.createDocumentFragment();
      records = Array.from({length: pdf.numPages}, (_, i) => {
        const number = i + 1, row = document.createElement("div"); row.className = "pdf-page-row"; row.dataset.page = number;
        const source = paper("pdf-source-page", `PDF 原件第 ${number} 页`); source.dataset.page = number;
        const slot = document.createElement("div"); slot.className = "pdf-canvas-slot"; slot.dataset.state = "waiting";
        const overlay = document.createElement("div"); overlay.className="pdf-chunk-layer"; slot.append(overlay);
        const label = document.createElement("div"); label.className = "pdf-source-label"; label.textContent = `原文 · 第 ${number} 页`;
        source.append(slot, label);
        const translation = paper("pdf-translation-page", `PDF 译文第 ${number} 页`); translation.dataset.page = number;
        row.append(source); fragment.append(row); translations.append(translation);
        return {number, row, source, slot, overlay, translation, base, canvas: null, task: null};
      });
      list.replaceChildren(fragment); translatedList.replaceChildren(translations); scrollTo(scroller,0); scrollTo(translatedScroller,0);
      $("pdf-page").max = pdf.numPages; current = 1;
      relayout(); renderTranslation(); navigation();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const record = records[Number(entry.target.dataset.page) - 1];
          if (!record) continue;
          if (entry.isIntersecting) nearby.add(record); else nearby.delete(record);
        }
        void pump();
      }, {root: scroller, rootMargin: "700px 0px"});
      for (const record of records) observer.observe(record.row);
      nearby.add(records[0]); void pump(); void outline(pdf, outlineVersion);
    }
    function close() {
      version++; outlineVersion++; pdf = null;
      formulas.clear();
      observer?.disconnect(); observer = null; nearby.clear();
      cancelAnimationFrame(frame); clearTimeout(resizeTimer);
      for (const record of records) release(record);
      records = []; list.replaceChildren(); translatedList.replaceChildren(); $("pdf-outline-items").replaceChildren();
      selection=null;pendingAlignment=false;silentScroll.clear();
      selectionAligned=false;lastReadingPane=scroller;
      current = 1; width = 0;
      document.dispatchEvent(new Event("twp-pdf-close"));
    }
    $("pdf-previous").onclick = () => goTo(current - 1);
    $("pdf-next").onclick = () => goTo(current + 1);
    $("pdf-page").onchange = () => goTo($("pdf-page").value);
    $("pdf-zoom").onchange = () => { for (const record of records) record.failed = false; relayout(); };
    $("pdf-outline-toggle").onclick = () => {
      const hidden = !$("pdf-outline").hidden; $("pdf-outline").hidden = hidden;
      $("pdf-outline-toggle").setAttribute("aria-expanded", String(!hidden));
    };
    for (const pane of [scroller,translatedScroller]) {
      pane.addEventListener("scroll", () => {
        const expected=silentScroll.get(pane); silentScroll.delete(pane);
        if (expected !== undefined && Math.abs(expected-pane.scrollTop)<1) return;
        pendingAlignment=false;
        selectionAligned=false;lastReadingPane=pane;
        cancelAnimationFrame(frame); frame=requestAnimationFrame(()=>{syncScroll(pane);visiblePage(pane);});
      }, {passive:true});
      // A deliberate user scroll cancels deferred alignment while a translation is running.
      for (const event of ["wheel","touchstart","pointerdown","keydown"]) pane.addEventListener(event,()=>{pendingAlignment=false;silentScroll.delete(pane);},{passive:true});
    }
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (pdf && width !== scroller.clientWidth && scroller.clientWidth) relayout(); }, 100);
    }).observe(scroller);
    // Translation, font and style changes can alter page heights after the user has stopped scrolling.
    new ResizeObserver(()=>syncScroll()).observe(translatedList);
    syncToggle.onchange=()=>{
      selectionAligned=false;
      twpConfig.set("pdfSyncScroll",twpPDFToggle.get(syncToggle));
      syncScroll();
    };
    function fitTranslations() {
      preservePosition(()=>{for(const record of records)twpPDFTypeset.fit(record);});syncScroll();
    }
    $("pdf-align-page").onclick=()=>{if(pdf) scrollTo(translatedScroller,records[current-1].translation.offsetTop);};
    return {open, close, renderTranslation, navigation, getLayout, goTo, setTextSelection, fitTranslations,
      selectChunk:(number,chunk)=>{if(records[number-1]) selectChunk(records[number-1],chunk);},
      pageCount:()=>pdf?.numPages || 0, records:()=>records, pageNumber: () => current,
      isRendering: number => !!records[number - 1]?.task};
  }
  return {create};
})();
