// Hold-to-snap shape recognition: turns a hand-drawn stroke into the clean shape it most looks like.
// Open strokes: straight line, arc, or straight segments (an "L", a zig-zag). Closed strokes: triangle, rectangle /
// square, other polygons (up to 6 corners), circle or ellipse. When nothing fits well, it returns null and the stroke
// is left exactly as drawn. Pure functions (no DOM), so they are unit-tested in tests/shapes.test.mjs.

const hyp = Math.hypot;

/** evenly spaced points along a polyline ([[x,y],...]) */
export function resample(pts, n) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = d[d.length - 1], out = [];
  if (L <= 0) return pts.slice(0, 1);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * L;
    while (j < pts.length - 2 && d[j + 1] < t) j++;
    const seg = d[j + 1] - d[j] || 1, u = (t - d[j]) / seg;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return hyp(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
/** Ramer–Douglas–Peucker simplification of an open polyline */
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let best = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > best) { best = d; idx = i; } }
  if (best <= eps) return [pts[0], pts[pts.length - 1]];
  const a = rdp(pts.slice(0, idx + 1), eps), b = rdp(pts.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}
const turn = (a, b, c) => { // 0 = straight on, PI = full U-turn
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
};
const DEG = Math.PI / 180;

/** clean up a polygon's corners: drop almost-straight ones, merge ones that sit very close together */
function tidy(V, closed, minEdge) {
  V = V.map((p) => p.slice());
  for (let guard = 0; guard < 50; guard++) {
    const n = V.length;
    if (n <= (closed ? 3 : 2)) break;
    let minT = Infinity, ti = -1;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const t = turn(V[(i - 1 + n) % n], V[i], V[(i + 1) % n]);
      if (t < minT) { minT = t; ti = i; }
    }
    if (minT < 30 * DEG) { V.splice(ti, 1); continue; }
    let minE = Infinity, ei = -1;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const j = (i + 1) % n, e = hyp(V[j][0] - V[i][0], V[j][1] - V[i][1]); if (e < minE) { minE = e; ei = i; } }
    if (minE < minEdge) {
      const j = (ei + 1) % n;
      if (!closed && (ei === 0 || j === n - 1)) { V.splice(ei === 0 ? 1 : ei, 1); continue; } // keep the real end points
      V[ei] = [(V[ei][0] + V[j][0]) / 2, (V[ei][1] + V[j][1]) / 2]; V.splice(j, 1); continue;
    }
    break;
  }
  return V;
}
/** corners of a closed, evenly resampled ring, or null when its sides are not straight */
function polygonFrom(ring) { return cornersAt(ring, 24, 52) || cornersAt(ring, 16, 56); }
function cornersAt(ring, div, minDeg) {
  const N = ring.length, w = Math.max(3, Math.round(N / div)), need = minDeg * DEG; // (curved sides are rejected below)
  const ang = (i, j) => Math.atan2(ring[j][1] - ring[i][1], ring[j][0] - ring[i][0]);
  const T = ring.map((_, i) => { const a = ang((i - w + N) % N, i), b = ang(i, (i + w) % N); return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))); });
  // strongest turns first; each corner claims its neighbourhood so one rounded corner never counts twice
  const order = T.map((t, i) => [t, i]).filter(([t]) => t >= need).sort((a, b) => b[0] - a[0]);
  const corners = [];
  for (const [, i] of order) if (corners.every((c) => Math.min((i - c + N) % N, (c - i + N) % N) > 2 * w)) corners.push(i);
  corners.sort((a, b) => a - b);
  if (corners.length < 3 || corners.length > 6) return null;
  // a straight line through each side (only the part away from the rounded corners)
  const K = corners.length, lines = [];
  for (let k = 0; k < K; k++) {
    const a = corners[k], b = corners[(k + 1) % K], span = (b - a + N) % N;
    const pts = [];
    for (let j = Math.min(w, Math.floor(span / 3)); j <= span - Math.min(w, Math.floor(span / 3)); j++) pts.push(ring[(a + j) % N]);
    if (pts.length < 2) return null;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
    let res = 0;
    for (const p of pts) res += Math.abs(-(p[0] - mx) * dy + (p[1] - my) * dx);
    const len = hyp(ring[b][0] - ring[a][0], ring[b][1] - ring[a][1]);
    if (!len || res / pts.length > 0.06 * len) return null; // this side is curved: not a polygon
    lines.push({ mx, my, dx, dy });
  }
  const V = [];
  for (let k = 0; k < K; k++) {
    const A = lines[(k - 1 + K) % K], B = lines[k];
    const den = A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 0.2) { V.push(ring[corners[k]].slice()); continue; } // nearly parallel sides
    const t = ((B.mx - A.mx) * B.dy - (B.my - A.my) * B.dx) / den;
    V.push([A.mx + A.dx * t, A.my + A.dy * t]);
  }
  return V;
}
/** tightest rotated bounding box (angle snapped to the page when close) and how much of it the shape fills */
function minBox(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a[0] * b[1] - b[0] * a[1]; }
  area = Math.abs(area) / 2;
  let best = null;
  for (let k = 0; k < 90; k++) { const b = boxAt(ring, (k * Math.PI) / 180); if (!best || b.A < best.A) best = b; }
  // nearly level? then keep it level, people mean the page's horizontal
  if (best.ang < 8 * DEG || best.ang > 82 * DEG) { const r0 = boxAt(ring, 0); if (r0.A < best.A * 1.06) best = r0; }
  return { ...best, fill: area / (best.A || 1) };
}
function boxAt(ring, ang) {
  const c = Math.cos(ang), sn = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) { const u = p[0] * c + p[1] * sn, v = -p[0] * sn + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { A: (u1 - u0) * (v1 - v0), ang, u0, u1, v0, v1 };
}
function polyError(P, V, closed) {
  let s = 0;
  for (const p of P) {
    let m = Infinity;
    for (let i = 0; i < V.length - (closed ? 0 : 1); i++) m = Math.min(m, segDist(p, V[i], V[(i + 1) % V.length]));
    s += m;
  }
  return s / P.length;
}
/** principal-axes ellipse through points spread evenly around it */
function fitEllipse(P) {
  let cx = 0, cy = 0;
  for (const p of P) { cx += p[0]; cy += p[1]; }
  cx /= P.length; cy /= P.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of P) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= P.length; syy /= P.length; sxy /= P.length;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2), c = Math.cos(ang), s = Math.sin(ang);
  let err = 0;
  for (const p of P) {
    const dx = p[0] - cx, dy = p[1] - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
    err += Math.abs(Math.sqrt((u / a) ** 2 + (v / b) ** 2) - 1);
  }
  return { cx, cy, a, b, ang, err: (err / P.length) * Math.sqrt(a * b) };
}
/** algebraic least-squares circle (Kåsa) */
function fitCircle(P) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const n = P.length;
  // solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F]^T = -[sxz syz sz]
  const M = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
  for (let i = 0; i < 3; i++) {
    let piv = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    if (Math.abs(M[i][i]) < 1e-9) return null;
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
  }
  const D = M[0][3] / M[0][0], E = M[1][3] / M[1][1], F = M[2][3] / M[2][2];
  const cx = -D / 2, cy = -E / 2, R = Math.sqrt(Math.max(0, cx * cx + cy * cy - F));
  let err = 0;
  for (const p of P) err += Math.abs(hyp(p[0] - cx, p[1] - cy) - R);
  return { cx, cy, R, err: err / n };
}
function ellipsePoints(cx, cy, a, b, ang) {
  const out = [], N = Math.max(36, Math.min(120, Math.round((a + b) / 3))), c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i <= N; i++) { const t = (i / N) * Math.PI * 2 - Math.PI / 2, u = Math.cos(t) * a, v = Math.sin(t) * b; out.push([cx + u * c - v * s, cy + u * s + v * c]); }
  return out;
}

/**
 * pts: flat [x, y, pressure, ...] of the stroke so far.
 * Returns { kind, pts: [[x,y],...], closed, cx, cy } or null when nothing fits well enough.
 */
export function recognize(flat, minLen = 30) {
  const raw = [];
  for (let i = 0; i + 1 < flat.length; i += 3) raw.push([flat[i], flat[i + 1]]);
  if (raw.length < 4) return null;
  let L = 0, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const [x, y] = raw[i];
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    if (i) L += hyp(x - raw[i - 1][0], y - raw[i - 1][1]);
  }
  const diag = hyp(maxx - minx, maxy - miny);
  if (L < minLen || diag < 10) return null;
  const P = resample(raw, 96), first = P[0], last = P[P.length - 1];
  const gap = hyp(last[0] - first[0], last[1] - first[1]);
  const closed = gap < Math.max(12, 0.22 * diag) && L > 1.6 * diag;

  if (!closed) {
    // straight line: every point close to the line from start to end
    const chord = hyp(last[0] - first[0], last[1] - first[1]);
    let dev = 0;
    for (const p of P) dev = Math.max(dev, segDist(p, first, last));
    if (chord > 0 && dev < Math.max(4, 0.07 * chord)) return { kind: 'line', pts: [first, last], closed: false };
    // straight segments (an L, a V, a zig-zag)
    const V = tidy(rdp(P, Math.max(3, 0.035 * diag)), false, 0.08 * L);
    const pe = polyError(P, V, false);
    const circ = fitCircle(P);
    if (V.length >= 3 && V.length <= 6 && pe < Math.max(2.5, 0.022 * diag) && (!circ || pe < circ.err * 0.7)) return { kind: 'polyline', pts: V, closed: false };
    // arc: points close to one circle, not wrapping all the way round
    if (circ && circ.R > 0 && circ.err < 0.045 * circ.R && circ.R < 4 * diag) {
      const a0 = Math.atan2(first[1] - circ.cy, first[0] - circ.cx), mid = P[P.length >> 1];
      let sweep = 0;
      for (let i = 1; i < P.length; i++) {
        const t0 = Math.atan2(P[i - 1][1] - circ.cy, P[i - 1][0] - circ.cx), t1 = Math.atan2(P[i][1] - circ.cy, P[i][0] - circ.cx);
        sweep += Math.atan2(Math.sin(t1 - t0), Math.cos(t1 - t0));
      }
      void mid;
      if (Math.abs(sweep) > 25 * DEG && Math.abs(sweep) < 330 * DEG) {
        const N = Math.max(16, Math.round((Math.abs(sweep) * circ.R) / 4)), out = [];
        for (let i = 0; i <= N; i++) { const t = a0 + (sweep * i) / N; out.push([circ.cx + Math.cos(t) * circ.R, circ.cy + Math.sin(t) * circ.R]); }
        return { kind: 'arc', pts: out, closed: false, cx: circ.cx, cy: circ.cy };
      }
    }
    return null;
  }

  // closed: find corners where the line turns sharply (rounded, hand-drawn corners included), fit a straight line to
  // each side between them and intersect neighbouring sides, which gives crisp corners even from a sloppy drawing
  // cut off any overshoot past the starting point, so the seam does not look like an extra corner
  let cut = P.length - 1, best = Infinity;
  for (let i = Math.floor(P.length * 0.7); i < P.length; i++) { const d = hyp(P[i][0] - first[0], P[i][1] - first[1]); if (d < best) { best = d; cut = i; } }
  const ring = resample(P.slice(0, Math.max(cut, 8)), 96), N = ring.length;
  const ell = fitEllipse(ring), R = Math.sqrt(ell.a * ell.b);
  const poly = polygonFrom(ring);
  if (poly && poly.length >= 3 && poly.length <= 6) {
    let V = poly, kind = V.length === 3 ? 'triangle' : V.length === 4 ? 'quad' : 'polygon';
    if (V.length === 4) {
      const angles = V.map((p, i) => Math.PI - turn(V[(i + 3) % 4], p, V[(i + 1) % 4]));
      if (angles.every((a) => Math.abs(a - Math.PI / 2) < 20 * DEG)) {
        // a rectangle: line it up with its longest side (or with the page when that side is nearly level)
        let best = 0, ang = 0;
        for (let i = 0; i < 4; i++) { const q = V[(i + 1) % 4], e = hyp(q[0] - V[i][0], q[1] - V[i][1]); if (e > best) { best = e; ang = Math.atan2(q[1] - V[i][1], q[0] - V[i][0]); } }
        ang = Math.atan2(Math.sin(2 * ang), Math.cos(2 * ang)) / 2; // direction modulo 180
        const snapTo = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(ang - snapTo) < 8 * DEG) ang = snapTo;
        const c = Math.cos(ang), sn = Math.sin(ang);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of V) { const u = p[0] * c + p[1] * sn, v = -p[0] * sn + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const w = u1 - u0, hh = v1 - v0;
        kind = 'rect';
        if (Math.abs(w - hh) < 0.1 * Math.max(w, hh)) { const m = (w + hh) / 2, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; u0 = uc - m / 2; u1 = uc + m / 2; v0 = vc - m / 2; v1 = vc + m / 2; kind = 'square'; }
        V = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * c - v * sn, u * sn + v * c]);
      }
    }
    let cx = 0, cy = 0;
    for (const p of V) { cx += p[0]; cy += p[1]; }
    return { kind, pts: [...V, V[0]], closed: true, cx: cx / V.length, cy: cy / V.length };
  }
  void N;
  // rounded or very sloppy rectangles: they fill nearly all of their tightest bounding box (an ellipse fills ~79%)
  const box = minBox(ring);
  if (box.fill > 0.87) {
    let { ang, u0, u1, v0, v1 } = box, kind = 'rect';
    const w = u1 - u0, hh = v1 - v0;
    if (Math.abs(w - hh) < 0.1 * Math.max(w, hh)) { const m = (w + hh) / 2, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; u0 = uc - m / 2; u1 = uc + m / 2; v0 = vc - m / 2; v1 = vc + m / 2; kind = 'square'; }
    const c = Math.cos(ang), sn = Math.sin(ang), V = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * c - v * sn, u * sn + v * c]);
    return { kind, pts: [...V, V[0]], closed: true, cx: (V[0][0] + V[2][0]) / 2, cy: (V[0][1] + V[2][1]) / 2 };
  }
  if (ell.err < 0.11 * R) {
    let { a, b, ang } = ell;
    let kind = 'ellipse';
    if (Math.abs(a - b) < 0.13 * Math.max(a, b)) { a = b = (a + b) / 2; ang = 0; kind = 'circle'; }
    else { const snapTo = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2); if (Math.abs(ang - snapTo) < 10 * DEG) ang = snapTo; }
    return { kind, pts: ellipsePoints(ell.cx, ell.cy, a, b, ang), closed: true, cx: ell.cx, cy: ell.cy };
  }
  return null;
}
export const SNAP_LABEL = { line: '📏 Straight line', polyline: '📐 Straight segments', arc: '⌒ Arc', triangle: '🔺 Triangle', rect: '▭ Rectangle', square: '◻️ Square', quad: '◇ Four-sided shape', polygon: '⬠ Polygon', circle: '⭕ Circle', ellipse: '⬭ Ellipse' };
