"use strict";

// The complete ECDICT is packaged as 256 data shards, never executable code.
// Loading at most six shards bounds memory without a startup database import.
const twpOfflineDictionary = (() => {
  const shards = new Map();
  const source = "https://github.com/skywind3000/ECDICT";
  const text = value => typeof value === "string" ? value.replace(/\\n/g, "\n").trim() : "";
  function bucket(word) {
    let value = 2166136261;
    for (let i = 0; i < word.length; i++) value = Math.imul(value ^ word.charCodeAt(i), 16777619) >>> 0;
    return (value & 255).toString(16).padStart(2, "0");
  }
  async function rows(word) {
    const name = bucket(word);
    let pending = shards.get(name);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(chrome.runtime.getURL(`data/dictionary/${name}.json`));
        if (!response.ok) throw new Error("离线词库加载失败，请重新加载扩展");
        return response.json();
      })();
      pending.catch(() => { if (shards.get(name) === pending) shards.delete(name); });
    }
    shards.delete(name); shards.set(name, pending);
    if (shards.size > 6) shards.delete(shards.keys().next().value);
    const data = await pending;
    return Object.prototype.hasOwnProperty.call(data, word) ? data[word] : [];
  }
  async function lookup(selected, candidates = [selected]) {
    for (const candidate of candidates) {
      const found = await rows(candidate);
      if (!found.length) continue;
      const meanings = found.filter(row => row[2] || row[3]).map(row => ({ partOfSpeech: "", definition: text(row[2]), translation: text(row[3]), example: "", synonyms: [] }));
      if (!meanings.length) continue;
      const row = found[0];
      const forms = [...new Set(found.flatMap(item => text(item[10]).split("/").filter(Boolean)))];
      const phonetics = { uk: "", us: "", reference: [...new Set(found.map(item => text(item[1])).filter(Boolean))] };
      if (!phonetics.reference.length) {
        const lemmas = forms.filter(form => form.startsWith("0:")).map(form => form.slice(2).toLowerCase());
        for (const base of [...new Set([...lemmas, ...candidates])].filter(value => value !== candidate).slice(0, 3)) {
          const related = await rows(base);
          const reference = [...new Set(related.map(item => text(item[1])).filter(Boolean))];
          if (!reference.length) continue;
          // Keep the queried entry and identify whose pronunciation this is.
          // A lemma's IPA is not the inflected word's IPA; no accent is guessed.
          phonetics.reference = reference;
          phonetics.referenceWord = related[0][0];
          phonetics.referenceIsLemma = lemmas.includes(base);
          break;
        }
      }
      return { status: "ok", entry: { selected, word: row[0], provider: "offline", phonetics,
        meanings, forms, origin: "", source, license: { name: "ECDICT · MIT", url: `${source}/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE` } } };
    }
    return { status: "not-found" };
  }
  return { lookup, bucket };
})();
