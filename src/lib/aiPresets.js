/* SPDX-License-Identifier: MPL-2.0 — Core presets and catalog helpers. Glossary provenance is in builtinPresets.js. */
const twpAIPresets = (() => {
  const experts = [
    ["general", "通用专家", "Translate faithfully using the subject matter evident in the text."],
    ["ml", "机器学习 / 数据科学", "Use established machine learning, statistics and data science terminology. Resolve RF and CV only from explicit context; preserve mathematical meaning."],
    ["software", "软件开发", "Use software engineering terminology. Preserve identifiers, commands, API names, versions and code."],
  ].map(([id, name, prompt]) => ({ id, name, prompt, builtin: true }));
  const imported = typeof module !== "undefined" ? require("./builtinPresets.js") : twpBuiltinPresets;
  experts.push(...imported.experts);
  const styles = [
    ["faithful", "忠实原文", "Preserve the original register and structure while using idiomatic target-language grammar."],
    ["auto", "自动匹配场景", "Infer the appropriate register from the source genre and adapt wording accordingly without changing meaning."],
    ["fluent", "自然流畅", "Use idiomatic, fluent phrasing and smooth transitions without adding information."],
    ["technical", "技术文档", "Use precise, concise technical prose, consistent terms and clear procedural wording."],
    ["academic", "学术论文", "Use formal, restrained academic prose and preserve qualifications."],
    ["medical", "医学专业", "Use precise medical phrasing; preserve dosage, negation and uncertainty."],
    ["finance", "金融财经", "Use disciplined financial prose with exact numbers, units and risk qualifiers."],
    ["literary", "文学叙事", "Preserve imagery, rhythm, narrative perspective and individual voices."],
    ["gaming", "游戏语气", "Use natural game-localization language appropriate to the source's characters and context."],
    ["social", "社交媒体", "Use conversational, concise phrasing while preserving humor, emoji and tone."],
  ].map(([id, name, prompt]) => ({ id, name, prompt }));
  const glossaries = [{ id: "default", name: "我的默认术语", entries: [], builtin: true }, ...imported.glossaries];
  const retiredGlossaries = new Set(["public-game", "public-stellar-blade-clothing", "public-Shelter69-Slang", "public-hd2", "public-bg3", "public-wuthering-waves"]);
  function normalizeGlossaryId(id) { return retiredGlossaries.has(id) ? "public-default" : id; }
  function allExperts(custom = []) { return [...experts, ...custom.filter(item => item && typeof item.id === "string" && item.id.startsWith("custom-") && typeof item.name === "string" && typeof item.prompt === "string")]; }
  function allGlossaries(custom = []) { return [...glossaries, ...custom.filter(item => item && typeof item.id === "string" && item.id.startsWith("custom-") && typeof item.name === "string" && Array.isArray(item.entries))]; }
  function parseGlossary(text) {
    if (text.length > 500000) throw new Error("术语库最多 500000 字符");
    const entries = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const index = line.indexOf("=");
      if (index < 1 || !line.slice(index + 1).trim()) throw new Error("术语格式应为：原文 = 译文，每行一条");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    });
    if (entries.length > 10000) throw new Error("术语库最多 10000 条");
    return [...new Map(entries).entries()];
  }
  return { experts, styles, glossaries, allExperts, allGlossaries, parseGlossary, normalizeGlossaryId };
})();
if (typeof module !== "undefined") module.exports = twpAIPresets;
