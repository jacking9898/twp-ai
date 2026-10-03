async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium} = require("playwright");
const {expect} = require("@playwright/test");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const pdfFixture = require("./pdf-fixture.cjs");
(async () => {
  let calls = [], delay = 0;
  const server = http.createServer((req,res) => {
    let raw=""; req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      const body = JSON.parse(raw); calls.push(body);
      const payload = JSON.parse(body.messages.find(message => message.role === "user").content);
      const translations = payload.segments.map(segment => ({id:segment.id, text:`译文 ${calls.length}：${segment.text}`}));
      setTimeout(() => { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({id:"test",object:"chat.completion",created:1,model:body.model,choices:[{index:0,message:{role:"assistant",content:JSON.stringify({translations})},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})); },delay);
    });
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const version = JSON.parse(fs.readFileSync("src/manifest.json")).version;
  const extension = path.resolve(`build/TWP_AI_${version}_Chromium_MV3`);
  const profile = fs.mkdtempSync(path.resolve("build/pdf-cache-profile-"));
  const errors = [];
  async function launch() {
    const context = await chromium.launchPersistentContext(profile, {channel:process.env.TWP_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"),headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    return context;
  }
  let context = await launch();
  try {
    let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = worker.url().split("/")[2], base = `chrome-extension://${id}`;
    await worker.evaluate(async () => {await twpConfig.onReady();twpConfig.set("showReleaseNotes","no");twpConfig.set("pdfLayoutMode","flow");twpConfig.set("pdfSyncScroll",false);twpConfig.set("targetLanguage","zh-CN");twpConfig.set("pdfAutoTranslate",false);});
    let settings = await context.newPage(); await settings.goto(`${base}/options/ai.html`);
    await settings.locator("#profile-name").fill("PDF 测试模型");
    await settings.locator("#base-url").fill(`http://127.0.0.1:${server.address().port}/v1`);
    await settings.locator("#model").fill("pdf-model");
    await settings.getByRole("button",{name:"保存服务",exact:true}).click();
    await expect(settings.locator("#profile-status")).toContainText("服务已保存");
    await settings.locator("#active-profile").selectOption(await settings.locator("#profiles").inputValue());
    await settings.locator("#engine").selectOption("openai");
    await settings.getByRole("button",{name:"保存偏好",exact:true}).click();
    await expect(settings.locator("#preferences-status")).toHaveText("偏好已保存");
    await expect(settings.locator("#cache-hours")).toHaveValue("168");
    let panel = await context.newPage(); await panel.goto(`${base}/options/sidepanel.html?workspace=1&view=document`);
    await panel.locator("#engine").selectOption("openai");
    await expect(panel.locator("#profile")).not.toHaveValue("");
    const toolbar = await panel.locator("#translation-options").boundingBox(), upload = await panel.locator("#view-document .upload-card").boundingBox();
    expect(Math.abs(toolbar.x-upload.x)).toBeLessThan(1); expect(Math.abs(toolbar.width-upload.width)).toBeLessThan(1);
    async function openPDF(name="guide.pdf") {
      await panel.locator("#document-file").setInputFiles({name,mimeType:"application/pdf",buffer:pdfFixture()});
      await expect(panel.locator("#document-name")).toContainText("3 页");
      await expect(panel.locator('.pdf-source-page[data-page="1"] canvas')).toBeVisible();
    }
    const workspace = panel;
    const opened = context.waitForEvent("page");
    await workspace.locator("#document-file").setInputFiles({name:"guide.pdf",mimeType:"application/pdf",buffer:pdfFixture()});
    panel = await opened; await panel.waitForURL(base + "/options/pdf.html*");
    await expect(panel.locator("#document-name")).toContainText("3 页");
    await expect(panel.locator('.pdf-source-page[data-page="1"] canvas')).toBeVisible();
    expect(calls.length).toBe(0);
    await expect(workspace.locator("#pdf-reader")).toHaveCount(0);
    await workspace.close(); // The PDF tab owns its file after the handoff.
    const left = await panel.locator('.pdf-source-page[data-page="1"]').boundingBox(), right = await panel.locator('.pdf-translation-page[data-page="1"]').boundingBox();
    expect(right.x).toBeGreaterThan(left.x+left.width);
    await panel.locator("#translate-document").click();
    await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");
    await expect(panel.locator(".pdf-translation-page .translation").first()).toContainText("COMPUTER SCIENCE");
    expect(calls.length).toBe(1);
    await panel.locator("#translate-document").click();
    await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成"); expect(calls.length).toBe(1);
    await panel.locator("#retranslate-document").click();
    await expect(panel.locator(".pdf-translation-page .translation").first()).toContainText("译文 2"); expect(calls.length).toBe(2);
    const expected = await panel.locator("#pdf-translations").innerText();
    await panel.emulateMedia({colorScheme:"dark"});
    await expect(panel.locator(".reader-header")).toBeInViewport();
    await panel.screenshot({path:path.resolve("build/pdf-bilingual-dark.png"),fullPage:true});
    // A full browser/background restart must preserve the successful cache.
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    panel = await context.newPage(); await panel.goto(`${base}/options/pdf.html`);
    await openPDF("renamed-guide.pdf"); await panel.locator("#translate-document").click();
    await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成"); expect(calls.length).toBe(2);
    expect(await panel.locator("#pdf-translations").innerText()).toBe(expected);
    await panel.locator("#pdf-scope").selectOption("all"); await panel.locator("#translate-document").click();
    await expect(panel.locator("#task-status")).toContainText("3 页"); expect(calls.length).toBe(3);
    await panel.locator("#pdf-next").click(); await expect(panel.locator("#pdf-translations")).toContainText("LANGUAGE MODELS");
    await panel.locator("#pdf-next").click(); await expect(panel.locator("#pdf-translations")).toContainText("需要 OCR");
    await expect(panel.locator("#pdf-page")).toHaveValue("3");
    const downloadPromise = panel.waitForEvent("download"); await panel.locator("#pdf-export").click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toBe("renamed-guide.bilingual.txt");
    expect(fs.readFileSync(await download.path(),"utf8")).toContain("第 3 页");
    for (const width of [384,720,1440]) {await panel.setViewportSize({width,height:1000});expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);}
    await panel.locator("#pdf-page").fill("1"); await panel.locator("#pdf-page").press("Tab");
    await panel.locator("#pdf-scope").selectOption("page");
    settings = await context.newPage(); await settings.goto(`${base}/options/ai.html`);
    // Persisted rows are backdated to exercise real TTL cleanup.
    await settings.evaluate(() => new Promise((resolve,reject) => {
      const request=indexedDB.open("TWP_AI_CACHE",1);request.onsuccess=()=>{const db=request.result,tx=db.transaction("translations","readwrite"),store=tx.objectStore("translations"),rows=store.getAll();rows.onsuccess=()=>rows.result.forEach(row=>store.put({...row,createdAt:Date.now()-7200000}));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};request.onerror=reject;
    }));
    await settings.locator("#cache-hours").fill("1"); await settings.getByRole("button",{name:"保存缓存设置",exact:true}).click();
    await panel.locator("#translate-document").click(); await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成"); expect(calls.length).toBe(4);
    await settings.locator("#clear-ai-cache").click(); await expect(settings.locator("#cache-status")).toContainText("已清空");
    await panel.locator("#translate-document").click(); await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成"); expect(calls.length).toBe(5);
    delay=1500; await panel.locator("#retranslate-document").click(); await expect.poll(()=>calls.length).toBe(6);
    await panel.keyboard.press("Escape"); await expect(panel.locator("#task-status")).toContainText("已取消");
    await panel.waitForTimeout(1700); expect(await panel.locator("#pdf-translations").innerText()).not.toContain("译文 6");delay=0;
    await panel.locator("#translate-document").click();await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");expect(calls.length).toBe(6);
    await settings.locator("#cache-enabled").uncheck();await settings.getByRole("button",{name:"保存缓存设置",exact:true}).click();
    await panel.locator("#translate-document").click();await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");expect(calls.length).toBe(7);
    await panel.locator("#translate-document").click();await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");expect(calls.length).toBe(8);
    await settings.locator("#cache-enabled").check();await settings.getByRole("button",{name:"保存缓存设置",exact:true}).click();
    // Clearing during an active request must not let its late response refill
    // the user's deleted cache. The current result may still be displayed.
    delay=2500;await panel.locator("#retranslate-document").click();await expect.poll(()=>calls.length).toBe(9);
    await settings.locator("#clear-ai-cache").click();await expect(settings.locator("#cache-status")).toContainText("已清空");
    await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");delay=0;
    await panel.locator("#translate-document").click();await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");expect(calls.length).toBe(10);
    await context.route("https://cache-web.test/**",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html lang="en"><head><title>Cache guide</title></head><body><p id="sample">This page explains translation cache persistence.</p></body></html>'}));
    const web = await context.newPage();await web.goto("https://cache-web.test/article");
    await web.locator("#twp-floating #toggle").hover();await web.getByRole("button",{name:"控制面板",exact:true}).click();
    await web.locator("#twp-floating #engine").selectOption("openai");
    await expect(web.locator("#twp-floating #profile")).not.toHaveValue("");
    await web.locator("#twp-floating #close").click();
    await web.locator("#twp-floating #toggle").click();await expect(web.locator("#sample [data-twp-bilingual]")).toBeVisible();
    const beforeReload=calls.length;await web.reload();await expect(web.locator("#sample [data-twp-bilingual]")).toBeVisible();expect(calls.length).toBe(beforeReload);
    await web.locator("#twp-floating #toggle").hover();await web.getByRole("button",{name:"控制面板",exact:true}).click();
    await web.locator("#twp-floating #retranslate").click();await expect.poll(()=>calls.length).toBe(beforeReload+1);await expect(web.locator("#sample [data-twp-bilingual]")).toContainText(`译文 ${calls.length}`);
    await web.locator("#twp-floating #translate").click();await web.reload();await expect(web.locator("#twp-floating #toggle")).toBeVisible();await expect(web.locator("[data-twp-bilingual]")).toHaveCount(0);
    const newTab = await context.newPage();await newTab.goto("https://cache-web.test/article");await expect(newTab.locator("#twp-floating #toggle")).toBeVisible();await expect(newTab.locator("[data-twp-bilingual]")).toHaveCount(0);

    // Long PDFs use one continuous scroll container, with a bounded canvas set.
    const book = pdfFixture({pages:Array.from({length:30},(_,i)=>[
      `PAGE ${i+1}: READING GUIDE`, "Continuous bilingual reading", "A vector space contains vectors and supports addition.",
      "Scalar multiplication preserves the structure of the space.", "A norm assigns a nonnegative length to each vector.",
      "The triangle inequality describes distances between points.", "Translation settings are shared with the document workspace.",
      "Completed pages remain available while translation continues."
    ]),outline:true,sizes:{14:[842,595]}});
    const beforeReading = calls.length;
    await panel.locator("#document-file").setInputFiles({name:"reading-guide.pdf",mimeType:"application/pdf",buffer:book});
    await expect(panel.locator("#document-name")).toContainText("30 页");
    await expect(panel.locator("#pdf-outline-items button")).toHaveCount(30);
    await expect(panel.locator('.pdf-source-page[data-page="1"] canvas')).toBeVisible();
    await panel.locator("#pdf-scroll").hover(); await panel.mouse.wheel(0,1000);
    await expect.poll(async()=>Number(await panel.locator("#pdf-page").inputValue())).toBeGreaterThan(1);
    await expect(panel.locator(".reader-header")).toBeInViewport();
    const rightPosition = await panel.locator("#pdf-translation-scroll").evaluate(node=>node.scrollTop);
    expect(rightPosition).toBe(0); // Original-side scrolling leaves translations free to scroll independently.
    await panel.getByRole("button",{name:"Chapter 25",exact:true}).click();
    await expect(panel.locator("#pdf-page")).toHaveValue("25");
    await expect(panel.locator('.pdf-source-page[data-page="25"] canvas')).toBeVisible();
    await expect.poll(()=>panel.locator("#pdf-pages canvas").count()).toBeLessThanOrEqual(6);
    await expect(panel.locator('.pdf-source-page[data-page="1"] canvas')).toHaveCount(0);
    expect(calls.length).toBe(beforeReading); // Automatic translation is explicitly disabled in this manual/cache suite.
    await panel.locator("#pdf-zoom").selectOption("1.5");
    await expect(panel.locator('.pdf-source-page[data-page="25"] canvas')).toBeVisible();
    await expect(panel.locator("#pdf-page")).toHaveValue("25");
    await panel.locator("#pdf-zoom").selectOption("fit");
    delay=700; await panel.locator("#translate-document").click();
    await expect(panel.locator("#pdf-next")).toBeEnabled(); await panel.locator("#pdf-next").click();
    await expect(panel.locator("#pdf-page")).toHaveValue("26");
    await expect(panel.locator('.pdf-translation-page[data-page="25"] .translation').first()).toContainText("PAGE 25");
    await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成"); delay=0;
    await expect(panel.locator("#pdf-page")).toHaveValue("26");
    await expect(panel.locator('.pdf-translation-page[data-page="26"]')).toContainText("本页尚未翻译");
    const partialDownload = panel.waitForEvent("download"); await panel.locator("#pdf-export").click();
    expect((await partialDownload).suggestedFilename()).toContain("partial");
    await panel.getByRole("button",{name:"Chapter 15",exact:true}).click();
    await expect(panel.locator('.pdf-source-page[data-page="15"] canvas')).toBeVisible();
    const landscape = await panel.locator('.pdf-source-page[data-page="15"] canvas').boundingBox();
    expect(landscape.width).toBeGreaterThan(landscape.height);
    await panel.getByRole("button",{name:"Chapter 1",exact:true}).click();
    await panel.locator("#translate-document").click();await expect(panel.locator("#task-status")).toContainText("PDF 翻译完成");
    await setToggle(panel.locator("#bilingual-document"),false);
    await expect(panel.locator('.pdf-translation-page[data-page="1"] .original')).toHaveCount(0);
    await panel.emulateMedia({colorScheme:"light"});
    await panel.setViewportSize({width:2048,height:1017});
    await expect.poll(()=>panel.evaluate(()=>Math.abs(document.querySelector('.pdf-canvas-slot').clientWidth-(document.querySelector('#pdf-scroll').clientWidth-32)))).toBeLessThan(2);
    await panel.locator("#pdf-scroll").evaluate(node=>node.scrollTop=document.querySelector('.pdf-page-row[data-page="2"]').offsetTop-node.clientHeight*.7);
    await expect(panel.locator('.pdf-source-page[data-page="1"] canvas')).toBeVisible();
    await panel.screenshot({path:path.resolve("build/pdf-continuous-light.png")});
    await panel.emulateMedia({colorScheme:"dark"});
    await panel.screenshot({path:path.resolve("build/pdf-continuous-dark.png")});
    await panel.setViewportSize({width:384,height:850});
    await panel.locator("#pdf-outline-toggle").click();
    await expect.poll(()=>panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(panel.locator("#pdf-scroll")).toBeVisible();
    await expect(panel.locator("#engine")).toBeVisible();
    expect(await panel.locator("#engine").evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(11);
    await panel.screenshot({path:path.resolve("build/pdf-continuous-narrow.png")});
    await panel.setViewportSize({width:1440,height:1000});
    await panel.locator("#pdf-page").fill("20");await panel.locator("#pdf-page").press("Tab");
    await expect(panel.locator("#pdf-page")).toHaveValue("20");
    await panel.locator("#pdf-scope").selectOption("all"); delay=1200;
    await panel.locator("#translate-document").click();
    await expect(panel.locator('.pdf-translation-page[data-page="1"] .translation').first()).toBeAttached();
    await expect(panel.locator("#pdf-page")).toHaveValue("20");
    await panel.locator("#cancel").click();delay=0;
    await expect(panel.locator("#task-status")).toContainText("已取消");
    await expect(panel.locator("#pdf-page")).toHaveValue("20");
    // Fast file replacement must discard old rows, outline and in-flight renders.
    await openPDF("replacement.pdf");
    await expect(panel.locator(".pdf-page-row")).toHaveCount(3);
    await expect(panel.locator("#pdf-outline-items")).toContainText("没有目录");
    await panel.locator("#tab-document").count().then(count=>expect(count).toBe(0));
    await panel.locator("#document-file").setInputFiles({name:"bad.pdf",mimeType:"application/pdf",buffer:Buffer.from("bad")});await expect(panel.locator("#task-status")).toContainText("无法读取 PDF");await expect(panel.locator("#translate-document")).toBeDisabled();
    expect(errors).toEqual([]);
    console.log("PDF/cache extension passed: real PDF rendering/extraction, bilingual export, layout, restart persistence, force refresh, TTL, clear/disable, cancellation and webpage refresh intent.");
  } catch(error) {console.error("Browser errors:",errors,"API calls:",calls.length);throw error;}
  finally {await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
