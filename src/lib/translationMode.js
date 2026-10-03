"use strict";

// Shared by both desktop popup layouts and the settings page.
twpConfig.onReady().then(() => {
  const controls = document.querySelectorAll("[data-translation-mode]");
  function update(value) {
    controls.forEach(control => { control.value = value; });
  }
  update(twpConfig.get("pageTranslationMode"));
  const aiLink = document.createElement("a");
  aiLink.href = chrome.runtime.getURL("options/ai.html");
  aiLink.target = "_blank";
  aiLink.textContent = chrome.i18n.getUILanguage().startsWith("zh") ? "AI 服务 / 术语 / 悬浮按钮设置" : "AI services / glossary / floating button";
  aiLink.style.cssText = "display:block;margin:12px 6px;font-size:13px;color:#4382e7";
  const firstControl = controls[0];
  if (firstControl) firstControl.parentElement.after(aiLink);
  function updateAI() {
    const ai = twpConfig.get("pageTranslatorService") === "openai";
    controls.forEach(control => {
      control.disabled = ai;
      if (ai) control.value = "bilingual";
    });
  }
  updateAI();
  controls.forEach(control => {
    control.addEventListener("change", () => {
      twpConfig.set("pageTranslationMode", control.value);
    });
  });
  twpConfig.onChanged((name, value) => {
    if (name === "pageTranslationMode") update(value);
    if (name === "pageTranslatorService" || name === "pageTranslationMode") updateAI();
  });

  const status = document.querySelector("[data-translation-status]");
  if (!status) return;
  let tabId;
  let state = "original";
  function showState(value) {
    state = value;
    const bilingual = twpConfig.get("pageTranslationMode") === "bilingual";
    status.hidden = !bilingual || state === "original" || state === "translated";
    status.textContent = twpI18n.getMessage(state === "unavailable"
      ? "msgRefreshPageForTranslation" : state === "error" ? "msgBilingualTranslationFailed" : "lblTranslating");
    if (state !== "unavailable") {
      document.dispatchEvent(new CustomEvent("twp-page-state", { detail: state }));
    }
  }
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action === "setPageLanguageState" && sender.tab?.id === tabId && !sender.frameId) {
      showState(request.pageLanguageState);
    }
  });
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    tabId = tabs[0]?.id;
    if (tabId === undefined) return;
    chrome.tabs.sendMessage(tabId, { action: "getCurrentPageLanguageState" }, { frameId: 0 }, result => {
      const error = chrome.runtime.lastError;
      showState(error || !result ? "unavailable" : result);
    });
  });
  twpConfig.onChanged(name => {
    if (name === "pageTranslationMode") showState(state);
  });
});
