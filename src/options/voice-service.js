// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const $=id=>document.getElementById(id),key='localVoiceServiceState';
  let busy=false,polling=false;
  const labels={unknown:'尚未检测',ready:'已就绪',starting:'启动中',stopped:'未启动',error:'需要处理',unavailable:'未连接'};
  function call(action,extra={}){return new Promise((resolve,reject)=>chrome.runtime.sendMessage({action,...extra},result=>{
    if(chrome.runtime.lastError){reject(new Error(chrome.runtime.lastError.message));return;}
    if(!result?.ok){reject(new Error(result?.error||'本地服务操作失败'));return;}resolve(result);
  }));}
  function render(snapshot={}){
    $('state').textContent=labels[snapshot.state]||'检测中';$('service-message').textContent=snapshot.message||'正在检测…';
    $('service-message').classList.toggle('error',['error','unavailable'].includes(snapshot.state));
    $('model').textContent=snapshot.state==='ready'?snapshot.model||'':'';
    $('install').hidden=snapshot.bridge!==false;
    $('start').disabled=busy||['ready','starting'].includes(snapshot.state);
    $('stop').disabled=snapshot.bridge!==true||['stopped','unavailable'].includes(snapshot.state);
    for(const step of document.querySelectorAll('#startup li'))step.classList.toggle('active',step.dataset.stage===(snapshot.state==='ready'?'ready':snapshot.state==='starting'?snapshot.stage:''));
    const events=snapshot.events||[],recognized=[...events].reverse().find(row=>row.kind==='recognized');
    $('original').textContent=recognized?.text||'尚无输出';$('translated').textContent=recognized?.translated||'尚无输出';
    $('timings').textContent=recognized?.timings?`识别 ${Number(recognized.timings.recognition||0).toFixed(2)} 秒 · ${recognized.timings.translationAndSpeech!==undefined?'翻译与合成 '+recognized.timings.translationAndSpeech+' 秒':'AI 翻译 '+Number(recognized.timings.translation||0).toFixed(2)+' 秒 · 配音 '+Number(recognized.timings.speech||0).toFixed(2)+' 秒'}${recognized.translationModel?' · '+recognized.translationModel:''}（不含采集和排队）`:'';
    const playback=[...events].reverse().find(row=>['playing','idle'].includes(row.kind));
    $('playback').textContent=playback?.kind==='playing'?`正在配音 · ${playback.synchronized?'画面同步，整体缓冲约':'内容延迟约'} ${Number(playback.delay).toFixed(1)} 秒`:'等待下一段配音';
    $('spoken').textContent=playback?.kind==='playing'?playback.translated:'当前没有配音播放';
    const fragment=document.createDocumentFragment();
    for(const row of [...events].reverse()){
      const item=document.createElement('article');item.className='event';const time=document.createElement('time');time.textContent=new Date(row.at).toLocaleTimeString();
      const label=document.createElement('strong');label.textContent=({recognized:'识别与翻译完成',playing:'开始配音',idle:'配音状态',service:'模型服务'})[row.kind]||'运行状态';
      item.append(time,label);for(const text of [row.text,row.translated,row.message].filter(Boolean)){const p=document.createElement('p');p.textContent=text;item.append(p);}fragment.append(item);
    }
    $('events').replaceChildren(fragment);
  }
  async function read(){const data=await chrome.storage.session.get(key);render(data[key]);}
  async function poll(){if(polling)return;polling=true;try{await call('localVoiceServiceStatus');await read();}catch(error){$('action-message').textContent=error.message;}finally{polling=false;}}
  async function action(name){busy=true;$('start').disabled=true;$('action-message').textContent='';try{await call(name);}catch(error){$('action-message').textContent=error.message;}finally{busy=false;await read();}}
  $('ai-test').onclick=async()=>{$('ai-test').disabled=true;$('ai-result').textContent='正在调用当前自定义 AI…';try{$('ai-result').textContent=(await call('localVoiceAITranslate',{text:$('ai-sample').value})).translated;}catch(error){$('ai-result').textContent=error.message;}finally{$('ai-test').disabled=false;}};
  $('extension-id').textContent=chrome.runtime.id;
  async function showAI(){try{const info=await call('localVoiceAIInfo'),active=info.profiles.find(profile=>profile.id===info.active);$('ai-model').textContent=active?'当前模型：'+active.name+' · '+active.model:'尚未配置自定义 AI，请先在扩展 AI 设置中保存并选择模型。';}catch(error){$('ai-model').textContent=error.message;}}
  void showAI();
  $('start').onclick=()=>action('localVoiceServiceStart');$('stop').onclick=()=>action('localVoiceServiceStop');$('refresh').onclick=poll;
  $('clear').onclick=async()=>{await action('localVoiceServiceClear');};
  $('auto-start').onchange=async()=>{const selected=$('auto-start').checked;$('auto-start').disabled=true;try{await call('localVoiceServiceSettings',{autoStart:selected});$('action-message').textContent=selected?'已开启按需自动启动':'已关闭自动启动，可手动点击启动模型';}catch(error){$('auto-start').checked=!selected;$('action-message').textContent=error.message;}finally{$('auto-start').disabled=false;}};
  $('auto-stop').onchange=async()=>{const selected=$('auto-stop').checked;$('auto-stop').disabled=true;try{await call('localVoiceServiceSettings',{autoStop:selected});$('action-message').textContent=selected?'已开启，关闭最后一个视频的配音后释放内存':'已关闭，模型保持运行以便快速复用';}catch(error){$('auto-stop').checked=!selected;$('action-message').textContent=error.message;}finally{$('auto-stop').disabled=false;}};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.aiProfiles||changes.aiActiveProfile))void showAI();if(area==='session'&&changes[key])render(changes[key].newValue);if(area==='local'&&changes.localVoiceAutoStop)$('auto-stop').checked=changes.localVoiceAutoStop.newValue!==false;if(area==='local'&&changes.localVoiceAutoStart)$('auto-start').checked=changes.localVoiceAutoStart.newValue!==false;});
  void(async()=>{const settings=await chrome.storage.local.get(['localVoiceAutoStart','localVoiceAutoStop']);$('auto-stop').checked=settings.localVoiceAutoStop!==false;$('auto-start').checked=settings.localVoiceAutoStart!==false;await read();await poll();})();
  const timer=setInterval(()=>{if(!document.hidden)void poll();},2000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
