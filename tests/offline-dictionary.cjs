const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createHash } = require("node:crypto");
const manifest = JSON.parse(fs.readFileSync("src/data/dictionary/manifest.json", "utf8"));
function setup() {
  const calls = [];
  const context = vm.createContext({ chrome: { runtime: { getURL: name => "extension://" + name } }, fetch: async url => {
    assert.ok(url.startsWith("extension://data/dictionary/"), "Offline lookup must never access a public host");
    calls.push(url);
    return { ok: true, json: async () => JSON.parse(await fs.promises.readFile(path.join("src", url.slice("extension://".length)), "utf8")) };
  } });
  vm.runInContext(fs.readFileSync("src/background/offlineDictionary.js", "utf8"), context);
  return { dictionary: vm.runInContext("twpOfflineDictionary", context), calls };
}
test("all complete-library shards match recorded checksums, row count and source metadata", () => {
  let rows = 0, keys = 0;
  for (const [name, expected] of Object.entries(manifest.shards)) {
    const bytes = fs.readFileSync("src/data/dictionary/" + name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
    const data = JSON.parse(bytes); keys += Object.keys(data).length;
    for (const records of Object.values(data)) {
      for (const record of records) assert.equal(record.length, 13);
      rows += records.length;
    }
  }
  assert.equal(rows, 3402564); assert.equal(keys, manifest.stats.keys);
  assert.equal(manifest.stats.rows, rows); assert.equal(Object.keys(manifest.shards).length, 256);
});
test("real technical words, Chinese definitions and inflections resolve locally and cache shards", async () => {
  const { dictionary, calls } = setup();
  const result = await dictionary.lookup("homeomorphism");
  assert.equal(result.entry.provider, "offline"); assert.match(result.entry.meanings[0].translation, /同胚/);
  assert.ok(result.entry.phonetics.reference.length);
  await dictionary.lookup("homeomorphism"); assert.equal(calls.length, 1);
  assert.match((await dictionary.lookup("topology")).entry.meanings[0].translation, /拓扑/);
  assert.match((await dictionary.lookup("gave")).entry.forms.join("/"), /0:give/);
  assert.equal((await dictionary.lookup("qqzznotawordzz")).status, "not-found");
});
test("concurrent lookups share one shard read", async () => {
  const { dictionary, calls } = setup();
  await Promise.all([dictionary.lookup("hello"), dictionary.lookup("hello")]);
  assert.equal(calls.length, 1);
});

test("a plural entry missing IPA shows the base entry's IPA with explicit attribution", async () => {
  const { dictionary } = setup();
  const result = await dictionary.lookup("homeomorphisms", ["homeomorphisms", "homeomorphism"]);
  assert.equal(result.entry.word, "homeomorphisms");
  assert.match(result.entry.meanings[0].translation, /同胚/);
  assert.equal(result.entry.phonetics.referenceWord, "homeomorphism");
  assert.ok(result.entry.phonetics.reference.length);
  assert.equal(result.entry.phonetics.uk, ""); assert.equal(result.entry.phonetics.us, "");
});
