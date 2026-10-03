const { expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async ({context, worker, id, settings, calls, configure}) => {
  const originalPreferences = await worker.evaluate(() => ({sidebar:twpConfig.get("sidebarPreferences"), services:twpConfig.get("textComparisonServices")}));
  const profiles = await worker.evaluate(() => twpConfig.get("aiProfiles"));
  const active = await worker.evaluate(() => twpConfig.get("aiActiveProfile"));
  await worker.evaluate(() => {
    twpConfig.set("textComparisonServices", ["google", "bing", "yandex"]);
    twpConfig.set("sidebarPreferences", {});
    self.comparisonRequests = []; self.failGoogle = false;
    self.savedCompareTranslate = translationService.translateText;
    translationService.translateText = async (service, source, target, texts) => {
      self.comparisonRequests.push({service, source, target, texts});
      return service === "google" && self.failGoogle ? null : texts.map(text => `${service}：${text}`);
    };
  });
  const panel = await context.newPage();
  await panel.setViewportSize({width:1440, height:1000});
  await panel.goto(`chrome-extension://${id}/options/sidepanel.html?workspace=1&view=text`);
  const card = service => panel.locator(`.comparison-card[data-service="${service}"]`);
  async function choose(ids) {
    if (!await panel.locator("#compare-picker").evaluate(node => node.open)) await panel.locator("#compare-summary").click();
    const inputs = panel.locator("#compare-list input");
    for (let i = 0; i < await inputs.count(); i++) { const input = inputs.nth(i); await input.setChecked(ids.includes(await input.inputValue())); }
    await panel.locator("#compare-summary").click();
  }
  await expect(panel.locator("#comparison-results article")).toHaveCount(3);
  await expect(panel.locator("#text-mode")).toHaveValue("bilingual");
  await expect(panel.locator("#source-language")).toHaveValue("auto");
  await expect(panel.locator("#text-expert option")).toHaveCount(44);
  await expect(panel.locator("#text-glossary option")).toHaveCount(32);
  await panel.locator("#source").fill("Hello comparison.\n\nSecond paragraph.");
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(6);
  await expect(panel.locator("#comparison-results .original")).toHaveCount(6);
  expect(await worker.evaluate(() => self.comparisonRequests.map(r => r.service).sort())).toEqual(["bing", "google", "yandex"]);
  expect(await worker.evaluate(() => self.comparisonRequests.every(r => r.source === "auto"))).toBe(true);
  const downloaded = panel.waitForEvent("download");
  await card("google").getByRole("button", {name:"导出 TXT", exact:true}).click();
  const file = await downloaded;
  expect(fs.readFileSync(await file.path(), "utf8")).toBe("Hello comparison.\ngoogle：Hello comparison.\n\nSecond paragraph.\ngoogle：Second paragraph.");
  const count = await worker.evaluate(() => self.comparisonRequests.length);
  await panel.locator("#text-mode").selectOption("translated");
  await expect(panel.locator("#comparison-results .original")).toHaveCount(0);
  expect(await worker.evaluate(() => self.comparisonRequests.length)).toBe(count);
  await panel.locator("#text-mode").selectOption("bilingual");
  await panel.locator("#source-language").selectOption("en");
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(0);
  expect(await worker.evaluate(() => self.comparisonRequests.length)).toBe(count);

  const aiIds = profiles.map(p => `ai:${p.id}`);
  await choose(["google", "bing", "yandex", ...aiIds]);
  await worker.evaluate(() => { self.failGoogle = true; });
  await panel.locator("#text-expert").selectOption("public-tech");
  await panel.locator("#text-glossary").selectOption("public-tech");
  await panel.locator('[data-style="technical"]').click();
  await panel.locator("#source").fill("Machine Learning uses an Algorithm. <img src=x onerror=alert(1)>");
  const before = calls.length;
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#cancel")).toBeHidden();
  await expect(card("google").getByRole("button", {name:"重试此服务"})).toBeVisible();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(4);
  expect(calls.slice(before).map(call => call.body.model).sort()).toEqual(["second-model", "test-model"]);
  expect(await worker.evaluate(() => twpConfig.get("aiActiveProfile"))).toBe(active);
  expect(await worker.evaluate(count => self.comparisonRequests.slice(count).every(r => r.source === "en"), count)).toBe(true);
  for (const call of calls.slice(before)) {
    expect(JSON.parse(call.body.messages.find(m => m.role === "user").content).sourceLanguage).toBe("en");
    const system = call.body.messages.find(m => m.role === "system").content;
    expect(system).toContain("technology and software");
    expect(system).toContain("technical prose");
    expect(system).toContain('"Machine Learning","机器学习"');
  }
  await expect(panel.locator("#comparison-results img")).toHaveCount(0);
  await worker.evaluate(() => { self.failGoogle = false; });
  const aiCount = calls.length;
  await card("google").getByRole("button", {name:"重试此服务"}).click();
  await expect(card("google").locator(".translation")).toContainText("Machine Learning");
  expect(calls.length).toBe(aiCount);
  await panel.screenshot({path:path.resolve("build/comparison-workspace.png"), fullPage:true});

  // Identical text with a different source language must not hit the AI cache.
  await panel.locator("#source-language").selectOption("fr");
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(0);
  const languageBefore = calls.length;
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(5);
  expect(calls.length - languageBefore).toBe(aiIds.length);
  for (const call of calls.slice(languageBefore)) {
    expect(JSON.parse(call.body.messages.find(m => m.role === "user").content).sourceLanguage).toBe("fr");
  }
  await panel.locator("#source-language").selectOption("en");

  // Create and edit through the actual settings UI, then inspect the API request.
  await settings.locator("#expert-edit").selectOption("public-tech");
  await expect(settings.locator("#expert-prompt")).toHaveValue(/technology and software/);
  await expect(settings.locator("#expert-source")).toBeHidden();
  await settings.locator("#library-edit").selectOption("public-tech");
  await expect(settings.locator("#library-terms")).toHaveValue(/Machine Learning = 机器学习/);
  await expect(settings.locator("#library-status")).toContainText("23 条术语");
  await expect(settings.locator("#library-source")).toHaveAttribute("href", /immersive-translate\/terms/);
  await settings.locator("#library-language").selectOption("zh-TW");
  await expect(settings.locator("#library-terms")).toHaveValue(/Machine Learning = 機器學習/);
  await settings.locator("#library-language").selectOption("zh-CN");
  await settings.locator("#expert-form").locator("..").screenshot({path:path.resolve("build/expert-editor.png")});
  await settings.locator("#library-form").locator("..").screenshot({path:path.resolve("build/glossary-editor.png")});
  await settings.locator("#library-edit").selectOption("public-access-control");
  await expect(settings.locator("#library-name")).toHaveValue("计算机科学");
  await expect(settings.locator("#library-status")).toContainText("125 条术语");
  await expect(settings.locator("#library-terms")).toHaveValue(/RBAC = 基于角色的访问控制/);
  await settings.locator("#library-edit").selectOption("builtin-llm-ai");
  await expect(settings.locator("#library-status")).toContainText("136 条术语");
  await expect(settings.locator("#library-source")).toBeHidden();
  await settings.locator("#library-language").selectOption("zh-TW");
  await expect(settings.locator("#library-terms")).toHaveValue(/KV cache = 鍵值快取/);
  await settings.locator("#library-language").selectOption("zh-CN");
  await settings.locator("#library-form").locator("..").screenshot({path:path.resolve("build/glossary-llm-ai.png")});
  await choose([aiIds[0]]);
  await panel.locator("#text-glossary").selectOption("builtin-llm-ai");
  await panel.locator("#source").fill("Use RAG and LoRA with a KV cache.");
  const terminologyBefore = calls.length;
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(1);
  expect(calls.length).toBe(terminologyBefore + 1);
  const terminologySystem = calls.at(-1).body.messages.find(message => message.role === "system").content;
  expect(terminologySystem).toContain('"RAG","检索增强生成（RAG）"');
  expect(terminologySystem).toContain('"KV cache","键值缓存"');
  await panel.locator("#text-glossary").selectOption("public-access-control");
  await panel.locator("#source").fill("RBAC controls a distributed system.");
  const computingBefore = calls.length;
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(1);
  expect(calls.length).toBe(computingBefore + 1);
  const computingSystem = calls.at(-1).body.messages.find(message => message.role === "system").content;
  expect(computingSystem).toContain('"RBAC","基于角色的访问控制"');
  expect(computingSystem).toContain('"Distributed system","分布式系统"');
  await settings.locator("#expert-new").click();
  await settings.locator("#expert-name").fill("量子计算专家");
  await settings.locator("#expert-prompt").fill("Preserve project QubitKit. Explain quantum terms precisely in {{to}}.");
  await settings.locator("#expert-save").click();
  await expect(settings.locator("#expert-status")).toContainText("已保存");
  const expert = await settings.locator("#expert-edit").inputValue();
  await settings.locator("#library-new").click();
  await settings.locator("#library-name").fill("量子术语");
  await settings.locator("#library-language").selectOption("zh-CN");
  await settings.locator("#library-terms").fill("qubit = 量子比特");
  await settings.locator("#library-save").click();
  await expect(settings.locator("#library-status")).toContainText("已保存");
  const glossary = await settings.locator("#library-edit").inputValue();
  await panel.locator("#text-expert").selectOption(expert);
  await panel.locator("#text-glossary").selectOption(glossary);
  await panel.locator('[data-style="fluent"]').click();
  await choose(aiIds);
  await panel.locator("#source").fill("QubitKit controls a qubit.");
  const customBefore = calls.length;
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(2);
  for (const call of calls.slice(customBefore)) {
    const system = call.body.messages.find(m => m.role === "system").content;
    expect(system).toContain("Preserve project QubitKit");
    expect(system).toContain('"qubit","量子比特"');
    expect(system).toContain("fluent phrasing");
  }
  await panel.reload();
  await expect(panel.locator("#text-expert")).toHaveValue(expert);
  await expect(panel.locator("#text-glossary")).toHaveValue(glossary);
  await expect(panel.locator("#text-style")).toHaveValue("fluent");
  await expect(panel.locator("#source-language")).toHaveValue("en");
  await expect(panel.locator("#comparison-results article")).toHaveCount(2);
  configure({delay:1200});
  await panel.locator("#source").fill("A delayed qubit comparison.");
  const delayedBefore = calls.length;
  await panel.locator("#translate-text").click();
  await expect.poll(() => calls.length).toBeGreaterThan(delayedBefore);
  await panel.locator("#cancel").click();
  await panel.waitForTimeout(1500);
  await expect(panel.locator("#comparison-results .translation")).toHaveCount(0);
  await expect(panel.locator("#translate-text")).toBeEnabled();
  configure({delay:0});
  for (const width of [320, 384, 800, 1440]) {
    await panel.setViewportSize({width,height:900});
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.setViewportSize({width:384,height:1000});
  await panel.emulateMedia({colorScheme:"dark"});
  await panel.screenshot({path:path.resolve("build/comparison-sidebar.png"), fullPage:true});
  await settings.reload();
  await settings.locator("#expert-edit").selectOption(expert);
  await expect(settings.locator("#expert-prompt")).toHaveValue(/QubitKit/);
  await settings.locator("#expert-delete").click();
  await settings.locator("#library-edit").selectOption(glossary);
  await settings.locator("#library-delete").click();
  await expect(panel.locator("#text-expert")).toHaveValue("general");
  await expect(panel.locator("#text-glossary")).toHaveValue("default");
  // Previously saved game selections remain usable after removing their libraries.
  const previousAISettings = await worker.evaluate(() => {
    const saved = twpConfig.get("aiTranslationSettings");
    twpConfig.set("sidebarPreferences", {...twpConfig.get("sidebarPreferences"), glossaryId:"public-game"});
    twpConfig.set("aiTranslationSettings", {...saved, glossaryId:"public-bg3"});
    return saved;
  });
  await panel.reload();
  await settings.reload();
  await expect(panel.locator("#text-glossary")).toHaveValue("public-default");
  await expect(settings.locator("#default-library")).toHaveValue("public-default");
  for (const retired of ["public-game","public-stellar-blade-clothing","public-Shelter69-Slang","public-hd2","public-bg3","public-wuthering-waves"]) {
    await expect(panel.locator(`#text-glossary option[value="${retired}"]`)).toHaveCount(0);
    await expect(settings.locator(`#library-edit option[value="${retired}"]`)).toHaveCount(0);
  }
  await expect(settings.locator('#expert-edit option[value="public-game"]')).toHaveCount(1);
  await settings.locator("#library-edit").selectOption("public-Vocaloid");
  await expect(settings.locator("#library-status")).toContainText("暂无词条");
  await worker.evaluate(saved => twpConfig.set("aiTranslationSettings", saved), previousAISettings);
  await panel.close();
  await worker.evaluate(originalPreferences => {
    translationService.translateText = self.savedCompareTranslate;
    twpConfig.set("sidebarPreferences", originalPreferences.sidebar);
    twpConfig.set("textComparisonServices", originalPreferences.services);
  }, originalPreferences);
};
