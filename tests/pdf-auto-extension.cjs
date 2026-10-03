async function setToggle(button,enabled){if((await button.getAttribute('aria-pressed'))!==String(enabled))await button.click();await expect(button).toHaveAttribute('aria-pressed',String(enabled));}
const {chromium} = require("playwright");
const {expect} = require("@playwright/test");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const pdfFixture = require("./pdf-fixture.cjs");
(async () => {
  const calls = [], errors = [];
  let delay = 0, fail = false;
  const server = http.createServer((req,res) => {
    let raw = ""; req.on("data", data => raw += data);
    req.on("end", () => {
      const body = JSON.parse(raw), payload = JSON.parse(body.messages.find(row => row.role === "user").content);
      calls.push(payload);
      const response = fail ? {error:{message:"Test translation unavailable"}} : {choices:[{message:{role:"assistant",content:JSON.stringify({translations:payload.segments.map(row=>({id:row.id,text:`译文 ${calls.length}：${row.text}`}))})},finish_reason:"stop"}]};
      const code = fail ? 400 : 200;
      setTimeout(() => {res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(response));}, delay);
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const version = JSON.parse(fs.readFileSync("src/manifest.json")).version;
  const extension = path.resolve(`build/TWP_AI_${version}_Chromium_MV3`);
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve("build/pdf-auto-profile-")), {
    channel:process.env.TWP_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"), headless:true,
    viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
  });
  context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const base = `chrome-extension://${worker.url().split("/")[2]}`;
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set("showReleaseNotes","no");twpConfig.set("pdfLayoutMode","flow");twpConfig.set("pdfSyncScroll",false);twpConfig.set("targetLanguage","zh-CN");});
    const settings = await context.newPage(); await settings.goto(base+"/options/ai.html");
    await settings.locator("#profile-name").fill("Auto PDF model");
    await settings.locator("#base-url").fill(`http://127.0.0.1:${server.address().port}/v1`);
    await settings.locator("#model").fill("pdf-auto-model");
    await settings.getByRole("button",{name:"保存服务",exact:true}).click();
    await expect(settings.locator("#profile-status")).toContainText("服务已保存");
    await settings.locator("#active-profile").selectOption(await settings.locator("#profiles").inputValue());
    await settings.locator("#engine").selectOption("openai");
    await settings.getByRole("button",{name:"保存偏好",exact:true}).click();
    await expect(settings.locator("#preferences-status")).toContainText("偏好已保存");
    const reader = await context.newPage(); await reader.goto(base+"/options/pdf.html");
    const book = pdfFixture({pages:Array.from({length:12},(_,i)=>i===11?[]:[`AUTO PAGE ${i+1}`,"A practical guide to computer science."]),outline:true});
    const result = n => reader.locator(`.pdf-translation-page[data-page="${n}"] .translation`).first();
    const page = n => reader.locator(`.pdf-translation-page[data-page="${n}"]`);
    async function open(name="auto.pdf",buffer=book) {
      await reader.locator("#document-file").setInputFiles({name,mimeType:"application/pdf",buffer});
      await expect(reader.locator("#document-name")).toContainText(name);
    }
    async function go(n) {await reader.locator("#pdf-page").fill(String(n));await reader.locator("#pdf-page").press("Tab");await expect(reader.locator("#pdf-page")).toHaveValue(String(n));}
    await expect(reader.locator("#pdf-auto-translate")).toHaveAttribute('aria-pressed','true');
    await expect(reader.locator("#translate-document")).toHaveText("翻译当前页");
    await open(); await expect(result(1)).toContainText("AUTO PAGE 1"); expect(calls.length).toBe(1);
    // Real wheel scrolling initiates translation without pressing any translate button.
    const secondTop = await reader.locator('.pdf-page-row[data-page="2"]').evaluate(row=>row.offsetTop);
    await reader.locator("#pdf-scroll").hover(); await reader.mouse.wheel(0,secondTop);
    await expect(reader.locator("#pdf-page")).toHaveValue("2");
    await expect(result(2)).toContainText("AUTO PAGE 2"); expect(calls.length).toBe(2);
    await go(1);await reader.waitForTimeout(900);expect(calls.length).toBe(2);
    // Fast jumps discard crossed pages. Only the final settled page is sent.
    await go(3);await go(4);await go(5);await expect(result(5)).toContainText("AUTO PAGE 5");expect(calls.length).toBe(3);
    await expect(result(3)).toHaveCount(0);await expect(result(4)).toHaveCount(0);
    // While page 6 is running, only the last reading destination should follow it.
    delay=1700;await go(6);await expect.poll(()=>calls.length).toBe(4);
    await go(7);await go(8);await expect(result(8)).toContainText("AUTO PAGE 8");delay=0;
    expect(calls.length).toBe(5);await expect(result(7)).toHaveCount(0);await expect(reader.locator("#pdf-page")).toHaveValue("8");
    await setToggle(reader.locator("#pdf-auto-translate"),false);await go(9);await reader.waitForTimeout(900);expect(calls.length).toBe(5);
    // The page-local action always translates its own page, even with the toolbar set to all.
    await reader.locator("#pdf-scope").selectOption("all");await expect(reader.locator("#translate-document")).toHaveText("翻译全文");
    await page(9).getByRole("button",{name:"翻译本页",exact:true}).click();
    await expect(result(9)).toContainText("AUTO PAGE 9");expect(calls.length).toBe(6);await expect(result(3)).toHaveCount(0);
    await reader.locator("#pdf-scope").selectOption("page");
    // Off is remembered after reload; enabling resumes this page from the AI cache.
    await reader.reload();await expect(reader.locator("#pdf-auto-translate")).toHaveAttribute('aria-pressed','false');await open("renamed.pdf");
    await reader.waitForTimeout(900);expect(calls.length).toBe(6);
    await setToggle(reader.locator("#pdf-auto-translate"),true);await expect(result(1)).toContainText("AUTO PAGE 1");expect(calls.length).toBe(6);
    await reader.locator("#retranslate-document").click();await expect(result(1)).toContainText("译文 7");expect(calls.length).toBe(7);
    // Cancellation turns auto off, removes queued work and ignores late responses.
    delay=1600;await go(10);await expect.poll(()=>calls.length).toBe(8);await go(11);
    await reader.locator("#cancel").click();await expect(reader.locator("#pdf-auto-translate")).toHaveAttribute('aria-pressed','false');
    await reader.waitForTimeout(2000);expect(calls.length).toBe(8);await expect(result(10)).toHaveCount(0);await expect(result(11)).toHaveCount(0);delay=0;
    // A provider error stays actionable and never spins in an automatic retry loop.
    fail=true;await setToggle(reader.locator("#pdf-auto-translate"),true);await expect(page(11).getByRole("button",{name:"重试本页",exact:true})).toBeVisible();
    const failedCalls=calls.length;await go(10);await go(11);await reader.waitForTimeout(1000);expect(calls.length).toBe(failedCalls);
    fail=false;await page(11).getByRole("button",{name:"重试本页",exact:true}).click();await expect(result(11)).toContainText("AUTO PAGE 11");expect(calls.length).toBe(failedCalls+1);
    await go(12);await expect(page(12)).toContainText("需要 OCR");expect(calls.length).toBe(failedCalls+1);
    // Disabling during an automatic request aborts it and does not revive it on scroll.
    delay=1500;await go(3);await expect.poll(()=>calls.length).toBe(failedCalls+2);
    await setToggle(reader.locator("#pdf-auto-translate"),false);await go(4);await reader.waitForTimeout(1800);expect(calls.length).toBe(failedCalls+2);await expect(result(3)).toHaveCount(0);delay=0;
    await reader.emulateMedia({colorScheme:"dark"});await reader.screenshot({path:path.resolve("build/pdf-auto-manual-dark.png")});
    // The same scroll-to-translate path must also use traditional services and source/target settings.
    await worker.evaluate(()=>{
      globalThis.pdfTraditionalCalls=[];
      translationService.translateText=async(service,source,target,texts)=>{globalThis.pdfTraditionalCalls.push({service,source,target,texts});await new Promise(resolve=>setTimeout(resolve,globalThis.pdfTraditionalDelay || 0));return texts.map(text=>`传统译文：${text}`);};
    });
    await reader.locator("#engine").selectOption("google");await reader.locator("#source-language").selectOption("en");
    await setToggle(reader.locator("#pdf-auto-translate"),true);await expect(result(4)).toContainText("传统译文");
    await go(5);await expect(result(5)).toContainText("传统译文");
    const traditional=await worker.evaluate(()=>globalThis.pdfTraditionalCalls);expect(traditional.length).toBe(2);expect(traditional[0]).toMatchObject({service:"google",source:"en",target:"zh-CN"});
    await reader.locator("#target").selectOption("fr");await expect.poll(()=>worker.evaluate(()=>globalThis.pdfTraditionalCalls.length)).toBe(3);
    await expect(result(5)).toBeAttached();expect((await worker.evaluate(()=>globalThis.pdfTraditionalCalls.at(-1))).target).toBe("fr");
    // File replacement resets completed-page state; page 1 of the new file is auto-translated.
    await open("replacement.pdf",pdfFixture());await expect(result(1)).toContainText("COMPUTER SCIENCE");
    await expect(reader.locator(".pdf-page-row")).toHaveCount(3);
    // Structured PDF: headings/lists remain separate and chunks align on click only.
    await setToggle(reader.locator("#pdf-auto-translate"),false);
    const structured=pdfFixture({pages:[[
      {text:"Why learn mathematics?",x:100,y:750,size:22},
      {text:"A paragraph about the foundations of machine learning.",x:45,y:710,size:12},
      {text:"This continuation should remain inside the same block.",x:45,y:694,size:12},
      {text:"1. Programming languages",x:45,y:650,size:12},
      {text:"2. Data analysis tools",x:45,y:630,size:12},
      {text:"3. Mathematics and statistics",x:45,y:610,size:12},
      {text:"A final paragraph, separated by a larger vertical gap.",x:45,y:560,size:12}
    ],["SECOND PAGE","Additional context for independent scrolling."],["THIRD PAGE","More content."]]});
    await open("structure.pdf",structured);await reader.locator("#translate-document").click();
    await expect(reader.locator('.pdf-translation-page[data-page="1"] [data-kind="list"]')).toHaveCount(3);
    await expect(reader.locator('.pdf-translation-page[data-page="1"] [role="heading"]')).toHaveCount(1);
    const originalChunks=reader.locator('.pdf-source-page[data-page="1"] .pdf-source-chunk');
    await expect(originalChunks).toHaveCount(6);
    const positions=()=>reader.evaluate(()=>({left:document.querySelector('#pdf-scroll').scrollTop,right:document.querySelector('#pdf-translation-scroll').scrollTop}));
    const beforeScroll=await positions();
    await reader.locator('#pdf-translation-scroll').hover();await reader.mouse.wheel(0,500);
    await expect.poll(async()=>(await positions()).right).toBeGreaterThan(beforeScroll.right);
    expect((await positions()).left).toBe(beforeScroll.left);
    // Clicking a source block moves and highlights its matching translation, without moving the source.
    await originalChunks.nth(4).click();
    await expect(reader.locator('.selected-chunk')).toHaveAttribute('data-chunk','4');
    await expect(reader.locator('.selected-chunk')).toBeInViewport();
    expect((await positions()).left).toBe(beforeScroll.left);
    const afterClick=await positions();
    await reader.locator('#pdf-scroll').hover();await reader.mouse.wheel(0,250);
    await expect.poll(async()=>(await positions()).left).toBeGreaterThan(afterClick.left);
    expect((await positions()).right).toBe(afterClick.right);
    // Selection remains paired after zoom and toggling bilingual text.
    await reader.locator('#pdf-zoom').selectOption('1.5');
    await expect(originalChunks).toHaveCount(6);
    await expect(originalChunks.nth(4)).toHaveAttribute('aria-pressed','true');
    await setToggle(reader.locator('#bilingual-document'),false);
    await expect(reader.locator('.selected-chunk')).toHaveAttribute('data-chunk','4');
    await reader.locator('#pdf-zoom').selectOption('fit');
    await go(1);await originalChunks.nth(4).click();
    await reader.screenshot({path:path.resolve('build/pdf-chunk-alignment.png')});
    // A selection made before translation is linked after the manual result arrives.
    await go(2);await expect(reader.locator('.pdf-source-page[data-page="2"] .pdf-source-chunk')).toHaveCount(2);
    await reader.locator('.pdf-source-page[data-page="2"] .pdf-source-chunk').nth(1).click();
    await page(2).getByRole('button',{name:'翻译本页',exact:true}).click();
    await expect(reader.locator('.selected-chunk')).toHaveAttribute('data-chunk','1');
    await expect(reader.locator('.selected-chunk')).toBeInViewport();
    // Late translation must not pull the right pane back after the user scrolls it away.
    await go(3);await expect(reader.locator('.pdf-source-page[data-page="3"] .pdf-source-chunk')).toHaveCount(2);
    await reader.locator('.pdf-source-page[data-page="3"] .pdf-source-chunk').nth(1).click();
    await worker.evaluate(()=>{globalThis.pdfTraditionalDelay=1500;});
    await page(3).getByRole('button',{name:'翻译本页',exact:true}).click();
    await expect(reader.locator('#cancel')).toBeVisible();
    await reader.locator('#pdf-translation-scroll').hover();await reader.mouse.wheel(0,-10000);
    await expect.poll(async()=>(await positions()).right).toBe(0);
    await expect(result(3)).toBeAttached();
    expect((await positions()).right).toBe(0);
    for(const width of [384,720,1440]) {await reader.setViewportSize({width,height:1000});expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    expect(errors).toEqual([]);
    console.log("PDF auto/layout passed: scroll translation, cache, cancellation, errors, provider changes, structure preservation, independent panes, chunk alignment, zoom and late-result scroll protection.");
  } finally {await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
