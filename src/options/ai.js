"use strict";
void (async () => {
  await twpConfig.onReady();
  const $ = id => document.getElementById(id);
  let profiles = [], current = "", generation = 0, translated = "";
  const status = (id, text, error = false) => { $(id).textContent = text; $(id).dataset.error = error; };
  function selectOptions(id, options, value) {
    $(id).replaceChildren(...options.map(([key, text]) => new Option(text, key)));
    $(id).value = value;
  }
  function loadProfile(id) {
    current = id;
    const profile = profiles.find(p => p.id === id);
    $("profiles").value = id;
    $("profile-name").value = profile?.name || "";
    $("base-url").value = profile?.baseURL || "";
    $("model").value = profile?.model || "";
    $("api-key").value = "";
    $("api-key").placeholder = profile?.hasKey ? "已保存密钥；留空保持不变" : "本机免密服务可留空";
    $("clear-key").checked = false;
    $("delete-profile").disabled = !profile;
  }
  function updateProfiles(items, selected = current) {
    profiles = items;
    selectOptions("profiles", [["", "添加新的服务"], ...items.map(p => [p.id, p.name])], selected);
    selectOptions("active-profile", items.length ? items.map(p => [p.id, `${p.name} · ${p.model}`]) : [["", "请先保存模型服务"]], twpConfig.get("aiActiveProfile"));
    loadProfile(selected);
  }
  function profileInput() {
    return { id: current || undefined, name: $("profile-name").value, baseURL: $("base-url").value,
      model: $("model").value, apiKey: $("api-key").value, clearKey: $("clear-key").checked };
  }
  async function profileAction(action) {
    if (action !== "aiDeleteProfile" && !$("profile-form").reportValidity()) return;
    const buttons = [...$("profile-form").querySelectorAll("button"), $("new-profile"), $("profiles")];
    buttons.forEach(button => button.disabled = true);
    status("profile-status", action === "aiTestProfile" ? "正在发送一段示例文字测试连接…" : "正在保存…");
    try {
      const request = { action, id: action === "aiDeleteProfile" ? current : crypto.randomUUID(), profile: profileInput(),
        targetLanguage: "zh-CN", segments: [{ id: "0", text: "Machine learning models learn patterns from data." }] };
      const result = await twpAIClient.call(request);
      if (result.profiles) updateProfiles(result.profiles, result.id || "");
      status("profile-status", action === "aiTestProfile" ? `连接成功：${result.translations[0]}` : action === "aiDeleteProfile" ? "服务已删除" : "服务已保存；可在右侧选择为当前服务");
    } catch (error) { status("profile-status", error.message, true); }
    finally { buttons.forEach(button => button.disabled = false); $("delete-profile").disabled = !current; }
  }
  $("profile-form").onsubmit = event => { event.preventDefault(); profileAction("aiSaveProfile"); };
  $("profile-form").oninput = () => status("profile-status", "");
  $("test-profile").onclick = () => profileAction("aiTestProfile");
  $("delete-profile").onclick = () => profileAction("aiDeleteProfile");
  $("profiles").onchange = () => { loadProfile($("profiles").value); status("profile-status", ""); };
  $("new-profile").onclick = () => { loadProfile(""); $("profile-name").focus(); };
  const settings = twpConfig.get("aiTranslationSettings");
  function cacheOptions() {
    const value = twpConfig.get("aiCacheSettings");
    $("cache-enabled").checked = value.enabled;
    $("cache-hours").value = value.ttlHours;
  }
  cacheOptions();
  twpConfig.onChanged(name => { if (name === "aiCacheSettings") cacheOptions(); });
  $("cache-form").onsubmit = event => {
    event.preventDefault();
    twpConfig.set("aiCacheSettings", {enabled: $("cache-enabled").checked, ttlHours: Number($("cache-hours").value)});
    status("cache-status", "缓存设置已保存");
  };
  $("clear-ai-cache").onclick = async () => {
    $("clear-ai-cache").disabled = true;
    try { await twpAIClient.call({action: "aiClearCache"}); status("cache-status", "AI 缓存已清空"); }
    catch (error) { status("cache-status", error.message, true); }
    finally { $("clear-ai-cache").disabled = false; }
  };
  $("engine").value = twpConfig.get("pageTranslatorService");
  $("domain").value = settings.domain;
  twpPresetEditor.init();
  $("domain").value = settings.domain;
  $("acronyms").value = settings.acronyms;
  $("glossary").value = settings.glossary.map(([source, target]) => `${source} = ${target}`).join("\n");
  $("floating-enabled").checked = twpConfig.get("showFloatingButton") === "yes";
  $("preferences-form").onsubmit = event => {
    event.preventDefault();
    try {
      const glossary = $("glossary").value.split(/\r?\n/).filter(line => line.trim()).map(line => {
        const index = line.indexOf("=");
        if (index < 1 || !line.slice(index + 1).trim()) throw new Error("术语格式应为：原文 = 译文，每行一条");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      });
      if (glossary.length > 200 || $("glossary").value.length > 16000) throw new Error("术语库最多 200 条、16000 字符");
      if ($("engine").value === "openai" && !$("active-profile").value) throw new Error("请先添加并保存模型服务");
      twpConfig.set("aiActiveProfile", $("active-profile").value);
      twpConfig.set("aiTranslationSettings", { domain: $("domain").value, styleId: $("default-style").value, glossaryId: $("default-library").value, acronyms: $("acronyms").value, glossary });
      twpConfig.set("pageTranslatorService", $("engine").value);
      if ($("engine").value === "openai") twpConfig.set("pageTranslationMode", "bilingual");
      twpConfig.set("showFloatingButton", $("floating-enabled").checked ? "yes" : "no");
      status("preferences-status", "偏好已保存");
    } catch (error) { status("preferences-status", error.message, true); }
  };
  $("reset-hidden").onclick = () => { twpConfig.set("floatingHiddenSites", []); status("preferences-status", "已恢复所有网站的悬浮按钮"); };
  $("translate").onclick = async () => {
    if (!$("source").value.trim()) return $("source").focus();
    const token = ++generation;
    $("translate").disabled = true; $("cancel").disabled = false; $("copy").disabled = true;
    $("copy").textContent = "复制译文";
    $("result").textContent = "正在翻译…";
    try {
      const values = await twpAIClient.translate([$("source").value], $("target").value, "", "preview");
      if (token !== generation) return;
      translated = values[0]; $("result").textContent = translated; $("copy").disabled = false;
    } catch (error) { if (token === generation) $("result").textContent = error.message; }
    finally { if (token === generation) { $("translate").disabled = false; $("cancel").disabled = true; } }
  };
  $("cancel").onclick = () => { generation++; twpAIClient.cancel("preview"); $("result").textContent = "已取消"; $("translate").disabled = false; $("cancel").disabled = true; };
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText(translated); $("copy").textContent = "已复制"; } catch { $("copy").textContent = "请选中译文复制"; } };
  try { updateProfiles((await twpAIClient.call({ action: "aiGetSettings" })).profiles, twpConfig.get("aiActiveProfile")); }
  catch (error) { status("profile-status", error.message, true); }
})();
