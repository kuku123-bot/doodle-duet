// Ways to draw together. The mode lives in the drawing (doc.mode, last-writer-wins), so both screens always agree.
// A mode can: limit where you draw (clip), mirror strokes (sym), decide whose turn it is, cover parts of the picture,
// and show its own controls in the mode bar under the top bar.
import { h, clamp, fmtTime } from './util.js';
import { icon } from './icons.js';
import { PROMPTS, WORDS, pick } from './words.js';

export const MODE_LIST = [
  { id: 'free', name: 'Free draw', emoji: '🎨', desc: 'Draw anywhere, together.' },
  { id: 'split', name: 'Split canvas', emoji: '🌗', desc: 'Each of you gets a side, like two halves of a face. Drag the line anywhere, add overlap, or unlock it and draw wherever you like.' },
  { id: 'mirror', name: 'Mirror magic', emoji: '🦋', desc: 'Everything you both draw is mirrored: butterflies, faces, mandalas.' },
  { id: 'trace', name: 'Teach & trace', emoji: '✏️', desc: 'One of you draws light guide lines, the other traces over them. Made for learning.' },
  { id: 'turns', name: 'Take turns', emoji: '⏱️', desc: 'Pass the pen every few seconds and see what you build.' },
  { id: 'fold', name: 'Fold-a-friend', emoji: '🙈', desc: 'Take turns drawing the head, body and legs without peeking, then reveal the creature.' },
  { id: 'challenge', name: 'Draw-off', emoji: '🏁', desc: 'Same prompt, side by side, against the clock. Your partner\'s side stays hidden until time is up.' },
  { id: 'guess', name: 'Guess it', emoji: '🔮', desc: 'One draws a secret word, the other guesses. You score together.' },
];
export const modeInfo = (id) => MODE_LIST.find((m) => m.id === id) || MODE_LIST[0];
const FOLD_LABELS = { 3: ['Head', 'Body', 'Legs'], 4: ['Hat & head', 'Body', 'Legs', 'Feet'] };
export const SYMS = [['v', 'Left ↔ right'], ['h', 'Top ↕ bottom'], ['q', 'Four ways'], ['r6', 'Spin ×6'], ['k6', 'Kaleidoscope'], ['k8', 'Snowflake']];

export class Modes {
  constructor(app) { this.app = app; this.drag = null; }
  get m() { return this.app.doc.mode; }
  get id() { return this.m.id || 'free'; }
  get p() { return this.m.p || {}; }
  me() { return this.app.me.id; }
  other() { return this.app.partner ? this.app.partner.id : null; }
  solo() { return !this.app.partner; }
  /** which slot (0/1) of a two-person list is mine */
  slotOf(arr) {
    const me = this.me();
    let i = arr.indexOf(me); if (i >= 0) return i;
    i = arr.indexOf(null); if (i >= 0) return i;
    const pid = this.other();
    i = arr.findIndex((x) => x !== pid);
    return i >= 0 ? i : 0;
  }
  nameOf(id) {
    if (id === this.me()) return 'You';
    if (this.app.partner && id === this.app.partner.id) return this.app.partner.name;
    return this.app.partner ? this.app.partner.name : 'Partner';
  }
  /** is it this person's turn? id null = "whoever is not the other one" */
  mine(id) {
    if (id === this.me()) return true;
    if (this.solo()) return true; // alone you play every part
    if (id === this.other()) return false;
    return id === null;
  }

  // ---------------------------------------------------------------- starting / changing
  start(id, opts = {}) {
    const me = this.me(), other = this.other(), now = Date.now();
    let p = {}, fresh = false;
    if (id === 'split') p = { o: opts.o || 'v', pos: 0.5, lock: true, ov: 0.02, ghost: false, sides: [me, other] };
    else if (id === 'mirror') p = { sym: opts.sym || 'v' };
    else if (id === 'trace') { p = { teacher: opts.teacher || me }; this.app.ensureGuideLayer(); }
    else if (id === 'turns') p = { sec: opts.sec || 30, turn: me, end: now + (opts.sec || 30) * 1000 };
    else if (id === 'fold') { const n = opts.n || 3; p = { n, cur: 0, order: Array.from({ length: n }, (_, i) => (i % 2 ? other : me)), done: false, peek: 0.06 }; fresh = true; }
    else if (id === 'challenge') { const sec = opts.sec || 90; p = { prompt: opts.prompt || pick(PROMPTS), sec, end: now + sec * 1000 + 3000, hide: opts.hide !== false, sides: [me, other], revealed: false }; fresh = true; }
    else if (id === 'guess') { const sec = opts.sec || 80; p = { drawer: me, word: pick(WORDS), sec, end: now + sec * 1000, score: 0, round: 1, reveal: null, last: null }; fresh = true; }
    this.app.applyMode(id, p, { fresh });
  }
  set(patch) { this.app.applyMode(this.id, { ...this.p, ...patch }); }

  // ---------------------------------------------------------------- rules
  canDraw() {
    const p = this.p;
    switch (this.id) {
      case 'turns': return this.mine(p.turn) ? '' : `It's ${this.nameOf(p.turn)}'s turn`;
      case 'fold': return p.done ? 'Start a new round to draw again' : this.mine(p.order[p.cur]) ? '' : `${this.nameOf(p.order[p.cur])} is drawing. No peeking!`;
      case 'challenge': return p.revealed ? '' : Date.now() < p.end - p.sec * 1000 ? 'Get ready…' : '';
      case 'guess': return p.reveal ? 'Next round starting…' : this.mine(p.drawer) ? '' : 'Your job is guessing! Type it below the top bar';
      default: return '';
    }
  }
  /** rectangle (doc px) you may draw in, or null */
  clip() {
    const p = this.p, { w, h: H } = this.app.doc;
    if (this.id === 'split' && p.lock) return this._side(this.slotOf(p.sides || []), p.ov || 0);
    if (this.id === 'challenge' && !p.revealed) return this._side(this.slotOf(p.sides || []), 0, { o: 'v', pos: 0.5 });
    if (this.id === 'fold' && !p.done) { const bh = H / p.n, y = p.cur * bh; return [0, y, w, Math.min(H - y, bh + (p.cur < p.n - 1 ? p.peek * H : 0))]; }
    return null;
  }
  _side(slot, ov, q = this.p) {
    const { w, h: H } = this.app.doc, pos = clamp(q.pos || 0.5, 0.05, 0.95);
    if ((q.o || 'v') === 'v') { const x = pos * w, o = ov * w; return slot === 0 ? [0, 0, x + o, H] : [x - o, 0, w - x + o, H]; }
    const y = pos * H, o = ov * H;
    return slot === 0 ? [0, 0, w, y + o] : [0, y - o, w, H - y + o];
  }
  sym() { return this.id === 'mirror' ? this.p.sym || 'v' : null; }
  /** trace mode: the teacher draws on the guide layer, the student never does */
  layerRule() { if (this.id !== 'trace') return null; return this.mine(this.p.teacher) && (!this.solo() || this.app.traceAsTeacher) ? 'guide' : 'noguide'; }

  // ---------------------------------------------------------------- timers
  tick() {
    const p = this.p, now = Date.now();
    if (this.id === 'turns' && p.end && now > p.end) {
      if (this.mine(p.turn) || now > p.end + 4000) this.passTurn();
    } else if (this.id === 'challenge' && !p.revealed && now > p.end) {
      this.set({ revealed: true }); this.app.celebrate('Time! Look what you made 💞');
    } else if (this.id === 'guess' && !p.reveal && p.end && now > p.end && (this.mine(p.drawer) || now > p.end + 4000)) {
      this.set({ reveal: p.word, ok: false, adv: this.me(), at: now });
    } else if (this.id === 'guess' && p.reveal && p.adv === this.me() && now > (p.at || 0) + 2800) this.nextRound();
  }
  passTurn() { const p = this.p, next = p.turn === this.me() ? this.other() : this.me(); this.set({ turn: next, end: Date.now() + p.sec * 1000 }); }
  foldDone() {
    const p = this.p, cur = p.cur + 1;
    if (cur >= p.n) { this.set({ cur: p.n - 1, done: true }); this.app.celebrate('Reveal! 🎉'); }
    else this.set({ cur });
  }
  guess(text, by) {
    const p = this.p;
    if (this.id !== 'guess' || p.reveal) return;
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const ok = norm(text) === norm(p.word) || (norm(text).length > 3 && norm(text) === norm(p.word) + 's');
    if (ok) { this.set({ reveal: p.word, ok: true, score: (p.score || 0) + 1, last: { t: String(text).slice(0, 40), by }, adv: this.me(), at: Date.now() }); this.app.celebrate(`“${p.word}” — correct! 🎉`); }
    else this.set({ last: { t: String(text).slice(0, 40), by } });
  }
  nextRound() {
    const p = this.p, drawer = p.drawer === this.me() ? this.other() : this.me();
    let word = pick(WORDS); while (word === p.word) word = pick(WORDS);
    this.app.clearAllLayers();
    this.set({ drawer, word, end: Date.now() + p.sec * 1000, reveal: null, ok: false, last: null, round: (p.round || 1) + 1, adv: null });
  }

  // ---------------------------------------------------------------- drawing on the canvas
  drawOverlay(ctx, view) {
    const p = this.p, doc = this.app.doc, W = doc.w, H = doc.h, px = 1 / view.s;
    if (this.id === 'split' || (this.id === 'challenge')) {
      const q = this.id === 'split' ? p : { o: 'v', pos: 0.5, lock: true, ov: 0, sides: p.sides || [] };
      const mineSlot = this.slotOf(q.sides || []);
      if (this.id === 'split' && p.ghost) this._ghost(ctx, q, mineSlot);
      if (this.id === 'challenge' && !p.revealed && p.hide && !this.solo()) {
        const r = this._side(1 - mineSlot, 0, q);
        this._cover(ctx, r, px, '🙈', `${this.app.partner.name} is drawing…`);
      } else if (q.lock) { // soft wash over the part that is not mine
        const r = this._side(1 - mineSlot, -(q.ov || 0), q);
        ctx.fillStyle = 'rgba(120, 100, 160, 0.07)'; ctx.fillRect(r[0], r[1], r[2], r[3]);
      }
      // the line
      const v = (q.o || 'v') === 'v', at = (q.pos || 0.5) * (v ? W : H);
      ctx.save();
      ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); if (v) { ctx.moveTo(at, 0); ctx.lineTo(at, H); } else { ctx.moveTo(0, at); ctx.lineTo(W, at); } ctx.stroke();
      ctx.setLineDash([10 * px, 8 * px]); ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(122, 90, 200, 0.75)'; ctx.stroke();
      if (q.lock && q.ov > 0) {
        ctx.setLineDash([3 * px, 6 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = 'rgba(122, 90, 200, 0.45)';
        const o = q.ov * (v ? W : H);
        ctx.beginPath();
        if (v) { ctx.moveTo(at - o, 0); ctx.lineTo(at - o, H); ctx.moveTo(at + o, 0); ctx.lineTo(at + o, H); } else { ctx.moveTo(0, at - o); ctx.lineTo(W, at - o); ctx.moveTo(0, at + o); ctx.lineTo(W, at + o); }
        ctx.stroke();
      }
      ctx.restore();
    } else if (this.id === 'mirror') {
      ctx.save(); ctx.setLineDash([8 * px, 8 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = 'rgba(122, 90, 200, 0.5)';
      symGuides(ctx, p.sym || 'v', W, H);
      ctx.restore();
    } else if (this.id === 'fold') {
      const bh = H / p.n;
      if (!p.done) {
        for (let i = 0; i < p.n; i++) {
          const y = i * bh;
          if (i < p.cur) { // folded away: keep only a peek strip at the bottom of the band just before mine
            const peek = i === p.cur - 1 ? p.peek * H : 0;
            this._cover(ctx, [0, y, W, bh - peek], px, '🙈', `${FOLD_LABELS[p.n][i]} (folded)`);
          } else if (i === p.cur && !this.mine(p.order[i])) this._cover(ctx, [0, y, W, bh], px, '✏️', `${this.nameOf(p.order[i])} is drawing the ${FOLD_LABELS[p.n][i].toLowerCase()}…`);
          else if (i > p.cur) { ctx.fillStyle = 'rgba(120,100,160,0.06)'; ctx.fillRect(0, y, W, bh); }
        }
      }
      ctx.save(); ctx.setLineDash([10 * px, 8 * px]); ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(122, 90, 200, 0.55)';
      for (let i = 1; i < p.n; i++) { ctx.beginPath(); ctx.moveTo(0, i * bh); ctx.lineTo(W, i * bh); ctx.stroke(); }
      ctx.restore();
    }
  }
  _ghost(ctx, q, slot) {
    // the other side, mirrored onto mine at low strength: a guide for drawing the matching half
    const doc = this.app.doc, v = (q.o || 'v') === 'v', at = (q.pos || 0.5) * (v ? doc.w : doc.h);
    const mine = this._side(slot, 0, q);
    ctx.save();
    ctx.beginPath(); ctx.rect(mine[0], mine[1], mine[2], mine[3]); ctx.clip();
    if (v) ctx.transform(-1, 0, 0, 1, 2 * at, 0); else ctx.transform(1, 0, 0, -1, 0, 2 * at);
    ctx.globalAlpha = 0.22;
    for (const L of doc.layerList()) if (L.visible && !L.guide) ctx.drawImage(L.canvas, 0, 0);
    ctx.restore();
  }
  _cover(ctx, r, px, emoji, text) {
    if (r[2] <= 0 || r[3] <= 0) return;
    ctx.save();
    ctx.fillStyle = '#f4efe7'; ctx.fillRect(r[0], r[1], r[2], r[3]);
    ctx.beginPath(); ctx.rect(r[0], r[1], r[2], r[3]); ctx.clip();
    ctx.strokeStyle = 'rgba(160, 140, 190, 0.18)'; ctx.lineWidth = 10;
    for (let x = r[0] - r[3]; x < r[0] + r[2]; x += 34) { ctx.beginPath(); ctx.moveTo(x, r[1] + r[3]); ctx.lineTo(x + r[3], r[1]); ctx.stroke(); }
    const fs = clamp(Math.min(r[2] / 14, r[3] / 5), 14 * px, 46);
    ctx.fillStyle = 'rgba(80, 64, 110, 0.75)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(`${emoji} ${text}`, r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] * 0.92);
    ctx.restore();
  }
  drawScreen(ctx, view) {
    const p = this.p, doc = this.app.doc;
    if (this.id !== 'split' && this.id !== 'challenge') return;
    const q = this.id === 'split' ? p : { o: 'v', pos: 0.5, sides: p.sides || [] };
    const v = (q.o || 'v') === 'v', pos = q.pos || 0.5, slot = this.slotOf(q.sides || []);
    // name tags for each side
    const tags = [0, 1].map((s) => {
      const isMe = s === slot;
      const label = isMe ? 'You' : this.app.partner ? this.app.partner.name : 'Partner';
      const color = isMe ? this.app.me.color : this.app.partner ? this.app.partner.color : '#9b8fb5';
      const cx = v ? (s === 0 ? pos / 2 : (1 + pos) / 2) * doc.w : doc.w / 2;
      const cy = v ? 0 : (s === 0 ? 0 : pos) * doc.h;
      return { label, color, at: view.toScreen(cx, cy) };
    });
    ctx.font = '700 12px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of tags) {
      const w = ctx.measureText(t.label).width + 22, x = t.at[0], y = t.at[1] + 18;
      ctx.save(); ctx.shadowColor = 'rgba(40, 20, 80, 0.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; roundRect(ctx, x - w / 2, y - 11, w, 22, 11); ctx.fill(); ctx.restore();
      ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(x - w / 2 + 10, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b3346'; ctx.fillText(t.label, x + 4, y);
    }
    if (this.id === 'split') { // the drag handle
      const [hx, hy] = this.handleAt(view);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(122, 90, 200, 0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(122, 90, 200, 1)'; ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(v ? '⇔' : '⇕', hx, hy + 1);
    }
  }
  handleAt(view) {
    const p = this.p, doc = this.app.doc, v = (p.o || 'v') === 'v';
    return v ? view.toScreen(p.pos * doc.w, doc.h / 2) : view.toScreen(doc.w / 2, p.pos * doc.h);
  }
  hitHandle(sx, sy, view) {
    if (this.id !== 'split') return false;
    const [hx, hy] = this.handleAt(view);
    return Math.hypot(sx - hx, sy - hy) < 26;
  }
  dragTo(dx, dy) {
    const doc = this.app.doc, v = (this.p.o || 'v') === 'v';
    const pos = Math.round(clamp(v ? dx / doc.w : dy / doc.h, 0.1, 0.9) * 200) / 200;
    if (pos !== this.p.pos) this.set({ pos });
  }

  // ---------------------------------------------------------------- the mode bar
  bar() {
    const p = this.p, id = this.id, info = modeInfo(id), app = this.app;
    const title = h('button', { class: 'mb-title', onclick: () => app.openModes() }, h('span', { class: 'mb-emoji' }, info.emoji), info.name, h('span', { html: icon('down', 14) }));
    const chip = (label, onclick, on, ic) => h('button', { class: 'chip' + (on ? ' on' : ''), onclick }, ic ? h('span', { html: icon(ic, 16) }) : null, label);
    const timer = (end) => h('span', { class: 'timer', 'data-end': String(end) }, fmtTime(end - Date.now()));
    const items = [title];
    if (id === 'free') items.push(h('span', { class: 'mb-hint' }, 'Tap the mode name to play a game'));
    if (id === 'split') {
      items.push(chip('Swap sides', () => this.set({ sides: [...(p.sides || [])].reverse() }), false, 'swap'));
      items.push(chip(p.o === 'h' ? 'Top / bottom' : 'Left / right', () => this.set({ o: p.o === 'h' ? 'v' : 'h' }), false, 'split'));
      items.push(chip(p.lock ? 'Stay on my side' : 'Draw anywhere', () => this.set({ lock: !p.lock }), p.lock, p.lock ? 'lock' : 'unlock'));
      if (p.lock) {
        const sel = h('select', { class: 'chip-select', onchange: (e) => this.set({ ov: +e.target.value }) },
          [[0, 'No overlap'], [0.02, 'Small overlap'], [0.05, 'Medium overlap'], [0.1, 'Big overlap'], [0.2, 'Huge overlap']].map(([v, l]) => h('option', { value: v, selected: Math.abs((p.ov || 0) - v) < 1e-6 }, l)));
        items.push(sel);
      }
      items.push(chip('Mirror ghost', () => this.set({ ghost: !p.ghost }), p.ghost, 'mirror'));
      items.push(chip('Center line', () => this.set({ pos: 0.5 }), false));
    }
    if (id === 'mirror') {
      const sel = h('select', { class: 'chip-select', onchange: (e) => this.set({ sym: e.target.value }) }, SYMS.map(([v, l]) => h('option', { value: v, selected: v === p.sym }, l)));
      items.push(sel);
    }
    if (id === 'trace') {
      const teacher = this.mine(p.teacher) && !this.solo();
      items.push(h('span', { class: 'mb-hint' }, this.solo() ? (app.traceAsTeacher ? 'Drawing guide lines' : 'Tracing') : teacher ? 'You teach: draw light guide lines' : `Trace ${this.nameOf(p.teacher)}'s blue lines`));
      if (this.solo()) items.push(chip(app.traceAsTeacher ? 'Switch to tracing' : 'Draw guide lines', () => { app.traceAsTeacher = !app.traceAsTeacher; app.refreshModeBar(); }));
      items.push(chip(app.guideHidden ? 'Show guide' : 'Hide guide', () => { app.guideHidden = !app.guideHidden; app.view.request(); app.refreshModeBar(); }, app.guideHidden, app.guideHidden ? 'eyeoff' : 'eye'));
      if (!this.solo()) items.push(chip('Swap roles', () => this.set({ teacher: p.teacher === this.me() ? this.other() : this.me() }), false, 'swap'));
      items.push(chip('Clear guide', () => app.clearGuide(), false, 'trash'));
    }
    if (id === 'turns') {
      const mine = this.mine(p.turn);
      items.push(h('span', { class: 'mb-state' + (mine ? ' go' : '') }, mine ? 'Your turn!' : `${this.nameOf(p.turn)}'s turn`), timer(p.end));
      if (mine && !this.solo()) items.push(chip('Pass', () => this.passTurn(), true, 'right'));
      const sel = h('select', { class: 'chip-select', onchange: (e) => this.set({ sec: +e.target.value, end: Date.now() + +e.target.value * 1000 }) }, [10, 20, 30, 60, 120].map((s) => h('option', { value: s, selected: s === p.sec }, s + ' s turns')));
      items.push(sel);
    }
    if (id === 'fold') {
      const label = FOLD_LABELS[p.n][p.cur];
      if (p.done) items.push(h('span', { class: 'mb-state go' }, 'Revealed! 🎉'), chip('Play again', () => this.start('fold', { n: p.n }), true, 'sparkles'));
      else if (this.mine(p.order[p.cur])) items.push(h('span', { class: 'mb-state go' }, `Your turn: draw the ${label.toLowerCase()}`), chip(p.cur === p.n - 1 ? 'Done: reveal!' : 'Done, fold it', () => this.foldDone(), true, 'check'));
      else items.push(h('span', { class: 'mb-state' }, `${this.nameOf(p.order[p.cur])} is drawing the ${label.toLowerCase()}…`));
      items.push(h('span', { class: 'mb-hint' }, `Part ${Math.min(p.cur + 1, p.n)} of ${p.n}`));
    }
    if (id === 'challenge') {
      items.push(h('span', { class: 'mb-prompt' }, '“' + p.prompt + '”'));
      if (!p.revealed) { items.push(timer(p.end)); items.push(chip('Reveal now', () => { this.set({ revealed: true }); app.celebrate('Reveal! 💞'); }, false, 'eye')); }
      else items.push(chip('New prompt', () => this.start('challenge', { sec: p.sec, hide: p.hide }), true, 'sparkles'));
    }
    if (id === 'guess') {
      const drawing = this.mine(p.drawer);
      items.push(h('span', { class: 'mb-score' }, `⭐ ${p.score || 0}`));
      if (p.reveal) items.push(h('span', { class: 'mb-state go' }, p.ok ? `Correct: ${p.reveal}!` : `It was “${p.reveal}”`));
      else if (drawing) {
        items.push(h('span', { class: 'mb-state go' }, 'Draw: ', h('b', {}, p.word.toUpperCase())), timer(p.end));
        items.push(chip('Skip word', () => { let word = pick(WORDS); while (word === p.word) word = pick(WORDS); app.clearAllLayers(); this.set({ word, end: Date.now() + p.sec * 1000 }); }, false, 'right'));
        if (this.solo()) items.push(h('span', { class: 'mb-hint' }, '(invite your partner to guess)'));
      } else {
        const hint = p.word.split('').map((c) => (c === ' ' ? '  ' : '_')).join(' ');
        const inp = h('input', { class: 'guess-in', placeholder: 'Your guess…', maxlength: 40, autocomplete: 'off', autocapitalize: 'off' });
        const send = () => { const t = inp.value.trim(); if (!t) return; app.sendGuess(t); inp.value = ''; inp.focus(); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); e.stopPropagation(); });
        items.push(h('span', { class: 'mb-hint mono' }, hint), timer(p.end), inp, chip('Guess', send, true, 'send'));
      }
      if (p.last && !p.reveal) items.push(h('span', { class: 'mb-hint' }, `last guess: “${p.last.t}”`));
    }
    return items;
  }
}

export function symGuides(ctx, sym, W, H) {
  const cx = W / 2, cy = H / 2;
  ctx.beginPath();
  if (sym === 'v' || sym === 'q') { ctx.moveTo(cx, 0); ctx.lineTo(cx, H); }
  if (sym === 'h' || sym === 'q') { ctx.moveTo(0, cy); ctx.lineTo(W, cy); }
  const m = /^[rk](\d+)$/.exec(sym || '');
  if (m) { const n = +m[1], R = Math.hypot(W, H); for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n - Math.PI / 2; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } }
  ctx.stroke();
}
export function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
