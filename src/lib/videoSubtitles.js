// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpVideoSubtitles = (() => {
  function clean(text) {
    return String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<(?:\/?(?:b|i|u|ruby|rt|c|v|lang|font)(?:[.\s][^>]*)?|(?:\d+:)?\d{2}:\d{2}\.\d{3})>/gi, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[key]).trim();
  }
  function normalize(rows) {
    if (!Array.isArray(rows) || rows.length > 20000) throw new Error('字幕数量过多，请导入分段字幕文件');
    const seen = new Set(); let size = 0;
    const cues = rows.map(row => {
      const start = row.start ?? row.from, end = row.end ?? row.to, text = clean(row.text ?? row.content);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 7 * 86400 || text.length > 3000) throw new Error('字幕时间轴或文字无效');
      size += text.length;
      if (size > 1000000) throw new Error('字幕内容过长，请使用分段字幕文件');
      return {start, end, text, id: JSON.stringify([start, end, text])};
    }).filter(cue => cue.text && !seen.has(cue.id) && seen.add(cue.id));
    return cues.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function upcoming(cues, time, translations, seconds = 60) {
    return cues.filter(cue => cue.end > time && cue.start < time + seconds && !translations.has(cue.id));
  }
  function active(cues, time) {return cues.filter(cue => cue.start <= time && cue.end > time);}
  function language(value) {
    const code=String(value || 'auto').toLowerCase().replace(/^ai-/,'').replace(/_/g,'-');
    if (/^zh(?:-|$)/.test(code)) return /^zh-(?:tw|hk|hant)/.test(code) ? 'zh-hant' : 'zh-hans';
    return code.split('-')[0];
  }
  function preferredSource(sources, target, previousKey) {
    const previous=sources.findIndex(source=>source.key===previousKey);
    if(previous>=0)return previous;
    const translatedLanguage=language(target), isOriginal=source=>language(source.language)!=='auto'&&language(source.language)!==translatedLanguage;
    // Prefer the site's independently fetched timeline over injected tracks
    // (which can include another extension's translated captions).
    const platform=sources.findIndex(source=>source.kind==='bilibili'&&isOriginal(source));
    if(platform>=0)return platform;
    const original=sources.findIndex(isOriginal);
    return original>=0?original:0;
  }
  function playerAPIURLs(entries, video) {
    const valid=[];
    for(const value of entries){
      try{
        const url=new URL(value),params=url.searchParams;
        if(url.origin!=='https://api.bilibili.com'||url.username||url.password||!['/x/player/v2','/x/player/wbi/v2'].includes(url.pathname))continue;
        if(params.get('cid')!==String(video.cid))continue;
        if(params.has('aid')?params.get('aid')!==String(video.aid):!video.bvid||params.get('bvid')!==video.bvid)continue;
        if(!valid.includes(url.href))valid.push(url.href);
      }catch{}
    }
    return valid.slice(-3);
  }
  function displayText(cue, translation, mode='bilingual') {
    if (translation==null || !String(translation).trim()) return mode==='translated'?'':cue.text;
    if (mode==='translated' || clean(translation).replace(/\s+/g,' ')===clean(cue.text).replace(/\s+/g,' ')) return translation;
    return cue.text+'\n'+translation;
  }
  function timestamp(seconds) {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  function parseFile(text) {
    if (text.length > 200000) throw new Error('字幕文件最多 200,000 字符');
    const seconds = value => {const parts = value.replace(',', '.').split(':').map(Number);return parts.reduce((total, part) => total * 60 + part, 0);};
    const rows = [];
    for (const block of text.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/)) {
      if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(block.trim())) continue;
      const lines = block.split(/\r?\n/), index = lines.findIndex(line => line.includes('-->'));
      if (index < 0) {if (block.trim()) throw new Error('请使用包含时间轴的 SRT / VTT 字幕');continue;}
      const match = lines[index].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/);
      if (!match) throw new Error('字幕时间轴格式无效');
      rows.push({start:seconds(match[1]), end:seconds(match[2]), text:lines.slice(index + 1).join('\n')});
    }
    const cues = normalize(rows);if (!cues.length) throw new Error('字幕文件没有文字');return cues;
  }
  function exportSRT(cues, translations, bilingual = true) {
    return cues.filter(cue => translations.has(cue.id)).map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${bilingual ? cue.text + '\n' : ''}${translations.get(cue.id).replace(/\n\s*\n/g, '\n')}\n`).join('\n');
  }
  return {clean, normalize, upcoming, active, exportSRT, parseFile, language, preferredSource, displayText, playerAPIURLs};
})();
if (typeof module !== 'undefined') module.exports = twpVideoSubtitles;
