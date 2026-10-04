// SPDX-License-Identifier: MPL-2.0
'use strict';
void (async()=>{
  await twpConfig.onReady();
  const $=id=>document.getElementById(id),selected=new Set();
  let offset=0,total=0,rows=[],version=0,busy=false;
  const free=()=>$('kind').value==='free';
  const action=verb=>(free()?'free':'ai')+'Cache'+verb;
  const status=(text='',error=false)=>{$('status').textContent=text;$('status').style.color=error?'var(--error)':'';};
  function controls(){
    $('selected').textContent=selected.size?`已选择 ${selected.size} 条`:'未选择';$('delete').disabled=busy||!selected.size;
    $('select-all').checked=!!rows.length && selected.size===rows.length;$('select-all').indeterminate=!!selected.size&&selected.size<rows.length;
    $('select-all').disabled=busy||!rows.length;
    $('previous').disabled=busy||offset===0;$('next').disabled=busy||offset+rows.length>=total;
    for(const id of ['kind','database','query','refresh'])$(id).disabled=busy;
    $('page-count').textContent=total?`${offset+1}–${offset+rows.length} / ${total} 条`:'0 条';
    for(const box of $('entries').querySelectorAll('input'))box.disabled=busy;
  }
  async function detail(key){
    const isFree=free();
    try{const {entry}=await twpAIClient.call({action:action('Read'),key,database:$('database').value});
      if(!entry)return status('这条缓存已删除或过期，请刷新列表。');
      $('detail-text').textContent=isFree?`原文\n${entry.originalText}\n\n译文\n${entry.translatedText}`:entry.translations.join('\n\n');$('detail').showModal();
    }catch(error){status(error.message,true);}
  }
  function render(){
    const nodes=rows.map(row=>{
      const article=document.createElement('article');article.className='cache-entry';
      const heading=document.createElement('div');heading.className='cache-heading';
      const label=document.createElement('label');label.className='selection';
      const box=document.createElement('input');box.type='checkbox';box.dataset.key=row.key;box.setAttribute('aria-label','选择缓存');
      box.onchange=()=>{box.checked?selected.add(row.key):selected.delete(row.key);controls();};label.append(box);
      const info=document.createElement('div'),title=document.createElement('h2'),meta=document.createElement('p'),m=row.metadata||{};
      title.textContent=m.context||m.service||'旧版记录 · 来源信息未记录';meta.className='cache-meta';
      meta.textContent=[m.service,m.model,m.kind, m.targetLanguage?`${m.sourceLanguage||'auto'} → ${m.targetLanguage}`:'',row.createdAt?new Date(row.createdAt).toLocaleString():'保存时间未记录',row.expiresAt?`有效至 ${new Date(row.expiresAt).toLocaleString()}`:''].filter(Boolean).join(' · ');
      info.append(title,meta);const button=document.createElement('button');button.type='button';button.textContent='查看全文';button.onclick=()=>detail(row.key);
      heading.append(label,info,button);const preview=document.createElement('p');preview.className='cache-preview';preview.textContent=(row.originalPreview?`原文：${row.originalPreview}\n译文：`:'')+row.preview;
      article.append(heading,preview);return article;
    });
    if(!nodes.length){const empty=document.createElement('p');empty.textContent=$('query').value?'没有找到匹配的缓存。':'暂无已保存的缓存。';nodes.push(empty);}
    $('entries').replaceChildren(...nodes);controls();
  }
  async function load(reset=false){
    if(reset)offset=0;
    const token=++version;selected.clear();busy=true;controls();status('正在读取缓存…');
    try {
      if(free()&&!$('database').value){rows=[];total=0;render();status('免费服务暂无本机缓存；需启用磁盘缓存后才会保存。');return;}
      const result=await twpAIClient.call({action:action('List'),database:$('database').value,query:$('query').value,offset,limit:30});
      if(token!==version)return;rows=result.entries;total=result.total;
      if(offset>=total && offset>0){offset=Math.max(0,Math.floor((total-1)/30)*30);return await load();}
      render();status();
    }catch(error){if(token===version){rows=[];total=0;render();status(error.message,true);}}
    finally{if(token===version){busy=false;controls();}}
  }
  async function chooseKind(){
    $('database-label').hidden=!free();$('query').placeholder=free()?'搜索原文或译文…':'来源标题、模型或译文…';
    $('hint').textContent=free()?'免费翻译的磁盘缓存按服务与语言保存，支持查看原文和译文。未启用磁盘缓存时，临时内存结果不列在这里。删除后，下一次翻译会重新请求；当前网页上已显示的译文仍保留。':'AI 缓存保存译文及来源标题，不保存原文或密钥。旧记录可能没有来源信息。这里只显示仍有效的本机缓存，已显示在网页上的译文不会随删除立即消失。';
    try{if(free()){const {names}=await twpAIClient.call({action:'freeCacheNames'});$('database').replaceChildren(...names.map(name=>new Option(name,name)));}await load(true);}catch(error){status(error.message,true);}
  }
  $('kind').onchange=chooseKind;$('database').onchange=()=>load(true);$('refresh').onclick=chooseKind;
  let searchTimer;$('query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(true),300);};
  $('previous').onclick=()=>{offset=Math.max(0,offset-30);void load();};$('next').onclick=()=>{offset+=30;void load();};
  $('select-all').onchange=()=>{for(const box of $('entries').querySelectorAll('input')){box.checked=$('select-all').checked;box.checked?selected.add(box.dataset.key):selected.delete(box.dataset.key);}controls();};
  $('delete').onclick=async()=>{const count=selected.size;busy=true;controls();try{await twpAIClient.call({action:action('Delete'),keys:[...selected],database:$('database').value});await load();status(`已删除 ${count} 条缓存。`);}catch(error){status(error.message,true);}finally{busy=false;controls();}};
  $('close').onclick=()=>$('detail').close();await chooseKind();
})().catch(()=>{});
