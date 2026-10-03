const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, render } = require("../src/lib/documentTranslation.js");

test("TXT preserves whitespace, blank lines, CRLF and literal markup", () => {
  const document = parse("  Hello world.\r\n\r\n<script>literal</script>\r\n");
  assert.deepEqual(document.segments.map(s => s.text), ["Hello world.", "<script>literal</script>"]);
  assert.equal(render(document, ["你好。", "<img onerror=alert(1)>"]), "  你好。\r\n\r\n<img onerror=alert(1)>\r\n");
});
test("long lines split into bounded segments without corrupting original spacing or emoji", () => {
  const source = "Long sentence. ".repeat(500) + "🎉".repeat(2000);
  const document = parse(source);
  assert(document.segments.every(s => s.text.length <= 3000));
  assert(document.segments.every(s => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s.text)));
  assert.equal(render(document, document.segments.map(s => s.text)), source);
  // Translation requests may split a long line; bilingual output must reconstruct
  // the full original line before appending its translation, not interleave chunks.
  assert.equal(render(document, document.segments.map(s => s.text), true), source + "\n" + source);
});
test("SRT translation preserves cue numbers, timestamps and CRLF", () => {
  const source = "1\r\n00:00:01,000 --> 00:00:03,000\r\nHello.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nTwo lines\r\nhere.\r\n";
  const document = parse(source, "srt");
  assert.deepEqual(document.segments.map(s => s.text), ["Hello.", "Two lines\r\nhere."]);
  assert.equal(render(document, ["你好。", "这里有两行。"], true), source.replace("Hello.", "Hello.\r\n你好。").replace("Two lines\r\nhere.", "Two lines\r\nhere.\r\n这里有两行。"));
  assert(!render(document, ["你好。", "两行\n\n合并。"] ).includes("两行\r\n\r\n合并"));
});
test("VTT preserves headers, metadata, cue IDs and positioning", () => {
  const source = "WEBVTT\nKind: captions\n\nNOTE source metadata\nDo not translate.\n\nSTYLE\n::cue {color: white}\n\ncue-a\n00:01.000 --> 00:03.000 align:start\nWelcome!\n";
  const document = parse(source, "vtt");
  assert.deepEqual(document.segments.map(s => s.text), ["Welcome!"]);
  assert.equal(render(document, ["欢迎！"]), source.replace("Welcome!", "欢迎！"));
});
test("invalid, empty, oversized and incomplete files cannot be exported", () => {
  assert.throws(() => parse(" "));
  assert.throws(() => parse("PDF", "pdf"));
  assert.throws(() => parse("x".repeat(100001)));
  assert.throws(() => parse("1\nNo time axis\nHello", "srt"));
  assert.throws(() => parse("WEBVTT\n\n00:01.000 --> 00:02.000", "vtt"));
  assert.throws(() => render(parse("One\nTwo"), ["一"]));
  assert.throws(() => render(parse("One"), [""]));
});
