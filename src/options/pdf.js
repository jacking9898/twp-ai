// SPDX-License-Identifier: MPL-2.0
"use strict";
void (async () => {
  await twpConfig.onReady();
  const $ = id => document.getElementById(id);
  let busy = false, reader, fileVersion = 0;
  const aborts = new Set();
  const preferences = twpConfig.get("sidebarPreferences") || {};
  twpPDFToggle.set($("pdf-auto-translate"),twpConfig.get("pdfAutoTranslate") !== false);
  const showOriginal=twpConfig.get('pdfShowOriginal');
  twpPDFToggle.set($("bilingual-document"),showOriginal===null?twpConfig.get('pdfLayoutMode')==='flow':!!showOriginal);
  if(showOriginal===null)twpConfig.set('pdfShowOriginal',twpPDFToggle.get($("bilingual-document")));
  twpPDFToggle.set($("pdf-style-original"),twpPDFToggle.get($("bilingual-document")));
  const languages = Object.entries(twpLang.getLanguageList());
  $("source-language").replaceChildren(new Option("自动检测", "auto"), ...languages.map(([code,name]) => new Option(name,code)));
  $("target").replaceChildren(...languages.map(([code,name]) => new Option(name,code)));
  function status(message = "", error = false) {
    $("task-status").textContent = message; $("task-status").dataset.error = String(error);
  }
  function models() {
    const selected = $("profile").value || preferences.profileId || twpConfig.get("aiActiveProfile");
    const profiles = twpConfig.get("aiProfiles");
    $("profile").replaceChildren(...(profiles.length ? profiles.map(profile => new Option(`${profile.name} · ${profile.model}`, profile.id)) : [new Option("请先配置 AI 服务", "")]));
    $("profile").value = selected;
    if (!$("profile").value) $("profile").selectedIndex = 0;
    $("model-row").hidden = $("retranslate-document").hidden = $("engine").value !== "openai";
  }
  function controls() {
    const loaded = reader?.hasPDF();
    $("translate-document").disabled = $("retranslate-document").disabled = busy || !loaded;
    for (const id of ["engine", "source-language", "target", "profile", "document-file"]) $(id).disabled = busy;
    $("cancel").hidden = !busy; reader?.updateControls(busy);
    $("pdf-empty").hidden = !!loaded || busy;
  }
  function applyPreferences(value = {}) {
    $("engine").value = value.service || twpConfig.get("pageTranslatorService");
    if (!$("engine").value) $("engine").value = "google";
    $("source-language").value = value.sourceLanguage || "auto";
    if (!$("source-language").value) $("source-language").value = "auto";
    $("target").value = value.targetLanguage || twpConfig.get("targetLanguage");
    if (!$("target").value) $("target").value = "zh-CN";
    models(); if (value.profileId) $("profile").value = value.profileId;
  }
  function cancel(message = "已取消翻译，已完成的页面仍可阅读", pauseAuto = false) {
    if (pauseAuto) { twpPDFToggle.set($("pdf-auto-translate"),false); twpConfig.set("pdfAutoTranslate", false); }
    fileVersion++; reader.cancel(); twpAIClient.cancel("pdf");
    for (const abort of [...aborts]) abort();
    busy = false; controls(); status(message);
  }
  function traditional(texts, service, targetLanguage, sourceLanguage) {
    return new Promise((resolve,reject) => {
      let done = false;
      const finish = (error, result) => {
        if (done) return; done = true; clearTimeout(timer); aborts.delete(abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new Error("已取消翻译")); aborts.add(abort);
      const timer = setTimeout(() => finish(new Error("翻译超时，请重试或更换服务")), 30000);
      chrome.runtime.sendMessage({action:"translateText", translationService:service, sourceLanguage, targetLanguage, sourceArray:texts}, result => {
        const error = chrome.runtime.lastError;
        if (error || !Array.isArray(result) || result.length !== texts.length || result.some(text => typeof text !== "string" || !text.trim())) finish(new Error("翻译服务暂不可用，请重试或更换服务"));
        else finish(null,result);
      });
    });
  }
  async function translateDocument(source, service, target, options, current) {
    const translations = [];
    for (let offset = 0; offset < source.segments.length;) {
      if (!current()) throw new Error("已取消翻译");
      const batch = []; let size = 0;
      while (offset < source.segments.length && batch.length < 20 && size + source.segments[offset].text.length <= 8000) {
        const text = source.segments[offset++].text; batch.push(text); size += text.length;
      }
      const values = await twpPDFInlineMath.translate(batch, protectedBatch => service === "openai"
        ? twpAIClient.translate(protectedBatch, target, options.context, "pdf", options)
        : traditional(protectedBatch, service, target, options.sourceLanguage), current);
      if (!current()) throw new Error("已取消翻译");
      translations.push(...values);
    }
    return translations;
  }
  reader = twpPDFDocument.create({status, translateDocument, setBusy: value => {busy = value; controls();},
    readSettings: () => ({service:$("engine").value, target:$("target").value, options:{sourceLanguage:$("source-language").value, profileId:$("profile").value}})});
  twpPDFTools.create({reader:reader.view,status});
  async function openFile(file, settings) {
    if (busy) cancel();
    const token = ++fileVersion;
    if (settings) applyPreferences(settings);
    busy = true; controls(); status("正在读取 PDF…");
    $("document-name").textContent = file.name;
    try {
      await reader.close();
      if (token !== fileVersion) return;
      if (!/\.pdf$/i.test(file.name)) throw new Error("请选择 PDF 文件");
      if (file.size > 50 * 1024 * 1024) throw new Error("PDF 文件过大，请选择不超过 50 MB 的文件");
      const result = await reader.open(file);
      if (token !== fileVersion || !result) return;
      $("document-name").textContent = `${file.name} · ${result.pages} 页`;
      document.title = `${file.name} · 页渡 · Yedu`;
      status(twpPDFToggle.get($("pdf-auto-translate")) ? "滚动自动翻译已开启 · 停留到哪页就翻译哪页" : "点击“翻译当前页”或右侧“翻译本页”开始翻译");
    } catch (error) { if (token === fileVersion) status(error.message || "无法读取 PDF", true); }
    finally { if (token === fileVersion) {busy = false; controls(); reader.scheduleAuto();} }
  }
  function run(force = false) {
    if (busy || !reader.hasPDF()) return;
    if ($("engine").value === "openai" && !$("profile").value) return status("请先在模型与术语设置中添加 AI 服务。", true);
    void reader.run(force);
  }
  $("document-file").onchange = () => { const file = $("document-file").files[0]; if (file) void openFile(file); $("document-file").value = ""; };
  $("translate-document").onclick = () => run(); $("retranslate-document").onclick = () => run(true);
  $("cancel").onclick = () => cancel("已取消翻译，滚动自动翻译已关闭；已完成的页面仍可阅读", true);
  function autoChanged() {
    if (!twpPDFToggle.get($("pdf-auto-translate")) && reader.isAutoTranslating()) cancel("已关闭滚动自动翻译，已完成的页面仍可阅读");
    else status(twpPDFToggle.get($("pdf-auto-translate")) ? "滚动自动翻译已开启 · 停留到哪页就翻译哪页" : "已关闭滚动自动翻译，可点击“翻译当前页”");
    reader.scheduleAuto(); reader.renderTranslation();
  }
  $("pdf-auto-translate").onchange = () => { twpConfig.set("pdfAutoTranslate", twpPDFToggle.get($("pdf-auto-translate"))); autoChanged(); };
  $("bilingual-document").onchange = () => {twpConfig.set('pdfShowOriginal',twpPDFToggle.get($("bilingual-document")));reader.renderTranslation();};
  $("ai-insights").onclick = () => reader.insights().catch(error=>status(error.message,true));
  $("settings").onclick = () => twpAIClient.call({action:"aiOpenSettings"}).catch(error => status(error.message,true));
  for (const id of ["engine", "source-language", "target", "profile"]) $(id).onchange = () => {
    twpConfig.set("sidebarPreferences", {...twpConfig.get("sidebarPreferences"), service:$("engine").value, sourceLanguage:$("source-language").value, targetLanguage:$("target").value, profileId:$("profile").value});
    reader.reset(); models(); controls(); status(twpPDFToggle.get($("pdf-auto-translate")) ? "翻译设置已更新，将自动翻译当前页" : "翻译设置已更新，请重新翻译。");
  };
  twpConfig.onChanged(name => {
    if (name === "pdfAutoTranslate") {
      const enabled = twpConfig.get(name) !== false;
      if (twpPDFToggle.get($("pdf-auto-translate")) !== enabled) { twpPDFToggle.set($("pdf-auto-translate"),enabled); autoChanged(); }
      return;
    }
    if (!["aiActiveProfile", "aiProfiles", "aiTranslationSettings", "aiCustomExperts", "aiCustomGlossaries"].includes(name)) return;
    if (busy) cancel("模型或术语已变化，请重新翻译。");
    reader.reset(); models(); controls();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && busy && !document.querySelector('dialog[open]')) cancel("已取消翻译，滚动自动翻译已关闭；已完成的页面仍可阅读", true); });
  window.addEventListener("pagehide", () => { cancel(); void reader.close(); });
  applyPreferences(preferences);
  if (innerWidth < 1000) { $("pdf-outline").hidden = true; $("pdf-outline-toggle").setAttribute("aria-expanded", "false"); }
  controls();
  twpPDFHandoff.receive(openFile, () => status("文件传递已结束，请点击“打开 PDF”重新选择文件。",true));
})();
