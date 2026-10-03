"use strict";
const twpInteractiveTranslator = (() => {
  // Platform detection is populated asynchronously by config.onReady().
  const api = { get available() { return !!document.body && !platformInfo.isMobile?.any; } };
  api.ready = pageTranslator.ready.then(() => {
    if (!api.available) return;
    const excluded = 'input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[translate="no"],.notranslate,nav,pre,code,svg,math,canvas,video';
    const host = document.createElement("div");
    host.id = "twp-interactive-ui"; host.className = "notranslate"; host.setAttribute("translate", "no");
    host.style.cssText = 'all:initial!important;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important';
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{--bg:#fff;--fg:#203047;--muted:#6b7c91;--border:#dbe4f0;--accent:#2866db;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color-scheme:light dark}
      *{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;color:var(--fg);cursor:pointer;border:1px solid var(--border);background:var(--bg);border-radius:8px;padding:5px 10px}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button:disabled{opacity:.5;cursor:default}
      #trigger{position:fixed;width:34px;height:34px;padding:3px;border-radius:11px;box-shadow:0 3px 15px #12335a25}#trigger img{width:26px;height:26px;display:block}#trigger[data-dot=true]{width:16px;height:16px;border-radius:50%;padding:0;background:var(--accent);border:3px solid var(--bg)}#trigger[data-dot=true] img{display:none}
      #popup{position:fixed;width:330px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:14px;padding:15px;box-shadow:0 9px 40px #10284030}.heading,.actions{display:flex;gap:8px;align-items:center;justify-content:space-between}.heading strong{font-size:14px}.heading button{border:0;color:var(--muted);padding:2px 5px}#service{font-size:11px;color:var(--muted);margin:5px 0 12px}#result{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.7;max-height:260px;overflow:auto;user-select:text}#result[data-error=true]{color:#cd5b42}.actions{justify-content:flex-end;margin-top:13px}.actions button{font-size:12px}.hint{color:var(--muted);font-size:11px;margin-top:10px}
      @media(prefers-color-scheme:dark){:host{--bg:#1b2635;--fg:#edf3fc;--muted:#a5b5cb;--border:#3a4c62;--accent:#548df5}#result[data-error=true]{color:#ffaa8f}}
    </style><link rel="stylesheet" href="${chrome.runtime.getURL("lib/brandTheme.css")}"><button id="trigger" hidden title="翻译选中文字" aria-label="翻译选中文字"><img alt="" src="${chrome.runtime.getURL("icons/reading.png")}"></button>
    <section id="popup" hidden role="dialog" aria-label="划词翻译结果"><div class="heading"><strong id="title">划词翻译</strong><button id="close" aria-label="关闭划词翻译">关闭</button></div><p id="service"></p><div id="result" role="status" aria-live="polite"></div><div class="actions"><button id="cancel">取消</button><button id="retry" hidden>重试</button><button id="copy" disabled>复制译文</button></div><div class="hint">使用控制面板的翻译服务与目标语言</div></section>`;
    document.documentElement.appendChild(host);
    const $ = id => shadow.getElementById(id);
    const legacyRequests = new Map(), records = new Map();
    let point = { x: 0, y: 0, element: null }, pointerDown = false, press = null;
    let hoverTimer, holdTimer, selectionTimer, scanTimer, modifier = null;
    let selection = null, lastAutomatic = "", resultText = "", selectionVersion = 0;
    const hoverSettings = () => twpConfig.get("hoverTranslationSettings");
    const selectionEnabled = () => twpConfig.get("showTranslateSelectedButton") === "yes";
    const selectionTrigger = () => twpConfig.get("selectionTranslationSettings").trigger;
    const isExcluded = element => !(element instanceof Element) || !!element.closest(excluded) || element.isContentEditable;
    const inUI = event => event.composedPath().includes(host) || event.target?.closest?.("#twp-floating");
    const cancelGroup = group => { twpAIClient.cancel(group); legacyRequests.get(group)?.(); };
    function translate(text, group) {
      const service = pageTranslator.getService(), language = twpConfig.get("targetLanguage");
      if (!text.trim() || text.length > 16000) return Promise.reject(new Error("请将选中文字控制在 16000 字符以内"));
      if (service === "openai") return twpAIClient.translate([text], language, document.title, group).then(values => values[0]);
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (error, values) => {
          if (done) return;
          done = true; clearTimeout(timer); legacyRequests.delete(group);
          if (error) reject(error); else resolve(values[0]);
        };
        const timer = setTimeout(() => finish(new Error("翻译超时，请检查网络或更换服务")), 30000);
        legacyRequests.set(group, () => finish(new Error("已取消翻译")));
        chrome.runtime.sendMessage({ action: "translateText", translationService: service, sourceLanguage: "auto", targetLanguage: language, sourceArray: [text] }, values => {
          const error = chrome.runtime.lastError;
          if (error || !Array.isArray(values) || typeof values[0] !== "string" || !values[0].trim()) finish(new Error("翻译失败，请检查网络或更换服务"));
          else finish(null, values);
        });
      });
    }
    function popupAt(x, y) {
      $("popup").style.left = `${Math.max(12, Math.min(innerWidth - $("popup").offsetWidth - 12, x))}px`;
      $("popup").style.top = `${Math.max(12, Math.min(innerHeight - $("popup").offsetHeight - 12, y + 12))}px`;
    }
    function closePopup() {
      selectionVersion++; cancelGroup("quick-selection");
      $("popup").hidden = true; $("trigger").hidden = true;
    }
    function readSelection() {
      const value = window.getSelection();
      if (!value || value.isCollapsed || !value.rangeCount) return null;
      const range = value.getRangeAt(0);
      const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (isExcluded(element(range.startContainer)) || isExcluded(element(range.endContainer))) return null;
      const text = value.toString().trim();
      if (!text) return null;
      const rects = range.getClientRects(), rect = rects[rects.length - 1] || range.getBoundingClientRect();
      return { text, x: rect.left, y: rect.bottom, signature: `${text}:${rect.left}:${rect.bottom}` };
    }
    api.translateSelection = async (text = "") => {
      const current = readSelection() || selection;
      if (text) selection = { text, x: point.x, y: point.y };
      else if (current) selection = current;
      $("trigger").hidden = true; $("popup").hidden = false;
      $("title").textContent = "划词翻译"; $("result").dataset.error = "false";
      $("copy").disabled = true; $("copy").textContent = "复制译文";
      $("retry").hidden = true; $("cancel").hidden = false;
      $("service").textContent = `${{ bing: "微软翻译", google: "谷歌翻译", yandex: "Yandex", openai: "AI · 自定义模型" }[pageTranslator.getService()] || "翻译"} → ${twpLang.codeToLanguage(twpConfig.get("targetLanguage"))}`;
      cancelGroup("quick-selection"); const version = ++selectionVersion;
      $("result").textContent = "正在翻译…"; popupAt(selection?.x || 12, selection?.y || 80);
      try {
        if (!selection?.text) throw new Error("先在网页正文中选中一段文字，再点击翻译。");
        const translated = await translate(selection.text, "quick-selection");
        if (version !== selectionVersion) return;
        resultText = translated;
        $("result").textContent = resultText; $("copy").disabled = false;
      } catch (error) {
        if (version !== selectionVersion) return;
        $("result").textContent = error.message; $("result").dataset.error = "true"; $("retry").hidden = false;
      } finally {
        if (version === selectionVersion) { $("cancel").hidden = true; popupAt(selection?.x || 12, selection?.y || 80); }
      }
    };
    function processSelection() {
      if (pointerDown) return;
      if (document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      const next = readSelection();
      if (!next) { $("trigger").hidden = true; lastAutomatic = ""; return; }
      selection = next;
      if (!selectionEnabled()) { $("trigger").hidden = true; return; }
      const trigger = selectionTrigger();
      if (["icon", "dot"].includes(trigger)) {
        $("trigger").dataset.dot = String(trigger === "dot"); $("trigger").hidden = false;
        $("trigger").style.left = `${Math.max(8, Math.min(innerWidth - 42, next.x))}px`;
        $("trigger").style.top = `${Math.max(8, Math.min(innerHeight - 42, next.y + 6))}px`;
      } else if (trigger === "direct" && lastAutomatic !== next.signature) {
        lastAutomatic = next.signature; void api.translateSelection();
      }
    }
    function scheduleSelection() {
      clearTimeout(selectionTimer); selectionTimer = setTimeout(processSelection, 180);
    }
    $("trigger").onpointerdown = event => event.preventDefault();
    $("trigger").onclick = () => void api.translateSelection();
    $("retry").onclick = () => void api.translateSelection(selection?.text);
    $("close").onclick = closePopup;
    $("cancel").onclick = () => { selectionVersion++; cancelGroup("quick-selection"); $("result").textContent = "已取消翻译"; $("cancel").hidden = true; $("retry").hidden = false; };
    $("copy").onclick = async () => { try { await navigator.clipboard.writeText(resultText); $("copy").textContent = "已复制"; } catch { $("copy").textContent = "请选中译文复制"; } };

    function valid(record) { return record.piece.nodes.every((node, i) => node.isConnected && node.textContent === record.piece.source[i]); }
    function restoreRecord(record) {
      record.version++; cancelGroup(record.group); record.element?.remove(); record.element = null; record.state = "original";
    }
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer); scanTimer = setTimeout(() => {
        for (const [key, record] of records) if (!valid(record)) { restoreRecord(record); records.delete(key); }
        if (!records.size) observer.disconnect();
      }, 150);
    });
    function clearParagraphs() {
      clearTimeout(hoverTimer); clearTimeout(holdTimer); clearTimeout(scanTimer);
      records.forEach(restoreRecord); records.clear(); observer.disconnect();
    }
    async function translateParagraph(effect = hoverSettings().effect) {
      if (!hoverSettings().enabled || pageTranslator.getState() !== "original" || readSelection() || isExcluded(point.element)) return;
      const piece = bilingualTranslator.paragraphAt(point.element, point.x, point.y);
      if (!piece) return;
      const key = piece.nodes[0]; let record = records.get(key);
      if (record && !valid(record)) { restoreRecord(record); records.delete(key); record = null; }
      if (effect === "restore" || effect === "toggle" && record?.state !== "original" && record) {
        if (record) restoreRecord(record);
        return;
      }
      if (record && ["loading", "translated"].includes(record.state)) return;
      if (!record) {
        if (records.size >= 80) { const oldest = records.keys().next().value; restoreRecord(records.get(oldest)); records.delete(oldest); }
        record = { piece, version: 0, group: `hover-${crypto.randomUUID()}`, state: "original", element: null };
        records.set(key, record);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      }
      const version = ++record.version; record.state = "loading";
      record.element?.remove();
      record.element = bilingualTranslator.renderParagraph(piece, "正在翻译…", twpConfig.get("targetLanguage"));
      record.element?.setAttribute("data-twp-interactive", "loading");
      try {
        const text = await translate(piece.source.join(""), record.group);
        if (version !== record.version || !valid(record)) return;
        record.element?.remove();
        record.element = bilingualTranslator.renderParagraph(piece, text, twpConfig.get("targetLanguage"));
        record.element?.setAttribute("data-twp-interactive", "translated"); record.state = "translated";
      } catch (error) {
        if (version !== record.version || !valid(record)) return;
        record.element?.remove();
        record.element = bilingualTranslator.renderParagraph(piece, `${error.message}（再次触发可重试）`, twpConfig.get("targetLanguage"));
        record.element?.setAttribute("data-twp-interactive", "error"); record.state = "original";
      }
    }
    document.addEventListener("pointermove", event => {
      const previous = point.element;
      point = { x: event.clientX, y: event.clientY, element: event.target };
      if (press && Math.hypot(point.x - press.x, point.y - press.y) > 7) { clearTimeout(holdTimer); press = null; }
      if (previous !== point.element) {
        clearTimeout(hoverTimer);
        if (hoverSettings().enabled && hoverSettings().trigger === "direct" && !pointerDown && !inUI(event)) {
          hoverTimer = setTimeout(() => void translateParagraph("translate"), 650);
        }
      }
    }, { passive: true });
    document.addEventListener("pointerdown", event => {
      if (inUI(event)) return;
      pointerDown = true; closePopup(); clearTimeout(hoverTimer);
      if (event.button !== 0 || isExcluded(event.target) || event.target.closest("a")) return;
      point = { x: event.clientX, y: event.clientY, element: event.target }; press = { x: point.x, y: point.y };
      if (hoverSettings().enabled && hoverSettings().trigger === "hold") holdTimer = setTimeout(() => { if (press && !readSelection()) void translateParagraph(); }, 700);
    });
    document.addEventListener("pointerup", event => { pointerDown = false; press = null; clearTimeout(holdTimer); if (!inUI(event)) scheduleSelection(); });
    document.addEventListener("pointercancel", () => { pointerDown = false; press = null; clearTimeout(holdTimer); });
    document.addEventListener("selectionchange", scheduleSelection);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { closePopup(); clearTimeout(hoverTimer); clearTimeout(holdTimer); modifier = null; return; }
      if (inUI(event) || isExcluded(event.target) && event.target !== document.body || event.isComposing) return;
      if (["Control", "Shift", "Alt"].includes(event.key) && !event.repeat && [event.ctrlKey, event.shiftKey, event.altKey, event.metaKey].filter(Boolean).length === 1) modifier = { key: event.key, chord: false };
      else if (modifier && event.key !== modifier.key) modifier.chord = true;
    }, true);
    document.addEventListener("keyup", event => {
      const current = modifier;
      if (current?.key === event.key) {
        modifier = null;
        if (current.chord || event.isComposing || inUI(event) || isExcluded(event.target) && event.target !== document.body) return;
        const selected = readSelection();
        if (selected) {
          if (selectionEnabled() && selectionTrigger() === event.key) { selection = selected; void api.translateSelection(); }
        } else if (hoverSettings().trigger === event.key) void translateParagraph();
      } else if (!inUI(event)) scheduleSelection();
    }, true);
    const resetTransient = () => { pointerDown = false; press = null; modifier = null; clearTimeout(holdTimer); clearTimeout(hoverTimer); $("trigger").hidden = true; };
    window.addEventListener("blur", resetTransient);
    window.addEventListener("scroll", () => { clearTimeout(hoverTimer); clearTimeout(holdTimer); $("trigger").hidden = true; }, true);
    window.addEventListener("resize", closePopup);
    pageTranslator.onPageLanguageStateChange(() => clearParagraphs());
    twpConfig.onChanged(name => {
      if (name === "hoverTranslationSettings") {
        clearTimeout(hoverTimer); clearTimeout(holdTimer);
        if (!hoverSettings().enabled) clearParagraphs();
      }
      if (["pageTranslatorService", "targetLanguage", "aiActiveProfile", "aiTranslationSettings", "aiCustomExperts", "aiCustomGlossaries"].includes(name)) clearParagraphs();
      if (["showTranslateSelectedButton", "selectionTranslationSettings", "pageTranslatorService", "targetLanguage", "aiActiveProfile", "aiTranslationSettings", "aiCustomExperts", "aiCustomGlossaries"].includes(name)) { closePopup(); lastAutomatic = ""; }
    });
    window.addEventListener("pagehide", () => { clearParagraphs(); closePopup(); clearTimeout(selectionTimer); });
  });
  return api;
})();
