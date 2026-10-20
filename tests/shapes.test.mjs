// Hold-to-snap recognition on many wobbly, hand-drawn-looking shapes (seeded, so the run is repeatable).
import { recognize } from '../js/shapes.js';
import { mulberry32 } from '../js/util.js';

function wobbly(path, size, rnd, amp = 0.025) {
  // path: dense [[x,y],...]; add slow wobble perpendicular-ish + a little jitter, like a real hand
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28, f1 = 2 + rnd() * 3, f2 = 7 + rnd() * 5;
  return path.map(([x, y], i) => {
    const t = i / path.length;
    const w = size * amp * (Math.sin(t * f1 * 6.28 + p1) * 0.7 + Math.sin(t * f2 * 6.28 + p2) * 0.3);
    return [x + w + (rnd() - 0.5) * 0.8, y - w * 0.6 + (rnd() - 0.5) * 0.8];
  });
}
const flat = (pts) => pts.flatMap(([x, y]) => [x, y, 0.8]);
function poly(vs, closedLoop, perEdge = 40, rnd, roundCorner = 0) {
  const out = [], n = vs.length, segs = closedLoop ? n : n - 1;
  const start = closedLoop ? rnd() * 0.8 + 0.1 : 0; // closed shapes usually start somewhere along an edge
  for (let s = 0; s <= segs; s++) {
    const a = vs[s % n], b = vs[(s + 1) % n];
    for (let i = 0; i < perEdge; i++) {
      let t = i / perEdge;
      if (closedLoop && s === 0) t = start + (1 - start) * t;
      if (closedLoop && s === segs) { t = start * t; if (t >= start) break; }
      if (!closedLoop && s === segs) break;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (!closedLoop) out.push(vs[n - 1]);
  if (closedLoop) { const a = vs[0], b = vs[1]; out.push([a[0] + (b[0] - a[0]) * (start + 0.03), a[1] + (b[1] - a[1]) * (start + 0.03)]); } // small overshoot
  void roundCorner;
  return out;
}
/** closed polygon traced with rounded corners (k = share of each edge used by the rounding), starting mid-edge */
function rounded(vs, k, rnd) {
  const n = vs.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = vs[(i - 1 + n) % n], b = vs[i], c = vs[(i + 1) % n];
    const p0 = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k], p1 = [b[0] + (c[0] - b[0]) * k, b[1] + (c[1] - b[1]) * k];
    for (let j = 0; j <= 8; j++) { const t = j / 8, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p1[1]]); }
    const q = vs[(i + 1) % n], q0 = [q[0] + (b[0] - q[0]) * k, q[1] + (b[1] - q[1]) * k];
    for (let j = 1; j < 20; j++) { const t = j / 20; out.push([p1[0] + (q0[0] - p1[0]) * t, p1[1] + (q0[1] - p1[1]) * t]); }
  }
  const sh = Math.floor(rnd() * out.length);
  const loop = out.slice(sh).concat(out.slice(0, sh));
  return loop.concat(loop.slice(0, 4));
}
const rot = (vs, ang, cx, cy) => vs.map(([x, y]) => { const c = Math.cos(ang), s = Math.sin(ang); return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; });

const MAKERS = {
  line: (r) => { const a = [200 + r() * 100, 300 + r() * 100], ang = r() * 6.28, L = 200 + r() * 400; return { want: ['line'], pts: wobbly(Array.from({ length: 60 }, (_, i) => [a[0] + Math.cos(ang) * L * i / 59, a[1] + Math.sin(ang) * L * i / 59]), L, r, 0.012) }; },
  arc: (r) => { const R = 150 + r() * 200, a0 = r() * 6.28, sw = (0.6 + r() * 1.8) * (r() < 0.5 ? 1 : -1); return { want: ['arc'], pts: wobbly(Array.from({ length: 70 }, (_, i) => [600 + Math.cos(a0 + sw * i / 69) * R, 600 + Math.sin(a0 + sw * i / 69) * R]), R, r, 0.012) }; },
  'L shape': (r) => { const s = 200 + r() * 200, ang = r() * 6.28; return { want: ['polyline'], pts: wobbly(poly(rot([[300, 200], [300, 200 + s], [300 + s * 0.8, 200 + s]], ang, 400, 400), false, 40, r), s, r, 0.01) }; },
  zigzag: (r) => { const s = 120 + r() * 100; return { want: ['polyline'], pts: wobbly(poly([[200, 400], [200 + s, 400 - s], [200 + 2 * s, 400], [200 + 3 * s, 400 - s]], false, 30, r), s, r, 0.01) }; },
  triangle: (r) => { const s = 200 + r() * 250; const vs = rot([[0, -s * 0.6], [s * 0.55 + r() * 60, s * 0.4], [-s * 0.5 - r() * 60, s * 0.4 + r() * 40]], r() * 6.28, 0, 0).map(([x, y]) => [x + 600, y + 600]); return { want: ['triangle'], pts: wobbly(poly(vs, true, 45, r), s, r, 0.012) }; },
  rectangle: (r) => { const w = 250 + r() * 300, hh = (0.45 + r() * 0.3) * w; return { want: ['rect'], pts: wobbly(poly([[300, 300], [300 + w, 300], [300 + w, 300 + hh], [300, 300 + hh]], true, 40, r), w, r, 0.012) }; },
  'tilted rectangle': (r) => { const w = 300, hh = 170; return { want: ['rect', 'quad'], pts: wobbly(poly(rot([[300, 300], [300 + w, 300], [300 + w, 300 + hh], [300, 300 + hh]], 0.3 + r() * 0.5, 450, 380), true, 40, r), w, r, 0.012) }; },
  square: (r) => { const s = 200 + r() * 300; return { want: ['square', 'rect'], pts: wobbly(poly([[300, 300], [300 + s, 300], [300 + s, 300 + s * (0.97 + r() * 0.06)], [300, 300 + s]], true, 40, r), s, r, 0.012) }; },
  pentagon: (r) => { const R = 220; const vs = Array.from({ length: 5 }, (_, i) => [600 + Math.cos(i * 1.2566 - 1.57) * R, 600 + Math.sin(i * 1.2566 - 1.57) * R]); return { want: ['polygon'], pts: wobbly(poly(vs, true, 35, r), R, r, 0.01) }; },
  circle: (r) => { const R = 100 + r() * 250, a0 = r() * 6.28, sw = 6.28 * (1.03 + r() * 0.06); return { want: ['circle'], pts: wobbly(Array.from({ length: 90 }, (_, i) => [600 + Math.cos(a0 + sw * i / 89) * R, 600 + Math.sin(a0 + sw * i / 89) * R]), R, r, 0.018) }; },
  ellipse: (r) => { const a = 300, b = 140 + r() * 60, th = r() * 6.28, a0 = r() * 6.28; return { want: ['ellipse'], pts: wobbly(Array.from({ length: 90 }, (_, i) => { const t = a0 + 6.28 * 1.04 * i / 89, u = Math.cos(t) * a, v = Math.sin(t) * b; return [600 + u * Math.cos(th) - v * Math.sin(th), 600 + u * Math.sin(th) + v * Math.cos(th)]; }), a, r, 0.015) }; },
  // harder: shaky hand, rounded corners, loop not quite closed, few points
  'shaky square': (r) => { const s = 300; return { want: ['square', 'rect'], pts: wobbly(rounded([[300, 300], [300 + s, 300], [300 + s, 300 + s], [300, 300 + s]], 0.12, r), s, r, 0.03) }; },
  'rounded rectangle': (r) => { const w = 420, hh = 220; return { want: ['rect'], pts: wobbly(rounded([[300, 300], [300 + w, 300], [300 + w, 300 + hh], [300, 300 + hh]], 0.15, r), w, r, 0.022) }; },
  'rounded triangle': (r) => { const s = 320; return { want: ['triangle'], pts: wobbly(rounded([[600, 600 - s * 0.6], [600 + s * 0.6, 600 + s * 0.4], [600 - s * 0.6, 600 + s * 0.4]], 0.12, r), s, r, 0.025) }; },
  'shaky circle': (r) => { const R = 220, a0 = r() * 6.28, sw = 6.28 * (0.9 + r() * 0.1); return { want: ['circle'], pts: wobbly(Array.from({ length: 40 }, (_, i) => [600 + Math.cos(a0 + sw * i / 39) * R, 600 + Math.sin(a0 + sw * i / 39) * R]), R, r, 0.04) }; },
  'egg / oval': (r) => { const a0 = r() * 6.28; return { want: ['ellipse', 'circle'], pts: wobbly(Array.from({ length: 80 }, (_, i) => { const t = a0 + 6.28 * 1.03 * i / 79, R = 200 * (1 + 0.12 * Math.sin(t)); return [600 + Math.cos(t) * R * 0.75, 600 + Math.sin(t) * R]; }), 200, r, 0.02) }; },
  'shaky line': (r) => { const L = 500; return { want: ['line'], pts: wobbly(Array.from({ length: 30 }, (_, i) => [200 + L * i / 29, 400 + (r() - 0.5) * 6]), L, r, 0.03) }; },
  squiggle: (r) => { let x = 400, y = 400, a = 0; const pts = []; for (let i = 0; i < 120; i++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 9; y += Math.sin(a) * 9; pts.push([x, y]); } return { want: [null, 'arc', 'polyline'], pts }; },
};

let fails = 0;
const N = 60;
for (const [name, make] of Object.entries(MAKERS)) {
  const counts = {};
  let good = 0;
  for (let s = 1; s <= N; s++) {
    const r = mulberry32(s * 977 + name.length * 31);
    const { want, pts } = make(r);
    const res = recognize(flat(pts));
    const got = res ? res.kind : null;
    counts[got] = (counts[got] || 0) + 1;
    if (want.includes(got)) good++;
  }
  const rate = good / N, need = name === 'squiggle' ? 0.6 : 0.9;
  console.log(`${rate >= need ? '✓' : '✗'} ${name.padEnd(17)} ${(rate * 100).toFixed(0).padStart(3)}%   ${JSON.stringify(counts)}`);
  if (rate < need) fails++;
}
console.log(fails ? `\n${fails} shape(s) below target` : '\nshape recognition ok');
process.exit(fails ? 1 : 0);
