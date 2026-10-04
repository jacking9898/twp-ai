// SPDX-License-Identifier: MPL-2.0
const {chromium} = require('playwright'), {expect} = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
(async () => {
  const calls = [], errors = [], downloads = [];
  let failDownload = false, delay = 0, failBatch = false;
  const server = http.createServer((req, res) => {
    let raw = '';req.on('data', c => raw += c);req.on('end', async () => {
      const body = JSON.parse(raw), input = JSON.parse(body.messages.find(m => m.role === 'user').content);calls.push(body);
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (failBatch && input.segments.some(s => s.text.startsWith('fail-batch'))) {res.writeHead(503, {'content-type':'application/json'});return res.end('{}');}
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify({translations: input.segments.map(s => ({id: s.id, text: '译文：' + s.text}))})}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const extension = path.resolve('build/TWP_AI_0.1.0_Chromium_MV3');
  const profile = fs.mkdtempSync(path.resolve('build/image-profile-'));
  let context;
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true, viewport: {width: 1280, height: 1000}, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
    await context.route('https://paddle-model-ecology.bj.bcebos.com/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop().replace('_onnx_infer.tar', '.tar');downloads.push(name);
      if (failDownload) return route.fulfill({status: 503, body: 'temporary model failure'});
      if (process.env.TWP_OCR_MODEL_DIR) return route.fulfill({contentType: 'application/octet-stream', body: fs.readFileSync(path.join(process.env.TWP_OCR_MODEL_DIR, name))});
      return route.continue();
    });
    context.on('page', p => {p.on('pageerror', e => errors.push(e.message));p.on('console', m => {if (m.type() === 'error' && !m.text().includes('[W:onnxruntime')) console.log('Browser:', m.text().slice(0, 800));});});
    return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  };
  try {
    let worker = await launch(), base = `chrome-extension://${worker.url().split('/')[2]}`;
    await worker.evaluate(async () => {await twpConfig.onReady();twpConfig.set('showReleaseNotes', 'no');twpConfig.set('aiCacheHours', 8760);});
    const settings = await context.newPage();await settings.goto(base + '/options/ai.html');
    await settings.locator('#profile-name').fill('OCR test AI');await settings.locator('#base-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await settings.locator('#model').fill('ocr-translation-model');
    await settings.locator('#profile-form button[type=submit]').click();await expect(settings.locator('#profile-status')).toContainText('服务已保存');
    let page = await context.newPage();await page.goto(base + '/options/sidepanel.html?workspace=1&view=image');
    await expect(page.locator('#heading')).toHaveText('图片翻译');
    await expect(page.locator('#recognize-image')).toBeDisabled();
    const buffer = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas');c.width = 700;c.height = 210;const x = c.getContext('2d');x.fillStyle = 'white';x.fillRect(0, 0, 700, 210);x.fillStyle = '#111';x.font = '32px "Microsoft YaHei", sans-serif';
      x.fillText('Linear Algebra', 25, 55);x.fillText('特征值 Eigenvalues', 25, 115);x.fillText('Matrix SVD', 25, 175);return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const upload = () => page.locator('#image-file').setInputFiles({name: 'ocr-control.png', mimeType: 'image/png', buffer});
    const recognize = async () => {await page.locator('#recognize-image').click();await expect(page.locator('#task-status')).toContainText(/识别完成|失败|未识别/, {timeout: 45000});await expect(page.locator('#task-status')).toContainText('识别完成');const text = await page.locator('#image-text').inputValue();expect(text).toContain('Linear Algebra');expect(text).toContain('Eigenvalues');expect(text).toContain('Matrix SVD');expect(await page.locator('#image-preview polygon').count()).toBeGreaterThanOrEqual(3);console.log('Recognized with', await page.locator('#ocr-model').inputValue());};
    // Real browser clipboard: screenshot paste and button share the file preview pipeline.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async data => {
      const blob = await (await fetch('data:image/png;base64,' + data)).blob();
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
    }, buffer.toString('base64'));
    await page.locator('#image-paste').click();
    await expect(page.locator('#task-status')).toContainText('已粘贴图片');
    await expect(page.locator('#image-name')).toContainText('700 × 210');
    await expect(page.locator('#image-preview-wrap')).toBeVisible();
    await expect(page.locator('#recognize-image')).toBeEnabled();
    expect(downloads.length).toBe(0);expect(calls.length).toBe(0);
    await recognize();
    await page.locator('#image-paste').focus();await page.keyboard.press('Control+V');
    await expect(page.locator('#task-status')).toContainText('已粘贴图片');
    await expect(page.locator('#image-editor')).toBeHidden();
    await expect(page.locator('#image-preview polygon')).toHaveCount(0);
    await expect(page.locator('#recognize-image')).toBeEnabled();
    // Ordinary text paste remains native, and image paste is ignored on other tabs.
    await page.locator('#tab-text').click();
    await page.evaluate(() => navigator.clipboard.writeText('Clipboard text stays text'));
    await page.locator('#source').focus();await page.keyboard.press('Control+V');
    await expect(page.locator('#source')).toHaveValue('Clipboard text stays text');
    await page.locator('#tab-image').click();
    const imageName = await page.locator('#image-name').textContent();
    await page.locator('#image-paste').click();
    await expect(page.locator('#task-status')).toContainText('剪贴板中没有');
    await expect(page.locator('#image-name')).toHaveText(imageName);
    await expect(page.locator('#recognize-image')).toBeEnabled();
    // Deterministic denial/unsupported cases supplement the real successful reads.
    await page.evaluate(() => {self.clipboardRead = navigator.clipboard.read.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard, 'read', {configurable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError');}});});
    await page.locator('#image-paste').click();await expect(page.locator('#task-status')).toContainText('按 Ctrl+V');
    await expect(page.locator('#image-paste')).toBeEnabled();
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'read', {configurable:true,value:undefined}));
    await page.locator('#image-paste').click();await expect(page.locator('#task-status')).toContainText('此浏览器不支持');
    await page.evaluate(() => {Object.defineProperty(navigator.clipboard, 'read', {configurable:true,value:self.clipboardRead});delete self.clipboardRead;});
    await page.setViewportSize({width:384,height:880});
    await page.locator('#view-image .upload-card').screenshot({path:path.resolve('build/image-clipboard-entry.png')});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({width:1280,height:1000});
    await upload();await expect(page.locator('#recognize-image')).toBeEnabled();await recognize();
    const previewBounds = await page.locator('#image-preview').boundingBox();expect(previewBounds.height).toBeGreaterThan(100);expect(previewBounds.height / previewBounds.width).toBeCloseTo(210 / 700, 1);
    await page.locator('#image-preview').screenshot({path: path.resolve('build/image-ocr-preview.png')});
    expect(downloads.length).toBe(2);await expect(page.locator('#ocr-model-status')).toContainText('已下载');
    await page.locator('#ocr-model').selectOption('v6-small');await recognize();expect(downloads.length).toBe(4);
    // Offline reload tests actual stored bytes, not just a still-live inference session.
    await context.setOffline(true);await page.reload();await expect(page.locator('#ocr-model')).toHaveValue('v6-small');await upload();await recognize();expect(downloads.length).toBe(4);await context.setOffline(false);
    // Cancellation stops the real worker; retry creates a new one.
    await page.locator('#recognize-image').click();await expect(page.locator('#cancel')).toBeVisible();await page.locator('#cancel').click();await expect(page.locator('#recognize-image')).toBeEnabled();await recognize();
    await page.locator('#image-text').fill('Edited Eigenvalues\n<img src=x onerror=alert(1)>');
    await page.locator('#engine').selectOption('openai');await page.locator('#source-language').selectOption('en');await page.locator('#image-expert').selectOption('software');await page.locator('#image-glossary').selectOption('public-tech');await page.locator('#image-style').selectOption('technical');
    await page.locator('#translate-image').click();await expect(page.locator('#task-status')).toHaveText('图片文字翻译完成');
    await expect(page.locator('#image-pairs')).toContainText('译文：Edited Eigenvalues');await expect(page.locator('#image-pairs img')).toHaveCount(0);
    const input = JSON.parse(calls.at(-1).messages.find(m => m.role === 'user').content);expect(input.sourceLanguage).toBe('en');expect(calls.at(-1).model).toBe('ocr-translation-model');expect(calls.at(-1).messages[0].content).toContain('software engineering');
    const count = calls.length;await page.locator('#translate-image').click();await expect(page.locator('#task-status')).toHaveText('图片文字翻译完成');expect(calls.length).toBe(count);
    const exported = page.waitForEvent('download');await page.locator('#image-download').click();const download = await exported;const content = fs.readFileSync(await download.path(), 'utf8');expect(content).toContain('Edited Eigenvalues\n译文：Edited Eigenvalues');expect(download.suggestedFilename()).toBe('ocr-control.bilingual.txt');
    await page.screenshot({path: path.resolve('build/image-translation-preview.png'), fullPage: true});
    // Reformatting reuses the original OCR result, never invokes inference again.
    await page.locator('#image-layout').selectOption('raw');
    expect(await page.locator('#image-text').inputValue()).toContain('Linear Algebra');
    await page.locator('#image-layout').selectOption('paragraph');
    const paragraphs = Array.from({length:20}, (_,i) => `Progress paragraph ${i}: the eigenvalues describe this independent mathematical statement.`);
    await page.locator('#image-text').fill(paragraphs.join('\n\n'));delay = 1000;
    await page.locator('#translate-image').click();
    await expect(page.locator('#image-results-title')).toHaveText('双语结果 · 已完成 6 / 20 段');
    await expect(page.locator('#image-pairs article')).toHaveCount(6);
    await expect(page.locator('#translate-image')).toBeDisabled();
    await expect(page.locator('#task-status')).toContainText(/已完成 6 \/ 20 段 · 已等待 \d+ 秒/);
    await page.locator('#cancel').click();
    await expect(page.locator('#image-pairs article')).toHaveCount(6);
    const partialExport = page.waitForEvent('download');await page.locator('#image-download').click();
    expect((await partialExport).suggestedFilename()).toBe('ocr-control.partial.bilingual.txt');
    delay = 0;const retryCalls = calls.length;
    await page.locator('#translate-image').click();await expect(page.locator('#task-status')).toHaveText('图片文字翻译完成');
    await expect(page.locator('#image-pairs article')).toHaveCount(20);
    const retryInputs = calls.slice(retryCalls).map(c => JSON.parse(c.messages.find(m => m.role === 'user').content));
    expect(retryInputs.every(input => input.segments.length <= 6)).toBe(true);
    expect(retryInputs.some(input => input.segments.some(s => s.text.includes('Progress paragraph 0:')))).toBe(false);
    failBatch = true;
    await page.locator('#image-text').fill(Array.from({length:13}, (_,i) => `${i < 6 ? 'success-batch' : 'fail-batch'} ${i}: a different paragraph for failure and retained output.`).join('\n\n'));
    await page.locator('#translate-image').click();await expect(page.locator('#task-status')).toContainText('已保留 6 段结果', {timeout:15000});
    await expect(page.locator('#image-pairs article')).toHaveCount(6);await expect(page.locator('#translate-image')).toBeEnabled();failBatch = false;
    await page.locator('#image-text').fill('Edited Eigenvalues\n<img src=x onerror=alert(1)>');
    // Traditional translation uses the shared background adapter.
    await worker.evaluate(() => {translationService.translateText = async (service, source, target, texts) => {self.imageTraditional = {service, source, target, texts};return texts.map(t => '免费译文：' + t);};});
    await page.locator('#engine').selectOption('bing');await page.locator('#translate-image').click();await expect(page.locator('#image-pairs')).toContainText('免费译文：Edited Eigenvalues');expect(await worker.evaluate(() => self.imageTraditional.service)).toBe('bing');
    // Late AI translation cannot resurrect canceled output.
    await page.locator('#engine').selectOption('openai');await page.locator('#image-text').fill('Cancel AI image translation');delay = 500;
    await page.locator('#translate-image').click();await expect.poll(() => calls.length).toBeGreaterThan(count);await page.locator('#cancel').click();await expect(page.locator('#image-results')).toBeHidden();await page.waitForTimeout(700);await expect(page.locator('#image-results')).toBeHidden();delay = 0;
    // Failure, retry and cache clearing use the actual downloadable model path.
    await page.locator('#image-clear-models').click();await expect(page.locator('#task-status')).toContainText('已清除');failDownload = true;await page.locator('#recognize-image').click();await expect(page.locator('#task-status')).toContainText('模型下载失败');await expect(page.locator('#recognize-image')).toBeEnabled();failDownload = false;await recognize();
    // A real OCR pass over fragmented prose produces paragraphs, not word cards.
    const prose = Buffer.from(await page.evaluate(() => {
      const c=document.createElement('canvas');c.width=1000;c.height=140;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='24px Arial';let left=25;
      for(const word of ['be','multiplied','by a scalar','and','the result','is a polynomial']) {x.fillText(word,left,45);left+=x.measureText(word).width+25;}
      x.fillText('The result belongs to the same vector space.',25,77);return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.locator('#image-file').setInputFiles({name:'fragmented-prose.png',mimeType:'image/png',buffer:prose});await expect(page.locator('#recognize-image')).toBeEnabled();await page.locator('#recognize-image').click();
    await expect(page.locator('#task-status')).toContainText('识别完成',{timeout:45000});
    const paragraphText=await page.locator('#image-text').inputValue();expect(paragraphText).toContain('polynomial');expect(paragraphText).toContain('vector space');expect(paragraphText.split(/\n+/).length).toBe(1);
    await page.locator('#image-layout').selectOption('line');expect((await page.locator('#image-text').inputValue()).split(/\n+/).length).toBe(2);
    await page.locator('#image-layout').selectOption('paragraph');await page.locator('#translate-image').click();await expect(page.locator('#task-status')).toHaveText('图片文字翻译完成');await expect(page.locator('#image-pairs article')).toHaveCount(1);
    await page.locator('#image-results').screenshot({path:path.resolve('build/image-paragraph-result.png')});
    if (process.env.TWP_OCR_SAMPLE_DIR) {
      await page.locator('#image-file').setInputFiles(path.join(process.env.TWP_OCR_SAMPLE_DIR, 'flowchart.png'));
      await expect(page.locator('#recognize-image')).toBeEnabled();await page.locator('#recognize-image').click();await expect(page.locator('#task-status')).toContainText('识别完成', {timeout: 45000});
      const text = await page.locator('#image-text').inputValue();
      for (const label of ['Determinant', 'Invertibility', 'Cholesky', 'Eigenvalues', 'Eigenvectors', 'Orthogonal matrix', 'Diagonalization', 'SVD']) expect(text).toContain(label);
      await page.locator('#image-preview').screenshot({path: path.resolve('build/image-pdf-flowchart-preview.png')});console.log('PDF screenshot: all eight principal flowchart labels recognized.');
    }
    await page.setViewportSize({width: 384, height: 880});await expect(page.locator('#ocr-model')).toBeVisible();expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#image-file').setInputFiles({name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image')});await expect(page.locator('#recognize-image')).toBeDisabled();await expect(page.locator('#task-status')).toHaveAttribute('data-error', 'true');
    expect(errors).toEqual([]);
    console.log('Image translation passed: both real models under MV3 CSP, cache/offline reuse, worker cancellation/retry, edited-text translation, AI/free service selection, AI cache reuse, safe rendering, TXT export, download failures and invalid image.');
  } finally {await context?.close();await new Promise(r => server.close(r));}
})().catch(e => {console.error(e);process.exitCode = 1;});
