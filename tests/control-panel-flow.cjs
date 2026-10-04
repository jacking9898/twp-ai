const { expect } = require("@playwright/test");
const path = require("node:path");
module.exports = async ({ context, worker, id, page, calls, configure }) => {
  await page.setViewportSize({ width: 1280, height: 940 });
  await page.reload();
  const control = selector => page.locator(`#twp-floating ${selector}`);
  const quick = selector => page.locator(`#twp-interactive-ui ${selector}`);
  async function openPanel() {
    if (await control("#panel").isVisible()) await control("#close").click();
    await control("#toggle").hover();
    await page.getByRole("button", { name: "控制面板", exact: true }).click();
  }
  async function selectText(selector = "#first") {
    await page.locator(selector).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
  }
  async function clearSelection() { await page.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); }); }
  await openPanel();
  // Refresh now restores recent page translations; hover tests require original
  // paragraphs because paragraph translation pauses during whole-page mode.
  await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({url});
    for (const tab of tabs) await chrome.tabs.sendMessage(tab.id, {action: "restorePage"});
  }, page.url());
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  for (const selector of ["#document-tool", "#text-tool", "#hover-tool", "#selection-tool"]) await expect(control(selector)).toBeVisible();
  for (const view of ["text", "document"]) {
    const created = context.waitForEvent("page");
    await control(`#${view}-tool`).click();
    const workspace = await created;
    await workspace.waitForURL(`**/sidepanel.html?workspace=1&view=${view}`);
    await workspace.setViewportSize({ width: 1366, height: 900 });
    await expect(workspace.locator("body")).toHaveClass("workspace");
    await expect(workspace.locator("#heading")).toHaveText(view === "text" ? "文本翻译" : "文档翻译");
    if (view === "text") {
      await workspace.locator("#source").fill("Workspace translation test.");
      await workspace.locator("#translate-text").click();
      await expect(workspace.locator("#comparison-results .translation")).toHaveText("译文：Workspace translation test.");
      const left = await workspace.locator("#view-text").boundingBox(), right = await workspace.locator("#comparison-results").boundingBox();
      expect(left.x + left.width).toBeLessThan(right.x);
      expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    }
    expect(await workspace.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await workspace.screenshot({ path: path.resolve(`build/workspace-${view}.png`), fullPage: true });
    await workspace.close();
  }
  await page.bringToFront();
  await control("#hover-tool").click();
  await control("#hover-enabled").check();
  await control('#hover-triggers [data-value="Control"]').click();
  await control('#hover-effects [data-value="toggle"]').click();
  await expect(control("#hover-key")).toHaveText("Ctrl");
  await page.screenshot({ path: path.resolve("build/control-hover.png") });
  await control("#close").click();
  await clearSelection();
  await page.locator("#first").hover();
  await page.keyboard.press("Control");
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveText("译文：Random forests combine multiple decision trees.");
  expect(calls.at(-1).body.model).toBe("test-model");
  await page.keyboard.press("Control");
  await expect(page.locator("#first [data-twp-interactive]")).toHaveCount(0);
  const beforeChord = calls.length;
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(250);
  expect(calls.length).toBe(beforeChord);
  await expect(page.locator("#first [data-twp-interactive]")).toHaveCount(0);
  // Restore-only never starts a request; translate-only never toggles off.
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "Shift", effect: "restore" }));
  await page.keyboard.press("Shift");
  expect(calls.length).toBe(beforeChord);
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "Alt", effect: "translate" }));
  await page.keyboard.press("Alt");
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveCount(1);
  await page.keyboard.press("Alt");
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveCount(1);
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "Control", effect: "restore" }));
  await expect(control("#hover-effect-hint")).toHaveText("仅还原该段");
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveCount(1);
  const beforeRestore = calls.length;
  await page.keyboard.press("Control");
  await expect(page.locator("#first [data-twp-interactive]")).toHaveCount(0);
  expect(calls.length).toBe(beforeRestore);

  // Restoring while a slow request is running cannot reinsert a late result.
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "Control", effect: "toggle" }));
  await page.locator("#first").evaluate(element => element.textContent = "A delayed hover translation.");
  configure({ delay: 1200 });
  await page.locator("#first").hover();
  const beforeSlow = calls.length;
  await page.keyboard.press("Control");
  await expect.poll(() => calls.length).toBeGreaterThan(beforeSlow);
  await page.keyboard.press("Control");
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-twp-interactive]")).toHaveCount(0);
  configure({ delay: 0 });
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "direct", effect: "translate" }));
  await page.locator("h1").hover(); await page.locator("#second").hover();
  await expect(page.locator("#second [data-twp-interactive=translated]")).toHaveCount(1);
  // A page edit invalidates a paragraph's translation.
  await page.locator("#second").evaluate(element => element.firstChild.textContent = "Changed source paragraph.");
  await expect(page.locator("#second [data-twp-interactive]")).toHaveCount(0);
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "hold", effect: "translate" }));
  await page.locator("#first").hover(); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveCount(1);
  await worker.evaluate(() => twpConfig.set("hoverTranslationSettings", { enabled: false, trigger: "Control", effect: "toggle" }));
  await expect(page.locator("[data-twp-interactive]")).toHaveCount(0);

  // Selection modes use the currently selected page service.
  await openPanel(); await control("#selection-tool").click();
  await control("#selection-toggle").check();
  await control('#selection-triggers [data-value="icon"]').click();
  await page.screenshot({ path: path.resolve("build/control-selection.png") });
  await control("#region-tab").click();
  await expect(control("#region-settings")).toContainText("本地识别");
  await expect(control("#region-start")).toBeEnabled();
  await control("#word-tab").click();
  await control("#close").click(); await clearSelection(); await selectText();
  await expect(quick("#trigger")).toBeVisible();
  const beforeIcon = calls.length;
  await page.waitForTimeout(220); expect(calls.length).toBe(beforeIcon);
  await quick("#trigger").click();
  await expect(quick("#result")).toHaveText("译文：A delayed hover translation.");
  await expect(quick("#service")).toContainText("AI");
  await quick("#close").click(); await clearSelection();
  await worker.evaluate(() => twpConfig.set("selectionTranslationSettings", { trigger: "dot" }));
  await selectText("#second"); await expect(quick("#trigger")).toHaveAttribute("data-dot", "true");
  await quick("#trigger").click(); await expect(quick("#result")).toHaveText("译文：Changed source paragraph.");
  await quick("#close").click(); await clearSelection();
  await worker.evaluate(() => twpConfig.set("selectionTranslationSettings", { trigger: "Control" }));
  await selectText(); await page.keyboard.press("Control");
  await expect(quick("#popup")).toBeVisible();
  await expect(quick("#result")).toHaveText("译文：A delayed hover translation.");
  await quick("#close").click(); await clearSelection();
  await worker.evaluate(() => twpConfig.set("selectionTranslationSettings", { trigger: "direct" }));
  await selectText("#second");
  await expect(quick("#result")).toHaveText("译文：Changed source paragraph.");
  await expect(quick("#popup")).toBeVisible();
  await quick("#close").click(); await clearSelection();
  await worker.evaluate(() => {
    self.originalControlTranslate = translationService.translateText;
    translationService.translateText = async (service, source, target, texts) => texts.map(text => `微软：${text}`);
    twpConfig.set("pageTranslatorService", "bing");
  });
  await selectText();
  await expect(quick("#result")).toHaveText("微软：A delayed hover translation.");
  await expect(quick("#service")).toContainText("微软翻译");
  await worker.evaluate(() => { translationService.translateText = self.originalControlTranslate; twpConfig.set("showTranslateSelectedButton", "no"); });
  await clearSelection(); const beforeDisabled = calls.length;
  await selectText("#second"); await page.waitForTimeout(300);
  await expect(quick("#popup")).toBeHidden(); await expect(quick("#trigger")).toBeHidden(); expect(calls.length).toBe(beforeDisabled);

  await worker.evaluate(() => {
    twpConfig.set("pageTranslatorService", "openai");
    twpConfig.set("selectionTranslationSettings", { trigger: "Shift" });
    twpConfig.set("showTranslateSelectedButton", "yes");
    twpConfig.set("hoverTranslationSettings", { enabled: true, trigger: "Control", effect: "toggle" });
  });
  await page.reload(); await openPanel(); await control("#selection-tool").click();
  await expect(control("#selection-key")).toHaveText("Shift");
  await control("#back").click(); await control("#hover-tool").click();
  await expect(control("#hover-enabled")).toBeChecked();
  await control("#close").click(); await clearSelection();
  await page.evaluate(() => { const input = document.createElement("textarea"); input.id = "typing-test"; document.body.appendChild(input); });
  await page.locator("#typing-test").fill("This is an editable field.");
  const beforeInput = calls.length;
  await page.locator("#typing-test").hover(); await page.keyboard.press("Control");
  await page.waitForTimeout(200); expect(calls.length).toBe(beforeInput);
  await clearSelection(); await page.locator("#first").hover(); await page.keyboard.press("Control");
  await expect(page.locator("#first [data-twp-interactive=translated]")).toHaveCount(1);
  await control("#toggle").click();
  await expect(page.locator("[data-twp-interactive]")).toHaveCount(0);
  await expect(control("#toggle")).toHaveAttribute("data-state", "translated");
  await control("#toggle").click();
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await openPanel();
  // Utility buttons need readable foreground/background pairs in both themes.
  for (const scheme of ['light','dark']) {
    await page.emulateMedia({colorScheme:scheme});
    await expect(control('#cache-manage')).toBeVisible();
    const style = await control('#cache-manage').evaluate(button=>{
      const css=getComputedStyle(button);
      const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(v=>{const c=Number(v)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const fg=luminance(css.color),bg=luminance(css.backgroundColor);
      return {contrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),height:button.getBoundingClientRect().height};
    });
    expect(style.contrast).toBeGreaterThanOrEqual(4.5);expect(style.height).toBeGreaterThanOrEqual(32);
    const button=await control('#cache-manage').boundingBox(),select=await control('#cache-duration').boundingBox();
    expect(Math.abs(button.width-select.width)).toBeLessThan(1);
    await control('#cache-options').screenshot({path:path.resolve(`build/cache-button-${scheme}.png`)});
  }
  const cachedPage=context.waitForEvent('page'),beforeCache=calls.length;
  await control('#cache-manage').click();const manager=await cachedPage;
  await manager.waitForURL('**/options/cache.html');await expect(manager.locator('h1')).toHaveText('翻译缓存');expect(calls.length).toBe(beforeCache);await manager.close();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.resolve("build/control-panel-complete.png") });
  await control("#panel").screenshot({ path: path.resolve("build/control-panel-preview.png") });
};
