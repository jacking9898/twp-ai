"use strict";

const twpSelectionDictionary = (() => {
  function create({ shadow, translate, cancel, reposition }) {
    const popup = shadow.getElementById("popup");
    const panel = document.createElement("section");
    panel.id = "dictionary"; panel.hidden = true; panel.setAttribute("aria-label", "英文词典");
    panel.innerHTML = `<style>
      #popup[data-word=true]{width:370px}#popup[data-word=true]>.hint{display:none}
      #dictionary{border-top:1px solid var(--border);margin-top:12px;padding-top:12px;overflow-wrap:anywhere}
      #dictionary-word{font-size:20px;font-weight:650;line-height:1.4}#dictionary-form{margin-top:3px}
      #dictionary-form,#dictionary-status,#pronunciation-status{font-size:12px;color:var(--muted)}#dictionary-status:empty,#pronunciation-status:empty{display:none}
      .dictionary-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.pronunciation-buttons{display:flex;gap:6px;flex:none}.pronunciation-buttons button{font-size:12px;padding:4px 8px}
      #dictionary-phonetics{font-size:13px;display:flex;gap:10px;flex-wrap:wrap;margin-top:5px}#phonetic-uk:not([hidden])::before{content:'英 ';color:var(--muted)}#phonetic-us:not([hidden])::before{content:'美 ';color:var(--muted)}
      #phonetic-reference{font-size:13px;margin-top:5px}#phonetic-reference-label{font-size:11px;color:var(--muted);margin-right:5px}#pronunciation-status,#dictionary-status:not(:empty){margin-top:7px}
      .dictionary-sense{margin-top:12px}.dictionary-sense .pos{color:var(--accent);font-size:12px}.dictionary-sense p{white-space:pre-line;margin:4px 0}.dictionary-sense .english,.dictionary-sense .example{font-size:12px;color:var(--muted)}
      #dictionary details{font-size:12px;margin-top:12px}#dictionary summary{color:var(--muted);cursor:pointer;width:fit-content}#dictionary summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
      #dictionary-forms,#dictionary-origin{font-size:12px;color:var(--muted);margin-top:10px}#dictionary-enrich,#dictionary-retry{font-size:12px;margin-top:12px}#dictionary-source{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-top:8px}
    </style><div class="dictionary-head"><div id="dictionary-word"></div><div class="pronunciation-buttons"><button id="pronounce-uk" disabled aria-label="播放英式发音">▶ 英式</button><button id="pronounce-us" disabled aria-label="播放美式发音">▶ 美式</button></div></div><div id="dictionary-form" hidden></div>
    <div id="dictionary-phonetics"><span id="phonetic-uk" hidden></span><span id="phonetic-us" hidden></span></div>
    <div id="phonetic-reference" hidden><span id="phonetic-reference-label"></span><span id="phonetic-reference-value"></span></div><div id="pronunciation-status"></div>
    <div id="dictionary-status" role="status" aria-live="polite"></div><button id="dictionary-retry" hidden>重试词典查询</button>
    <div id="dictionary-meanings"></div><div id="dictionary-forms" hidden></div><div id="dictionary-origin" hidden></div><button id="dictionary-enrich" hidden>更多释义与例句</button><details id="dictionary-attribution" hidden><summary>词库来源与许可</summary><div id="dictionary-source"></div></details>`;
    popup.querySelector(".actions").before(panel);
    const $ = id => shadow.getElementById(id);
    const posNames = { noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", pronoun: "代词", preposition: "介词", conjunction: "连词", interjection: "感叹词", exclamation: "感叹词", determiner: "限定词" };
    const translations = new Map();
    let cacheVersion = 0;
    twpConfig.onChanged(() => { cacheVersion++; translations.clear(); });
    async function translateCached(texts) {
      const key = JSON.stringify([pageTranslator.getService(), twpConfig.get("targetLanguage"), texts]);
      const hit = translations.get(key);
      if (hit) return hit;
      const current = cacheVersion;
      const values = await translate(texts);
      if (current === cacheVersion) translations.set(key, values);
      if (translations.size > 100) translations.delete(translations.keys().next().value);
      return values;
    }
    let version = 0, requestId = null, selected = "", utterance = null, lookupTimer, resolveLookup;
    function send(request, callback = () => {}) {
      try { chrome.runtime.sendMessage(request, response => callback(response, chrome.runtime.lastError)); }
      catch { callback(undefined, { message: "Extension context invalidated" }); }
    }
    function cancelLookup() {
      if (requestId) send({ action: "cancelDictionary", requestId });
      requestId = null; clearTimeout(lookupTimer); cancel();
      resolveLookup?.({ status: "cancelled" }); resolveLookup = null;
      if (utterance) { window.speechSynthesis?.cancel(); utterance = null; }
    }
    function close() {
      version++; cancelLookup(); panel.hidden = true; popup.dataset.word = "false";
    }
    function voiceFor(locale) {
      return window.speechSynthesis?.getVoices().find(voice => voice.lang.toLowerCase().replace(/_/g, "-") === locale.toLowerCase());
    }
    function updateVoices() {
      for (const [accent, locale] of [["uk", "en-GB"], ["us", "en-US"]]) {
        const voice = voiceFor(locale);
        $(`pronounce-${accent}`).disabled = !voice;
        $(`pronounce-${accent}`).title = voice ? `浏览器${accent === "uk" ? "英式" : "美式"}朗读：${voice.name}` : `当前浏览器未提供${accent === "uk" ? "英式" : "美式"}语音`;
      }
      $("pronunciation-status").textContent = voiceFor("en-GB") || voiceFor("en-US")
        ? "" : "当前浏览器暂无英语语音，需安装英语语音包";
    }
    function speak(locale) {
      const voice = voiceFor(locale);
      if (!voice || panel.hidden || popup.hidden) return;
      window.speechSynthesis.cancel();
      const current = new SpeechSynthesisUtterance(selected);
      utterance = current; current.voice = voice; current.lang = locale; current.rate = .85;
      current.onerror = () => {
        if (utterance !== current) return;
        $("pronunciation-status").textContent = "发音播放失败，请检查浏览器语音设置"; utterance = null;
      };
      current.onend = () => { if (utterance === current) utterance = null; };
      window.speechSynthesis.speak(current);
    }
    function query(word, id, enrich = false) {
      return new Promise(resolve => {
        const finish = response => {
          clearTimeout(timer);
          if (resolveLookup === finish) resolveLookup = null;
          resolve(response);
        };
        resolveLookup = finish;
        lookupTimer = setTimeout(() => {
          send({ action: "cancelDictionary", requestId: id });
          finish({ status: "error", error: "词典查询超时，请稍后重试" });
        }, 12000);
        const timer = lookupTimer;
        send({ action: "lookupDictionary", word, requestId: id, enrich }, (response, error) => {
          clearTimeout(timer);
          finish(error ? { status: "error", error: "词典查询失败，请重新加载扩展" } : response);
        });
      });
    }
    function addLink(label, url) {
      if (!label || !url) return;
      try {
        if (new URL(url).protocol !== "https:") return;
        const link = document.createElement("a"); link.textContent = label; link.href = url;
        link.target = "_blank"; link.rel = "noopener noreferrer"; $("dictionary-source").append(link);
      } catch { /* Ignore invalid provider links. */ }
    }
    const chinese = () => /^(zh|zh-cn|zh-hans)$/i.test(twpConfig.get("targetLanguage"));
    function localTranslation(text) {
      if (!chinese()) return Promise.resolve(null);
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 2000);
        send({ action: "lookupLocalDictionary", word: text }, (reply, error) => {
          clearTimeout(timer);
          const translation = !error && reply?.status === "ok" ? reply.entry?.meanings?.map(sense => sense.translation).filter(Boolean).join("\n") : "";
          resolve(translation || null);
        });
      });
    }
    async function show(text, enrich = false) {
      if (enrich) { version++; cancelLookup(); } else close();
      selected = text.trim().replace(/[‘’]/g, "'");
      if (!/^[a-z]+(?:[' -][a-z]+)*$/i.test(selected) || selected.length > 80 || selected.split(" ").length > 5) return;
      const current = version;
      const valid = () => version === current && !popup.hidden;
      panel.hidden = false; popup.dataset.word = "true";
      if (!enrich) {
        $("dictionary-word").textContent = selected;
        for (const id of ["dictionary-form", "phonetic-reference", "dictionary-origin", "dictionary-retry", "dictionary-forms", "dictionary-enrich"]) $(id).hidden = true;
        $("dictionary-meanings").replaceChildren(); $("dictionary-source").replaceChildren();
        $("phonetic-uk").textContent = $("phonetic-us").textContent = "";
        $("phonetic-uk").hidden = $("phonetic-us").hidden = $("dictionary-phonetics").hidden = true;
        $("dictionary-attribution").hidden = true; $("dictionary-attribution").open = false;
      }
      $("dictionary-enrich").disabled = true;
      $("dictionary-status").textContent = enrich ? "正在补充在线信息，离线释义可继续阅读…" : "正在查询词典…"; updateVoices(); reposition();
      const id = crypto.randomUUID(); requestId = id;
      const reply = await query(selected, id, enrich);
      if (!valid()) return;
      requestId = null;
      $("dictionary-enrich").disabled = false;
      if (reply?.status !== "ok" || !reply.entry?.meanings?.length) {
        $("dictionary-status").textContent = reply?.status === "not-found" ? "词典暂无收录，仍可使用上方译文。" : reply?.error || "词典暂时不可用，仍可使用上方译文。";
        $("dictionary-retry").hidden = false; reposition(); return;
      }
      const entry = reply.entry;
      $("dictionary-meanings").replaceChildren(); $("dictionary-source").replaceChildren();
      for (const id of ["dictionary-form", "phonetic-reference", "dictionary-origin", "dictionary-retry", "dictionary-forms"]) $(id).hidden = true;
      $("dictionary-enrich").hidden = !["offline", "mixed"].includes(entry.provider);
      if (entry.word.toLowerCase() !== selected.toLowerCase()) {
        $("dictionary-form").textContent = `词典词形：${entry.word}`; $("dictionary-form").hidden = false;
      }
      for (const accent of ["uk", "us"]) {
        $(`phonetic-${accent}`).textContent = entry.phonetics[accent] || "";
        $(`phonetic-${accent}`).hidden = !entry.phonetics[accent];
      }
      $("dictionary-phonetics").hidden = !entry.phonetics.uk && !entry.phonetics.us;
      if (entry.phonetics.reference?.length) {
        const related = entry.phonetics.referenceWord;
        const label = related ? `${entry.phonetics.referenceIsLemma ? "原形" : "词形候选"} ${related} 的参考音标` : "参考音标";
        $("phonetic-reference-label").textContent = `${label}（未标明口音）：`;
        $("phonetic-reference-value").textContent = entry.phonetics.reference.join(" · "); $("phonetic-reference").hidden = false;
      } else if (!entry.phonetics.uk && !entry.phonetics.us) {
        $("phonetic-reference-label").textContent = "暂无音标"; $("phonetic-reference-value").textContent = ""; $("phonetic-reference").hidden = false;
      }
      const texts = [], nodes = [], examples = [], exampleNodes = [];
      for (const sense of entry.meanings) {
        const card = document.createElement("div"); card.className = "dictionary-sense";
        const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = posNames[sense.partOfSpeech] || sense.partOfSpeech;
        const definition = document.createElement("p"); definition.className = "english"; definition.textContent = sense.definition;
        const localized = document.createElement("p");
        const duplicate = sense.translation && chinese() && ["offline", "mixed"].includes(entry.provider);
        pos.hidden = !pos.textContent; card.append(localized);
        if (duplicate) {
          localized.hidden = true;
          if (sense.definition) {
            const details = document.createElement("details"), summary = document.createElement("summary");
            summary.textContent = "英文释义"; details.append(summary, pos, definition); card.append(details);
            details.ontoggle = () => reposition();
          }
        } else { card.prepend(pos); card.append(definition); }
        if (sense.translation && chinese() && !duplicate) localized.textContent = sense.translation;
        else if (duplicate) { /* Local Chinese is already shown in the main translation. */ }
        else if (!(sense.definition && twpConfig.get("targetLanguage").startsWith("en"))) {
          nodes.push(localized); texts.push(sense.definition || sense.translation);
        }
        if (sense.example) {
          const example = document.createElement("p"); example.className = "example"; example.textContent = `例句：${sense.example}`; card.append(example);
          const localizedExample = document.createElement("p"); card.append(localizedExample); exampleNodes.push(localizedExample); examples.push(sense.example);
        }
        if (sense.synonyms?.length) { const synonyms = document.createElement("p"); synonyms.className = "english"; synonyms.textContent = `近义词：${sense.synonyms.join("、")}`; card.append(synonyms); }
        if (sense.definition || !duplicate || sense.example || sense.synonyms?.length) $("dictionary-meanings").append(card);
      }
      if (entry.forms?.length) {
        const names = { "0": "原形", p: "过去式", d: "过去分词", i: "现在分词", "3": "第三人称单数", s: "复数", r: "比较级", t: "最高级" };
        $("dictionary-forms").textContent = entry.forms.map(form => { const [type, value] = form.split(":"); return names[type] && value ? `${names[type]}：${value}` : ""; }).filter(Boolean).join(" · ");
        $("dictionary-forms").hidden = !$("dictionary-forms").textContent;
      }
      if (entry.origin) { $("dictionary-origin").textContent = `词源：${entry.origin}`; $("dictionary-origin").hidden = false; }
      addLink(entry.provider ? "ECDICT 完整离线词库" : "词典来源", entry.source); addLink(entry.license?.name, entry.license?.url);
      addLink("在线词典来源", entry.onlineSource); addLink(entry.onlineLicense?.name, entry.onlineLicense?.url);
      $("dictionary-attribution").hidden = !$("dictionary-source").children.length; reposition();
      const completeStatus = reply.notice || "";
      if (!texts.length && !examples.length) { $("dictionary-status").textContent = completeStatus; return; }
      if (!texts.length && twpConfig.get("targetLanguage").startsWith("en")) { $("dictionary-status").textContent = completeStatus || "英文释义"; return; }
      let exampleButton;
      if (examples.length) {
        exampleButton = document.createElement("button"); exampleButton.id = "dictionary-translate-examples"; exampleButton.textContent = "翻译例句";
        $("dictionary-meanings").append(exampleButton);
        exampleButton.disabled = true;
        exampleButton.onclick = async () => {
          exampleButton.disabled = true; exampleButton.textContent = "正在翻译例句…";
          try {
            const values = await translateCached(examples);
            if (!valid()) return;
            exampleNodes.forEach((node, index) => { node.textContent = values[index]; });
            exampleButton.remove();
          } catch {
            if (!valid()) return;
            exampleButton.disabled = false; exampleButton.textContent = "例句翻译失败，点击重试";
          }
          reposition();
        };
      }
      $("dictionary-status").textContent = "正在翻译释义…";
      try {
        const values = texts.length ? await translateCached(texts) : [];
        if (!valid()) return;
        nodes.forEach((node, index) => { node.textContent = values[index]; });
        $("dictionary-status").textContent = completeStatus;
      } catch {
        if (!valid()) return;
        $("dictionary-status").textContent = "释义翻译暂不可用，可先阅读英文释义。";
      }
      if (exampleButton && valid()) exampleButton.disabled = false;
      reposition();
    }
    $("pronounce-uk").onclick = () => speak("en-GB");
    $("pronounce-us").onclick = () => speak("en-US");
    $("dictionary-retry").onclick = () => void show(selected);
    $("dictionary-enrich").onclick = () => void show(selected, true);
    $("dictionary-attribution").ontoggle = () => reposition();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoices);
    return { show, close, localTranslation };
  }
  return { create };
})();
