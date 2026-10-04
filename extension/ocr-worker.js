// SPDX-License-Identifier: MPL-2.0
import {PaddleOCR} from '@paddleocr/paddleocr-js';
import cvModule from '@techstark/opencv-js';
import * as ort from 'onnxruntime-web';
// Official models contain unused initializers; keep their routine warnings out
// of the extension error page while retaining actual runtime errors.
ort.env.logLevel = 'error';
// Emscripten initializes asynchronously. Wait for its exports before invoking
// the SDK, whose onRuntimeInitialized hook can miss the startup notification.
async function waitForOpenCv() {
  const start = performance.now();
  while (!cvModule.calledRun || typeof cvModule.Mat !== 'function') {
    if (performance.now() - start > 30000) throw new Error('图像引擎初始化超时，请重试');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
let ocr, selected, running = false;
self.onmessage = async ({data}) => {
  if (running) return;
  running = true;
  try {
    self.postMessage({id: data.id, phase: '初始化本地 OCR 引擎…'});
    if (!ocr || selected !== data.model.id) {
      await ocr?.dispose();
      await waitForOpenCv();
      ocr = await PaddleOCR.create({
        worker: false,
        initialize: false,
        textDetectionModelName: data.model.det.name,
        textRecognitionModelName: data.model.rec.name,
        textDetectionModelAsset: {url: data.urls[0]},
        textRecognitionModelAsset: {url: data.urls[1]},
        ortOptions: {backend: 'wasm', wasmPaths: new URL('./ort/', self.location.href).href, numThreads: 1, proxy: false},
      });
      await ocr.initialize();
      selected = data.model.id;
    }
    self.postMessage({id: data.id, phase: '识别图片文字…'});
    // The SDK's Blob converter uses DOM canvas, unavailable in a Worker.
    // Pass a supported OpenCV Mat created with OffscreenCanvas instead.
    const bitmap = await createImageBitmap(data.image);
    let mat;
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(bitmap, 0, 0);
      mat = cvModule.matFromImageData(context.getImageData(0, 0, bitmap.width, bitmap.height));
      const [result] = await ocr.predict(mat);
      self.postMessage({id: data.id, result});
    } finally {
      mat?.delete();
      bitmap.close();
    }
  } catch (error) {
    self.postMessage({id: data.id, error: '图片识别失败：' + (error.message || '请重试')});
  } finally { running = false; }
};
