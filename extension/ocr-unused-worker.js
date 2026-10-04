// We own the OCR Worker lifecycle in imageOCR.js. The SDK's optional second
// worker implementation is excluded to avoid shipping a duplicate OpenCV engine.
throw new Error('Use the packaged Yedu OCR worker instead of SDK worker mode.');
