// Pointer input on the canvas: Apple Pencil (pressure, palm rejection), fingers (draw, or pinch / pan / rotate with two;
// two-finger tap = undo, three-finger tap = redo), mouse and Mac trackpad (scroll = pan, pinch = zoom).
// While drawing, points are rendered and sent the moment the pointer event arrives: that is where the low latency comes from.
import { clamp, q1, q2 } from './util.js';
import { brushOf } from './brushes.js';

const now = () => performance.now();

export class Input {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.ptrs = new Map(); this.act = null; this.gest = null; this.penSeen = false; this.space = false;
    this.lastCursorSent = 0;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.act) this.app.setHover(null); });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const t of ['touchstart', 'touchmove']) el.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }); // no iOS loupe / selection / page zoom
    // Safari (Mac trackpad): pinch + rotate arrive as gesture events
    let gs = null;
    el.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = { s: e.scale, r: e.rotation }; });
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (!gs || this.ptrs.size) return; // iPad pinches are handled by the pointer code
      const [sx, sy] = this.local(e);
      this.app.view.zoomAt(sx, sy, e.scale / gs.s);
      if (this.app.settings.rotate) this.app.view.rotateAt(sx, sy, ((e.rotation - gs.r) * Math.PI) / 180);
      gs = { s: e.scale, r: e.rotation };
    });
    el.addEventListener('gestureend', (e) => { e.preventDefault(); gs = null; });
  }
  local(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  doc(sx, sy) { return this.app.view.toDoc(sx, sy); }
  get busy() { return !!(this.act || this.gest); }

  // ---------------------------------------------------------------- down
  down(e) {
    const app = this.app;
    if (app.uiOpenBlocksCanvas()) app.closePopovers();
    if (e.pointerType === 'pen') this.penSeen = true;
    try { this.el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    const [sx, sy] = this.local(e);
    if (e.pointerType === 'touch') {
      this.ptrs.set(e.pointerId, { x: sx, y: sy });
      if (this.gest) { this.gest.maxN = Math.max(this.gest.maxN, this.ptrs.size); return; }
      if (this.ptrs.size >= 2) { this.startGesture(); return; }
      if (this.act && this.act.kind !== 'none') return;
      if (!app.fingerDraws(this.penSeen)) { this.act = { kind: 'pan', id: e.pointerId, x: sx, y: sy }; return; }
    } else if (this.act) return;
    const id = e.pointerId;
    if (app.modes.hitHandle(sx, sy, app.view)) { this.act = { kind: 'divider', id }; return; }
    if (e.button === 1 || e.button === 2 || this.space || app.tool === 'hand') { this.act = { kind: 'pan', id, x: sx, y: sy }; this.el.style.cursor = 'grabbing'; return; }
    const [x, y] = this.doc(sx, sy);
    if (app.tool === 'adjust') { const hit = app.refHit(sx, sy); if (hit) { this.act = { kind: 'ref', id, ...hit, x0: x, y0: y }; } else this.act = { kind: 'pan', id, x: sx, y: sy }; return; }
    if (e.altKey && (app.tool === 'brush' || app.tool === 'eraser')) { this.act = { kind: 'pick', id }; app.pickAt(x, y); return; }
    switch (app.tool) {
      case 'brush': case 'eraser': this.startStroke(e, sx, sy, x, y); break;
      case 'shape': this.startShape(e, x, y); break;
      case 'fill': this.act = { kind: 'none', id }; app.fillAt(x, y); break;
      case 'text': this.act = { kind: 'none', id }; app.textAt(x, y); break;
      case 'pick': this.act = { kind: 'pick', id }; app.pickAt(x, y); break;
      case 'laser': this.act = { kind: 'laser', id }; app.laser(x, y, true); break;
      default: this.act = { kind: 'none', id };
    }
  }

  // ---------------------------------------------------------------- move
  move(e) {
    const app = this.app;
    const [sx, sy] = this.local(e);
    if (e.pointerType === 'touch' && this.ptrs.has(e.pointerId)) {
      const p = this.ptrs.get(e.pointerId); p.x = sx; p.y = sy;
      if (this.gest) { this.moveGesture(); return; }
    }
    const a = this.act;
    if (!a || a.id !== e.pointerId) {
      if (e.pointerType !== 'touch' && !a) { // hover (mouse, or a Pencil hovering over newer iPads)
        const [x, y] = this.doc(sx, sy);
        app.setHover([x, y]);
        this.cursor(x, y, false);
      }
      return;
    }
    if (a.kind === 'stroke') this.moveStroke(e);
    else if (a.kind === 'shape') { const [x, y] = this.doc(sx, sy); this.updShape(x, y, e.shiftKey); this.cursor(x, y, true); }
    else if (a.kind === 'pan') { this.app.view.panBy(sx - a.x, sy - a.y); a.x = sx; a.y = sy; }
    else if (a.kind === 'divider') { const [x, y] = this.doc(sx, sy); app.modes.dragTo(x, y); }
    else if (a.kind === 'pick') { const [x, y] = this.doc(sx, sy); app.pickAt(x, y); }
    else if (a.kind === 'laser') { const [x, y] = this.doc(sx, sy); app.laser(x, y, false); }
    else if (a.kind === 'ref') { const [x, y] = this.doc(sx, sy); app.refDrag(a, x, y); }
  }

  // ---------------------------------------------------------------- up
  up(e, cancelled) {
    const app = this.app;
    if (e.pointerType === 'touch' && this.ptrs.has(e.pointerId)) {
      this.ptrs.delete(e.pointerId);
      if (this.gest) {
        if (this.ptrs.size === 0) this.endGesture();
        return;
      }
    }
    const a = this.act;
    if (!a || a.id !== e.pointerId) return;
    this.act = null;
    if (a.kind === 'stroke') { if (cancelled && now() - a.t0 < 120) app.liveCancel(a); else this.endStroke(a, e); }
    else if (a.kind === 'shape') { if (cancelled || a.tiny) app.liveCancel(a); else app.liveEnd(a); }
    else if (a.kind === 'pick') app.pickDone();
    else if (a.kind === 'divider') app.modes.set({}); // make sure the final position went out
    else if (a.kind === 'ref') app.refDragEnd(a);
    else if (a.kind === 'pan') this.el.style.cursor = '';
  }

  // ---------------------------------------------------------------- strokes
  startStroke(e, sx, sy, x, y) {
    const app = this.app;
    const why = app.drawBlocked();
    if (why) { app.toast(why); this.act = { kind: 'none', id: e.pointerId }; return; }
    const op = app.makeStrokeOp(app.tool === 'eraser');
    if (!op) { this.act = { kind: 'none', id: e.pointerId }; return; }
    const B = brushOf(op.b), pen = e.pointerType === 'pen';
    const sm = app.smoothingFor(op.b);
    const a = {
      kind: 'stroke', id: e.pointerId, op, B, pen, k: 1 - sm * 0.88, sx: x, sy: y, lx: sx, ly: sy, lt: e.timeStamp,
      p: pen ? app.pressure(e.pressure) : B.simP || (B.kind === 'cap' && !B.erase && B.min < 0.5) ? 0.55 : 1,
      sim: !pen && app.settings.simPressure && (B.kind === 'cap' || B.kind === 'nib') && !B.erase && B.min < 0.5,
      t0: now(), len: 0, pts: [], pend: [], hold: { x: sx, y: sy }, holdT: null, snapped: null,
    };
    this.act = a;
    app.liveBegin(a);
    this.addPoint(a, x, y, a.p, true);
    app.liveFlush(a);
    this.armHold(a);
    this.cursor(x, y, true);
  }
  moveStroke(e) {
    const a = this.act, app = this.app;
    const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const evs = list.length ? list : [e];
    let lx = 0, ly = 0;
    for (const ce of evs) {
      const [sx, sy] = this.local(ce);
      const [x, y] = this.doc(sx, sy);
      lx = x; ly = y;
      if (a.snapped) continue;
      let p;
      if (a.pen) p = app.pressure(ce.pressure);
      else if (a.sim) {
        const dt = Math.max(1, ce.timeStamp - a.lt), v = Math.hypot(sx - a.lx, sy - a.ly) / dt;
        a.p += (clamp(1.12 - v * 0.3, 0.4, 1) - a.p) * 0.2; p = a.p;
      } else p = 1;
      a.len += Math.hypot(sx - a.lx, sy - a.ly);
      a.lx = sx; a.ly = sy; a.lt = ce.timeStamp; a.lastP = p;
      a.sx += (x - a.sx) * a.k; a.sy += (y - a.sy) * a.k;
      this.addPoint(a, a.sx, a.sy, p);
    }
    const [sx, sy] = this.local(e);
    if (a.snapped) this.applySnap(a, lx, ly);
    else {
      if (Math.hypot(sx - a.hold.x, sy - a.hold.y) > 7) { a.hold = { x: sx, y: sy }; this.armHold(a); }
      app.liveFlush(a);
    }
    this.cursor(lx, ly, true);
  }
  addPoint(a, x, y, p, first) {
    const pts = a.pts, n = pts.length;
    if (!first && n >= 3 && Math.abs(pts[n - 3] - x) < 0.3 && Math.abs(pts[n - 2] - y) < 0.3) return;
    const X = q1(x), Y = q1(y), P = q2(p);
    pts.push(X, Y, P); a.pend.push(X, Y, P);
  }
  endStroke(a, e) {
    clearTimeout(a.holdT);
    if (!a.snapped && e && e.type === 'pointerup') {
      const [sx, sy] = this.local(e), [x, y] = this.doc(sx, sy);
      if (Math.hypot(x - a.sx, y - a.sy) > 0.6 && a.pts.length >= 3) this.addPoint(a, x, y, a.lastP === undefined ? a.p : a.lastP);
      this.app.liveFlush(a);
    }
    this.app.liveEnd(a);
  }

  // hold still at the end of a stroke -> it snaps into a straight line or a neat ellipse (then drag to adjust)
  armHold(a) {
    clearTimeout(a.holdT);
    if (!this.app.settings.quickShape || a.snapped) return;
    a.holdT = setTimeout(() => { if (this.act === a) this.quickShape(a); }, 600);
  }
  quickShape(a) {
    const P = a.pts, n = P.length / 3;
    if (n < 6) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, len = 0, ps = 0;
    for (let i = 0; i < P.length; i += 3) {
      minx = Math.min(minx, P[i]); maxx = Math.max(maxx, P[i]); miny = Math.min(miny, P[i + 1]); maxy = Math.max(maxy, P[i + 1]); ps += P[i + 2];
      if (i) len += Math.hypot(P[i] - P[i - 3], P[i + 1] - P[i - 2]);
    }
    const diag = Math.hypot(maxx - minx, maxy - miny);
    if (len < 30 / this.app.view.s || diag < 12) return;
    const x0 = P[0], y0 = P[1], xe = P[P.length - 3], ye = P[P.length - 2], p = ps / n;
    const closed = Math.hypot(xe - x0, ye - y0) < Math.max(14, diag * 0.25) && len > diag * 1.7;
    if (closed) {
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      let rx = (maxx - minx) / 2, ry = (maxy - miny) / 2;
      if (Math.abs(rx - ry) < 0.14 * Math.max(rx, ry)) rx = ry = (rx + ry) / 2;
      a.snapped = { kind: 'ellipse', cx, cy, rx, ry, ref: Math.max(1, Math.hypot(xe - cx, ye - cy)), p };
    } else a.snapped = { kind: 'line', x0, y0, p };
    this.applySnap(a, xe, ye);
    this.app.flashSnap(a.snapped.kind);
  }
  applySnap(a, x, y) {
    const s = a.snapped;
    let pts;
    if (s.kind === 'line') pts = [s.x0, s.y0, s.p, x, y, s.p];
    else { const k = Math.hypot(x - s.cx, y - s.cy) / s.ref; pts = ellipsePts(s.cx, s.cy, s.rx * k, s.ry * k, s.p); }
    a.op.ln = 1;
    a.pts = pts.map((v, i) => (i % 3 === 2 ? q2(v) : q1(v)));
    this.app.liveReplace(a);
  }

  // ---------------------------------------------------------------- shapes
  startShape(e, x, y) {
    const app = this.app;
    const why = app.drawBlocked();
    if (why) { app.toast(why); this.act = { kind: 'none', id: e.pointerId }; return; }
    const op = app.makeStrokeOp(false);
    if (!op) { this.act = { kind: 'none', id: e.pointerId }; return; }
    op.ln = 1;
    if (app.settings.shapeFill && app.settings.shape !== 'line' && app.settings.shape !== 'arrow') op.f = 1;
    this.act = { kind: 'shape', id: e.pointerId, op, x0: x, y0: y, pts: [], pend: [], tiny: true };
    app.liveBegin(this.act);
    this.updShape(x, y, e.shiftKey);
  }
  updShape(x, y, shift) {
    const a = this.act;
    const pts = shapePts(this.app.settings.shape, a.x0, a.y0, x, y, shift, a.op.z);
    a.tiny = Math.hypot(x - a.x0, y - a.y0) < 3;
    a.pts = pts.map((v, i) => (i % 3 === 2 ? q2(v) : q1(v)));
    this.app.liveReplace(a);
  }

  // ---------------------------------------------------------------- two-finger gestures
  startGesture() {
    const a = this.act;
    if (a) {
      if (a.kind === 'stroke') { if (now() - a.t0 < 400 || a.len < 40) this.app.liveCancel(a); else this.endStroke(a, null); }
      else if (a.kind === 'shape') this.app.liveCancel(a);
      this.act = null;
    }
    const v = this.app.view, [p1, p2] = [...this.ptrs.values()];
    this.gest = { ids: [...this.ptrs.keys()].slice(0, 2), a0: { ...p1 }, b0: { ...p2 }, s0: v.s, r0: v.r, tx0: v.tx, ty0: v.ty, t0: now(), maxN: this.ptrs.size, moved: 0 };
  }
  moveGesture() {
    const g = this.gest, v = this.app.view;
    const a = this.ptrs.get(g.ids[0]), b = this.ptrs.get(g.ids[1]);
    if (!a || !b) return;
    const d0 = Math.hypot(g.b0.x - g.a0.x, g.b0.y - g.a0.y), d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const s = clamp(g.s0 * (d1 / Math.max(1, d0)), 0.03, 40);
    let r = g.r0;
    if (this.app.settings.rotate) {
      r = g.r0 + Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(g.b0.y - g.a0.y, g.b0.x - g.a0.x);
      const deg = (r * 180) / Math.PI, near = Math.round(deg / 90) * 90;
      if (Math.abs(deg - near) < 6) r = (near * Math.PI) / 180;
    }
    const m0x = (g.a0.x + g.b0.x) / 2, m0y = (g.a0.y + g.b0.y) / 2, m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
    const c0 = Math.cos(-g.r0), s0 = Math.sin(-g.r0), dx = m0x - g.tx0, dy = m0y - g.ty0;
    const X = (c0 * dx - s0 * dy) / g.s0, Y = (s0 * dx + c0 * dy) / g.s0; // doc point that was under the fingers
    v.s = s; v.r = r;
    v.tx = m1x - (Math.cos(r) * s * X - Math.sin(r) * s * Y); v.ty = m1y - (Math.sin(r) * s * X + Math.cos(r) * s * Y);
    g.moved = Math.max(g.moved, Math.hypot(m1x - m0x, m1y - m0y), Math.abs(d1 - d0));
    v.request();
  }
  endGesture() {
    const g = this.gest;
    this.gest = null;
    if (now() - g.t0 < 320 && g.moved < 14) { if (g.maxN === 2) this.app.undo(); else if (g.maxN >= 3) this.app.redo(); }
  }

  wheel(e) {
    e.preventDefault();
    const [sx, sy] = this.local(e), v = this.app.view;
    if (e.ctrlKey || e.metaKey) v.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)));
    else { let dx = e.deltaX, dy = e.deltaY; if (e.deltaMode === 1) { dx *= 18; dy *= 18; } if (e.shiftKey && !dx) { dx = dy; dy = 0; } v.panBy(-dx, -dy); }
  }

  cursor(x, y, drawing) {
    const t = performance.now();
    if (t - this.lastCursorSent < (this.app.net.lowRate ? 140 : 33)) return;
    this.lastCursorSent = t;
    this.app.sendCursor(x, y, drawing);
  }
}

export function ellipsePts(cx, cy, rx, ry, p) {
  const out = [], N = Math.max(24, Math.min(120, Math.round((rx + ry) / 3)));
  for (let i = 0; i <= N; i++) { const t = (i / N) * Math.PI * 2 - Math.PI / 2; out.push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, p); }
  return out;
}
export function shapePts(kind, x0, y0, x1, y1, shift, size = 6) {
  const p = 1;
  if (kind === 'line' || kind === 'arrow') {
    if (shift) { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(a) * d; y1 = y0 + Math.sin(a) * d; }
    if (kind === 'line') return [x0, y0, p, x1, y1, p];
    const a = Math.atan2(y1 - y0, x1 - x0), L = clamp(Math.hypot(x1 - x0, y1 - y0) * 0.3, 8 + size, 40 + size * 2);
    return [x0, y0, p, x1, y1, p, x1 - Math.cos(a - 0.5) * L, y1 - Math.sin(a - 0.5) * L, p, x1, y1, p, x1 - Math.cos(a + 0.5) * L, y1 - Math.sin(a + 0.5) * L, p];
  }
  let w = x1 - x0, hh = y1 - y0;
  if (shift) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
  const ax = Math.min(x0, x0 + w), ay = Math.min(y0, y0 + hh), bw = Math.abs(w), bh = Math.abs(hh);
  if (kind === 'rect') return [ax, ay, p, ax + bw, ay, p, ax + bw, ay + bh, p, ax, ay + bh, p, ax, ay, p];
  if (kind === 'ellipse') return ellipsePts(ax + bw / 2, ay + bh / 2, bw / 2, bh / 2, p);
  if (kind === 'triangle') return [ax + bw / 2, ay, p, ax + bw, ay + bh, p, ax, ay + bh, p, ax + bw / 2, ay, p];
  if (kind === 'star') {
    const out = [], cx = ax + bw / 2, cy = ay + bh / 2;
    for (let i = 0; i <= 10; i++) { const r = i % 2 ? 0.42 : 1, t = (i / 10) * Math.PI * 2 - Math.PI / 2; out.push(cx + Math.cos(t) * (bw / 2) * r, cy + Math.sin(t) * (bh / 2) * r + bh * 0.05, p); }
    return out;
  }
  if (kind === 'heart') {
    const out = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2, hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push(ax + bw / 2 + (hx / 34) * bw, ay + bh * 0.42 - (hy / 30) * bh, p);
    }
    return out;
  }
  return [x0, y0, p, x1, y1, p];
}
