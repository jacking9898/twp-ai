"use strict";
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!["openTranslationSidebar", "openTranslationWorkspace"].includes(request?.action)) return;
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) {
    sendResponse({ ok: false, error: "请从网页悬浮按钮打开翻译侧边栏" });
    return;
  }
  // Keep this call in the message handler's user gesture: awaiting config or
  // tab queries first can cause Chromium to reject sidePanel.open().
  const view = ["text", "document", "video", "image", "help"].includes(request.view) ? request.view : "";
  if (request.action === "openTranslationWorkspace") {
    chrome.tabs.create({ url: chrome.runtime.getURL(`options/sidepanel.html?workspace=1&view=${view || "text"}`) })
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false, error: "无法打开翻译工作台，请重试" }));
    return true;
  }
  const opening = chrome.sidePanel?.open
    ? chrome.sidePanel.open({ windowId: sender.tab.windowId })
    : chrome.tabs.create({ url: chrome.runtime.getURL(`options/sidepanel.html${view ? `?view=${view}` : ""}`) });
  // Persist only the requested tool, never source text. The panel may still be
  // loading, or may already be open in this window. Do not await before open().
  const navigation = view && chrome.sidePanel?.open && chrome.storage?.session
    ? chrome.storage.session.set({ [`sidebarNavigation:${sender.tab.windowId}`]: { view, time: Date.now() } })
    : undefined;
  Promise.all([opening, navigation]).then(() => sendResponse({ ok: true }), () => {
    sendResponse({ ok: false, error: "侧边栏未能打开，请重新点击上方按钮；更新扩展后请先刷新网页。" });
  });
  return true;
});
