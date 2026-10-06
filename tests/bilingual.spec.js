const { test, expect } = require("@playwright/test");
const path = require("node:path");

const fixture = `<!doctype html><html lang="en"><head><title>Original title</title>
<style>body {font: 18px/1.6 system-ui; max-width: 760px; margin: 40px auto} p {margin: 20px 0}</style>
</head><body><main><h1>Reading without losing context</h1>
<p id="intro">Hello <a id="link" href="#details">world</a>, this is a bilingual test.</p>
<p id="details">Keep the original paragraph and translate underneath.</p>
<p id="inline">First <strong>bold</strong> <em>emphasis</em> last.</p>
<pre id="code">const secret = 'code stays original';</pre>
<nav>Do not translate navigation</nav><button id="button">Do not translate button</button>
<p contenteditable="true">Do not translate editor</p><p translate="no">Do not translate excluded</p>
<p hidden>Do not translate hidden text</p><input placeholder="Original placeholder">
</main></body></html>`;

async function setup(page, html = fixture) {
  await page.route("https://bilingual.test/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://bilingual.test/article");
  await page.evaluate(() => {
    const storage = {};
    const storageListeners = [];
    const messageListeners = [];
    window.testRequests = [];
    window.testStates = [];
    window.translationDelay = 0;
    window.testStorage = storage;
    window.linkNode = document.getElementById("link");
    window.linkClicks = 0;
    window.linkNode?.addEventListener("click", () => { window.linkClicks++; });
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: "10.2.5.0", commands: {} }),
        getURL: name => `https://bilingual.test/${name}`,
        onMessage: { addListener: listener => messageListeners.push(listener) },
        sendMessage(request, callback = () => {}) {
          switch (request.action) {
            case "getTabHostName": callback("bilingual.test"); break;
            case "detectTabLanguage": callback("en"); break;
            case "getMainFramePageLanguageState": callback("original"); break;
            case "setPageLanguageState": window.testStates.push(request.pageLanguageState); callback(); break;
            case "translateHTML":
              window.testRequests.push(request);
              setTimeout(() => callback(window.translationFailure ? undefined : request.sourceArray2d.map(paragraph =>
                paragraph.map(text => text.trim() ? `中文：${text.trim()}` : text))), window.translationDelay);
              break;
            case "translateSingleText":
              setTimeout(() => callback(`中文：${request.source}`), window.translationDelay);
              break;
            case "translateText": callback(request.sourceArray.map(text => `中文：${text}`)); break;
            default: callback();
          }
        },
      },
      storage: {
        local: {
          get(_keys, callback) { callback(storage); },
          set(values) {
            const changes = {};
            for (const [name, value] of Object.entries(values)) {
              changes[name] = { oldValue: storage[name], newValue: value };
              storage[name] = value;
            }
            queueMicrotask(() => storageListeners.forEach(listener => listener(changes, "local")));
          },
        },
        onChanged: { addListener: listener => storageListeners.push(listener) },
      },
      i18n: {
        getAcceptLanguages: callback => callback(["zh-CN", "en", "es"]),
        getUILanguage: () => "en",
        getMessage: name => name,
      },
    };
    window.dispatchExtensionMessage = request => messageListeners.forEach(listener => listener(request, {}, () => {}));
    window.checkedLastError = () => {};
  });
  for (const file of ["lib/languages.js", "lib/config.js", "lib/platformInfo.js", "lib/i18n.js",
    "lib/tooltipStyles.js", "contentScript/showOriginal.js", "contentScript/bilingualTranslator.js", "contentScript/pageTranslator.js"]) {
    await page.addScriptTag({ path: path.resolve("src", file) });
  }
  await page.waitForFunction(() => typeof pageTranslator.translatePage === "function");
}

test('hover tooltip ships styles with its script and works when resource fetches fail',async({page})=>{
  await setup(page);
  const result=await page.evaluate(()=>{
    let requests=0;window.fetch=()=>{requests++;throw new TypeError('Failed to fetch');};
    const attach=Element.prototype.attachShadow;let root;
    Element.prototype.attachShadow=function(options){root=attach.call(this,options);return root;};
    twpConfig.set('showOriginalTextWhenHovering','yes');showOriginal.enable(true);
    const box=root.getElementById('originalText');document.body.appendChild(root.host);
    const style=getComputedStyle(box);
    return {requests,links:root.querySelectorAll('link').length,position:style.position,fontSize:style.fontSize,padding:style.padding,enabled:showOriginal.isEnabled};
  });
  expect(result).toEqual({requests:0,links:0,position:'fixed',fontSize:'14px',padding:'16px',enabled:true});
});

async function translate(page) {
  await page.evaluate(() => dispatchExtensionMessage({ action: "translatePage", targetLanguage: "zh-CN" }));
}

test("bilingual mode preserves original nodes, links and excluded content", async ({ page }) => {
  await setup(page);
  const original = await page.locator("#intro").textContent();
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  expect(await page.evaluate(() => document.getElementById("link") === window.linkNode)).toBe(true);
  await page.locator("#link").click();
  expect(await page.evaluate(() => window.linkClicks)).toBe(1);
  expect(await page.locator("#intro").evaluate(element => [...element.childNodes]
    .filter(node => !(node.nodeType === 1 && node.hasAttribute("data-twp-bilingual")))
    .map(node => node.textContent).join(""))).toBe(original);
  expect(await page.title()).toBe("Original title");
  await expect(page.locator("#inline [data-twp-bilingual]")).toHaveCount(1);
  expect(await page.evaluate(() => testRequests.flatMap(r => r.sourceArray2d.flat()).join(" ")))
    .not.toMatch(/Do not translate|const secret/);
  await expect(page.locator("input")).toHaveAttribute("placeholder", "Original placeholder");
  await page.screenshot({ path: "build/bilingual-preview.png", fullPage: true });
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await expect(page.locator("#intro")).toHaveText(original);
});

test("restore discards responses that arrive after cancellation", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.translationDelay = 600; });
  await translate(page);
  await page.waitForFunction(() => testRequests.length > 0);
  await page.evaluate(() => pageTranslator.restorePage());
  await page.waitForTimeout(800);
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await expect(page.locator("#intro")).toHaveText("Hello world, this is a bilingual test.");
});

test("switching display modes restores original text and title", async ({ page }) => {
  await setup(page);
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await page.evaluate(() => twpConfig.set("pageTranslationMode", "translated"));
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await expect(page.locator("#intro")).toContainText("中文：Hello");
  await expect(page).toHaveTitle("中文：Original title");
  await page.evaluate(() => twpConfig.set("pageTranslationMode", "bilingual"));
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await expect(page).toHaveTitle("Original title");
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#intro")).toHaveText("Hello world, this is a bilingual test.");
});

test("dynamic additions, edits and removals do not duplicate translations", async ({ page }) => {
  await setup(page);
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await page.evaluate(() => {
    const paragraph = document.createElement("p");
    paragraph.id = "new";
    paragraph.textContent = "A newly loaded paragraph.";
    document.querySelector("main").prepend(paragraph);
    document.querySelector("#intro").firstChild.textContent = "Updated hello ";
  });
  await expect(page.locator("#new [data-twp-bilingual]")).toContainText("newly loaded");
  await expect(page.locator("#intro [data-twp-bilingual]")).toContainText("Updated hello");
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await page.evaluate(() => document.getElementById("new").remove());
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(4);
  await page.waitForTimeout(350);
  const count = await page.evaluate(() => testRequests.length);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => testRequests.length)).toBe(count);
});

test("offscreen paragraphs translate after scrolling into view", async ({ page }) => {
  await setup(page, fixture.replace("</main>", '<div style="height: 2500px" translate="no"></div><p id="tail">An offscreen paragraph.</p></main>'));
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#tail [data-twp-bilingual]")).toHaveCount(0);
  await page.locator("#tail").scrollIntoViewIfNeeded();
  await expect(page.locator("#tail [data-twp-bilingual]")).toHaveCount(1);
});

test("translation text cannot create executable markup", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.xssTriggered = false;
    bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
      translate: async source => source.map(() => ['<img src=x onerror="window.xssTriggered=true">']) });
  });
  await expect(page.locator("#intro [data-twp-bilingual]")).toContainText("<img");
  await expect(page.locator("#intro img")).toHaveCount(0);
  expect(await page.evaluate(() => window.xssTriggered)).toBe(false);
});

test("the popup display setting persists and changes an already translated page", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const select = document.createElement("select");
    select.setAttribute("data-translation-mode", "");
    select.innerHTML = '<option value="bilingual">Bilingual</option><option value="translated">Translated</option>';
    document.body.append(select);
  });
  await page.addScriptTag({ path: path.resolve("src/lib/translationMode.js") });
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await page.locator("[data-translation-mode]").selectOption("translated");
  await expect(page.locator("#intro")).toContainText("中文：Hello");
  expect(await page.evaluate(() => testStorage.pageTranslationMode)).toBe("translated");
  expect(await page.evaluate(() => JSON.parse(twpConfig.export()).pageTranslationMode)).toBe("translated");
  await page.locator("[data-translation-mode]").selectOption("bilingual");
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
});

test("a delayed title response cannot overwrite restored original mode", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    twpConfig.set("pageTranslationMode", "translated");
    window.translationDelay = 600;
  });
  await translate(page);
  await page.waitForFunction(() => testRequests.length > 0);
  await page.evaluate(() => {
    twpConfig.set("pageTranslationMode", "bilingual");
    pageTranslator.restorePage();
  });
  await page.waitForTimeout(800);
  await expect(page).toHaveTitle("Original title");
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
});

test("custom dictionary terms work without changing original link text", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => twpConfig.set("customDictionary", new Map([["world", "世界"]])));
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toContainText("世界");
  await expect(page.locator("#link")).toHaveText("world");
  expect(await page.evaluate(() => testRequests[0].sourceArray2d.every(paragraph => paragraph.length === 1))).toBe(true);
});

test("HTML source wrapping does not split or indent translated list sentences", async ({ page }) => {
  const objectives = `<aside style="background:#dff2f1;padding:24px"><b>Learning objectives</b><ul>
    <li id="objective">Explain the motivation for building neural networks, and the use
        cases they address.</li>
    <li id="architecture">Define the components of a deep neural
        network architecture:
      <ul><li id="node"><strong><a href="#nodes">Nodes</a></strong></li></ul>
    </li>
  </ul></aside>`;
  await setup(page, fixture.replace("<main>", `<main>${objectives}`));
  const original = await page.locator("#objective").textContent();
  await translate(page);
  await expect(page.locator("#objective > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#architecture > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#node [data-twp-bilingual]")).toHaveCount(1);
  const sentences = await page.evaluate(() => testRequests.flatMap(r => r.sourceArray2d.flat()));
  expect(sentences).toContain("Explain the motivation for building neural networks, and the use cases they address.");
  expect(sentences).toContain("Define the components of a deep neural network architecture:");
  const translation = page.locator("#objective > [data-twp-bilingual]");
  expect(await translation.textContent()).not.toMatch(/\n| {2}/);
  expect(await page.locator("#architecture").evaluate(element =>
    element.querySelector(":scope > [data-twp-bilingual]").nextElementSibling.tagName)).toBe("UL");
  await page.setViewportSize({width:420,height:850});
  const lines = await translation.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const leftByLine = new Map();
    for (const rect of range.getClientRects()) {
      leftByLine.set(rect.top, Math.min(leftByLine.get(rect.top) ?? Infinity, rect.left));
    }
    return [...leftByLine.values()];
  });
  expect(lines.length).toBeGreaterThan(1);
  for (const left of lines) expect(left).toBeCloseTo(lines[0], 0);
  await page.screenshot({path:"build/bilingual-list-layout.png", fullPage:true});
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#objective")).toHaveText(original, {useInnerText:false});
});

test("translation input respects CSS whitespace and explicit line breaks", async ({ page }) => {
  const whitespace = `<p id="collapsed">First\n    <strong>bold\t text</strong>\n    last.&nbsp;End.</p>
    <div id="preserved" style="white-space:pre-wrap">First line\n    Indented second line</div>
    <div id="line-breaks" style="white-space:pre-line">First   line\nSecond   line</div>
    <p id="explicit">Before break<br>After break</p>`;
  await setup(page, fixture.replace("<main>", `<main>${whitespace}`));
  await translate(page);
  await expect(page.locator("#preserved [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#explicit [data-twp-bilingual]")).toHaveCount(2);
  const sentences = await page.evaluate(() => testRequests.flatMap(r => r.sourceArray2d.flat()));
  expect(sentences).toContain("First bold text last.\u00a0End.");
  expect(sentences).toContain("First line\n    Indented second line");
  expect(sentences).toContain("First line\nSecond line");
  expect(await page.locator("#preserved [data-twp-bilingual]").textContent()).toContain("\n    ");
  expect(await page.evaluate(() => {
    const piece = bilingualTranslator.paragraphAt(document.getElementById("collapsed"), 0, 0);
    return bilingualTranslator.textForTranslation(piece);
  })).toBe("First bold text last.\u00a0End.");
});

test("translation stays pending until the provider actually replies", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.translationDelay = 800; });
  await translate(page);
  expect(await page.evaluate(() => testStates.at(-1))).toBe("translating");
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => testStates.at(-1))).toBe("translated");
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
});

test("a failed request reports an error and switching services recovers", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.translationFailure = true; });
  await translate(page);
  await expect.poll(() => page.evaluate(() => testStates.at(-1))).toBe("error");
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await page.evaluate(() => {
    window.translationFailure = false;
    dispatchExtensionMessage({ action: "swapTranslationService", newServiceName: "bing" });
  });
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => testStates.at(-1))).toBe("translated");
  expect(await page.evaluate(() => testRequests.at(-1).translationService)).toBe("bing");
});

test("a hung request times out and a late response cannot undo restore", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await page.evaluate(() => { window.translationDelay = 60000; });
  await translate(page);
  await page.clock.fastForward(30001);
  await expect.poll(() => page.evaluate(() => testStates.at(-1))).toBe("error");
  await page.evaluate(() => pageTranslator.restorePage());
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => testStates.at(-1))).toBe("original");
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
});

test("fixed-height tab labels keep both languages on one line without clipping the original", async ({ page }) => {
  const tabs = `<style>
    #tabs { display:flex; height:48px; overflow-x:auto; overflow-y:hidden; align-items:center }
    #tabs a { display:flex; flex-direction:column; justify-content:center; align-items:center;
      height:48px; min-height:48px; padding:12px 16px; box-sizing:border-box; overflow:hidden; flex-shrink:0 }
    #tabs .label { display:block; line-height:24px; white-space:nowrap }
  </style><div id="tabs" role="tablist">
    <a id="overview-tab" role="tab" href="#overview"><span class="label">Overview</span></a>
    <a role="tab" href="#data"><span class="label">Data</span></a>
    <a role="tab" href="#code"><span class="label">Code</span></a>
  </div>`;
  await setup(page, fixture.replace("<main>", `<main>${tabs}`));
  const before = await page.locator("#tabs").boundingBox();
  await translate(page);
  await expect(page.locator("#overview-tab [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  async function checkLabels() {
    const results = await page.locator("#tabs a").evaluateAll(tabs => tabs.map(tab => {
      const range = document.createRange();
      range.selectNodeContents(tab.querySelector(".label").firstChild);
      const original = range.getBoundingClientRect();
      const translated = tab.querySelector("[data-twp-bilingual]").getBoundingClientRect();
      const bounds = tab.getBoundingClientRect();
      return { originalTop:original.top, originalBottom:original.bottom,
        translatedTop:translated.top, translatedBottom:translated.bottom,
        top:bounds.top, bottom:bounds.bottom };
    }));
    for (const rect of results) {
      expect(rect.originalTop).toBeGreaterThanOrEqual(rect.top);
      expect(rect.originalBottom).toBeLessThanOrEqual(rect.bottom);
      expect(rect.translatedTop).toBeGreaterThanOrEqual(rect.top);
      expect(rect.translatedBottom).toBeLessThanOrEqual(rect.bottom);
      expect(rect.translatedTop).toBeLessThan(rect.originalBottom);
    }
  }
  await checkLabels();
  expect((await page.locator("#tabs").boundingBox()).height).toBe(before.height);
  await page.setViewportSize({width:420,height:850});
  await checkLabels();
  await page.locator("#overview-tab").click();
  await expect(page).toHaveURL(/#overview$/);
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#overview-tab")).toHaveText("Overview");
  await expect(page.locator("#tabs [data-twp-bilingual]")).toHaveCount(0);
});

test("a tab too tight for a translation preserves its original label and click handler", async ({ page }) => {
  const tab = '<a id="tiny-tab" role="tab" href="#tiny" style="display:flex;flex-direction:column;' +
    'justify-content:center;align-items:center;height:24px;line-height:24px;overflow:hidden">Tiny tab</a>';
  await setup(page, fixture.replace("<main>", `<main>${tab}`));
  await page.evaluate(() => {
    window.tabClicks = 0;
    document.getElementById("tiny-tab").addEventListener("click", () => window.tabClicks++);
  });
  const before = await page.locator("#tiny-tab").boundingBox();
  await translate(page);
  await expect(page.locator("#intro [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#tiny-tab [data-twp-bilingual]")).toHaveCount(0);
  await expect(page.locator("#tiny-tab")).toHaveText("Tiny tab");
  expect((await page.locator("#tiny-tab").boundingBox()).height).toBe(before.height);
  await page.locator("#tiny-tab").click();
  expect(await page.evaluate(() => window.tabClicks)).toBe(1);
  await expect(page).toHaveURL(/#tiny$/);
});
