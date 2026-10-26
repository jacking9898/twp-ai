// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpAIScopeControls = (() => {
  function create({root, fields, notice, reset, scopeLabel, scopeField, onSaved = () => {}, onBusy = () => {}}) {
    let settings = {}, inheritedSettings = {}, revision = 0, pageRevision = 0, documentKey, source = '', version = 0, loading = true, privateContext = false, scopeChosen = false;
    const $ = id => root.querySelector('#' + id);
    const scope=()=>scopeField?$(scopeField).value:undefined;
    const label=()=>scopeField?(scope()==='site'?'本网站':'此网页'):scopeLabel;
    const catalogs = () => ({expertId:twpAIPresets.allExperts(twpConfig.get('aiCustomExperts')), styleId:twpAIPresets.styles, glossaryId:twpAIPresets.allGlossaries(twpConfig.get('aiCustomGlossaries'))});
    function refresh() {
      const defaults = twpConfig.get('aiTranslationSettings');
      for (const [key, catalog] of Object.entries(catalogs())) {
        const globalId = inheritedSettings[key] || {expertId:defaults.domain,styleId:defaults.styleId,glossaryId:twpAIPresets.normalizeGlossaryId(defaults.glossaryId)}[key];
        const name = catalog.find(item => item.id === globalId)?.name || '默认设置';
        $(fields[key]).replaceChildren(new Option((inheritedSettings[key]?'跟随网站':'跟随全局')+' · ' + name, ''), ...catalog.map(item => new Option(item.name, item.id)));
        $(fields[key]).value = settings[key] || '';
        if (!$(fields[key]).value) delete settings[key];
        $(fields[key]).disabled = loading || privateContext || !source;
      }
      $(reset).disabled = loading || privateContext || !source || !Object.keys(settings).length;
      $(reset).textContent=scopeField&&scope()==='page'?'恢复跟随网站':'恢复跟随全局';
      if(scopeField)$(scopeField).disabled=loading||privateContext;
    }
    async function load(key) {
      const token = ++version;
      documentKey = key; loading = true; settings = {}; inheritedSettings = {}; source = ''; refresh();
      if (key === null) {loading = false; $(notice).textContent = '打开 PDF 后可单独设置'; refresh(); return;}
      try {
        const row = await twpAIClient.call({action:'aiScopeRead',documentKey:key,scope:scope()});
        if (token !== version) return;
        // Older page-only selections stay visible and keep their original
        // scope until the user explicitly applies them to the website.
        if(scopeField&&!scopeChosen&&scope()==='site'&&row.hasPageSettings){$(scopeField).value='page';return load(key);}
        ({settings,revision,pageRevision,source,privateContext} = row);inheritedSettings=row.inheritedSettings||{};
        $(notice).textContent = privateContext ? '无痕窗口使用全局设置，不保存文档偏好。' : scopeField&&scope()==='site'?'用于本站文章，自动保存；仅此网页的设置优先。修改本站设置后，本页也会使用新选择。':`仅用于${label()}，自动保存。术语库与已保存的专属术语合并使用。`;
      } catch (error) {if (token === version) $(notice).textContent = error.message;}
      finally {if (token === version) {loading = false; refresh();}}
    }
    async function save(value) {
      if (loading || privateContext || !source) return;
      const token = version; loading = true; refresh(); onBusy(true);
      try {
        const row = await twpAIClient.call({action:'aiScopeSave',documentKey,settings:value,revision,pageRevision,scope:scope()});
        if (token !== version) return;
        ({settings,revision,pageRevision} = row);
        onSaved();
        $(notice).textContent = `已保存${label()}的 AI 设置；已有译文需要重新翻译。`;
      } catch (error) {if (token === version) $(notice).textContent = error.message;}
      finally {if (token === version) {loading = false; refresh();} onBusy(false);}
    }
    for (const [key,id] of Object.entries(fields)) $(id).onchange = () => {
      const value = {...settings};
      if ($(id).value) value[key] = $(id).value; else delete value[key];
      void save(value);
    };
    $(reset).onclick = () => void save({});
    if(scopeField)$(scopeField).onchange=()=>{
      scopeChosen=true;
      const promote=scope()==='site'?{...settings}:null;
      void load(documentKey).then(()=>{if(promote&&Object.keys(promote).length&&!loading&&!privateContext)return save({...settings,...promote});});
    };
    return {load,refresh};
  }
  return {create};
})();
