"use strict";
const twpDocumentTranslation = (() => {
  function parse(text, format = "txt") {
    if (typeof text !== "string" || !text.trim()) throw new Error("文件没有可翻译的文字");
    if (text.length > 100000) throw new Error("文件过长，请控制在 100000 字符以内");
    if (!['txt', 'srt', 'vtt'].includes(format)) throw new Error("目前支持 TXT、SRT 和 VTT 文件");
    const segments = [];
    function add(start, end) {
      // Keep surrounding whitespace and original newline bytes outside replacements.
      const raw = text.slice(start, end);
      start += raw.length - raw.trimStart().length;
      end -= raw.length - raw.trimEnd().length;
      while (start < end) {
        let stop = Math.min(end, start + 3000);
        if (stop < end) {
          const space = text.lastIndexOf(" ", stop);
          if (space > start + 1500) stop = space;
          if (/[\uD800-\uDBFF]/.test(text[stop - 1])) stop--;
        }
        segments.push({ start, end: stop, text: text.slice(start, stop) });
        start = stop;
        while (start < end && /\s/.test(text[start])) start++;
      }
    }
    if (format === "txt") {
      for (const match of text.matchAll(/[^\r\n]+/g)) add(match.index, match.index + match[0].length);
    } else {
      const timestamp = /^(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$/;
      let offset = 0;
      for (const block of text.split(/(\r?\n[ \t]*\r?\n)/)) {
        const lines = block.split(/\r?\n/);
        if (block.trim() && !/^\s*(WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) {
          const timing = lines.findIndex(line => timestamp.test(line.trim()));
          if (timing < 0 || timing > 1 || timing === lines.length - 1) throw new Error("字幕格式不完整，请使用包含时间轴的 SRT 或 VTT 文件");
          let bodyStart = offset;
          for (let i = 0; i <= timing; i++) bodyStart = text.indexOf("\n", bodyStart) + 1;
          const bodyEnd = offset + block.length;
          if (text.slice(bodyStart, bodyEnd).length > 3000) throw new Error("单条字幕过长，请拆分后重试");
          add(bodyStart, bodyEnd);
        }
        offset += block.length;
      }
    }
    if (!segments.length) throw new Error("文件没有可翻译的文字");
    return { text, format, segments };
  }
  function pairs(document, translations) {
    if (translations.length !== document.segments.length || translations.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error("译文不完整，请重试");
    }
    const result = [];
    document.segments.forEach((segment, i) => {
      const previous = result[result.length - 1];
      const gap = previous ? document.text.slice(previous.end, segment.start) : "";
      if (previous && document.format === "txt" && !/[\r\n]/.test(gap)) {
        previous.text += gap + segment.text;
        previous.translation += gap + translations[i].trim();
        previous.end = segment.end;
      } else result.push({ ...segment, translation: translations[i].trim() });
    });
    return result;
  }
  function render(document, translations, bilingual = false) {
    const newline = document.text.includes("\r\n") ? "\r\n" : "\n";
    let result = "", previous = 0;
    pairs(document, translations).forEach(segment => {
      let value = segment.translation;
      if (document.format !== "txt") value = value.replace(/\r?\n\s*\r?\n/g, "\n").replace(/\r?\n/g, newline);
      result += document.text.slice(previous, segment.start) + (bilingual ? segment.text + newline : "") + value;
      previous = segment.end;
    });
    return result + document.text.slice(previous);
  }
  return { parse, render, pairs };
})();
if (typeof module !== "undefined") module.exports = twpDocumentTranslation;
