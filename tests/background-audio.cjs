const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.resolve("src/background/textToSpeech.js"), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

async function setup({ failFirstCreation = false, firefox = false } = {}) {
  const state = { open: false, creates: 0, messages: [], errors: [], closeOnSend: false };
  const settings = { ttsSpeed: 1.25, ttsVolume: 0.75, textToSpeechService: "google" };
  let listener;
  let onChanged;
  const runtime = {
    getURL: name => `chrome-extension://test/${name}`,
    getContexts: async () => state.open ? [{}] : [],
    onMessage: { addListener: callback => { listener = callback; } },
    sendMessage(message, callback) {
      state.messages.push(message);
      if (state.closeOnSend) state.open = false;
      if (!state.open) runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
      callback();
      delete runtime.lastError;
    },
  };
  const sandbox = {
    chrome: {
      runtime,
      offscreen: {
        async createDocument() {
          state.creates++;
          await settle();
          if (failFirstCreation && state.creates === 1) throw new Error("Creation failed");
          state.open = true;
        },
      },
    },
    twpConfig: {
      onReady(callback) { if (callback) queueMicrotask(callback); return Promise.resolve(); },
      onChanged(callback) { onChanged = callback; },
      get: name => settings[name],
    },
    console: { warn: (...args) => state.errors.push(args), error: (...args) => state.errors.push(args) },
  };
  if (firefox) {
    delete sandbox.chrome.offscreen;
    const service = name => ({
      setAudioSpeed: speed => state.messages.push({ action: `${name}_speed`, speed }),
      setAudioVolume: volume => state.messages.push({ action: `${name}_volume`, volume }),
      textToSpeech: async text => state.messages.push({ action: `${name}_play`, text }),
      stopAll: () => state.messages.push({ action: `${name}_stop` }),
    });
    sandbox.textToSpeech = { googleService: service("google"), bingService: service("bing") };
  }
  vm.runInNewContext(source, sandbox);
  await settle();
  return {
    state,
    async set(name, value) { settings[name] = value; onChanged(name, value); await settle(); },
    request: request => new Promise(resolve => { assert.equal(listener(request, {}, resolve), true); }),
  };
}

test("startup, idle settings changes and stop do not message or create a missing audio document", async () => {
  const app = await setup();
  await app.set("ttsSpeed", 1.5);
  await app.set("ttsVolume", 0.5);
  await app.request({ action: "stopAudio" });
  assert.equal(app.state.creates, 0);
  assert.deepEqual(app.state.messages, []);
  assert.deepEqual(app.state.errors, []);
});

test("first playback applies the latest settings before speaking and subsequent changes reach the open document", async () => {
  const app = await setup();
  await app.set("ttsSpeed", 1.5);
  await app.request({ action: "textToSpeech", text: "Hello", targetLanguage: "en" });
  assert.equal(app.state.creates, 1);
  assert.equal(app.state.messages.length, 5);
  assert.equal(app.state.messages.at(-1).action, "offscreen_google_textToSpeech");
  assert.equal(app.state.messages.filter(message => message.speed === 1.5).length, 2);
  await app.set("ttsVolume", 0.5);
  assert.equal(app.state.messages.slice(-4).filter(message => message.volume === 0.5).length, 2);
  assert.deepEqual(app.state.errors, []);
});

test("concurrent playback requests share one document creation", async () => {
  const app = await setup();
  await Promise.all([1, 2].map(() => app.request({ action: "textToSpeech", text: "Hello", targetLanguage: "en" })));
  assert.equal(app.state.creates, 1);
  assert.deepEqual(app.state.errors, []);
});

test("document creation failure is returned to the caller and does not block retry", async () => {
  const app = await setup({ failFirstCreation: true });
  const result = await app.request({ action: "textToSpeech", text: "Hello", targetLanguage: "en" });
  assert.equal(result.error, "Creation failed");
  await app.request({ action: "textToSpeech", text: "Hello", targetLanguage: "en" });
  assert.equal(app.state.creates, 2);
  assert.equal(app.state.messages.at(-1).action, "offscreen_google_textToSpeech");
});

test("document closing during an idle settings update is handled", async () => {
  const app = await setup();
  app.state.open = true;
  app.state.closeOnSend = true;
  await app.set("ttsSpeed", 1.5);
  assert.deepEqual(app.state.errors, []);
});

test("Firefox uses its existing background audio services without offscreen messaging", async () => {
  const app = await setup({ firefox: true });
  await app.request({ action: "textToSpeech", text: "Hello", targetLanguage: "en" });
  assert.equal(app.state.creates, 0);
  assert.equal(app.state.messages.at(-1).action, "google_play");
  assert.deepEqual(app.state.errors, []);
});
