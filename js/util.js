// Small shared helpers.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const q1 = (v) => Math.round(v * 10) / 10; // coordinates travel with 0.1 px precision
export const q2 = (v) => Math.round(v * 100) / 100;

/** deterministic PRNG: the same seed draws the same grain/spray on both devices */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rid(n = 8) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b & 31]).join('');
}
export const seed32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** tiny DOM builder: h('div', {class:'x', onclick}, 'text', child) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) { if (k === null || k === undefined || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function makeCanvas(w, h, opts) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return opts ? [c, c.getContext('2d', opts)] : c;
}

export function hexToRgb(hex) {
  let s = String(hex || '').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
export const validHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || ''));
export function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  return d;
}
export function fmtTime(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const loadImage = (src) => new Promise((resolve, reject) => { const im = new Image(); im.decoding = 'async'; im.onload = () => resolve(im); im.onerror = () => reject(new Error('image failed')); im.src = src; });
