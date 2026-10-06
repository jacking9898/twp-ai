// SPDX-License-Identifier: MPL-2.0
"use strict";
(() => {
  const records = new Map(), ttl = 10 * 60000;
  const playerRequests=new Map();
  // Observe only the requesting tab's own player-list URL. Do not intercept
  // response bodies, cookies or other tabs' requests. Replay happens on demand.
  chrome.webRequest?.onBeforeRequest.addListener(details=>{
    if(details.tabId<0||details.frameId!==0)return;
    const urls=(playerRequests.get(details.tabId)||[]).filter(url=>url!==details.url);
    urls.push(details.url);playerRequests.set(details.tabId,urls.slice(-8));
  },{urls:['https://api.bilibili.com/x/player/v2*','https://api.bilibili.com/x/player/wbi/v2*'],types:['xmlhttprequest']});
  // Keep only verified, downloaded timelines for this tab's last video. Session
  // storage survives page refresh and MV3 worker suspension, not browser exit.
  const timelines = new Map(), timelineTTL = 30 * 60000;
  const timelineKey = tabId => 'yeduVideoTimeline:' + tabId;
  async function savedTimelines(tabId, videoKey) {
    let saved=timelines.get(tabId);
    if(!saved && chrome.storage?.session){try{saved=(await chrome.storage.session.get(timelineKey(tabId)))[timelineKey(tabId)];}catch{}}
    return saved?.videoKey===videoKey && Date.now()-saved.time<timelineTTL ? saved.tracks : [];
  }
  async function rememberTimeline(row, cues) {
    const tracks=(await savedTimelines(row.tabId,row.videoKey)).filter(track=>track.trackId!==row.track.trackId);
    tracks.push({...row.track,cues});
    while(tracks.length>8 || (tracks.length && JSON.stringify(tracks).length>750000))tracks.shift();
    const saved={videoKey:row.videoKey,time:Date.now(),tracks};timelines.set(row.tabId,saved);
    try{await chrome.storage?.session?.set({[timelineKey(row.tabId)]:saved});}catch{/* Quota failures must not interrupt subtitles. */}
  }
  const bilibili = url => url.protocol === 'https:' && ['www.bilibili.com', 'm.bilibili.com'].includes(url.hostname);
  async function json(url, credentials = 'include') {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {credentials, signal:controller.signal, redirect:'error'});
      if (!response.ok) throw new Error('字幕服务器返回错误，请稍后重试');
      const text = await response.text();
      if (text.length > 3000000) throw new Error('字幕数据过大，请导入分段字幕文件');
      return JSON.parse(text);
    } catch (error) {if (error.name === 'AbortError') throw new Error('读取字幕超时，请重试');throw error;}
    finally {clearTimeout(timer);}
  }
  async function api(path, params) {
    const result = await json('https://api.bilibili.com' + path + '?' + new URLSearchParams(params));
    if (result.code !== 0) throw new Error('B 站字幕接口暂不可用，请登录 B 站后重试或导入字幕文件');
    return result.data || result.result;
  }
  function safeSubtitleURL(value) {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !/(^|\.)(hdslb\.com|bilibili\.com)$/.test(url.hostname) || !/^\/bfs\/(ai_)?subtitle\//.test(url.pathname)) throw new Error('字幕下载地址不受支持，请使用字幕文件');
    return url.href;
  }
  function issueTracks(tracks, context) {
    if (!Array.isArray(tracks) || tracks.length>50) return [];
    return tracks.flatMap(track=>{
      try {
        const token=crypto.randomUUID(), subtitleURL=safeSubtitleURL(track.subtitle_url);
        // A language is not a track identity: two English tracks can have
        // different text/timing. Ignore signed query parameters for stability.
        const trackId=String(track.id_str || track.id || new URL(subtitleURL).pathname).slice(0,1000);
        const item={trackId,label:String(track.lan_doc||track.lan||'字幕').slice(0,100),language:String(track.lan||'auto').replace(/^ai-/,'').slice(0,40)};
        records.set(token,{...context,kind:'subtitle',time:Date.now(),url:subtitleURL,track:item});
        return [{token,...item}];
      }catch{return [];}
    });
  }
  async function handle(request, sender) {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !bilibili(new URL(sender.url))) throw new Error('请从 B 站视频页面读取字幕');
    const url = new URL(request.pageURL || sender.url);
    if (!bilibili(url) || url.origin !== new URL(sender.url).origin) throw new Error('视频地址无效');
    const tabId = sender.tab.id;
    if (request.action === 'videoSubtitlesRead' || request.action === 'videoSubtitlesPageList') {
      const row = records.get(request.token);
      if (!row || row.tabId !== tabId || row.pageURL !== url.href || Date.now() - row.time > ttl) throw new Error('字幕选择已过期，请重新检测');
      if(request.action==='videoSubtitlesPageList') {
        if(row.kind!=='list')throw new Error('字幕列表令牌无效');
        if((request.aid!=null&&String(request.aid)!==String(row.aid))||(request.cid!=null&&String(request.cid)!==String(row.cid)))throw new Error('字幕接口返回了其他视频的轨道，请重新检测');
        const tracks=issueTracks(request.tracks,row);records.delete(request.token);
        return {tracks,title:row.title,videoKey:row.videoKey,notice:!tracks.length?'当前登录状态未返回可读字幕，请开启网站字幕后重试。':''};
      }
      if(row.kind!=='subtitle')throw new Error('字幕选择令牌无效');
      const body = await json(row.url, 'omit');
      const cues=twpVideoSubtitles.normalize(body.body);
      await rememberTimeline(row,cues);
      return {cues};
    }
    for (const [key, row] of records) if (row.tabId === tabId || Date.now() - row.time > ttl) records.delete(key);
    let aid, cid, title, bvid;
    const video = url.pathname.match(/^\/video\/(BV[\w]+|av\d+)/i), episode = url.pathname.match(/^\/bangumi\/play\/ep(\d+)/);
    if (video) {
      const data = await api('/x/web-interface/view', video[1].toLowerCase().startsWith('av') ? {aid:video[1].slice(2)} : {bvid:video[1]});
      if(video[1].toLowerCase().startsWith('av')?String(data.aid)!==video[1].slice(2):data.bvid!==video[1])throw new Error('视频元数据与当前视频不匹配，请重新检测');
      const page = Number(url.searchParams.get('p') || 1), entry = data.pages?.find(row => row.page === page);
      if (!entry) throw new Error('找不到当前分 P，请刷新视频页面后重试');
      ({aid, title, bvid} = data);cid = entry.cid;title += entry.part ? ' · ' + entry.part : '';
    } else if (episode) {
      const data = await api('/pgc/view/web/season', {ep_id:episode[1]});
      const entry = [...(data.episodes || []), ...(data.section || []).flatMap(section => section.episodes || [])].find(row => String(row.id) === episode[1]);
      if (!entry) throw new Error('找不到当前剧集，请刷新后重试');
      ({aid, cid} = entry);title = data.title + ' · ' + (entry.long_title || entry.title || '');
    } else throw new Error('请打开具体的 B 站视频或剧集页面');
    const player = await api('/x/player/v2', {aid, cid});
    if((player.aid!=null&&String(player.aid)!==String(aid))||(player.cid!=null&&String(player.cid)!==String(cid))||(bvid&&player.bvid!=null&&player.bvid!==bvid))throw new Error('字幕接口返回了其他视频的轨道，请重新检测');
    const videoKey=`bilibili:${aid}:${cid}`, name=String(title).slice(0,200), tracks=issueTracks((player.subtitle?.subtitles||[]).slice(0,50),{tabId,pageURL:url.href,videoKey});
    const retained=(await savedTimelines(tabId,videoKey)).filter(track=>!tracks.some(current=>current.trackId===track.trackId));
    tracks.push(...retained);
    // A nonempty response can still omit tracks available to the web session.
    const pageToken=crypto.randomUUID();records.set(pageToken,{kind:'list',tabId,pageURL:url.href,time:Date.now(),title:name,videoKey,aid,cid});
    return {tracks,title:name,videoKey,aid,cid,bvid,playerURLs:twpVideoSubtitles.playerAPIURLs(playerRequests.get(tabId)||[],{aid,cid,bvid}),pageToken,notice:retained.length?'接口暂未返回完整列表；保留此前已读取的字幕。':!tracks.length && player.need_login_subtitle ? '请先登录 B 站，再点击「重新检测字幕」。' : ''};
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!['videoSubtitlesList', 'videoSubtitlesRead','videoSubtitlesPageList'].includes(request?.action)) return;
    handle(request, sender).then(result => respond({ok:true, ...result}), error => respond({ok:false, error:error.message || '字幕读取失败，请重试'}));return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {for (const [key,row] of records) if (row.tabId === tabId) records.delete(key);playerRequests.delete(tabId);timelines.delete(tabId);void chrome.storage?.session?.remove(timelineKey(tabId)).catch(()=>{});});
})();
