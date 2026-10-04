"use strict";
void (async () => {
  await twpConfig.onReady();
  const $ = id => document.getElementById(id);
  const workspace = new URLSearchParams(location.search).get("workspace") === "1";
  document.body.classList.toggle("workspace", workspace);
  document.body.dataset.view = "text";
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const files = { document: null, video: null };
  const fileVersions = { document: 0, video: 0 };
  const titles = {
    text: ["文本翻译", "读懂另一种语言，也读懂其中的意思。"],
    document: ["文档翻译", "把一份资料，变成更熟悉的语言。"],
    video: ["视频与字幕", "保留时间轴，让理解跟上每一句。"],
    image: ["图片翻译", "图片里的文字，也值得被读懂。"],
    help: ["使用指南", "从一句话开始，轻松读懂更多。"],
  };
  let view = "text", job = 0, busy = false, output = "", downloadName = "";
  const legacyAborts = new Set();
  let comparison = null;
  let imageTool = null;
  let captured, captureError;
  const captureToken = new URLSearchParams(location.search).get('capture');
  if (captureToken) try {captured = (await twpAIClient.call({action:'regionImageRead',token:captureToken})).image;} catch(error){captureError=error.message;}
  const preferences = {...twpConfig.get("sidebarPreferences"), ...captured?.options};
  $("engine").value = preferences.service || twpConfig.get("pageTranslatorService");
  if (!$("engine").value) $("engine").value = "bing";
  const languages = Object.entries(twpLang.getLanguageList());
  $("source-language").replaceChildren(new Option("自动检测", "auto"), ...languages.map(([code, name]) => new Option(name, code)));
  $("source-language").value = preferences.sourceLanguage || "auto";
  if (!$("source-language").value) $("source-language").value = "auto";
  $("target").replaceChildren(...languages.map(([code, name]) => new Option(name, code)));
  $("target").value = preferences.targetLanguage || twpConfig.get("targetLanguage");
  if (!$("target").value) $("target").value = "zh-CN";

  function status(message = "", error = false) {
    $("task-status").textContent = message;
    $("task-status").dataset.error = String(error);
    $("task-status").dataset.busy = String(busy);
  }
  function resetResult() {
    imageTool?.resetTranslation();
    output = ""; downloadName = "";
    $("result-card").hidden = true; $("result").textContent = ""; $("copy").textContent = "复制";
    $("download").hidden = true;
  }
  function controls() {
    $("count").textContent = `${$("source").value.length.toLocaleString()} / 16,000`;
    $("translate-text").disabled = busy || !$("source").value.trim();
    $("translate-document").disabled = busy || !files.document;
    $("retranslate-document").disabled = busy || !files.document;
    $("retranslate-document").hidden = $("engine").value !== "openai" || files.document?.format === "pdf";
    $("translate-document").textContent = files.document?.format === "pdf" ? "打开 PDF 阅读器" : "翻译文档";
    $("bilingual-document").parentElement.hidden = files.document?.format === "pdf";
    $("translate-video").disabled = busy || !files.video;
    for (const id of ["engine", "source-language", "target", "profile", "source", "document-file", "subtitle-file", "document-remove", "subtitle-remove", "bilingual-subtitles", "bilingual-document", "paste", "clear"]) $(id).disabled = busy;
    $("cancel").hidden = !busy;
    $("task-status").dataset.busy = String(busy);
    comparison?.updateControls();
    imageTool?.updateControls(busy);
  }
  function modelOptions() {
    const ai = $("engine").value === "openai";
    $("model-row").hidden = !ai;
    const profiles = twpConfig.get("aiProfiles");
    $("profile").replaceChildren(...(profiles.length ? profiles.map(profile => new Option(`${profile.name} · ${profile.model}`, profile.id)) : [new Option("尚未配置 AI 模型", "")]));
    $("profile").value = twpConfig.get("sidebarPreferences").profileId || twpConfig.get("aiActiveProfile");
    if (!$("profile").value) $("profile").selectedIndex = 0;
    const domain = twpConfig.get("aiTranslationSettings").domain;
    $("model-hint").textContent = $("profile").value
      ? `当前模型 · ${twpAIPresets.allExperts(twpConfig.get("aiCustomExperts")).find(item => item.id === domain)?.name || "通用"} · 使用已保存的术语库`
      : "点击旁边的设置按钮，添加自己的模型服务。";
  }
  function savePreferences() {
    twpConfig.set("sidebarPreferences", { ...twpConfig.get("sidebarPreferences"), service: $("engine").value, sourceLanguage: $("source-language").value, targetLanguage: $("target").value });
    resetResult(); comparison?.reset();  status(); modelOptions(); controls();
  }
  function cancel(message = "已取消翻译") {
    job++; busy = false;
    comparison?.cancel();
    imageTool?.cancel();
    cancelRequests();
    controls(); status(message);
  }
  function changeView(next) {
    if (next === view) return;
    if (busy) cancel();
    view = next; resetResult(); comparison?.reset(); status();
    document.body.dataset.view = view;
    $("heading").textContent = titles[view][0]; $("intro").textContent = titles[view][1];
    $("translation-options").hidden = view === "help";
    tabs.forEach(tab => {
      const active = tab.dataset.view === view;
      tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
      $(`view-${tab.dataset.view}`).hidden = !active;
    });
    const feedbackBefore = view === "document" ? $("view-document") : view === "image" ? $("view-image") : $("comparison-results");
    feedbackBefore.before($("task-status"), $("cancel"));
    controls();
  }
  for (const tab of tabs) {
    tab.onclick = () => changeView(tab.dataset.view);
    tab.onkeydown = event => {
      const index = tabs.indexOf(tab);
      const next = { ArrowDown: (index + 1) % tabs.length, ArrowUp: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); tabs[next].focus(); changeView(tabs[next].dataset.view);
    };
  }
  $("engine").onchange = $("source-language").onchange = $("target").onchange = savePreferences;
  $("profile").onchange = () => { twpConfig.set("sidebarPreferences", {...twpConfig.get("sidebarPreferences"), profileId:$("profile").value}); resetResult();  status(); };
  $("source").oninput = () => { resetResult(); comparison?.reset(); status(); controls(); };
  $("clear").onclick = () => { $("source").value = ""; resetResult(); comparison?.reset(); status(); controls(); $("source").focus(); };
  $("cancel").onclick = () => cancel();
  for (const button of document.querySelectorAll(".settings-link")) {
    button.onclick = () => twpAIClient.call({ action: "aiOpenSettings" }).catch(error => status(error.message, true));
  }
  $("expand").hidden = workspace;
  $("expand").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(`options/sidepanel.html?workspace=1&view=${view}`) });

  function traditionalTranslate(texts, service, targetLanguage, sourceLanguage = "auto") {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, values) => {
        if (done) return;
        done = true; clearTimeout(timer); legacyAborts.delete(abort);
        if (error) reject(error); else resolve(values);
      };
      const timer = setTimeout(() => finish(new Error("翻译超时，请检查网络或更换服务")), 30000);
      const abort = () => finish(new Error("已取消翻译"));
      legacyAborts.add(abort);
      chrome.runtime.sendMessage({ action: "translateText", translationService: service, sourceLanguage, targetLanguage, sourceArray: texts }, values => {
        const error = chrome.runtime.lastError;
        if (error || !Array.isArray(values) || values.length !== texts.length || values.some(value => typeof value !== "string" || !value.trim())) {
          finish(new Error("翻译失败，请检查网络或更换服务"));
        } else finish(null, values);
      });
    });
  }
  async function openPDFReader(file) {
    try {
      await twpPDFHandoff.send(file, {service:$("engine").value, sourceLanguage:$("source-language").value, targetLanguage:$("target").value, profileId:$("profile").value});
      status("PDF 已在新标签页打开，可在独立阅读器中连续滚动和翻译。");
    } catch { status("未能打开 PDF 阅读器，请重试。", true); }
  }
  async function run(forceRefresh = false) {
    if (busy || !["text", "document", "video"].includes(view)) return;
    if (view === "text") return comparison.run();
    if (view === "document" && files.document?.format === "pdf") return openPDFReader(files.document.file);
    const service = $("engine").value, targetLanguage = $("target").value;
    if (service === "openai" && !$("profile").value) return status("请先在模型与术语设置中添加 AI 服务。", true);

    let document;
    try {
      if (view === "text") {
        if ($("source").value.length > 16000) throw new Error("请将文本控制在 16000 字符以内");
        document = twpDocumentTranslation.parse($("source").value, "txt");
      } else document = files[view]?.document;
      if (!document) throw new Error("请先选择文件");
    } catch (error) { status(error.message, true); return; }
    const token = ++job, activeView = view;
    const file = files[activeView];
    const bilingual = activeView === "video" ? $("bilingual-subtitles").checked : $("bilingual-document").checked;
    resetResult(); busy = true; controls(); status("正在翻译…");
    try {
      const translations = await translateDocument(document, service, targetLanguage, {...readOptions(),profileId: $("profile").value, cacheLabel:file?.name, requestSource: view==='video'?'video':'document', forceRefresh}, () => token === job);
      if (token !== job) return;
      output = twpDocumentTranslation.render(document, translations, bilingual);
      $("result").textContent = output;
      $("result-card").hidden = false;
      if (file) {
        downloadName = `${file.name.replace(/\.[^.]+$/, "")}.${bilingual ? "bilingual" : targetLanguage}.${document.format}`;
        $("download").hidden = false;
        $("download").textContent = bilingual ? "下载双语文件 ↓" : "下载译文 ↓";
      }
      status("翻译完成");
    } catch (error) { if (token === job) { resetResult(); status(error.message || "翻译失败，请重试", true); } }
    finally { if (token === job) { busy = false; controls(); } }
  }
  for (const id of ["translate-text", "translate-document", "translate-video"]) $(id).onclick = () => run();
  $("retranslate-document").onclick = () => run(true);
  $("source").onkeydown = event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
  };
  document.addEventListener("keydown", event => { if (event.key === "Escape" && busy) cancel(); });
  for (const [kind, inputId, nameId] of [["document", "document-file", "document-name"], ["video", "subtitle-file", "subtitle-name"]]) {
    const prefix = kind === 'video' ? 'subtitle' : 'document';
    const upload = $(inputId).closest('.upload-card'), picker = upload.querySelector('.upload-button'), originalLabel = picker.textContent;
    function preview(file, text = '', description = '') {
      $(`${prefix}-preview`).hidden = !file;upload.classList.toggle('has-file', !!file);
      picker.textContent = file ? '更换文件 ↑' : originalLabel;
      $(`${prefix}-file-meta`).textContent = file ? `${file.name.split('.').pop().toUpperCase()} · ${(file.size / 1024).toFixed(1)} KB${description ? ' · ' + description : ''}` : '';
      $(`${prefix}-sample`).textContent = text ? text.slice(0, 1500) + (text.length > 1500 ? '\n…（仅预览前 1500 字符）' : '') : 'PDF 已打开独立阅读器，可查看原文与译文。';
    }
    $(`${prefix}-remove`).onclick = () => {++fileVersions[kind];files[kind] = null;$(inputId).value = '';$(nameId).textContent = '尚未选择文件';preview(null);resetResult();status();controls();};
    $(inputId).onchange = async () => {
      const version = ++fileVersions[kind];
      const file = $(inputId).files[0];
      files[kind] = null; resetResult(); status(); controls();
      preview(null);
      $(nameId).textContent = "尚未选择文件";
      if (!file) return;
      try {
        const format = file.name.split(".").pop().toLowerCase();
        if (!(kind === "document" ? ["txt", "pdf"] : ["srt", "vtt"]).includes(format)) throw new Error(kind === "document" ? "目前文档支持 PDF / TXT 文件" : "请选择 SRT 或 VTT 字幕文件");
        if (format === "pdf") {
          if (file.size > 50 * 1024 * 1024) throw new Error("PDF 文件过大，请选择不超过 50 MB 的文件");
          files.document = {name:file.name, format:"pdf", file};
          $(nameId).textContent = file.name;
          preview(file);
          await openPDFReader(file);
          return;
        }
        if (file.size > 200 * 1024) throw new Error("文件过大，请选择不超过 200 KB 的文件");
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
        catch { throw new Error("无法读取 UTF-8 文本，请将文件另存为 UTF-8 编码后重试"); }
        if (version !== fileVersions[kind]) return;
        const document = twpDocumentTranslation.parse(text, format);
        files[kind] = { name: file.name, document };
        $(nameId).textContent = `${file.name} · ${document.segments.length} 段 · ${text.length.toLocaleString()} 字符`;
        preview(file, text, `${document.segments.length} 段 · ${text.length.toLocaleString()} 字符`);
      } catch (error) {
        if (version === fileVersions[kind]) { $(inputId).value = ""; status(error.message, true); }
      }
      finally { if (version === fileVersions[kind]) { busy = false; controls(); } }
    };
  }
  $("bilingual-document").onchange = $("bilingual-subtitles").onchange = () => { resetResult(); status(); };
  $("copy").onclick = async () => {
    try { await navigator.clipboard.writeText(output); $("copy").textContent = "已复制"; }
    catch { status("未能访问剪贴板，请选中译文后复制。", true); }
  };
  $("download").onclick = () => {
    if (!output || !downloadName || busy) return;
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = downloadName;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  twpConfig.onChanged(name => {
    if (!["aiActiveProfile", "aiProfiles", "aiTranslationSettings", "aiCustomExperts", "aiCustomGlossaries"].includes(name)) return;
    if (busy) cancel("模型或术语配置已变化，请重新翻译。");
    modelOptions(); presetOptions(); styleHint(); imageTool?.presets(); imageTool?.resetTranslation(); comparison?.refreshServices(); comparison?.reset();
  });
  window.addEventListener("pagehide", () => { cancel(); });
  const requestedView = new URLSearchParams(location.search).get("view");
  if (Object.hasOwn(titles, requestedView)) changeView(requestedView);
  if (!workspace && chrome.storage.session) {
    const windowInfo = await chrome.windows.getCurrent();
    const key = `sidebarNavigation:${windowInfo.id}`;
    const navigate = value => { if (value && Object.hasOwn(titles, value.view)) changeView(value.view); };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes[key]) navigate(changes[key].newValue);
    });
    navigate((await chrome.storage.session.get(key))[key]);
  }
  function cancelRequests() {
    for (const abort of [...legacyAborts]) abort();
    twpAIClient.cancel("sidebar");
  }
  async function translateDocument(sourceDocument, service, target, options, current) {
    const translations = [];
    const batchLimit = options.batchLimit || 20, characterLimit = options.characterLimit || 8000;
    for (let offset = 0; offset < sourceDocument.segments.length;) {
      if (!current()) throw new Error("已取消翻译");
      const batch = []; let size = 0;
      while (offset < sourceDocument.segments.length && batch.length < batchLimit && (batch.length === 0 || size + sourceDocument.segments[offset].text.length <= characterLimit)) {
        const text = sourceDocument.segments[offset++].text; batch.push(text); size += text.length;
      }
      const values = service === "openai"
        ? await twpAIClient.translate(batch, target, options.context || (view === "video" ? "Video subtitles" : "Text translation"), "sidebar", {...options,requestSource:options.requestSource||view})
        : await traditionalTranslate(batch, service, target, options.sourceLanguage);
      if (!current()) throw new Error("已取消翻译");
      translations.push(...values);
      options.onBatch?.({completed: translations.length, total: sourceDocument.segments.length, translations: [...translations]});
    }
    return translations;
  }
  function presetOptions() {
    const saved = twpConfig.get("sidebarPreferences"), defaults = twpConfig.get("aiTranslationSettings");
    for (const [id, list, value] of [
      ["text-expert", twpAIPresets.allExperts(twpConfig.get("aiCustomExperts")), saved.expertId || defaults.domain],
      ["text-glossary", twpAIPresets.allGlossaries(twpConfig.get("aiCustomGlossaries")), twpAIPresets.normalizeGlossaryId(saved.glossaryId || defaults.glossaryId || "public-default")],
      ["text-style", twpAIPresets.styles, saved.styleId || defaults.styleId || "faithful"],
    ]) {
      $(id).replaceChildren(...list.map(item => new Option(item.name, item.id))); $(id).value = value;
      if (!$(id).value) $(id).selectedIndex = 0;
    }
    $("style-chips").replaceChildren(...twpAIPresets.styles.map(item => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = item.name; button.dataset.style = item.id;
      button.setAttribute("aria-pressed", String(item.id === $("text-style").value));
      button.onclick = () => { $("text-style").value = item.id; savePresets(); }; return button;
    }));
  }
  function savePresets() {
    twpConfig.set("sidebarPreferences", {...twpConfig.get("sidebarPreferences"), ...readOptions()});
    for (const chip of $("style-chips").children) chip.setAttribute("aria-pressed", String(chip.dataset.style === $("text-style").value));
    comparison?.reset(); status();
    styleHint();
  }
  function styleHint() {
    $('ai-style-hint').textContent = $('text-style').value === 'auto'
      ? '自动匹配：AI 根据原文内容和体裁选择语气与措辞；不会切换模型、专家或术语库。仅对所选自定义 AI 生效。'
      : '专家、风格和术语库用于所选自定义 AI 翻译；免费服务不使用这些提示词。';
  }
  function readOptions() { return {sourceLanguage:$("source-language").value, expertId:$("text-expert").value, styleId:$("text-style").value, glossaryId:$("text-glossary").value}; }
  presetOptions();
  styleHint();
  $("text-mode").value = preferences.textMode || "bilingual";
  $("text-expert").onchange = $("text-glossary").onchange = $("text-style").onchange = savePresets;
  $("paste").onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.length > 16000) throw new Error("请将文本控制在 16000 字符以内");
      $("source").value = text; $("source").oninput();
    } catch (error) { status(error.message.includes("16000") ? error.message : "无法读取剪贴板，请在输入框按 Ctrl + V 粘贴。", true); $("source").focus(); }
  };
  comparison = twpTextComparison.create({status, setBusy: value => { busy = value; controls(); }, translateDocument, cancelRequests, readOptions});
  imageTool = twpImageTranslation.create({status, setBusy: value => {busy = value; controls();}, translateDocument, readOptions});
  modelOptions(); controls();
  if(captured) {
    const cleanURL=new URL(location.href);cleanURL.searchParams.delete('capture');history.replaceState(null,'',cleanURL);
    if([...$('profile').options].some(o=>o.value===captured.options.profileId))$('profile').value=captured.options.profileId;
    await imageTool.loadCapture(captured);
  } else if(captureError)status(captureError,true);
})();
