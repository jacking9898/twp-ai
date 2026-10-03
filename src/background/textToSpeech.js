"use strict";

(function () {
  const documentPath = "off_screen.html";
  let creating;

  async function hasAudioDocument() {
    // Firefox loads the audio implementation in its persistent background page.
    if (!chrome.offscreen) return typeof textToSpeech !== "undefined";
    const url = chrome.runtime.getURL(documentPath);
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url],
      });
      return contexts.length > 0;
    }
    return (await clients.matchAll()).some(client => client.url === url);
  }

  async function setupAudioDocument() {
    if (await hasAudioDocument()) return;
    if (!chrome.offscreen) throw new Error("Audio playback is not available in this browser");
    if (!creating) {
      creating = chrome.offscreen.createDocument({
        url: documentPath,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Enable text-to-speech functionality on any website.",
      });
    }
    try {
      await creating;
    } finally {
      // A failed creation must not prevent the next playback attempt.
      creating = null;
    }
  }

  async function sendToAudio(message) {
    if (!chrome.offscreen && typeof textToSpeech !== "undefined") {
      const service = message.action.startsWith("offscreen_bing_")
        ? textToSpeech.bingService : textToSpeech.googleService;
      if (message.action.endsWith("_ttsSpeed")) return service.setAudioSpeed(message.speed);
      if (message.action.endsWith("_ttsVolume")) return service.setAudioVolume(message.volume);
      if (message.action.endsWith("_stopAll")) return service.stopAll();
      return service.textToSpeech(message.text, message.targetLanguage);
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error || response?.error) reject(new Error(error?.message || response.error));
        else resolve(response);
      });
    });
  }

  async function syncSettings() {
    await Promise.all(["google", "bing"].flatMap(service => [
      sendToAudio({ action: `offscreen_${service}_ttsSpeed`, speed: twpConfig.get("ttsSpeed") }),
      sendToAudio({ action: `offscreen_${service}_ttsVolume`, volume: twpConfig.get("ttsVolume") }),
    ]));
  }

  function handleIdleError(error) {
    // The audio document can close between the existence check and the message.
    if (!/Receiving end does not exist|message port closed|message channel closed/i.test(error.message)) {
      console.error("TWP audio settings failed", error);
    }
  }

  async function syncSettingsIfOpen() {
    if (await hasAudioDocument()) await syncSettings();
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "textToSpeech") {
      (async () => {
        await twpConfig.onReady();
        await setupAudioDocument();
        // Settings may have changed while no audio document existed.
        await syncSettings();
        const service = twpConfig.get("textToSpeechService") === "bing" ? "bing" : "google";
        return sendToAudio({ action: `offscreen_${service}_textToSpeech`,
          text: request.text, targetLanguage: request.targetLanguage });
      })().then(() => sendResponse(), error => {
        console.warn("TWP audio playback failed", error);
        sendResponse({ error: error.message });
      });
      return true;
    } else if (request.action === "stopAudio") {
      (async () => {
        if (creating) await creating;
        // Stopping unused audio must not create an offscreen document.
        if (!await hasAudioDocument()) return;
        await Promise.all(["google", "bing"].map(service =>
          sendToAudio({ action: `offscreen_${service}_stopAll` })));
      })().then(() => sendResponse(), error => {
        handleIdleError(error);
        sendResponse();
      });
      return true;
    }
  });

  twpConfig.onReady(() => {
    twpConfig.onChanged(name => {
      if (name === "ttsSpeed" || name === "ttsVolume") {
        syncSettingsIfOpen().catch(handleIdleError);
      }
    });
    // On worker startup there is usually no receiver. Defer settings until
    // playback, but resync an existing document after a worker restart.
    syncSettingsIfOpen().catch(handleIdleError);
  });
})();
