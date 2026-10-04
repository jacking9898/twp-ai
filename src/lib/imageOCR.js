// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpImageOCR = (() => {
  const base = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
  const asset = (name, bytes, sha256) => ({name, bytes, sha256, url: base + name + '_onnx_infer.tar'});
  const models = [
    {id: 'v5-mobile', label: 'PaddleOCR · PP-OCRv5 mobile（21.5 MB）',
      det: asset('PP-OCRv5_mobile_det', 4843520, '781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30'),
      rec: asset('PP-OCRv5_mobile_rec', 16701440, 'f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c')},
    {id: 'v6-small', label: 'PaddleOCR · PP-OCRv6 small（31.2 MB）',
      det: asset('PP-OCRv6_small_det', 9891840, 'd218f6fbf0f1c23d2161bd6ac7f5eaa6104fa89955c09290497e31008e2618e4'),
      rec: asset('PP-OCRv6_small_rec', 21319680, 'd267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1')},
  ];
  const cacheName = 'Yedu_PaddleOCR_models_v1';
  const canceled = () => new Error('已取消识别');
  const key = a => a.url + '?sha256=' + a.sha256;
  async function loadAsset(a, signal, progress) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key(a));
    if (signal.aborted) throw canceled();
    if (cached) return cached.blob();
    progress(`下载 ${a.name}（${(a.bytes / 1e6).toFixed(1)} MB）…`);
    let response;
    try {response = await fetch(a.url, {signal, credentials: 'omit', cache: 'no-store'});}
    catch (error) {if (signal.aborted) throw canceled();throw new Error('模型下载失败，请检查网络后重试');}
    if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
    const buffer = await response.arrayBuffer();
    if (signal.aborted) throw canceled();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (buffer.byteLength !== a.bytes || digest !== a.sha256) throw new Error('模型文件校验失败，请重试');
    const blob = new Blob([buffer], {type: 'application/octet-stream'});
    await cache.put(key(a), new Response(blob));
    return blob;
  }
  function create() {
    let worker, pending, controller, timer;
    const stop = () => {
      controller?.abort();controller = null;
      clearTimeout(timer);worker?.terminate();worker = null;
      pending?.reject(canceled());pending = null;
    };
    async function recognize(image, modelId, progress = () => {}) {
      if (pending || controller) throw new Error('识别正在进行');
      const model = models.find(m => m.id === modelId);
      if (!model) throw new Error('请选择有效的 OCR 模型');
      const abort = controller = new AbortController();
      // Download and model loading share a bounded deadline; cancellation terminates inference.
      const deadline = timer = setTimeout(stop, 180000);
      const urls = [];
      try {
        for (const a of [model.det, model.rec]) urls.push(URL.createObjectURL(await loadAsset(a, abort.signal, progress)));
        if (abort.signal.aborted) throw canceled();
        progress('加载本地 OCR 模型…');
        worker ||= new Worker(chrome.runtime.getURL('lib/ocr/worker.bundle.js'));
        const id = crypto.randomUUID();
        return await new Promise((resolve, reject) => {
          pending = {reject};
          worker.onmessage = ({data}) => {
            if (data.id !== id) return;
            if (data.phase) return progress(data.phase);
            if (data.error) reject(new Error(data.error));else resolve(data.result);
          };
          worker.onerror = event => {event.preventDefault();reject(new Error('OCR 引擎启动失败，请重新加载扩展后重试'));worker?.terminate();worker = null;};
          worker.postMessage({id, model, urls, image});
        });
      } finally {
        urls.forEach(url => URL.revokeObjectURL(url));clearTimeout(deadline);
        if (controller === abort) {controller = null;pending = null;}
      }
    }
    return {recognize, cancel: stop};
  }
  async function available(modelId) {
    const model = models.find(m => m.id === modelId), cache = await caches.open(cacheName);
    return !!model && (await Promise.all([model.det, model.rec].map(a => cache.match(key(a))))).every(Boolean);
  }
  return {models, create, available, clearModels: () => caches.delete(cacheName)};
})();
