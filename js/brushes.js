// The brush engine. A stroke is drawn at full strength onto a scratch canvas and then composited onto its layer with the
// stroke's opacity and blend mode, so a semi-transparent stroke never darkens where it crosses itself.
// Rendering is deterministic: the same points + seed give the same pixels whether they arrive all at once (replay, undo)
// or a few at a time (live drawing, a partner's stroke streaming in).
import { mulberry32, makeCanvas, clamp, lerp, mixHex } from './util.js';

// kind: cap = round pen (exact variable-width outline), nib = flat pen, dab = textured stamps, spray, neon,
//       stamp = little shapes along the line (hearts, stars…), rainbow, dash, splatter, grass, glitter
// min = size at zero pressure (fraction), fmin = strength at zero pressure, spacing = dab gap as a fraction of the diameter
// follow = stamps turn with the direction of the stroke. (Existing brush settings must never change: saved drawings replay
// with them; add new brushes instead.)
export const BRUSH_CATS = ['Sketch', 'Ink', 'Paint', 'Art', 'Fun', 'Erase'];
export const BRUSHES = [
  // Sketch
  { id: 'pencil', cat: 'Sketch', name: 'Pencil', kind: 'dab', stamp: 'grain', spacing: 0.16, flow: 0.55, min: 0.55, fmin: 0.2, rot: true, def: { z: 5, o: 0.95 }, max: 40, smooth: 0.15 },
  { id: 'hb', cat: 'Sketch', name: 'HB pencil', kind: 'dab', stamp: 'grain', spacing: 0.15, flow: 0.32, min: 0.45, fmin: 0.2, rot: true, def: { z: 3, o: 0.9 }, max: 20, smooth: 0.15 },
  { id: 'pencil6b', cat: 'Sketch', name: '6B soft pencil', kind: 'dab', stamp: 'graphite', spacing: 0.12, flow: 0.75, min: 0.5, fmin: 0.25, rot: true, def: { z: 9, o: 1 }, max: 50, smooth: 0.15 },
  { id: 'cpencil', cat: 'Sketch', name: 'Colored pencil', kind: 'dab', stamp: 'grain', spacing: 0.12, flow: 0.7, min: 0.5, fmin: 0.3, rot: true, def: { z: 7, o: 1 }, max: 40, smooth: 0.2 },
  { id: 'charcoal', cat: 'Sketch', name: 'Charcoal', kind: 'dab', stamp: 'charcoal', spacing: 0.1, flow: 0.7, min: 0.6, fmin: 0.3, rot: true, jit: 0.1, def: { z: 16, o: 1 }, max: 80, smooth: 0.2 },
  { id: 'sketchpen', cat: 'Sketch', name: 'Sketch liner', kind: 'cap', min: 0.35, def: { z: 2.5, o: 0.85 }, max: 30, smooth: 0.1 },
  // Ink
  { id: 'pen', cat: 'Ink', name: 'Ink pen', kind: 'cap', min: 0.2, def: { z: 6, o: 1 }, max: 80, smooth: 0.35 },
  { id: 'fineliner', cat: 'Ink', name: 'Fineliner', kind: 'cap', min: 1, def: { z: 3, o: 1 }, max: 40, smooth: 0.3 },
  { id: 'techpen', cat: 'Ink', name: 'Technical pen', kind: 'cap', min: 1, def: { z: 2, o: 1 }, max: 30, smooth: 0.05 },
  { id: 'brushpen', cat: 'Ink', name: 'Brush pen', kind: 'cap', min: 0.06, def: { z: 16, o: 1 }, max: 120, smooth: 0.45, simP: true },
  { id: 'dryink', cat: 'Ink', name: 'Dry ink', kind: 'dab', stamp: 'dry', spacing: 0.08, flow: 1, min: 0.35, rot: true, def: { z: 10, o: 1 }, max: 100, smooth: 0.3 },
  { id: 'marker', cat: 'Ink', name: 'Marker', kind: 'cap', blend: 'multiply', min: 0.85, def: { z: 16, o: 0.75 }, max: 120, smooth: 0.3 },
  { id: 'felt', cat: 'Ink', name: 'Felt tip', kind: 'cap', blend: 'multiply', min: 0.75, def: { z: 7, o: 0.9 }, max: 60, smooth: 0.3 },
  { id: 'dash', cat: 'Ink', name: 'Dashed pen', kind: 'dash', dash: 3, gap: 2.2, min: 1, def: { z: 5, o: 1 }, max: 60, smooth: 0.4 },
  { id: 'dots', cat: 'Ink', name: 'Dotted pen', kind: 'dab', stamp: 'hard', spacing: 1.1, flow: 1, min: 1, def: { z: 6, o: 1 }, max: 80, smooth: 0.4 },
  // Paint
  { id: 'brush', cat: 'Paint', name: 'Soft brush', kind: 'dab', stamp: 'soft', spacing: 0.07, flow: 0.22, min: 0.35, fmin: 0.35, def: { z: 36, o: 1 }, max: 220, smooth: 0.3 },
  { id: 'round', cat: 'Paint', name: 'Round brush', kind: 'dab', stamp: 'hard', spacing: 0.06, flow: 0.3, min: 0.4, fmin: 0.3, def: { z: 24, o: 1 }, max: 220, smooth: 0.3 },
  { id: 'oil', cat: 'Paint', name: 'Oil paint', kind: 'dab', stamp: 'bristle', follow: true, spacing: 0.04, flow: 0.45, min: 0.6, fmin: 0.4, def: { z: 30, o: 1 }, max: 200, smooth: 0.35 },
  { id: 'flat', cat: 'Paint', name: 'Flat brush', kind: 'dab', stamp: 'flat', follow: true, spacing: 0.035, flow: 0.65, min: 0.7, fmin: 0.4, def: { z: 34, o: 1 }, max: 200, smooth: 0.35 },
  { id: 'gouache', cat: 'Paint', name: 'Gouache', kind: 'dab', stamp: 'dry', spacing: 0.06, flow: 0.45, min: 0.5, fmin: 0.4, rot: true, def: { z: 30, o: 1 }, max: 200, smooth: 0.3 },
  { id: 'water', cat: 'Paint', name: 'Watercolor', kind: 'dab', stamp: 'water', spacing: 0.1, flow: 0.14, min: 0.5, fmin: 0.5, jit: 0.08, pj: 0.12, rot: true, def: { z: 46, o: 0.85 }, max: 220, smooth: 0.35 },
  { id: 'wash', cat: 'Paint', name: 'Wet wash', kind: 'dab', stamp: 'soft', spacing: 0.08, flow: 0.045, min: 0.7, fmin: 0.5, jit: 0.15, pj: 0.2, def: { z: 110, o: 0.9 }, max: 320, smooth: 0.4 },
  { id: 'air', cat: 'Paint', name: 'Airbrush', kind: 'dab', stamp: 'soft', spacing: 0.05, flow: 0.05, min: 1, fmin: 0.15, def: { z: 70, o: 1 }, max: 320, smooth: 0.3 },
  { id: 'sponge', cat: 'Paint', name: 'Sponge', kind: 'dab', stamp: 'sponge', spacing: 0.28, flow: 0.6, min: 0.7, rot: true, jit: 0.2, pj: 0.15, def: { z: 50, o: 1 }, max: 220, smooth: 0.2 },
  // Art
  { id: 'crayon', cat: 'Art', name: 'Crayon', kind: 'dab', stamp: 'chalk', spacing: 0.1, flow: 0.85, min: 0.7, fmin: 0.45, rot: true, def: { z: 14, o: 1 }, max: 80, smooth: 0.2 },
  { id: 'pastel', cat: 'Art', name: 'Oil pastel', kind: 'dab', stamp: 'pastel', spacing: 0.08, flow: 0.9, min: 0.7, fmin: 0.5, rot: true, def: { z: 22, o: 1 }, max: 120, smooth: 0.2 },
  { id: 'chalk', cat: 'Art', name: 'Chalk', kind: 'dab', stamp: 'chalk', spacing: 0.12, flow: 0.5, min: 0.7, fmin: 0.4, rot: true, jit: 0.12, def: { z: 18, o: 1 }, max: 100, smooth: 0.2 },
  { id: 'callig', cat: 'Art', name: 'Calligraphy', kind: 'nib', angle: -0.785, thin: 0.12, min: 0.3, def: { z: 16, o: 1 }, max: 100, smooth: 0.4 },
  { id: 'ribbon', cat: 'Art', name: 'Ribbon', kind: 'nib', angle: 0.5, thin: 0.04, min: 0.6, def: { z: 22, o: 1 }, max: 120, smooth: 0.45 },
  { id: 'chisel', cat: 'Art', name: 'Chisel marker', kind: 'nib', angle: 0.35, thin: 0.3, blend: 'multiply', min: 1, def: { z: 18, o: 0.85 }, max: 100, smooth: 0.35 },
  { id: 'high', cat: 'Art', name: 'Highlighter', kind: 'nib', angle: 1.5708, thin: 0.22, blend: 'multiply', min: 1, def: { z: 26, o: 0.45 }, max: 100, smooth: 0.5 },
  { id: 'spray', cat: 'Art', name: 'Spray can', kind: 'spray', spacing: 0.25, min: 1, fmin: 0.4, def: { z: 40, o: 1 }, max: 200, smooth: 0.2 },
  { id: 'splatter', cat: 'Art', name: 'Splatter', kind: 'splatter', spacing: 0.45, min: 0.8, def: { z: 40, o: 1 }, max: 200, smooth: 0.2 },
  { id: 'grass', cat: 'Art', name: 'Grass & fur', kind: 'grass', spacing: 0.22, min: 0.7, def: { z: 24, o: 1 }, max: 120, smooth: 0.3 },
  // Fun
  { id: 'neon', cat: 'Fun', name: 'Neon glow', kind: 'neon', min: 0.6, def: { z: 10, o: 1 }, max: 60, smooth: 0.4 },
  { id: 'glow', cat: 'Fun', name: 'Glow light', kind: 'dab', stamp: 'soft', spacing: 0.05, flow: 0.4, min: 0.6, fmin: 0.4, blend: 'lighter', def: { z: 40, o: 1 }, max: 220, smooth: 0.35 },
  { id: 'rainbow', cat: 'Fun', name: 'Rainbow', kind: 'rainbow', spacing: 0.12, min: 0.6, def: { z: 16, o: 1 }, max: 120, smooth: 0.4 },
  { id: 'glitter', cat: 'Fun', name: 'Glitter', kind: 'glitter', spacing: 0.35, min: 0.7, def: { z: 22, o: 1 }, max: 120, smooth: 0.3 },
  { id: 'hearts', cat: 'Fun', name: 'Hearts', kind: 'stamp', shape: 'heart', spacing: 1.25, sj: 0.35, rj: 0.45, scatter: 0.15, min: 0.7, def: { z: 26, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'stars', cat: 'Fun', name: 'Stars', kind: 'stamp', shape: 'star', spacing: 1.35, sj: 0.45, rj: 3.14, scatter: 0.35, min: 0.7, def: { z: 26, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'sparkle', cat: 'Fun', name: 'Sparkles', kind: 'stamp', shape: 'sparkle', spacing: 1.05, sj: 0.55, rj: 0.3, scatter: 0.6, glint: 0.3, min: 0.7, def: { z: 22, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'bubbles', cat: 'Fun', name: 'Bubbles', kind: 'stamp', shape: 'bubble', spacing: 1.05, sj: 0.6, rj: 0, scatter: 0.55, min: 0.7, def: { z: 26, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'flowers', cat: 'Fun', name: 'Flowers', kind: 'stamp', shape: 'flower', spacing: 1.45, sj: 0.35, rj: 3.14, scatter: 0.2, min: 0.7, def: { z: 28, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'leaves', cat: 'Fun', name: 'Leaves', kind: 'stamp', shape: 'leaf', follow: true, spacing: 0.85, sj: 0.3, rj: 0.7, scatter: 0.12, min: 0.7, def: { z: 24, o: 1 }, max: 160, smooth: 0.3 },
  { id: 'confetti', cat: 'Fun', name: 'Confetti', kind: 'stamp', shape: 'rect', multi: ['#ff5f9e', '#3d9bff', '#ffd84d', '#22b88f', '#9b7bff', '#ff7a45'], spacing: 0.6, sj: 0.4, rj: 3.14, scatter: 1.1, min: 0.8, def: { z: 18, o: 1 }, max: 120, smooth: 0.3 },
  // Erase
  { id: 'eraser', cat: 'Erase', name: 'Eraser', kind: 'cap', erase: true, min: 0.5, def: { z: 30, o: 1 }, max: 320, smooth: 0.2 },
  { id: 'softerase', cat: 'Erase', name: 'Soft eraser', kind: 'dab', stamp: 'soft', spacing: 0.07, flow: 0.3, erase: true, min: 0.6, def: { z: 60, o: 1 }, max: 320, smooth: 0.2 },
  { id: 'grainerase', cat: 'Erase', name: 'Pencil eraser', kind: 'dab', stamp: 'grain', spacing: 0.12, flow: 0.75, erase: true, rot: true, min: 0.6, def: { z: 12, o: 1 }, max: 120, smooth: 0.2 },
  { id: 'fineerase', cat: 'Erase', name: 'Fine eraser', kind: 'cap', erase: true, min: 1, def: { z: 5, o: 1 }, max: 60, smooth: 0.1 },
];
const BY_ID = new Map(BRUSHES.map((b) => [b.id, b]));
export const brushOf = (id) => BY_ID.get(id) || BY_ID.get('pen');

// ------------------------------------------------------------------ stamps (made once, from a fixed seed)
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const STAMPS = {};
const OLD_STAMPS = ['soft', 'grain', 'chalk', 'water']; // their seeds must stay exactly as they were (saved drawings)
function makeStamp(name) {
  const S = name === 'grain' ? 32 : name === 'chalk' ? 48 : 64;
  const [c, x] = makeCanvas(S, S, {});
  let seed = name.length * 7919 + 13;
  if (!OLD_STAMPS.includes(name)) for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const img = x.createImageData(S, S), d = img.data, rnd = mulberry32(seed), r0 = S / 2;
  const rr = mulberry32(seed ^ 0x9e3779b9); // separate generator: the old stamps' random sequence must stay untouched
  const rows = Array.from({ length: S }, () => (rr() < 0.12 ? 0.35 : 0.62 + rr() * 0.38)); // bristle streaks
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
      } else if (name === 'hard') a = dd < 0.94 ? 1 : dd < 1 ? (1 - dd) / 0.06 : 0;
      else if (name === 'graphite') { const edge = clamp((1 - dd) * 2.5, 0, 1); a = edge * (rnd() < 0.7 ? 0.45 + rnd() * 0.55 : 0.1); }
      else if (name === 'charcoal') {
        const n = 0.6 * vnoise(xx / 2.2, y / 9) + 0.4 * rnd();
        const edge = 1 - dd + (n - 0.5) * 0.6;
        a = edge > 0.1 ? (n > 0.42 ? 0.9 : 0.12) * clamp(edge * 3, 0, 1) : 0;
      } else if (name === 'pastel') {
        const n = 0.7 * vnoise(xx / 8, y / 8) + 0.3 * rnd();
        const edge = 1 - dd + (n - 0.5) * 0.35;
        a = edge > 0.1 ? (n > 0.3 ? 1 : 0.35) * clamp(edge * 5, 0, 1) : 0;
      } else if (name === 'dry') { const edge = 0.72 + (rnd() - 0.5) * 0.35; a = dd < edge ? 1 : dd < 1 && rnd() < 0.35 ? 0.8 : 0; }
      else if (name === 'sponge') {
        const n = 0.75 * vnoise(xx / 4, y / 4) + 0.25 * rnd();
        a = dd < 0.92 + (n - 0.5) * 0.3 && n > 0.45 ? clamp((n - 0.45) * 4, 0, 1) : 0;
      } else if (name === 'bristle') { // streaks along x (the stroke direction), soft front and back
        if (dd < 1) a = rows[y] * (1 - smooth(0.55, 1, Math.abs(dx))) * (0.8 + rnd() * 0.2) * (1 - smooth(0.85, 1, Math.abs(dy)));
      } else if (name === 'flat') { // a wide bristle edge: shorter along x, wide across
        if (Math.abs(dx) < 0.45 && Math.abs(dy) < 0.96) a = rows[y] * (1 - smooth(0.2, 0.45, Math.abs(dx))) * (1 - smooth(0.85, 0.96, Math.abs(dy))) * (0.88 + rnd() * 0.12);
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

// ------------------------------------------------------------------ little shapes (unit size, centred on 0,0)
let SHAPES = null;
function shapes() {
  if (SHAPES) return SHAPES;
  const heart = new Path2D();
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2, x = (16 * Math.pow(Math.sin(t), 3)) / 17, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 + 0.08;
    if (i) heart.lineTo(x, y); else heart.moveTo(x, y);
  }
  heart.closePath();
  const star = new Path2D();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.42 : 1, t = (i / 10) * Math.PI * 2 - Math.PI / 2; if (i) star.lineTo(Math.cos(t) * r, Math.sin(t) * r); else star.moveTo(Math.cos(t) * r, Math.sin(t) * r); }
  star.closePath();
  const sparkle = new Path2D('M0 -1 Q0.12 -0.12 1 0 Q0.12 0.12 0 1 Q-0.12 0.12 -1 0 Q-0.12 -0.12 0 -1 Z');
  const petals = new Path2D();
  for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; petals.ellipse(Math.cos(t) * 0.52, Math.sin(t) * 0.52, 0.46, 0.3, t, 0, Math.PI * 2); }
  const centre = new Path2D(); centre.arc(0, 0, 0.3, 0, Math.PI * 2);
  const leaf = new Path2D('M-1 0 Q0 -0.62 1 0 Q0 0.62 -1 0 Z');
  const vein = new Path2D('M-0.85 0 L0.8 0');
  const bubble = new Path2D(); bubble.arc(0, 0, 0.88, 0, Math.PI * 2);
  const shine = new Path2D(); shine.ellipse(-0.36, -0.38, 0.2, 0.12, -0.7, 0, Math.PI * 2);
  const rect = new Path2D(); rect.rect(-0.9, -0.42, 1.8, 0.84);
  const dot = new Path2D(); dot.arc(0, 0, 1, 0, Math.PI * 2);
  SHAPES = { heart, star, sparkle, petals, centre, leaf, vein, bubble, shine, rect, dot };
  return SHAPES;
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
    this.trav = 0; this.dpos = 0; this.at = 0;
    const k = this.B.kind;
    if (k === 'stamp' || k === 'glitter') { this.light = mixHex(this.color, '#ffffff', 0.6); this.dark = mixHex(this.color, '#000000', 0.3); }
    if (k === 'grass') this.shades = [mixHex(this.color, '#000000', 0.22), this.color, mixHex(this.color, '#ffffff', 0.18)];
    if (k === 'rainbow') { const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(op.c || '#ff0000').slice(i, i + 2), 16) || 0); this.hue0 = rgbHue(r, g, b); }
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
    else if (k === 'dash') this._dash(a, b);
    else { this._walk(a, b); if (k === 'neon') this._capsule(a.x, a.y, this.rad(a.p) * 0.45, x, y, this.rad(p) * 0.45); }
    this.prev = b;
  }
  _dot(x, y, p) {
    const k = this.B.kind;
    if (k === 'cap' || k === 'dash') this._circleAll(x, y, this.rad(p));
    else if (k === 'nib') this._nib({ x, y, p }, { x: x + 0.01, y, p });
    else { this._dab(x, y, p, 0); if (k === 'neon') this._circleAll(x, y, this.rad(p) * 0.45); }
    this.since = 0;
  }
  /** dashed line: round-capped pieces "on" for dash×size, then a gap of gap×size, continuing across segments */
  _dash(a, b) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= 0) return;
    const on = this.R * 2 * (this.B.dash || 3), cycle = on + this.R * 2 * (this.B.gap || 2);
    let t = 0;
    for (let guard = 0; t < L && guard < 10000; guard++) {
      const pos = this.dpos % cycle, inOn = pos < on, step = Math.min((inOn ? on : cycle) - pos, L - t);
      if (inOn) {
        const t0 = t / L, t1 = (t + step) / L, ra = this.rad(lerp(a.p, b.p, t0)), rb = this.rad(lerp(a.p, b.p, t1));
        const x0 = lerp(a.x, b.x, t0), y0 = lerp(a.y, b.y, t0);
        if (pos < 1e-6) this._circleAll(x0, y0, ra);
        this._capsule(x0, y0, ra, lerp(a.x, b.x, t1), lerp(a.y, b.y, t1), rb);
      }
      t += Math.max(step, 1e-6); this.dpos += Math.max(step, 1e-6);
    }
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
      if (need > left) { this.since += left; this.trav += len; return; }
      t += need / len; this.since = 0;
      this.at = this.trav + t * len;
      this._dab(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.p, b.p, t), Math.atan2(b.y - a.y, b.x - a.x));
    }
  }
  _dab(x, y, p, dir) {
    const B = this.B, ctx = this.ctx, rnd = this.rnd;
    let r = this.rad(p);
    if (B.kind === 'spray') return this._spray(x, y, p, r);
    if (B.kind === 'stamp') return this._stamp(x, y, r, dir);
    if (B.kind === 'rainbow') return this._rainbow(x, y, r);
    if (B.kind === 'splatter') return this._splatter(x, y, r);
    if (B.kind === 'grass') return this._grass(x, y, r, dir);
    if (B.kind === 'glitter') return this._glitter(x, y, r);
    if (B.follow) return this._follow(x, y, p, r, dir);
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
  /** textured stamp turned to the stroke direction (oil, flat brush) */
  _follow(x, y, p, r, dir) {
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(this.flow(p), 0, 1);
    const c = Math.cos(dir || 0), s = Math.sin(dir || 0);
    for (const m of this.mats) {
      const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      const A = Math.atan2(m[1] * c + m[3] * s, m[0] * c + m[2] * s), ca = Math.cos(A), sa = Math.sin(A);
      ctx.setTransform(ca, sa, -sa, ca, X, Y); ctx.drawImage(this.img, -r, -r, 2 * r, 2 * r);
      this._bb(X, Y, r * 1.42);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** a little shape (heart, star, flower…) */
  _stamp(x, y, r, dir) {
    const B = this.B, ctx = this.ctx, rnd = this.rnd, S = shapes();
    r *= 1 + (rnd() - 0.5) * 2 * (B.sj || 0);
    const rot = (B.follow ? dir || 0 : 0) + (rnd() - 0.5) * 2 * (B.rj || 0);
    const ox = (rnd() - 0.5) * 2 * (B.scatter || 0) * r, oy = (rnd() - 0.5) * 2 * (B.scatter || 0) * r;
    let col = this.color;
    if (B.multi) col = B.multi[Math.floor(rnd() * B.multi.length)];
    if (B.glint && rnd() < B.glint) col = this.light;
    x += ox; y += oy;
    ctx.globalAlpha = 1;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const m of this.mats) {
      const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      const A = Math.atan2(m[1] * c + m[3] * s, m[0] * c + m[2] * s), ca = Math.cos(A) * r, sa = Math.sin(A) * r;
      ctx.setTransform(ca, sa, -sa, ca, X, Y);
      if (B.shape === 'bubble') { ctx.lineWidth = 0.14; ctx.strokeStyle = col; ctx.stroke(S.bubble); ctx.fillStyle = this.light; ctx.fill(S.shine); }
      else if (B.shape === 'flower') { ctx.fillStyle = col; ctx.fill(S.petals); ctx.fillStyle = '#ffd84d'; ctx.fill(S.centre); }
      else if (B.shape === 'leaf') { ctx.fillStyle = col; ctx.fill(S.leaf); ctx.lineWidth = 0.08; ctx.strokeStyle = this.dark; ctx.stroke(S.vein); }
      else { ctx.fillStyle = col; ctx.fill(S[B.shape] || S.dot); }
      this._bb(X, Y, r * 1.3);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** colour that walks around the colour wheel as the line gets longer */
  _rainbow(x, y, r) {
    const ctx = this.ctx, h = (this.hue0 + this.at * 0.5) % 360;
    ctx.globalAlpha = 1; ctx.fillStyle = `hsl(${h.toFixed(1)}, 92%, 58%)`;
    ctx.beginPath();
    for (const m of this.mats) { const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5]; ctx.moveTo(X + r, Y); ctx.arc(X, Y, r, 0, Math.PI * 2); this._bb(X, Y, r); }
    ctx.fill();
  }
  /** paint flicked off a brush: a few blobs of mixed sizes around the line */
  _splatter(x, y, r) {
    const rnd = this.rnd, n = 2 + Math.floor(rnd() * 3), blobs = [];
    for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * r * 2.2, s = r * 0.1 * (0.35 + Math.pow(rnd(), 3) * 2.4); blobs.push(x + Math.cos(a) * d, y + Math.sin(a) * d, s); }
    for (let i = 0; i < blobs.length; i += 3) this._circleAll(blobs[i], blobs[i + 1], Math.max(0.6, blobs[i + 2]));
  }
  /** blades of grass / fur, standing to the left of the stroke direction */
  _grass(x, y, r, dir) {
    const ctx = this.ctx, rnd = this.rnd, blades = [];
    for (let k = 0; k < 2; k++) {
      const a = (dir || 0) - Math.PI / 2 + (rnd() - 0.5) * 1.1, len = r * 2 * (0.6 + rnd() * 0.9), bend = (rnd() - 0.5) * 0.8, sh = this.shades[Math.floor(rnd() * 3)];
      const bx = x + (rnd() - 0.5) * r * 0.6, by = y + (rnd() - 0.5) * r * 0.6;
      blades.push([bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len, bx + Math.cos(a + bend) * len * 0.55, by + Math.sin(a + bend) * len * 0.55, sh]);
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, r * 0.16);
    for (const [x0, y0, x1, y1, cx, cy, sh] of blades) {
      ctx.strokeStyle = sh; ctx.beginPath();
      for (const m of this.mats) {
        const T = (u, v) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
        const [A0, A1] = T(x0, y0), [C0, C1] = T(cx, cy), [B0, B1] = T(x1, y1);
        ctx.moveTo(A0, A1); ctx.quadraticCurveTo(C0, C1, B0, B1);
        this._bb(A0, A1, r * 2.2);
      }
      ctx.stroke();
    }
  }
  /** glitter: tiny sparkles and specks, some lighter than the colour */
  _glitter(x, y, r) {
    const ctx = this.ctx, rnd = this.rnd, S = shapes(), bits = [];
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 1.2, s = r * (0.12 + rnd() * 0.3), kind = rnd() < 0.55 ? 'sparkle' : 'dot', tone = rnd();
      bits.push([x + Math.cos(a) * d, y + Math.sin(a) * d, kind === 'dot' ? s * 0.45 : s, kind, tone < 0.3 ? '#ffffff' : tone < 0.6 ? this.light : this.color]);
    }
    ctx.globalAlpha = 1;
    for (const [bx, by, s, kind, col] of bits) {
      ctx.fillStyle = col;
      for (const m of this.mats) {
        const X = m[0] * bx + m[2] * by + m[4], Y = m[1] * bx + m[3] * by + m[5];
        ctx.setTransform(s, 0, 0, s, X, Y); ctx.fill(S[kind]);
        this._bb(X, Y, s + 1);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
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
