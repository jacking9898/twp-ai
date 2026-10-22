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

test("returning to a bilingual tab never starts replacement translation for dynamic paragraphs", async ({ page }) => {
  await setup(page);
  await translate(page);
  await expect.poll(() => page.evaluate(() => pageTranslator.getState())).toBe("translated");
  await page.evaluate(() => {
    // Follow the same handler as switching away from and back to the tab.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    const list = document.createElement("ul");
    list.innerHTML = '<li id="weights"><strong>Number of weights.</strong> More inputs need more weights.</li>';
    document.querySelector("main").prepend(list);
    window.dynamicOriginal = document.querySelector("#weights").innerHTML;
  });
  await expect(page.locator("#weights > [data-twp-bilingual]")).toHaveCount(1);
  // The old replacement observer drains its dynamic queue every two seconds.
  await page.waitForTimeout(2800);
  expect(await page.locator("#weights").evaluate(element => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("[data-twp-bilingual]").forEach(node => node.remove());
    return copy.innerHTML;
  })).toBe(await page.evaluate(() => window.dynamicOriginal));
  await expect(page.locator("#weights > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#weights > [data-twp-bilingual]")).toHaveText(
    "中文：Number of weights. More inputs need more weights.");
  await page.evaluate(() => pageTranslator.restorePage());
  expect(await page.locator("#weights").innerHTML()).toBe(await page.evaluate(() => window.dynamicOriginal));
});

test("replacement mode still translates dynamic content after returning to the tab", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => twpConfig.set("pageTranslationMode", "translated"));
  await translate(page);
  await expect(page.locator("#intro")).toContainText("中文：Hello");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    const paragraph = document.createElement("p");
    paragraph.id = "replacement-dynamic";
    paragraph.textContent = "New replacement paragraph.";
    document.querySelector("main").prepend(paragraph);
  });
  await expect(page.locator("#replacement-dynamic")).toHaveText("中文：New replacement paragraph.");
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#replacement-dynamic")).toHaveText("New replacement paragraph.");
});

for (const dontSortResults of ["yes", "no"]) {
  test(`late dictionary recovery cannot replace source after switching to bilingual (${dontSortResults})`, async ({ page }) => {
    await setup(page);
    await page.evaluate(value => {
      twpConfig.set("dontSortResults", value);
      twpConfig.set("pageTranslationMode", "translated");
      // Hold the async dictionary/provider recovery after translateHTML returns.
      const original = handleCustomWords;
      window.pendingRecoveries = [];
      handleCustomWords = (...args) => new Promise(resolve => {
        pendingRecoveries.push(async () => resolve(await original(...args)));
      });
      window.restoreDictionaryHandler = () => { handleCustomWords = original; };
    }, dontSortResults);
    await translate(page);
    await page.waitForFunction(() => pendingRecoveries.length > 0);
    await page.evaluate(() => {
      restoreDictionaryHandler();
      twpConfig.set("pageTranslationMode", "bilingual");
    });
    await expect(page.locator("#intro > [data-twp-bilingual]")).toHaveCount(1);
    await page.evaluate(async () => {
      await Promise.all(pendingRecoveries.map(resolve => resolve()));
    });
    await expect(page.locator("#link")).toHaveText("world");
    await expect(page.locator("#intro > [data-twp-bilingual]")).toHaveText("中文：Hello world, this is a bilingual test.");
    await page.evaluate(() => pageTranslator.restorePage());
    await expect(page.locator("#intro")).toHaveText("Hello world, this is a bilingual test.");
    await expect(page).toHaveTitle("Original title");
  });
}

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

test("source footnotes and subscripts survive the full plain-text translation round trip", async ({ page }) => {
  const html = fixture.replace("<main>", `<main>
    <p id="embedding-footnote">In the real world, embedding spaces are <em>d</em>-dimensional.
      (For word embeddings, <em>d</em> is often 256, 512, or 1024.<sup id="fnref1"><a href="#fn1" rel="footnote">1</a></sup>)</p>
    <p id="exponents">Compare x<sup>2</sup>, x<sup>3</sup>, H<sub>2</sub>O and <code translate="no">meal</code>.<sup><a href="#fn2">2</a></sup></p>
    <p id="fn1">First footnote. <a href="#fnref1">Return to reference</a></p><p id="fn2">Second footnote.</p>`);
  await setup(page, html);
  const originals = page.locator("#embedding-footnote, #exponents, #fn1, #fn2");
  const before = await originals.evaluateAll(nodes => nodes.map(node => node.innerHTML));
  await page.evaluate(() => {
    window.originalFootnote = document.getElementById("fnref1");
    window.originalReference = originalFootnote.firstChild;
    window.referenceClicks = 0;
    originalReference.addEventListener("click", () => referenceClicks++);
  });
  // The provider mock only translates text; it never invents HTML markup.
  await translate(page);
  const translated = page.locator("#embedding-footnote > [data-twp-bilingual]");
  await expect(translated).toHaveCount(1);
  await expect(translated.locator("sup")).toHaveText("1");
  await expect(translated.locator("sup a")).toHaveAttribute("href", "#fn1");
  await expect(page.locator("#fnref1")).toHaveCount(1);
  await expect(page.locator("#exponents > [data-twp-bilingual] sup")).toHaveText(["2", "3", "2"]);
  await expect(page.locator("#exponents > [data-twp-bilingual] sub")).toHaveText("2");
  await expect(page.locator("#exponents > [data-twp-bilingual] code")).toHaveText("meal");
  expect(await translated.textContent()).not.toContain("__TWP_INLINE_");
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: 1000});
    expect(await translated.locator("sup").evaluate(sup => {
      const previous = sup.previousSibling;
      const range = document.createRange();
      range.setStart(previous, previous.textContent.length - 1);
      range.setEnd(previous, previous.textContent.length);
      return getComputedStyle(sup).verticalAlign === "super" && sup.getBoundingClientRect().top < range.getBoundingClientRect().top;
    })).toBe(true);
    await page.locator("#embedding-footnote").screenshot({path:`build/bilingual-source-sup-${width}.png`});
  }
  await translated.locator("sup a").click();
  await expect(page).toHaveURL(/#fn1$/);
  await page.locator("#fnref1 a").click();
  expect(await page.evaluate(() => referenceClicks === 1 && originalFootnote === document.getElementById("fnref1") &&
    originalReference === document.querySelector("#fnref1 a"))).toBe(true);
  await page.evaluate(() => pageTranslator.restorePage());
  expect(await originals.evaluateAll(nodes => nodes.map(node => node.innerHTML))).toEqual(before);
  // Show an actual Chinese sentence while carrying the annotation from the
  // outgoing request, rather than hard-coding <sup> into the fake response.
  await page.evaluate(() => bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
    translate: async source => source.map(([text]) => [text.startsWith("In the real world")
      ? "在现实世界中，嵌入空间是 d 维的。（对于词嵌入，d 通常为 256、512 或 1024。" + text.match(/`__TWP_INLINE_\d+__`/)[0] + "）"
      : "译文：" + text]) }));
  await expect(translated.locator("sup a")).toHaveText("1");
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height:1000});
    await page.locator("#embedding-footnote").screenshot({path:`build/bilingual-source-sup-${width}.png`});
  }
  await page.evaluate(() => bilingualTranslator.stop());
  expect(await originals.evaluateAll(nodes => nodes.map(node => node.innerHTML))).toEqual(before);
});

test("protected source annotations keep nested formatting and only safe footnote links", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="safe-annotations">Reference
    <a id="outer-link" href="#details"><sup id="outer-sup">2</sup></a> and x<sup id="nested-sup" onclick="window.annotationExecuted=true"><strong>n<sub>1</sub></strong><script>/* ignored */</script></sup>,
    with unsafe <sup><a href="javascript:window.annotationExecuted=true" onclick="window.annotationExecuted=true">3</a></sup>.</p>`));
  await page.evaluate(() => { window.annotationExecuted = false; });
  await translate(page);
  const translation = page.locator("#safe-annotations > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator('a[href="#details"] > sup')).toHaveText("2");
  await expect(translation.locator("sup strong sub")).toHaveText("1");
  await expect(translation.locator("[id], [onclick], script, [href^='javascript:']")).toHaveCount(0);
  await translation.locator('a[href="#details"]').click();
  await expect(page).toHaveURL(/#details$/);
  await translation.locator("a").last().click();
  expect(await page.evaluate(() => annotationExecuted)).toBe(false);
});

test("annotation edits invalidate delayed page results and hover snapshots", async ({ page }) => {
  await setup(page, fixture.replace("<main>", '<main><p id="annotation-edit">Word embeddings use 1024 dimensions.<sup><a href="#details">1</a></sup></p>'));
  await page.evaluate(() => { window.translationDelay = 500; });
  await translate(page);
  await page.waitForFunction(() => testRequests.some(request => request.sourceArray2d.flat().some(text => text.startsWith("Word embeddings"))));
  await page.evaluate(() => {
    window.oldAnnotation = bilingualTranslator.paragraphAt(document.getElementById("annotation-edit"), 0, 0);
    document.querySelector("#annotation-edit sup a").setAttribute("href", "#intro");
  });
  expect(await page.evaluate(() => bilingualTranslator.unchanged(oldAnnotation))).toBe(false);
  const translation = page.locator("#annotation-edit > [data-twp-bilingual]");
  await expect(translation.locator("sup a")).toHaveAttribute("href", "#intro");
  await page.evaluate(() => { document.querySelector("#annotation-edit > sup a").textContent = "2"; });
  await expect(translation.locator("sup")).toHaveText("2");
  await expect(translation).toHaveCount(1);
  await page.evaluate(() => {
    pageTranslator.restorePage();
    const piece = bilingualTranslator.paragraphAt(document.getElementById("annotation-edit"), 0, 0);
    bilingualTranslator.renderParagraph(piece, "译文：" + bilingualTranslator.textForTranslation(piece), "zh-CN");
  });
  await expect(translation.locator("sup a")).toHaveAttribute("href", "#intro");
  await expect(translation.locator("sup")).toHaveText("2");
  await translation.evaluate(node => node.remove());
  await expect(page.locator("#annotation-edit")).toHaveText("Word embeddings use 1024 dimensions.2");
});

test("provider footnote markup renders as superscript without changing the original", async ({ page }) => {
  const html = fixture.replace('<p id="details">', '<p id="footnote">Computer vision.<sup><a id="reference" href="#note">1</a></sup></p><p id="details">');
  await setup(page, html);
  const before = await page.locator("#footnote").innerHTML();
  await page.evaluate(() => bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
    translate: async source => source.map(() => ["计算机视觉。<sup>1</sup> 水 H<sub>2</sub>O。<SUP>2</SUP>"]) }));
  const translation = page.locator("#footnote > [data-twp-bilingual]");
  await expect(translation).toHaveText("计算机视觉。1 水 H2O。2");
  await expect(translation.locator("sup")).toHaveCount(2);
  await expect(translation.locator("sub")).toHaveText("2");
  expect(await translation.locator("sup").first().evaluate(node => getComputedStyle(node).verticalAlign)).toBe("super");
  await expect(page.locator("#reference")).toHaveAttribute("href", "#note");
  await page.locator("#reference").click();
  await expect(page).toHaveURL(/#note$/);
  await page.screenshot({ path: "build/bilingual-footnote.png", fullPage: true });
  await page.evaluate(() => bilingualTranslator.stop());
  expect(await page.locator("#footnote").innerHTML()).toBe(before);
});

test("formatting discards provider attributes and keeps unknown response markup inert", async ({ page }) => {
  await setup(page);
  const unsafe = '<sup onclick="window.xssTriggered=true">1</sup> <sup><img src=x onerror="window.xssTriggered=true"></sup>';
  await page.evaluate(text => {
    window.xssTriggered = false;
    bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
      translate: async source => source.map(() => [text]) });
  }, unsafe);
  const translation = page.locator("#intro [data-twp-bilingual]");
  await expect(translation.locator("sup")).toHaveCount(2);
  await expect(translation.locator("sup").first()).toHaveText("1");
  await expect(translation.locator("sup").last()).toContainText("<img");
  await expect(translation.locator("[onclick], img")).toHaveCount(0);
  await translation.locator("sup").first().click();
  expect(await page.evaluate(() => window.xssTriggered)).toBe(false);
});

test("nested inline annotations render without accepting provider styles or scripts", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.xssTriggered = false;
    bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
      translate: async source => source.map(() => [
        '<strong style="display:none" onclick="window.xssTriggered=true">重点 <em>斜体<sup>3</sup></em></strong>' +
        ' <u>下划线</u> <del>删除</del> <ins>新增</ins> <mark>高亮</mark> H<sub>2</sub>O<br>' +
        '<code>x &lt; 2</code> <ruby>汉<rt>hàn</rt><rp>(音)</rp></ruby> <small>注释</small>' +
        '<script>window.xssTriggered=true</script><svg onload="window.xssTriggered=true"></svg>'
      ]) });
  });
  const translation = page.locator("#intro [data-twp-bilingual]");
  for (const selector of ["strong em sup", "u", "del", "ins", "mark", "sub", "br", "code", "ruby rt", "ruby rp", "small"]) {
    await expect(translation.locator(selector)).toHaveCount(1);
  }
  await expect(translation.locator("strong")).toBeVisible();
  await expect(translation.locator("code")).toHaveText("x < 2");
  await expect(translation.locator("[style], [onclick], script, svg")).toHaveCount(0);
  expect(await page.evaluate(() => window.xssTriggered)).toBe(false);
});

test("footnote formatting and original inline formula clones render together", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="math-footnote">Feature ${svgMath("footnote-math", "x<y & z>0")} is useful.<sup>1</sup></p>`));
  await page.evaluate(() => bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
    translate: async source => source.map(() => ["特征 $x<y & z>0$ 很有用。<sup>1</sup> 后面的公式 <strong>$x<y & z>0$</strong>。"]) }));
  const translation = page.locator("#math-footnote > [data-twp-bilingual]");
  await expect(translation.locator("sup")).toHaveText("1");
  await expect(translation.locator(".MathJax_SVG")).toHaveCount(2);
  await expect(translation.locator("strong .MathJax_SVG")).toHaveCount(1);
  expect(await translation.textContent()).not.toMatch(/<sup>|\$x<y/);
});

test("detached inline discussion buttons follow source reflow and restore without duplication", async ({ page }) => {
  const discussions = `<style>#disqussions_wrapper {position:absolute;top:0;left:0}
    .disqussion {position:absolute;padding:5px 10px 10px;font:13px/16px sans-serif}
    .disqussion-link {display:block;width:20px;height:17px;background:#bbb;color:white}</style>
    <p id="comment-first" data-disqus-identifier="first">A paragraph with a comment.</p>
    <p id="comment-second" data-disqus-identifier="second">The later paragraph must keep its comment beside it.</p>
    <img id="comment-image" data-disqus-identifier="image" alt="" style="display:block;width:100px;height:30px">
    <div id="disqussions_wrapper"><div class="disqussion"><a class="disqussion-link" href="#first-comments" data-disqus-identifier="first" data-disqus-position="right">4</a></div>
    <div class="disqussion"><a class="disqussion-link" href="#second-comments" data-disqus-identifier="second" data-disqus-position="right">2</a></div>
    <div class="disqussion"><a class="disqussion-link" href="#image-comments" data-disqus-identifier="image" data-disqus-position="left">1</a></div></div>`;
  await setup(page, fixture.replace("</main>", `${discussions}</main>`));
  const originalTop = await page.locator("#comment-second").evaluate(node => node.getBoundingClientRect().top);
  await page.evaluate(() => {
    window.commentButtons = [...document.querySelectorAll(".disqussion-link")];
    window.commentClicks = 0;
    commentButtons.forEach(link => {
      link.addEventListener("click", () => window.commentClicks++);
      const rect = document.querySelector(`:not(.disqussion-link)[data-disqus-identifier="${link.dataset.disqusIdentifier}"]`).getBoundingClientRect();
      link.parentElement.style.top = `${rect.top + scrollY}px`;
      link.parentElement.style.left = `${rect.right + scrollX}px`;
    });
  });
  async function checkPositions() {
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(".disqussion-link")].every(link => {
      const source = document.querySelector(`:not(.disqussion-link)[data-disqus-identifier="${link.dataset.disqusIdentifier}"]`).getBoundingClientRect();
      const note = link.parentElement.getBoundingClientRect();
      return Math.abs(note.top - source.top) < 1 && (link.dataset.disqusPosition === "left"
        ? Math.abs(note.right - source.left) < 1 : Math.abs(note.left - source.right) < 1);
    }))).toBe(true);
    await expect(page.locator(".disqussion-link")).toHaveCount(3);
    await expect(page.locator("#disqussions_wrapper [data-twp-bilingual]")).toHaveCount(0);
  }
  await translate(page);
  await expect(page.locator("#comment-second > [data-twp-bilingual]")).toHaveCount(1);
  await checkPositions();
  await page.setViewportSize({ width: 1200, height: 1100 });
  await checkPositions();
  expect(await page.locator("#comment-second").evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(originalTop);
  expect(await page.evaluate(() => testRequests.flatMap(request => request.sourceArray2d.flat()).some(text => ["4", "2", "1"].includes(text)))).toBe(false);
  await page.setViewportSize({ width: 420, height: 1100 });
  await checkPositions();
  await page.evaluate(() => { document.getElementById("comment-first").firstChild.textContent = "Changed paragraph. ".repeat(8); });
  await expect(page.locator("#comment-first > [data-twp-bilingual]")).toContainText("Changed paragraph");
  await checkPositions();
  await page.evaluate(() => { document.getElementById("comment-first").style.paddingBottom = "70px"; });
  await checkPositions();
  await page.screenshot({ path: "build/bilingual-discussions.png", fullPage: true });
  await page.locator('.disqussion-link[data-disqus-identifier="second"]').click();
  expect(await page.evaluate(() => commentClicks)).toBe(1);
  expect(await page.evaluate(() => commentButtons.every(link => link.isConnected))).toBe(true);
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("[data-twp-bilingual]")).toHaveCount(0);
  await checkPositions();
});

test("late discussion buttons and single paragraph translations keep their source positions", async ({ page }) => {
  await setup(page);
  await translate(page);
  await expect(page.locator("#intro > [data-twp-bilingual]")).toHaveCount(1);
  await page.evaluate(() => {
    document.getElementById("details").setAttribute("data-disqus-identifier", "details-comment");
    const wrapper = document.createElement("div");
    wrapper.id = "disqussions_wrapper";
    wrapper.style.cssText = "position:absolute;top:0;left:0";
    wrapper.innerHTML = '<div class="disqussion" style="position:absolute;top:0;left:0"><a class="disqussion-link" href="#comments" data-disqus-identifier="details-comment" data-disqus-position="right">4</a></div>';
    document.body.append(wrapper);
  });
  async function checkPosition() {
    await expect.poll(() => page.evaluate(() => {
      const source = document.getElementById("details").getBoundingClientRect();
      const note = document.querySelector(".disqussion").getBoundingClientRect();
      return Math.abs(source.top - note.top) < 1 && Math.abs(source.right - note.left) < 1;
    })).toBe(true);
  }
  await checkPosition();
  await page.evaluate(() => pageTranslator.restorePage());
  await checkPosition();
  await page.evaluate(() => {
    const piece = bilingualTranslator.paragraphAt(document.getElementById("intro"), 0, 0);
    bilingualTranslator.renderParagraph(piece, "单段译文。".repeat(15), "zh-CN");
  });
  await checkPosition();
  await page.evaluate(() => document.querySelector("[data-twp-bilingual]").remove());
  await checkPosition();
  await expect(page.locator(".disqussion-link")).toHaveCount(1);
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

test("exercise lists keep inline code and inline-block links in one bilingual sentence", async ({ page }) => {
  const exercise = `<style>code {background:#eef;font-size:14px} #relu {display:inline-block}</style>
    <h2>Exercise 1</h2><ul id="exercise">
    <li id="input-layer">Input layer with 3 neurons containing the values <code id="first-value">0.00</code>,
      <code style="display:inline-block">0.00</code>, and <code>0.00</code></li>
    <li>Hidden layer with 4 neurons</li><li>Output layer with 1 neuron</li>
    <li id="activation"><a id="relu" href="#details">ReLU</a> activation function applied to all hidden layer nodes and the output node</li>
    </ul><p id="keys">Press <kbd>Ctrl</kbd> and <kbd>K</kbd> to continue.</p>
    <p id="literal-only"><code>STANDALONE_CODE</code></p>
    <pre><code>BLOCK_CODE</code></pre>`;
  await setup(page, fixture.replace("<main>", `<main>${exercise}`));
  const before = await page.locator("#exercise").innerHTML();
  await page.evaluate(() => {
    window.originalValue = document.getElementById("first-value");
    window.originalRelu = document.getElementById("relu");
    window.reluClicks = 0;
    originalRelu.addEventListener("click", () => reluClicks++);
  });
  await translate(page);
  const translation = page.locator("#input-layer > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveCount(3);
  await expect(translation).toHaveText("中文：Input layer with 3 neurons containing the values 0.00, 0.00, and 0.00");
  await expect(page.locator("#activation > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#relu [data-twp-bilingual]")).toHaveCount(0);
  await expect(page.locator("#keys > [data-twp-bilingual] kbd")).toHaveCount(2);
  await expect(page.locator("#literal-only [data-twp-bilingual], pre [data-twp-bilingual]")).toHaveCount(0);
  const sentences = await page.evaluate(() => testRequests.flatMap(request => request.sourceArray2d.flat()));
  expect(sentences).toContain("Input layer with 3 neurons containing the values `0.00`, `0.00`, and `0.00`");
  expect(sentences.join(" ")).not.toMatch(/STANDALONE_CODE|BLOCK_CODE/);
  await page.locator("#relu").click();
  expect(await page.evaluate(() => reluClicks)).toBe(1);
  for (const width of [1000, 420]) {
    await page.setViewportSize({width, height:1000});
    await expect(translation).toHaveCount(1);
    expect(await page.locator("#input-layer").evaluate(element => {
      const translated = element.querySelector("[data-twp-bilingual]");
      const range = document.createRange();
      range.setStart(element, 0);
      range.setEndBefore(translated);
      return range.getBoundingClientRect().bottom <= translated.getBoundingClientRect().top &&
        element.querySelectorAll("code:not([data-twp-bilingual] code)").length === 3 &&
        translated.previousSibling.nodeName === "CODE";
    })).toBe(true);
    await page.screenshot({path:`build/bilingual-inline-code-${width}.png`, fullPage:true});
  }
  await page.evaluate(() => { document.getElementById("details").firstChild.textContent = "Trigger a rescan."; });
  await expect(page.locator("#details [data-twp-bilingual]")).toContainText("Trigger");
  await expect(translation).toHaveCount(1);
  expect(await page.evaluate(() => originalValue === document.getElementById("first-value") &&
    originalRelu === document.getElementById("relu"))).toBe(true);
  await page.evaluate(() => pageTranslator.restorePage());
  expect(await page.locator("#exercise").innerHTML()).toBe(before);
});

// The live Google ML course uses <code translate="no" dir="ltr">meal</code>.
// Keep the real paragraph structure here: plain <code> fixtures missed this split.
const protectedCodeFixture = `<!doctype html><html lang="en"><head><title>Protected inline code</title>
<style>body {font:16px/24px Arial,sans-serif; margin:32px auto; padding:0 24px; max-width:1000px}
p {margin:16px 0} code {background:#f1f3f4; font:14px/20px monospace; padding:1px 3px}
a {color:#1a73e8} figcaption {text-align:center; font-style:italic} li {margin:12px 0}</style>
</head><body><main>
<figcaption><strong>Figure 1.</strong> Sampling of meal items included in the food dataset.</figcaption>
<p id="meal">You create a <code translate="no" dir="ltr">meal</code> feature that contains a
<a id="encoding-link" href="#encoding"><strong>one-hot encoded</strong></a>
representation of each of the meal items in the dataset.
<a href="#encoder"><strong>Encoding</strong></a> refers to the process of
choosing an initial numerical representation of data to train the model on.</p>
<ul><li id="protected-list">Use <code class="notranslate">input</code>,
<code translate="no" style="display:inline-block">0.00</code>, and <kbd translate="no">Enter</kbd> together.</li></ul>
<p id="protected-edges"><code translate="no">first</code> precedes <strong>the final value</strong> <code translate="no">last</code></p>
<p id="excluded-paragraph" translate="no">EXCLUDED_PARAGRAPH <code>private_code</code></p>
<div class="notranslate"><p>EXCLUDED_CONTAINER <code>private_nested</code></p></div>
<pre><code translate="no">EXCLUDED_BLOCK</code></pre>
<code translate="no" style="display:block">EXCLUDED_BLOCK_CODE</code>
<p><code translate="no">EXCLUDED_STANDALONE</code></p>
</main></body></html>`;

for (const width of [1280, 768, 390]) {
  test(`protected inline code preserves whole-sentence layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await setup(page, protectedCodeFixture);
    const originalHTML = await page.locator("main").innerHTML();
    // Measure every original text run, including wrapping, not just counts.
    const sourceGeometry = () => [...document.querySelectorAll("#meal, #protected-list, #protected-edges")].map(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest("[data-twp-bilingual]")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const origin = element.getBoundingClientRect();
        rects.push(...[...range.getClientRects()].map(rect => ({
          x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
        })));
      }
      return rects;
    });
    const before = await page.evaluate(sourceGeometry);
    await page.evaluate(() => {
      window.mealCode = document.querySelector("#meal code");
      window.encodingLink = document.getElementById("encoding-link");
      window.encodingClicks = 0;
      encodingLink.addEventListener("click", () => encodingClicks++);
    });
    await translate(page);
    await expect(page.locator("#meal > [data-twp-bilingual]")).toHaveCount(1);
    await expect(page.locator("#protected-list > [data-twp-bilingual]")).toHaveCount(1);
    await expect(page.locator("#protected-edges > [data-twp-bilingual]")).toHaveCount(1);
    expect(await page.evaluate(sourceGeometry)).toEqual(before);
    const requests = await page.evaluate(() => testRequests.flatMap(request => request.sourceArray2d.flat()));
    expect(requests).toContain("You create a `meal` feature that contains a `__TWP_INLINE_LINK_0_START__`one-hot encoded`__TWP_INLINE_LINK_0_END__` representation of each of the meal items in the dataset. `__TWP_INLINE_LINK_1_START__`Encoding`__TWP_INLINE_LINK_1_END__` refers to the process of choosing an initial numerical representation of data to train the model on.");
    expect(requests.join(" ")).not.toMatch(/EXCLUDED_|private_code|private_nested/);
    await expect(page.locator("#meal > [data-twp-bilingual] code")).toHaveText("meal");
    await expect(page.locator("#meal > [data-twp-bilingual] code")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#protected-list > [data-twp-bilingual] code")).toHaveCount(2);
    await expect(page.locator("#protected-list > [data-twp-bilingual] kbd")).toHaveText("Enter");
    const layout = await page.locator("#meal").evaluate(element => {
      const translated = element.querySelector("[data-twp-bilingual]");
      const range = document.createRange();
      range.setStart(element, 0); range.setEndBefore(translated);
      return { below: translated.getBoundingClientRect().top >= range.getBoundingClientRect().bottom,
        last: translated === element.lastChild,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout).toEqual({ below: true, last: true, overflow: false });
    await page.screenshot({ path: `build/bilingual-protected-code-${width}.png`, fullPage: true });
    await page.locator("#encoding-link").click();
    expect(await page.evaluate(() => encodingClicks === 1 && mealCode === document.querySelector("#meal code") &&
      encodingLink === document.getElementById("encoding-link"))).toBe(true);
    // Repeated translate/restore and a rescan must preserve the same original DOM.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => pageTranslator.restorePage());
      expect(await page.locator("main").innerHTML()).toBe(originalHTML);
      expect(await page.evaluate(sourceGeometry)).toEqual(before);
      await translate(page);
      await expect(page.locator("#meal > [data-twp-bilingual]")).toHaveCount(1);
    }
    await page.evaluate(() => document.querySelector("figcaption").firstChild.textContent = "Figure one.");
    await expect(page.locator("figcaption > [data-twp-bilingual]")).toContainText("Figure one.");
    await expect(page.locator("#meal > [data-twp-bilingual]")).toHaveCount(1);
    expect(await page.evaluate(sourceGeometry)).toEqual(before);
  });
}

test("Chinese translation of the Google meal paragraph stays below the complete original", async ({ page }) => {
  await setup(page, protectedCodeFixture);
  await page.evaluate(() => bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
    translate: async source => source.map(([text]) => [text.startsWith("You create a")
      ? "你创建了一个 `meal` 特征，其中包含数据集中每种餐食的独热编码表示。编码是指选择数据的初始数值表示，以用于训练模型。"
      : `译文：${text}`]) }));
  const translation = page.locator("#meal > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveText("meal");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1200 });
    expect(await page.locator("#meal").evaluate(element => {
      const translated = element.querySelector("[data-twp-bilingual]");
      const range = document.createRange(); range.setStart(element, 0); range.setEndBefore(translated);
      return range.getBoundingClientRect().bottom <= translated.getBoundingClientRect().top &&
        element.lastChild === translated;
    })).toBe(true);
    await page.locator("#meal").screenshot({ path: `build/bilingual-meal-fixed-${width}.png` });
  }
});

test("protected code and inline math stay in one sentence for page and hover translation", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="mixed-literals">Compare
    <code translate="no" dir="ltr">meal</code> with <math><mi>x</mi><mo>+</mo><mn>1</mn></math>
    and press <kbd class="notranslate">Enter</kbd>.</p>`));
  const original = await page.locator("#mixed-literals").innerHTML();
  await translate(page);
  const translation = page.locator("#mixed-literals > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveText("meal");
  await expect(translation.locator("math")).toHaveCount(1);
  await expect(translation.locator("kbd")).toHaveText("Enter");
  await page.evaluate(() => {
    pageTranslator.restorePage();
    const piece = bilingualTranslator.paragraphAt(document.getElementById("mixed-literals"), 0, 0);
    bilingualTranslator.renderParagraph(piece, "译文：" + bilingualTranslator.textForTranslation(piece), "zh-CN");
  });
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveText("meal");
  await expect(translation.locator("math")).toHaveCount(1);
  await expect(translation.locator("kbd")).toHaveText("Enter");
  await translation.evaluate(element => element.remove());
  expect(await page.locator("#mixed-literals").innerHTML()).toBe(original);
});

test("protected code attribute changes invalidate pending page and hover results", async ({ page }) => {
  await setup(page, fixture.replace("<main>", '<main><p id="protected-edit">Keep <code translate="no" dir="ltr">meal</code> intact.</p>'));
  await page.evaluate(() => { window.translationDelay = 500; });
  await translate(page);
  await page.waitForFunction(() => testRequests.some(request => request.sourceArray2d.flat().includes("Keep `meal` intact.")));
  await page.evaluate(() => {
    window.oldPiece = bilingualTranslator.paragraphAt(document.getElementById("protected-edit"), 0, 0);
    document.querySelector("#protected-edit code").dir = "rtl";
  });
  expect(await page.evaluate(() => bilingualTranslator.unchanged(oldPiece))).toBe(false);
  const translation = page.locator("#protected-edit > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveAttribute("dir", "rtl");
  await page.evaluate(() => {
    document.querySelector("#protected-edit code").textContent = "dish";
  });
  await expect(translation.locator("code")).toHaveText("dish");
  await expect(translation).toHaveCount(1);
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#protected-edit")).toHaveText("Keep dish intact.");
});

test("inline code edits invalidate pending responses and single paragraph rendering preserves literals", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="literal-edit">Compare <code id="literal-value">x &lt; y</code> before continuing.</p>`));
  await page.evaluate(() => { window.translationDelay = 500; });
  await translate(page);
  await page.waitForFunction(() => testRequests.some(request => request.sourceArray2d.flat().some(text => text.includes("`x < y`"))));
  await page.evaluate(() => { document.getElementById("literal-value").textContent = "x > y"; });
  const translation = page.locator("#literal-edit > [data-twp-bilingual]");
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("code")).toHaveText("x > y");
  await page.evaluate(() => {
    pageTranslator.restorePage();
    const piece = bilingualTranslator.paragraphAt(document.getElementById("literal-edit"), 0, 0);
    bilingualTranslator.renderParagraph(piece, `<strong>中文：</strong>${bilingualTranslator.textForTranslation(piece)}`, "zh-CN");
  });
  await expect(translation).toHaveCount(1);
  await expect(translation.locator("strong")).toHaveText("中文：");
  await expect(translation.locator("code")).toHaveText("x > y");
  // Code containing backticks, line breaks or markup stays inert and exact.
  await page.evaluate(() => {
    document.querySelectorAll("[data-twp-bilingual]").forEach(node => node.remove());
    document.getElementById("literal-value").textContent = "`x`\n<img src=x onerror=alert(1)>";
    const piece = bilingualTranslator.paragraphAt(document.getElementById("literal-edit"), 0, 0);
    bilingualTranslator.renderParagraph(piece, bilingualTranslator.textForTranslation(piece) + " 译文", "zh-CN");
  });
  await expect(translation.locator("code")).toHaveText("`x`\n<img src=x onerror=alert(1)>", {useInnerText:false});
  await expect(translation.locator("img")).toHaveCount(0);
});

const svgMath = (id, tex) => `<span id="${id}" class="MathJax_SVG" style="display:inline-block">
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="22" viewBox="0 0 48 22" aria-label="${tex}">
    <defs><path id="${id}-glyph" d="M4 4L14 18M14 4L4 18"/></defs>
    <use href="#${id}-glyph" stroke="currentColor"/><text x="18" y="19" font-size="12">1</text>
  </svg></span><script type="math/tex">${tex}</script>`;

test("MathJax formulas stay inside complete bilingual sentences and preserve original DOM", async ({ page }) => {
  const paragraphs = `<p id="nonlinear">A nonlinear model has the form ${svgMath("sum", "b + w_1x_1 + w_2x_2")}. Its decision surface is not a line.</p>
    <p id="cross">Cross the features ${svgMath("x1", "x_1")} and ${svgMath("x2", "x_2")}, then use a
    <a id="math-link" href="#model"><strong>linear model</strong></a>: ${svgMath("larger-sum", "b + w_1x_1 + w_2x_2 + w_3x_3")}
    where ${svgMath("x3", "x_3")} is the cross between ${svgMath("again-x1", "x_1")} and ${svgMath("again-x2", "x_2")}.</p>
    <p id="math-end">The final feature is ${svgMath("final-x", "x_4")}</p>`;
  await setup(page, fixture.replace("<main>", `<main>${paragraphs}`));
  const before = await page.evaluate(() => {
    window.originalFormula = document.getElementById("sum");
    window.originalMathLink = document.getElementById("math-link");
    window.mathClicks = 0;
    originalMathLink.addEventListener("click", () => window.mathClicks++);
    return ["nonlinear", "cross"].map(id => document.getElementById(id).innerHTML);
  });
  await translate(page);
  await expect(page.locator("#nonlinear > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#cross > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#math-end > [data-twp-bilingual]")).toHaveCount(1);
  const sentences = await page.evaluate(() => testRequests.flatMap(r => r.sourceArray2d.flat()));
  expect(sentences).toContain("A nonlinear model has the form $b + w_1x_1 + w_2x_2$. Its decision surface is not a line.");
  expect(sentences).toContain("Cross the features $x_1$ and $x_2$, then use a `__TWP_INLINE_LINK_0_START__`linear model`__TWP_INLINE_LINK_0_END__`: $b + w_1x_1 + w_2x_2 + w_3x_3$ where $x_3$ is the cross between $x_1$ and $x_2$.");
  await expect(page.locator("#cross > [data-twp-bilingual] .MathJax_SVG")).toHaveCount(6);
  await expect(page.locator("#nonlinear > [data-twp-bilingual] svg")).toHaveCount(1);
  expect(await page.locator("#cross > [data-twp-bilingual]").textContent()).not.toContain("$");
  expect(await page.evaluate(() => originalFormula === document.getElementById("sum") &&
    originalMathLink === document.getElementById("math-link"))).toBe(true);
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
    return new Set(ids).size === ids.length && [...document.querySelectorAll("[data-twp-bilingual] use")]
      .every(node => node.closest("svg").querySelector(node.getAttribute("href")));
  })).toBe(true);
  await page.locator("#math-link").click();
  expect(await page.evaluate(() => mathClicks)).toBe(1);
  // A rescan and a viewport change must not insert new breaks or duplicate math.
  await page.evaluate(() => { document.getElementById("details").firstChild.textContent = "Changed paragraph."; });
  await expect(page.locator("#details [data-twp-bilingual]")).toContainText("Changed");
  expect(await page.evaluate(() => testRequests.flatMap(request => request.sourceArray2d.flat())
    .filter(text => text.startsWith("The final feature")))).toEqual(["The final feature is $x_4$"]);
  for (const width of [1000, 420]) {
    await page.setViewportSize({width, height:1000});
    await expect(page.locator("#cross > [data-twp-bilingual]")).toHaveCount(1);
    expect(await page.locator("#cross").evaluate(element => {
      const translation = element.querySelector("[data-twp-bilingual]");
      const formulas = [...element.querySelectorAll(":scope > .MathJax_SVG")];
      const copies = [...translation.querySelectorAll(".MathJax_SVG")];
      return formulas.every((node, i) => node.getBoundingClientRect().bottom <= translation.getBoundingClientRect().top &&
        copies[i].getBoundingClientRect().height <= node.getBoundingClientRect().height + 1);
    })).toBe(true);
    await page.screenshot({path:`build/bilingual-math-${width}.png`, fullPage:true});
  }
  await page.evaluate(() => pageTranslator.restorePage());
  expect(await page.evaluate(() => ["nonlinear", "cross"].map(id => document.getElementById(id).innerHTML))).toEqual(before);
});

test("inline MathML, KaTeX and MathJax v3 group prose while standalone math and code stay excluded", async ({ page }) => {
  const mixed = `<p id="mathml">Feature <math><msub><mi>x</mi><mn>1</mn></msub></math> is useful.</p>
    <p id="katex">Feature <span class="katex" style="display:inline-block"><span aria-hidden="true">x₂</span>
      <math style="display:none"><semantics><annotation encoding="application/x-tex">x_2</annotation></semantics></math></span> is useful.</p>
    <p id="mjx">Feature <mjx-container style="display:inline-block" aria-label="x_3"><span>x₃</span></mjx-container> is useful.</p>
    <div class="MathJax_SVG_Display">${svgMath("display-math", "DISPLAY_FORMULA")}</div>
    <math display="block"><mi>BLOCK_FORMULA</mi></math>
    <p id="only-math">${svgMath("standalone", "STANDALONE_FORMULA")}</p>
    <p id="code-boundary">Before code<code>PROTECTED_CODE</code>After code</p>
    <p id="hidden-boundary">Before<span hidden>HIDDEN_TEXT</span> after.</p>`;
  await setup(page, fixture.replace("<main>", `<main>${mixed}`));
  await translate(page);
  for (const id of ["mathml", "katex", "mjx", "hidden-boundary"]) {
    await expect(page.locator(`#${id} > [data-twp-bilingual]`)).toHaveCount(1);
  }
  await expect(page.locator("#code-boundary > [data-twp-bilingual]")).toHaveCount(1);
  await expect(page.locator("#code-boundary > [data-twp-bilingual] code")).toHaveText("PROTECTED_CODE");
  await expect(page.locator("#only-math [data-twp-bilingual], .MathJax_SVG_Display [data-twp-bilingual]")).toHaveCount(0);
  const sentences = await page.evaluate(() => testRequests.flatMap(r => r.sourceArray2d.flat()));
  expect(sentences).toContain("Feature $x_2$ is useful.");
  expect(sentences).toContain("Feature $x_3$ is useful.");
  expect(sentences).toContain("Before code`PROTECTED_CODE`After code");
  expect(sentences.join(" ")).not.toMatch(/DISPLAY_FORMULA|BLOCK_FORMULA|STANDALONE_FORMULA|HIDDEN_TEXT/);
  await expect(page.locator("#mathml > [data-twp-bilingual] math")).toHaveCount(1);
  await expect(page.locator("#katex > [data-twp-bilingual] .katex")).toHaveCount(1);
  await expect(page.locator("#mjx > [data-twp-bilingual] mjx-container")).toHaveCount(1);
});

test("formula-only DOM edits refresh the translation and stale responses cannot render", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="changing">Feature ${svgMath("changing-math", "x_1")} is useful.</p>`));
  await page.evaluate(() => { window.translationDelay = 500; });
  await translate(page);
  await page.waitForFunction(() => testRequests.some(request => request.sourceArray2d.flat().some(text => text.includes("$x_1$"))));
  await page.evaluate(() => { document.getElementById("changing-math").nextElementSibling.textContent = "x_2"; });
  await expect(page.locator("#changing > [data-twp-bilingual]")).toHaveCount(1);
  expect(await page.evaluate(() => testRequests.flatMap(request => request.sourceArray2d.flat()).filter(text => text.startsWith("Feature"))))
    .toEqual(["Feature $x_1$ is useful.", "Feature $x_2$ is useful."]);
  await page.evaluate(() => {
    document.querySelector("#changing-math svg").setAttribute("width", "60");
    document.getElementById("changing-math").nextElementSibling.textContent = "x_3";
  });
  await expect(page.locator("#changing > [data-twp-bilingual] svg")).toHaveAttribute("width", "60");
  await expect(page.locator("#changing > [data-twp-bilingual]")).toHaveCount(1);
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

test("translated labels retain source link destinations, color and click behavior", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><style>a {color:rgb(26,115,232);text-decoration:underline}</style>
    <p id="linked-prose">See <a id="fairness" href="/fairness?view=bias#evaluation" target="_blank" onclick="window.sourceClicked=true">Fairness: <strong>Evaluating for Bias</strong></a> or <a href="#details">details</a>.</p>`));
  const before = await page.locator("#linked-prose").innerHTML();
  await page.evaluate(() => bilingualTranslator.start({ targetLanguage: "zh-CN", dynamicContent: true,
    translate: async paragraphs => paragraphs.map(([text]) => [text.replace("See ", "请参阅 ")
      .replace("Fairness: Evaluating for Bias", "公平性：偏差评估").replace(" or ", " 或 ").replace("details", "详情")]) }));
  const translation = page.locator("#linked-prose > [data-twp-bilingual]");
  await expect(translation).toHaveText("请参阅 公平性：偏差评估 或 详情.");
  const link = translation.locator("a").first();
  await expect(link).toHaveText("公平性：偏差评估");
  await expect(link).toHaveAttribute("href", "https://bilingual.test/fairness?view=bias#evaluation");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveCSS("color", "rgb(26, 115, 232)");
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  await expect(translation.locator("[id], [onclick]")).toHaveCount(0);
  await page.context().route("https://bilingual.test/fairness**", route =>
    route.fulfill({ contentType: "text/html", body: "<h1>Fairness destination</h1>" }));
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup).toHaveURL("https://bilingual.test/fairness?view=bias#evaluation");
  await popup.close();
  await translation.locator("a").last().click();
  await expect(page).toHaveURL(/#details$/);
  expect(await page.evaluate(() => window.sourceClicked)).toBeUndefined();
  expect(await page.evaluate(() => bilingualTranslator.sourceText())).not.toContain("__TWP_INLINE_");
  await page.evaluate(() => bilingualTranslator.stop());
  expect(await page.locator("#linked-prose").innerHTML()).toBe(before);
});

test("link changes invalidate pending translations and unsafe destinations stay inert", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><p id="link-edit">Read <a href="/old">this guide</a> and <a href="javascript:window.unsafeLink=true">unsafe link</a>.</p>`));
  await page.evaluate(() => { window.translationDelay = 500; });
  await translate(page);
  await page.waitForFunction(() => testRequests.some(r => r.sourceArray2d.flat().some(t => t.includes("this guide"))));
  await page.locator("#link-edit > a").first().evaluate(link => link.setAttribute("href", "/new"));
  const translation = page.locator("#link-edit > [data-twp-bilingual]");
  await expect(translation.locator("a").first()).toHaveAttribute("href", "https://bilingual.test/new");
  await expect(translation.locator("a").last()).not.toHaveAttribute("href");
  await expect(translation).not.toContainText("__TWP_INLINE_");
  await translation.locator("a").last().click();
  expect(await page.evaluate(() => window.unsafeLink)).toBeUndefined();
  await expect(translation).toHaveCount(1);
  // A provider losing a boundary must leave readable text, never visible markers.
  await page.evaluate(() => {
    pageTranslator.restorePage();
    const piece = bilingualTranslator.paragraphAt(document.getElementById("link-edit"), 0, 0);
    const text = bilingualTranslator.textForTranslation(piece).replace(piece.links[0].end, "");
    bilingualTranslator.renderParagraph(piece, "译文：" + text, "zh-CN");
  });
  await expect(translation).not.toContainText("__TWP_INLINE_");
  await expect(translation).toContainText("this guide");
});

test("inline quiz headings with line breaks keep each translation below its own source", async ({ page }) => {
  await setup(page, fixture.replace("<main>", `<main><style>#quiz-heading {display:inline}</style>
    <ol><li id="quiz-item"><h2 id="quiz-heading"><span>First question paragraph.</span><br><br>
    <span>Second question paragraph.</span><br><br>Final question paragraph.</h2><section translate="no">Answers</section></li></ol>`));
  const before = await page.locator("#quiz-item").innerHTML();
  await translate(page);
  const translations = page.locator("#quiz-heading > [data-twp-bilingual]");
  await expect(translations).toHaveText([
    "中文：First question paragraph.", "中文：Second question paragraph.", "中文：Final question paragraph.",
  ]);
  async function checkOrder() {
    const positions = await page.locator("#quiz-heading").evaluate(element => {
      const texts = [...element.childNodes].filter(node =>
        node.nodeType === Node.TEXT_NODE ? node.textContent.trim() : node.matches("span:not([data-twp-bilingual])"));
      const translated = [...element.querySelectorAll("[data-twp-bilingual]")];
      return texts.map((node, i) => {
        const range = document.createRange(); range.selectNode(node);
        const source = range.getBoundingClientRect(), copy = translated[i].getBoundingClientRect();
        const next = texts[i + 1];
        if (next) range.selectNode(next);
        return {below:copy.top >= source.bottom - 1, beforeNext:!next || copy.bottom <= range.getBoundingClientRect().top + 1};
      });
    });
    expect(positions).toEqual(Array(3).fill({below:true,beforeNext:true}));
  }
  await checkOrder();
  await page.setViewportSize({width:390,height:1000});
  await checkOrder();
  // Rescans and source edits must keep the same anchors without duplicates.
  await page.locator("#quiz-heading > span").first().evaluate(node => { node.textContent = "Updated first paragraph."; });
  await expect(translations).toHaveText([
    "中文：Updated first paragraph.", "中文：Second question paragraph.", "中文：Final question paragraph.",
  ]);
  await checkOrder();
  await page.evaluate(() => pageTranslator.restorePage());
  await expect(page.locator("#quiz-heading [data-twp-bilingual]")).toHaveCount(0);
  expect(await page.locator("#quiz-item").innerHTML()).toBe(before.replace("First question paragraph.", "Updated first paragraph."));
});
