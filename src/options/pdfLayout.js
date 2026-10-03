// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFLayout = (() => {
  const marker = /^(?:[•●▪■◦‣\uF0B7]|[-*–]\s|\d+[.)]\s|[a-zA-Z][.)]\s)\s*/;
  function vectorMarkers(operators, OPS) {
    let matrix=[1,0,0,1,0,0];const stack=[], markers=[];
    const point=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
    for(let i=0;i<operators.fnArray.length;i++) {
      const fn=operators.fnArray[i],args=operators.argsArray[i];
      if(fn===OPS.save) stack.push([...matrix]);
      else if(fn===OPS.restore) matrix=stack.pop() || [1,0,0,1,0,0];
      else if(fn===OPS.transform) {const [a,b,c,d,e,f]=matrix,[g,h,j,k,l,m]=args;matrix=[a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];}
      else if(fn===OPS.constructPath && (args[0]===OPS.fill || args[0]===OPS.eoFill) && args[2]?.length===4) {
        const [x,y,r,t]=args[2],p=point(x,y),q=point(r,t),w=Math.abs(q[0]-p[0]),h=Math.abs(q[1]-p[1]);
        if(w>=1 && w<=7 && h>=1 && h<=7 && w/h>.65 && w/h<1.5) markers.push({x:Math.min(p[0],q[0]),y:Math.min(p[1],q[1]),width:w,height:h});
      }
    }
    return markers;
  }
  // Preserve light, filled rectangular panels (examples/callouts), not arbitrary
  // diagrams or the original text. PDF.js constructPath uses move/line/close ops.
  function vectorBackgrounds(operators, OPS, viewport) {
    let matrix=[1,0,0,1,0,0],color='#000000';const stack=[],panels=[];
    for(let i=0;i<operators.fnArray.length;i++) {
      const fn=operators.fnArray[i],args=operators.argsArray[i];
      if(fn===OPS.save)stack.push({matrix:[...matrix],color});
      else if(fn===OPS.restore){const state=stack.pop();if(state){matrix=state.matrix;color=state.color;}}
      else if(fn===OPS.transform){const [a,b,c,d,e,f]=matrix,[g,h,j,k,l,m]=args;matrix=[a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];}
      else if(fn===OPS.setFillRGBColor || fn===OPS.setFillGray) {
        if(typeof args?.[0]==='string')color=args[0];
        else {const rgb=fn===OPS.setFillGray?[args[0],args[0],args[0]]:args;color='#'+rgb.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');}
      }
      else if(fn===OPS.constructPath && (args[0]===OPS.fill || args[0]===OPS.eoFill)) {
        const p=args[1]?.[0];
        if(!p || p.length!==13 || p[0]!==0 || p[3]!==1 || p[6]!==1 || p[9]!==1 || p[12]!==4)continue;
        const points=[[p[1],p[2]],[p[4],p[5]],[p[7],p[8]],[p[10],p[11]]];
        if(new Set(points.map(p=>p[0])).size!==2 || new Set(points.map(p=>p[1])).size!==2)continue;
        if(!/^#[0-9a-f]{6}$/i.test(color))continue;
        const rgb=[1,3,5].map(n=>parseInt(color.slice(n,n+2),16));
        if(Math.min(...rgb)<190 || Math.min(...rgb)>252)continue;
        const transformed=points.map(([x,y])=>viewport.convertToViewportPoint(matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]));
        const xs=transformed.map(p=>p[0]/viewport.width),ys=transformed.map(p=>p[1]/viewport.height);
        const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
        if(bounds.width>.15 && bounds.height>.025 && bounds.width*bounds.height<.9)panels.push({...bounds,color});
      }
    }
    return panels;
  }
  function extract(items, styles = {}, viewport, graphics = []) {
    const math=typeof module!=="undefined"?require('./pdfMath.js'):twpPDFMath;
    const formulas=math.detect(items,styles,viewport),preserved=new Set(formulas.flatMap(f=>[...f.items]));
    items=items.filter(item=>!preserved.has(item));
    const lines = []; let line;
    const scripts={super:Object.fromEntries([..."0123456789+-−=()nijkx"].map((c,i)=>[c,[..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿⁱʲᵏˣ"][i]])),sub:Object.fromEntries([..."0123456789+-−=()nijkx"].map((c,i)=>[c,[..."₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₙᵢⱼₖₓ"][i]]))};
    function flushScript(row){if(!row?.script)return;const {kind,text}=row.script,map=scripts[kind];row.text += [...text].every(c=>map[c])?[...text].map(c=>map[c]).join(''):(kind==='super'?'^':'_')+'{'+text+'}';row.script=null;}
    for (const item of items) {
      if (typeof item.str !== "string" || !item.transform) continue;
      const [a,b,,,x,rawY] = item.transform;
      // TeX extension-font sums use a raised glyph origin and an ASCII P mapping.
      // Anchor inline operators to the surrounding prose baseline, while keeping
      // raw geometry for source hit boxes. Display equations were preserved above.
      const inlineSum=line && item.str==='P' && /CMEX/i.test(styles[item.fontName]?.fontFamily||'') &&
        rawY>line.y && rawY-line.y<line.height*1.2 && x>=line.end && x-line.end<line.height*2;
      const blackboard=/dsrom|MSBM/i.test(styles[item.fontName]?.fontFamily||'')?{R:'ℝ',N:'ℕ',Z:'ℤ',Q:'ℚ',C:'ℂ'}[item.str]:null;
      const y=inlineSum?line.y:rawY, text=inlineSum?'∑':blackboard||item.str;
      const height = Math.max(1, item.height || Math.hypot(a,b)), end = x + item.width;
      if (!item.str.trim()) { if (item.hasEOL) {flushScript(line);line = null;} continue; }
      const script=line && height<line.height*.82 && Math.abs(y-line.y)<line.height*.75 && Math.abs(y-line.y)>line.height*.1 && x>=(line.baseEnd??line.end)-line.height*.25 && x-line.end<line.height;
      // Large horizontal jumps split columns and marginal notes on the same baseline.
      const separateNote=line && !script && Math.abs(height-line.height)>line.height*.18 && x-line.end>Math.min(height,line.height)*.6;
      if (!line || separateNote || (!script && Math.abs(y-line.y) > Math.max(height,line.height)*.4) || x-line.end > height*3 || x < line.x-height) {
        flushScript(line);
        line = {text:"",x,y,height,end:x,font:item.fontName,fonts:new Map(),rects:[]}; lines.push(line);
      }
      const gap = x-line.end;
      if(script){const kind=y>line.y?'super':'sub';if(line.script?.kind!==kind){flushScript(line);line.script={kind,text:''};}line.script.text+=text;}
      else {flushScript(line);line.text += (line.text && gap > height*.15 && !/\s$/.test(line.text) && !/^\s/.test(text) ? " " : "") + text;line.baseEnd=end;}
      line.end = end;
      line.fonts.set(item.fontName,(line.fonts.get(item.fontName)||0)+item.str.length);
      line.font=[...line.fonts].sort((a,b)=>b[1]-a[1])[0][0];
      // Use the page viewport transformation, including crop box and rotation.
      const length = Math.hypot(a,b) || height, ux = a/length, uy = b/length;
      const ascent = styles[item.fontName]?.ascent ?? .85;
      const corners = [[x-uy*height*ascent,rawY+ux*height*ascent],
        [x+ux*item.width-uy*height*ascent,rawY+uy*item.width+ux*height*ascent],
        [x+ux*item.width+uy*height*(1-ascent),rawY+uy*item.width-ux*height*(1-ascent)],
        [x+uy*height*(1-ascent),rawY-ux*height*(1-ascent)]];
      if (viewport) {
        const points = corners.map(p=>viewport.convertToViewportPoint(...p));
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
        line.rects.push({x:Math.min(...xs)/viewport.width,y:Math.min(...ys)/viewport.height,
          width:(Math.max(...xs)-Math.min(...xs))/viewport.width,height:(Math.max(...ys)-Math.min(...ys))/viewport.height});
      }
      if (item.hasEOL && !script) {flushScript(line);line = null;}
    }
    flushScript(line);
    const weights = new Map();
    for (const row of lines) { const size=Math.round(row.height); weights.set(size,(weights.get(size)||0)+row.text.length); }
    const bodySize = [...weights].sort((a,b)=>b[1]-a[1])[0]?.[0] || 12;
    const left = Math.min(...lines.map(row=>row.x));
    const blocks = []; let previous;
    for (const row of lines) {
      row.text = row.text.trim().replace(/̸\s*=/gu,'≠');
      const graphic=graphics.find(r=>row.x-(r.x+r.width)>=-1 && row.x-(r.x+r.width)<row.height*2 && Math.abs(r.y+r.height/2-row.y-row.height*.25)<row.height*.5);
      const list = marker.test(row.text) || !!graphic;
      const styledRatio=pattern=>[...row.fonts].reduce((sum,[font,count])=>sum+(pattern.test(`${font} ${styles[font]?.fontFamily || ''}`)?count:0),0)/Math.max(1,[...row.fonts.values()].reduce((sum,count)=>sum+count,0));
      const bold=styledRatio(/bold/i)>.8,italic=styledRatio(/italic|oblique/i)>.8;
      const heading = !list && (row.height > bodySize*1.18 || ((bold || italic) && row.text.length < 120));
      // A marginal note may interrupt the PDF stream in the middle of a body paragraph.
      // Resume the nearest compatible column, without merging side notes into the body.
      const continuation=[...blocks].reverse().find(block=>{
        const r=block.lastRow,dy=r.y-row.y;
        const overlap=Math.min(r.end,row.end)-Math.max(r.x,row.x);
        return dy>0 && dy<=Math.max(r.height,row.height)*1.8 && Math.abs(r.height-row.height)<row.height*.15 &&
          overlap>Math.min(r.end-r.x,row.end-row.x)*.5 && Math.abs(r.x-row.x)<row.height*3;
      });
      const last = continuation || blocks.at(-1);
      previous=last?.lastRow;
      const delta = previous ? previous.y-row.y : 0;
      const indent = previous ? row.x-previous.x : 0;
      const hanging = last?.kind === "list" && indent >= 0 && indent < row.height*3;
      const firstLineIndent = last?.kind === "paragraph" && last.lineCount === 1 && indent < 0 && -indent < row.height*2.5;
      const split = !previous || list || heading || last.kind === "heading" || delta <= 0 ||
        delta > Math.max(previous.height,row.height)*1.8 ||
        Math.abs(previous.height-row.height) > row.height*.15 ||
        (Math.abs(indent) > row.height*.7 && !hanging && !firstLineIndent) ||
        (last.kind === "list" && row.x < last.x-row.height*.5 && !list);
      if (split) blocks.push({id:blocks.length,text:row.text,kind:list?"list":heading?"heading":"paragraph",marker:list?(row.text.match(marker)?.[0].trim() || "▪"):"",
        fontSize:row.height,bodySize,indent:Math.max(0,Math.min(4,(row.x-left)/bodySize)),
        italic,bold,x:row.x,lineCount:1,rects:[...row.rects],lastRow:row});
      else {
        const cjk = /[\u3400-\u9fff]$/.test(last.text) && /^[\u3400-\u9fff]/.test(row.text);
        // Join soft-wrapped words, while retaining explicit separators elsewhere.
        if (/[a-zA-Z]{2}-$/u.test(last.text) && /^[a-z]/.test(row.text)) last.text=last.text.slice(0,-1)+row.text;
        else last.text += (cjk ? "" : " ") + row.text;
        last.rects.push(...row.rects);
        last.lineCount++;
        last.lastRow=row;
      }
      previous = row;
    }
    for (const block of blocks) if(block.rects.length) {
      const x=Math.min(...block.rects.map(r=>r.x)),y=Math.min(...block.rects.map(r=>r.y));
      block.bounds={x,y,width:Math.max(...block.rects.map(r=>r.x+r.width))-x,height:Math.max(...block.rects.map(r=>r.y+r.height))-y};
    }
    // Infer alignment from the body column, rather than centering every heading.
    const body=blocks.filter(b=>b.bounds && b.kind==='paragraph' && b.bounds.width>.3 && b.fontSize>=bodySize*.85);
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const column=body.length?{left:median(body.map(b=>b.bounds.x)),right:median(body.map(b=>b.bounds.x+b.bounds.width))}:null;
    for(const block of blocks) {
      block.align='left';const b=block.bounds;
      if(!b || !column)continue;
      if(b.y<.15 && b.x>column.left+.1 && Math.abs(b.x+b.width-column.right)<.025)block.align='right';
      else if(block.kind==='heading' && b.y>=.15 && b.x>column.left+.025 && Math.abs(b.x+b.width/2-(column.left+column.right)/2)<.025)block.align='center';
    }
    for(const formula of formulas.sort((a,b)=>a.bounds.y-b.bounds.y)) {
      const block={kind:'formula',text:'[公式：保留原 PDF 图形，TXT 不包含公式图像]',bounds:formula.bounds,rects:[formula.bounds],fontSize:formula.fontSize,bodySize,indent:0};
      const index=blocks.findIndex(b=>b.bounds && b.bounds.y>formula.bounds.y);
      blocks.splice(index<0?blocks.length:index,0,block);
    }
    let text = "";
    for (const [id,block] of blocks.entries()) {
      block.id=id;
      delete block.lastRow;
      if (text) text += "\n\n";
      block.start=text.length; text+=block.text; block.end=text.length;
    }
    for(const block of blocks) {
      const b=block.bounds;
      if(!b || b.width>.2 || block.fontSize>=bodySize*.86 || block.kind!=='paragraph')continue;
      const anchor=blocks.find(candidate=>{
        const r=candidate.bounds;
        return candidate.kind==='paragraph' && r?.width>.3 && candidate.fontSize>=bodySize*.85 &&
          b.y>=r.y-.01 && b.y<r.y+r.height && (b.x>=r.x+r.width-.002 || b.x+b.width<=r.x+.002);
      });
      if(anchor)block.anchorId=anchor.id;
    }
    return {text,blocks};
  }
  return {extract, vectorMarkers, vectorBackgrounds, stripMarker: text=>text.replace(marker,"")};
})();
if (typeof module !== "undefined") module.exports = twpPDFLayout;
