// Small real PDF with a text layer, vector graphics and an empty final page.
module.exports = function pdfFixture(options = {}) {
  const pages = options.pages || [
    ["COMPUTER SCIENCE", "A practical reading guide", "A distributed system connects multiple computers.", "A hash table supports efficient data lookup."],
    ["LANGUAGE MODELS", "A second page for translation", "Retrieval augmented generation uses external knowledge.", "Attention connects tokens across a sequence."],
    [],
  ];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_,i) => `${4+i*2} 0 R`).join(" ")}] /Count ${pages.length} >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /${options.fontName||'Helvetica'} >>`];
  pages.forEach((lines, i) => {
    const [width, height] = options.sizes?.[i] || [595,842];
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);
    const content = lines.map((entry,index) => {
      const line=typeof entry === "string"?{text:entry}:entry;
      const x=line.x??45,y=line.y??height-82-index*(options.lineGap||48);
      return (line.bullet?`q 1 0 0 1 ${x-8} ${y+2} cm 0 0 3 3 re f Q\n`:"")+`BT /F1 ${line.size || (index === 0 ? 22 : 12)} Tf 0.12 0.2 0.35 rg ${x} ${y} Td (${line.text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
    }).join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  if (options.outline) {
    const root = objects.length + 1, first = root + 1;
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R >>`;
    objects.push(`<< /Type /Outlines /First ${first} 0 R /Last ${first+pages.length-1} 0 R /Count ${pages.length} >>`);
    pages.forEach((_,i) => objects.push(`<< /Title (Chapter ${i+1}) /Parent ${root} 0 R ${i ? `/Prev ${first+i-1} 0 R` : ""} ${i < pages.length-1 ? `/Next ${first+i+1} 0 R` : ""} /Dest [${4+i*2} 0 R /Fit] >>`));
  }
  let text = "%PDF-1.7\n", offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index+1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
};
