// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpImageOCRLayout = (() => {
  const median = values => {const sorted = [...values].sort((a, b) => a - b);return sorted[Math.floor(sorted.length / 2)] || 1;};
  function join(left, right) {
    if (!left) return right;
    // CJK has no inter-word spaces; preserve spaces around Latin/math tokens.
    return left + (/[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff，。；：！？]/.test(right) || /^[,.;:!?%\)\]\}]/.test(right) ? '' : ' ') + right;
  }
  function reconstruct(items, mode = 'paragraph') {
    if (mode === 'raw') return items.map(item => item.text.trim()).filter(Boolean).join('\n');
    const boxes = items.filter(item => item.text?.trim() && item.poly?.length >= 4).map((item, index) => {
      const xs = item.poly.map(p => p[0]), ys = item.poly.map(p => p[1]);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      const edge = [item.poly[1][0] - item.poly[0][0], item.poly[1][1] - item.poly[0][1]];
      return {text: item.text.trim(), index, left, right, top, bottom, height: bottom - top, center: (top + bottom) / 2, rotated: Math.abs(edge[1]) > Math.abs(edge[0]) * .2};
    });
    const lines = [];
    const sameRow = (box, other) => {
      const overlap = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
      return overlap >= Math.min(box.height, other.height) * .45 && Math.abs(box.center - other.center) <= Math.max(box.height, other.height) * .55;
    };
    function merge(line, other) {
      line.boxes.push(...other.boxes);line.left = Math.min(line.left, other.left);line.right = Math.max(line.right, other.right);line.top = Math.min(line.top, other.top);line.bottom = Math.max(line.bottom, other.bottom);line.height = median(line.boxes.map(b => b.height));
    }
    for (const box of boxes.sort((a, b) => a.center - b.center || a.left - b.left)) {
      const line = !box.rotated && lines.find(candidate => !candidate.rotated && candidate.boxes.every(other => sameRow(box, other)) && Math.max(0, box.left - candidate.right, candidate.left - box.right) <= Math.max(box.height, candidate.height) * 1.8);
      if (line) {
        merge(line, {...box, boxes: [box]});
      } else lines.push({...box, boxes: [box]});
    }
    // Small vertical offsets can visit the left and right fragments before the
    // middle word. Once the middle arrives, merge the lines it bridges too.
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].rotated) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const left = lines[i], right = lines[j];
        if (!right.rotated && left.boxes.every(a => right.boxes.every(b => sameRow(a, b))) && Math.max(0, left.left - right.right, right.left - left.right) <= Math.max(left.height, right.height) * 1.8) {
          merge(left, right);lines.splice(j, 1);j = i;
        }
      }
    }
    for (const line of lines) line.text = line.boxes.sort((a, b) => a.left - b.left).reduce((text, box) => join(text, box.text), '');
    // Join only adjacent, aligned lines of comparable size. Large gaps and
    // separate columns/diagram labels stay independent.
    const blocks = [];
    for (const line of lines.sort((a, b) => a.top - b.top || a.left - b.left)) {
      const previous = blocks[blocks.length - 1];
      const height = previous ? Math.max(previous.height, line.height) : line.height;
      const gap = previous ? line.top - previous.bottom : Infinity;
      const aligned = previous && Math.abs(line.left - previous.left) <= height * 1.5;
      const sameSize = previous && Math.min(previous.height, line.height) / height >= .75;
      const prose = previous && (previous.text.length >= 35 || line.text.length >= 35 || /[a-z]-$/i.test(previous.text));
      const newListItem = /^(?:[•▪●◦–]|\d+[.)]|[A-Za-z][.)])\s/.test(line.text);
      if (mode === 'paragraph' && previous && !previous.rotated && !line.rotated && gap >= 0 && gap <= height * .85 && aligned && sameSize && prose && !newListItem) {
        previous.text = /[a-z]-$/i.test(previous.text) && /^[a-z]/.test(line.text) ? previous.text.slice(0, -1) + line.text : join(previous.text, line.text);previous.bottom = line.bottom;
      } else blocks.push({...line});
    }
    return blocks.map(block => block.text).join('\n\n');
  }
  return {reconstruct};
})();
if (typeof module !== 'undefined') module.exports = twpImageOCRLayout;
