// Doodle Duet: the app. Wires the canvas, tools, the shared drawing, the connection and the UI together.
import { h, clamp, rid, seed32, debounce, fmtTime, rgbToHex, makeCanvas, loadImage, q1 } from './util.js';
import { icon } from './icons.js';
import { Doc, stripOp } from './doc.js';
import { StrokeRenderer, bbRect, brushOf } from './brushes.js';
import { computeFill } from './fill.js';
import { View } from './view.js';
import { Input } from './input.js';
import { Modes, symGuides, roundRect } from './modes.js';
import { Session } from './net/session.js';
import { makeCode, parseCode } from './net/transport.js';
import { makeRelayKey, parseRelayKey } from './net/relaykey.js';
import { store, prefs } from './store.js';
import { getImage, aspectOf } from './library.js';
import { slider, openPop, closePop, popOpenFor, popIsOpen, closeSheet, sheetOpen, toast } from './ui/widgets.js';
import { colorPanel } from './ui/color.js';
import { brushPanel, shapePanel, fillPanel, layersPanel, modesSheet, inviteSheet, gallerySheet, newDocSheet, settingsSheet, helpSheet, textEditor, PLAYER_COLORS } from './ui/panels.js';
import { Ideas } from './ui/rails.js';
import { openReplay } from './replay.js';

const DEFAULTS = {
  brush: 'pen', eraser: 'eraser', color: '#2f2940', recent: ['#2f2940', '#ff5fa2', '#3d8bff', '#ffd84d'], bs: {},
  shape: 'ellipse', shapeFill: false, fillTol: 18, fillAll: true, sym: null, font: 'round', textSize: 72,
  finger: 'auto', rotate: true, simPressure: true, pressureCurve: 'normal', quickShape: true, showCursor: true, rails: true, grid: 'none', theme: 'auto',
};
const TOOLS = [
  ['brush', 'Brush', 'brush', 'B', true], ['eraser', 'Erase', 'eraser', 'E', true], ['fill', 'Fill', 'bucket', 'G', true], ['shape', 'Shapes', 'shapes', 'U', true],
  ['text', 'Text', 'text', 'T'], ['pick', 'Pick', 'pipette', 'I'], ['laser', 'Point', 'laser', 'L'], ['hand', 'Move', 'hand', 'H'],
];
const REACTIONS = ['❤️', '😍', '🥰', '😂', '👏', '🔥', '✨', '😮', '🥺', '👍', '🎉', '💯'];
const GAMMA = { light: 0.6, normal: 0.85, firm: 1.25 };
const coarse = matchMedia('(pointer: coarse)').matches;

class App {
  constructor() {
    let me = prefs.get('profile', null);
    if (!me || !me.id) me = { id: rid(8), name: '', color: PLAYER_COLORS[Math.random() < 0.5 ? 0 : 1] };
    this.me = me; prefs.set('profile', me);
    this.settings = { ...DEFAULTS, ...prefs.get('settings', {}) };
    this.settings.bs = this.settings.bs || {};
    this.ctr = prefs.get('ctr', 0);
    this.room = this.loadRoom();
    this.tool = 'brush'; this.prevTool = 'brush'; this.layerId = null; this.partner = null; this.partnerLayer = null;
    this.live = new Map(); this.pool = []; this.myOps = []; this.redoStack = [];
    this.photos = new Map(); this.photoList = []; this.askedPhotos = new Set();
    this.lasers = []; this.pc = null; this.hover = null; this.pickPt = null; this.pickSample = null;
    this.refsHidden = false; this.guideHidden = false; this.traceAsTeacher = true;
    this.outPts = new Map(); this.ptsQueued = false; this.replaceOut = new Map(); this.laserOut = []; this.lastCele = 0;
    this.saveSoon = debounce(() => this.saveNow(), 2500);
    this.layersSoon = debounce(() => this.layersPanelRefresh && this.layersPanelRefresh(), 400);
    this.metaSoon = new Map();
    this.applySettings(true);
    this.view = new View(document.getElementById('view'), this);
    this.modes = new Modes(this);
    this.net = new Session({
      me: () => ({ id: this.me.id, name: this.me.name || 'Friend', color: this.me.color }),
      onPartner: (p) => this.onPartner(p),
      onLeave: (p) => this.onLeave(p),
      onMessage: (m) => { try { this.onMessage(m); } catch (e) { console.warn('message failed', m && m.t, e); } },
      onState: () => { this.refreshTop(); if (this.inviteRefresh) this.inviteRefresh(); },
      onMismatch: () => toast('Your partner has a different version of the app. Reload both if anything acts strange.', 4000),
    });
    this.buildUI();
    this.input = new Input(this, this.view.cv);
    this.ideas = new Ideas(this);
    this.keyboard();
    window.addEventListener('resize', () => this.layout());
    setInterval(() => this.tick(), 250);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); else if (this.partner) this.wake(true); });
    window.addEventListener('pagehide', () => { this.saveNow(); this.net.bye(); });
    this.boot();
  }

  async boot() {
    try { this.photoList = await store.listPhotos(); for (const p of this.photoList) this.photos.set(p.id, p.data); this.ideas.refresh(); } catch (e) { /* storage blocked */ }
    let doc = null;
    const id = prefs.get('doc', null);
    if (id) { try { const d = await store.loadDoc(id); if (d) doc = Doc.fromData(d); } catch (e) { console.warn('could not load drawing', e); } }
    this.setDoc(doc || this.blankDoc({}));
    this.layout();
    if (!this.me.name) this.welcome(); else this.net.start(this.room);
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !navigator.webdriver) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ================================================================ room + profile
  loadRoom() {
    let room = prefs.get('room', null);
    const m = /[#&]r=([A-Za-z0-9]{4,8})(?:\.([A-Za-z0-9]{16}))?/.exec(location.hash);
    if (m) {
      const code = parseCode(m[1]), key = m[2] ? parseRelayKey(m[2]) : null;
      if (code) { room = { code, key }; this.joinedViaLink = true; prefs.set('room', room); }
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!room || !room.code) { room = { code: makeCode(5), key: makeRelayKey() }; prefs.set('room', room); }
    return room;
  }
  inviteLink() { return `${location.origin}${location.pathname}#r=${this.room.code}${this.room.key ? '.' + this.room.key : ''}`; }
  joinCode(text) {
    const code = parseCode(text);
    if (!code) { toast('That code does not look right (5 letters and numbers)'); return false; }
    if (code === this.room.code) { toast('That is already your room. Send your partner the link!'); return false; }
    this.room = { code, key: null }; prefs.set('room', this.room);
    this.net.start(this.room); toast('Joining ' + code + '…');
    return true;
  }
  newRoom() { this.room = { code: makeCode(5), key: makeRelayKey() }; prefs.set('room', this.room); this.net.start(this.room); }
  setProfile(patch) {
    Object.assign(this.me, patch); prefs.set('profile', this.me);
    this.send({ t: 'me', name: this.me.name, color: this.me.color });
    this.refreshTop(); this.refreshModeBar(); this.view.request();
  }
  welcome() {
    let color = this.me.color;
    const name = h('input', { class: 'field', placeholder: 'Your name', maxlength: 24, value: this.me.name || '', style: 'text-align:center', autocomplete: 'given-name' });
    const colors = h('div', { class: 'colors' });
    const paint = () => colors.replaceChildren(...PLAYER_COLORS.map((c) => h('button', { class: c === color ? 'on' : '', style: { background: c }, 'aria-label': 'Colour ' + c, onclick: () => { color = c; paint(); } })));
    paint();
    const go = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); name.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 }); return; }
      this.me.name = n; this.me.color = color; prefs.set('profile', this.me);
      el.remove(); this.refreshTop(); this.net.start(this.room);
      if (!this.joinedViaLink) setTimeout(() => toast('Tap “Invite” to draw with your partner 💞', 3500), 600);
    };
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    const el = h('div', { id: 'welcome' }, h('div', { class: 'wcard' },
      h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }), h('h1', {}, 'Doodle Duet'),
      h('p', {}, this.joinedViaLink ? 'Your partner invited you to draw together. What should they call you?' : 'Draw together in real time on Mac, iPad and phone. Help each other, play games, learn to draw.'),
      name, h('div', { class: 'small', style: 'margin-top:14px;font-weight:800' }, 'Your colour'), colors,
      h('button', { class: 'btn pri', style: 'width:100%;height:52px;font-size:17px', onclick: go }, this.joinedViaLink ? 'Join and draw 💞' : 'Start drawing')));
    document.body.append(el);
    setTimeout(() => name.focus(), 100);
  }

  // ================================================================ connection
  onPartner(p) {
    this.partner = p;
    toast(`${p.name} is here! 💞`);
    this.sendSync(false);
    this.refreshTop(); this.refreshModeBar(); this.wake(true);
    if (this.inviteRefresh) this.inviteRefresh();
  }
  onLeave(p) {
    this.partner = null; this.pc = null; this.partnerLayer = null;
    this.dropRemoteLives();
    toast(`${p.name} left. They can come back any time.`);
    this.refreshTop(); this.refreshModeBar(); this.wake(false); this.view.request();
    if (this.inviteRefresh) this.inviteRefresh();
  }
  send(m) { return this.net.send(m); }
  toast(text, ms) { toast(text, ms); }
  sendSync(force) {
    const d = this.doc;
    this.lastSync = { n: d.opCount, up: d.updated };
    this.send({ t: 'sync', d: d.id, meta: d.metaRecord(), have: d.have(), n: d.opCount, up: d.updated, force: !!force, key: this.room.key });
  }
  sendMeta(k, v) { this.send({ t: 'meta', d: this.doc.id, k, v }); }
  sendMetaSoon(k, v) {
    if (this.metaSoon.has(k)) { this.metaSoon.get(k).v = v; return; }
    const e = { v };
    this.metaSoon.set(k, e);
    setTimeout(() => { this.metaSoon.delete(k); this.sendMeta(k, e.v); }, this.net.lowRate ? 120 : 50);
  }
  onSync(m) {
    if (m.key && !this.room.key && parseRelayKey(m.key)) { this.room.key = parseRelayKey(m.key); prefs.set('room', this.room); }
    const d = this.doc;
    if (m.d === d.id) {
      d.mergeMeta(m.meta);
      const miss = d.missingFor(m.have || {});
      if (miss.length) this.send({ t: 'ops', d: d.id, ops: miss });
      this.afterRemote(true);
      return;
    }
    const mine = this.lastSync || { n: d.opCount, up: d.updated };
    let iWin;
    if (m.force) iWin = false;
    else if (mine.n === 0 && m.n > 0) iWin = false;
    else if (mine.n > 0 && m.n === 0) iWin = true;
    else if (mine.up !== m.up) iWin = mine.up > m.up;
    else iWin = this.net.role === 'host';
    if (iWin) return; // they switch to this drawing and send a fresh sync
    const had = d.opCount > 0;
    this.saveNow();
    this.setDoc(Doc.fromData({ ...m.meta, ops: [] }), { quiet: true });
    this.sendSync(false);
    if (had && this.partner) toast(`Switched to ${this.partner.name}'s drawing. Yours is in the Gallery.`, 3500);
  }
  onMessage(m) {
    const d = this.doc, same = m.d === d.id;
    switch (m.t) {
      case 'sync': this.onSync(m); break;
      case 'ops': if (same && Array.isArray(m.ops)) { d.commitMany(m.ops); this.afterRemote(true); } break;
      case 'need': if (same) { const ops = (m.ids || []).map((id) => d.ops.get(id)).filter(Boolean).map(stripOp); if (ops.length) this.send({ t: 'ops', d: d.id, ops }); } break;
      case 'meta': if (same) this.mergeMetaMsg(m.k, m.v); break;
      case 'u': if (same) { d.setUndone(m.i, !!m.u, m.uv); this.afterRemote(); } break;
      case 'op': if (same && m.o) { d.commit(m.o); this.afterRemote(); } break;
      case 'ls': if (same) this.remoteLiveStart(m.o); break;
      case 'lp': this.remoteLivePoints(m); break;
      case 'lr': this.remoteLiveReplace(m); break;
      case 'le': this.remoteLiveEnd(m); break;
      case 'lc': { const lv = this.live.get(m.i); if (lv && lv.who === 'partner') { this.live.delete(m.i); this._release(lv); this.view.request(); } break; }
      case 'cur': if (same) { this.pc = { x: m.x, y: m.y, t: performance.now(), dr: !!m.dr, z: m.z, tool: m.tool }; if (m.l) this.partnerLayer = m.l; this.view.request(); } break;
      case 'lz': if (same) this.addLaser('p', m.p, !!m.s); break;
      case 'react': this.floatEmoji(String(m.e).slice(0, 8), true); break;
      case 'cele': if (Date.now() - this.lastCele > 2500) this.celebrate(String(m.text).slice(0, 80), true); break;
      case 'card': if (typeof m.src === 'string') { this.ideas.openCard(m.src, { from: this.partner ? this.partner.name : 'partner' }); toast(`${this.partner ? this.partner.name : 'Your partner'} shared a picture`); } break;
      case 'photo': this.receivePhoto(m); break;
      case 'needph': this.sendPhoto(m.id); break;
      case 'me': if (this.partner) { if (m.name) this.partner.name = String(m.name).slice(0, 24); if (m.color) this.partner.color = String(m.color); this.refreshTop(); this.view.request(); } break;
      default: break;
    }
  }
  mergeMetaMsg(k, v) {
    const d = this.doc;
    let changed = false;
    if (k === 'layer') changed = d.mergeLayer(v);
    else if (k === 'order') changed = d.mergeOrder(v);
    else if (k === 'bg' || k === 'refs' || k === 'mode') changed = d.mergeRec(k, v);
    if (changed) this.afterRemote(true);
  }
  afterRemote(meta) {
    if (meta) { this.fixLayer(); this.refreshModeBar(); if (this.layersPanelRefresh) this.layersPanelRefresh(); }
    else this.layersSoon();
    this.refreshUndo();
    this.view.request();
  }
  wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !this.wl) navigator.wakeLock.request('screen').then((w) => { this.wl = w; w.addEventListener('release', () => { this.wl = null; }); }).catch(() => {});
      else if (!on && this.wl) { this.wl.release(); this.wl = null; }
    } catch (e) { /* not supported */ }
  }

  // ================================================================ the drawing
  blankDoc({ w = 1600, h: hh = 1600, bg = '#ffffff' }) {
    const d = new Doc({ w, h: hh, bg: { c: bg } });
    d.addLayer({ name: 'Layer 1' }, this.me.id);
    d.updated = d.created;
    return d;
  }
  setDoc(doc, { quiet = false } = {}) {
    for (const lv of this.live.values()) this._release(lv);
    this.live.clear(); this.pool = []; this.pickSample = null;
    if (this.input && this.input.act) this.input.act = null;
    this.doc = doc;
    doc.onChange = (what) => this.onDocChange(what);
    this.myOps = [...doc.ops.values()].filter((o) => o.a === this.me.id).sort((a, b) => a.k - b.k).map((o) => o.id);
    this.redoStack = [];
    this.layerId = null; this.fixLayer();
    prefs.set('doc', doc.id);
    this.view.fit();
    this.refreshModeBar(); this.refreshUndo(); this.refreshSliders();
    if (this.layersPanelRefresh) this.layersPanelRefresh();
    void quiet;
  }
  onDocChange(what) {
    if (what === 'mode') this.refreshModeBar();
    if (what === 'layers') { this.fixLayer(); this.layersSoon(); }
    if (what === 'refs' && this.layersPanelRefresh) this.layersSoon();
    this.saveSoon();
    this.view.request();
  }
  newDoc(opts = {}, announce = true) {
    this.saveNow();
    const d = this.doc;
    this.setDoc(this.blankDoc({ w: opts.w || d.w, h: opts.h || d.h, bg: opts.bg || d.bg.c }));
    if (announce) this.sendSync(true);
  }
  async openDoc(id) {
    await this.saveNow();
    const data = await store.loadDoc(id).catch(() => null);
    if (!data) { toast('Could not open that drawing'); return; }
    this.setDoc(Doc.fromData(data));
    this.doc.updated = Date.now();
    this.sendSync(true);
    if (this.partner) toast(`Opened for both of you`);
  }
  async saveNow() {
    const d = this.doc;
    if (!d || (d.opCount === 0 && !(d.refs.list || []).length)) return;
    if (this._savedAt === d.updated && this._savedId === d.id) return;
    this._savedAt = d.updated; this._savedId = d.id;
    try {
      const s = 256 / Math.max(d.w, d.h);
      const thumb = d.flatten({ scale: s }).toDataURL('image/jpeg', 0.82);
      await store.saveDoc(d.serialize(), thumb);
    } catch (e) { console.warn('save failed', e); }
  }

  // ================================================================ layers
  fixLayer() {
    const list = this.doc.layerList();
    const rule = this.modes.layerRule();
    let L = this.doc.layers.get(this.layerId);
    if (!L || L.del || (rule === 'noguide' && L.guide)) L = [...list].reverse().find((x) => !x.guide) || list[list.length - 1] || null;
    this.layerId = L ? L.id : null;
  }
  targetLayer() {
    const rule = this.modes.layerRule();
    if (rule === 'guide') return this.ensureGuideLayer();
    this.fixLayer();
    return this.doc.layers.get(this.layerId) || null;
  }
  selectLayer(id) { this.layerId = id; this.fixLayer(); }
  addLayer() {
    const d = this.doc, list = d.layerList(), idx = list.findIndex((l) => l.id === this.layerId);
    const n = list.filter((l) => !l.guide).length + 1;
    const ids = d.order.ids.filter((id) => { const L = d.layers.get(id); return L && !L.del; });
    const at = idx >= 0 ? d.order.ids.indexOf(list[idx].id) + 1 : ids.length;
    const L = d.addLayer({ name: 'Layer ' + n, at }, this.me.id);
    this.layerId = L.id;
    this.sendMeta('layer', L.meta()); this.sendMeta('order', d.order);
  }
  deleteLayer() {
    const d = this.doc, L = d.layers.get(this.layerId);
    if (!L || d.layerList().length <= 1) return;
    this.sendMeta('layer', d.updateLayer(L.id, { del: true }, this.me.id));
    this.fixLayer();
    if (this.layersPanelRefresh) this.layersPanelRefresh();
  }
  moveLayer(dir) {
    const d = this.doc, list = d.layerList(), i = list.findIndex((l) => l.id === this.layerId), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const ids = d.order.ids.slice(), a = ids.indexOf(list[i].id), b = ids.indexOf(list[j].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    this.sendMeta('order', d.setOrder(ids, this.me.id));
  }
  layerUpdate(id, patch, quiet) {
    const meta = this.doc.updateLayer(id, patch, this.me.id);
    if (!meta) return;
    if (quiet) this.sendMetaSoon('layer', meta); else { this.sendMeta('layer', meta); if (this.layersPanelRefresh) this.layersPanelRefresh(); }
    this.view.request();
  }
  setPaper(c) { this.sendMeta('bg', this.doc.setRec('bg', { c }, this.me.id)); }
  ensureGuideLayer() {
    const d = this.doc;
    let L = d.layerList().find((l) => l.guide);
    if (!L) { L = d.addLayer({ name: 'Guide', guide: true }, this.me.id); this.sendMeta('layer', L.meta()); this.sendMeta('order', d.order); }
    return L;
  }
  clearLayer() { const L = this.targetLayer(); if (L) this.commitLocal({ t: 'c', l: L.id }); }
  clearGuide() { const L = this.doc.layerList().find((l) => l.guide); if (L) this.commitLocal({ t: 'c', l: L.id }); }
  clearAllLayers() { for (const L of this.doc.layerList()) if (!L.guide && L.ops.length) this.commitLocal({ t: 'c', l: L.id }); }

  // ================================================================ ops, undo
  newId() { this.ctr++; prefs.set('ctr', this.ctr); return this.me.id + '.' + this.ctr.toString(36); }
  commitLocal(op) {
    op.id = op.id || this.newId(); op.a = this.me.id; op.k = this.doc.nextK();
    this.doc.commit(op);
    this.myOps.push(op.id); this.redoStack.length = 0;
    this.send({ t: 'op', d: this.doc.id, o: stripOp(op) });
    this.afterLocal();
  }
  afterLocal() { this.refreshUndo(); this.layersSoon(); this.view.request(); }
  undo() {
    const d = this.doc;
    for (let i = this.myOps.length - 1; i >= 0; i--) {
      const op = d.ops.get(this.myOps[i]);
      if (!op) { this.myOps.splice(i, 1); continue; }
      if (op.u) continue;
      if (!d.canUndo(op)) { toast('That is too far back to undo'); return; }
      const uv = (op.uv || 0) + 1;
      d.setUndone(op.id, true, uv);
      this.send({ t: 'u', d: d.id, i: op.id, u: 1, uv });
      this.redoStack.push(op.id);
      this.afterLocal();
      return;
    }
    toast('Nothing of yours to undo');
  }
  redo() {
    const d = this.doc;
    while (this.redoStack.length) {
      const op = d.ops.get(this.redoStack.pop());
      if (!op || !op.u) continue;
      const uv = (op.uv || 0) + 1;
      d.setUndone(op.id, false, uv);
      this.send({ t: 'u', d: d.id, i: op.id, u: 0, uv });
      this.afterLocal();
      return;
    }
  }
  refreshUndo() {
    if (!this.undoBtn) return;
    const d = this.doc;
    this.undoBtn.disabled = !this.myOps.some((id) => { const o = d.ops.get(id); return o && !o.u; });
    this.redoBtn.disabled = !this.redoStack.length;
  }

  // ================================================================ live strokes (yours + your partner's)
  _scratch() {
    const d = this.doc;
    let c = this.pool.pop();
    if (!c || c.width !== d.w || c.height !== d.h) c = makeCanvas(d.w, d.h);
    return c;
  }
  _release(lv) {
    const x = lv.ctx;
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.clearRect(0, 0, lv.canvas.width, lv.canvas.height);
    if (this.doc && lv.canvas.width === this.doc.w && lv.canvas.height === this.doc.h && this.pool.length < 3) this.pool.push(lv.canvas);
  }
  _liveEntry(op, who) {
    const canvas = this._scratch(), ctx = canvas.getContext('2d');
    const lv = { op, who, canvas, ctx, r: new StrokeRenderer(op, ctx), rect: null, pts: [], finished: false };
    this.live.set(op.id, lv);
    return lv;
  }
  liveList() { return [...this.live.values()]; }
  dropRemoteLives() { for (const [id, lv] of this.live) if (lv.who === 'partner') { this.live.delete(id); this._release(lv); } }
  makeStrokeOp(eraser) {
    const L = this.targetLayer();
    if (!L) { toast('Add a layer first'); return null; }
    if (!L.visible) { toast('This layer is hidden. Show it in Layers.'); return null; }
    const b = eraser ? this.settings.eraser : this.settings.brush, bs = this.bsOf(b);
    const op = { id: this.newId(), a: this.me.id, t: 's', l: L.id, b, c: this.settings.color, z: Math.round(bs.z * 10) / 10, o: Math.round(bs.o * 100) / 100, sd: seed32() };
    const sym = this.modes.sym() || this.settings.sym;
    if (sym) op.sym = sym;
    const cl = this.modes.clip();
    if (cl) op.cl = cl.map((v) => Math.round(v));
    return op;
  }
  liveBegin(a) {
    a.lv = this._liveEntry(a.op, 'me');
    this.send({ t: 'ls', d: this.doc.id, o: { ...a.op } });
  }
  liveFlush(a) {
    const lv = a.lv;
    if (!lv || !a.pend.length) return;
    lv.r.add(a.pend);
    lv.rect = bbRect(lv.r.bb, this.doc.w, this.doc.h);
    if (this.partner) {
      const q = this.outPts.get(a.op.id);
      if (q) q.push(...a.pend); else this.outPts.set(a.op.id, a.pend.slice());
      if (!this.ptsQueued) {
        this.ptsQueued = true;
        if (this.net.lowRate) setTimeout(() => this.flushPts(), 95); else queueMicrotask(() => this.flushPts());
      }
    }
    a.pend = [];
    this.view.request();
  }
  flushPts() {
    this.ptsQueued = false;
    for (const [i, p] of this.outPts) this.send({ t: 'lp', i, p });
    this.outPts.clear();
  }
  liveReplace(a) {
    const lv = a.lv;
    if (!lv) return;
    lv.ctx.setTransform(1, 0, 0, 1, 0, 0); lv.ctx.clearRect(0, 0, lv.canvas.width, lv.canvas.height);
    lv.r = new StrokeRenderer(a.op, lv.ctx); lv.r.add(a.pts); lv.r.finish(); lv.finished = true;
    lv.rect = bbRect(lv.r.bb, this.doc.w, this.doc.h);
    a.pend = [];
    this.outPts.delete(a.op.id);
    if (this.partner) {
      const id = a.op.id, fresh = !this.replaceOut.has(id);
      this.replaceOut.set(id, { t: 'lr', i: id, p: a.pts, ln: a.op.ln, f: a.op.f });
      if (fresh) setTimeout(() => this.flushReplace(id), this.net.lowRate ? 90 : 16);
    }
    this.view.request();
  }
  flushReplace(id) { const m = this.replaceOut.get(id); if (m) { this.replaceOut.delete(id); this.send(m); } }
  liveEnd(a) {
    const lv = a.lv;
    if (!lv) return;
    if (!a.pts.length) { this.liveCancel(a); return; }
    this.flushPts(); this.flushReplace(a.op.id);
    if (!lv.finished) lv.r.finish();
    lv.rect = bbRect(lv.r.bb, this.doc.w, this.doc.h);
    const op = a.op;
    op.p = a.pts; op.k = this.doc.nextK();
    this.live.delete(op.id);
    this.doc.commit(op, { canvas: lv.canvas, rect: lv.rect });
    this._release(lv);
    this.myOps.push(op.id); this.redoStack.length = 0;
    this.send({ t: 'le', d: this.doc.id, i: op.id, k: op.k, n: op.p.length / 3 });
    this.afterLocal();
  }
  liveCancel(a) {
    const lv = a.lv;
    if (!lv) return;
    clearTimeout(a.holdT);
    this.live.delete(a.op.id); this.outPts.delete(a.op.id); this.replaceOut.delete(a.op.id);
    this._release(lv);
    this.send({ t: 'lc', i: a.op.id });
    this.view.request();
  }
  remoteLiveStart(o) {
    if (!o || !o.id || this.live.has(o.id) || this.doc.ops.has(o.id) || !o.l) return;
    const op = { ...o }; delete op.p;
    this._liveEntry(op, 'partner');
    this.partnerLayer = op.l;
  }
  remoteLivePoints(m) {
    const lv = this.live.get(m.i);
    if (!lv || lv.who !== 'partner' || !Array.isArray(m.p) || m.p.length < 3) return;
    for (const v of m.p) lv.pts.push(v);
    lv.r.add(m.p);
    lv.rect = bbRect(lv.r.bb, this.doc.w, this.doc.h);
    const n = m.p.length;
    this.pc = { x: m.p[n - 3], y: m.p[n - 2], t: performance.now(), dr: true, z: lv.op.z, tool: brushOf(lv.op.b).erase ? 'eraser' : 'brush' };
    this.view.request();
  }
  remoteLiveReplace(m) {
    const lv = this.live.get(m.i);
    if (!lv || lv.who !== 'partner' || !Array.isArray(m.p)) return;
    if (m.ln) lv.op.ln = 1; if (m.f) lv.op.f = 1;
    lv.pts = m.p.slice();
    lv.ctx.setTransform(1, 0, 0, 1, 0, 0); lv.ctx.clearRect(0, 0, lv.canvas.width, lv.canvas.height);
    lv.r = new StrokeRenderer(lv.op, lv.ctx); lv.r.add(lv.pts); lv.r.finish(); lv.finished = true;
    lv.rect = bbRect(lv.r.bb, this.doc.w, this.doc.h);
    const n = lv.pts.length;
    if (n >= 3) this.pc = { x: lv.pts[n - 3], y: lv.pts[n - 2], t: performance.now(), dr: true, z: lv.op.z, tool: 'shape' };
    this.view.request();
  }
  remoteLiveEnd(m) {
    const lv = this.live.get(m.i), d = this.doc;
    if (!lv || lv.who !== 'partner') { if (m.d === d.id && !d.ops.has(m.i)) this.send({ t: 'need', d: d.id, ids: [m.i] }); return; }
    this.live.delete(m.i);
    if (m.d !== d.id || lv.pts.length / 3 !== m.n) { this._release(lv); if (m.d === d.id) this.send({ t: 'need', d: d.id, ids: [m.i] }); return; }
    if (!lv.finished) lv.r.finish();
    lv.rect = bbRect(lv.r.bb, d.w, d.h);
    d.commit({ ...lv.op, p: lv.pts, k: m.k }, { canvas: lv.canvas, rect: lv.rect });
    this._release(lv);
    if (this.pc) this.pc.dr = false;
    this.afterRemote();
  }

  // ================================================================ tools
  drawBlocked() { return this.modes.canDraw(); }
  curBrushId() { return this.tool === 'eraser' ? this.settings.eraser : this.settings.brush; }
  bsOf(id) { const B = brushOf(id), s = this.settings.bs[id] || {}; return { z: s.z === undefined ? B.def.z : s.z, o: s.o === undefined ? B.def.o : s.o }; }
  smoothingFor(id) { const s = this.settings.bs[id]; return s && s.sm !== undefined ? s.sm : brushOf(id).smooth; }
  pressure(p) { if (!(p > 0)) p = 0.5; return clamp(Math.pow(p, GAMMA[this.settings.pressureCurve] || 0.85), 0.03, 1); }
  fingerDraws(penSeen) { const f = this.settings.finger; return f === 'on' || (f === 'auto' && !penSeen); }
  setBrushProp(k, v, fromSlider) {
    const id = this.curBrushId();
    this.settings.bs[id] = { ...(this.settings.bs[id] || {}), [k]: v };
    this.refreshDot();
    if (!fromSlider) this.refreshSliders();
    this.saveSettingsSoon();
  }
  chooseBrush(id, eraser) { this.settings[eraser ? 'eraser' : 'brush'] = id; this.saveSettings(); this.setTool(eraser ? 'eraser' : 'brush'); }
  setTool(t) {
    if (t !== this.tool && ['brush', 'eraser', 'shape', 'fill', 'text'].includes(this.tool)) this.prevTool = this.tool;
    this.tool = t;
    for (const [id, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', id === t);
    this.view.cv.style.cursor = t === 'hand' || t === 'adjust' ? 'grab' : 'crosshair';
    this.refreshSliders();
    this.view.request();
  }
  setColor(c, final) {
    this.settings.color = c;
    if (final) { this.settings.recent = [c, ...(this.settings.recent || []).filter((x) => x !== c)].slice(0, 12); this.saveSettings(); }
    this.refreshColor();
  }
  fillAt(x, y) {
    const why = this.drawBlocked();
    if (why) { toast(why); return; }
    const d = this.doc, L = this.targetLayer();
    if (!L || !L.visible) { toast('Pick a visible layer first'); return; }
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const res = computeFill(this.settings.fillAll ? d.sample() : d.sample(L.id), x, y, this.settings.fillTol, this.modes.clip());
    if (!res) { toast('Fill inside your area'); return; }
    this.commitLocal({ t: 'f', l: L.id, c: this.settings.color, o: 1, r: res.r, m: res.m });
  }
  textAt(x, y) {
    const why = this.drawBlocked();
    if (why) { toast(why); return; }
    if (this.textOpen) { this.textOpen.close(); return; }
    const L = this.targetLayer();
    if (!L) return;
    this.textOpen = textEditor(this, x, y, (text) => {
      this.textOpen = null;
      if (!text) return;
      const op = { t: 't', l: L.id, x: q1(x), y: q1(y), s: text.slice(0, 2000), fo: this.settings.font, z: this.settings.textSize, c: this.settings.color, o: 1 };
      const cl = this.modes.clip(); if (cl) op.cl = cl.map(Math.round);
      this.commitLocal(op);
    });
  }
  pickAt(x, y) {
    const d = this.doc;
    if (!this.pickSample) this.pickSample = d.sample();
    const X = clamp(Math.floor(x), 0, d.w - 1), Y = clamp(Math.floor(y), 0, d.h - 1), i = (Y * d.w + X) * 4, px = this.pickSample.data;
    const c = px[i + 3] < 8 ? (d.bg.c === 'transparent' ? '#ffffff' : d.bg.c) : rgbToHex(px[i], px[i + 1], px[i + 2]);
    this.setColor(c, false);
    this.pickPt = [x, y, c];
    this.view.request();
  }
  pickDone() {
    this.pickSample = null; this.pickPt = null;
    this.setColor(this.settings.color, true);
    if (this.tool === 'pick') this.setTool(this.prevTool || 'brush');
    this.view.request();
  }
  laser(x, y, first) {
    this.addLaser('me', [x, y], first);
    if (!this.partner) return;
    if (first) this.laserOut.s = 1;
    this.laserOut.push(q1(x), q1(y));
    if (!this.laserQueued) {
      this.laserQueued = true;
      setTimeout(() => { this.laserQueued = false; this.send({ t: 'lz', d: this.doc.id, p: this.laserOut.slice(), s: this.laserOut.s || 0 }); this.laserOut = []; }, this.net.lowRate ? 80 : 16);
    }
  }
  addLaser(who, p, start) {
    const now = performance.now();
    let tr = this.lasers.filter((t) => t.who === who).pop();
    if (!tr || start) { tr = { who, pts: [] }; this.lasers.push(tr); }
    for (let i = 0; i + 1 < p.length; i += 2) tr.pts.push({ x: p[i], y: p[i + 1], t: now });
    this.animateLasers();
  }
  animateLasers() {
    if (this.laserAnim) return;
    const step = () => {
      const now = performance.now();
      for (const t of this.lasers) t.pts = t.pts.filter((p) => now - p.t < 1300);
      this.lasers = this.lasers.filter((t) => t.pts.length);
      this.view.request();
      if (this.lasers.length) requestAnimationFrame(step); else this.laserAnim = false;
    };
    this.laserAnim = true;
    requestAnimationFrame(step);
  }
  setHover(pt) { if (!pt && !this.hover) return; this.hover = pt; this.view.request(); }
  sendCursor(x, y, drawing) {
    if (!this.partner) return;
    if (drawing && (this.tool === 'brush' || this.tool === 'eraser')) return; // stroke points already show where you are
    this.send({ t: 'cur', d: this.doc.id, x: q1(x), y: q1(y), dr: drawing ? 1 : 0, z: this.bsOf(this.curBrushId()).z, tool: this.tool, l: this.layerId });
  }
  flashSnap(kind) { toast(kind === 'line' ? '📏 Straight line' : '⭕ Neat circle', 900); }

  // ================================================================ trace pictures, cards, photos
  refImage(src, cb) {
    const done = cb || (() => this.view.request());
    if (src.startsWith('ph:')) {
      const data = this.photos.get(src.slice(3));
      if (!data) { this.requestPhoto(src.slice(3)); return null; }
      return getImage(data, done);
    }
    return getImage(src, done);
  }
  addTrace(src, where) {
    const d = this.doc, im = this.refImage(src), asp = im ? aspectOf(im) : 1;
    let R = [0, 0, d.w, d.h];
    if (where === 'left') R = [0, 0, d.w / 2, d.h]; else if (where === 'right') R = [d.w / 2, 0, d.w / 2, d.h];
    else if (where === 'top') R = [0, 0, d.w, d.h / 2]; else if (where === 'bottom') R = [0, d.h / 2, d.w, d.h / 2];
    else if (where === 'center') R = [d.w * 0.3, d.h * 0.3, d.w * 0.4, d.h * 0.4];
    else if (where === 'mine' || where === 'theirs') {
      const p = this.modes.p, q = this.modes.id === 'split' ? p : { o: 'v', pos: 0.5 };
      const slot = this.modes.slotOf(p.sides || []);
      R = this.modes._side(where === 'mine' ? slot : 1 - slot, 0, q);
    }
    const pad = 0.04 * Math.min(R[2], R[3]), aw = R[2] - 2 * pad, ah = R[3] - 2 * pad;
    const w = Math.min(aw, ah * asp), hh = w / asp;
    const ref = { id: rid(6), src, x: Math.round(R[0] + (R[2] - w) / 2), y: Math.round(R[1] + (R[3] - hh) / 2), w: Math.round(w), h: Math.round(hh), o: 0.35 };
    const list = [...(d.refs.list || []), ref].slice(-6);
    this.sendMeta('refs', d.setRec('refs', { list }, this.me.id));
    if (src.startsWith('ph:')) this.sendPhoto(src.slice(3));
    this.refsHidden = false;
    toast('Traced faintly under the drawing ✏️');
  }
  updateRef(i, patch, quiet) {
    const d = this.doc, list = (d.refs.list || []).map((r, j) => (j === i ? { ...r, ...patch } : r));
    const rec = d.setRec('refs', { list }, this.me.id);
    if (quiet) this.sendMetaSoon('refs', rec); else this.sendMeta('refs', rec);
    this.view.request();
  }
  removeRef(i) { const d = this.doc, list = (d.refs.list || []).filter((_, j) => j !== i); this.sendMeta('refs', d.setRec('refs', { list }, this.me.id)); }
  refHit(sx, sy) {
    const [x, y] = this.view.toDoc(sx, sy), tol = 26 / this.view.s, list = this.doc.refs.list || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (Math.hypot(x - (r.x + r.w), y - (r.y + r.h)) < tol) return { i, mode: 'scale', r0: { ...r } };
      if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) return { i, mode: 'move', r0: { ...r } };
    }
    return null;
  }
  refDrag(a, x, y) {
    const r = a.r0;
    if (a.mode === 'move') this.updateRef(a.i, { x: Math.round(r.x + x - a.x0), y: Math.round(r.y + y - a.y0) }, true);
    else { const asp = r.w / r.h, w = Math.max(30, r.w + (x - a.x0)); this.updateRef(a.i, { w: Math.round(w), h: Math.round(w / asp) }, true); }
  }
  refDragEnd(a) { this.updateRef(a.i, {}, false); }
  sendCard(src) { if (src.startsWith('ph:')) this.sendPhoto(src.slice(3)); this.send({ t: 'card', src }); }
  async addPhotoFile(file) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
    const id = [...dig.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const p = { id, data, name: (file.name || 'Photo').replace(/\.[^.]+$/, '').slice(0, 30), created: Date.now() };
    if (!this.photos.has(id)) { await store.savePhoto(p).catch(() => {}); this.photos.set(id, data); this.photoList.unshift(p); }
    return p;
  }
  sendPhoto(id) { const data = this.photos.get(id); if (data && this.partner) { const p = this.photoList.find((x) => x.id === id); this.send({ t: 'photo', id, data, name: p ? p.name : 'Photo' }); } }
  requestPhoto(id) { if (this.partner && !this.askedPhotos.has(id)) { this.askedPhotos.add(id); this.send({ t: 'needph', id }); } }
  receivePhoto(m) {
    if (!m.id || typeof m.data !== 'string' || !m.data.startsWith('data:image/') || this.photos.has(m.id)) return;
    const p = { id: String(m.id).slice(0, 32), data: m.data, name: String(m.name || 'Shared photo').slice(0, 30), created: Date.now(), shared: true };
    this.photos.set(p.id, p.data); this.photoList.unshift(p);
    store.savePhoto(p).catch(() => {});
    this.ideas.refresh(); this.view.request();
  }
  paletteFrom(src) {
    const im = this.refImage(src);
    if (!im) return [];
    const [c, x] = makeCanvas(48, 48, { willReadFrequently: true });
    x.drawImage(im, 0, 0, 48, 48);
    const px = x.getImageData(0, 0, 48, 48).data, buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
      const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2]; buckets.set(k, b);
    }
    const cols = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
    const out = [];
    for (const col of cols) {
      if (out.some((o) => Math.abs(o[0] - col[0]) + Math.abs(o[1] - col[1]) + Math.abs(o[2] - col[2]) < 60)) continue;
      out.push(col);
      if (out.length >= 10) break;
    }
    return out.map((c2) => rgbToHex(...c2));
  }

  // ================================================================ modes glue
  applyMode(id, p, { fresh = false } = {}) {
    if (fresh) this.newDoc({}, false);
    const rec = this.doc.setRec('mode', { id, p }, this.me.id);
    if (fresh) this.sendSync(true); else this.sendMetaSoon('mode', rec);
    this.fixLayer();
    this.refreshModeBar(); this.view.request();
  }
  openModes() { closePop(); modesSheet(this); }
  refreshModeBar() {
    if (!this.modebar || !this.doc) return;
    const keep = document.activeElement && this.modebar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement.value : null;
    this.modebar.replaceChildren(...this.modes.bar().filter(Boolean));
    if (keep !== null) { const inp = this.modebar.querySelector('input'); if (inp) { inp.value = keep; inp.focus(); } }
    this.tickTimers();
  }
  sendGuess(t) { this.modes.guess(t, this.me.id); }
  celebrate(text, remote) {
    this.lastCele = Date.now();
    if (!remote) this.send({ t: 'cele', text });
    const fx = this.fx;
    const msg = h('div', { class: 'big-msg' }, text);
    document.body.append(msg); setTimeout(() => msg.remove(), 2200);
    const cols = ['#ff5f9e', '#3d9bff', '#ffd84d', '#22b88f', '#9b7bff', '#ff7a45'];
    for (let i = 0; i < 70; i++) {
      const c = h('i', { class: 'confetti', style: { left: Math.random() * 100 + '%', background: cols[i % cols.length], animationDelay: Math.random() * 0.6 + 's', animationDuration: 1.8 + Math.random() * 1.4 + 's' } });
      fx.append(c); setTimeout(() => c.remove(), 3600);
    }
  }
  react(e) { this.floatEmoji(e, false); this.send({ t: 'react', e }); }
  floatEmoji(e, remote) {
    for (let i = 0; i < 5; i++) {
      const f = h('span', { class: 'float', style: { left: (remote ? 55 : 15) + Math.random() * 30 + '%', animationDelay: i * 0.12 + 's', fontSize: 30 + Math.random() * 26 + 'px' } }, e);
      this.fx.append(f); setTimeout(() => f.remove(), 3200);
    }
  }

  // ================================================================ overlays drawn by the view
  insets() {
    const rw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--railW')) || 0, phone = innerWidth < 600;
    return { t: phone ? 100 : 118, b: phone ? 70 : 82, l: rw + (phone ? 44 : 64), r: rw + 8 };
  }
  drawDocOverlay(ctx, view) {
    const d = this.doc, px = 1 / view.s;
    const g = this.settings.grid;
    if (g !== 'none') {
      ctx.save(); ctx.lineWidth = px; ctx.strokeStyle = 'rgba(90, 70, 140, 0.28)'; ctx.beginPath();
      if (g === 'grid') { const n = 8, sx = d.w / n, sy = d.h / n; for (let i = 1; i < n; i++) { ctx.moveTo(i * sx, 0); ctx.lineTo(i * sx, d.h); ctx.moveTo(0, i * sy); ctx.lineTo(d.w, i * sy); } }
      else if (g === 'thirds') { for (let i = 1; i < 3; i++) { ctx.moveTo((i * d.w) / 3, 0); ctx.lineTo((i * d.w) / 3, d.h); ctx.moveTo(0, (i * d.h) / 3); ctx.lineTo(d.w, (i * d.h) / 3); } }
      else if (g === 'center') { ctx.moveTo(d.w / 2, 0); ctx.lineTo(d.w / 2, d.h); ctx.moveTo(0, d.h / 2); ctx.lineTo(d.w, d.h / 2); ctx.moveTo(d.w * 0.25, d.h * 0.5); ctx.ellipse(d.w / 2, d.h / 2, d.w / 4, d.h * 0.32, 0, Math.PI, Math.PI * 3); }
      ctx.stroke(); ctx.restore();
    }
    if (this.settings.sym && this.modes.id !== 'mirror' && (this.tool === 'brush' || this.tool === 'shape')) {
      ctx.save(); ctx.setLineDash([8 * px, 8 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = 'rgba(255, 95, 158, 0.55)'; symGuides(ctx, this.settings.sym, d.w, d.h); ctx.restore();
    }
    if (this.tool === 'adjust') {
      ctx.save(); ctx.lineWidth = 2 * px; ctx.strokeStyle = '#7a5ac8'; ctx.setLineDash([6 * px, 5 * px]);
      for (const r of d.refs.list || []) {
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.x + r.w, r.y + r.h, 11 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([6 * px, 5 * px]);
      }
      ctx.restore();
    }
  }
  drawScreenOverlay(ctx, view) {
    const now = performance.now();
    // laser trails
    for (const t of this.lasers) {
      const col = t.who === 'me' ? this.me.color : this.partner ? this.partner.color : '#3d9bff';
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 14;
      for (let i = 1; i < t.pts.length; i++) {
        const a = t.pts[i - 1], b = t.pts[i], age = (now - b.t) / 1300;
        const [ax, ay] = view.toScreen(a.x, a.y), [bx, by] = view.toScreen(b.x, b.y);
        ctx.globalAlpha = clamp(1 - age, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.restore();
    }
    // partner pointer
    const pc = this.pc;
    if (pc && this.partner && this.settings.showCursor && now - pc.t < 3500) {
      const [x, y] = view.toScreen(pc.x, pc.y), col = this.partner.color;
      ctx.save(); ctx.globalAlpha = clamp(1 - (now - pc.t - 2500) / 1000, 0, 1);
      if ((pc.tool === 'brush' || pc.tool === 'eraser') && pc.z) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Math.max(3, (pc.z / 2) * view.s), 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4, y + 15); ctx.lineTo(x + 8, y + 9); ctx.lineTo(x + 15, y + 6); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.font = '700 12px ui-rounded, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const label = this.partner.name, w = ctx.measureText(label).width + 14;
      roundRect(ctx, x + 14, y + 14, w, 20, 10); ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + 21, y + 24.5);
      ctx.restore();
      if (now - pc.t < 3600) setTimeout(() => this.view.request(), 120);
    }
    // my brush ring (mouse / hovering pencil)
    if (this.hover && (this.tool === 'brush' || this.tool === 'eraser') && !this.input.busy) {
      const [x, y] = view.toScreen(this.hover[0], this.hover[1]), r = Math.max(1.5, (this.bsOf(this.curBrushId()).z / 2) * view.s);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,30,60,0.75)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
    // colour picker loupe
    if (this.pickPt) {
      const [x, y, c] = this.pickPt, [sx, sy] = view.toScreen(x, y);
      ctx.lineWidth = 10; ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(sx, sy - 50, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy - 50, 32, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy - 50, 20, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ================================================================ export
  async exportCanvas(c, name) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) { toast('Could not make the image'); return; }
    const file = new File([blob], name, { type: 'image/png' });
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Doodle Duet' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Image saved');
  }
  fileName() { const t = new Date(); return `doodle-duet-${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.png`; }
  exportPNG(paper = true) { return this.exportCanvas(this.doc.flatten({ paper }), this.fileName()); }
  async exportDocById(id) {
    if (id === this.doc.id) return this.exportPNG();
    const data = await store.loadDoc(id).catch(() => null);
    if (data) this.exportCanvas(Doc.fromData(data).flatten({}), this.fileName());
  }
  async copyImage() {
    try {
      const blob = await new Promise((r) => this.doc.flatten({}).toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied: paste it anywhere');
    } catch (e) { toast('Copying images is not supported here'); }
  }

  // ================================================================ settings
  saveSettings() { prefs.set('settings', this.settings); }
  saveSettingsSoon() { clearTimeout(this._sst); this._sst = setTimeout(() => this.saveSettings(), 600); }
  applySettings(first) {
    const t = this.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    if (!first) { this.layout(); this.view.request(); }
  }

  // ================================================================ UI
  buildUI() {
    const ui = document.getElementById('ui');
    const ib = (ic, label, fn) => h('button', { class: 'ib', title: label, 'aria-label': label, html: icon(ic), onclick: fn });
    this.whoEl = h('button', { class: 'who', onclick: () => inviteSheet(this) });
    this.inviteBtn = h('button', { class: 'invite-btn', onclick: () => inviteSheet(this) }, h('span', { html: icon('heart', 17) }), h('span', { class: 'lbl' }, 'Invite'));
    const left = h('div', { class: 'bar' }, ib('menu', 'Menu', (e) => this.menu(e.currentTarget)),
      h('div', { class: 'brand hide-phone' }, h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }), h('span', { class: 'name' }, 'Doodle Duet')), this.whoEl, this.inviteBtn);
    this.undoBtn = ib('undo', 'Undo', () => this.undo());
    this.redoBtn = ib('redo', 'Redo', () => this.redo());
    this.ideasBtn = ib('image', 'Ideas: pictures to draw from', () => this.toggleIdeas());
    this.layersBtn = ib('layers', 'Layers', (e) => this.openLayers(e.currentTarget));
    const heart = ib('heart', 'Send a reaction', (e) => this.reactPop(e.currentTarget)), save = ib('download', 'Save image', (e) => this.exportPop(e.currentTarget));
    heart.classList.add('hide-phone'); save.classList.add('hide-phone');
    const right = h('div', { class: 'bar' }, this.undoBtn, this.redoBtn, h('span', { class: 'sep hide-phone' }), this.ideasBtn, this.layersBtn, heart, save);
    this.modebar = h('div', { id: 'modebar', class: 'bar' });
    this.toolBtns = {};
    const toolEls = TOOLS.map(([id, label, ic, key, more]) => {
      const b = h('button', { class: 'tool' + (id === this.tool ? ' on' : '') + (id === 'hand' || id === 'pick' ? ' opt-phone' : ''), title: `${label} (${key})`, 'aria-label': label }, h('span', { html: icon(ic) }), h('span', { class: 'lb' }, label), more ? h('span', { class: 'more' }) : null);
      b.addEventListener('click', () => this.toolClick(id, b));
      this.toolBtns[id] = b;
      return b;
    });
    this.minis = h('div', { class: 'minis' });
    this.swatchEl = h('span', { class: 'swatch' });
    this.swatchBtn = h('button', { class: 'swatch-btn', title: 'Colour', 'aria-label': 'Colour', onclick: (e) => this.openColor(e.currentTarget) }, this.swatchEl);
    this.dock = h('nav', { id: 'dock', class: 'bar' }, toolEls, h('span', { class: 'sep' }), this.minis, this.swatchBtn);
    this.dotEl = h('i');
    this.sizeWrap = h('div'); this.opWrap = h('div');
    this.sliders = h('div', { id: 'sliders', class: 'bar' }, h('div', { class: 'preview-dot' }, this.dotEl), this.sizeWrap, h('span', { class: 'cap' }, 'Size'), h('span', { class: 'capi', title: 'Size' }, '●'), this.opWrap, h('span', { class: 'cap' }, 'Opacity'), h('span', { class: 'capi', title: 'Opacity' }, '◐'));
    this.fx = h('div', { id: 'fx' });
    ui.append(h('div', { id: 'top' }, left, right), this.modebar, this.dock, this.sliders, this.fx);
    this.refreshColor(); this.refreshTop();
  }
  toolClick(id, btn) {
    if (this.tool === id) {
      if (id === 'brush' || id === 'eraser') return this.toggle(btn, (c) => brushPanel(this, c, id === 'eraser'));
      if (id === 'shape') return this.toggle(btn, (c) => shapePanel(this, c));
      if (id === 'fill') return this.toggle(btn, () => fillPanel(this));
    }
    closePop();
    this.setTool(id);
    if (id === 'shape' && !prefs.get('seenShapes', false)) { prefs.set('seenShapes', true); this.toggle(btn, (c) => shapePanel(this, c)); }
  }
  toggle(anchor, build, opts) { if (popOpenFor(anchor)) { closePop(); return null; } return openPop(anchor, build, opts); }
  uiOpenBlocksCanvas() { return popIsOpen(); }
  closePopovers() { closePop(); }
  openColor(btn) { this.toggle(btn, (c) => colorPanel(this, c)); }
  openLayers(btn) { this.toggle(btn, (c) => layersPanel(this, c), { onClose: () => { this.layersPanelRefresh = null; } }); }
  toggleIdeas() {
    if (innerWidth > 900) { this.settings.rails = !this.settings.rails; this.saveSettings(); this.layout(); }
    else this.ideas.sheet();
  }
  reactPop(btn) {
    this.toggle(btn, (close) => [h('div', { class: 'pop-h' }, h('h3', {}, this.partner ? `Send ${this.partner.name} a reaction` : 'Reactions')),
      h('div', { class: 'reacts' }, REACTIONS.map((e) => h('button', { onclick: () => { this.react(e); close(); } }, e)))]);
  }
  exportPop(btn) {
    this.toggle(btn, (close) => {
      const item = (ic, label, fn) => h('button', { class: 'btn', style: 'width:100%;justify-content:flex-start', onclick: () => { close(); fn(); } }, h('span', { html: icon(ic, 18) }), label);
      return [h('div', { class: 'pop-h' }, h('h3', {}, 'Save & share')), h('div', { style: 'display:grid;gap:8px' },
        item('download', coarse ? 'Save / share image' : 'Save as PNG', () => this.exportPNG(true)),
        item('image', 'PNG without paper', () => this.exportPNG(false)),
        item('copy', 'Copy image', () => this.copyImage()),
        item('play', 'Time-lapse video', () => openReplay(this)),
        item('gallery', 'Gallery', () => gallerySheet(this)))];
    });
  }
  menu(btn) {
    this.toggle(btn, (close) => {
      const item = (ic, label, fn) => h('button', { class: 'btn', style: 'width:100%;justify-content:flex-start', onclick: () => { close(); fn(); } }, h('span', { html: icon(ic, 18) }), label);
      const grid = this.settings.grid;
      return [h('div', { style: 'display:grid;gap:8px' },
        innerWidth < 600 ? item('heart', 'Send a reaction', () => this.reactPop(btn)) : null,
        innerWidth < 600 ? item('download', 'Save & share image', () => this.exportPop(btn)) : null,
        item('newdoc', 'New drawing', () => newDocSheet(this)),
        item('gallery', 'Gallery', () => gallerySheet(this)),
        item('play', 'Time-lapse replay', () => openReplay(this)),
        item('sparkles', 'Play a mode', () => modesSheet(this)),
        item('users', this.partner ? 'Connection' : 'Invite partner', () => inviteSheet(this)),
        item('fit', 'Fit to screen', () => this.view.fit(true)),
        h('div', { class: 'sec-t', style: 'margin:6px 0 0' }, 'Guides'),
        h('div', { class: 'seg' }, [['none', 'None'], ['grid', 'Grid'], ['thirds', 'Thirds'], ['center', 'Face']].map(([v, l]) => h('button', { class: grid === v ? 'on' : '', onclick: () => { this.settings.grid = v; this.saveSettings(); this.view.request(); close(); } }, l))),
        item('help', 'Tips & shortcuts', () => helpSheet(this)),
        item('gear', 'Settings', () => settingsSheet(this)))];
    }, { place: 'below' });
  }
  layout() {
    if (!this.ideas) return;
    const on = this.ideas.layout();
    this.ideasBtn.classList.toggle('on', on);
    this.view.request();
  }
  refreshTop() {
    if (!this.whoEl) return;
    const p = this.partner, net = this.net;
    const av = (person, dot) => h('span', { class: 'av', style: { background: person.color } }, (person.name || '?').trim().charAt(0).toUpperCase() || '?', dot ? h('span', { class: 'dotlive ' + dot }) : null);
    let st;
    if (p) st = (net.via === 'relay' ? 'relay · ' : '') + (net.rtt ? net.rtt + ' ms' : 'connected');
    else if (net.state === 'waiting') st = 'room ' + this.room.code + ' · waiting';
    else if (net.state === 'off') st = 'just you';
    else st = 'connecting…';
    this.whoEl.title = p ? `Drawing with ${p.name}` : net.text || '';
    this.whoEl.replaceChildren(...[av(this.me, p ? null : net.state === 'waiting' ? 'wait' : null), p ? av(p, 'ok') : null,
      h('span', { class: 'txt' }, h('span', { class: 'nm' }, p ? `You & ${p.name}` : this.me.name || 'You'), h('span', { class: 'st' }, st))].filter(Boolean));
    this.inviteBtn.hidden = !!p;
  }
  refreshColor() {
    if (!this.swatchEl) return;
    const c = this.settings.color;
    this.swatchEl.style.background = c;
    const rec = (this.settings.recent || []).filter((x) => x !== c).slice(0, 4);
    this.minis.replaceChildren(...rec.map((x) => h('button', { class: 'mini', style: { background: x }, title: x, onclick: () => this.setColor(x, true) })));
    this.refreshDot();
  }
  refreshDot() {
    if (!this.dotEl) return;
    const bs = this.bsOf(this.curBrushId()), d = clamp(bs.z * (this.view ? this.view.s : 1), 2, 30);
    Object.assign(this.dotEl.style, { width: d + 'px', height: d + 'px', background: this.tool === 'eraser' ? 'transparent' : this.settings.color, opacity: String(Math.max(0.15, bs.o)), boxShadow: this.tool === 'eraser' ? 'inset 0 0 0 2px var(--ink-2)' : 'none' });
  }
  refreshSliders() {
    if (!this.sliders) return;
    const show = ['brush', 'eraser', 'shape'].includes(this.tool);
    this.sliders.hidden = !show;
    if (!show) return;
    const id = this.curBrushId(), B = brushOf(id), bs = this.bsOf(id);
    if (this._slFor !== id) {
      this._slFor = id;
      this.sizeSl = slider({ min: 1, max: B.max, log: true, vertical: true, value: bs.z, fmt: (v) => Math.round(v) + ' px', onInput: (v) => this.setBrushProp('z', v, true) });
      this.opSl = slider({ min: 0.02, max: 1, vertical: true, value: bs.o, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => this.setBrushProp('o', v, true) });
      this.sizeWrap.replaceChildren(this.sizeSl.el); this.opWrap.replaceChildren(this.opSl.el);
    } else { this.sizeSl.set(bs.z); this.opSl.set(bs.o); }
    this.refreshDot();
  }
  tick() {
    if (!this.doc) return;
    this.modes.tick();
    this.tickTimers();
  }
  tickTimers() {
    if (!this.modebar) return;
    for (const t of this.modebar.querySelectorAll('.timer')) {
      const left = +t.dataset.end - Date.now();
      t.textContent = fmtTime(left);
      t.classList.toggle('low', left < 10000);
    }
  }
  keyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); this.exportPNG(); return; }
      if (mod) return;
      if (e.key === ' ') { e.preventDefault(); if (!this.input.space) { this.input.space = true; this.view.cv.style.cursor = 'grab'; } return; }
      if (e.key === 'Escape') { if (!closePop() && !closeSheet()) { if (this.tool === 'adjust') this.setTool(this.prevTool || 'brush'); } return; }
      const map = { b: 'brush', e: 'eraser', g: 'fill', u: 'shape', t: 'text', i: 'pick', l: 'laser', h: 'hand' };
      if (map[k] && !sheetOpen()) { this.setTool(map[k]); return; }
      if (k === '[' || k === ']') { const bs = this.bsOf(this.curBrushId()); this.setBrushProp('z', clamp(bs.z * (k === '[' ? 0.85 : 1.18), 1, brushOf(this.curBrushId()).max)); return; }
      if (k === '0') { this.view.fit(true); return; }
      if (k === '=' || k === '+') { this.view.zoomAt(this.view.W / 2, this.view.H / 2, 1.25); return; }
      if (k === '-') { this.view.zoomAt(this.view.W / 2, this.view.H / 2, 0.8); return; }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') { this.input.space = false; this.view.cv.style.cursor = this.tool === 'hand' ? 'grab' : 'crosshair'; } });
    document.addEventListener('gesturestart', (e) => e.preventDefault()); // no page zoom on iOS
  }
}

window.app = new App();
