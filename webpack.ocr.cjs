const path = require('node:path');
const webpack = require('webpack');
const fs = require('node:fs');
const opencvCsp = require('./scripts/opencv-csp-loader.cjs');
module.exports = {
  mode: 'production', target: 'webworker', entry: './extension/ocr-worker.js',
  output: {path: path.resolve(__dirname, 'src/lib/ocr'), filename: 'worker.bundle.js', clean: true},
  devtool: false, performance: {hints: false},
  // Load the adapted Emscripten runtime as a separate packaged Worker script.
  externals: {'@techstark/opencv-js': 'var self.cv'},
  // The SDK's unused optional worker adapter is tree-shaken by webpack.
  resolve: {alias: {'onnxruntime-web$': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs')}, fallback: {fs: false, path: false, crypto: false}},
  plugins: [
    new webpack.BannerPlugin({banner: "importScripts(new URL('./opencv.js', self.location.href).href);", raw: true, entryOnly: true}),
    new webpack.NormalModuleReplacementPlugin(/worker-entry-[^/\\]+\.js$/, path.resolve(__dirname, 'extension/ocr-unused-worker.js')),
    {apply(compiler) {compiler.hooks.thisCompilation.tap('OpenCvRuntime', compilation => {
      compilation.hooks.processAssets.tap({name: 'OpenCvRuntime', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL}, () => {
        compilation.emitAsset('opencv.js', new webpack.sources.RawSource(opencvCsp(fs.readFileSync(require.resolve('@techstark/opencv-js'), 'utf8'))));
      });
    });}},
  ],
  module: {rules: [
    {test: /ort-wasm-simd-threaded\.wasm$/, type: 'asset/resource', generator: {emit: false, filename: 'ort/[name][ext]'}},
  ]},
};
