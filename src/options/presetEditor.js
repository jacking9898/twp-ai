"use strict";
// Config contains prompts and terms only; model credentials stay in IndexedDB.
const twpPresetEditor = (() => {
  const $ = id => document.getElementById(id);
  const experts = () => twpAIPresets.allExperts(twpConfig.get("aiCustomExperts"));
  const libraries = () => twpAIPresets.allGlossaries(twpConfig.get("aiCustomGlossaries"));
  function options(id, items, selected) {
    $(id).replaceChildren(...items.map(item => new Option(item.name, item.id)));
    $(id).value = selected;
    if (!$(id).value) $(id).selectedIndex = 0;
  }
  function refresh() {
    const settings = twpConfig.get("aiTranslationSettings");
    options("domain", experts(), $("domain").value || settings.domain);
    options("default-style", twpAIPresets.styles, $("default-style").value || settings.styleId || "faithful");
    options("default-library", libraries(), twpAIPresets.normalizeGlossaryId($("default-library").value || settings.glossaryId || "public-default"));
    options("expert-edit", [{id:"", name:"新建专家"}, ...experts()], $("expert-edit").value);
    options("library-edit", [{id:"", name:"新建术语库"}, ...libraries().filter(item => item.id !== "default")], $("library-edit").value);
  }
  function sourceLink(id, item) {
    $(id).hidden = !item?.source;
    if (item?.source) $(id).href = item.source;
  }
  function loadExpert() {
    const item = experts().find(item => item.id === $("expert-edit").value);
    $("expert-name").value = item?.name || "";
    $("expert-prompt").value = item?.prompt || "";
    $("expert-delete").disabled = !item || item.builtin;
    $("expert-save").textContent = item?.builtin ? "另存为我的专家" : "保存专家";
    sourceLink("expert-source", item);
    $("expert-status").textContent = item?.source ? "公开专家任务提示词；运行时会填入目标语言，并应用你的术语和所选风格。" : "专家可用于网页、划词、文本和文档 AI 翻译。";
  }
  function loadLibrary() {
    const item = libraries().find(item => item.id === $("library-edit").value);
    const langs = item?.translations ? Object.keys(item.translations) : [item?.targetLanguage || ""];
    options("library-language", (item?.builtin ? langs : ["", ...Object.keys(twpLang.getLanguageList())]).map(code => ({ id: code, name: !code || code === "auto" ? "所有目标语言 / 保留原词" : twpLang.getLanguageList()[code] || code })), langs.includes("zh-CN") ? "zh-CN" : langs[0]);
    $("library-name").value = item?.name || "";
    $("library-delete").disabled = !item || item.builtin;
    $("library-save").textContent = item?.builtin ? "另存为我的术语库" : "保存术语库";
    sourceLink("library-source", item);
    loadTerms();
  }
  function loadTerms() {
    const item = libraries().find(item => item.id === $("library-edit").value);
    const entries = item?.translations ? item.translations[$("library-language").value] || [] : item?.entries || [];
    $("library-terms").value = entries.map(([a,b]) => `${a} = ${b}`).join("\n");
    $("library-status").textContent = entries.length
      ? `${entries.length} 条术语，按目标语言应用，可另存后编辑。`
      : "当前语言暂无词条，可另存后补充。";
  }
  function save(kind) {
    const expert = kind === "expert";
    const key = expert ? "aiCustomExperts" : "aiCustomGlossaries";
    const items = twpConfig.get(key);
    const selected = $(kind + "-edit").value;
    const name = $(kind + "-name").value.trim();
    try {
      if (!name || name.length > 80) throw new Error("名称需为 1–80 字符");
      const current = items.find(item => item.id === selected);
      if (!current && items.length >= 60) throw new Error("自定义配置最多 60 组");
      const id = current?.id || `custom-${crypto.randomUUID()}`;
      let item;
      if (expert) {
        const prompt = $("expert-prompt").value.trim();
        if (!prompt || prompt.length > 6000) throw new Error("提示词需为 1–6000 字符");
        item = {id, name, prompt};
      } else {
        const entries = twpAIPresets.parseGlossary($("library-terms").value);
        const language = $("library-language").value;
        item = {id, name, entries, targetLanguage: language === "auto" ? "" : language};
      }
      twpConfig.set(key, [...items.filter(item => item.id !== id), item]);
      refresh(); $(kind + "-edit").value = id;
      if (expert) loadExpert(); else loadLibrary();
      $(kind + "-status").textContent = "已保存，可以在翻译偏好或工作台中选择。";
    } catch (error) { $(kind + "-status").textContent = error.message; }
  }
  function remove(kind) {
    const key = kind === "expert" ? "aiCustomExperts" : "aiCustomGlossaries";
    const id = $(kind + "-edit").value;
    if (!id.startsWith("custom-")) return;
    const settings = twpConfig.get("aiTranslationSettings");
    const field = kind === "expert" ? "domain" : "glossaryId";
    if (settings[field] === id) twpConfig.set("aiTranslationSettings", {...settings, [field]: kind === "expert" ? "general" : "public-default"});
    twpConfig.set(key, twpConfig.get(key).filter(item => item.id !== id));
    $(kind + "-edit").value = ""; refresh();
    if (kind === "expert") loadExpert(); else loadLibrary();
  }
  function init() {
    refresh(); loadExpert(); loadLibrary();
    $("expert-edit").onchange = loadExpert;
    $("library-edit").onchange = loadLibrary;
    $("library-language").onchange = () => {
      if (libraries().find(item => item.id === $("library-edit").value)?.builtin) loadTerms();
    };
    for (const kind of ["expert", "library"]) {
      $(kind + "-form").onsubmit = event => { event.preventDefault(); save(kind); };
      $(kind + "-delete").onclick = () => remove(kind);
      $(kind + "-new").onclick = () => { $(kind + "-edit").value = ""; if (kind === "expert") loadExpert(); else loadLibrary(); $(kind + "-name").focus(); };
    }
  }
  return { init };
})();
