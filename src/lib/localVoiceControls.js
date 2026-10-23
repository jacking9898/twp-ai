// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpLocalVoiceControls = (() => {
  function mount(anchor,{prepend=false}={}) {
    const card=document.createElement('div');card.id='voice-service-controls';
    card.innerHTML=`<style>
      #voice-service-controls{padding:12px;margin:0 0 14px;border:1px solid var(--accent);border-radius:11px;background:var(--tint,var(--surface));color:var(--fg)}
      #voice-service-controls #voice-manager{display:block;width:100%;padding:9px 10px;background:var(--accent);color:var(--accent-ink,#fff);border:1px solid var(--accent);border-radius:8px;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
      #voice-service-controls label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 0;font-size:12px;color:var(--fg)}
      #voice-service-controls input{width:18px;height:18px;flex:none;accent-color:var(--accent)}
      #voice-service-controls small{display:block;font-size:11px;line-height:1.6;color:var(--muted);margin-top:5px}
      #voice-service-controls #voice-memory-status{margin:6px 0 0;font-size:11px;color:var(--muted)}
    </style><button id="voice-manager" type="button">本地模型服务 · 释放内存 ↗</button><label for="voice-auto-stop"><span>关闭语音翻译后自动释放内存</span><input id="voice-auto-stop" type="checkbox" role="switch" checked></label><small>最后一个视频关闭配音后停止模型；暂停不影响。</small><p id="voice-memory-status" role="status" aria-live="polite"></p>`;
    if(prepend)anchor.prepend(card);else anchor.after(card);
    const toggle=card.querySelector('#voice-auto-stop'),status=card.querySelector('#voice-memory-status');let disposed=false;
    card.querySelector('#voice-manager').onclick=()=>twpAIClient.call({action:'localVoiceServiceOpen'}).catch(error=>{status.textContent=error.message;});
    toggle.onchange=async()=>{
      const selected=toggle.checked;toggle.disabled=true;
      try{await twpAIClient.call({action:'localVoiceServicePreferences',autoStop:selected});status.textContent=selected?'已开启，关闭最后一个视频的配音后释放内存':'已关闭，模型保持运行以便快速复用';}
      catch(error){toggle.checked=!selected;status.textContent=error.message;}
      finally{toggle.disabled=false;}
    };
    const changed=(changes,area)=>{if(area==='local'&&changes.localVoiceAutoStop)toggle.checked=changes.localVoiceAutoStop.newValue!==false;};
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.local.get('localVoiceAutoStop').then(data=>{if(!disposed&&!toggle.disabled)toggle.checked=data.localVoiceAutoStop!==false;}).catch(error=>{status.textContent=error.message;});
    return ()=>{disposed=true;chrome.storage.onChanged.removeListener(changed);card.remove();};
  }
  return {mount};
})();
