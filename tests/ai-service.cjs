const { test } = require("node:test");
const assert = require("node:assert/strict");
// Exercise pure validation without extension APIs, storage, or a model account.
globalThis.indexedDB = { open: () => ({}) };
globalThis.chrome = { runtime: { onMessage: { addListener() {} } }, tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } } };
globalThis.twpConfig = { onReady: () => new Promise(() => {}), onChanged() {} };
const service = import("../extension/ai-service.js");
test('ordinary official DeepSeek translation disables default thinking without leaking vendor options to other providers', async () => {
  const {translationProviderOptions, paragraphCacheIdentity} = await service;
  for (const model of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp','deepseek-v4-pro']) {
    assert.deepEqual(translationProviderOptions({baseURL:'https://api.deepseek.com/v1',model}), {twp:{thinking:{type:'disabled'}}});
  }
  for (const profile of [{baseURL:'https://other.example',model:'deepseek-flash'}, {baseURL:'https://api.deepseek.com.evil.example',model:'deepseek-flash'}, {baseURL:'https://api.deepseek.com',model:'deepseek-reasoner'}, {baseURL:'bad',model:'deepseek-flash'}]) assert.equal(translationProviderOptions(profile), undefined);
  const profile = {id:'one',updated:1,baseURL:'https://api.deepseek.com',model:'deepseek-flash'};
  assert.notEqual(paragraphCacheIdentity(profile,{},'instructions','text'),paragraphCacheIdentity({...profile,baseURL:'https://other.example'}, {}, 'instructions','text'));
});
test('the installed compatible SDK serializes DeepSeek thinking control into the request body', async () => {
  const {translationProviderOptions} = await service;
  const {generateText} = await import('ai');
  const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
  let body;
  const provider = createOpenAICompatible({name:'twp',baseURL:'https://api.deepseek.com',fetch:async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'translated'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
  }});
  await generateText({model:provider('deepseek-flash'),prompt:'test only',providerOptions:translationProviderOptions({baseURL:'https://api.deepseek.com',model:'deepseek-flash'}),maxRetries:0});
  assert.deepEqual(body.thinking,{type:'disabled'});
});
test('web paragraph cache ignores batch IDs and neighbors but isolates all effective translation inputs', async () => {
  const {paragraphCacheIdentity} = await service;
  const profile = {id:'deepseek-flash', updated:1};
  const input = {sourceKey:'web:article',sourceLanguage:'en',targetLanguage:'zh-CN',context:'Article'};
  const key = paragraphCacheIdentity(profile,input,'expert/style/matched glossary','Read $x^2$ at https://example.test');
  assert.equal(paragraphCacheIdentity(profile,{...input,segments:[{id:'27',text:'different neighbor'}]},'expert/style/matched glossary','Read $x^2$ at https://example.test'),key);
  for (const change of [{sourceKey:'web:other'},{sourceLanguage:'auto'},{targetLanguage:'zh-TW'},{context:'Other article'}]) {
    assert.notEqual(paragraphCacheIdentity(profile,{...input,...change},'expert/style/matched glossary','Read $x^2$ at https://example.test'),key);
  }
  assert.notEqual(paragraphCacheIdentity({...profile,id:'deepseek-pro'},input,'expert/style/matched glossary','Read $x^2$ at https://example.test'),key);
  assert.notEqual(paragraphCacheIdentity({...profile,updated:2},input,'expert/style/matched glossary','Read $x^2$ at https://example.test'),key);
  assert.notEqual(paragraphCacheIdentity(profile,input,'changed glossary','Read $x^2$ at https://example.test'),key);
  assert.notEqual(paragraphCacheIdentity(profile,input,'expert/style/matched glossary','Changed text'),key);
});
test('document selections override global defaults without mutating them; removed selections inherit and explicit options win', async () => {
  const {scopedCustomization,resolveCustomization} = await service;
  const globals = {domain:'general',styleId:'faithful',glossaryId:'public-default'};
  const saved = {expertId:'ml',styleId:'academic',glossaryId:'public-tech'};
  const options = scopedCustomization({segments:[{text:'Machine Learning'}]},saved);
  const resolved = resolveCustomization(options,globals);
  assert.match(resolved.expertPrompt,/machine learning/);
  assert.ok(resolved.library.some(([a]) => a === 'Machine Learning'));
  assert.equal(globals.domain,'general');
  assert.equal(scopedCustomization({expertId:'software'},saved).expertId,'software');
  assert.deepEqual(scopedCustomization({}, {expertId:'custom-deleted',styleId:'invalid',glossaryId:'deleted'}),{});
  assert.throws(() => resolveCustomization(scopedCustomization({expertId:'invalid'},saved),globals),/已删除/);
});

test("public presets resolve target-language terms and preserve source prompt variables safely", async () => {
  const { resolveCustomization, makeInstructions } = await service;
  const settings = {domain:"public-tech", acronyms:"keep", glossary:[]};
  const options = {targetLanguage:"zh-CN", styleId:"academic", glossaryId:"public-tech", segments:[{text:"Machine Learning uses an Algorithm."}]};
  const resolved = resolveCustomization(options, settings);
  assert.ok(resolved.library.some(([a,b]) => a === "Machine Learning" && b === "机器学习"));
  assert.ok(!resolved.library.some(([a]) => a === "Avatar"));
  const prompt = makeInstructions(resolved, resolved.library);
  assert.match(prompt, /technology and software/);
  assert.match(prompt, /formal.*academic/);
  assert.doesNotMatch(prompt, /{{/);
  const english = resolveCustomization({...options, targetLanguage:"en"}, settings);
  assert.ok(!english.library.some(([,b]) => b === "机器学习"));
});

test("custom experts and libraries are validated, matched literally and reject removed selections", async () => {
  const { resolveCustomization } = await service;
  const experts = [{id:"custom-one", name:"One", prompt:"Use concise terminology in {{to}}."}];
  const libraries = [{id:"custom-terms", name:"Terms", entries:[["C++", "C加加"], ["AI", "人工智能"], ["随机森林", "random forest"]]}];
  const options = {expertId:"custom-one", glossaryId:"custom-terms", targetLanguage:"en", segments:[{text:"said C++ 使用随机森林算法"}]};
  const result = resolveCustomization(options, {}, experts, libraries);
  assert.equal(result.expertPrompt, "Use concise terminology in en.");
  assert.deepEqual(result.library, [["随机森林", "random forest"], ["C++", "C加加"]]);
  assert.throws(() => resolveCustomization({...options, expertId:"deleted"}, {}, experts, libraries), /已删除/);
  assert.throws(() => resolveCustomization(options, {}, experts, [{...libraries[0], entries:[["bad", null]]}]), /无效/);
});

test("retired game libraries fall back without removing custom libraries or game experts", async () => {
  const { resolveCustomization } = await service;
  const options = {targetLanguage:"zh-CN", segments:[{text:"LLMs help explain a cooldown."}]};
  for (const id of ["public-game", "public-stellar-blade-clothing", "public-Shelter69-Slang", "public-hd2", "public-bg3", "public-wuthering-waves"]) {
    const result = resolveCustomization(options, {domain:"public-game", glossaryId:id});
    assert.deepEqual(result.library, [["LLMs", "LLMs"]]);
    assert.match(result.expertPrompt, /game terminology/);
  }
  const custom = [{id:"custom-game",name:"个人用词",entries:[["cooldown","个人译法"]]}];
  assert.deepEqual(resolveCustomization({...options, glossaryId:"custom-game"}, {}, [], custom).library, [["cooldown","个人译法"]]);
  assert.throws(() => resolveCustomization({...options, glossaryId:"custom-deleted"}, {}), /已删除/);
});

test("restored terms keep locale-specific translations and match only relevant headwords", async () => {
  const { resolveCustomization } = await service;
  const options = {glossaryId:"public-tech", segments:[{text:"Machine Learning uses an Algorithm on NVIDIA hardware."}]};
  const simple = resolveCustomization({...options,targetLanguage:"zh-CN"},{}).library;
  const traditional = resolveCustomization({...options,targetLanguage:"zh-TW"},{}).library;
  assert.ok(simple.some(([a,b]) => a === "Machine Learning" && b === "机器学习"));
  assert.ok(traditional.some(([a,b]) => a === "Machine Learning" && b === "機器學習"));
  assert.ok(traditional.some(([a,b]) => a === "NVIDIA" && b === "NVIDIA"));
  assert.ok(!traditional.some(([a]) => a === "Avatar"));
  assert.deepEqual(resolveCustomization({...options,targetLanguage:"ja"},{}).library, [["NVIDIA","NVIDIA"]]);
});

test("out-of-order model output is mapped by id, never response position", async () => {
  const { parseTranslations } = await service;
  assert.deepEqual(parseTranslations('{"translations":[{"id":"b","text":"第二段"},{"id":"a","text":"第一段"}]}', [{ id: "a" }, { id: "b" }]), ["第一段", "第二段"]);
});

test("CS and LLM libraries supply the selected locale without matching acronyms inside words", async () => {
  const {resolveCustomization} = await service;
  const computer = resolveCustomization({targetLanguage:"zh-CN", segments:[{text:"RBAC protects a distributed system with DNS and a hash table."}]}, {glossaryId:"public-access-control"});
  for (const [source,translation] of [["RBAC","基于角色的访问控制"],["Distributed system","分布式系统"],["DNS","域名系统（DNS）"],["Hash table","哈希表"]]) {
    assert.ok(computer.library.some(([a,b]) => a === source && b === translation));
  }
  const options = {glossaryId:"builtin-llm-ai",segments:[{text:"She said HTML uses RAG, LoRA and a KV cache."}]};
  const simple = resolveCustomization({...options,targetLanguage:"zh-CN"},{}).library;
  assert.ok(simple.some(([a,b]) => a === "RAG" && b === "检索增强生成（RAG）"));
  assert.ok(simple.some(([a,b]) => a === "LoRA" && b === "低秩适配（LoRA）"));
  assert.ok(!simple.some(([a]) => ["AI","ML"].includes(a)));
  assert.ok(resolveCustomization({...options,targetLanguage:"zh-TW"},{}).library.some(([a,b]) => a === "KV cache" && b === "鍵值快取"));
  assert.deepEqual(resolveCustomization({...options,targetLanguage:"en"},{}).library, []);
});
test("missing, duplicated and foreign ids are rejected instead of corrupting page text", async () => {
  const { parseTranslations } = await service;
  for (const rows of [[], [{ id: "x", text: "a" }, { id: "b", text: "b" }], [{ id: "a", text: "a" }, { id: "a", text: "b" }]]) {
    assert.throws(() => parseTranslations(JSON.stringify({ translations: rows }), [{ id: "a" }, { id: "b" }]));
  }
});
test("refusals and malformed JSON produce a useful error, not rendered provider output", async () => {
  const { parseTranslations } = await service;
  assert.throws(() => parseTranslations("Sorry, I cannot do that", [{ id: "0" }]), /模型返回格式/);
  assert.throws(() => parseTranslations('{"translations":[{"id":"0","text":null}]}', [{ id: "0" }]), /无效/);
});
test("profile URL normalization preserves provider prefixes and limits plaintext transport to loopback", async () => {
  const { normalizeProfile } = await service;
  const input = { name: "Local", model: "model", baseURL: "http://localhost:1234/v1/chat/completions/" };
  assert.equal(normalizeProfile(input).baseURL, "http://localhost:1234/v1");
  assert.equal(normalizeProfile({ ...input, baseURL: "https://provider.example/api/custom/v1/" }).baseURL, "https://provider.example/api/custom/v1");
  for (const baseURL of ["http://provider.example/v1", "https://user:secret@provider.example/v1", "https://provider.example/v1?key=secret", "file:///tmp/a", "invalid"]) {
    assert.throws(() => normalizeProfile({ ...input, baseURL }));
  }
});
test("a stored credential cannot be silently reused on a different endpoint", async () => {
  const { normalizeProfile } = await service;
  const previous = normalizeProfile({ name: "Service", model: "m", baseURL: "https://one.example/v1", apiKey: "secret" });
  assert.equal(normalizeProfile({ ...previous, apiKey: "" }, previous).apiKey, "secret");
  assert.throws(() => normalizeProfile({ ...previous, baseURL: "https://two.example/v1", apiKey: "" }, previous), /重新填写密钥/);
  assert.equal(normalizeProfile({ ...previous, baseURL: "https://two.example/v1", apiKey: "", clearKey: true }, previous).apiKey, "");
});

test('term extraction keeps valid literal candidates when a model duplicates terms or returns object entries',async()=>{
  const {parseExtractedTerms}=await service;
  const response='```json\n'+JSON.stringify({terms:[['attention','注意力'],['Attention','重复'],{source:'random forest',translation:'随机森林'},['invented','假词'],['bad',null]]})+'\n```';
  assert.deepEqual(parseExtractedTerms(response,'attention and a random forest'),[['attention','注意力'],['random forest','随机森林']]);
  assert.deepEqual(parseExtractedTerms('{"terms":[]}','nothing technical'),[]);
  assert.throws(()=>parseExtractedTerms('invalid','attention'),/术语格式/);
  assert.throws(()=>parseExtractedTerms('{"terms":"attention"}','attention'),/术语格式/);
});
