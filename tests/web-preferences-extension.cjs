// SPDX-License-Identifier: MPL-2.0
// Isolated browser fixtures: exercise the actual extension storage and UI.
const {chromium,expect}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs');
(async()=>{
 const out=path.resolve('.local-data/preference-refresh');fs.mkdirSync(out,{recursive:true});
 const profile=fs.mkdtempSync(path.join(out,'profile-')),extension=path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1400,height:1050},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 let context=await launch();const errors=[];
 const route=()=>context.route('https://developers.google.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Machine learning guide</title><h1>Fairness: Mitigating bias</h1><p>The model should be evaluated fairly across data slices.</p>'}));
 const article='https://developers.google.com/machine-learning/crash-course/fairness/mitigating-bias';
 const panel=page=>page.locator('#twp-floating');
 async function open(page){await panel(page).locator('#toggle').hover();await panel(page).locator('#settings').click();await expect(panel(page).locator('#domain')).toBeEnabled();}
 async function check(page,values=['ml','public-tech','academic']){for(const [i,id]of ['domain','page-glossary','page-style'].entries())await expect(panel(page).locator('#'+id)).toHaveValue(values[i]);}
 async function choose(page){for(const [id,value]of [['domain','ml'],['page-glossary','public-tech'],['page-style','academic']]){await panel(page).locator('#'+id).selectOption(value);await expect(panel(page).locator('#page-ai-notice')).toContainText('已保存');await expect(panel(page).locator('#'+id)).toBeEnabled();}}
 try{
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await twpConfig.onReady();twpConfig.set('showReleaseNotes','no');twpConfig.set('pageTranslatorService','openai');twpConfig.set('targetLanguage','zh-CN');});
  await route();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(article+'?_gl=first.opaque-tracking&utm_source=search#overview');await open(page);await choose(page);
  await page.reload();await open(page);await check(page);console.log('Exact URL refresh preserves all three choices');
  await page.goto(article+'?_gl=rotated.opaque-tracking&utm_source=bookmark#exercise');await open(page);await check(page);console.log('Rotated tracking and section anchors preserve choices');
  const other=await context.newPage();await other.goto(article+'?lesson=2&_gl=other');await open(other);await check(other,['','','']);
  const another=await context.newPage();await another.goto(article.replace('mitigating-bias','types-of-bias')+'?_gl=first');await open(another);await check(another,['','','']);
  // In-page routes must not inherit the previous article's saved choices.
  await page.evaluate(url=>history.pushState({},'',url),article.replace('mitigating-bias','spa-guide')+'?_gl=spa');
  await panel(page).locator('#close').click();await open(page);await check(page,['','','']);await choose(page);
  await page.goto(article+'?_gl=back');await open(page);await check(page);
  // Migrate existing exact-URL records without resurrecting them after reset.
  const legacyURL=article.replace('mitigating-bias','legacy-guide')+'?_gl=legacy';
  await worker.evaluate(async url=>{
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))].map(v=>v.toString(16).padStart(2,'0')).join('');
   await new Promise((resolve,reject)=>{const r=indexedDB.open('TWP_AI_INSIGHTS',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('preferences','readwrite');t.objectStore('preferences').put({key:'web:'+hash,settings:{expertId:'ml',glossaryId:'public-tech',styleId:'academic'},revision:7,updated:Date.now()});t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});
  },legacyURL);
  const migrated=await context.newPage();await migrated.goto(legacyURL);await open(migrated);await check(migrated);
  await panel(migrated).locator('#page-ai-reset').click();await expect(panel(migrated).locator('#page-ai-notice')).toContainText('已保存');
  await migrated.reload();await open(migrated);await check(migrated,['','','']);
  console.log('SPA isolation and legacy preference migration/reset passed');
  await page.screenshot({path:path.join(out,'saved-controls.png')});
  await context.close();context=await launch();await route();
  const reopened=await context.newPage();await reopened.goto(article+'?_gl=after.browser.restart');await open(reopened);await check(reopened);console.log('Browser restart preserves choices');
  await panel(reopened).locator('#page-ai-reset').click();await expect(panel(reopened).locator('#page-ai-notice')).toContainText('已保存');await check(reopened,['','','']);
  await reopened.reload();await open(reopened);await check(reopened,['','','']);expect(errors).toEqual([]);
  console.log('Web preference persistence passed: exact refresh, tracking/anchor changes, content parameter and article isolation, browser restart, reset persistence.');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
