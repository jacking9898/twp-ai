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
  ].join(",");
  let activeSession = null;

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
      function flush() {
        while (nodes.length && !nodes[0].textContent.trim()) nodes.shift();
        while (nodes.length && !nodes[nodes.length - 1].textContent.trim()) nodes.pop();
        if (nodes.length) {
          let anchor = nodes[nodes.length - 1];
          while (anchor.parentNode && anchor.parentNode !== container) {
            anchor = anchor.parentNode;
          }
          pieces.push({ container, anchor, nodes, source: nodes.map(n => n.textContent) });
          nodes = [];
        }
      }
      function walk(parent) {
        for (const child of parent.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            nodes.push(child);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (isExcluded(child)) {
              flush();
              continue;
            }
            const style = getComputedStyle(child);
            if (style.display === "none" || style.visibility === "hidden") continue;
            if (child.tagName === "BR") {
              flush();
            } else if (style.display === "inline" || style.display === "contents") {
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
      record.nodes.every((node, i) => node === piece.nodes[i] && record.source[i] === piece.source[i]);
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
    if (!text.trim() || text.trim() === record.source.join("").trim()) return;
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
      "padding-inline-start: .65em !important; border-inline-start: 2px solid #80808066 !important; " +
      "font-size: .95em !important; line-height: 1.65 !important; " +
      "white-space: pre-wrap !important; user-select: text !important;";
    // Translation service responses are text, never executable HTML.
    element.textContent = text;
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
        session.translate(batch.map(record => record.source)),
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
        if (!record.nodes.every((node, j) => node.isConnected && node.textContent === record.source[j])) return;
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
        attributeFilter: ["hidden", "style", "class", "translate", "contenteditable"],
      });
    }
    window.addEventListener("scroll", session.onView, true);
    window.addEventListener("resize", session.onView);
    document.addEventListener("visibilitychange", session.onView);
  }

  function paragraphAt(element, x, y) {
    if (!(element instanceof Element) || element.closest(excluded) || element.isContentEditable) return null;
    let root = element;
    while (root.parentElement && ["inline", "contents"].includes(getComputedStyle(root).display)) root = root.parentElement;
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
  return { start, stop, paragraphAt, renderParagraph, sourceText:()=>collect().map(p=>p.source.join("")).join("\n\n") };
})();
