"use strict";
const twpTextComparison = (() => {
  function create({status, setBusy, translateDocument, cancelRequests, readOptions}) {
    const $ = id => document.getElementById(id);
    const results = new Map();
    let generation = 0, busy = false;
    let selected = twpConfig.get("textComparisonServices") || ["google", "bing", "yandex"];
    const services = () => [
      {id:"google", name:"谷歌翻译", service:"google"},
      {id:"bing", name:"微软翻译", service:"bing"},
      {id:"yandex", name:"Yandex", service:"yandex"},
      ...twpConfig.get("aiProfiles").map(item => ({id:`ai:${item.id}`, name:`${item.name} · ${item.model}`, service:"openai", profileId:item.id})),
    ];
    function save() { twpConfig.set("textComparisonServices", selected); }
    function updateControls() {
      $("compare-summary").textContent = `翻译服务 · 已选 ${selected.length} 个`;
      for (const input of $("compare-list").querySelectorAll("input")) input.disabled = busy;
      for (const node of document.querySelectorAll("#comparison-results button, #text-settings select, #text-settings button, #text-mode")) node.disabled = busy;
      $("translate-text").disabled = busy || !$("source").value.trim() || !selected.length;
      $("ai-style-hint").textContent = selected.some(id => id.startsWith("ai:"))
        ? "专家、风格和术语库应用于所选 AI 模型。免费服务按常规方式翻译。"
        : "当前仅选择免费服务。添加 AI 模型后，专家、风格和术语库才会影响译文。";
    }
    function refreshServices() {
      const available = services();
      selected = [...new Set(selected)].filter(id => available.some(item => item.id === id));
      $("compare-list").replaceChildren();
      for (const [title, items] of [["免费服务", available.filter(item => !item.profileId)], ["我的 AI 模型", available.filter(item => item.profileId)]]) {
        const group = document.createElement("fieldset"), legend = document.createElement("legend");
        legend.textContent = title; group.append(legend);
        for (const item of items) {
          const label = document.createElement("label"), input = document.createElement("input"), name = document.createElement("span");
          input.type = "checkbox"; input.value = item.id; input.checked = selected.includes(item.id); name.textContent = item.name;
          input.onchange = () => {
            selected = input.checked ? [...selected, item.id] : selected.filter(id => id !== item.id);
            results.delete(item.id); save(); render(); updateControls();
          };
          label.append(input, name); group.append(label);
        }
        if (!items.length) { const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = "在模型设置中添加服务后，即可勾选对比。"; group.append(hint); }
        $("compare-list").append(group);
      }
      render(); updateControls();
    }
    function reset() { results.clear(); render(); updateControls(); }
    function download(text, name) {
      const url = URL.createObjectURL(new Blob([text], {type:"text/plain;charset=utf-8"}));
      const link = document.createElement("a"); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    function button(label, action) {
      const node = document.createElement("button"); node.type = "button"; node.className = "quiet"; node.textContent = label; node.onclick = action; return node;
    }
    function render() {
      $("comparison-results").replaceChildren();
      const bilingual = $("text-mode").value === "bilingual";
      for (const id of selected) {
        const service = services().find(item => item.id === id);
        if (!service) continue;
        const result = results.get(id);
        const card = document.createElement("article"); card.className = "comparison-card"; card.dataset.service = id;
        const header = document.createElement("div"); header.className = "comparison-heading";
        const title = document.createElement("h2"); title.textContent = service.name;
        const remove = button("×", () => { selected = selected.filter(key => key !== id); results.delete(id); save(); refreshServices(); });
        remove.setAttribute("aria-label", `移除 ${service.name}`); header.append(title, remove); card.append(header);
        if (result?.state === "done") {
          if (service.profileId) { const meta = document.createElement("p"); meta.className = "hint"; meta.textContent = result.labels; card.append(meta); }
          const body = document.createElement("div"); body.className = "comparison-body";
          twpDocumentTranslation.pairs(result.document, result.translations).forEach(segment => {
            const pair = document.createElement("div"); pair.className = "bilingual-pair";
            if (bilingual) { const original = document.createElement("p"); original.className = "original"; original.textContent = segment.text; original.lang = ""; pair.append(original); }
            const translated = document.createElement("p"); translated.className = "translation"; translated.textContent = segment.translation; translated.lang = result.target; pair.append(translated); body.append(pair);
          });
          const output = twpDocumentTranslation.render(result.document, result.translations, bilingual);
          const actions = document.createElement("div"); actions.className = "comparison-actions";
          const copy = button(bilingual ? "复制双语" : "复制译文", async () => {
            try { await navigator.clipboard.writeText(output); copy.textContent = "已复制"; } catch { status("无法访问剪贴板，请选中结果复制。", true); }
          });
          actions.append(copy, button("导出 TXT", () => download(output, `translation-${service.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}-${bilingual ? "bilingual" : result.target}.txt`)), button("重新翻译", () => run([id], true)));
          card.append(body, actions);
        } else {
          const message = document.createElement("p"); message.className = "comparison-message";
          message.textContent = result?.message || "译文将在这里显示";
          if (result?.state === "error") { message.dataset.error = "true"; card.append(message, button("重试此服务", () => run([id]))); }
          else card.append(message);
        }
        $("comparison-results").append(card);
      }
      if (!selected.length) { const empty = document.createElement("p"); empty.className = "hint"; empty.textContent = "请在「翻译服务」中至少选择一个服务。"; $("comparison-results").append(empty); }
      updateControls();
    }
    async function run(ids = [...selected], forceRefresh = false) {
      if (busy || !ids.length) return;
      let sourceDocument;
      try {
        if ($("source").value.length > 16000) throw new Error("请将文本控制在 16000 字符以内");
        sourceDocument = twpDocumentTranslation.parse($("source").value, "txt");
      }
      catch (error) { status(error.message, true); return; }
      const token = ++generation;
      const options = {...readOptions(), forceRefresh}, target = $("target").value;
      const labels = [$("text-expert"), $("text-style"), $("text-glossary")].map(select => select.selectedOptions[0]?.textContent).join(" · ");
      const queue = services().filter(item => ids.includes(item.id));
      queue.forEach(item => results.set(item.id, {state:"pending", message:"等待翻译…"}));
      busy = true; setBusy(true); status("正在对比翻译…"); render();
      let completed = 0, failed = 0;
      async function consume() {
        while (queue.length && token === generation) {
          const service = queue.shift();
          results.set(service.id, {state:"pending", message:"正在翻译…"}); render();
          try {
            const translations = await translateDocument(sourceDocument, service.service, target, { ...options, profileId: service.profileId }, () => token === generation);
            if (token !== generation) return;
            results.set(service.id, {state:"done", document:sourceDocument, translations, target, labels}); completed++;
          } catch (error) {
            if (token !== generation) return;
            results.set(service.id, {state:"error", message:error.message || "翻译失败"}); failed++;
          }
          if (token === generation) { render(); status(`已完成 ${completed} 个服务${failed ? `，${failed} 个失败，可单独重试` : ""}`); }
        }
      }
      try { await Promise.all([consume(), consume(), consume()]); }
      finally { if (token === generation) { busy = false; setBusy(false); updateControls(); } }
    }
    function cancel() {
      generation++; cancelRequests(); busy = false;
      for (const [id, result] of results) if (result.state === "pending") results.set(id, {state:"error", message:"已取消翻译"});
      render();
    }
    $("text-mode").onchange = () => {
      twpConfig.set("sidebarPreferences", {...twpConfig.get("sidebarPreferences"), textMode:$("text-mode").value}); render();
    };
    refreshServices();
    return {run, reset, cancel, refreshServices, updateControls};
  }
  return {create};
})();
