const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fixtureEntry = { selected: "homeomorphisms", word: "homeomorphism", phonetics: { uk: "/UK/", us: "/US/", reference: [] },
  meanings: [{ partOfSpeech: "noun", definition: "A continuous bijection with a continuous inverse.", example: "This map is a homeomorphism.", synonyms: ["map"] }],
  source: "https://en.wiktionary.org/wiki/homeomorphism", license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" } };
async function setup(page) {
  await page.route("https://dictionary.test/**", route => route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><style>body{font:18px/1.6 system-ui;padding:24px}p{max-width:700px}</style></head><body><p id="term">homeomorphisms</p><p>A long sentence stays in the existing translator.</p></body></html>' }));
  await page.goto("https://dictionary.test/article");
  await page.evaluate(entry => {
    window.dictionaryEntry = entry; window.dictionaryDelay = 0; window.translationDelay = 0;
    window.dictionaryRequests = []; window.translationRequests = []; window.cancelled = []; window.spoken = []; window.voiceListeners = [];
    window.voices = [{ name: "British test voice", lang: "en-GB" }, { name: "American test voice", lang: "en-US" }];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => voices, addEventListener: (_event, callback) => voiceListeners.push(callback), cancel: () => {},
      speak: utterance => spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice.name }) } });
    window.SpeechSynthesisUtterance = function(text) { this.text = text; };
    window.platformInfo = { isMobile: { any: false } };
    window.settings = { targetLanguage: "zh-CN", showTranslateSelectedButton: "yes", selectionTranslationSettings: { trigger: "icon" }, hoverTranslationSettings: { enabled: false, trigger: "Control", effect: "toggle" } };
    window.configListeners = [];
    window.twpConfig = { get: name => settings[name], onChanged: callback => configListeners.push(callback) };
    window.twpLang = { codeToLanguage: () => "中文（简体）" };
    window.pageTranslator = { ready: Promise.resolve(), getService: () => window.activeService || "google", getState: () => "original", onPageLanguageStateChange: () => {} };
    window.twpAIClient = { cancel: group => cancelled.push(group), translate: async texts => texts.map(text => "AI译：" + text) };
    window.bilingualTranslator = { unchanged: () => true };
    window.chrome = { runtime: { getURL: name => `https://dictionary.test/${name}`, sendMessage(request, callback) {
      if (request.action === "lookupLocalDictionary") {
        callback(dictionaryEntry.provider === "offline" ? { status: "ok", entry: dictionaryEntry } : { status: "not-found" });
      } else if (request.action === "lookupDictionary") {
        dictionaryRequests.push(request);
        const response = window.dictionaryFailure ? { status: "error", error: "词典服务不可用" } : { status: "ok", entry: { ...dictionaryEntry, selected: request.word } };
        setTimeout(() => callback(response), dictionaryDelay);
      } else if (request.action === "cancelDictionary") { cancelled.push(request.requestId); callback(); }
      else if (request.action === "translateText") {
        translationRequests.push(request);
        setTimeout(() => callback(window.translationFailure ? undefined : request.sourceArray.map(text => "中文：" + text)), translationDelay);
      }
    } } };
  }, fixtureEntry);
  for (const file of ["selectionDictionary.js", "interactiveTranslator.js"]) await page.addScriptTag({ path: path.resolve("src/contentScript", file) });
  await page.evaluate(() => twpInteractiveTranslator.ready);
}
const ui = (page, selector) => page.locator(`#twp-interactive-ui ${selector}`);
const show = (page, text = "homeomorphisms") => page.evaluate(text => twpInteractiveTranslator.translateSelection(text), text);
test("word popup shows localized definitions, examples, headword and separate accents", async ({ page }) => {
  await setup(page); await show(page);
  await expect(ui(page, "#dictionary-word")).toHaveText("homeomorphisms");
  await expect(ui(page, "#dictionary-form")).toHaveText("词典词形：homeomorphism");
  await expect(ui(page, "#phonetic-uk")).toHaveText("/UK/"); await expect(ui(page, "#phonetic-us")).toHaveText("/US/");
  await expect(ui(page, ".dictionary-sense")).toContainText("名词");
  await expect(ui(page, ".dictionary-sense")).toContainText("中文：A continuous bijection");
  expect(await page.evaluate(() => translationRequests.filter(request => request.sourceArray.includes("This map is a homeomorphism.")).length)).toBe(0);
  await ui(page, "#dictionary-translate-examples").click();
  await expect(ui(page, ".dictionary-sense")).toContainText("中文：This map is a homeomorphism.");
  await ui(page, "#pronounce-uk").click(); await ui(page, "#pronounce-us").click();
  expect(await page.evaluate(() => spoken)).toEqual([{ text: "homeomorphisms", lang: "en-GB", voice: "British test voice" }, { text: "homeomorphisms", lang: "en-US", voice: "American test voice" }]);
  await expect(ui(page, "#dictionary-source a").first()).toHaveAttribute("href", "https://en.wiktionary.org/wiki/homeomorphism");
  for (const width of [1000, 320]) {
    await page.setViewportSize({ width, height: 600 });
    await expect(ui(page, "#popup")).toBeHidden(); await show(page);
    await expect(ui(page, "#dictionary-status")).toHaveText("");
    const box = await ui(page, "#popup").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(12); expect(box.y).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 11); expect(box.y + box.height).toBeLessThanOrEqual(589);
    await ui(page, "#pronounce-us").click();
    await page.screenshot({ path: `build/selection-dictionary-${width}.png` });
  }
});
test("sentence selections keep the compact translation without a dictionary lookup", async ({ page }) => {
  await setup(page); await show(page, "This is a longer sentence.");
  await expect(ui(page, "#result")).toHaveText("中文：This is a longer sentence.");
  await expect(ui(page, "#dictionary")).toBeHidden();
  expect(await page.evaluate(() => dictionaryRequests.length)).toBe(0);
});
test("late lookup and definition responses cannot overwrite a newly selected word or closed popup", async ({ page }) => {
  await setup(page); await page.evaluate(() => { dictionaryDelay = 400; });
  await show(page, "first"); await show(page, "second");
  await expect(ui(page, "#dictionary-word")).toHaveText("second");
  await expect(ui(page, "#dictionary-status")).toHaveText("");
  await page.evaluate(() => { translationDelay = 400; });
  await show(page, "third"); await ui(page, "#close").click();
  await page.waitForTimeout(850);
  await expect(ui(page, "#popup")).toBeHidden();
  expect(await page.evaluate(() => cancelled.length)).toBeGreaterThan(0);
});
test("dictionary errors do not block translation and retry recovers", async ({ page }) => {
  await setup(page); await page.evaluate(() => { dictionaryFailure = true; }); await show(page);
  await expect(ui(page, "#result")).toHaveText("中文：homeomorphisms");
  await expect(ui(page, "#dictionary-status")).toContainText("不可用");
  await page.evaluate(() => { dictionaryFailure = false; }); await ui(page, "#dictionary-retry").click();
  await expect(ui(page, ".dictionary-sense")).toContainText("中文：A continuous bijection");
});
test("unavailable voices are disabled and unlabelled IPA remains a reference", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { voices = []; dictionaryEntry.phonetics = { uk: "", us: "", reference: ["/unknown/"] }; });
  await show(page);
  await expect(ui(page, "#pronounce-uk")).toBeDisabled(); await expect(ui(page, "#pronounce-us")).toBeDisabled();
  await expect(ui(page, "#phonetic-uk")).toBeHidden();
  await expect(ui(page, "#phonetic-reference")).toContainText("未标明口音");
  await page.evaluate(() => { voices = [{ name: "US only", lang: "en-US" }]; voiceListeners.forEach(callback => callback()); });
  await expect(ui(page, "#pronounce-us")).toBeEnabled(); await expect(ui(page, "#pronounce-uk")).toBeDisabled();
});
test("dictionary text cannot create markup and AI service is reused for definitions", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { activeService = "openai"; dictionaryEntry.meanings[0].definition = '<img src=x onerror="window.bad=true">'; dictionaryEntry.source = "javascript:alert(1)"; });
  await show(page);
  await expect(ui(page, "#result")).toHaveText("AI译：homeomorphisms");
  await expect(ui(page, ".dictionary-sense")).toContainText('AI译：<img src=x');
  await expect(ui(page, "#dictionary img")).toHaveCount(0);
  await expect(ui(page, "#dictionary-source a[href^='javascript:']")).toHaveCount(0);
});

test("reselecting a word reuses translated definitions but settings changes invalidate them", async ({ page }) => {
  await setup(page); await show(page);
  await expect(ui(page, "#dictionary-status")).toHaveText("");
  await show(page); await expect(ui(page, "#dictionary-status")).toHaveText("");
  const definitionCalls = () => page.evaluate(() => translationRequests.filter(request => request.sourceArray.includes("A continuous bijection with a continuous inverse.")).length);
  expect(await definitionCalls()).toBe(1);
  await page.evaluate(() => configListeners.forEach(callback => callback("targetLanguage")));
  await show(page); await expect(ui(page, "#dictionary-status")).toHaveText("");
  expect(await definitionCalls()).toBe(2);
});

test("example translation retries and late responses cannot restore a closed card", async ({ page }) => {
  await setup(page); await show(page); await expect(ui(page, "#dictionary-status")).toHaveText("");
  await page.evaluate(() => { translationFailure = true; });
  await ui(page, "#dictionary-translate-examples").click();
  await expect(ui(page, "#dictionary-translate-examples")).toContainText("重试");
  await page.evaluate(() => { translationFailure = false; translationDelay = 300; });
  await ui(page, "#dictionary-translate-examples").click(); await ui(page, "#close").click();
  await page.waitForTimeout(500); await expect(ui(page, "#popup")).toBeHidden();
});

test("offline Chinese renders and copies without any translation request, with optional online enrichment", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    dictionaryEntry.provider = "offline";
    dictionaryEntry.meanings[0].translation = "同胚：连续且逆映射连续的双射。";
    dictionaryEntry.meanings[0].example = "";
    dictionaryEntry.forms = ["s:homeomorphisms", "0:homeomorphism"];
  });
  await show(page);
  await expect(ui(page, "#result")).toContainText("同胚");
  await expect(ui(page, "#service")).toContainText("离线词典");
  await expect(ui(page, "#dictionary-status")).toBeHidden();
  await expect(ui(page, "#dictionary-forms")).toContainText("原形：homeomorphism");
  expect(await page.evaluate(() => translationRequests.length)).toBe(0);
  await page.evaluate(() => { dictionaryFailure = true; dictionaryDelay = 300; });
  await ui(page, "#dictionary-enrich").click();
  await expect(ui(page, ".dictionary-sense")).toContainText("A continuous bijection");
  await expect(ui(page, "#dictionary-status")).toContainText("不可用");
  await expect(ui(page, "#result")).toContainText("同胚");
  await expect(ui(page, "#dictionary-enrich")).toBeEnabled();
});

test("a non-Chinese target translates local Chinese when the entry has no English definition", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { settings.targetLanguage = "en"; dictionaryEntry.provider = "offline"; dictionaryEntry.meanings[0].definition = ""; dictionaryEntry.meanings[0].translation = "同胚"; dictionaryEntry.meanings[0].example = ""; });
  await show(page);
  await expect(ui(page, ".dictionary-sense")).toContainText("中文：同胚");
  expect(await page.evaluate(() => translationRequests.some(request => request.sourceArray.includes("同胚")))).toBe(true);
});

test("related IPA identifies its headword rather than impersonating the selected plural", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { dictionaryEntry.phonetics = { uk: "", us: "", reference: ["/base/"], referenceWord: "homeomorphism", referenceIsLemma: false }; });
  await show(page);
  await expect(ui(page, "#phonetic-reference")).toHaveText("词形候选 homeomorphism 的参考音标（未标明口音）：/base/");
  await expect(ui(page, "#phonetic-uk")).toBeHidden();
});

test("offline word card keeps one translation and expands long definitions and attribution on demand", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    dictionaryEntry = { word: "the", provider: "offline", phonetics: { uk: "", us: "", reference: ["ðə"] },
      meanings: [{ partOfSpeech: "", definition: "v. i. See Thee.\ndefinite article. A word placed before nouns to limit or individualize their meaning.\nadv. By that; by how much; by so much; on that account; -- used before comparatives; as, the longer we continue in sin, the more difficult it is to reform.", translation: "art. 那", example: "", synonyms: [] }],
      source: "https://github.com/skywind3000/ECDICT", license: { name: "ECDICT · MIT", url: "https://github.com/skywind3000/ECDICT/blob/master/LICENSE" } };
    window.copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => copied.push(text) } });
  });
  for (const [width, scheme] of [[1000, "light"], [320, "dark"]]) {
    await page.setViewportSize({ width, height: 600 }); await page.emulateMedia({ colorScheme: scheme });
    await show(page, "the");
    await expect(ui(page, "#result")).toHaveText("art. 那");
    await expect(ui(page, "#dictionary-meanings")).not.toContainText("art. 那");
    await expect(ui(page, "#dictionary-phonetics")).toBeHidden();
    await expect(ui(page, "#phonetic-reference-value")).toHaveText("ðə");
    await expect(ui(page, "#pronunciation-status")).toBeHidden();
    await expect(ui(page, "#dictionary-status")).toBeHidden();
    await expect(ui(page, "#popup>.hint")).toBeHidden();
    await expect(ui(page, ".dictionary-sense .english")).toBeHidden();
    await expect(ui(page, "#dictionary-source")).toBeHidden();
    const box = await ui(page, "#popup").boundingBox();
    expect(box.height).toBeLessThan(400); expect(box.x + box.width).toBeLessThanOrEqual(width - 11);
    await page.screenshot({ path: `build/selection-dictionary-clean-${width}.png` });
    await ui(page, "#copy").click();
    await ui(page, ".dictionary-sense summary").click();
    await expect(ui(page, ".dictionary-sense .english")).toBeVisible();
    await expect(ui(page, ".dictionary-sense .english")).toContainText("definite article");
    await ui(page, "#dictionary-attribution summary").click();
    await expect(ui(page, "#dictionary-source a").first()).toBeVisible();
    await expect(ui(page, "#dictionary-source a").first()).toHaveAttribute("href", "https://github.com/skywind3000/ECDICT");
    await ui(page, "#close").click();
  }
  expect(await page.evaluate(() => copied)).toEqual(["art. 那", "art. 那"]);
  expect(await page.evaluate(() => translationRequests.length)).toBe(0);
});
