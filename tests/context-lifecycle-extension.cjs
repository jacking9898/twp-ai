// SPDX-License-Identifier: MPL-2.0
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
  const extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
  const profile=fs.mkdtempSync(path.resolve('build/context-lifecycle-profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:process.platform==='win32'?'msedge':'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const errors=[];
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.stack || error.message)));
  try {
    let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const id=worker.url().split('/')[2];
    await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pageTranslationMode','bilingual');});
    await context.route('https://video-lifecycle.test/**',route=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).pathname==='/player'?'<html><body><video controls></video><p>Player captions.</p></body></html>':'<html lang="en"><head><title>Video page</title></head><body><video controls></video><p id="paragraph">Video description in English.</p><iframe src="/player"></iframe></body></html>'}));
    const page=await context.newPage();await page.goto('https://video-lifecycle.test/watch');await expect(page.locator('#twp-floating')).toBeVisible();
    const otherVideo=await context.newPage();await otherVideo.goto('https://video-lifecycle.test/watch?p=2');await expect(otherVideo.locator('#twp-floating')).toBeVisible();
    expect(page.frames()).toHaveLength(2);
    const focusFrames=async()=>{for(const frame of page.frames())await frame.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});};
    const shortcuts=async()=>{for(const frame of page.frames())await frame.evaluate(()=>{
      const range=document.createRange();range.selectNodeContents(document.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(range);
      for(let i=0;i<2;i++)document.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true}));getSelection().removeAllRanges();
    });};
    await focusFrames();expect(errors).toEqual([]);
    await page.reload();await expect(page.locator('#twp-floating')).toBeVisible();await focusFrames();expect(errors).toEqual([]);
    // Real extension reload leaves the old page's listeners alive in invalidated worlds.
    const restarted=context.waitForEvent('serviceworker',w=>w.url().includes(id));
    await worker.evaluate(()=>chrome.runtime.reload()).catch(error=>{if(!/closed|destroyed|Target/i.test(error.message))throw error;});
    worker=await restarted;await worker.evaluate(()=>twpConfig.onReady());
    for(let i=0;i<3;i++){await shortcuts();await focusFrames();}
    for(const frame of otherVideo.frames())await frame.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));
    });
    expect(errors,'old main-frame/player focus handlers must stop safely when the extension is reloaded').toEqual([]);
    // Bilibili-style episode switching retains the document but replaces its player frame.
    await page.evaluate(()=>{history.pushState({},'',location.pathname+'?p=3');document.querySelector('iframe').src='/player?p=3';});
    await expect.poll(()=>page.frames().filter(frame=>frame.url().includes('/player?p=3')).length).toBe(1);
    await focusFrames();await shortcuts();expect(errors).toEqual([]);
    // Refreshing the video document must install working listeners and translation again.
    await page.reload();await expect(page.locator('#twp-floating')).toBeVisible();await focusFrames();
    await worker.evaluate(()=>{translationService.translateHTML=async(_service,_source,_target,paragraphs)=>paragraphs.map(nodes=>nodes.map(text=>'中文：'+text));});
    await page.locator('#twp-floating #toggle').click();await expect(page.locator('#paragraph [data-twp-bilingual]')).toContainText('中文：');
    await page.locator('#twp-floating #toggle').click();await expect(page.locator('#paragraph [data-twp-bilingual]')).toHaveCount(0);
    expect(errors).toEqual([]);console.log('Content context lifecycle passed: real extension reload, multiple stale video tabs, cached-page return, stale shortcuts, repeated video/main-frame/player focus, episode/player replacement, page refresh and fresh translation.');
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
