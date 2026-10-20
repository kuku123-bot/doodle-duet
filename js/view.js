// Puts the drawing on screen: pan / zoom / rotate, layers, strokes being drawn right now (yours and your partner's),
// trace images, mode guides, the partner's cursor and laser trails. Redraws only when something changed.
import { clamp, makeCanvas } from './util.js';
import { brushOf } from './brushes.js';

export class View {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app;
    this.ctx = canvas.getContext('2d', { desynchronized: true });
    this.s = 1; this.r = 0; this.tx = 0; this.ty = 0; this.dpr = 1; this.W = 1; this.H = 1;
    this.queued = false; this.tmp = null; this.checker = null;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const oldW = this.W, oldH = this.H;
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.dpr = dpr;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    if (this.fitted) { this.tx += (this.W - oldW) / 2; this.ty += (this.H - oldH) / 2; } // keep the picture centred when the window changes
    this.request();
  }
  /** the matrix doc -> css px */
  m() { const c = Math.cos(this.r) * this.s, s = Math.sin(this.r) * this.s; return [c, s, -s, c, this.tx, this.ty]; }
  toDoc(x, y) {
    const dx = x - this.tx, dy = y - this.ty, c = Math.cos(-this.r), s = Math.sin(-this.r);
    return [(c * dx - s * dy) / this.s, (s * dx + c * dy) / this.s];
  }
  toScreen(x, y) { const [a, b, c, d, e, f] = this.m(); return [a * x + c * y + e, b * x + d * y + f]; }
  fit(animate) {
    const doc = this.app.doc, ins = this.app.insets();
    const aw = Math.max(80, this.W - ins.l - ins.r - 24), ah = Math.max(80, this.H - ins.t - ins.b - 24);
    const s = Math.min(aw / doc.w, ah / doc.h);
    const target = { s, r: 0, tx: ins.l + 12 + (aw - doc.w * s) / 2, ty: ins.t + 12 + (ah - doc.h * s) / 2 };
    this.fitted = true;
    if (!animate) { Object.assign(this, target); this.request(); return; }
    const from = { s: this.s, r: this.r, tx: this.tx, ty: this.ty }, t0 = performance.now();
    let dr = target.r - from.r; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    const step = (now) => {
      const t = clamp((now - t0) / 260, 0, 1), e = 1 - Math.pow(1 - t, 3);
      this.s = from.s + (target.s - from.s) * e; this.r = from.r + dr * e; this.tx = from.tx + (target.tx - from.tx) * e; this.ty = from.ty + (target.ty - from.ty) * e;
      this.draw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  /** zoom by factor k keeping the doc point under (sx, sy) in place */
  zoomAt(sx, sy, k) {
    const ns = clamp(this.s * k, 0.03, 40);
    const [dx, dy] = this.toDoc(sx, sy);
    this.s = ns;
    const [px, py] = this.toScreen(dx, dy);
    this.tx += sx - px; this.ty += sy - py;
    this.request();
  }
  rotateAt(sx, sy, da) {
    const [dx, dy] = this.toDoc(sx, sy);
    this.r += da;
    const [px, py] = this.toScreen(dx, dy);
    this.tx += sx - px; this.ty += sy - py;
    this.request();
  }
  panBy(dx, dy) { this.tx += dx; this.ty += dy; this.request(); }
  get zoomPct() { return Math.round(this.s * 100); }

  request() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  draw() {
    const { ctx, app } = this, doc = app.doc, dpr = this.dpr;
    if (!doc) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    const [a, b, c, d, e, f] = this.m();
    const T = () => ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    T();
    // paper + soft shadow
    ctx.save();
    ctx.shadowColor = 'rgba(46, 32, 70, 0.20)'; ctx.shadowBlur = 22 * dpr; ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = doc.bg.c === 'transparent' ? '#ffffff' : doc.bg.c;
    ctx.fillRect(0, 0, doc.w, doc.h);
    ctx.restore();
    if (doc.bg.c === 'transparent') { ctx.fillStyle = this._checker(); ctx.fillRect(0, 0, doc.w, doc.h); }
    ctx.imageSmoothingEnabled = this.s < 2.5;
    ctx.imageSmoothingQuality = this.s < 1 ? 'high' : 'medium';
    // trace images under the drawing
    if (!app.refsHidden) {
      for (const ref of doc.refs.list || []) {
        const im = app.refImage(ref.src);
        if (!im) continue;
        ctx.globalAlpha = clamp(ref.o === undefined ? 0.35 : ref.o, 0, 1);
        ctx.drawImage(im, ref.x, ref.y, ref.w, ref.h);
      }
      ctx.globalAlpha = 1;
    }
    // layers, each followed by any strokes being drawn on it right now
    const lives = app.liveList();
    for (const L of doc.layerList()) {
      if (!L.visible || (L.guide && app.guideHidden)) continue;
      const alpha = L.opacity * (L.guide ? 0.4 : 1);
      const mine = lives.filter((lv) => lv.op.l === L.id && lv.rect);
      const exact = mine.some((lv) => { const B = brushOf(lv.op.b); return B.erase || B.blend; });
      if (!exact) {
        ctx.globalAlpha = alpha; ctx.drawImage(L.canvas, 0, 0);
        for (const lv of mine) this._live(ctx, lv, lv.op.o * alpha, 'source-over');
      } else {
        // erasers / multiply need the layer and the stroke combined first
        if (!this.tmp || this.tmp.width !== doc.w || this.tmp.height !== doc.h) { [this.tmp, this.tctx] = makeCanvas(doc.w, doc.h, {}); }
        const t = this.tctx;
        t.globalCompositeOperation = 'copy'; t.globalAlpha = 1; t.drawImage(L.canvas, 0, 0); t.globalCompositeOperation = 'source-over';
        for (const lv of mine) { const B = brushOf(lv.op.b); this._live(t, lv, lv.op.o, B.erase ? 'destination-out' : B.blend || 'source-over'); }
        ctx.globalAlpha = alpha; ctx.drawImage(this.tmp, 0, 0);
      }
      ctx.globalAlpha = 1;
    }
    // guides drawn in drawing space
    app.modes.drawOverlay(ctx, this);
    app.drawDocOverlay(ctx, this);
    // screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    app.modes.drawScreen(ctx, this);
    app.drawScreenOverlay(ctx, this);
  }
  _live(ctx, lv, alpha, op) {
    const r = lv.rect;
    ctx.save();
    if (lv.op.cl) { ctx.beginPath(); ctx.rect(lv.op.cl[0], lv.op.cl[1], lv.op.cl[2], lv.op.cl[3]); ctx.clip(); }
    ctx.globalAlpha = clamp(alpha, 0, 1); ctx.globalCompositeOperation = op;
    ctx.drawImage(lv.canvas, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
    ctx.restore();
  }
  _checker() {
    if (this.checker) return this.checker;
    const [c, x] = makeCanvas(32, 32, {});
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#e9e6ef'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
    this.checker = this.ctx.createPattern(c, 'repeat');
    return this.checker;
  }
}
