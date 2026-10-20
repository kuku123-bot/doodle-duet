// Paint bucket. The device that fills computes the region once and sends it as a run-length mask, because Safari and
// Chrome anti-alias lines slightly differently: recomputing the flood on the partner's screen could leak through a gap on
// one device and not the other. Replaying a stored mask is identical everywhere.
// Mask values: 1 = inside the region (paint over), 2 = a 2 px ring around it (paint *behind* what is there, so the fill
// tucks under anti-aliased line edges instead of leaving a pale halo).
import { hexToRgb, clamp } from './util.js';

/** sample: ImageData of the whole canvas. Returns { r:[x,y,w,h], m:[v,n,v,n,...] } or null */
export function computeFill(sample, x, y, tol, clip) {
  const W = sample.width, H = sample.height, d = sample.data;
  x = Math.floor(x); y = Math.floor(y);
  let cx0 = 0, cy0 = 0, cx1 = W, cy1 = H;
  if (clip) { cx0 = clamp(Math.floor(clip[0]), 0, W); cy0 = clamp(Math.floor(clip[1]), 0, H); cx1 = clamp(Math.ceil(clip[0] + clip[2]), 0, W); cy1 = clamp(Math.ceil(clip[1] + clip[3]), 0, H); }
  if (x < cx0 || y < cy0 || x >= cx1 || y >= cy1) return null;
  const si = (y * W + x) * 4, sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
  const T = Math.round(clamp(tol, 0, 100) * 2.55);
  const match = (i) => {
    const a = d[i + 3];
    if (sa < 10 && a < 10) return true;
    return Math.abs(a - sa) <= T && Math.abs(d[i] - sr) <= T && Math.abs(d[i + 1] - sg) <= T && Math.abs(d[i + 2] - sb) <= T;
  };
  const mask = new Uint8Array(W * H);
  let bx0 = x, by0 = y, bx1 = x, by1 = y;
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop(), px = stack.pop();
    if (mask[py * W + px] || !match((py * W + px) * 4)) continue;
    let l = px;
    while (l > cx0 && !mask[py * W + l - 1] && match((py * W + l - 1) * 4)) l--;
    let r = px;
    while (r < cx1 - 1 && !mask[py * W + r + 1] && match((py * W + r + 1) * 4)) r++;
    for (let i = l; i <= r; i++) mask[py * W + i] = 1;
    if (l < bx0) bx0 = l; if (r > bx1) bx1 = r; if (py < by0) by0 = py; if (py > by1) by1 = py;
    for (const ny of [py - 1, py + 1]) {
      if (ny < cy0 || ny >= cy1) continue;
      let i = l;
      while (i <= r) {
        while (i <= r && (mask[ny * W + i] || !match((ny * W + i) * 4))) i++;
        if (i > r) break;
        stack.push(i, ny);
        while (i <= r && !mask[ny * W + i] && match((ny * W + i) * 4)) i++;
      }
    }
  }
  // ring: 2 px around the region (inside the clip), painted behind existing pixels
  const R = 2;
  const x0 = Math.max(cx0, bx0 - R), y0 = Math.max(cy0, by0 - R), x1 = Math.min(cx1 - 1, bx1 + R), y1 = Math.min(cy1 - 1, by1 + R);
  const w = x1 - x0 + 1, hgt = y1 - y0 + 1;
  // horizontal then vertical dilation of the region inside the box
  const hd = new Uint8Array(w * hgt);
  for (let yy = 0; yy < hgt; yy++) {
    const row = (y0 + yy) * W;
    for (let xx = 0; xx < w; xx++) {
      let on = 0;
      for (let k = -R; k <= R && !on; k++) { const X = x0 + xx + k; if (X >= x0 && X <= x1 && mask[row + X] === 1) on = 1; }
      hd[yy * w + xx] = on;
    }
  }
  const out = new Uint8Array(w * hgt);
  for (let yy = 0; yy < hgt; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (mask[(y0 + yy) * W + x0 + xx] === 1) { out[yy * w + xx] = 1; continue; }
      let on = 0;
      for (let k = -R; k <= R && !on; k++) { const Y = yy + k; if (Y >= 0 && Y < hgt && hd[Y * w + xx]) on = 1; }
      out[yy * w + xx] = on ? 2 : 0;
    }
  }
  const m = [];
  let cur = out[0], n = 0;
  for (let i = 0; i < out.length; i++) { if (out[i] === cur) n++; else { m.push(cur, n); cur = out[i]; n = 1; } }
  m.push(cur, n);
  return { r: [x0, y0, w, hgt], m };
}

/** apply a stored fill op { r, m, c, o } to a layer context */
export function applyFill(ctx, op) {
  const [x, y, w, h] = op.r;
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x, y, w, h), d = img.data;
  const [fr, fg, fb] = hexToRgb(op.c), fa = clamp(op.o === undefined ? 1 : op.o, 0, 1);
  let p = 0;
  const m = op.m;
  for (let k = 0; k + 1 < m.length; k += 2) {
    const v = m[k], n = m[k + 1];
    if (v === 0) { p += n; continue; }
    for (let j = 0; j < n; j++, p++) {
      const i = p * 4, da = d[i + 3] / 255;
      if (v === 1) { // fill over existing
        const oa = fa + da * (1 - fa);
        if (oa <= 0) continue;
        d[i] = (fr * fa + d[i] * da * (1 - fa)) / oa; d[i + 1] = (fg * fa + d[i + 1] * da * (1 - fa)) / oa; d[i + 2] = (fb * fa + d[i + 2] * da * (1 - fa)) / oa; d[i + 3] = oa * 255;
      } else { // existing over fill
        const oa = da + fa * (1 - da);
        if (oa <= 0) continue;
        d[i] = (d[i] * da + fr * fa * (1 - da)) / oa; d[i + 1] = (d[i + 1] * da + fg * fa * (1 - da)) / oa; d[i + 2] = (d[i + 2] * da + fb * fa * (1 - da)) / oa; d[i + 3] = oa * 255;
      }
    }
  }
  ctx.putImageData(img, x, y);
}
