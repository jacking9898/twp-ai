// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const records=new Map(),ttl=10*60000;
  async function page(sender,operation,id,url) {
    if(!chrome.scripting?.executeScript)throw new Error('当前浏览器不支持读取播放器字幕，请更新浏览器或导入 SRT / VTT');
    const target={tabId:sender.tab.id,...(sender.documentId?{documentIds:[sender.documentId]}:{frameIds:[0]})};
    const replies=await chrome.scripting.executeScript({target,world:'MAIN',func:twpYouTubeSubtitles.pageRequest,args:[operation,id,url||null]});
    const result=replies.find(reply=>reply.frameId===0)?.result;
    if(!result||result.error)throw new Error(result?.error||'无法读取 YouTube 播放器，请刷新网页后重试');
    if(result.videoId!==id)throw new Error('字幕与当前 YouTube 视频不匹配');
    return result;
  }
  async function handle(request,sender) {
    const id=twpYouTubeSubtitles.videoId(request.pageURL||sender.url);
    // SPA navigation can leave sender.url at the original home/search page.
    // Bind its origin here; MAIN-world pageRequest verifies the current video
    // inside this sender's document before exposing any subtitle data.
    if(sender.id!==chrome.runtime.id||!sender.tab||sender.frameId!==0||!id||new URL(sender.url).origin!==new URL(request.pageURL||sender.url).origin)throw new Error('请从 YouTube 视频页面读取字幕');
    const pageURL=new URL(request.pageURL||sender.url).href;
    if(request.action==='youtubeSubtitlesRead'){
      const row=records.get(request.token);
      if(!row||row.tabId!==sender.tab.id||row.pageURL!==pageURL||row.id!==id||Date.now()-row.time>ttl)throw new Error('字幕选择已过期，请重新检测');
      const result=await page(sender,'read',id,row.url);
      const cues=twpVideoSubtitles.normalize(result.rows||twpYouTubeSubtitles.parseJSON3(JSON.parse(result.text)));
      if(!cues.length)throw new Error('YouTube 没有返回字幕文字，请开启网站 CC 后重新检测');
      return {cues};
    }
    for(const [key,row] of records)if(row.tabId===sender.tab.id||Date.now()-row.time>ttl)records.delete(key);
    const result=await page(sender,'list',id);
    const tracks=twpYouTubeSubtitles.tracks(result.response,id,result.observed).map(track=>{
      const token=crypto.randomUUID();records.set(token,{tabId:sender.tab.id,pageURL,id,url:track.url,time:Date.now()});
      const {url,...metadata}=track;return {...metadata,token};
    });
    return {tracks,title:result.title,videoKey:'youtube:'+id,notice:tracks.length?(result.live?'直播字幕可能只有已生成的部分，可重新检测更新。':''):'当前 YouTube 视频没有可读取的字幕轨道，请开启 CC 后重新检测，或导入 SRT / VTT。'};
  }
  chrome.runtime.onMessage.addListener((request,sender,respond)=>{
    if(!['youtubeSubtitlesList','youtubeSubtitlesRead'].includes(request?.action))return;
    handle(request,sender).then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message||'YouTube 字幕读取失败'}));return true;
  });
  chrome.tabs.onRemoved.addListener(tabId=>{for(const [key,row] of records)if(row.tabId===tabId)records.delete(key);});
})();
