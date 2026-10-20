// The brush engine. A stroke is drawn at full strength onto a scratch canvas and then composited onto its layer with the
// stroke's opacity and blend mode, so a semi-transparent stroke never darkens where it crosses itself.
// Rendering is deterministic: the same points + seed give the same pixels whether they arrive all at once (replay, undo)
// or a few at a time (live drawing, a partner's stroke streaming in).
import { mulberry32, makeCanvas, clamp, lerp, mixHex } from './util.js';

// kind: cap = round pen (exact variable-width outline), nib = flat pen, dab = textured stamps, spray, neon
// min = size at zero pressure (fraction), fmin = strength at zero pressure, spacing = dab gap as a fraction of the diameter
export const BRUSHES = [
  { id: 'pen', name: 'Ink pen', kind: 'cap', min: 0.2, def: { z: 6, o: 1 }, max: 80, smooth: 0.35 },
  { id: 'pencil', name: 'Pencil', kind: 'dab', stamp: 'grain', spacing: 0.16, flow: 0.55, min: 0.55, fmin: 0.2, rot: true, def: { z: 5, o: 0.95 }, max: 40, smooth: 0.15 },
  { id: 'marker', name: 'Marker', kind: 'cap', blend: 'multiply', min: 0.85, def: { z: 16, o: 0.75 }, max: 120, smooth: 0.3 },
  { id: 'brush', name: 'Soft brush', kind: 'dab', stamp: 'soft', spacing: 0.07, flow: 0.22, min: 0.35, fmin: 0.35, def: { z: 36, o: 1 }, max: 220, smooth: 0.3 },
  { id: 'water', name: 'Watercolor', kind: 'dab', stamp: 'water', spacing: 0.1, flow: 0.14, min: 0.5, fmin: 0.5, jit: 0.08, pj: 0.12, rot: true, def: { z: 46, o: 0.85 }, max: 220, smooth: 0.35 },
  { id: 'crayon', name: 'Crayon', kind: 'dab', stamp: 'chalk', spacing: 0.1, flow: 0.85, min: 0.7, fmin: 0.45, rot: true, def: { z: 14, o: 1 }, max: 80, smooth: 0.2 },
  { id: 'callig', name: 'Calligraphy', kind: 'nib', angle: -0.785, thin: 0.12, min: 0.3, def: { z: 16, o: 1 }, max: 100, smooth: 0.4 },
  { id: 'air', name: 'Airbrush', kind: 'dab', stamp: 'soft', spacing: 0.05, flow: 0.05, min: 1, fmin: 0.15, def: { z: 70, o: 1 }, max: 320, smooth: 0.3 },
  { id: 'spray', name: 'Spray can', kind: 'spray', spacing: 0.25, min: 1, fmin: 0.4, def: { z: 40, o: 1 }, max: 200, smooth: 0.2 },
  { id: 'high', name: 'Highlighter', kind: 'nib', angle: 1.5708, thin: 0.22, blend: 'multiply', min: 1, def: { z: 26, o: 0.45 }, max: 100, smooth: 0.5 },
  { id: 'neon', name: 'Neon glow', kind: 'neon', min: 0.6, def: { z: 10, o: 1 }, max: 60, smooth: 0.4 },
  { id: 'eraser', name: 'Eraser', kind: 'cap', erase: true, min: 0.5, def: { z: 30, o: 1 }, max: 320, smooth: 0.2 },
  { id: 'softerase', name: 'Soft eraser', kind: 'dab', stamp: 'soft', spacing: 0.07, flow: 0.3, erase: true, min: 0.6, def: { z: 60, o: 1 }, max: 320, smooth: 0.2 },
];
const BY_ID = new Map(BRUSHES.map((b) => [b.id, b]));
export const brushOf = (id) => BY_ID.get(id) || BRUSHES[0];

// ------------------------------------------------------------------ stamps (made once, from a fixed seed)
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const STAMPS = {};
function makeStamp(name) {
  const S = name === 'grain' ? 32 : name === 'chalk' ? 48 : 64;
  const [c, x] = makeCanvas(S, S, {});
  const img = x.createImageData(S, S), d = img.data, rnd = mulberry32(name.length * 7919 + 13), r0 = S / 2;
  const G = 9, grid = Array.from({ length: G * G }, () => rnd()); // coarse value noise for chalk
  const vnoise = (u, v) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, g = (a, b) => grid[((b % G) * G + (a % G) + G * G) % (G * G)];
    return lerp(lerp(g(i, j), g(i + 1, j), fu), lerp(g(i, j + 1), g(i + 1, j + 1), fu), fv);
  };
  for (let y = 0; y < S; y++) {
    for (let xx = 0; xx < S; xx++) {
      const dx = (xx + 0.5 - r0) / r0, dy = (y + 0.5 - r0) / r0, dd = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (name === 'soft') a = dd >= 1 ? 0 : 1 - smooth(0, 1, dd);
      else if (name === 'grain') { const edge = clamp((1 - dd) * 3, 0, 1); a = edge * (rnd() < 0.55 ? 0.35 + rnd() * 0.65 : 0); }
      else if (name === 'chalk') {
        const n = 0.65 * vnoise(xx / 5, y / 5) + 0.35 * rnd();
        const edge = 1 - dd + (n - 0.5) * 0.45;
        a = edge > 0.12 ? (n > 0.36 ? 0.95 : 0.2) * clamp(edge * 4, 0, 1) : 0;
      } else if (name === 'water') {
        if (dd < 1) { const rim = smooth(0.62, 0.95, dd); a = (0.4 + 0.6 * rim) * (0.85 + rnd() * 0.15) * (1 - smooth(0.95, 1, dd)); }
      }
      const i = (y * S + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
const stamp = (name) => STAMPS[name] || (STAMPS[name] = makeStamp(name));
const tintCache = new Map();
function tinted(name, color) {
  const key = name + color;
  let c = tintCache.get(key);
  if (c) return c;
  const s = stamp(name);
  c = makeCanvas(s.width, s.height);
  const x = c.getContext('2d');
  x.drawImage(s, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  if (tintCache.size > 48) tintCache.delete(tintCache.keys().next().value);
  tintCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ symmetry
/** affine matrices [a,b,c,d,e,f] (canvas convention) for the copies of a stroke. sym: v h q r<n> k<n> */
export function symMats(sym, W, H, sc) {
  const I = [1, 0, 0, 1, 0, 0];
  if (!sym) return [I];
  const cx = sc ? sc[0] : W / 2, cy = sc ? sc[1] : H / 2;
  const mirX = [-1, 0, 0, 1, 2 * cx, 0], mirY = [1, 0, 0, -1, 0, 2 * cy];
  if (sym === 'v') return [I, mirX];
  if (sym === 'h') return [I, mirY];
  if (sym === 'q') return [I, mirX, mirY, [-1, 0, 0, -1, 2 * cx, 2 * cy]];
  const m = /^([rk])(\d+)$/.exec(sym);
  if (!m) return [I];
  const n = clamp(+m[2], 2, 16), out = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n, c = Math.cos(t), s = Math.sin(t);
    out.push([c, s, -s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy)]);
    if (m[1] === 'k') out.push(mul([c, s, -s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy)], mirX)); // kaleidoscope: mirrored wedges too
  }
  return out;
}
function mul(A, B) { // A·B (apply B first)
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}

// ------------------------------------------------------------------ the renderer
export class StrokeRenderer {
  /** op: { b brush, c color, z size, o opacity, sd seed, sym?, sc?, ln? straight segments, f? filled shape } */
  constructor(op, ctx) {
    this.op = op; this.ctx = ctx; this.B = brushOf(op.b);
    this.mats = symMats(op.sym, ctx.canvas.width, ctx.canvas.height, op.sc);
    this.rnd = mulberry32((op.sd >>> 0) || 1);
    this.P = []; this.n = 0; this.prev = null; this.since = 0;
    this.bb = [Infinity, Infinity, -Infinity, -Infinity];
    this.color = this.B.erase ? '#000000' : op.c;
    this.R = Math.max(0.35, (op.z || 4) / 2);
    this.step = clamp(this.R * 0.35, 0.6, 3);
    if (this.B.stamp) this.img = tinted(this.B.stamp, this.color);
    if (this.B.kind === 'neon') { this.img = tinted('soft', op.c); this.core = mixHex(op.c, '#ffffff', 0.72); }
    this.nib = this.B.kind === 'nib' ? [Math.cos(this.B.angle), Math.sin(this.B.angle)] : null;
  }
  rad(p) { return Math.max(0.35, this.R * lerp(this.B.min, 1, clamp(p, 0, 1))); }
  flow(p) { return (this.B.flow || 1) * lerp(this.B.fmin === undefined ? 1 : this.B.fmin, 1, clamp(p, 0, 1)); }

  add(flat) {
    if (!flat || !flat.length) return;
    this._begin();
    for (let i = 0; i + 2 < flat.length; i += 3) this._point(flat[i], flat[i + 1], flat[i + 2]);
    this._end();
  }
  finish() {
    const P = this.P, n = this.n;
    this._begin();
    if (!this.op.ln && n >= 2) { const i = (n - 1) * 3; this._line(P[i], P[i + 1], P[i + 2]); }
    this._end();
    if (this.op.f && n >= 3) this._fillPoly();
  }

  _point(x, y, p) {
    const P = this.P; P.push(x, y, p); const n = ++this.n;
    if (n === 1) { this.prev = { x, y, p }; this._dot(x, y, p); return; }
    if (this.op.ln) { this._line(x, y, p); return; }
    const i = (n - 2) * 3, ax = P[i], ay = P[i + 1], ap = P[i + 2];
    const mx = (ax + x) / 2, my = (ay + y) / 2, mp = (ap + p) / 2;
    if (n === 2) this._line(mx, my, mp);
    else this._quad(ax, ay, ap, mx, my, mp);
  }
  _line(x, y, p) {
    const a = this.prev, len = Math.hypot(x - a.x, y - a.y), steps = Math.max(1, Math.ceil(len / this.step));
    for (let s = 1; s <= steps; s++) { const t = s / steps; this._to(lerp(a.x, x, t), lerp(a.y, y, t), lerp(a.p, p, t)); }
  }
  _quad(cx, cy, cp, x, y, p) {
    const a = this.prev;
    const len = Math.hypot(cx - a.x, cy - a.y) + Math.hypot(x - cx, y - cy), steps = Math.max(1, Math.ceil(len / this.step));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      this._to(u * u * a.x + 2 * u * t * cx + t * t * x, u * u * a.y + 2 * u * t * cy + t * t * y, lerp(a.p, p, t));
    }
    void cp;
  }
  _to(x, y, p) {
    const a = this.prev, b = { x, y, p };
    const k = this.B.kind;
    if (k === 'cap') this._capsule(a.x, a.y, this.rad(a.p), x, y, this.rad(p));
    else if (k === 'nib') this._nib(a, b);
    else { this._walk(a, b); if (k === 'neon') this._capsule(a.x, a.y, this.rad(a.p) * 0.45, x, y, this.rad(p) * 0.45); }
    this.prev = b;
  }
  _dot(x, y, p) {
    const k = this.B.kind;
    if (k === 'cap') this._circleAll(x, y, this.rad(p));
    else if (k === 'nib') this._nib({ x, y, p }, { x: x + 0.01, y, p });
    else { this._dab(x, y, p); if (k === 'neon') this._circleAll(x, y, this.rad(p) * 0.45); }
    this.since = 0;
  }

  // ---- path primitives (filled once per batch; every piece wound the same way so overlaps never punch holes)
  _begin() { this.ctx.beginPath(); this.used = false; }
  _end() {
    if (!this.used) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 1; ctx.fillStyle = this.B.kind === 'neon' ? this.core : this.color;
    ctx.fill('nonzero');
  }
  _circleAll(x, y, r) { for (const m of this.mats) this._circle(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], r); }
  _circle(X, Y, r) { const ctx = this.ctx; ctx.moveTo(X + r, Y); ctx.arc(X, Y, r, 0, Math.PI * 2); this.used = true; this._bb(X, Y, r); }
  _poly(xs) { // xs = [x0,y0,x1,y1,...]; added with positive winding
    let area = 0;
    const n = xs.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += xs[2 * i] * xs[2 * j + 1] - xs[2 * j] * xs[2 * i + 1]; }
    const ctx = this.ctx;
    if (area >= 0) { ctx.moveTo(xs[0], xs[1]); for (let i = 1; i < n; i++) ctx.lineTo(xs[2 * i], xs[2 * i + 1]); }
    else { ctx.moveTo(xs[2 * n - 2], xs[2 * n - 1]); for (let i = n - 2; i >= 0; i--) ctx.lineTo(xs[2 * i], xs[2 * i + 1]); }
    ctx.closePath(); this.used = true;
  }
  _capsule(x0, y0, r0, x1, y1, r1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    for (const m of this.mats) {
      const X0 = m[0] * x0 + m[2] * y0 + m[4], Y0 = m[1] * x0 + m[3] * y0 + m[5];
      const X1 = m[0] * x1 + m[2] * y1 + m[4], Y1 = m[1] * x1 + m[3] * y1 + m[5];
      this._circle(X1, Y1, r1);
      if (d < 1e-3 || d <= Math.abs(r1 - r0)) continue;
      const ang = Math.atan2(Y1 - Y0, X1 - X0), al = Math.acos(clamp((r0 - r1) / d, -1, 1));
      const c1 = Math.cos(ang + al), s1 = Math.sin(ang + al), c2 = Math.cos(ang - al), s2 = Math.sin(ang - al);
      this._poly([X0 + r0 * c1, Y0 + r0 * s1, X1 + r1 * c1, Y1 + r1 * s1, X1 + r1 * c2, Y1 + r1 * s2, X0 + r0 * c2, Y0 + r0 * s2]);
    }
  }
  _nib(a, b) {
    const ra = this.rad(a.p), rb = this.rad(b.p), [nx, ny] = this.nib, thin = this.B.thin;
    for (const m of this.mats) {
      const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const A1 = tx(a.x + nx * ra, a.y + ny * ra), A2 = tx(a.x - nx * ra, a.y - ny * ra), B1 = tx(b.x + nx * rb, b.y + ny * rb), B2 = tx(b.x - nx * rb, b.y - ny * rb);
      this._poly([A1[0], A1[1], B1[0], B1[1], B2[0], B2[1], A2[0], A2[1]]);
      const [X, Y] = tx(b.x, b.y);
      this._circle(X, Y, Math.max(0.5, rb * thin));
      this._bb(X, Y, rb);
    }
  }

  // ---- stamps
  _walk(a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 0) return;
    let t = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const p = lerp(a.p, b.p, t), sp = Math.max(0.5, (this.B.spacing || 0.1) * 2 * this.rad(p) * (this.B.kind === 'neon' ? 1.6 : 1));
      const need = sp - this.since, left = (1 - t) * len;
      if (need > left) { this.since += left; return; }
      t += need / len; this.since = 0;
      this._dab(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.p, b.p, t));
    }
  }
  _dab(x, y, p) {
    const B = this.B, ctx = this.ctx, rnd = this.rnd;
    let r = this.rad(p);
    if (B.kind === 'spray') return this._spray(x, y, p, r);
    if (B.kind === 'neon') { r *= 3.2; ctx.globalAlpha = 0.075; }
    else ctx.globalAlpha = clamp(this.flow(p), 0, 1);
    if (B.jit) r *= 1 + (rnd() - 0.5) * B.jit * 2;
    if (B.pj) { x += (rnd() - 0.5) * r * B.pj * 2; y += (rnd() - 0.5) * r * B.pj * 2; }
    const ang = B.rot ? rnd() * Math.PI * 2 : 0, img = this.img;
    for (const m of this.mats) {
      const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      if (ang) { const c = Math.cos(ang), s = Math.sin(ang); ctx.setTransform(c, s, -s, c, X, Y); ctx.drawImage(img, -r, -r, 2 * r, 2 * r); }
      else ctx.drawImage(img, X - r, Y - r, 2 * r, 2 * r);
      this._bb(X, Y, r * 1.42);
    }
    if (ang) ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  _spray(x, y, p, r) {
    const rnd = this.rnd, ctx = this.ctx, count = Math.round(5 + r * 0.45), dots = [];
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r, s = Math.max(0.8, r * 0.045) * (0.6 + rnd() * 0.8);
      dots.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr, s);
    }
    ctx.globalAlpha = clamp(0.9 * this.flow(p), 0, 1); ctx.fillStyle = this.color;
    for (const m of this.mats) {
      for (let i = 0; i < dots.length; i += 3) {
        const X = m[0] * dots[i] + m[2] * dots[i + 1] + m[4], Y = m[1] * dots[i] + m[3] * dots[i + 1] + m[5], s = dots[i + 2];
        ctx.fillRect(X - s / 2, Y - s / 2, s, s);
      }
      this._bb(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], r + 2);
    }
  }
  _fillPoly() {
    const ctx = this.ctx, P = this.P;
    ctx.globalAlpha = 1; ctx.fillStyle = this.color;
    for (const m of this.mats) {
      ctx.beginPath();
      for (let i = 0; i < P.length; i += 3) { const X = m[0] * P[i] + m[2] * P[i + 1] + m[4], Y = m[1] * P[i] + m[3] * P[i + 1] + m[5]; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); this._bb(X, Y, 1); }
      ctx.closePath(); ctx.fill('nonzero');
    }
  }
  _bb(x, y, r) {
    const b = this.bb;
    if (x - r < b[0]) b[0] = x - r; if (y - r < b[1]) b[1] = y - r;
    if (x + r > b[2]) b[2] = x + r; if (y + r > b[3]) b[3] = y + r;
  }
}

/** integer rectangle [x, y, w, h] of a renderer's bounding box, clamped to the canvas (null when empty) */
export function bbRect(bb, W, H, pad = 2) {
  if (!(bb[2] >= bb[0])) return null;
  const x0 = clamp(Math.floor(bb[0] - pad), 0, W), y0 = clamp(Math.floor(bb[1] - pad), 0, H);
  const x1 = clamp(Math.ceil(bb[2] + pad), 0, W), y1 = clamp(Math.ceil(bb[3] + pad), 0, H);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** put a finished scratch stroke onto a layer */
export function compositeStroke(dst, op, scratch, rect) {
  if (!rect) return;
  const B = brushOf(op.b);
  dst.save();
  if (op.cl) { dst.beginPath(); dst.rect(op.cl[0], op.cl[1], op.cl[2], op.cl[3]); dst.clip(); }
  dst.globalAlpha = clamp(op.o === undefined ? 1 : op.o, 0, 1);
  dst.globalCompositeOperation = B.erase ? 'destination-out' : B.blend || 'source-over';
  dst.drawImage(scratch, rect[0], rect[1], rect[2], rect[3], rect[0], rect[1], rect[2], rect[3]);
  dst.restore();
}
