"use strict";

// Public dictionary data stays in browser-session memory; page text and surrounding paragraphs
// are never sent to the dictionary. Translation uses the existing provider.
const twpDictionary = (() => {
  const cache = new Map();
  const requests = new Map();
  const cacheKey = "selectionDictionaryCache:v2";
  const session = chrome.storage?.session;
  const lifetime = 86400000;
  let writes = Promise.resolve();
  const ready = session ? (async () => {
    try {
      const saved = (await session.get(cacheKey))[cacheKey];
      for (const [key, hit] of (Array.isArray(saved) ? saved : []).slice(-100)) {
        if (word(key) === key && hit?.entry?.meanings?.length && Date.now() - hit.time < lifetime) cache.set(key, hit);
      }
    } catch { /* Session storage is optional; lookups still work without it. */ }
  })() : null;
  async function remember(key, entry) {
    cache.delete(key); cache.set(key, { time: Date.now(), entry });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    if (session) {
      writes = writes.then(() => session.set({ [cacheKey]: [...cache] })).catch(() => {});
      await writes;
    }
  }
  const clean = (value, limit = 1500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
  function word(value) {
    const text = clean(value, 100).replace(/[‘’]/g, "'").toLowerCase();
    return /^[a-z]+(?:[' -][a-z]+)*$/.test(text) && text.length <= 80 && text.split(" ").length <= 5 ? text : "";
  }
  function candidates(text) {
    const values = [text];
    if (text.endsWith("ies")) values.push(text.slice(0, -3) + "y");
    if (text.endsWith("s") && !/(ss|us|is)$/.test(text)) values.push(text.slice(0, -1));
    if (text.endsWith("es")) values.push(text.slice(0, -2));
    return [...new Set(values)].filter(value => value.length > 1 || value === text).slice(0, 4);
  }
  function safeURL(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; }
    catch { return ""; }
  }
  function normalize(data, selected) {
    if (!Array.isArray(data) || !data.length) throw new Error("词典返回格式异常");
    const phonetics = { uk: "", us: "", reference: [] };
    const meanings = [];
    for (const entry of data.slice(0, 3)) {
      for (const item of Array.isArray(entry.phonetics) ? entry.phonetics : []) {
        const text = clean(item.text, 160);
        if (!text) continue;
        // Do not infer an accent from IPA itself. Region labels come only from
        // the provider's explicitly named pronunciation recording.
        const region = clean(item.audio, 1000).match(/(?:-|_)(us|uk|gb)(?:[-_.])/i)?.[1]?.toLowerCase();
        if (region) phonetics[region === "us" ? "us" : "uk"] ||= text;
        else if (!phonetics.reference.includes(text)) phonetics.reference.push(text);
      }
      if (entry.phonetic && !phonetics.reference.includes(entry.phonetic)) phonetics.reference.push(clean(entry.phonetic, 160));
      for (const meaning of Array.isArray(entry.meanings) ? entry.meanings : []) {
        for (const sense of (Array.isArray(meaning.definitions) ? meaning.definitions : []).slice(0, 2)) {
          const definition = clean(sense.definition);
          if (!definition || meanings.some(item => item.definition === definition) || meanings.length >= 4) continue;
          meanings.push({ partOfSpeech: clean(meaning.partOfSpeech, 40), definition,
            example: clean(sense.example), synonyms: [...new Set([...(sense.synonyms || []), ...(meaning.synonyms || [])])]
              .filter(value => typeof value === "string").slice(0, 5).map(value => clean(value, 80)) });
        }
      }
    }
    phonetics.reference = phonetics.reference.filter(text => text && ![phonetics.uk, phonetics.us].includes(text)).slice(0, 2);
    if (!meanings.length) throw new Error("词典暂无释义");
    const entry = data[0];
    return { selected, word: clean(entry.word, 80) || selected, phonetics, meanings, origin: clean(entry.origin),
      source: safeURL(entry.sourceUrls?.[0]) || "https://dictionaryapi.dev/",
      license: { name: clean(entry.license?.name, 80), url: safeURL(entry.license?.url) } };
  }
  async function lookup(value, signal) {
    const selected = word(value);
    if (!selected) return { status: "unsupported" };
    if (ready) await ready;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const hit = cache.get(selected);
    if (hit && Date.now() - hit.time < lifetime) return { status: "ok", entry: hit.entry };
    for (const candidate of candidates(selected)) {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(candidate)}`,
        { signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error("词典暂时不可用，请稍后重试");
      const entry = normalize(await response.json(), selected);
      await remember(selected, entry);
      return { status: "ok", entry };
    }
    return { status: "not-found" };
  }
  async function local(value, signal) {
    const selected = word(value);
    if (!selected) return { status: "unsupported" };
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const reply = await twpOfflineDictionary.lookup(selected, candidates(selected));
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return reply;
  }
  async function preferred(value, signal, enrich = false) {
    let offline;
    try { offline = await local(value, signal); }
    catch (error) { if (signal?.aborted) throw error; }
    if (offline?.status === "ok" && !enrich) return offline;
    try {
      const online = await lookup(value, signal);
      if (offline?.status !== "ok") return online;
      if (online.status !== "ok") return { ...offline, notice: "在线词典暂无收录，保留离线释义。" };
      return { status: "ok", entry: { ...offline.entry, provider: "mixed", word: online.entry.word,
        phonetics: online.entry.phonetics, meanings: [...offline.entry.meanings, ...online.entry.meanings],
        origin: online.entry.origin, onlineSource: online.entry.source, onlineLicense: online.entry.license } };
    } catch (error) {
      if (offline?.status === "ok") return { ...offline, notice: "在线补充暂不可用，保留离线释义。" };
      throw error;
    }
  }
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "lookupLocalDictionary") {
      local(request.word).then(sendResponse, error => sendResponse({ status: "error", error: error.message }));
      return true;
    }
    if (!["lookupDictionary", "cancelDictionary"].includes(request.action)) return;
    const key = `${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}`;
    if (request.action === "cancelDictionary") {
      const pending = requests.get(key);
      if (pending?.id === request.requestId) pending.controller.abort();
      sendResponse();
      return;
    }
    requests.get(key)?.controller.abort();
    const controller = new AbortController();
    const pending = { id: request.requestId, controller };
    requests.set(key, pending);
    const timer = setTimeout(() => controller.abort(), 10000);
    preferred(request.word, controller.signal, request.enrich === true).then(sendResponse, error => sendResponse({ status: "error",
      error: error.name === "AbortError" ? "词典查询超时或已取消" : error.message })).finally(() => {
      clearTimeout(timer);
      if (requests.get(key) === pending) requests.delete(key);
    });
    return true;
  });
  return { lookup: preferred, online: lookup, local, word };
})();
