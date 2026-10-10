const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const fs = require("node:fs"), path = require("node:path");
(async () => {
  const extension = path.resolve("build/TWP_AI_0.1.0_Chromium_MV3");
  const profile = fs.mkdtempSync(path.resolve("build/selection-dictionary-profile-"));
  const context = await chromium.launchPersistentContext(profile, { channel: process.platform === "win32" ? "msedge" : "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await twpConfig.onReady(); twpConfig.set("showReleaseNotes", "no"); twpConfig.set("pageTranslatorService", "google");
      twpConfig.set("showTranslateSelectedButton", "yes"); twpConfig.set("targetLanguage", "zh-CN");
      self.translationCalls = [];
      translationService.translateText = async (_service, _source, _target, texts) => { translationCalls.push(texts); return texts.map(text => "中文：" + text); };
      const originalFetch = self.fetch.bind(self); self.dictionaryCalls = [];
      self.fetch = async (input, options) => {
        const url = String(input);
        if (!url.startsWith("https://api.dictionaryapi.dev/api/v2/entries/en/")) return originalFetch(input, options);
        dictionaryCalls.push(url);
        if (url.endsWith("homeomorphisms")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify([{ word: "homeomorphism", phonetics: [{ text: "/reference/", audio: "" }],
          meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A continuous bijection with a continuous inverse.", example: "This map is a homeomorphism." }] }],
          sourceUrls: ["https://en.wiktionary.org/wiki/homeomorphism"], license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" } }]),
          { status: 200, headers: { "content-type": "application/json" } });
      };
    });
    await context.route("https://word-extension.test/**", route => route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><style>body{font:18px/1.6 system-ui;padding:40px}</style></head><body><p id="word">homeomorphisms</p><p id="sentence">A longer sentence translates normally.</p></body></html>' }));
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://word-extension.test/article");
    const quick = selector => page.locator(`#twp-interactive-ui ${selector}`);
    await expect(page.locator("#twp-interactive-ui")).toHaveCount(1);
    async function select(selector) {
      await page.locator(selector).evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      });
      await worker.evaluate(async url => {
        const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { action: "TranslateSelectedText" });
      }, page.url());
    }
    await select("#word");
    await expect(quick("#result")).toContainText("同胚");
    await expect(quick("#service")).toContainText("离线词典");
    await expect(quick("#dictionary-meanings")).not.toContainText("同胚");
    await expect(quick("#phonetic-reference")).toContainText("homeomorphism 的参考音标");
    expect(await worker.evaluate(() => dictionaryCalls.length)).toBe(0);
    expect(await worker.evaluate(() => translationCalls.length)).toBe(0);
    await quick("#dictionary-enrich").click();
    await expect(quick("#dictionary-form")).toHaveText("词典词形：homeomorphism");
    await expect(quick("#dictionary-meanings")).toContainText("中文：A continuous bijection");
    await expect(quick("#result")).toContainText("同胚");
    await expect(quick("#phonetic-reference")).toContainText("未标明口音");
    expect(await worker.evaluate(() => dictionaryCalls.length)).toBe(2);
    expect(await worker.evaluate(async () => (await chrome.storage.session.get("selectionDictionaryCache:v2"))["selectionDictionaryCache:v2"][0][0])).toBe("homeomorphisms");
    await expect(quick("#dictionary-translate-examples")).toBeEnabled();
    await quick("#dictionary-translate-examples").click();
    await expect(quick("#dictionary-meanings")).toContainText("中文：This map is a homeomorphism.");
    await quick("#close").click(); await select("#word");
    await expect(quick("#result")).toContainText("同胚");
    expect(await worker.evaluate(() => dictionaryCalls.length)).toBe(2);
    await expect(quick("#phonetic-reference")).toContainText("homeomorphism 的参考音标");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "build/selection-dictionary-extension.png" });
    await quick("#close").click();
    await page.locator("#word").evaluate(element => { element.textContent = "the"; });
    await select("#word");
    await expect(quick("#result")).toContainText("那");
    await expect(quick("#dictionary-meanings")).not.toContainText("art. 那");
    await expect(quick(".dictionary-sense .english")).toBeHidden();
    await expect(quick("#dictionary-source")).toBeHidden();
    await expect(quick("#phonetic-reference-value")).not.toBeEmpty();
    await expect(quick("#dictionary-phonetics")).toBeHidden();
    await page.screenshot({ path: "build/selection-dictionary-clean-extension.png" });
    await quick(".dictionary-sense summary").click();
    await expect(quick(".dictionary-sense .english")).toBeVisible();
    await expect(quick(".dictionary-sense .english")).toContainText("definite article");
    expect(await worker.evaluate(() => dictionaryCalls.length)).toBe(2);
    await quick("#close").click();
    await select("#sentence");
    await expect(quick("#result")).toHaveText("中文：A longer sentence translates normally.");
    await expect(quick("#dictionary")).toBeHidden();
    expect(await worker.evaluate(() => dictionaryCalls.length)).toBe(2);
    expect(errors).toEqual([]);
    console.log("Selection dictionary extension passed: complete packaged library, zero public requests on local Chinese hits, optional online enrichment, preserved offline definitions, example translation, sentence fallback and dark theme.");
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
