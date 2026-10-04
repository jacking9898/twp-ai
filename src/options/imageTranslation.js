// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpImageTranslation = (() => {
  function create({status, setBusy, translateDocument, readOptions}) {
    const $ = id => document.getElementById(id), ocr = twpImageOCR.create();
    let file, previewURL, serial = 0, active = false, loading = false, clipboardReading = false, textOutput = '', recognized, ticker, partial = false;
    const modelSelect = $('ocr-model');
    modelSelect.replaceChildren(...twpImageOCR.models.map(m => new Option(m.label, m.id)));
    modelSelect.value = localStorage.getItem('yedu-ocr-model') || 'v5-mobile';
    if (!modelSelect.value) modelSelect.value = 'v5-mobile';
    function resetTranslation() {
      textOutput = '';partial = false; $('image-results').hidden = true;$('image-pairs').replaceChildren();
      $('image-copy').textContent = '复制双语结果';
    }
    function updateControls(busy = active) {
      for (const id of ['image-file', 'image-paste', 'ocr-model', 'image-layout', 'image-text', 'image-clear-models', 'image-expert', 'image-glossary', 'image-style']) $(id).disabled = busy || loading || clipboardReading;
      $('recognize-image').disabled = busy || loading || clipboardReading || !file;
      $('translate-image').disabled = busy || loading || clipboardReading || !$('image-text').value.trim();
    }
    async function cacheStatus() {
      const id = modelSelect.value;
      try {
        const ready = await twpImageOCR.available(id);
        if (id === modelSelect.value) $('ocr-model-status').textContent = ready ? '模型已下载，可离线识别。' : '首次识别将从 Paddle 官方下载此模型，之后本地复用。';
      } catch {$('ocr-model-status').textContent = '无法读取模型缓存，请检查浏览器存储空间。';}
    }
    function cancel() {serial++;clearInterval(ticker);ocr.cancel();active = false;loading = false;clipboardReading = false;}
    function rebuildText() {
      if (!recognized) return;
      $('image-text').value = twpImageOCRLayout.reconstruct(recognized.items, $('image-layout').value);
      resetTranslation();updateControls();
    }
    $('image-layout').onchange = () => {rebuildText();status('已按所选排版重建文字，请检查后翻译。');};
    function showTranslation(sourceDocument, values) {
      partial = values.length < sourceDocument.segments.length;
      const completed = {...sourceDocument, segments: sourceDocument.segments.slice(0, values.length), text: sourceDocument.text.slice(0, sourceDocument.segments[values.length - 1].end)};
      textOutput = twpDocumentTranslation.render(completed, values, true);
      $('image-pairs').replaceChildren();
      for (const pair of twpDocumentTranslation.pairs(completed, values)) {
        const row = document.createElement('article'), source = document.createElement('p'), translation = document.createElement('p');
        source.className = 'image-original';source.textContent = pair.text;translation.textContent = pair.translation;
        row.append(source, translation);$('image-pairs').append(row);
      }
      $('image-results').hidden = false;
      $('image-results-title').textContent = partial ? `双语结果 · 已完成 ${values.length} / ${sourceDocument.segments.length} 段` : '双语结果';
    }
    function showBoxes(result) {
      const svg = $('image-preview'), ns = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.ocr-box').forEach(n => n.remove());
      for (const [i, item] of result.items.entries()) {
        const group = document.createElementNS(ns, 'g');group.setAttribute('class', 'ocr-box');
        const box = document.createElementNS(ns, 'polygon');box.setAttribute('points', item.poly.map(p => p.join(',')).join(' '));
        const number = document.createElementNS(ns, 'text');number.setAttribute('x', Math.max(0, item.poly[0][0]));number.setAttribute('y', Math.max(14, item.poly[0][1]));number.textContent = String(i + 1);
        group.append(box, number);svg.append(group);
      }
    }
    async function loadImage(input, pasted = false) {
      cancel();const token = serial;
      file = null;recognized = null;resetTranslation();$('image-text').value = '';$('image-editor').hidden = true;$('image-preview-wrap').hidden = true;
      if (previewURL) URL.revokeObjectURL(previewURL);previewURL = null;
      $('image-name').textContent = input?.name || '尚未选择图片';
      loading = !!input;updateControls();status();
      if (!input) return;
      let bitmap;
      try {
        if (!/\.(png|jpe?g|webp)$/i.test(input.name)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
        if (input.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的图片');
        bitmap = await createImageBitmap(input);
        if (bitmap.width * bitmap.height > 25000000) throw new Error('图片分辨率过大，请裁剪至 2500 万像素以内');
        const ratio = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = new OffscreenCanvas(width, height);canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({type: 'image/png'});
        if (serial !== token) return;
        file = {blob, name: input.name};previewURL = URL.createObjectURL(blob);
        const svg = $('image-preview');svg.replaceChildren();svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');image.setAttribute('href', previewURL);image.setAttribute('width', width);image.setAttribute('height', height);svg.append(image);
        $('image-preview-wrap').hidden = false;
        $('image-name').textContent = `${input.name} · ${width} × ${height}${ratio < 1 ? '（已缩小用于识别）' : ''}`;
        if (pasted) status('已粘贴图片，请点击「识别图片文字」。');
      } catch (error) {if (serial === token) {$('image-file').value = '';status(error.message || '无法读取图片，请换一张图片', true);}}
      finally {bitmap?.close();if (serial === token) {loading = false;updateControls();}}
    }
    $('image-file').onchange = () => loadImage($('image-file').files[0]);
    const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
    function clipboardFile(blob) {
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      return new File([blob], `粘贴图片-${Date.now()}.${extension}`, {type: blob.type});
    }
    $('image-paste').onclick = async () => {
      if ($('image-paste').disabled) return;
      if (!navigator.clipboard?.read) return status('此浏览器不支持按钮读取图片，请在此页面按 Ctrl+V 粘贴截图。', true);
      const token = ++serial;clipboardReading = true;updateControls();status('正在读取剪贴板图片…');
      try {
        const items = await navigator.clipboard.read();
        if (serial !== token || $('view-image').hidden) return;
        const item = items.find(entry => imageTypes.some(type => entry.types.includes(type)));
        if (!item) {status('剪贴板中没有 PNG、JPEG 或 WebP 图片，请先截图或复制图片，再粘贴。', true);return;}
        const blob = await item.getType(imageTypes.find(type => item.types.includes(type)));
        if (serial !== token || $('view-image').hidden) return;
        $('image-file').value = '';
        await loadImage(clipboardFile(blob), true);
      } catch {
        if (serial === token) status('无法读取剪贴板图片，请在此页面按 Ctrl+V 粘贴，或使用「选择图片」。', true);
      } finally {if (serial === token) {clipboardReading = false;updateControls();}}
    };
    document.addEventListener('paste', event => {
      if ($('view-image').hidden || $('image-file').disabled) return;
      const item = [...(event.clipboardData?.items || [])].find(entry => entry.kind === 'file' && imageTypes.includes(entry.type));
      const blob = item?.getAsFile();
      if (!blob) return;
      event.preventDefault();$('image-file').value = '';
      void loadImage(clipboardFile(blob), true);
    });
    modelSelect.onchange = () => {ocr.cancel();localStorage.setItem('yedu-ocr-model', modelSelect.value);void cacheStatus();status();};
    $('recognize-image').onclick = async () => {
      if (active || !file || loading) return;
      const token = ++serial;active = true;setBusy(true);resetTranslation();
      recognized = null;$('image-text').value = '';$('image-editor').hidden = true;
      $('image-preview').querySelectorAll('.ocr-box').forEach(n => n.remove());
      try {
        const result = await ocr.recognize(file.blob, modelSelect.value, message => {if (serial === token) status(message);});
        if (serial !== token) return;
        recognized = result;showBoxes(result);rebuildText();$('image-editor').hidden = false;
        status(result.items.length ? `识别完成：${result.items.length} 个文字框，已按排版整理，请检查后翻译。` : '未识别出文字，请换用另一模型或裁剪、放大文字区域。');
        void cacheStatus();
      } catch (error) {if (serial === token) status(error.message, true);}
      finally {if (serial === token) {active = false;setBusy(false);}}
    };
    $('image-clear-models').onclick = async () => {
      try {ocr.cancel();await twpImageOCR.clearModels();await cacheStatus();status('已清除本地 OCR 模型，下次识别会重新下载。');}
      catch {status('模型缓存清除失败，请重试。', true);}
    };
    $('image-text').oninput = () => {resetTranslation();updateControls();};
    $('translate-image').onclick = async () => {
      if (active || loading) return;
      const service = $('engine').value, profileId = $('profile').value;
      if (service === 'openai' && !profileId) return status('请先在模型与术语设置中添加 AI 服务。', true);
      let sourceDocument;
      try {sourceDocument = twpDocumentTranslation.parse($('image-text').value, 'txt');}
      catch (error) {status(error.message, true);return;}
      const options = {...readOptions(), profileId, expertId: $('image-expert').value, glossaryId: $('image-glossary').value, styleId: $('image-style').value, context: 'Image text translation', cacheLabel: $('image-name').textContent, cacheBySegment: true, batchLimit: 6, characterLimit: 3000};
      const token = ++serial;active = true;setBusy(true);resetTranslation();status('正在翻译识别文字…');
      const started = Date.now();let completedCount = 0;
      const progress = () => {if (serial === token) status(`正在翻译：已完成 ${completedCount} / ${sourceDocument.segments.length} 段 · 已等待 ${Math.floor((Date.now() - started) / 1000)} 秒`);};
      options.onBatch = ({completed, translations}) => {if (serial === token) {completedCount = completed;showTranslation(sourceDocument, translations);progress();}};
      progress();const clock = ticker = setInterval(progress, 1000);
      try {
        const values = await translateDocument(sourceDocument, service, $('target').value, options, () => serial === token);
        if (serial !== token) return;
        showTranslation(sourceDocument, values);status('图片文字翻译完成');
      } catch (error) {if (serial === token) status((error.message || '翻译失败，请重试') + (completedCount ? `；已保留 ${completedCount} 段结果，可复制或下载。` : ''), true);}
      finally {clearInterval(clock);if (serial === token) {active = false;setBusy(false);}}
    };
    $('image-copy').onclick = async () => {try {await navigator.clipboard.writeText(textOutput);$('image-copy').textContent = '已复制';}catch {status('复制失败，请选中文字后复制。', true);}};
    $('image-download').onclick = () => {
      if (!textOutput) return;
      const url = URL.createObjectURL(new Blob([textOutput], {type: 'text/plain;charset=utf-8'}));
      const link = document.createElement('a');link.href = url;link.download = (file?.name.replace(/\.[^.]+$/, '') || 'image') + (partial ? '.partial' : '') + '.bilingual.txt';link.click();setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    function presets() {
      const saved = twpConfig.get('sidebarPreferences'), defaults = twpConfig.get('aiTranslationSettings');
      for (const [id, list, value] of [
        ['image-expert', twpAIPresets.allExperts(twpConfig.get('aiCustomExperts')), saved.imageExpertId || defaults.domain],
        ['image-glossary', twpAIPresets.allGlossaries(twpConfig.get('aiCustomGlossaries')), saved.imageGlossaryId || defaults.glossaryId || 'public-default'],
        ['image-style', twpAIPresets.styles, saved.imageStyleId || defaults.styleId || 'faithful'],
      ]) {$(id).replaceChildren(...list.map(m => new Option(m.name, m.id)));$(id).value = value;if (!$(id).value) $(id).selectedIndex = 0;}
    }
    for (const id of ['image-expert', 'image-glossary', 'image-style']) $(id).onchange = () => {
      twpConfig.set('sidebarPreferences', {...twpConfig.get('sidebarPreferences'), imageExpertId: $('image-expert').value, imageGlossaryId: $('image-glossary').value, imageStyleId: $('image-style').value});resetTranslation();
    };
    window.addEventListener('pagehide', () => {cancel();if (previewURL) URL.revokeObjectURL(previewURL);});
    presets();void cacheStatus();updateControls();
    async function loadCapture(entry) {
      for (const [id,key] of [['image-expert','expertId'],['image-glossary','glossaryId'],['image-style','styleId']]) {
        if ([...$(id).options].some(option=>option.value===entry.options?.[key])) $(id).value=entry.options[key];
      }
      const blob=await (await fetch(entry.dataURL)).blob(), transfer=new DataTransfer();transfer.items.add(new File([blob],entry.name,{type:'image/png'}));$('image-file').files=transfer.files;
      await $('image-file').onchange();
      if(file){$('image-name').textContent += entry.title ? ` · ${entry.title}` : '';await $('recognize-image').onclick();}
    }
    return {cancel, updateControls, resetTranslation, presets, loadCapture};
  }
  return {create};
})();
