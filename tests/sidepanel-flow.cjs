const { expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function sidepanelFlow({ context, worker, id, page, calls, configure }) {
  await worker.evaluate(() => {
    self.sidebarOpens = [];
    const open = chrome.sidePanel.open.bind(chrome.sidePanel);
    chrome.sidePanel.open = options => {
      const promise = open(options);
      promise.then(() => self.sidebarOpens.push("opened"), error => self.sidebarOpens.push(error.message));
      return promise;
    };
  });
  await page.locator("#twp-floating #close").click();
  await page.locator("#twp-floating #toggle").hover();
  const top = page.getByRole("button", { name: "打开翻译侧边栏", exact: true });
  const bottom = page.getByRole("button", { name: "控制面板", exact: true });
  await expect(top).toBeVisible();
  const topBox = await top.boundingBox();
  const toggleBox = await page.locator("#twp-floating #toggle").boundingBox();
  const bottomBox = await bottom.boundingBox();
  expect(topBox.y + topBox.height).toBeLessThan(toggleBox.y);
  expect(toggleBox.y + toggleBox.height).toBeLessThan(bottomBox.y);
  await top.click();
  await expect.poll(() => worker.evaluate(() => self.sidebarOpens)).toEqual(["opened"]);
  await expect(page.locator("#twp-floating #panel")).toBeHidden();
  // Exercise the actual extension page at native sidebar dimensions as well.
  // Chromium's native sidebar target isn't exposed as a Playwright Page.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 384, height: 880 });
  await panel.emulateMedia({ colorScheme: "dark" });
  await panel.goto(`chrome-extension://${id}/options/sidepanel.html`);
  const activeProfile = await worker.evaluate(() => twpConfig.get("aiActiveProfile"));
  async function chooseTextService(id) {
    if (!await panel.locator("#compare-picker").getAttribute("open").then(value => value !== null)) await panel.locator("#compare-summary").click();
    const inputs = panel.locator("#compare-list input");
    for (let index = 0; index < await inputs.count(); index++) {
      const input = inputs.nth(index); await input.setChecked(await input.inputValue() === id);
    }
    await panel.locator("#compare-summary").click();
  }
  await chooseTextService(`ai:${activeProfile}`);
  await expect(panel.locator("#engine")).toHaveValue("openai");
  await expect(panel.locator("#profile")).not.toHaveValue("");
  await expect(panel.getByRole("combobox", { name: "源语言", exact: true })).toHaveValue("auto");
  await expect(panel.locator("#translate-text")).toBeDisabled();
  await panel.locator("#source").fill("A random forest combines many decision trees.");
  await panel.locator("#source").press("Control+Enter");
  await expect(panel.locator("#comparison-results .translation")).toHaveText("译文：A random forest combines many decision trees.");
  expect(calls.at(-1).body.model).toBe("test-model");
  expect(JSON.parse(calls.at(-1).body.messages.find(message => message.role === "user").content).sourceLanguage).toBe("auto");
  await panel.screenshot({ path: path.resolve("build/sidebar-text-dark.png"), fullPage: true });
  await panel.locator("#source").fill("<img src=x onerror=alert(1)> is literal text.");
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveText("译文：<img src=x onerror=alert(1)> is literal text.");
  await expect(panel.locator("#comparison-results img")).toHaveCount(0);

  // Cancellation ignores late results and allows a fresh request.
  configure({ delay: 1200 });
  await panel.locator("#source").fill("Cancel this sidebar request.");
  const before = calls.length;
  await panel.locator("#translate-text").click();
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  await expect(panel.locator("#source-language")).toBeDisabled();
  await panel.locator("#cancel").click();
  await expect(panel.locator("#source-language")).toBeEnabled();
  await expect(panel.locator("#task-status")).toHaveText("已取消翻译");
  await panel.waitForTimeout(1500);
  await expect(panel.locator("#result-card")).toBeHidden();
  configure({ delay: 0, mode: "unauthorized" });
  await panel.locator("#source").fill("Unauthorized sidebar translation.");
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results")).toContainText("密钥无效");
  await expect(panel.locator("#result-card")).toBeHidden();
  configure({ mode: "normal" });

  // Traditional services share the existing background adapter; deterministic
  // stub avoids depending on an external provider's network during this test.
  await worker.evaluate(() => {
    self.originalTextTranslation = translationService.translateText;
    translationService.translateText = async (service, source, target, texts) => {
      self.sidebarTraditionalRequest = { service, source, target, texts };
      return texts.map(text => `微软译文：${text}`);
    };
  });
  await chooseTextService("bing");
  await panel.locator("#source-language").selectOption("en");
  await panel.locator("#target").selectOption("ja");
  await panel.locator("#source").fill("Traditional service test.");
  await panel.locator("#translate-text").click();
  await expect(panel.locator("#comparison-results .translation")).toHaveText("微软译文：Traditional service test.");
  expect(await worker.evaluate(() => self.sidebarTraditionalRequest.service)).toBe("bing");
  expect(await worker.evaluate(() => self.sidebarTraditionalRequest.source)).toBe("en");
  expect(await worker.evaluate(() => self.sidebarTraditionalRequest.target)).toBe("ja");
  // Sidebar service selection must not change the web page's service.
  expect(await worker.evaluate(() => twpConfig.get("pageTranslatorService"))).toBe("openai");
  await panel.reload();
  await expect(panel.locator('#compare-list input[value="bing"]')).toBeChecked();
  await expect(panel.locator("#target")).toHaveValue("ja");
  await expect(panel.locator("#source-language")).toHaveValue("en");
  await worker.evaluate(() => { translationService.translateText = self.originalTextTranslation; });
  await chooseTextService(`ai:${activeProfile}`);
  await panel.locator("#target").selectOption("zh-CN");

  await panel.getByRole("tab", { name: "文档", exact: true }).click();
  await panel.locator("#document-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Hello from a file.\r\n\r\nSecond paragraph.\r\n") });
  const beforeFile = calls.length;
  await expect(panel.locator("#document-name")).toContainText("2 段");
  expect(calls.length).toBe(beforeFile); // Reading local files does not submit them.
  await panel.locator("#translate-document").click();
  await expect(panel.locator("#result")).toHaveText("Hello from a file.\n译文：Hello from a file.\n\nSecond paragraph.\n译文：Second paragraph.");
  expect(JSON.parse(calls.at(-1).body.messages.find(message => message.role === "user").content).sourceLanguage).toBe("en");
  const downloadPromise = panel.waitForEvent("download");
  await panel.locator("#download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes.bilingual.txt");
  expect(fs.readFileSync(await download.path(), "utf8")).toBe("Hello from a file.\r\n译文：Hello from a file.\r\n\r\nSecond paragraph.\r\n译文：Second paragraph.\r\n");
  await panel.locator("#source-language").selectOption("auto");
  await expect(panel.locator("#result-card")).toBeHidden();
  await expect(panel.locator("#download")).toBeHidden();
  await expect(panel.locator("#translate-document")).toBeEnabled();
  await panel.locator("#document-file").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from([0xff, 0xfe, 0x61, 0]) });
  await expect(panel.locator("#task-status")).toContainText("UTF-8");
  await expect(panel.locator("#translate-document")).toBeDisabled();
  await expect(panel.locator("#download")).toBeHidden();

  await panel.getByRole("tab", { name: "视频", exact: true }).click();
  await panel.locator("#source-language").selectOption("en");
  const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nKeep learning.\r\n";
  await panel.locator("#subtitle-file").setInputFiles({ name: "lesson.srt", mimeType: "text/plain", buffer: Buffer.from(srt) });
  await expect(panel.locator("#subtitle-name")).toContainText("1 段");
  await panel.locator("#translate-video").click();
  await expect(panel.locator("#task-status")).toHaveText("翻译完成");
  expect(JSON.parse(calls.at(-1).body.messages.find(message => message.role === "user").content).sourceLanguage).toBe("en");
  const subtitleDownloadPromise = panel.waitForEvent("download");
  await panel.locator("#download").click();
  const subtitleDownload = await subtitleDownloadPromise;
  expect(subtitleDownload.suggestedFilename()).toBe("lesson.bilingual.srt");
  expect(fs.readFileSync(await subtitleDownload.path(), "utf8")).toBe(srt.replace("Keep learning.", "Keep learning.\r\n译文：Keep learning."));
  await panel.screenshot({ path: path.resolve("build/sidebar-subtitles-dark.png"), fullPage: true });
  await panel.getByRole("tab", { name: "图片", exact: true }).click();
  await expect(panel.getByText("图片识别尚未接入", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "前往文本翻译 →", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "文本", exact: true })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "文本", exact: true }).press("ArrowDown");
  await expect(panel.getByRole("tab", { name: "文档", exact: true })).toBeFocused();
  for (const width of [320, 384, 720]) {
    await panel.setViewportSize({ width, height: 880 });
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.setViewportSize({ width: 384, height: 880 });
  await panel.emulateMedia({ colorScheme: "light" });
  await panel.screenshot({ path: path.resolve("build/sidebar-document-light.png"), fullPage: true });
  await panel.close();
};
