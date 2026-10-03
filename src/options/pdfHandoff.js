// SPDX-License-Identifier: MPL-2.0
"use strict";
// File objects travel only between extension pages in memory, never via storage.
const twpPDFHandoff = (() => {
  async function send(file, preferences) {
    const token = crypto.randomUUID(), channel = new BroadcastChannel(`twp-pdf:${token}`);
    let timer;
    const close = () => { clearTimeout(timer); channel.close(); window.removeEventListener("pagehide", close); };
    timer = setTimeout(close, 60000); window.addEventListener("pagehide", close, {once: true});
    channel.onmessage = ({data}) => {
      if (data?.type === "ready") channel.postMessage({type: "file", file, preferences});
      if (data?.type === "received") close();
    };
    try { await chrome.tabs.create({url: chrome.runtime.getURL(`options/pdf.html?transfer=${token}`)}); }
    catch (error) { close(); throw error; }
  }
  function receive(accept, unavailable) {
    const token = new URLSearchParams(location.search).get("transfer");
    if (!token || !/^[a-f0-9-]{36}$/.test(token)) return;
    history.replaceState(null, "", location.pathname);
    const channel = new BroadcastChannel(`twp-pdf:${token}`);
    const timer = setTimeout(() => { channel.close(); unavailable(); }, 10000);
    channel.onmessage = ({data}) => {
      if (data?.type !== "file" || !(data.file instanceof File)) return;
      clearTimeout(timer); channel.postMessage({type: "received"}); channel.close();
      void accept(data.file, data.preferences);
    };
    channel.postMessage({type: "ready"});
    window.addEventListener("pagehide", () => { clearTimeout(timer); channel.close(); }, {once: true});
  }
  return {send, receive};
})();
