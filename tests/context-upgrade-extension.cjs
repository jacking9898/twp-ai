// SPDX-License-Identifier: MPL-2.0
// Reproduce the legacy focus listener surviving an extension upgrade in two
// already-open documents. The fixture preserves its original built line 937.
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const current = path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
  const workspace = fs.mkdtempSync(path.resolve('build/context-upgrade-'));
  const extension = path.join(workspace, 'extension');
  fs.cpSync(current, extension, { recursive: true });
  const script = path.join(extension, 'contentScript/translateSelected.js');
  const legacy = Array(934).fill('');
  legacy[0] = 'var translateSelected = {};';
  legacy[933] = 'let windowIsInFocus = true;';
  legacy.push('window.addEventListener("focus", function (e) {');
  legacy.push('  windowIsInFocus = true;');
  legacy.push('  chrome.runtime.sendMessage({ action: "thisFrameIsInFocus" }, checkedLastError);');
  legacy.push('});');
  fs.writeFileSync(script, legacy.join('\n'));
  const context = await chromium.launchPersistentContext(path.join(workspace, 'profile'), {
    channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => { await twpConfig.onReady(); twpConfig.set('showReleaseNotes', 'no'); });
    await context.route('https://context-upgrade.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<html lang="en"><body><p>Already open document.</p></body></html>',
    }));
    const pages = [], errors = [];
    for (const name of ['video', 'ordinary-document']) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.stack));
      await page.goto(`https://context-upgrade.test/${name}`);
      await expect(page.locator('#twp-floating')).toBeVisible();
      pages.push(page); errors.push(pageErrors);
    }
    // Disk contains the new implementation; existing documents still own the old
    // listener. Reloading the extension does not replace these document worlds.
    fs.copyFileSync(path.join(current, 'contentScript/translateSelected.js'), script);
    const restarted = context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.runtime.reload()).catch(error => {
      if (!/closed|destroyed|Target/i.test(error.message)) throw error;
    });
    worker = await restarted; await worker.evaluate(() => twpConfig.onReady());
    for (const page of pages) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    for (const pageErrors of errors) {
      await expect.poll(() => pageErrors.length).toBeGreaterThan(0);
      expect(pageErrors.join('\n')).toMatch(/Extension context invalidated/);
      expect(pageErrors.join('\n')).toMatch(/translateSelected\.js:937:/);
    }
    const diskLine = fs.readFileSync(script, 'utf8').split('\n')[936].trim();
    expect(diskLine).not.toContain('chrome.runtime.sendMessage');
    console.log('Reproduced: old focus listener throws at line 937 while current disk line 937 is:', diskLine);
    // Refresh only the video. The unrelated pre-upgrade document still fails.
    await pages[0].reload(); await expect(pages[0].locator('#twp-floating')).toBeVisible();
    const videoCount = errors[0].length, documentCount = errors[1].length;
    for (const page of pages) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(errors[0].length).toBe(videoCount);
    await expect.poll(() => errors[1].length).toBeGreaterThan(documentCount);
    // Refresh every old document: new listeners replace all legacy worlds.
    await pages[1].reload(); await expect(pages[1].locator('#twp-floating')).toBeVisible();
    const counts = errors.map(items => items.length);
    for (let round = 0; round < 3; round++) {
      for (const page of pages) await page.evaluate(() => {
        window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'));
      });
    }
    expect(errors.map(items => items.length)).toEqual(counts);
    console.log('Upgrade regression passed: refreshing one tab leaves other old tabs failing; refreshing all old documents installs safe listeners.');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
