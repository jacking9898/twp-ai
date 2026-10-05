"use strict";
void (async () => {
  if (window !== window.top || !document.body || document.getElementById("twp-floating")) return;
  await pageTranslator.ready;
  if (platformInfo.isMobile.any) return;
  const host = document.createElement("div");
  host.id = "twp-floating";
  host.className = "notranslate";
  host.setAttribute("translate", "no");
  host.style.cssText = 'all:initial!important;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif!important;position:fixed!important;z-index:2147483646!important;';
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{--bg:#fff;--fg:#1e2d44;--muted:#687991;--border:#dfe6ef;--accent:#2866db;color-scheme:light dark;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}
      *{box-sizing:border-box}button,select{font:inherit;color:var(--fg)}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}[hidden]{display:none!important}
      #dock{position:relative;width:44px}#toggle{width:44px;height:44px;background:var(--bg);border:1px solid var(--border);border-radius:15px;padding:4px;box-shadow:0 3px 18px #12335a25;position:relative;touch-action:none}#toggle img{width:34px;height:34px;display:block;pointer-events:none}#badge{position:absolute;bottom:-3px;right:-3px;width:13px;height:13px;border-radius:50%;border:2px solid var(--bg);background:#9ba9bb}#toggle[data-state=translated] #badge{background:#26986d}#toggle[data-state=error] #badge{background:#e36a41}#toggle[data-state=translating] #badge{background:var(--accent);animation:pulse 1s ease-in-out infinite}@keyframes pulse{50%{opacity:.25}}
      #tools{position:absolute;right:0;top:-54px;width:44px;height:152px}#tools button{position:absolute;width:44px;height:44px;border:1px solid var(--border);border-radius:15px;background:var(--bg);box-shadow:0 3px 16px #12335a15;display:grid;place-items:center;padding:10px}#sidebar{top:0}#settings{top:108px}#tools svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}#tools button:hover{color:var(--accent);border-color:var(--accent)}
      #panel{position:absolute;right:54px;top:-120px;width:320px;max-width:calc(100vw - 76px);max-height:calc(100vh - 30px);overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:17px;padding:18px;box-shadow:0 12px 45px #132c4b26}#panel[data-side=left]{right:auto;left:54px}.heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.heading strong{font-size:17px}.heading button{border:0;background:none;padding:3px;font-size:12px;color:var(--muted)}label{display:block;margin:11px 0 4px;font-size:12px;color:var(--muted)}select{width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1px solid var(--border)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:9px}.action{padding:9px 12px;border:1px solid var(--border);border-radius:9px;background:var(--bg)}.primary{background:var(--accent);color:white;border-color:var(--accent);width:100%;margin-top:14px;font-weight:600}.links{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.links .action{font-size:12px;flex:1}.check{display:flex;gap:6px;align-items:center;color:var(--fg);font-size:12px}#status{font-size:12px;color:var(--muted);margin:9px 0 0;overflow-wrap:anywhere}#status[data-error=true]{color:#c54f2c}#result{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--border);padding-top:12px;margin-top:12px;max-height:190px;overflow:auto}#hide-site{background:none;border:0;color:var(--muted);font-size:11px;padding:10px 0 0}button:disabled{opacity:.5;cursor:default}
      @media(prefers-color-scheme:dark){:host{--bg:#1b2635;--fg:#edf3fc;--muted:#a5b5cb;--border:#3a4c62;--accent:#548df5}#status[data-error=true]{color:#ffaa8f}}
      .quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;padding-top:15px;border-top:1px solid var(--border)}.quick-grid button{display:flex;align-items:center;gap:9px;padding:11px 9px;border:1px solid var(--border);border-radius:10px;background:var(--bg);text-align:left;font-size:13px}.quick-grid button:hover{border-color:var(--accent);color:var(--accent)}.quick-grid svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}.quick-grid small{display:block;color:var(--muted);font-size:10px;margin-top:2px}.footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:10px;border-top:1px solid var(--border)}.footer button{background:none;border:0;color:var(--muted);padding:0;font-size:11px}.footer span{color:var(--muted);font-size:10px}.card{border:1px solid var(--border);border-radius:11px;padding:13px;background:color-mix(in srgb,var(--fg) 4%,var(--bg))}.card .check{justify-content:space-between;font-size:13px;margin:0}.card input{accent-color:var(--accent);width:17px;height:17px}.gesture{margin-top:14px;padding-top:15px;border-top:1px solid var(--border);text-align:center;color:var(--fg);font-size:13px}.gesture kbd{display:inline-block;background:var(--fg);color:var(--bg);padding:6px 19px;border-radius:8px;box-shadow:0 2px 4px #0002;font:13px system-ui}.sub-label{display:block;margin:19px 0 8px;color:var(--muted);font-size:12px}.choices{display:flex;gap:7px;flex-wrap:wrap}.choices button{border:1px solid var(--border);background:var(--bg);border-radius:8px;padding:7px 10px;font-size:12px}.choices button[aria-pressed=true],.tabs button[aria-selected=true]{color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg))}.note{font-size:11px;line-height:1.7;color:var(--muted);margin:14px 0 0}.tabs{display:flex;gap:6px;margin-bottom:14px}.tabs button{flex:1;background:var(--bg);border:1px solid var(--border);padding:8px;border-radius:9px;font-size:12px}.tag{display:inline-block;margin-bottom:12px;color:var(--muted);border:1px solid var(--border);padding:2px 9px;border-radius:20px;font-size:10px}#back{padding-right:8px}#panel-title{flex:1}#selection{width:100%;margin-top:10px;font-size:12px}
      #badge{display:none;width:21px;height:21px;align-items:center;justify-content:center;font:700 13px/1 system-ui;color:var(--accent-ink);background:var(--accent)!important;bottom:-5px;right:-5px;border:2px solid var(--bg)}#toggle[data-state=translated],#toggle[data-state=translating],#toggle[data-state=error]{border:2px solid var(--accent);box-shadow:0 0 0 3px var(--tint),0 3px 16px #0002}#toggle[data-state=translated] #badge,#toggle[data-state=error] #badge{display:flex}#toggle[data-state=translating] #badge{display:block;border:3px solid var(--tint);border-top-color:var(--accent);background:var(--bg)!important;animation:status-spin .8s linear infinite}#toggle[data-state=error] #badge{background:var(--error)!important;color:var(--bg)}@keyframes status-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#badge{animation:none!important}}
      #cache-manage{width:100%;min-height:36px;margin-top:8px;font-size:12px;font-weight:600;color:var(--accent);border-color:var(--accent);background:var(--tint)}#cache-manage:hover{background:var(--surface)}
    </style><link rel="stylesheet" href="${chrome.runtime.getURL("lib/brandTheme.css")}">
    <div id="dock"><div id="tools" hidden><button id="sidebar" title="翻译侧边栏" aria-label="打开翻译侧边栏"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 2v9M13 6.5h9"/></svg></button><button id="settings" title="控制面板" aria-label="控制面板" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h4m6 0h8M3 18h10m6 0h2"/><circle cx="10" cy="6" r="3"/><circle cx="16" cy="18" r="3"/></svg></button></div>
      <button id="toggle" aria-label="翻译网页" title="点击翻译 / 再次恢复原文；拖动调整位置"><img alt="" src="${chrome.runtime.getURL("icons/reading.png")}"><span id="badge" aria-hidden="true"></span></button>
      <section id="panel" hidden aria-label="控制面板"><div class="heading"><button id="back" hidden aria-label="返回控制面板">←</button><strong id="panel-title">控制面板</strong><button id="close" aria-label="关闭面板">关闭</button></div><div id="main-content">
        <div class="pair"><div><label for="target">目标语言</label><select id="target"></select></div><div><label for="mode">显示方式</label><select id="mode"><option value="bilingual">双语对照</option><option value="translated">仅译文</option></select></div></div>
        <label for="engine">翻译服务</label><select id="engine"><option value="bing">微软翻译</option><option value="google">谷歌翻译</option><option value="yandex">Yandex</option><option value="openai">AI · 自定义模型</option></select>
        <div id="ai-options" hidden><label for="profile">模型服务</label><select id="profile"></select><label for="domain">此网页的 AI 专家</label><select id="domain"></select><label for="page-glossary">此网页的术语库</label><select id="page-glossary"></select><label for="page-style">此网页的翻译风格</label><select id="page-style"></select><p id="page-ai-notice" class="note" role="status"></p><button id="page-ai-reset" class="action" style="width:100%;margin-top:8px">恢复跟随全局</button></div>
        <div id="cache-options" hidden><label for="cache-duration">AI 缓存时间</label><select id="cache-duration"><option value="0">关闭缓存</option><option value="1">1 小时</option><option value="24">1 天</option><option value="168">7 天</option><option value="720">30 天</option></select><button id="cache-manage" class="action" type="button">查看与管理缓存</button></div>
        <button id="translate" class="action primary">翻译网页</button><button id="retranslate" class="action" hidden style="width:100%;margin-top:8px">重新翻译（跳过缓存）</button><p id="status" role="status" aria-live="polite"></p>
        <div class="quick-grid">
          <button id="document-tool"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/></svg><span>文档翻译<small>打开文档工作台</small></span></button>
          <button id="text-tool"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M12 8v9"/></svg><span>文本翻译<small>打开文本工作台</small></span></button>
          <button id="video-tool" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/></svg><span>视频翻译<small>播放同步 · 双语字幕</small></span></button>
          <button id="hover-tool"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 3 6 18 3-7 7-3zM17 3l1-2M21 6l2-1"/></svg><span>鼠标悬停<small id="hover-summary">已关闭</small></span></button>
          <button id="selection-tool"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8M12 4v16M8 20h8M3 4h1m-1 5h1m-1 5h1m-1 6h1m16-16h1m-1 5h1m-1 5h1m-1 6h1"/></svg><span>划词翻译<small id="selection-summary">显示图标</small></span></button>
        </div>
        <button id="ai-insights" class="action" style="width:100%;margin-top:10px">AI 用量与网页术语</button>
        <button id="selection" class="action">翻译选中文字</button>
        <div class="footer"><button id="workspace">模型与术语设置</button><span>v${chrome.runtime.getManifest().version}</span></div>
        <button id="hide-site">在此网站隐藏悬浮按钮</button>
        </div><div id="hover-content" hidden>
          <div class="card"><label class="check" for="hover-enabled">启用鼠标悬停翻译<input id="hover-enabled" type="checkbox" role="switch"></label><div class="gesture">鼠标移到段落 + <kbd id="hover-key">Ctrl</kbd><p id="hover-effect-hint">翻译 / 还原该段</p></div></div>
          <span class="sub-label">触发方式</span><div class="choices" id="hover-triggers" role="group" aria-label="悬停触发方式"><button data-value="Control">+ Ctrl</button><button data-value="Shift">+ Shift</button><button data-value="Alt">+ Alt</button><button data-value="hold">长按鼠标左键</button><button data-value="direct">直接悬停</button></div>
          <span class="sub-label">触发效果</span><div class="choices" id="hover-effects" role="group" aria-label="悬停触发效果"><button data-value="toggle">翻译 / 还原</button><button data-value="translate">仅翻译</button><button data-value="restore">仅还原</button></div>
          <p class="note">按一下所选按键翻译当前段落；Ctrl+C 等组合键不会触发。直接悬停停留约 0.7 秒后仅翻译，长按同样约 0.7 秒。整页翻译期间暂停段落翻译。</p>
        </div><div id="selection-content" hidden>
          <div class="tabs" role="tablist" aria-label="划词翻译类型"><button id="word-tab" role="tab" aria-selected="true" aria-controls="word-settings">划词翻译</button><button id="region-tab" role="tab" aria-selected="false" aria-controls="region-settings">圈选翻译</button></div>
          <div id="word-settings" role="tabpanel" aria-labelledby="word-tab"><div class="card"><label class="check" for="selection-toggle">启用划词翻译<input type="checkbox" role="switch" id="selection-toggle"></label><div class="gesture">选中文字 + <kbd id="selection-key">点击图标</kbd><p>翻译选中内容</p></div></div>
          <span class="sub-label">触发方式</span><div class="choices" id="selection-triggers" role="group" aria-label="划词触发方式"><button data-value="direct">直接翻译</button><button data-value="icon">显示图标</button><button data-value="dot">显示小圆点</button><button data-value="Control">+ Ctrl</button><button data-value="Alt">+ Alt</button><button data-value="Shift">+ Shift</button></div><p class="note">使用控制面板当前选择的服务。开启直接翻译后，每次完成划词都会发起翻译请求。输入框与代码区域不自动触发。</p></div>
          <div id="region-settings" role="tabpanel" aria-labelledby="region-tab" hidden><div class="card"><strong>圈选图片与不可选中的文字</strong><p class="note">拖动框选当前画面中的文字，自动截取并在图片工作台本地识别。检查文字后，使用这里选择的服务翻译。视频可暂停后圈选。</p><button id="region-start" class="action primary">开始圈选</button><p class="note">按 Esc 取消。截图保留在本机，点击翻译才发送识别文字。</p></div></div>
        </div>
      </section>
    </div>`;
  const $ = id => shadow.getElementById(id);
  const scopeControls = twpAIScopeControls.create({root:shadow,fields:{expertId:'domain',glossaryId:'page-glossary',styleId:'page-style'},notice:'page-ai-notice',reset:'page-ai-reset',scopeLabel:'此网页',
    onBusy:value => {$("translate").disabled = $("retranslate").disabled = value;},
    onSaved:() => {if (pageTranslator.getService() === 'openai') {pageTranslator.restorePage(); document.dispatchEvent(new Event('twp-ai-customization-changed'));}}});
  let hoverTimer, closeTimer;
  let drag = null, dragged = false;
  document.documentElement.appendChild(host);
  function position() {
    const value = twpConfig.get("floatingPosition");
    const side = value.side === "left" ? "left" : "right";
    const top = Math.max(66, Math.min(window.innerHeight - 110, (Number(value.top) || 0.35) * window.innerHeight));
    host.style.setProperty("top", `${top}px`, "important");
    host.style.setProperty(side, "12px", "important");
    host.style.setProperty(side === "left" ? "right" : "left", "auto", "important");
    $("panel").dataset.side = side;
    const panelHeight = $("panel").getBoundingClientRect().height || 550;
    $("panel").style.top = `${Math.max(12 - top, Math.min(-110, window.innerHeight - top - panelHeight - 12))}px`;
  }
  function visibility() {
    host.style.setProperty("display", twpConfig.get("showFloatingButton") === "yes" &&
      !twpConfig.get("floatingHiddenSites").includes(location.hostname) ? "block" : "none", "important");
  }
  const labels = { original: "翻译网页", translating: "取消翻译并恢复原文", translated: "显示原文", error: "重试翻译" };
  function state() {
    const value = pageTranslator.getState();
    $("toggle").dataset.state = value;
    $("toggle").setAttribute("aria-label", labels[value]);
    $("toggle").setAttribute("aria-pressed", String(value === "translated"));
    $("badge").textContent = {original:'',translated:'✓',translating:'',error:'!'}[value] || '';
    $("toggle").title = ({original:'原文 · 点击翻译',translated:'已翻译 · 点击恢复原文',translating:'翻译中 · 点击取消',error:'翻译失败 · 点击重试'}[value] || labels[value]) + '；拖动调整位置';
    $("translate").textContent = labels[value];
    $("status").dataset.error = value === "error";
    $("status").textContent = value === "error" ? (pageTranslator.getError() || "翻译失败，请检查网络或更换服务") :
      value === "translating" ? "正在翻译可见内容…" : value === "translated" ? "当前可见内容已翻译" : "点击图标即可翻译；悬停展开工具。";
  }
  function controls() {
    videoAvailability();
    $("target").replaceChildren(...Object.entries(twpLang.getLanguageList()).map(([code, name]) => new Option(name, code)));
    $("target").value = twpConfig.get("targetLanguage");
    $("engine").value = pageTranslator.getService();
    const ai = $("engine").value === "openai";
    $("mode").value = ai ? "bilingual" : twpConfig.get("pageTranslationMode");
    $("mode").disabled = ai;
    $("mode").title = ai ? "AI 网页翻译首版采用双语对照" : "";
    $("ai-options").hidden = !ai;
    $("cache-options").hidden = $("retranslate").hidden = !ai;
    const cache = twpConfig.get("aiCacheSettings");
    const duration = cache.enabled ? String(cache.ttlHours) : "0";
    for (const option of [...$("cache-duration").options]) if (option.dataset.custom) option.remove();
    if (![...$("cache-duration").options].some(option => option.value === duration)) {
      const option = new Option(`${duration} 小时`, duration); option.dataset.custom = "true"; $("cache-duration").append(option);
    }
    $("cache-duration").value = duration;
    const profiles = twpConfig.get("aiProfiles");
    $("profile").replaceChildren(...(profiles.length ? profiles.map(p => new Option(`${p.name} · ${p.model}`, p.id)) : [new Option("请先添加 AI 服务", "")]));
    $("profile").value = twpConfig.get("aiActiveProfile");
    scopeControls.refresh();
    $("selection-toggle").checked = twpConfig.get("showTranslateSelectedButton") === "yes";
    const hover = twpConfig.get("hoverTranslationSettings");
    const selection = twpConfig.get("selectionTranslationSettings");
    const keys = { Control: "Ctrl", Shift: "Shift", Alt: "Alt", hold: "长按左键", direct: "停留 0.7 秒", icon: "点击图标", dot: "点击圆点" };
    $("hover-enabled").checked = hover.enabled;
    $("hover-summary").textContent = hover.enabled ? keys[hover.trigger] : "已关闭";
    $("selection-summary").textContent = $("selection-toggle").checked ? (selection.trigger === "direct" ? "直接翻译" : keys[selection.trigger]) : "已关闭";
    $("hover-key").textContent = keys[hover.trigger];
    $("hover-effect-hint").textContent = { toggle: "翻译 / 还原该段", translate: "仅翻译该段", restore: "仅还原该段" }[hover.effect];
    $("selection-key").textContent = selection.trigger === "direct" ? "直接翻译" : keys[selection.trigger];
    for (const [id, value] of [["hover-triggers", hover.trigger], ["hover-effects", hover.effect], ["selection-triggers", selection.trigger]]) {
      $(id).querySelectorAll("button").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.value === value));
        button.disabled = id === "hover-effects" && hover.trigger === "direct" && button.dataset.value !== "translate";
      });
    }
  }
  function panelView(view) {
    for (const name of ["main", "hover", "selection"]) $(`${name}-content`).hidden = name !== view;
    $("panel-title").textContent = { main: "控制面板", hover: "悬停翻译设置", selection: "划词翻译" }[view];
    $("back").hidden = view === "main"; position();
  }
  function openPanel() { $("panel").hidden = false; $("tools").hidden = false; $("settings").setAttribute("aria-expanded", "true"); panelView("main"); controls(); state(); position(); void scopeControls.load(); }
  function closePanel() { $("panel").hidden = true; $("settings").setAttribute("aria-expanded", "false"); }
  function toggle() {
    if (dragged) { dragged = false; return; }
    if (["translated", "translating"].includes(pageTranslator.getState())) pageTranslator.restorePage();
    else {
      if (pageTranslator.getService() === "openai" && !twpConfig.get("aiActiveProfile")) {
        openPanel(); $("status").textContent = "请先在 AI 设置中添加模型服务"; return;
      }
      pageTranslator.translatePage(twpConfig.get("targetLanguage"));
    }
  }
  $("toggle").onclick = toggle;
  $("translate").onclick = toggle;
  $("retranslate").onclick = () => pageTranslator.translatePage(twpConfig.get("targetLanguage"), {forceRefresh: true});
  $("cache-duration").onchange = () => twpConfig.set("aiCacheSettings", {enabled: $("cache-duration").value !== "0", ttlHours: Number($("cache-duration").value) || 168});
  $('cache-manage').onclick=()=>twpAIClient.call({action:'aiOpenCache'}).catch(error=>{$('status').textContent=error.message;});
  $("settings").onclick = () => $("panel").hidden ? openPanel() : closePanel();
  $("close").onclick = () => { closePanel(); $("toggle").focus(); };
  const openSettings = () => twpAIClient.call({ action: "aiOpenSettings" }).catch(error => { openPanel(); $("status").textContent = error.message; });
  $("workspace").onclick = openSettings;
  $("ai-insights").onclick = async()=>{try{await twpAIClient.call({action:'aiInsightOpen',text:bilingualTranslator.sourceText(),title:document.title,targetLanguage:$("target").value,profileId:$("profile").value});}catch(error){$("status").textContent=error.message;}};
  $("back").onclick = () => panelView("main");
  $("hover-tool").onclick = () => panelView("hover");
  $("selection-tool").onclick = () => panelView("selection");
  const openWorkspace = view => twpAIClient.call({ action: "openTranslationWorkspace", view })
    .catch(error => { openPanel(); $("status").textContent = error.message; });
  $("document-tool").onclick = () => openWorkspace("document");
  $("text-tool").onclick = () => openWorkspace("text");
  function videoAvailability() { $('video-tool').hidden = !twpVideoSubtitles.isSupportedPage(location.href); }
  document.addEventListener('yedu-video-availability-changed', videoAvailability);
  $('video-tool').onclick = () => {
    if(!twpVideoSubtitles.isSupportedPage(location.href))return;
    const initial={service:$('engine').value,profileId:$('profile').value};
    closePanel();twpVideoTranslator.open(initial);
  };
  $("hover-enabled").onchange = () => twpConfig.set("hoverTranslationSettings", { ...twpConfig.get("hoverTranslationSettings"), enabled: $("hover-enabled").checked });
  for (const [id, key] of [["hover-triggers", "trigger"], ["hover-effects", "effect"]]) {
    $(id).querySelectorAll("button").forEach(button => button.onclick = () => {
      const settings = { ...twpConfig.get("hoverTranslationSettings"), [key]: button.dataset.value };
      if (settings.trigger === "direct") settings.effect = "translate";
      twpConfig.set("hoverTranslationSettings", settings);
    });
  }
  $("selection-triggers").querySelectorAll("button").forEach(button => button.onclick = () => twpConfig.set("selectionTranslationSettings", { trigger: button.dataset.value }));
  $('region-start').onclick = () => {
    const options = {service:$('engine').value,profileId:$('profile').value,expertId:$('domain').value,glossaryId:$('page-glossary').value,styleId:$('page-style').value,targetLanguage:$('target').value};
    closePanel();host.style.setProperty('visibility','hidden','important');
    twpRegionTranslator.start({capture:(rect,viewport)=>twpAIClient.call({action:'captureTranslationRegion',rect,viewport,options}),finished:error=>{
      host.style.removeProperty('visibility');if(error){openPanel();$('status').textContent=error;$('status').dataset.error='true';}
    }});
  };
  for (const tab of ["word", "region"]) $(tab + "-tab").onclick = () => {
    for (const name of ["word", "region"]) { $(name + "-settings").hidden = name !== tab; $(name + "-tab").setAttribute("aria-selected", String(name === tab)); }
    position();
  };
  $("sidebar").onclick = () => {
    closePanel();
    twpAIClient.call({ action: "openTranslationSidebar" }).catch(error => { openPanel(); $("status").textContent = error.message; });
  };
  $("engine").onchange = () => {
    // Config observers refresh the dropdown synchronously, so retain the choice first.
    const service = $("engine").value;
    if (service === "openai") twpConfig.set("pageTranslationMode", "bilingual");
    twpConfig.set("pageTranslatorService", service); controls();
  };
  $("mode").onchange = () => twpConfig.set("pageTranslationMode", $("mode").value);
  $("target").onchange = () => {
    const language = $("target").value;
    twpConfig.set("targetLanguages", [language, ...twpConfig.get("targetLanguages").filter(item => item !== language)].slice(0, 3));
    twpConfig.set("targetLanguage", language);
  };
  $("profile").onchange = () => twpConfig.set("aiActiveProfile", $("profile").value);
  $("selection-toggle").onchange = () => twpConfig.set("showTranslateSelectedButton", $("selection-toggle").checked ? "yes" : "no");
  $("hide-site").onclick = () => twpConfig.set("floatingHiddenSites", [...new Set([...twpConfig.get("floatingHiddenSites"), location.hostname])]);
  host.addEventListener("pointerenter", () => { clearTimeout(closeTimer); hoverTimer = setTimeout(() => $("tools").hidden = false, 200); });
  host.addEventListener("pointerleave", () => { clearTimeout(hoverTimer); closeTimer = setTimeout(() => { if ($("panel").hidden && !shadow.activeElement) $("tools").hidden = true; }, 250); });
  shadow.addEventListener("focusin", () => $("tools").hidden = false);
  shadow.addEventListener("focusout", () => { setTimeout(() => { if (!shadow.activeElement && $("panel").hidden) $("tools").hidden = true; }, 250); });
  shadow.addEventListener("keydown", event => { if (event.key === "Escape") { closePanel(); $("toggle").focus(); } });
  document.addEventListener("pointerdown", event => { if (!event.composedPath().includes(host)) { closePanel(); $("tools").hidden = true; } }, true);
  $("toggle").addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY }; dragged = false;
    $("toggle").setPointerCapture(event.pointerId);
  });
  $("toggle").addEventListener("pointermove", event => {
    if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
    dragged = true;
    host.style.setProperty("top", `${Math.max(66, Math.min(innerHeight - 110, event.clientY - 22))}px`, "important");
  });
  $("toggle").addEventListener("pointerup", event => {
    if (dragged) twpConfig.set("floatingPosition", { side: event.clientX < innerWidth / 2 ? "left" : "right", top: Math.max(66, Math.min(innerHeight - 110, event.clientY - 22)) / innerHeight });
    drag = null;
  });
  $("toggle").addEventListener("pointercancel", () => { drag = null; dragged = false; position(); });
  $("selection").onclick = async () => {
    await twpInteractiveTranslator.ready;
    closePanel();
    twpInteractiveTranslator.translateSelection();
  };
  window.addEventListener("pagehide", () => twpAIClient.cancel("page"));
  window.addEventListener("resize", position);
  pageTranslator.onPageLanguageStateChange(state);
  twpConfig.onChanged(() => { visibility(); controls(); position(); });
  visibility(); position(); controls(); state();
})();
