"use strict";
const twpAIClient = (() => {
  const pending = new Map();
  function call(request) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(request, result => {
        const error = chrome.runtime.lastError;
        if (error || !result) return reject(new Error("扩展连接已断开，请刷新网页后重试"));
        if (!result.ok) return reject(new Error(result.error || "AI 翻译失败"));
        resolve(result);
      });
    });
  }
  async function translate(texts, targetLanguage, context = "", group = "page", options = {}) {
    const id = crypto.randomUUID();
    pending.set(id, group);
    try {
      return (await call({ action: "aiTranslate", id, targetLanguage, context,
        sourceLanguage: options.sourceLanguage || "auto", cacheLabel: options.cacheLabel,
        forceRefresh: !!options.forceRefresh, documentKey: options.documentKey,
        cacheBySegment: !!options.cacheBySegment,
        profileId: options.profileId, expertId: options.expertId, styleId: options.styleId, glossaryId: options.glossaryId,
        segments: texts.map((text, i) => ({ id: String(i), text })) })).translations;
    } finally { pending.delete(id); }
  }
  function cancel(group = "page") {
    const ids = [...pending].filter(([, value]) => value === group).map(([id]) => id);
    if (ids.length) call({ action: "aiCancel", ids }).catch(() => {});
  }
  return { call, translate, cancel };
})();
