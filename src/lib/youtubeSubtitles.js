// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpYouTubeSubtitles = (() => {
  function videoId(value) {
    try {
      const url=new URL(value);
      if(url.protocol!=='https:'||!['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname))return null;
      const id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];
      return /^[\w-]{11}$/.test(id||'')?id:null;
    }catch{return null;}
  }
  function trackURL(value,id) {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.port||url.username||url.password||!['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)||url.pathname!=='/api/timedtext'||url.searchParams.get('v')!==id||url.searchParams.has('tlang'))throw new Error('YouTube 字幕地址与当前视频不匹配');
    return url.href;
  }
  function tracks(response,id,observed=[]) {
    if(response?.videoDetails?.videoId!==id)throw new Error('YouTube 正在切换视频，请稍后重新检测字幕');
    const list=response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if(!Array.isArray(list))return [];
    const seen=new Set();
    return list.slice(0,50).flatMap(track=>{
      try {
        let url=trackURL(track.baseUrl,id);
        // Reuse the player's current signed request when available (including
        // its own session parameters). Never create or synthesize access tokens.
        for(const value of observed){try{const candidate=trackURL(value,id),params=new URL(candidate).searchParams,base=new URL(url).searchParams;if(params.get('lang')===base.get('lang')&&params.get('kind')===base.get('kind')&&params.get('name')===base.get('name'))url=candidate;}catch{}}
        const language=String(track.languageCode||new URL(url).searchParams.get('lang')||'auto').slice(0,40),automatic=track.kind==='asr';
        const trackId=JSON.stringify([String(track.vssId||''),language,automatic,new URL(url).searchParams.get('name')||'']);
        if(seen.has(trackId))return [];seen.add(trackId);
        const name=track.name?.simpleText||track.name?.runs?.map(run=>run.text||'').join('')||language;
        return [{trackId,url,language,automatic,label:String(name).slice(0,100)+(automatic?' · 自动字幕':'')}];
      }catch{return [];}
    });
  }
  function parseJSON3(body) {
    if(!Array.isArray(body?.events)||body.events.length>40000)throw new Error('YouTube 字幕格式无效或内容过长');
    const rows=[],windows=new Map();
    for(const event of body.events){
      if(!Array.isArray(event.segs))continue;
      const text=event.segs.map(segment=>typeof segment.utf8==='string'?segment.utf8:'').join('');
      if(!text.trim())continue;
      const start=Number(event.tStartMs)/1000,duration=Number(event.dDurationMs)/1000;
      if(!Number.isFinite(start)||start<0)throw new Error('YouTube 字幕时间轴无效');
      const end=start+(Number.isFinite(duration)&&duration>0?duration:5),key=event.wWinId??0,previous=windows.get(key);
      if(event.aAppend===1&&previous&&start<=previous.end){previous.text+=text;previous.end=Math.max(previous.end,end);continue;}
      if(previous&&previous.end>start){previous.end=start;if(previous.end<=previous.start)rows.splice(rows.indexOf(previous),1);}
      const row={start,end,text};rows.push(row);windows.set(key,row);
    }
    return rows;
  }
  // This function executes in the page's MAIN world. All inputs/outputs are
  // public player metadata or subtitles; no extension settings/keys enter it.
  async function pageRequest(operation,expectedId,captionURL) {
    const currentId=()=>{const url=new URL(location.href);return url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];};
    if(currentId()!==expectedId)return {error:'视频已切换，请重新检测字幕'};
    const players=[...document.querySelectorAll('.html5-video-player')];
    const player=players.find(element=>{try{return element.getVideoData?.().video_id===expectedId||element.getPlayerResponse?.()?.videoDetails?.videoId===expectedId;}catch{return false;}});
    if(player?.classList.contains('ad-showing'))return {error:'请等待广告结束后再开始字幕翻译'};
    if(operation==='list'){
      let response;
      try{response=player?.getPlayerResponse?.();}catch{}
      if(!response&&window.ytInitialPlayerResponse?.videoDetails?.videoId===expectedId)response=window.ytInitialPlayerResponse;
      if(response?.videoDetails?.videoId!==expectedId)return {error:'尚未读取到当前 YouTube 视频，请播放视频后重新检测'};
      const list=response.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
      return {videoId:expectedId,title:String(response.videoDetails.title||document.title).slice(0,200),live:!!response.videoDetails.isLiveContent,
        response:{videoDetails:{videoId:expectedId},captions:{playerCaptionsTracklistRenderer:{captionTracks:list.slice(0,50).map(track=>({baseUrl:String(track.baseUrl||'').slice(0,12000),languageCode:track.languageCode,kind:track.kind,vssId:track.vssId,name:track.name}))}}},
        observed:performance.getEntriesByType('resource').map(entry=>entry.name).filter(value=>value.startsWith('https://www.youtube.com/api/timedtext?')||value.startsWith('https://m.youtube.com/api/timedtext?')).slice(-20)};
    }
    let url=new URL(captionURL);
    if(!['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)||url.protocol!=='https:'||url.port||url.username||url.password||url.pathname!=='/api/timedtext'||url.searchParams.get('v')!==expectedId||url.searchParams.has('tlang'))return {error:'字幕地址无效'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      // A track list can be read before the player's signed caption request.
      // Refresh the address at read time and preserve every format parameter.
      for(const entry of performance.getEntriesByType('resource')){try{const candidate=new URL(entry.name);if(candidate.protocol==='https:'&&!candidate.port&&!candidate.username&&!candidate.password&&['www.youtube.com','youtube.com','m.youtube.com'].includes(candidate.hostname)&&candidate.pathname==='/api/timedtext'&&!candidate.searchParams.has('tlang')&&['v','lang','kind','name'].every(name=>candidate.searchParams.get(name)===url.searchParams.get(name)))url=candidate;}catch{}}
      let text=window.__yeduYouTubeCaptionsV1?.read(url.href);
      if(!text){
        const reply=await fetch(url.href,{credentials:'include',redirect:'error',signal:controller.signal});
        if(!reply.ok)throw new Error('已找到字幕轨道，但 YouTube 拒绝了正文请求（HTTP '+reply.status+'）。可切换一次网站 CC 后重试。');
        text=await reply.text();
        // The player may have completed its request while our replay was empty.
        if(!text.trim())text=window.__yeduYouTubeCaptionsV1?.read(url.href)||text;
      }
      if(currentId()!==expectedId)return {error:'视频已切换，请重新检测字幕'};
      if(typeof text!=='string'||text.length>3000000)throw new Error('YouTube 字幕正文格式无效或内容过长');
      if(!text.trim())throw new Error('已找到字幕轨道，但正文请求返回为空，尚未捕获播放器字幕。请关闭再开启一次网站 CC，然后重试翻译。');
      // Some tracks return XML despite fmt=json3. Parse inert XML in the page,
      // where DOMParser exists; normalize and validate again in the background.
      if(text.trim().startsWith('<')){
        const xml=new DOMParser().parseFromString(text,'application/xml');
        if(xml.querySelector('parsererror'))throw new Error('YouTube 字幕格式无效');
        const rows=[...xml.querySelectorAll('transcript > text, timedtext > body > p')].map(node=>{const modern=node.localName==='p',scale=modern?1000:1,start=Number(node.getAttribute(modern?'t':'start'))/scale,duration=Number(node.getAttribute(modern?'d':'dur'))/scale;return {start,end:start+duration,text:node.textContent};});
        if(!rows.length)throw new Error('YouTube 没有返回字幕文字');
        return {videoId:expectedId,rows};
      }
      return {videoId:expectedId,text};
    }catch(error){return {error:error.name==='AbortError'?'读取 YouTube 字幕超时，请重试':error.message};}
    finally{clearTimeout(timer);}
  }
  return {videoId,trackURL,tracks,parseJSON3,pageRequest};
})();
if(typeof module!=='undefined')module.exports=twpYouTubeSubtitles;
