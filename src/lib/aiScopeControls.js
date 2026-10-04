// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpAIScopeControls = (() => {
  function create({root, fields, notice, reset, scopeLabel, onSaved = () => {}, onBusy = () => {}}) {
    let settings = {}, revision = 0, documentKey, source = '', version = 0, loading = true, privateContext = false;
    const $ = id => root.querySelector('#' + id);
    const catalogs = () => ({expertId:twpAIPresets.allExperts(twpConfig.get('aiCustomExperts')), styleId:twpAIPresets.styles, glossaryId:twpAIPresets.allGlossaries(twpConfig.get('aiCustomGlossaries'))});
    function refresh() {
      const defaults = twpConfig.get('aiTranslationSettings');
      for (const [key, catalog] of Object.entries(catalogs())) {
        const globalId = {expertId:defaults.domain,styleId:defaults.styleId,glossaryId:twpAIPresets.normalizeGlossaryId(defaults.glossaryId)}[key];
        const name = catalog.find(item => item.id === globalId)?.name || '默认设置';
        $(fields[key]).replaceChildren(new Option('跟随全局 · ' + name, ''), ...catalog.map(item => new Option(item.name, item.id)));
        $(fields[key]).value = settings[key] || '';
        if (!$(fields[key]).value) delete settings[key];
        $(fields[key]).disabled = loading || privateContext || !source;
      }
      $(reset).disabled = loading || privateContext || !source || !Object.keys(settings).length;
    }
    async function load(key) {
      const token = ++version;
      documentKey = key; loading = true; settings = {}; source = ''; refresh();
      if (key === null) {loading = false; $(notice).textContent = '打开 PDF 后可单独设置'; refresh(); return;}
      try {
        const row = await twpAIClient.call({action:'aiScopeRead',documentKey:key});
        if (token !== version) return;
        ({settings,revision,source,privateContext} = row);
        $(notice).textContent = privateContext ? '无痕窗口使用全局设置，不保存文档偏好。' : `仅用于${scopeLabel}，自动保存。术语库与已保存的专属术语合并使用。`;
      } catch (error) {if (token === version) $(notice).textContent = error.message;}
      finally {if (token === version) {loading = false; refresh();}}
    }
    async function save(value) {
      if (loading || privateContext || !source) return;
      const token = version; loading = true; refresh(); onBusy(true);
      try {
        const row = await twpAIClient.call({action:'aiScopeSave',documentKey,settings:value,revision});
        if (token !== version) return;
        ({settings,revision} = row);
        onSaved();
        $(notice).textContent = `已保存${scopeLabel}的 AI 设置；已有译文需要重新翻译。`;
      } catch (error) {if (token === version) $(notice).textContent = error.message;}
      finally {if (token === version) {loading = false; refresh();} onBusy(false);}
    }
    for (const [key,id] of Object.entries(fields)) $(id).onchange = () => {
      const value = {...settings};
      if ($(id).value) value[key] = $(id).value; else delete value[key];
      void save(value);
    };
    $(reset).onclick = () => void save({});
    return {load,refresh};
  }
  return {create};
})();
