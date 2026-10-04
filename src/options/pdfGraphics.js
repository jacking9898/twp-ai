// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFGraphics = (() => {
  const multiply=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
  function painted(operators, OPS, viewport) {
    let matrix=[1,0,0,1,0,0],color='#000000',clip={x:0,y:0,right:viewport.width,bottom:viewport.height};const stack=[],boxes=[];
    const intersect=(a,b)=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
    const bounds=(rect)=>{
      const [x,y,r,t]=rect,points=[[x,y],[r,y],[x,t],[r,t]].map(([a,b])=>viewport.convertToViewportPoint(matrix[0]*a+matrix[2]*b+matrix[4],matrix[1]*a+matrix[3]*b+matrix[5]));
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      return {x:Math.max(0,Math.min(...xs)),y:Math.max(0,Math.min(...ys)),right:Math.min(viewport.width,Math.max(...xs)),bottom:Math.min(viewport.height,Math.max(...ys))};
    };
    for(let i=0;i<operators.fnArray.length;i++) {
      const op=operators.fnArray[i],args=operators.argsArray[i];
      if(op===OPS.save || op===OPS.paintFormXObjectBegin || op===OPS.beginGroup){stack.push({matrix:[...matrix],color,clip});if(op===OPS.paintFormXObjectBegin){if(args[0])matrix=multiply(matrix,args[0]);if(args[1])clip=intersect(clip,bounds(args[1]));}else if(op===OPS.beginGroup){if(args[0].matrix)matrix=multiply(matrix,args[0].matrix);if(args[0].bbox)clip=intersect(clip,bounds(args[0].bbox));}}
      else if(op===OPS.restore || op===OPS.paintFormXObjectEnd || op===OPS.endGroup){const state=stack.pop();if(state){matrix=state.matrix;color=state.color;clip=state.clip;}}
      else if(op===OPS.transform)matrix=multiply(matrix,args);
      else if(op===OPS.setFillRGBColor || op===OPS.setFillGray){if(typeof args[0]==='string')color=args[0];else {const rgb=op===OPS.setFillGray?[args[0],args[0],args[0]]:args;color='#'+rgb.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');}}
      else if(op===OPS.constructPath && args[2]?.length===4) {
        if(args[0]===OPS.endPath){if([OPS.clip,OPS.eoClip].includes(operators.fnArray[i-1]))clip=intersect(clip,bounds(args[2]));continue;}
        const b=intersect(clip,bounds(args[2])),w=b.right-b.x,h=b.bottom-b.y,fill=args[0]===OPS.fill || args[0]===OPS.eoFill;
        const rgb=/^#[0-9a-f]{6}$/i.test(color)?[1,3,5].map(n=>parseInt(color.slice(n,n+2),16)):[];
        const p=args[1]?.[0],rectangle=p?.length===13 && p[0]===0 && p[3]===1 && p[6]===1 && p[9]===1 && p[12]===4 && new Set([p[1],p[4],p[7],p[10]]).size===2 && new Set([p[2],p[5],p[8],p[11]]).size===2;
        // Callout panels, page rules and bullet squares are layout decoration.
        if(fill && rectangle && rgb.length && (Math.min(...rgb)>252 || (Math.min(...rgb)>=190 && w>viewport.width*.15 && h>viewport.height*.025)))continue;
        if((w<1.5 && h>viewport.height*.4) || (h<1.5 && w>viewport.width*.6) || (w<=7 && h<=7 && fill && rectangle && Math.abs(w-h)<2))continue;
        if(w>=0 && h>=0 && w+h>1)boxes.push({...b,image:false,solid:!rectangle && [OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(args[0]) && w>18 && h>18});
      }
      else if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintSolidColorImageMask].includes(op)) {
        const b=intersect(clip,bounds([0,0,1,1]));if(b.right>b.x && b.bottom>b.y)boxes.push({...b,image:true});
      }
    }
    return boxes;
  }
  const union=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)});
  function runningText(items,viewport) {
    const rows=items.filter(i=>i.str?.trim() && i.transform && Math.abs(i.transform[1])<.01);
    const protectedItems=new Set();
    for(const number of rows.filter(i=>/^(?:\d{1,4}|[ivxlcdm]+)$/i.test(i.str.trim()))) {
      const p=viewport.convertToViewportPoint(number.transform[4],number.transform[5]);
      if(p[1]>viewport.height*.17 && p[1]<viewport.height*.85)continue;
      const height=number.height||10;
      const header=rows.filter(item=>item!==number && item.str.trim().length>=8 && /[a-zA-Z]{3}|[\u3400-\u9fff]{2}/.test(item.str) &&
        Math.abs(item.transform[5]-number.transform[5])<Math.max(height,item.height||height)*.4 &&
        Math.abs(item.transform[4]-number.transform[4])>viewport.width*.15);
      if(header.length){protectedItems.add(number);for(const item of header)protectedItems.add(item);}
    }
    return protectedItems;
  }
  function detect(operators,OPS,viewport,items,styles) {
    const boxes=painted(operators,OPS,viewport),groups=[];
    // Nearby numeric running page headers are not graph ticks. Including one
    // expands the crop over the running title and puts that title below the graph.
    const protectedItems=runningText(items,viewport);
    const near=(a,b,gap)=>Math.max(a.x,b.x)-Math.min(a.right,b.right)<=gap && Math.max(a.y,b.y)-Math.min(a.bottom,b.bottom)<=gap;
    for(const box of boxes){let group={...box,count:1,image:box.image};for(let i=groups.length-1;i>=0;i--)if(near(group,groups[i],9)){group={...union(group,groups[i]),count:group.count+groups[i].count,image:group.image||groups[i].image,solid:group.solid||groups[i].solid};groups.splice(i,1);i=groups.length;}groups.push(group);}
    // Small adjacent vector/matrix panels belong to the same diagram band.
    for(let i=0;i<groups.length;i++)for(let j=groups.length-1;j>i;j--) {
      const a=groups[i],b=groups[j],vertical=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);
      if(a.count>=3 && b.count>=3 && vertical>Math.min(a.bottom-a.y,b.bottom-b.y)*.7 && near(a,b,28)) {groups[i]={...union(a,b),count:a.count+b.count,image:a.image||b.image,solid:a.solid||b.solid};groups.splice(j,1);}
    }
    const regions=[];
    for(const group of groups) {
      let b={...group};const w=b.right-b.x,h=b.bottom-b.y;
      if(!group.image && !group.solid && (group.count<3 || w<8 || h<18))continue;
      // A cover/background is rendered without text so translated cover text can
      // remain above it. Ordinary figures keep their labels and complete pixels.
      const backdrop=group.image && w*h>viewport.width*viewport.height*.65;
      const members=new Set();
      const captions=items.filter(item=>/^(?:Figure\s+\d+(?:\.\d+)?$|Remark|Definition|Approach$|\([ab]\) Approach)/.test(item.str||''));
      if(!backdrop)for(const item of items) {
        if(!item.str?.trim() || !item.transform || protectedItems.has(item))continue;
        const [a,c,,,x,y]=item.transform,height=item.height||Math.hypot(a,c)||10,length=Math.hypot(a,c)||height,ux=a/length,uy=c/length;
        const q=viewport.convertToViewportPoint(x,y),angle=Math.abs(c)>.01;
        const points=[[x-uy*height*.85,y+ux*height*.85],[x+ux*item.width-uy*height*.85,y+uy*item.width+ux*height*.85],[x+ux*item.width+uy*height*.15,y+uy*item.width-ux*height*.15],[x+uy*height*.15,y-ux*height*.15]].map(p=>viewport.convertToViewportPoint(...p));
        const rect={x:Math.min(...points.map(p=>p[0])),y:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1]))};
        const font=styles[item.fontName]?.fontFamily||'',label=/CM(?:MI|SY|EX)|MS[AB]M|dsrom|math|symbol/i.test(font) || angle || height<9 || item.str.length<25;
        const cx=(rect.x+rect.right)/2,cy=(rect.y+rect.bottom)/2,centerInside=cx>=group.x-2 && cx<=group.right+2 && cy>=group.y-2 && cy<=group.bottom+2;
        if(captions.some(c=>{
          const dy=c.transform[5]-y;
          return (dy>=-height*1.5 && dy<height*4.5 && /Approach/.test(c.str) && x>=c.transform[4]-height*3 && x-c.transform[4]<viewport.width*.4) ||
            (Math.abs(dy)<height*.4 && x>=c.transform[4]-height*3 && x-c.transform[4]<viewport.width*.6) ||
            (/^Figure/.test(c.str) && dy>=0 && dy<height*2.8 && Math.abs(x-c.transform[4])<height*2);
        }))continue;
        const gap=angle?32:16;
        if(centerInside || (label && near(group,rect,gap) && cx>=group.x-gap && cx<=group.right+gap)){members.add(item);b=union(b,rect);}
      }
      // Subfigure explanations with interleaved fractions belong to the composite
      // diagram. Keep (a)/(b) with it; the separate Figure caption stays translatable.
      if(!backdrop)for(const caption of captions.filter(c=>/Approach/.test(c.str))) {
        const h=caption.height||8,q=viewport.convertToViewportPoint(caption.transform[4],caption.transform[5]);
        if(q[1]-group.bottom<-h || q[1]-group.bottom>h*3.5 || q[0]>group.right || q[0]<group.x-h*4)continue;
        for(const item of items) {
          if(!item.str?.trim() || protectedItems.has(item))continue;
          const p=viewport.convertToViewportPoint(item.transform[4],item.transform[5]),height=item.height||h;
          if(p[0]<q[0]-h*3 || p[0]+item.width>q[0]+viewport.width*.38 || p[1]<q[1]-h*1.5 || p[1]>q[1]+h*4.5)continue;
          members.add(item);b=union(b,{x:p[0],y:p[1]-height,right:p[0]+item.width,bottom:p[1]+height*.25});
        }
      }
      const pad=2,x=Math.max(0,b.x-pad),y=Math.max(0,b.y-pad),right=Math.min(viewport.width,b.right+pad),bottom=Math.min(viewport.height,b.bottom+pad);
      regions.push({kind:backdrop?'artwork':'figure',items:members,bounds:{x:x/viewport.width,y:y/viewport.height,width:(right-x)/viewport.width,height:(bottom-y)/viewport.height},fontSize:10});
    }
    return regions;
  }
  return {painted,detect};
})();
if(typeof module!=="undefined")module.exports=twpPDFGraphics;
