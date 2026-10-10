const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("src/background/dictionary.js", "utf8");
const entry = [{ word: "homeomorphism", phonetics: [
  { text: "/UK/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/homeomorphism-uk.mp3" },
  { text: "/US/", audio: "https://example.test/homeomorphism--_us_1.mp3" },
  { text: "/unknown/", audio: "" }], meanings: [{ partOfSpeech: "noun", definitions: [
    { definition: "A continuous bijection with a continuous inverse.", example: "This map is a homeomorphism.", synonyms: ["map"] }], synonyms: [] }],
  sourceUrls: ["https://en.wiktionary.org/wiki/homeomorphism"], license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" } }];
function setup(fetch, session, offline = { lookup: async () => ({ status: "not-found" }) }) {
  let listener;
  const context = vm.createContext({ URL, fetch, AbortController, DOMException, setTimeout, clearTimeout, twpOfflineDictionary: offline,
    chrome: { storage: { session }, runtime: { onMessage: { addListener: value => { listener = value; } } } } });
  vm.runInContext(source, context);
  return { dictionary: vm.runInContext("twpDictionary", context),
    request: (message, sender = { tab: { id: 1 }, frameId: 0 }) => new Promise(resolve => listener(message, sender, resolve)) };
}
test("plural lookup falls back to a dictionary headword and caches normalized results", async () => {
  const calls = [];
  const app = setup(async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("homeomorphisms") ? { status: 404 } : { ok: true, json: async () => entry };
  });
  const result = await app.dictionary.lookup("Homeomorphisms");
  assert.equal(result.status, "ok");
  assert.equal(result.entry.selected, "homeomorphisms");
  assert.equal(result.entry.word, "homeomorphism");
  assert.equal(result.entry.phonetics.uk, "/UK/");
  assert.equal(result.entry.phonetics.us, "/US/");
  assert.equal(result.entry.phonetics.reference[0], "/unknown/");
  assert.equal(result.entry.meanings[0].example, "This map is a homeomorphism.");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  await app.dictionary.lookup("HOMEOMORPHISMS"); assert.equal(calls.length, 2);
});
test("unlabelled IPA is not guessed as an American or British pronunciation", async () => {
  const data = [{ ...entry[0], phonetics: [{ text: "/həˈloʊ/", audio: "" }] }];
  const app = setup(async () => ({ ok: true, json: async () => data }));
  const result = await app.dictionary.lookup("hello");
  assert.equal(result.entry.phonetics.us, ""); assert.equal(result.entry.phonetics.uk, "");
  assert.equal(result.entry.phonetics.reference[0], "/həˈloʊ/");
});
test("sentences, URLs and invalid selections never reach the dictionary", async () => {
  let calls = 0;
  const app = setup(async () => { calls++; throw new Error("Unexpected fetch"); });
  for (const value of ["this selection contains more than five words", "https://example.test", "<sup>1</sup>", "同胚", "a".repeat(81)]) {
    assert.equal((await app.dictionary.lookup(value)).status, "unsupported");
  }
  assert.equal(calls, 0);
});
test("404 results remain distinct from service and malformed-response failures", async () => {
  assert.equal((await setup(async () => ({ status: 404 })).dictionary.lookup("missingword")).status, "not-found");
  await assert.rejects(setup(async () => ({ status: 503 })).dictionary.lookup("hello"), /暂时不可用/);
  await assert.rejects(setup(async () => ({ ok: true, json: async () => ({ error: true }) })).dictionary.lookup("hello"), /格式异常/);
});
test("cancellation is scoped to a frame and stale cancellation cannot abort a new word", async () => {
  const pending = [];
  const app = setup((url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ url, signal, resolve });
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));
  const old = app.request({ action: "lookupDictionary", word: "oldword", requestId: "old" });
  await new Promise(setImmediate);
  const other = app.request({ action: "lookupDictionary", word: "otherword", requestId: "other" }, { tab: { id: 2 }, frameId: 0 });
  await new Promise(setImmediate);
  const current = app.request({ action: "lookupDictionary", word: "newword", requestId: "new" });
  await new Promise(setImmediate);
  assert.equal(pending[0].signal.aborted, true); assert.equal(pending[1].signal.aborted, false);
  await app.request({ action: "cancelDictionary", requestId: "old" });
  assert.equal(pending[2].signal.aborted, false);
  await app.request({ action: "cancelDictionary", requestId: "new" });
  assert.equal(pending[2].signal.aborted, true);
  pending[1].resolve({ ok: true, json: async () => entry });
  assert.equal((await old).status, "error"); assert.equal((await current).status, "error"); assert.equal((await other).status, "ok");
});
test("dictionary links cannot retain executable protocols", async () => {
  const data = [{ ...entry[0], sourceUrls: ["javascript:alert(1)"], license: { name: "bad", url: "data:text/html,bad" } }];
  const result = await setup(async () => ({ ok: true, json: async () => data })).dictionary.lookup("hello");
  assert.equal(result.entry.source, "https://dictionaryapi.dev/"); assert.equal(result.entry.license.url, "");
});

test("session cache survives a background restart and expires after a day", async () => {
  const saved = {}; let calls = 0;
  const session = { get: async () => saved, set: async values => Object.assign(saved, structuredClone(values)) };
  const fetch = async () => { calls++; return { ok: true, json: async () => entry }; };
  await setup(fetch, session).dictionary.lookup("hello");
  await setup(fetch, session).dictionary.lookup("hello");
  assert.equal(calls, 1);
  saved["selectionDictionaryCache:v2"][0][1].time = Date.now() - 86400001;
  await setup(fetch, session).dictionary.lookup("hello");
  assert.equal(calls, 2);
});

test("unavailable session storage falls back to memory without failing lookup", async () => {
  const session = { get: async () => { throw Error("unavailable"); }, set: async () => { throw Error("quota"); } };
  let calls = 0;
  const app = setup(async () => { calls++; return { ok: true, json: async () => entry }; }, session);
  assert.equal((await app.dictionary.lookup("hello")).status, "ok");
  await app.dictionary.lookup("hello"); assert.equal(calls, 1);
});

test("cancellation during cache restoration does not issue a network request", async () => {
  let restore;
  const session = { get: () => new Promise(resolve => { restore = resolve; }) };
  const controller = new AbortController();
  const app = setup(() => { throw Error("Unexpected fetch"); }, session);
  const request = app.dictionary.online("hello", controller.signal);
  controller.abort(); restore({});
  await assert.rejects(request, { name: "AbortError" });
});

test("offline matches avoid all public requests and online enrichment retains local Chinese", async () => {
  const local = { status: "ok", entry: { provider: "offline", word: "homeomorphism", meanings: [{ translation: "同胚", definition: "" }], phonetics: { uk: "", us: "", reference: [] } } };
  let calls = 0;
  const app = setup(async () => { calls++; return { ok: true, json: async () => entry }; }, undefined, { lookup: async () => local });
  assert.equal((await app.dictionary.lookup("homeomorphism")).entry.provider, "offline");
  assert.equal(calls, 0);
  const enriched = await app.request({ action: "lookupDictionary", word: "homeomorphism", requestId: "enrich", enrich: true });
  assert.equal(enriched.entry.provider, "mixed"); assert.equal(enriched.entry.meanings[0].translation, "同胚");
  assert.equal(enriched.entry.phonetics.uk, "/UK/"); assert.equal(calls, 1);
  const failed = setup(async () => { throw Error("Network offline"); }, undefined, { lookup: async () => local });
  assert.equal((await failed.request({ action: "lookupDictionary", word: "homeomorphism", enrich: true })).entry.provider, "offline");
});
