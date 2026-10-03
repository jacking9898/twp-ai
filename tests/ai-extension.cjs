const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const calls = [];
  let mode = "normal", delay = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      if (req.url !== "/v1/chat/completions") { res.writeHead(404); return res.end(); }
      const body = JSON.parse(raw);
      calls.push({ body, auth: req.headers.authorization });
      const payload = JSON.parse(body.messages.find(m => m.role === "user").content);
      const translations = payload.segments.map(s => ({ id: s.id, text: `译文：${s.text}` })).reverse();
      setTimeout(() => {
        if (mode === "unauthorized") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "private-provider-detail-do-not-forward", type: "invalid_api_key" } })); }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: 1, model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: mode === "invalid" ? "not JSON" : JSON.stringify({ translations }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 25, completion_tokens: 15, total_tokens: 40 } }));
      }, delay);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}/v1`;
  const version = JSON.parse(fs.readFileSync("src/manifest.json")).version;
  const extension = path.resolve(`build/TWP_AI_${version}_Chromium_MV3`);
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve("build/ai-profile-")), {
    channel: process.env.TWP_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true, viewport: { width: 1280, height: 940 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = worker.url().split("/")[2];
    await worker.evaluate(async () => {
      await twpConfig.onReady();
      self.aiErrors = [];
      addEventListener("unhandledrejection", event => self.aiErrors.push(String(event.reason)));
      twpConfig.set("targetLanguages", ["zh-CN", "en", "ja"]);
      twpConfig.set("targetLanguage", "zh-CN");
      twpConfig.set("showReleaseNotes", "no");
    });
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options/ai.html`);
    await settings.locator("#profile-name").fill("本机测试模型");
    await settings.locator("#base-url").fill(`${address}/chat/completions`);
    await settings.locator("#model").fill("test-model");
    await settings.locator("#api-key").fill("demo-secret-for-local-test");
    await settings.getByRole("button", { name: "保存服务", exact: true }).click();
    await expect(settings.locator("#profile-status")).toContainText("服务已保存");
    await expect(settings.locator("#api-key")).toHaveValue("");
    await settings.reload();
    await expect(settings.locator("#profile-name")).toHaveValue("本机测试模型");
    await expect(settings.locator("#base-url")).toHaveValue(address);
    await expect(settings.locator("#api-key")).toHaveAttribute("placeholder", /已保存密钥/);
    expect(await settings.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)).includes("demo-secret"))).toBe(false);
    expect(await settings.evaluate(() => twpConfig.export().includes("demo-secret"))).toBe(false);
    await settings.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(settings.locator("#profile-status")).toContainText("连接成功", { timeout: 15000 });
    expect(calls[0].auth).toBe("Bearer demo-secret-for-local-test");
    expect(calls[0].body.model).toBe("test-model");
    // Cross-origin credential reuse must require an explicit new key/clear.
    await settings.locator("#base-url").fill("https://another-provider.invalid/v1");
    await settings.getByRole("button", { name: "保存服务", exact: true }).click();
    await expect(settings.locator("#profile-status")).toContainText("重新填写密钥");
    await settings.locator("#base-url").fill(address);
    const firstProfile = await settings.locator("#profiles").inputValue();
    await settings.getByRole("button", { name: "添加服务", exact: true }).click();
    await settings.locator("#profile-name").fill("第二组服务");
    await settings.locator("#base-url").fill(address);
    await settings.locator("#model").fill("second-model");
    await settings.getByRole("button", { name: "保存服务", exact: true }).click();
    await expect(settings.locator("#profile-status")).toContainText("服务已保存");
    await expect(settings.locator("#profiles option")).toHaveCount(3);
    const secondProfile = await settings.locator("#profiles").inputValue();
    await settings.locator("#active-profile").selectOption(secondProfile);
    await settings.getByRole("button", { name: "保存偏好", exact: true }).click();
    await settings.locator("#source").fill("Second profile request.");
    await settings.getByRole("button", { name: "AI 翻译", exact: true }).click();
    await expect(settings.locator("#result")).toHaveText("译文：Second profile request.");
    expect(calls.at(-1).body.model).toBe("second-model");
    expect(calls.at(-1).auth).toBeUndefined();
    await settings.locator("#profiles").selectOption(firstProfile);
    await settings.locator("#active-profile").selectOption(firstProfile);
    await settings.locator("#engine").selectOption("openai");
    await settings.locator("#domain").selectOption("ml");
    await settings.locator("#glossary").fill("feature engineering = 特征工程");
    await settings.getByRole("button", { name: "保存偏好", exact: true }).click();
    await expect(settings.locator("#preferences-status")).toHaveText("偏好已保存");
    await settings.locator("#source").fill("RF uses feature engineering.");
    await settings.getByRole("button", { name: "AI 翻译", exact: true }).click();
    await expect(settings.locator("#result")).toHaveText("译文：RF uses feature engineering.");
    expect(calls.at(-1).body.messages[0].content).toContain("machine learning");
    expect(calls.at(-1).body.messages[0].content).toContain("特征工程");
    await settings.screenshot({ path: path.resolve("build/ai-settings-preview.png"), fullPage: true });
    await context.route("https://ai-translation.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Machine learning guide</title><style>body{font:18px/1.7 system-ui;max-width:760px;margin:65px auto;color:#20334b}h1{font-size:36px}p{margin:28px 0}</style></head><body><h1>Learning with context</h1><p id="first">Random forests combine multiple decision trees.</p><p id="second">Feature engineering improves model performance.</p><a id="link" href="#first">Read the original paragraph</a></body></html>` }));
    const page = await context.newPage();
    // Exercise the floating dropdown itself, not just the separate settings
    // page. Saving the display mode synchronously refreshes this dropdown.
    for (const initialMode of ["bilingual", "translated"]) {
      await worker.evaluate(displayMode => {
        twpConfig.set("pageTranslatorService", "bing");
        twpConfig.set("pageTranslationMode", displayMode);
      }, initialMode);
      await page.goto("https://ai-translation.test/article");
      await expect(page.locator("#twp-interactive-ui")).toHaveCount(1);
      await page.locator("#twp-floating #toggle").hover();
      await page.getByRole("button", { name: "控制面板", exact: true }).click();
      const engine = page.locator("#twp-floating #engine");
      await expect(engine).toHaveValue("bing");
      const beforeSwitch = calls.length;
      await engine.selectOption("openai");
      await expect(engine).toHaveValue("openai");
      await expect(page.locator("#twp-floating #profile")).toHaveValue(firstProfile);
      await expect(page.locator("#twp-floating #ai-options")).toBeVisible();
      await expect(page.locator("#twp-floating #mode")).toHaveValue("bilingual");
      await expect.poll(() => worker.evaluate(async () =>
        (await chrome.storage.local.get("pageTranslatorService")).pageTranslatorService)).toBe("openai");
      expect(calls.length).toBe(beforeSwitch);
      await page.reload();
      await page.locator("#twp-floating #toggle").hover();
      await page.getByRole("button", { name: "控制面板", exact: true }).click();
      await expect(page.locator("#twp-floating #engine")).toHaveValue("openai");
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    }
    const toggle = page.getByRole("button", { name: "翻译网页", exact: true });
    await expect(toggle).toBeVisible();
    const beforeHover = calls.length;
    await toggle.hover();
    await expect(page.getByRole("button", { name: "控制面板", exact: true })).toBeVisible();
    expect(calls.length).toBe(beforeHover);
    await toggle.click();
    await expect(page.locator("#first [data-twp-bilingual]")).toHaveText("译文：Random forests combine multiple decision trees.", { timeout: 15000 });
    expect(calls.at(-1).body.model).toBe("test-model");
    await expect(page.locator("#second [data-twp-bilingual]")).toHaveText("译文：Feature engineering improves model performance.");
    await page.getByRole("button", { name: "显示原文", exact: true }).click();
    await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
    const afterFirst = calls.length;
    await page.getByRole("button", { name: "翻译网页", exact: true }).click();
    await expect(page.locator("#first [data-twp-bilingual]")).toHaveCount(1);
    expect(calls.length).toBe(afterFirst); // exact same content/settings hits persistent cache
    await page.getByRole("button", { name: "显示原文", exact: true }).click();
    await page.locator("#first").evaluate(node => node.textContent = "A new paragraph for cancellation.");
    delay = 1800;
    await page.getByRole("button", { name: "翻译网页", exact: true }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(afterFirst);
    await page.getByRole("button", { name: "取消翻译并恢复原文", exact: true }).click();
    await page.waitForTimeout(2200);
    await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
    delay = 0; mode = "unauthorized";
    // Use fresh content to test a provider error even if a slow test runner let
    // the preceding response finish just before clicking Restore.
    await page.locator("#first").evaluate(node => node.textContent = "A fresh paragraph for the authorization error.");
    await page.getByRole("button", { name: "翻译网页", exact: true }).click();
    await expect(page.getByRole("button", { name: "重试翻译", exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "重试翻译", exact: true }).hover();
    await page.getByRole("button", { name: "控制面板", exact: true }).click();
    await expect(page.locator("#twp-floating #status")).toContainText("密钥无效");
    expect(await page.locator("#twp-floating #status").textContent()).not.toContain("private-provider");
    mode = "invalid";
    await page.locator("#twp-floating #translate").click();
    await expect(page.locator("#twp-floating #status")).toContainText("返回格式不正确", { timeout: 15000 });
    await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
    mode = "normal";
    await page.locator("#twp-floating #translate").click();
    await expect(page.locator("#first [data-twp-bilingual]")).toHaveCount(1);
    await page.screenshot({ path: path.resolve("build/floating-ai-preview.png") });
    await page.locator("#second").evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await page.locator("#twp-floating #selection").click();
    await expect(page.locator("#twp-interactive-ui #result")).toHaveText("译文：Feature engineering improves model performance.");
    // Updating the glossary must not reuse the earlier cached selected text.
    const beforeGlossary = calls.length;
    await settings.locator("#glossary").fill("feature engineering = 特征构建");
    await settings.getByRole("button", { name: "保存偏好", exact: true }).click();
    await page.locator("#twp-floating #toggle").hover();
    await page.getByRole("button", { name: "控制面板", exact: true }).click();
    await page.locator("#twp-floating #selection").click();
    await expect.poll(() => calls.length).toBeGreaterThan(beforeGlossary);
    await expect.poll(() => calls.some(call => call.body.messages[0].content.includes("特征构建"))).toBe(true);
    // Inline literal snippets and links survive even though the model only sees placeholders.
    await settings.locator("#source").fill("Keep `model.fit(X)` and $x^2$ at https://example.test/guide unchanged.");
    await settings.getByRole("button", { name: "AI 翻译", exact: true }).click();
    await expect(settings.locator("#result")).toHaveText("译文：Keep `model.fit(X)` and $x^2$ at https://example.test/guide unchanged.");
    expect(calls.at(-1).body.messages.at(-1).content).toContain("__TWP_KEEP_");
    // Read-only page data cannot retrieve private profiles via the content world.
    const cdp = await context.newCDPSession(page);
    const worlds = [];
    cdp.on("Runtime.executionContextCreated", event => worlds.push(event.context));
    await cdp.send("Runtime.enable");
    const extensionWorld = worlds.find(world => world.name === id || world.origin === `chrome-extension://${id}`);
    expect(extensionWorld).toBeTruthy();
    const privateResult = await cdp.send("Runtime.evaluate", { contextId: extensionWorld.id, expression: `chrome.runtime.sendMessage({action:'aiGetSettings'})`, awaitPromise: true, returnByValue: true });
    expect(privateResult.result.value.ok).toBe(false);
    await page.locator("#twp-floating #toggle").hover();
    await page.getByRole("button", { name: "控制面板", exact: true }).click();
    await page.locator("#twp-floating #hide-site").click();
    await expect(page.locator("#twp-floating")).toBeHidden();
    await page.reload();
    await expect(page.locator("#twp-floating")).toBeHidden();
    await settings.getByRole("button", { name: "恢复已隐藏网站的按钮", exact: true }).click();
    await expect(page.locator("#twp-floating")).toBeVisible();
    await settings.setViewportSize({ width: 430, height: 900 });
    await expect(settings.locator("#profile-name")).toBeVisible();
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 430, height: 760 });
    await page.locator("#twp-floating #toggle").hover();
    await page.getByRole("button", { name: "控制面板", exact: true }).click();
    const panelBounds = await page.locator("#twp-floating #panel").boundingBox();
    expect(panelBounds.x).toBeGreaterThanOrEqual(0);
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(430);
    expect(panelBounds.y).toBeGreaterThanOrEqual(0);
    expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(760);
    await page.screenshot({ path: path.resolve("build/floating-ai-narrow.png") });
    await require("./sidepanel-flow.cjs")({ context, worker, id, page, calls, configure: options => {
      if (options.mode !== undefined) mode = options.mode;
      if (options.delay !== undefined) delay = options.delay;
    } });
    await require("./control-panel-flow.cjs")({ context, worker, id, page, calls, configure: options => {
      if (options.mode !== undefined) mode = options.mode;
      if (options.delay !== undefined) delay = options.delay;
    } });
    await require("./comparison-flow.cjs")({ context, worker, id, settings, calls, configure: options => {
      if (options.mode !== undefined) mode = options.mode;
      if (options.delay !== undefined) delay = options.delay;
    } });
    await settings.locator("#profiles").selectOption(secondProfile);
    await settings.locator("#delete-profile").click();
    await expect(settings.locator("#profiles option")).toHaveCount(2);
    expect(errors).toEqual([]);
    expect(await worker.evaluate(() => self.aiErrors)).toEqual([]);
    console.log("AI extension integration passed: SDK requests, credential isolation, glossary, cancellation, errors, native sidebar, file export, control panel, workspaces, paragraph hover/restore and selection triggers.");
  } catch (error) { console.error("Browser errors:", errors); throw error; }
  finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
