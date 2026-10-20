// The shared drawing. Both devices hold a full copy and converge without a server:
// - every drawing action is an immutable "op" with a Lamport key (k, author); each layer keeps its ops sorted by that key,
//   so both screens composite them in the same order even when two strokes finish at the same moment;
// - undo/redo flips op.u with a version (uv), only the author ever changes it, so the highest version wins;
// - layer settings, layer order, trace images, the game mode and the paper colour are last-writer-wins records (v, by);
// - on (re)connect both sides swap the ids they have and send each other what is missing (see main.js "sync").
// Layer canvases are caches: `disp` = everything, `base` = the oldest ops baked in (only the newest MAX_LIVE ops per
// layer are replayed when something in the middle changes).
import { makeCanvas, rid, clamp } from './util.js';
import { StrokeRenderer, compositeStroke, bbRect } from './brushes.js';
import { applyFill } from './fill.js';

export const MAX_LIVE = 120, BAKE = 30, MAX_LAYERS = 8;
export const FONTS = {
  round: { name: 'Rounded', css: '600 {z}px ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif' },
  hand: { name: 'Handwritten', css: '{z}px "Chalkboard SE", "Comic Sans MS", "Marker Felt", "Comic Neue", cursive' },
  serif: { name: 'Serif', css: '{z}px Georgia, "Times New Roman", serif' },
  bold: { name: 'Poster', css: '900 {z}px "Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif' },
};
export const fontCss = (key, z) => (FONTS[key] || FONTS.round).css.replace('{z}', Math.round(z));
export const newer = (a, b) => (a.v || 0) > (b.v || 0) || ((a.v || 0) === (b.v || 0) && String(a.by || '') > String(b.by || ''));
export function keyCmp(a, b) { return a.k - b.k || (a.a < b.a ? -1 : a.a > b.a ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }

export class Layer {
  constructor(doc, m) {
    this.doc = doc; this.id = m.id; this.name = m.name || 'Layer'; this.visible = m.visible !== false; this.opacity = m.opacity === undefined ? 1 : m.opacity;
    this.guide = !!m.guide; this.v = m.v || 0; this.by = m.by || ''; this.del = !!m.del;
    this.ops = []; this.frozen = 0; this.base = null; this.bctx = null; this.rev = 0;
    [this.canvas, this.ctx] = makeCanvas(doc.w, doc.h, {});
  }
  meta() { return { id: this.id, name: this.name, visible: this.visible, opacity: this.opacity, guide: this.guide, v: this.v, by: this.by, del: this.del }; }
}

export class Doc {
  constructor(o = {}) {
    this.id = o.id || rid(10); this.w = clamp(o.w | 0 || 1600, 64, 4096); this.h = clamp(o.h | 0 || 1600, 64, 4096);
    this.bg = { c: o.bg && o.bg.c ? o.bg.c : '#ffffff', v: 0, by: '' };
    this.title = o.title || ''; this.created = o.created || Date.now(); this.updated = o.updated || this.created;
    this.clock = 0; this.layers = new Map(); this.order = { ids: [], v: 0, by: '' };
    this.refs = { list: [], v: 0, by: '' };
    this.mode = { id: 'free', p: {}, v: 0, by: '' };
    this.ops = new Map();
    [this.scratch, this.sctx] = makeCanvas(this.w, this.h, {});
    this.onChange = null; // (what) => void
  }
  changed(what) { this.updated = Date.now(); if (this.onChange) this.onChange(what); }
  tick(k) { if (k > this.clock) this.clock = k | 0; }
  nextK() { return ++this.clock; }
  get opCount() { return this.ops.size; }

  // ---------------------------------------------------------------- layers + records
  layerList() { const out = []; for (const id of this.order.ids) { const L = this.layers.get(id); if (L && !L.del) out.push(L); } return out; }
  _ensureLayer(id) {
    let L = this.layers.get(id);
    if (!L) { L = new Layer(this, { id, name: 'Layer', v: 0 }); this.layers.set(id, L); if (!this.order.ids.includes(id)) this.order.ids.push(id); }
    return L;
  }
  addLayer(m, by) {
    const L = new Layer(this, { ...m, id: m.id || rid(6), v: this.nextK(), by });
    this.layers.set(L.id, L);
    const ids = this.order.ids.filter((x) => x !== L.id);
    const at = m.at === undefined ? ids.length : clamp(m.at, 0, ids.length);
    ids.splice(at, 0, L.id);
    this.order = { ids, v: this.nextK(), by };
    this.changed('layers');
    return L;
  }
  updateLayer(id, patch, by) {
    const L = this.layers.get(id);
    if (!L) return null;
    const wasDel = L.del;
    Object.assign(L, patch); L.v = this.nextK(); L.by = by;
    if (L.del && !wasDel) this._freeLayer(L);
    this.changed('layers');
    return L.meta();
  }
  mergeLayer(m) {
    if (!m || !m.id) return false;
    this.tick(m.v || 0);
    let L = this.layers.get(m.id);
    if (!L) { L = this._ensureLayer(m.id); }
    else if (!newer(m, L)) return false;
    const wasDel = L.del;
    L.name = String(m.name || 'Layer').slice(0, 40); L.visible = m.visible !== false; L.opacity = clamp(+m.opacity || 0, 0, 1); if (m.opacity === undefined) L.opacity = 1;
    L.guide = !!m.guide; L.del = !!m.del; L.v = m.v || 0; L.by = m.by || '';
    if (L.del && !wasDel) this._freeLayer(L);
    if (!L.del && wasDel) { [L.canvas, L.ctx] = makeCanvas(this.w, this.h, {}); L.base = null; L.frozen = 0; this.rebuild(L, 0); }
    this.changed('layers');
    return true;
  }
  _freeLayer(L) { L.canvas.width = L.canvas.height = 1; if (L.base) L.base.width = L.base.height = 1; L.base = null; }
  setOrder(ids, by) { this.order = { ids: [...ids], v: this.nextK(), by }; this.changed('layers'); return this.order; }
  mergeOrder(o) {
    if (!o || !Array.isArray(o.ids)) return false;
    this.tick(o.v || 0);
    if (!newer(o, this.order)) return false;
    const ids = o.ids.map(String);
    for (const id of this.order.ids) if (!ids.includes(id)) ids.push(id); // never lose a layer we have
    for (const id of ids) this._ensureLayer(id);
    this.order = { ids, v: o.v, by: o.by };
    this.changed('layers');
    return true;
  }
  setRec(name, value, by) { this[name] = { ...value, v: this.nextK(), by }; this.changed(name); return this[name]; }
  mergeRec(name, r) {
    if (!r || typeof r !== 'object') return false;
    this.tick(r.v || 0);
    if (!newer(r, this[name])) return false;
    this[name] = r;
    this.changed(name);
    return true;
  }

  // ---------------------------------------------------------------- ops
  /** insert an op (and draw it). live = { canvas, rect } of an already-rendered scratch stroke, used when it lands on top */
  commit(op, live) {
    const ex = this.ops.get(op.id);
    if (ex) { if ((op.uv || 0) > (ex.uv || 0)) this.setUndone(op.id, !!op.u, op.uv); return false; }
    if (!op.l || typeof op.k !== 'number') return false;
    this.tick(op.k);
    const L = this._ensureLayer(op.l);
    this.ops.set(op.id, op);
    const arr = L.ops;
    let i = arr.length;
    while (i > 0 && keyCmp(arr[i - 1], op) > 0) i--;
    arr.splice(i, 0, op);
    if (i < L.frozen) { // landed among baked ops (only after a long time apart)
      L.frozen++;
      if (!L.del && !op.u) { this._rebuildBase(L); this.rebuild(L); }
    } else if (!L.del && !op.u) {
      if (i === arr.length - 1) {
        this._snap(L, op);
        if (live && op.t === 's') compositeStroke(L.ctx, op, live.canvas, live.rect);
        else this.renderOp(L.ctx, op);
      } else this.rebuild(L, i);
    }
    this._bake(L);
    L.rev++;
    this.changed('ops');
    return true;
  }
  /** many ops at once (sync): insert all, then redraw each touched layer once */
  commitMany(ops) {
    const touched = new Map();
    for (const op of ops) {
      if (!op || !op.id || !op.l || typeof op.k !== 'number') continue;
      const ex = this.ops.get(op.id);
      if (ex) {
        if ((op.uv || 0) > (ex.uv || 0)) { ex.u = !!op.u; ex.uv = op.uv; const L = this.layers.get(ex.l); if (L) touched.set(L, Math.min(touched.has(L) ? touched.get(L) : Infinity, L.ops.indexOf(ex))); }
        continue;
      }
      this.tick(op.k);
      const L = this._ensureLayer(op.l);
      this.ops.set(op.id, op);
      let i = L.ops.length;
      while (i > 0 && keyCmp(L.ops[i - 1], op) > 0) i--;
      L.ops.splice(i, 0, op);
      touched.set(L, Math.min(touched.has(L) ? touched.get(L) : Infinity, i));
    }
    for (const [L, from] of touched) {
      if (L.del) continue;
      if (from < L.frozen) { L.frozen = Math.max(0, L.ops.length - MAX_LIVE); this._rebuildBase(L); }
      this.rebuild(L, from);
      this._bake(L);
      L.rev++;
    }
    if (touched.size) this.changed('ops');
    return touched.size;
  }
  setUndone(id, u, uv) {
    const op = this.ops.get(id);
    if (!op) return false;
    if (uv !== undefined && uv <= (op.uv || 0)) return false;
    op.u = u ? 1 : 0; op.uv = uv === undefined ? (op.uv || 0) + 1 : uv;
    const L = this.layers.get(op.l);
    if (L && !L.del) {
      const i = L.ops.indexOf(op), last = i === L.ops.length - 1;
      const sn = this.snap;
      if (last && op.u && sn && sn.op === op && sn.L === L) { // undo of the newest op: put back the copy taken just before it
        const c = L.ctx; c.save(); c.globalCompositeOperation = 'copy'; c.globalAlpha = 1; c.drawImage(sn.canvas, 0, 0); c.restore();
        sn.op = null;
      } else if (last && !op.u && sn && sn.L === L && sn.op === null && sn.after === L.rev) { // redo right after that undo
        this._snap(L, op); this.renderOp(L.ctx, op);
      } else if (i < L.frozen) { this._rebuildBase(L); this.rebuild(L, L.frozen); } else this.rebuild(L, i);
      L.rev++;
      if (sn && sn.L === L && sn.op === null && op.u) sn.after = L.rev;
    }
    this.changed('ops');
    return true;
  }
  /** keep a copy of a layer just before an op lands on top, so undoing that op is instant */
  _snap(L, op) {
    let sn = this.snap;
    if (!sn || sn.canvas.width !== this.w || sn.canvas.height !== this.h) sn = this.snap = { canvas: makeCanvas(this.w, this.h), L: null, op: null, after: -1 };
    const x = sn.canvas.getContext('2d');
    x.globalCompositeOperation = 'copy'; x.drawImage(L.canvas, 0, 0); x.globalCompositeOperation = 'source-over';
    sn.L = L; sn.op = op; sn.after = -1;
  }
  canUndo(op) { const L = this.layers.get(op.l); return !!L && !L.del && L.ops.indexOf(op) >= L.frozen; }

  renderOp(ctx, op) {
    try {
      if (op.t === 's') {
        const r = new StrokeRenderer(op, this.sctx);
        r.add(op.p); r.finish();
        const rect = bbRect(r.bb, this.w, this.h);
        compositeStroke(ctx, op, this.scratch, rect);
        if (rect) this.sctx.clearRect(rect[0], rect[1], rect[2], rect[3]);
        this.sctx.globalAlpha = 1;
      } else if (op.t === 'f') applyFill(ctx, op);
      else if (op.t === 't') drawText(ctx, op);
      else if (op.t === 'c') { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); if (op.cl) ctx.clearRect(op.cl[0], op.cl[1], op.cl[2], op.cl[3]); else ctx.clearRect(0, 0, this.w, this.h); ctx.restore(); }
      else if (op.t === 'i' && op.img) { ctx.save(); ctx.globalAlpha = op.o === undefined ? 1 : op.o; ctx.drawImage(op.img, op.x, op.y, op.w, op.h); ctx.restore(); }
    } catch (e) { console.warn('op failed', op && op.t, e); }
  }
  /** redraw a layer's display canvas from its base + the ops from `from` on (ops before `from` are already right only via base) */
  rebuild(L, from) {
    void from;
    if (this.snap && this.snap.L === L) this.snap.L = null;
    const c = L.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    if (L.base && L.frozen > 0) c.drawImage(L.base, 0, 0);
    c.restore();
    for (let i = L.frozen; i < L.ops.length; i++) if (!L.ops[i].u) this.renderOp(c, L.ops[i]);
  }
  _rebuildBase(L) {
    if (L.frozen <= 0) { if (L.base) { L.base.width = L.base.height = 1; L.base = null; } return; }
    if (!L.base || L.base.width !== this.w) [L.base, L.bctx] = makeCanvas(this.w, this.h, {});
    L.bctx.clearRect(0, 0, this.w, this.h);
    for (let i = 0; i < L.frozen; i++) if (!L.ops[i].u) this.renderOp(L.bctx, L.ops[i]);
  }
  _bake(L) {
    if (L.ops.length - L.frozen <= MAX_LIVE + BAKE) return;
    if (!L.base || L.base.width !== this.w) { [L.base, L.bctx] = makeCanvas(this.w, this.h, {}); if (L.frozen > 0) { const f = L.frozen; L.frozen = 0; for (let i = 0; i < f; i++) if (!L.ops[i].u) this.renderOp(L.bctx, L.ops[i]); L.frozen = f; } }
    const end = L.frozen + BAKE;
    for (let i = L.frozen; i < end; i++) if (!L.ops[i].u) this.renderOp(L.bctx, L.ops[i]);
    L.frozen = end;
  }

  // ---------------------------------------------------------------- sync + saving
  have() { const o = {}; for (const [id, op] of this.ops) o[id] = op.uv || 0; return o; }
  missingFor(have) { const out = []; for (const [id, op] of this.ops) { const v = have[id]; if (v === undefined || (op.uv || 0) > v) out.push(stripOp(op)); } return out.sort(keyCmp); }
  metaRecord() {
    return { id: this.id, w: this.w, h: this.h, title: this.title, created: this.created, bg: this.bg, order: this.order, layers: [...this.layers.values()].map((L) => L.meta()), refs: this.refs, mode: this.mode };
  }
  /** merge another copy's records (same drawing) */
  mergeMeta(m) {
    if (!m) return;
    for (const lm of m.layers || []) this.mergeLayer(lm);
    this.mergeOrder(m.order);
    this.mergeRec('bg', m.bg); this.mergeRec('refs', m.refs); this.mergeRec('mode', m.mode);
    if (m.title && !this.title) this.title = m.title;
  }
  serialize() { return { fmt: 1, ...this.metaRecord(), updated: this.updated, clock: this.clock, ops: [...this.ops.values()].map(stripOp).sort(keyCmp) }; }
  static fromData(d) {
    const doc = new Doc({ id: d.id, w: d.w, h: d.h, title: d.title, created: d.created, updated: d.updated });
    for (const lm of d.layers || []) { const L = new Layer(doc, lm); doc.layers.set(L.id, L); doc.tick(L.v); if (L.del) doc._freeLayer(L); }
    if (d.order && Array.isArray(d.order.ids)) doc.order = { ids: d.order.ids.filter((id) => doc.layers.has(id)), v: d.order.v || 0, by: d.order.by || '' };
    for (const id of doc.layers.keys()) if (!doc.order.ids.includes(id)) doc.order.ids.push(id);
    if (d.bg && d.bg.c) doc.bg = d.bg;
    if (d.refs && Array.isArray(d.refs.list)) doc.refs = d.refs;
    if (d.mode && d.mode.id) doc.mode = d.mode;
    doc.tick(d.clock || 0); doc.tick((d.bg && d.bg.v) || 0); doc.tick((d.refs && d.refs.v) || 0); doc.tick((d.mode && d.mode.v) || 0); doc.tick(doc.order.v);
    for (const op of d.ops || []) {
      if (!op || !op.id || !op.l || doc.ops.has(op.id)) continue;
      doc.tick(op.k);
      const L = doc._ensureLayer(op.l);
      doc.ops.set(op.id, op); L.ops.push(op);
    }
    for (const L of doc.layers.values()) {
      L.ops.sort(keyCmp);
      if (L.del) continue;
      L.frozen = Math.max(0, L.ops.length - MAX_LIVE);
      doc._rebuildBase(L);
      doc.rebuild(L, L.frozen);
    }
    if (d.updated) doc.updated = d.updated;
    return doc;
  }

  /** the picture as one canvas (paper + visible layers; guide layers only when asked) */
  flatten({ scale = 1, guides = false, paper = true } = {}) {
    const [c, x] = makeCanvas(this.w * scale, this.h * scale, {});
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.imageSmoothingQuality = 'high';
    if (paper && this.bg.c !== 'transparent') { x.fillStyle = this.bg.c; x.fillRect(0, 0, this.w, this.h); }
    for (const L of this.layerList()) {
      if (!L.visible || (L.guide && !guides)) continue;
      x.globalAlpha = L.opacity; x.drawImage(L.canvas, 0, 0);
    }
    return c;
  }
  /** pixels used by the paint bucket and the colour picker */
  sample(layerId) {
    const [c, x] = makeCanvas(this.w, this.h, { willReadFrequently: true });
    if (layerId) { const L = this.layers.get(layerId); if (L) x.drawImage(L.canvas, 0, 0); }
    else x.drawImage(this.flatten({ guides: false }), 0, 0);
    const img = x.getImageData(0, 0, this.w, this.h);
    c.width = c.height = 1;
    return img;
  }
}

/** network/saving form of an op (drops caches like decoded images) */
export function stripOp(op) { if (op.img) { const { img, ...rest } = op; void img; return rest; } return op; }

export function drawText(ctx, op) {
  ctx.save();
  if (op.cl) { ctx.beginPath(); ctx.rect(op.cl[0], op.cl[1], op.cl[2], op.cl[3]); ctx.clip(); }
  ctx.globalAlpha = clamp(op.o === undefined ? 1 : op.o, 0, 1);
  ctx.fillStyle = op.c; ctx.font = fontCss(op.fo, op.z); ctx.textBaseline = 'top';
  String(op.s || '').split('\n').forEach((ln, i) => ctx.fillText(ln, op.x, op.y + i * op.z * 1.22));
  ctx.restore();
}
