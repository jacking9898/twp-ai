"use strict";

// Keep this renderer separate from TWP's replacement mode: original DOM nodes
// and their event handlers must stay owned by the website.
const bilingualTranslator = (() => {
  const marker = "[data-twp-bilingual]";
  const excluded = [
    "script", "style", "noscript", "template", "textarea", "input",
    "select", "button", "pre", "code", "kbd", "svg", "math",
    "mjx-container", "canvas", "video", "audio", "iframe", "object",
    "nav", '[role="navigation"]', '[role="button"]', '[role="menu"]',
    '[translate="no"]', ".notranslate", marker,
    "#disqussions_wrapper", "#disqussions_overlay", "#disqus_thread", ".disqussion",
  ].join(",");
  let activeSession = null;
  const mathSelector = "math, mjx-container, tex-math, .MathJax, .MathJax_SVG, .MathJax_CHTML, .katex";
  let mathCloneId = 0;
  const formattingTags = new Set([
    "sup", "sub", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
    "small", "mark", "code", "kbd", "samp", "var", "abbr", "cite", "q",
    "ruby", "rt", "rp", "span", "br", "wbr",
  ]);
  let discussionObserver = null;
  let discussionResizeObserver = null;
  let discussionFrame = 0;
  let discussionOnResize = null;

  function watchInlineDiscussions() {
    // inlineDisqussions positions detached comment buttons only once, before
    // our translations expand the article. Keep the existing buttons and their
    // handlers, but align them with the original paragraph/image after reflow.
    if (!document.querySelector("#disqussions_wrapper .disqussion")) return;
    function schedule() {
      if (discussionFrame) return;
      discussionFrame = requestAnimationFrame(() => {
        discussionFrame = 0;
        const sources = new Map();
        for (const source of document.querySelectorAll("[data-disqus-identifier]")) {
          if (!source.closest("#disqussions_wrapper")) sources.set(source.getAttribute("data-disqus-identifier"), source);
        }
        for (const link of document.querySelectorAll("#disqussions_wrapper .disqussion-link[data-disqus-identifier]")) {
          const source = sources.get(link.getAttribute("data-disqus-identifier"));
          const note = link.closest(".disqussion");
          if (!source || !note) continue;
          const rect = source.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          const parent = note.offsetParent;
          const origin = parent?.getBoundingClientRect() || { top: -window.scrollY, left: -window.scrollX };
          const top = rect.top - origin.top - (parent?.clientTop || 0) + (parent?.scrollTop || 0);
          const edge = link.getAttribute("data-disqus-position") === "left"
            ? rect.left - note.getBoundingClientRect().width : rect.right;
          const left = edge - origin.left - (parent?.clientLeft || 0) + (parent?.scrollLeft || 0);
          if (note.style.top !== `${top}px`) note.style.top = `${top}px`;
          if (note.style.left !== `${left}px`) note.style.left = `${left}px`;
        }
        // A final alignment after restoring the page also handles resized or
        // dynamically edited source content. No observers remain after restore.
        if (!document.querySelector(marker)) {
          discussionObserver?.disconnect();
          discussionResizeObserver?.disconnect();
          window.removeEventListener("resize", discussionOnResize);
          discussionObserver = discussionResizeObserver = null;
          discussionOnResize = null;
        }
      });
    }
    if (!discussionObserver) {
      discussionObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation => !(mutation.type === "attributes" &&
            mutation.attributeName === "style" && mutation.target.matches(".disqussion")))) schedule();
      });
      discussionObserver.observe(document.body, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ["style", "class", "hidden", "data-disqus-identifier"] });
      discussionResizeObserver = new ResizeObserver(schedule);
      discussionResizeObserver.observe(document.body);
      discussionOnResize = schedule;
      window.addEventListener("resize", discussionOnResize);
    }
    schedule();
  }

  function inlineMath(element, style) {
    return element.matches(mathSelector) && element.getAttribute("display") !== "block" &&
      !element.hasAttribute("data-twp-bilingual") &&
      !element.closest('.MathJax_Display, .MathJax_SVG_Display, .katex-display') &&
      (style.display.startsWith("inline") || ["math", "contents"].includes(style.display));
  }

  function mathSource(element) {
    let script = element.nextElementSibling;
    while (script?.matches(marker)) script = script.nextElementSibling;
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
      (script?.matches('script[type^="math/tex"]') ? script.textContent : "") ||
      element.getAttribute("data-tex") || element.getAttribute("aria-label") || element.textContent;
    // Dollar delimiters use the existing provider formula protection, while
    // giving the translator the formula's position inside the whole sentence.
    return `$${tex.trim()}$`;
  }

  function unchanged(piece) {
    return piece.nodes.every((node, i) => node.isConnected && node.textContent === piece.source[i]) &&
      (piece.literals || []).every(item => item.node.outerHTML === item.html) &&
      (piece.links || []).every(item => item.node.outerHTML === item.html) &&
      (piece.math || []).every(item => item.node.outerHTML === item.html && mathSource(item.node) === item.text);
  }

  function reportState(session) {
    if (activeSession !== session) return;
    const visible = [...session.records.values()].filter(inView);
    const failed = visible.some(record => record.state === "failed" || record.attempts > 0);
    const waiting = visible.some(record => record.state === "pending" || record.state === "loading");
    const state = failed || !session.records.size ? "error" : waiting ? "translating" : "translated";
    if (session.state !== state) {
      session.state = state;
      session.onStateChange(state);
    }
  }

  function isExcluded(element) {
    return element.matches(excluded) || element.isContentEditable ||
      element.hidden || element.getAttribute("aria-hidden") === "true";
  }

  function collect(root = document.body) {
    const pieces = [];
    function visit(container) {
      let nodes = [];
      let math = [];
      let literals = [];
      let literalPrefix = "__TWP_INLINE_";
      while (container.textContent.includes(literalPrefix)) literalPrefix += "X";
      function flush() {
        while (nodes.length && !nodes[0].textContent.trim() && !math.some(item => item.node === nodes[0])) nodes.shift();
        while (nodes.length && !nodes[nodes.length - 1].textContent.trim() && !math.some(item => item.node === nodes[nodes.length - 1])) nodes.pop();
        if (nodes.length) {
          let anchor = nodes[nodes.length - 1];
          while (anchor.parentNode && anchor.parentNode !== container) {
            anchor = anchor.parentNode;
          }
          // A standalone formula is not prose to translate.
          if (nodes.some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) {
            const links = [];
            for (const node of nodes) {
              const link = node.parentElement.closest("a[href]");
              if (!link || link === container || !container.contains(link) ||
                  literals.some(item => item.node === link) || links.some(item => item.node === link)) continue;
              const linked = nodes.filter(item => link.contains(item));
              links.push({ node: link, html: link.outerHTML, first: linked[0], last: linked[linked.length - 1],
                start: `\`${literalPrefix}LINK_${links.length}_START__\``,
                end: `\`${literalPrefix}LINK_${links.length}_END__\`` });
            }
            pieces.push({ container, anchor, nodes, math, literals, links, source: nodes.map(n => n.textContent) });
          }
          nodes = [];
        }
        math = [];
        literals = [];
      }
      function walk(parent) {
        for (const child of parent.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            nodes.push(child);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            // Our inserted translation and MathJax's hidden TeX script are
            // transparent to paragraph collection on subsequent scans.
            if (child.matches(marker) || child.matches('script[type^="math/tex"]')) continue;
            const style = getComputedStyle(child);
            if (style.display === "none" || style.visibility === "hidden") continue;
            if (inlineMath(child, style)) {
              nodes.push(child);
              math.push({ node: child, text: mathSource(child), html: child.outerHTML });
              continue;
            }
            // Plain textContent would turn 1024.<sup>1</sup> into 1024.1
            // before the provider even sees it. Carry annotations as protected
            // inline literals and rebuild their safe source markup on return.
            const annotation = child.matches("sup, sub") || child.matches("a[href]") &&
              child.querySelector("sup, sub") && [...child.childNodes].every(node =>
                node.nodeType === Node.TEXT_NODE ? !node.textContent.trim() :
                node.nodeType === Node.ELEMENT_NODE && node.matches("sup, sub"));
            if (annotation && !isExcluded(child) &&
                ["inline", "inline-block", "contents"].includes(style.display)) {
              nodes.push(child);
              literals.push({ node: child, text: `\`${literalPrefix}${literals.length}__\``, html: child.outerHTML });
              continue;
            }
            // Inline code/keys belong to the surrounding sentence. Protect
            // their contents without flushing prose or translating them alone.
            // A code/key's own translate="no" or .notranslate means preserve
            // the literal, not split the sentence. Excluded ancestor regions
            // are already skipped by walk()/isExcluded(root).
            if (child.matches("code, kbd") && ["inline", "inline-block", "contents"].includes(style.display) &&
                !child.closest('pre, [contenteditable]:not([contenteditable="false"])') &&
                !child.hidden && child.getAttribute("aria-hidden") !== "true") {
              nodes.push(child);
              const value = child.textContent;
              const text = `\`${/[`\r\n]/.test(value) ? `${literalPrefix}${literals.length}__` : value}\``;
              literals.push({ node: child, text, html: child.outerHTML });
              continue;
            }
            if (isExcluded(child)) {
              flush();
              continue;
            }
            if (child.tagName === "BR") {
              flush();
            } else if (["inline", "inline-block", "contents"].includes(style.display)) {
              walk(child);
            } else {
              flush();
              visit(child);
            }
          }
        }
      }
      walk(container);
      flush();
    }
    if (root && !isExcluded(root)) visit(root);
    return pieces;
  }

  function matches(record, piece) {
    return record.container === piece.container && record.anchor === piece.anchor &&
      record.nodes.length === piece.nodes.length &&
      record.nodes.every((node, i) => node === piece.nodes[i] && record.source[i] === piece.source[i]) &&
      record.literals.length === piece.literals.length &&
      record.literals.every((item, i) => item.html === piece.literals[i].html && item.text === piece.literals[i].text) &&
      record.links.length === piece.links.length &&
      record.links.every((item, i) => item.node === piece.links[i].node && item.html === piece.links[i].html) &&
      record.math.length === piece.math.length &&
      record.math.every((item, i) => item.html === piece.math[i].html && item.text === piece.math[i].text);
  }

  function textForTranslation(piece, includeLinks = true) {
    // HTML source newlines and indentation are usually collapsed by CSS. Keep
    // the raw source for DOM change checks, but send the visible whitespace to
    // providers so it cannot return as artificial line breaks in the result.
    const runs = [];
    piece.nodes.forEach((node, i) => {
      const whitespace = getComputedStyle(node.parentElement).whiteSpace;
      const previous = runs[runs.length - 1];
      let text = piece.literals?.find(item => item.node === node)?.text ??
        piece.math?.find(item => item.node === node)?.text ?? piece.source[i];
      if (includeLinks) {
        for (const link of piece.links || []) {
          if (link.first === node) text = link.start + text;
          if (link.last === node) text += link.end;
        }
      }
      if (previous && previous.whitespace === whitespace) previous.text += text;
      else runs.push({ whitespace, text });
    });
    return runs.map(({ whitespace, text }) => {
      if (["pre", "pre-wrap", "break-spaces"].includes(whitespace)) return text;
      if (whitespace === "pre-line") return text.replace(/[\t\f\r ]+/g, " ").replace(/ *\n */g, "\n");
      // Do not collapse nonbreaking spaces used intentionally by the author.
      return text.replace(/[\t\n\f\r ]+/g, " ");
    }).join("").trim();
  }

  function sourceRect(record) {
    const range = document.createRange();
    range.setStartBefore(record.nodes[0]);
    range.setEndAfter(record.nodes[record.nodes.length - 1]);
    return range.getBoundingClientRect();
  }

  function inView(record) {
    if (!record.container.isConnected || !record.nodes.every(node => node.isConnected)) return false;
    const rect = sourceRect(record);
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom >= -300 && rect.top <= window.innerHeight + 300;
  }

  function render(session, record, text) {
    if (!text.trim() || text.trim() === textForTranslation(record)) return;
    const tab = record.container.closest('[role="tab"]');
    const element = document.createElement("span");
    element.setAttribute("data-twp-bilingual", "translation");
    element.className = "notranslate";
    element.setAttribute("translate", "no");
    element.lang = session.targetLanguage;
    element.dir = "auto";
    // Tab controls commonly have a fixed height and hidden overflow. A second
    // paragraph pushes their centered original label outside the visible box.
    element.style.cssText = tab
      ? "display: inline !important; margin: 0 !important; margin-inline-start: .4em !important; " +
        "padding: 0 !important; border: 0 !important; font-size: .85em !important; " +
        "line-height: inherit !important; white-space: nowrap !important; vertical-align: baseline !important;"
      : "display: block !important; margin: .35em 0 .7em !important; " +
      "padding: 0 !important; border: 0 !important; " +
      "font-size: .95em !important; line-height: 1.65 !important; " +
      "white-space: pre-wrap !important; user-select: text !important;";
    // Only explicit safe formatting and source formula clones become DOM nodes.
    appendTranslation(element, record, text);
    record.anchor.after(element);
    if (tab) {
      const bounds = tab.getBoundingClientRect();
      const original = sourceRect(record);
      const translated = element.getBoundingClientRect();
      // Some controls use separate flex items or wrap within a fixed width.
      // If even the compact label cannot fit, preserve the original control.
      if (Math.min(original.top, translated.top) < bounds.top - 1 ||
          Math.max(original.bottom, translated.bottom) > bounds.bottom + 1) {
        element.remove();
        return;
      }
    }
    record.element = element;
    session.elements.add(element);
    watchInlineDiscussions();
  }

  function appendTranslation(element, record, text) {
    // Link boundaries are protected inline literals; only the label is translated.
    // Destinations and appearance come from the source, never provider markup.
    const links = record.links || [];
    const tokens = links.flatMap(link => [link.start, link.end]);
    const clean = value => tokens.length ? value.replace(formulaPattern(tokens), "") : value;
    let offset = 0;
    const ranges = links.map(link => {
      const start = text.indexOf(link.start);
      const end = text.indexOf(link.end, start + link.start.length);
      return { link, start, end };
    }).filter(({ start, end }) => start >= 0 && end >= 0).sort((a, b) => a.start - b.start);
    for (const { link, start, end } of ranges) {
      if (start < offset) continue;
      appendInlineTranslation(element, record, clean(text.slice(offset, start)));
      const copy = document.createElement("a");
      try {
        const url = new URL(link.node.getAttribute("href"), link.node.baseURI);
        if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
          copy.href = url.href;
          if (["_blank", "_self", "_parent", "_top"].includes(link.node.target)) copy.target = link.node.target;
          copy.rel = "noopener noreferrer";
          if (link.node.hasAttribute("title")) copy.title = link.node.title;
          const style = getComputedStyle(link.node);
          copy.style.color = style.color;
          copy.style.textDecoration = style.textDecoration;
        }
      } catch (_) { /* Invalid source destinations remain inert text. */ }
      appendInlineTranslation(copy, record, clean(text.slice(start + link.start.length, end)));
      element.append(copy);
      offset = end + link.end.length;
    }
    appendInlineTranslation(element, record, clean(text.slice(offset)));
  }

  function appendInlineTranslation(element, record, text) {
    // Parse in an inert template, then rebuild only inline formatting with fresh
    // nodes and no provider attributes. Unknown markup remains visible text.
    // Keep plain responses untouched, including literal angle brackets/entities.
    if (![...text.matchAll(/<\/?([a-z][\w-]*)\b/gi)].some(match => formattingTags.has(match[1].toLowerCase()))) {
      appendFormulaTranslation(element, record, text);
      return;
    }
    const template = document.createElement("template");
    const formulas = [...new Set([...(record.math || []), ...(record.literals || [])].map(item => item.text))];
    // TeX comparisons such as $x<y$ are text, not HTML tags. Escape protected
    // formulas before parsing; the inert parser decodes them back for cloning.
    template.innerHTML = formulas.length ? text.replace(formulaPattern(formulas), value =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) : text;
    function append(parent, nodes) {
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          appendFormulaTranslation(parent, record, node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE && formattingTags.has(node.localName)) {
          const formatted = document.createElement(node.localName);
          append(formatted, node.childNodes);
          parent.append(formatted);
        } else {
          appendFormulaTranslation(parent, record, node.outerHTML ?? `<!--${node.textContent}-->`);
        }
      }
    }
    append(element, template.content.childNodes);
  }

  function formulaPattern(values) {
    const escaped = [...values].sort((a, b) => b.length - a.length)
      .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(escaped.join("|"), "g");
  }

  function appendAnnotation(parent, source) {
    // Rebuild source annotations without IDs, event handlers, styles or active
    // content. Only same-page footnote links keep a destination.
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE &&
          (formattingTags.has(child.localName) || child.localName === "a")) {
        const copy = document.createElement(child.localName);
        if (child.localName === "a" && child.getAttribute("href")?.startsWith("#")) {
          copy.setAttribute("href", child.getAttribute("href"));
        }
        appendAnnotation(copy, child);
        parent.append(copy);
      }
    }
  }

  function appendFormulaTranslation(element, record, text) {
    const formulas = new Map((record.math || []).map(item => [item.text, item.node]));
    const literals = new Map((record.literals || []).map(item => [item.text, item.node]));
    for (const [token, node] of literals) formulas.set(token, node);
    if (!formulas.size) { element.append(document.createTextNode(text)); return; }
    const pattern = formulaPattern(formulas.keys());
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      element.append(document.createTextNode(text.slice(offset, match.index)));
      if (literals.has(match[0])) {
        const source = literals.get(match[0]);
        const copy = document.createElement(source.localName);
        if (source.matches("sup, sub, a")) appendAnnotation(copy, source);
        else copy.textContent = source.textContent;
        if (source.localName === "a" && source.getAttribute("href")?.startsWith("#")) {
          copy.setAttribute("href", source.getAttribute("href"));
        }
        copy.setAttribute("translate", "no");
        if (["ltr", "rtl", "auto"].includes(source.getAttribute("dir"))) copy.dir = source.getAttribute("dir");
        element.append(copy);
        offset = match.index + match[0].length;
        continue;
      }
      const clone = formulas.get(match[0]).cloneNode(true);
      // Translation prose preserves line breaks; rendered math must keep its
      // own whitespace rules so source indentation cannot enlarge the clone.
      clone.style.whiteSpace = getComputedStyle(formulas.get(match[0])).whiteSpace;
      // Keep SVG glyph references functional without duplicating website IDs.
      const ids = new Map();
      const descendants = [clone, ...clone.querySelectorAll("*")];
      for (const node of descendants) {
        if (node.id) { const id = `twp-math-${++mathCloneId}`; ids.set(node.id, id); node.id = id; }
      }
      for (const node of descendants) {
        for (const attr of [...node.attributes]) {
          if (attr.name.startsWith("on")) node.removeAttribute(attr.name);
          else {
            let value = attr.value.replace(/url\(#([^)]*)\)/g, (all, id) => ids.has(id) ? `url(#${ids.get(id)})` : all);
            if (["href", "xlink:href"].includes(attr.name) && ids.has(value.slice(1)) && value.startsWith("#")) value = `#${ids.get(value.slice(1))}`;
            if (value !== attr.value) node.setAttribute(attr.name, value);
          }
        }
      }
      clone.querySelectorAll("script").forEach(node => node.remove());
      clone.setAttribute("translate", "no");
      element.append(clone);
      offset = match.index + match[0].length;
    }
    element.append(document.createTextNode(text.slice(offset)));
  }

  async function flush(session) {
    if (activeSession !== session || session.busy || document.visibilityState === "hidden") return;
    const batch = [];
    let size = 0;
    for (const record of session.records.values()) {
      if (record.state !== "pending" || record.retryAt > Date.now() || !inView(record)) continue;
      const length = record.source.join("").length;
      if (batch.length && (batch.length >= 20 || size + length > 8000)) break;
      batch.push(record);
      size += length;
      record.state = "loading";
    }
    if (!batch.length) {
      reportState(session);
      return;
    }
    session.busy = true;
    reportState(session);
    try {
      const results = await Promise.race([
        session.translate(batch.map(record => [textForTranslation(record)])),
        new Promise((_, reject) => {
          session.requestTimer = setTimeout(() => reject(new Error("Translation request timed out")), session.requestTimeout);
        }),
      ]);
      if (!Array.isArray(results) || results.length !== batch.length) {
        throw new Error("Missing bilingual translation response");
      }
      if (activeSession !== session) return;
      batch.forEach((record, i) => {
        if (session.records.get(record.nodes[0]) !== record || !record.container.isConnected) return;
        if (!unchanged(record)) return;
        if (!Array.isArray(results[i]) || !results[i].length ||
            results[i].some(text => typeof text !== "string")) {
          throw new Error("Invalid bilingual translation response");
        }
        render(session, record, results[i].join(" ").trim());
        record.state = "done";
        record.attempts = 0;
      });
    } catch (error) {
      if (activeSession === session) {
        session.onError(error.message);
        console.warn("TWP bilingual translation failed", error);
        batch.forEach(record => {
          if (record.state !== "loading") return;
          record.attempts++;
          record.state = record.attempts < session.maxAttempts ? "pending" : "failed";
          record.retryAt = Date.now() + 5000;
        });
        clearTimeout(session.retryTimer);
        session.retryTimer = setTimeout(() => flush(session), 5100);
      }
    } finally {
      clearTimeout(session.requestTimer);
      session.busy = false;
      if (activeSession === session) {
        reportState(session);
        clearTimeout(session.flushTimer);
        session.flushTimer = setTimeout(() => flush(session), 100);
      }
    }
  }

  function scan(session) {
    if (activeSession !== session) return;
    const next = new Map();
    for (const piece of collect()) {
      const key = piece.nodes[0];
      const previous = session.records.get(key);
      if (previous && matches(previous, piece) && (!previous.element || previous.element.isConnected)) {
        next.set(key, previous);
      } else {
        next.set(key, { ...piece, state: "pending", attempts: 0, retryAt: 0 });
      }
    }
    for (const [key, record] of session.records) {
      if (next.get(key) !== record && record.element) {
        record.element.remove();
        session.elements.delete(record.element);
      }
    }
    session.records = next;
    flush(session);
    watchInlineDiscussions();
  }

  function stop() {
    const session = activeSession;
    activeSession = null;
    if (!session) return;
    session.observer.disconnect();
    clearTimeout(session.scanTimer);
    clearTimeout(session.flushTimer);
    clearTimeout(session.retryTimer);
    clearTimeout(session.requestTimer);
    window.removeEventListener("scroll", session.onView, true);
    window.removeEventListener("resize", session.onView);
    document.removeEventListener("visibilitychange", session.onView);
    session.elements.forEach(element => element.remove());
  }

  function start({ translate, targetLanguage, dynamicContent, onStateChange = () => {},
    onError = () => {}, requestTimeout = 30000, maxAttempts = 3 }) {
    stop();
    const session = {
      translate, targetLanguage, onStateChange, onError, requestTimeout, maxAttempts,
      records: new Map(), elements: new Set(), busy: false,
      onView: () => {
        clearTimeout(session.flushTimer);
        session.flushTimer = setTimeout(() => flush(session), 100);
      },
      observer: new MutationObserver(mutations => {
        const changed = mutations.some(mutation => {
          const target = mutation.target.nodeType === Node.ELEMENT_NODE
            ? mutation.target : mutation.target.parentElement;
          if (target && target.closest(marker)) return false;
          if (mutation.type !== "childList") return true;
          return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
            !(node.nodeType === Node.ELEMENT_NODE && node.matches(marker)));
        });
        if (changed) {
          clearTimeout(session.scanTimer);
          session.scanTimer = setTimeout(() => scan(session), 150);
        }
      }),
    };
    activeSession = session;
    scan(session);
    if (dynamicContent && document.body) {
      session.observer.observe(document.body, {
        childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ["hidden", "style", "class", "translate", "contenteditable", "dir", "href", "target", "title"],
      });
    }
    window.addEventListener("scroll", session.onView, true);
    window.addEventListener("resize", session.onView);
    document.addEventListener("visibilitychange", session.onView);
  }

  function paragraphAt(element, x, y) {
    if (!(element instanceof Element) || element.closest(excluded) || element.isContentEditable) return null;
    let root = element;
    while (root.parentElement && ["inline", "inline-block", "contents"].includes(getComputedStyle(root).display)) root = root.parentElement;
    if (root === document.body || root === document.documentElement) return null;
    const pieces = collect(root);
    return pieces.find(piece => {
      const rect = sourceRect(piece);
      return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }) || (pieces.length === 1 ? pieces[0] : null);
  }
  function renderParagraph(piece, text, targetLanguage) {
    const record = { ...piece };
    render({ targetLanguage, elements: new Set() }, record, text);
    return record.element;
  }
  return { start, stop, paragraphAt, renderParagraph, textForTranslation,
    unchanged,
    sourceText:()=>collect().map(piece => textForTranslation(piece, false)).join("\n\n") };
})();
