const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const version = JSON.parse(fs.readFileSync("src/manifest.json", "utf8")).version;
  const extension = path.resolve(`build/TWP_AI_${version}_Chromium_MV3`);
  const profile = fs.mkdtempSync(path.resolve("build/smoke-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.TWP_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
    viewport: { width: 380, height: 480 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
    const id = worker.url().split("/")[2];
    const errors = [];
    await worker.evaluate(async () => {
      self.backgroundErrors = [];
      self.addEventListener("unhandledrejection", event => self.backgroundErrors.push(String(event.reason)));
      await twpConfig.onReady();
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.filter(tab => tab.url?.startsWith(chrome.runtime.getURL("")))
        .map(tab => chrome.tabs.remove(tab.id)));
      // No extension page or offscreen document receives these idle updates.
      twpConfig.set("ttsSpeed", 1.25);
      twpConfig.set("ttsVolume", 0.75);
    });
    expect(await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).toEqual([]);
    const popup = await context.newPage();
    popup.on("pageerror", error => errors.push(error.message));
    await popup.goto(`chrome-extension://${id}/popup/old-popup.html`);
    await worker.evaluate(() => twpConfig.set("pageTranslationMode", "bilingual"));
    await expect(popup.locator("[data-translation-mode]")).toHaveValue("bilingual");
    await popup.locator("[data-translation-mode]").selectOption("translated");
    await expect.poll(() => worker.evaluate(() => new Promise(resolve =>
      chrome.storage.local.get("pageTranslationMode", value => resolve(value.pageTranslationMode))))).toBe("translated");
    await popup.locator("[data-translation-mode]").selectOption("bilingual");
    await expect.poll(() => worker.evaluate(() => twpConfig.get("pageTranslationMode"))).toBe("bilingual");
    await popup.screenshot({ path: path.resolve("build/popup-preview.png") });

    for (const file of ["popup/popup.html", "options/options.html"]) {
      await popup.goto(`chrome-extension://${id}/${file}`);
      await expect(popup.locator("[data-translation-mode]")).toHaveValue("bilingual");
    }

    // Renaming a fork must not leave broken About or release-note handlers.
    await popup.setViewportSize({ width: 1280, height: 900 });
    await popup.goto(`chrome-extension://${id}/options/options.html#about`);
    await expect(popup.locator("#about")).toBeVisible();
    await expect(popup.locator("#about")).toContainText("FilipePS");
    await popup.screenshot({ path: path.resolve("build/about-preview.png"), animations: "disabled" });
    await popup.locator('nav a[href="#release_notes"]').click();
    await expect(popup.locator("#_msgHasBeenUpdated")).toContainText("页渡 · Yedu");
    await expect(popup.locator("#release_notes")).not.toContainText("600,000");
    await popup.goto(`chrome-extension://${id}/options/options.html#donation`);
    await expect(popup.locator("#about")).toBeVisible();
    await popup.setViewportSize({ width: 380, height: 480 });

    // Exercise real MV3 background/content-script messaging with a deterministic
    // provider response. External translation APIs are not required for this test.
    await worker.evaluate(() => {
      translationService.translateHTML = async (_service, _source, _target, paragraphs) =>
        paragraphs.map(paragraph => paragraph.map(text => `中文：${text}`));
    });
    await context.route("https://bilingual.test/**", route => route.fulfill({
      contentType: "text/html",
      body: '<html><head><title>Original title</title></head><body style="padding:40px"><p id="paragraph">Original text with <a href="#">a working link</a>.</p><ul><li id="inline-code">Input values <code>0.00</code>, <code>0.00</code>, and <code>0.00</code></li></ul></body></html>',
    }));
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://bilingual.test/article");
    const tabId = await worker.evaluate(() => new Promise(resolve => chrome.tabs.query(
      { url: "https://bilingual.test/article" }, tabs => resolve(tabs[0].id))));
    await expect.poll(() => worker.evaluate(tab => new Promise(resolve => chrome.tabs.sendMessage(
      tab, { action: "getCurrentPageLanguageState" }, result => {
        void chrome.runtime.lastError;
        resolve(result);
      })), tabId)).toBe("original");
    await worker.evaluate(tab => chrome.tabs.sendMessage(tab, { action: "translatePage", targetLanguage: "zh-CN" }), tabId);
    await expect(page.locator("#paragraph [data-twp-bilingual]")).toHaveCount(1);
    await expect(page.locator("#paragraph a")).toHaveText("a working link");
    await expect(page.locator("#inline-code > [data-twp-bilingual]")).toHaveCount(1);
    await expect(page.locator("#inline-code > [data-twp-bilingual] code")).toHaveCount(3);
    await expect(page.locator("#inline-code > [data-twp-bilingual]")).toHaveText("中文：Input values 0.00, 0.00, and 0.00");
    await worker.evaluate(tab => chrome.tabs.sendMessage(tab, { action: "restorePage" }), tabId);
    await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
    await expect(page.locator("#paragraph")).toHaveText("Original text with a working link.");
    await expect(page.locator("#inline-code")).toHaveText("Input values 0.00, 0.00, and 0.00");

    // The popup must reflect provider failures while it is open, and recover
    // when a subsequent translation succeeds.
    await popup.goto(`chrome-extension://${id}/popup/old-popup.html`);
    await worker.evaluate(() => { translationService.translateHTML = async () => undefined; });
    await worker.evaluate(tab => chrome.tabs.sendMessage(tab, { action: "translatePage", targetLanguage: "zh-CN" }), tabId);
    const failureMessage = await popup.evaluate(() => twpI18n.getMessage("msgBilingualTranslationFailed"));
    await expect(popup.locator("[data-translation-status]")).toHaveText(failureMessage);
    await expect(popup.locator("[data-translation-status]")).toBeVisible();
    await expect(popup.locator("#btnTryAgain")).toBeVisible();
    await worker.evaluate(() => {
      translationService.translateHTML = async (_service, _source, _target, paragraphs) =>
        paragraphs.map(paragraph => paragraph.map(text => `中文：${text}`));
    });
    await worker.evaluate(tab => chrome.tabs.sendMessage(tab, { action: "swapTranslationService", newServiceName: "bing" }), tabId);
    await expect(page.locator("#paragraph [data-twp-bilingual]")).toHaveCount(1);
    await expect(popup.locator("[data-translation-status]")).toBeHidden();
    await expect(popup.locator("#btnRestore")).toBeVisible();

    // An empty utterance exercises the real audio-document lifecycle without
    // downloading audio or playing sound. Its controls must acknowledge messages.
    await worker.evaluate(() => twpConfig.set("textToSpeechService", "google"));
    expect(await popup.evaluate(() => chrome.runtime.sendMessage({
      action: "stopAudio",
    }))).toBeNull();
    expect(await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).toEqual([]);
    expect(await popup.evaluate(() => chrome.runtime.sendMessage({
      action: "textToSpeech", text: "", targetLanguage: "en",
    }))).toBeNull();
    expect((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).length).toBe(1);
    await worker.evaluate(async () => {
      await chrome.runtime.sendMessage({ action: "offscreen_google_ttsSpeed", speed: 1.5 });
      await chrome.runtime.sendMessage({ action: "offscreen_bing_ttsVolume", volume: 0.5 });
      await chrome.offscreen.closeDocument();
      twpConfig.set("ttsSpeed", 1);
      twpConfig.set("ttsVolume", 1);
    });
    await popup.evaluate(() => chrome.runtime.sendMessage({ action: "stopAudio" }));
    expect(await worker.evaluate(() => self.backgroundErrors)).toEqual([]);
    expect(errors).toEqual([]);
    console.log("PASS: MV3 worker, popups, translation/recovery, audio document lifecycle and no unhandled background messaging errors");
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
