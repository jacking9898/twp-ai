const {test} = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../src/lib/builtinPresets.js");
const presets = require("../src/lib/aiPresets.js");
const inventory = require("../docs/preset-inventory.json");

test("reference expert categories remain complete alongside the three local experts", () => {
  assert.equal(catalog.experts.length, 41);
  assert.equal(presets.experts.length, 44);
  assert.equal(new Set(presets.experts.map(item => item.id)).size, 44);
  assert.deepEqual(catalog.experts.map(item => item.id).sort(), [...inventory.referenceExpertIds].sort());
  for (const expert of catalog.experts) {
    assert.ok(expert.prompt.length >= 300 && expert.prompt.length <= 6000, expert.id);
    assert.equal(expert.license, "MPL-2.0");
  }
  for (const id of ["public-game","public-steam","public-valorant-esports","public-chess"]) {
    assert.ok(catalog.experts.some(item => item.id === id), "Only game glossaries are retired: " + id);
  }
});

test("glossaries preserve reference coverage and record deliberate extensions separately", () => {
  assert.equal(catalog.glossaries.length, 31);
  assert.equal(presets.glossaries.length, 32); // Includes the personal-default slot.
  assert.equal(new Set(catalog.glossaries.map(item => item.id)).size, 31);
  const expectedCatalog = new Map([...inventory.retainedGlossaries, ...inventory.extendedGlossaries, ...inventory.additionalGlossaries].map(item => [item.id, item]));
  assert.deepEqual(catalog.glossaries.map(item => item.id).sort(), [...expectedCatalog.keys()].sort());
  let total = 0;
  for (const expected of expectedCatalog.values()) {
    const library = catalog.glossaries.find(item => item.id === expected.id);
    assert.equal(library.name, expected.name);
    assert.deepEqual(Object.keys(library.translations).sort(), Object.keys(expected.languages).sort());
    for (const [lang, count] of Object.entries(expected.languages)) {
      const entries = library.translations[lang];
      assert.equal(entries.length, count, `${library.id} ${lang}`);
      assert.equal(new Set(entries.map(([source]) => source)).size, count, "No duplicated headwords to pad counts");
      for (const entry of entries) {
        assert.equal(entry.length, 2);
        for (const value of entry) assert.ok(typeof value === "string" && value.trim() === value && value.length > 0, `${library.id}: ${entry}`);
      }
      total += count;
    }
  }
  assert.equal(total, 3634);
  assert.equal(total, inventory.glossaryRowsByLanguage);
  assert.equal(inventory.referenceGlossaryRowsByLanguage, 3120);
});

test("computer science retains the old identifier and terms; LLM / AI is an independent library", () => {
  const computing = presets.glossaries.find(item => item.id === "public-access-control");
  assert.equal(computing.name, "计算机科学");
  assert.equal(presets.normalizeGlossaryId(computing.id), computing.id);
  assert.deepEqual(computing.entries.slice(0,8), [["AccessControl","访问控制"],["Authorization","授权"],["Authentication","认证"],["ACP","访问控制策略"],["ACL","访问控制列表"],["RBAC","基于角色的访问控制"],["ABAC","基于属性的访问控制"],["ReBAC","基于关系的访问控制"]]);
  for (const [id, count] of [[computing.id,125],["builtin-llm-ai",136]]) {
    const library = presets.glossaries.find(item => item.id === id);
    for (const rows of Object.values(library.translations)) {
      assert.equal(rows.length, count);
      assert.equal(new Set(rows.map(([source]) => source.toLowerCase())).size, count);
    }
    assert.deepEqual(library.translations["zh-CN"].map(([source]) => source), library.translations["zh-TW"].map(([source]) => source));
  }
  const llm = presets.glossaries.find(item => item.id === "builtin-llm-ai");
  assert.equal(llm.name, "LLM / AI");
  assert.equal(llm.license, "MPL-2.0");
});

test("game collections are absent; non-game collections and personal overrides remain available", () => {
  for (const id of inventory.removedGlossaryIds) {
    assert.ok(!presets.glossaries.some(item => item.id === id));
    assert.equal(presets.normalizeGlossaryId(id), "public-default");
  }
  for (const id of ["public-chess","public-sports","public-golf","public-tennis","public-programming-contest","public-Vocaloid"]) {
    assert.ok(presets.glossaries.some(item => item.id === id));
    assert.equal(presets.normalizeGlossaryId(id), id);
  }
  const custom = {id:"custom-mine",name:"我的术语",entries:[["term","译法"]]};
  assert.deepEqual(presets.allGlossaries([custom]).at(-1), custom);
});
