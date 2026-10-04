"use strict";
void(async()=>{
 await twpConfig.onReady();
 const $=id=>document.getElementById(id);let revision=0,busy=false,historyPage=0,refreshSerial=0;
 const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').dataset.error=String(error);};
 const n=value=>value===null||value===undefined?'未知':value.toLocaleString();
 function summary(prefix,value){$(prefix+'-total').textContent=n(value.total||0);$(prefix+'-detail').textContent=`已上报输入 ${n(value.input||0)} / 输出 ${n(value.output||0)} · 请求批次 ${value.requests||0} 次（${value.unknown||0} 次用量未知）· 本地缓存 ${value.cacheHits||0} 次`;}
 function stats(data){
  historyPage=data.page;$('history-size').value=String(data.pageSize);const pages=Math.max(1,Math.ceil(data.eventCount/data.pageSize));
  $('history-page').replaceChildren(...Array.from({length:pages},(_,i)=>new Option(`第 ${i+1} 页`,String(i))));$('history-page').value=String(historyPage);$('history-page').disabled=data.eventCount===0;
  $('history-previous').disabled=historyPage===0;$('history-next').disabled=historyPage>=pages-1;
  $('history-previous').title=historyPage===0?'已是第一页':'查看上一页';$('history-next').title=historyPage>=pages-1?'已是最后一页':'查看下一页';
  $('history-count').textContent=data.eventCount?`第 ${historyPage*data.pageSize+1}–${historyPage*data.pageSize+data.events.length} 条 / 共 ${data.eventCount} 条`:'暂无请求记录';
  summary('current',data.current);summary('all',data.total);$('history').replaceChildren(...data.events.map(row=>{const tr=document.createElement('tr');for(const value of [new Date(row.time).toLocaleString(),`${row.profile} / ${row.model}`,row.cached?'本地缓存':({terms:'术语提取',test:'连接测试',translation:'翻译'}[row.kind]||row.kind),row.origin||'未记录（旧版请求）',...['input','output','total','cachedInput','reasoning'].map(k=>row.cached?'0':n(row.usage[k]))]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));}
 function entries(){const lines=$('terms').value.split(/\r?\n/).filter(s=>s.trim());return lines.map(line=>{const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw new Error('每行请使用：原文 = 译文');return [line.slice(0,at).trim(),line.slice(at+1).trim()];});}
 function fillTerms(value){revision=value.revision;$('terms').value=value.entries.map(e=>e.join(' = ')).join('\n');}
 function working(value){busy=value;for(const id of ['extract','save-terms','empty-terms','profile','target','terms'])$(id).disabled=value;$('cancel-extract').disabled=!value;}
 async function refresh(load=false){const serial=++refreshSerial;const result=await twpAIClient.call({action:'aiInsightRead',page:historyPage,pageSize:Number($('history-size').value),targetLanguage:$('target').value||undefined});if(serial!==refreshSerial)return result;stats(result.stats);if(load){const snapshot=result.snapshot;$('scope').textContent=snapshot?.title||'全部 AI 用量历史';$('terms-card').hidden=!snapshot?.source;if(snapshot){$('target').value=snapshot.target;$('scope-help').textContent=snapshot.source.startsWith('pdf:')?'按 PDF 文件内容的 SHA-256 指纹和目标语言保存。重命名不会丢失；修改内容后的文件是另一份文档。当前页提取的词条可用于整份 PDF，换页后重新打开此页可继续补充。':'按完整网页 URL（含查询参数和片段）及目标语言保存，只用于这一网页；相同地址的后续访问可复用。';$('sample-info').textContent=`此次提取使用 ${Math.min(16000,snapshot.length)} / ${snapshot.length} 字符${snapshot.length>16000?'（只取前 16,000 字符）':''}。快照在 30 分钟后失效，关闭此页即清除。`;} $('profile').replaceChildren(...result.profiles.map(v=>new Option(v.name+' · '+v.model,v.id)));if(result.profiles.some(p=>p.id===snapshot?.profileId))$('profile').value=snapshot.profileId;fillTerms(result.terms);}return result;}
 $('target').replaceChildren(...Object.entries(twpLang.getLanguageList()).map(([id,name])=>new Option(name,id)));$('target').value='';
 $('target').onchange=async()=>{try{const r=await twpAIClient.call({action:'aiInsightRead',targetLanguage:$('target').value});fillTerms(r.terms);}catch(e){notice(e.message,true);}};
 $('refresh').onclick=()=>refresh().catch(e=>notice(e.message,true));
 const changePage=page=>{historyPage=page;void refresh().catch(e=>notice(e.message,true));};
 $('history-previous').onclick=()=>changePage(Math.max(0,historyPage-1));
 $('history-next').onclick=()=>changePage(historyPage+1);
 $('history-size').onchange=()=>changePage(0);
 $('history-page').onchange=()=>changePage(Number($('history-page').value));
 async function clearHistory(resetTotals){
  if(!confirm(resetTotals?'重置全部 AI 用量？本次和历史累计统计将清零，请求明细也会删除。专属术语和翻译缓存会保留。':'清空请求明细？顶部本次和历史累计统计、专属术语和翻译缓存都会保留。'))return;
  try{await twpAIClient.call({action:'aiInsightClear',resetTotals});historyPage=0;await refresh();notice(resetTotals?'用量统计和请求明细已重置':'请求明细已清空，累计统计已保留');}catch(e){notice(e.message,true);}
 }
 $('clear-usage').onclick=()=>clearHistory(false);$('reset-usage').onclick=()=>clearHistory(true);
 $('extract').onclick=async()=>{if(!$('profile').value)return notice('请先在模型设置中保存 AI 服务',true);let original;try{original=entries();}catch(e){return notice(e.message,true);}working(true);notice('正在提取候选术语…');try{const result=await twpAIClient.call({action:'aiInsightExtract',profileId:$('profile').value,targetLanguage:$('target').value});const merged=new Map(result.entries.map(e=>[e[0].toLocaleLowerCase(),e]));for(const entry of original)merged.set(entry[0].toLocaleLowerCase(),entry);if(merged.size>200)throw new Error('合并后超过 200 条，请先精简现有术语后重试');$('terms').value=[...merged.values()].map(e=>e.join(' = ')).join('\n');notice(`提取 ${result.entries.length} 条候选词，尚未保存。此次 token：${n(result.usage?.total)}。`);}catch(e){notice(e.message,true);}finally{working(false);await refresh().catch(()=>{});}};
 $('cancel-extract').onclick=()=>twpAIClient.call({action:'aiCancel',ids:['terms']}).catch(e=>notice(e.message,true));
 $('save-terms').onclick=async()=>{try{const result=await twpAIClient.call({action:'aiInsightSave',targetLanguage:$('target').value,entries:entries(),revision});fillTerms(result.terms);notice('已保存，后续 AI 翻译将使用此文档术语；已有译文请手动重新翻译。');}catch(e){notice(e.message,true);}};
 $('empty-terms').onclick=()=>{$('terms').value='';notice('编辑框已清空，点击保存后才会移除已保存的术语。');};
 working(true);try{await refresh(true);working(false);}catch(e){notice(e.message,true);$('terms-card').hidden=true;}
 const timer=setInterval(()=>{if(!document.hidden&&!busy&&historyPage===0)void refresh().catch(()=>{});},5000);window.addEventListener('pagehide',()=>clearInterval(timer));
})();
