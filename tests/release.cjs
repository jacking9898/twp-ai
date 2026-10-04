const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {inflateRawSync} = require("node:zlib");
const {createHash} = require("node:crypto");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("src/manifest.json"));
const version = manifest.version;
const names = [`Yedu_${version}_Chromium_MV3`, `Yedu_${version}_Firefox`];
// Inspect the actual distribution archives, including source; no external unzip dependency.
function unzip(file) {
  const buffer = fs.readFileSync(path.join(root, "build", file));
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "ZIP end record must exist");
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString();
    assert.ok(!name.startsWith("/") && !name.includes("..") && !name.includes("\\"), `Unsafe ZIP path: ${name}`);
    const local = buffer.readUInt32LE(offset + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + buffer.readUInt32LE(offset + 20));
    const method = buffer.readUInt16LE(offset + 10);
    assert.ok(method === 0 || method === 8);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("fork identity is consistent and upstream update channels cannot be reused", () => {
  const firefox = JSON.parse(read("src/firefox-manifest.json"));
  for (const m of [manifest, firefox]) {
    assert.equal(m.name, "页渡 · Yedu"); assert.equal(m.version, version);
    assert.equal(m.homepage_url, "https://github.com/jacking9898/twp-ai");
    assert.equal(m.update_url, undefined);
    assert.equal(m.action.default_icon, "/icons/reading.png");
  }
  assert.equal(firefox.browser_specific_settings.gecko.id, "twp-ai@jacking9898");
  assert.equal(firefox.browser_specific_settings.gecko.update_url, undefined);
  assert.equal(JSON.parse(read("package.json")).version, version);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, version); assert.equal(lock.packages[""].version, version);
});

test("both installation ZIPs include licenses, source notice and every registered script", () => {
  for (const name of names) {
    const files = unzip(`${name}.zip`);
    for (const file of ["LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"]) assert.equal(files.get(file)?.toString(), read(file), `${name}: ${file}`);
    assert.match(files.get("SOURCE.txt").toString(), /github.com\/jacking9898\/twp-ai/);
    const m = JSON.parse(files.get("manifest.json"));
    for (const [size, icon] of Object.entries(m.icons)) {
      const png = files.get(icon.replace(/^\//, ""));
      assert.ok(png, `Missing app icon: ${icon}`);
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), Number(size));
      assert.equal(png.readUInt32BE(20), Number(size));
    }
    assert.ok(files.has(m.action.default_icon.replace(/^\//, "")));
    assert.ok(!files.has("icons/bilingual.png"));
    assert.ok(!files.has("icons/icon-128.png"));
    const scripts = [...m.content_scripts.flatMap(item => item.js), ...(m.background.scripts || [m.background.service_worker])];
    for (const file of scripts) assert.ok(files.has(file.replace(/^\//, "")), `Missing registered script ${file}`);
    for (const file of files.keys()) assert.ok(!/\.local-data|importedPresets|\.(pem|key|p12|pfx)$|(^|\/)\.env|profile-/.test(file), `Unexpected distribution file: ${file}`);
    assert.ok(files.has("lib/builtinPresets.js"));
    assert.ok(files.has("options/pdfTypeset.js"));
    assert.ok(files.has("options/pdfMath.js"));
    for (const asset of ["lib/videoSubtitles.js", "background/videoSubtitles.js", "contentScript/videoTranslator.js"]) assert.ok(files.has(asset), `Missing video subtitle asset: ${asset}`);
    for (const asset of ["options/cache.html", "options/cache.js", "options/cache.css", "background/imageCapture.js", "contentScript/regionTranslator.js", "lib/imageOCR.js", "lib/imageOCRLayout.js", "options/imageTranslation.js", "lib/ocr/worker.bundle.js", "lib/ocr/opencv.js", "lib/ocr/ort/ort-wasm-simd-threaded.mjs", "lib/ocr/ort/ort-wasm-simd-threaded.wasm"]) assert.ok(files.has(asset), `Missing OCR or cache asset: ${asset}`);
    assert.equal(files.get("lib/ocr/ort/ort-wasm-simd-threaded.wasm").subarray(0, 4).toString('hex'), '0061736d');
    assert.doesNotMatch(files.get("lib/ocr/opencv.js").toString(), /\bnew\s+Function\s*\(|\bnew_\s*\(\s*Function\b|\beval\s*\(/);
    assert.ok(![...files.keys()].some(file => /_onnx_infer\.tar$/.test(file)), 'Model weights must remain optional downloads');
    for (const asset of ["options/insights.html", "options/insights.js"]) assert.ok(files.has(asset), `Missing AI insights asset: ${asset}`);
    for (const asset of ["lib/pdfLoader.mjs", "lib/pdfjs/pdf.mjs", "lib/pdfjs/pdf.worker.mjs", "lib/pdfjs/LICENSE", "lib/pdfjs/standard_fonts/LICENSE_FOXIT", "lib/pdfjs/standard_fonts/LICENSE_LIBERATION", "lib/pdfjs/wasm/LICENSE_OPENJPEG", "lib/pdfjs/cmaps/LICENSE", "options/pdfDocument.js", "options/pdf.html", "options/pdf.js", "options/pdf.css", "options/pdfReader.js", "options/pdfLayout.js", "options/pdfTools.js", "options/pdfHandoff.js"]) assert.ok(files.has(asset), `Missing PDF asset: ${asset}`);
    for (const file of ["options/options.html", "options/release-notes/en.html", "popup/popup.html", "popup/old-popup.html"]) assert.doesNotMatch(files.get(file).toString(), /patreon\.com|paypal\.com|600,000|#donation/);
  }
});

test("the source ZIP reproduces the editable inputs and excludes private research snapshots", () => {
  const files = unzip(`Yedu_${version}_Source.zip`);
  for (const file of ["README.en.md", "extension/translation-cache.js", "src/options/pdfDocument.js"]) assert.equal(files.get(file)?.toString(), read(file));
  for (const file of ["extension/ocr-worker.js", "extension/ocr-unused-worker.js", "webpack.ocr.cjs", "scripts/opencv-csp-loader.cjs", "src/lib/imageOCR.js", "src/lib/imageOCRLayout.js", "src/options/imageTranslation.js"]) assert.equal(files.get(file)?.toString(), read(file), `Missing editable OCR source: ${file}`);
  assert.ok(![...files.keys()].some(file => file.startsWith('src/lib/ocr/') && !file.endsWith('/')), 'Generated OCR runtime must be rebuilt from locked dependencies');
  for (const file of ["src/lib/builtinPresets.js", "extension/ai-service.js", "gulpfile.js", "scripts/collect-licenses.cjs", "src/options/options.js", "package-lock.json", "build-instructions.md", "readme.md", "tests/release.cjs"]) assert.equal(files.get(file)?.toString(), read(file), `Source mismatch: ${file}`);
  for (const file of files.keys()) assert.ok(!/\.local-data|node_modules|(^|\/)build\/|importedPresets|aiService\.bundle|\.(pem|key|p12|pfx)$|(^|\/)\.env/.test(file), `Unexpected source file: ${file}`);
  const presets = require("../src/lib/builtinPresets.js");
  assert.equal(presets.experts.length, 41);
  assert.equal(presets.glossaries.length, 31);
  for (const item of presets.experts) { assert.equal(item.license, "MPL-2.0"); assert.equal(item.source, undefined); }
  for (const item of presets.glossaries) {
    if (item.id === "builtin-llm-ai") {
      assert.equal(item.license, "MPL-2.0");
      assert.equal(item.author, "页渡 · Yedu contributors");
      continue;
    }
    assert.match(item.source, /^https:\/\/github.com\/immersive-translate\/terms\/blob\/main\/meta\//);
    assert.equal(item.license, undefined, "Do not relicense third-party terminology by changing its wrapper");
  }
});

test("published checksums match all three ZIPs", () => {
  const lines = read("build/SHA256SUMS.txt").trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const [hash, file] = line.split("  ");
    assert.match(file, /^Yedu_[\w.]+\.zip$/);
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, "build", file))).digest("hex"), hash);
  }
});
