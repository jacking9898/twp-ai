// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpRegionTranslator = (() => {
  let cleanup;
  function start({capture, finished}) {
    cleanup?.();
    const host = document.createElement('div');host.id = 'twp-region-selector';host.className = 'notranslate';host.setAttribute('translate','no');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;';
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = `<style>*{box-sizing:border-box}#surface{position:fixed;inset:0;cursor:crosshair;touch-action:none;background:#0003}#box{position:absolute;border:2px solid #ffad73;background:#ffad731a;box-shadow:0 0 0 9999px #0002;pointer-events:none}#guide{position:absolute;top:16px;left:50%;transform:translateX(-50%);max-width:90vw;padding:10px 14px;border-radius:10px;background:#24211e;color:#f5efe8;font:14px/1.5 system-ui;box-shadow:0 3px 20px #0005}button{font:inherit;background:#3c2a1e;color:#ffad73;border:1px solid #ffad73;border-radius:6px;margin-left:12px;padding:3px 10px;cursor:pointer}[hidden]{display:none}</style><div id="surface"><div id="guide" role="status">拖动框选文字 · Esc 取消<button id="cancel">取消</button></div><div id="box" hidden></div></div>`;
    const surface = root.getElementById('surface'), box = root.getElementById('box');
    let origin, pointer, ended = false;
    function end() {
      if (ended) return;ended = true;host.remove();
      document.removeEventListener('keydown', key, true);window.removeEventListener('resize', cancel);window.removeEventListener('pagehide', cancel);cleanup = null;
    }
    function cancel() {if(ended)return;end();finished();}
    const key = event => {if(event.key === 'Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}};
    root.getElementById('cancel').onclick = cancel;
    function point(event) {return {x:Math.max(0,Math.min(innerWidth,event.clientX)),y:Math.max(0,Math.min(innerHeight,event.clientY))};}
    function rectangle(event) {const p=point(event);return {x:Math.min(origin.x,p.x),y:Math.min(origin.y,p.y),width:Math.abs(p.x-origin.x),height:Math.abs(p.y-origin.y)};}
    surface.onpointerdown = event => {
      if (event.button !== 0 || event.target.closest('button') || pointer != null) return;
      event.preventDefault();origin = point(event);pointer=event.pointerId;surface.setPointerCapture(pointer);box.hidden = false;
      Object.assign(box.style,{left:origin.x+'px',top:origin.y+'px',width:'0',height:'0'});
    };
    surface.onpointermove = event => {if(event.pointerId !== pointer || !origin)return;const rect=rectangle(event);Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});};
    surface.onpointercancel = cancel;
    surface.onpointerup = async event => {
      if(event.pointerId !== pointer || !origin)return;
      const rect=rectangle(event), viewport={width:innerWidth,height:innerHeight};end();
      if(rect.width<12 || rect.height<12){finished('圈选区域太小，请重新框选。');return;}
      try {
        // Paint the page without selector/dock before the browser screenshot.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await capture(rect,viewport);finished();
      } catch(error) {finished(error.message || '圈选截图失败，请重试。');}
    };
    document.addEventListener('keydown',key,true);window.addEventListener('resize',cancel);window.addEventListener('pagehide',cancel);
    document.documentElement.append(host);cleanup=cancel;
  }
  return {start,cancel:()=>cleanup?.()};
})();
