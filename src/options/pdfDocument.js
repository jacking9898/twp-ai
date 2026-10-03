// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFDocument = (() => {
  function extractText(items) {
    const layout = typeof module !== "undefined" ? require("./pdfLayout.js") : twpPDFLayout;
    return layout.extract(items).text;
  }
  function create({status, setBusy, readSettings, translateDocument}) {
    const $ = id => document.getElementById(id);
    let pdf = null, loading = null, fileName = "", fingerprint = "";
    let generation = 0, busy = false, complete = false;
    let autoTimer, readyPage = null, automatic = false;
    const results = new Map(), errors = new Map(), pending = new Set();
    const reader = twpPDFReader.create({results, status, onRead: scheduleAuto,
      onTranslate: number => void run(false, {page: number}),
      translationState: () => ({pending, errors, busy, auto: twpPDFToggle.get($("pdf-auto-translate"))})});
    const renderTranslation = number => reader.renderTranslation(number);
    function clearAuto() { clearTimeout(autoTimer); readyPage = null; }
    function scheduleAuto() {
      clearAuto();
      if (!pdf || !twpPDFToggle.get($("pdf-auto-translate"))) return;
      // One settled reading page, not a queue of every page crossed while scrolling.
      autoTimer = setTimeout(() => { readyPage = reader.pageNumber(); pumpAuto(); }, 650);
    }
    function pumpAuto() {
      if (!pdf || busy || !twpPDFToggle.get($("pdf-auto-translate")) || readyPage !== reader.pageNumber()) return;
      const number = readyPage; readyPage = null;
      if (!results.has(number) && !errors.has(number)) void run(false, {page: number, automatic: true});
    }
    function updateControls(value = busy) {
      busy = value;
      reader.navigation();
      $("pdf-scope").disabled = value || !pdf;
      $("pdf-export").disabled = value || !results.size;
      $("translate-document").textContent = $("pdf-scope").value === "all" ? "翻译全文" : "翻译当前页";
      for (const button of document.querySelectorAll(".pdf-translate-page")) button.disabled = value;
    }
    async function close() {
      generation++; clearAuto(); reader.close();
      const task = loading; loading = null; pdf = null; complete = false; results.clear(); errors.clear(); pending.clear();
      $("pdf-reader").hidden = true;
      if (task) await task.destroy().catch(() => {});
    }
    async function open(file) {
      const closing = close();
      const token = generation;
      await closing;
      if (token !== generation) return null;
      const library = await globalThis.twpLoadPDF();
      const buffer = await file.arrayBuffer();
      if (token !== generation) return null;
      const nextFingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (token !== generation) return null;
      fingerprint = nextFingerprint;
      library.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdfjs/pdf.worker.mjs");
      const base = chrome.runtime.getURL("lib/pdfjs/");
      const task = library.getDocument({data: new Uint8Array(buffer), fontExtraProperties: true, cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", iccUrl: base + "iccs/", isEvalSupported: false, isImageDecoderSupported: false});
      loading = task;
      try {
        const document = await task.promise;
        if (token !== generation) { await task.destroy().catch(() => {}); return null; }
        if (document.numPages > 2000) throw new Error("PDF 超过 2000 页，请拆分后翻译");
        pdf = document; fileName = file.name;
        $("pdf-page").max = pdf.numPages; $("pdf-reader").hidden = false;
        await reader.open(pdf);
        if (token !== generation) return null;
        globalThis.document.dispatchEvent(new CustomEvent("twp-pdf-open",{detail:{fingerprint,fileName,pages:pdf.numPages}}));
        return {pages: pdf.numPages};
      } catch (error) {
        if (token !== generation) { await task.destroy().catch(() => {}); return null; }
        await close();
        throw new Error(error.name === "PasswordException" ? "PDF 已加密，请先解密后导入。" : error.message.includes("2000") ? error.message : "无法读取 PDF，请确认文件完整且格式正确。");
      }
    }
    async function run(forceRefresh = false, request = {}) {
      if (!pdf || busy) return;
      clearAuto();
      const token = ++generation, activePDF = pdf;
      const settings = readSettings(), all = !request.page && $("pdf-scope").value === "all", pageNumber = request.page || reader.pageNumber();
      const pages = all ? Array.from({length: pdf.numPages}, (_, i) => i + 1) : [pageNumber];
      automatic = !!request.automatic; busy = true; setBusy(true);
      let number = pageNumber;
      try {
        if (settings.service === "openai" && !settings.options.profileId) throw new Error("请先在模型与术语设置中添加 AI 服务。");
        let empty = 0;
        for (let index = 0; index < pages.length; index++) {
          number = pages[index];
          if (all && !forceRefresh && results.has(number)) { if (!results.get(number).document) empty++; continue; }
          errors.delete(number); pending.add(number); renderTranslation(number); updateControls();
          status(`正在翻译 PDF · 第 ${number} 页 · ${index + 1} / ${pages.length}`);
          const page = await activePDF.getPage(number);
          if (token !== generation) return;
          const layout = await reader.getLayout(number);
          if (token !== generation) return;
          const text = layout.text;
          const document = text.trim() ? twpDocumentTranslation.parse(text, "txt") : null;
          if (document) for (const segment of document.segments) segment.chunkId = layout.blocks.find(block=>segment.start>=block.start && segment.start<block.end).id;
          // Keep image-only formulas addressable for rendering/export, but never
          // submit their private glyph codes or placeholder text for translation.
          const prose=document?.segments.filter(segment=>layout.blocks[segment.chunkId].kind!=='formula')||[];
          const translated=prose.length ? await translateDocument({...document,segments:prose}, settings.service, settings.target, {...settings.options, documentKey: `pdf:${fingerprint}`, forceRefresh, context: `PDF ${fingerprint} page ${number} layout-v9-inline-sums`}, () => token === generation) : [];
          let translatedIndex=0;
          const translations=document?document.segments.map(segment=>layout.blocks[segment.chunkId].kind==='formula'?segment.text:translated[translatedIndex++]):[];
          if (token !== generation) return;
          results.set(number, {document, translations, target: settings.target});
          pending.delete(number);
          if (!document) empty++;
          renderTranslation(number);
          // Release per-page operator/font resources during long documents.
          if (!reader.isRendering(number)) page.cleanup();
        }
        complete = results.size === activePDF.numPages;
        status(`PDF 翻译完成 · ${all ? `${pages.length} 页` : `第 ${pageNumber} 页`} · 可点击“查看当前页译文”${empty ? `（${empty} 页没有文字层，需要 OCR 或为空白页）` : ""}`);
      } catch (error) {
        if (token === generation) {
          const message = error.message || "PDF 翻译失败，可重试；已完成的页面仍可阅读。";
          errors.set(number, message); status(message, true);
        }
      } finally {
        if (token === generation) {
          pending.clear(); automatic = false; busy = false;
          renderTranslation(number); setBusy(false); updateControls(); pumpAuto();
        }
      }
    }
    function reset() { generation++; clearAuto(); results.clear(); errors.clear(); pending.clear(); complete = false; renderTranslation(); updateControls(); scheduleAuto(); }
    function cancel() {
      generation++; clearAuto(); pending.clear(); automatic = false; busy = false; renderTranslation();
      if (loading && !pdf) void close();
    }
    $("pdf-scope").onchange = () => updateControls();
    $("pdf-export").onclick = () => {
      if (!results.size || busy) return;
      const bilingual = twpPDFToggle.get($("bilingual-document"));
      const text = [...results].sort(([a], [b]) => a - b).map(([number, row]) => `—— 第 ${number} 页 ——\n\n${row.document ? twpDocumentTranslation.render(row.document, row.translations, bilingual) : "本页没有可提取的文字（未翻译）"}`).join("\n\n");
      const url = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"}));
      const link = document.createElement("a"); link.href = url; link.download = `${fileName.replace(/\.pdf$/i, "")}.${complete ? "" : "partial."}${bilingual ? "bilingual" : "translated"}.txt`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    async function insights() {
      if(!pdf)throw new Error('请先打开 PDF');
      const active=pdf,key=fingerprint,page=reader.pageNumber(),layout=await reader.getLayout(page);
      if(active!==pdf)throw new Error('文件已切换，请重试');
      const settings=readSettings();
      return twpAIClient.call({action:'aiInsightOpen',documentKey:'pdf:'+key,text:layout.blocks.filter(b=>b.kind!=='formula').map(b=>b.text).join('\n\n'),title:`${fileName} · 第 ${page} 页（术语属于整份 PDF）`,targetLanguage:settings.target,profileId:settings.options.profileId});
    }
    return {insights,open, close, run, reset, updateControls, renderTranslation, cancel, scheduleAuto, view:reader,
      isAutoTranslating: () => automatic, hasPDF: () => !!pdf};
  }
  return {create, extractText};
})();
if (typeof module !== "undefined") module.exports = twpPDFDocument;
