// Time-lapse: replays the whole drawing stroke by stroke (both of you), and can record it as a video to share.
import { h, makeCanvas, clamp } from './util.js';
import { icon } from './icons.js';
import { keyCmp } from './doc.js';
import { StrokeRenderer, compositeStroke, bbRect } from './brushes.js';
import { openSheet, sheetHead, toast } from './ui/widgets.js';

export function openReplay(app) {
  const d = app.doc;
  const layers = d.layerList().filter((L) => !L.guide);
  const ids = new Set(layers.map((L) => L.id));
  const ops = [...d.ops.values()].filter((o) => !o.u && ids.has(o.l)).sort(keyCmp);
  if (!ops.length) { toast('Draw something first, then watch it come to life'); return; }
  const cost = (o) => (o.t === 's' ? Math.max(4, (o.p || []).length / 3) : 25);
  const total = ops.reduce((n, o) => n + cost(o), 0);
  const view = makeCanvas(Math.round(d.w * Math.min(1, 1080 / Math.max(d.w, d.h))), Math.round(d.h * Math.min(1, 1080 / Math.max(d.w, d.h))));
  const vx = view.getContext('2d');
  view.style.cssText = 'width:100%;height:auto;max-height:62vh;object-fit:contain;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);display:block';
  const canv = new Map(layers.map((L) => [L.id, makeCanvas(d.w, d.h)]));
  const scratch = makeCanvas(d.w, d.h), sx = scratch.getContext('2d');
  let i = 0, cur = null, playing = true, speed = 1, raf = 0, rec = null, chunks = [];
  const reset = () => { for (const c of canv.values()) c.getContext('2d').clearRect(0, 0, d.w, d.h); sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, d.w, d.h); i = 0; cur = null; };
  const paint = () => {
    const s = view.width / d.w;
    vx.setTransform(1, 0, 0, 1, 0, 0);
    vx.fillStyle = d.bg.c === 'transparent' ? '#ffffff' : d.bg.c; vx.fillRect(0, 0, view.width, view.height);
    vx.setTransform(s, 0, 0, s, 0, 0); vx.imageSmoothingQuality = 'high';
    for (const L of layers) {
      if (!L.visible) continue;
      vx.globalAlpha = L.opacity; vx.drawImage(canv.get(L.id), 0, 0);
      if (cur && cur.op.l === L.id && cur.rect && !cur.erase) {
        vx.save(); if (cur.op.cl) { vx.beginPath(); vx.rect(...cur.op.cl); vx.clip(); }
        vx.globalAlpha = L.opacity * cur.op.o; vx.drawImage(scratch, 0, 0); vx.restore();
      }
    }
    vx.globalAlpha = 1;
    bar.style.width = (Math.min(1, i / ops.length) * 100).toFixed(1) + '%';
  };
  const step = () => {
    let budget = (total / (clamp(ops.length * 0.12, 6, 28) * 60)) * speed;
    while (budget > 0 && i < ops.length) {
      const op = ops[i];
      if (op.t !== 's') { d.renderOp(canv.get(op.l).getContext('2d'), op); i++; budget -= 25; continue; }
      if (!cur) { const r = new StrokeRenderer(op, sx); cur = { op, r, at: 0, rect: null, erase: !!r.B.erase }; }
      const n = Math.max(1, Math.ceil(budget)), from = cur.at * 3, to = Math.min(op.p.length, (cur.at + n) * 3);
      cur.r.add(op.p.slice(from, to)); cur.at = to / 3; budget -= (to - from) / 3 + 0.5;
      cur.rect = bbRect(cur.r.bb, d.w, d.h);
      if (to >= op.p.length) {
        cur.r.finish(); cur.rect = bbRect(cur.r.bb, d.w, d.h);
        compositeStroke(canv.get(op.l).getContext('2d'), op, scratch, cur.rect);
        sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalAlpha = 1; sx.clearRect(0, 0, d.w, d.h);
        cur = null; i++;
      }
    }
  };
  const loop = () => {
    if (!view.isConnected) return;
    if (playing) { step(); paint(); }
    if (i >= ops.length && !cur) { playing = false; playBtn.innerHTML = icon('play', 20); if (rec) { const r = rec; rec = null; setTimeout(() => r.stop(), 600); } }
    raf = requestAnimationFrame(loop);
  };
  const playBtn = h('button', { class: 'btn', onclick: () => { if (i >= ops.length) reset(); playing = !playing; playBtn.innerHTML = icon(playing ? 'pause' : 'play', 20); } });
  playBtn.innerHTML = icon('pause', 20);
  const bar = h('div', { style: 'height:100%;width:0;background:var(--accent);border-radius:9px' });
  const speedSel = h('select', { class: 'chip-select', onchange: (e) => { speed = +e.target.value; } }, [[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('option', { value: v, selected: v === 1 }, l)));
  const canRecord = typeof MediaRecorder !== 'undefined' && view.captureStream;
  const recBtn = canRecord ? h('button', { class: 'btn pri', onclick: () => startRecording() }, h('span', { html: icon('camera', 18) }), 'Save as video') : null;
  function startRecording() {
    if (rec) return;
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) { toast('Video recording is not supported in this browser'); return; }
    reset(); playing = true; playBtn.innerHTML = icon('pause', 20);
    chunks = [];
    const stream = view.captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      const name = 'doodle-duet-timelapse.' + (type.includes('mp4') ? 'mp4' : 'webm');
      const file = new File([blob], name, { type: blob.type });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { /* fall back to download */ } }
      const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
      toast('Time-lapse saved 🎬');
    };
    rec.start(250);
    recBtn.disabled = true; recBtn.lastChild.textContent = 'Recording…';
    const done = () => { recBtn.disabled = false; recBtn.lastChild.textContent = 'Save as video'; };
    rec.addEventListener('stop', done);
  }
  openSheet((close) => [
    sheetHead('Time-lapse', `${ops.length} strokes, replayed in the order you two made them.`, close),
    view,
    h('div', { style: 'height:6px;background:var(--sunk);border-radius:9px;margin:10px 0;overflow:hidden' }, bar),
    h('div', { class: 'btns', style: 'align-items:center' }, playBtn, h('button', { class: 'btn', onclick: () => { reset(); playing = true; playBtn.innerHTML = icon('pause', 20); } }, 'Restart'), speedSel, recBtn),
  ], { wide: true, onClose: () => { cancelAnimationFrame(raf); if (rec) { rec.onstop = null; try { rec.stop(); } catch (e) { /* ignore */ } } for (const c of canv.values()) c.width = c.height = 1; scratch.width = scratch.height = 1; } });
  raf = requestAnimationFrame(loop);
}
