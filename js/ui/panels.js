// Popovers and sheets: brushes, shapes, fill, layers, modes, invite, gallery, new drawing, settings, help.
import { h, makeCanvas } from '../util.js';
import { icon } from '../icons.js';
import { BRUSHES, brushOf, StrokeRenderer, bbRect, compositeStroke } from '../brushes.js';
import { FONTS, MAX_LAYERS } from '../doc.js';
import { MODE_LIST, SYMS } from '../modes.js';
import { slider, sliderRow, toggle, seg, sheetHead, confirmSheet, openSheet } from './widgets.js';
import { store } from '../store.js';

// ------------------------------------------------------------------ brushes
export function brushPreview(id, color, w = 150, hgt = 40) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [c, x] = makeCanvas(w * dpr, hgt * dpr, {});
  const [s, sx] = makeCanvas(w * dpr, hgt * dpr, {});
  const B = brushOf(id), pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push((10 + t * (w - 20)) * dpr, (hgt / 2 + Math.sin(t * Math.PI * 2) * hgt * 0.22) * dpr, Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.9 + 0.1);
  }
  const z = Math.min(B.def.z, B.kind === 'dab' || B.kind === 'spray' ? 22 : 12) * dpr;
  if (B.erase) { x.fillStyle = '#c9c3d3'; x.fillRect(0, hgt * 0.25 * dpr, w * dpr, hgt * 0.5 * dpr); }
  const op = { b: id, c: B.erase ? '#000' : color, z, o: B.def.o, sd: 7, p: pts };
  const r = new StrokeRenderer(op, sx); r.add(pts); r.finish();
  compositeStroke(x, op, s, bbRect(r.bb, s.width, s.height));
  return c;
}

export function brushPanel(app, close, eraser) {
  const list = BRUSHES.filter((b) => (eraser ? b.erase : !b.erase));
  const cur = eraser ? app.settings.eraser : app.settings.brush;
  const grid = h('div', { class: 'brushes' }, list.map((b) => {
    const card = h('button', { class: 'bcard' + (b.id === cur ? ' on' : ''), onclick: () => { app.chooseBrush(b.id, eraser); close(); } }, brushPreview(b.id, app.settings.color), h('div', { class: 'bn' }, b.name));
    return card;
  }));
  const bs = app.bsOf(cur);
  const B = brushOf(cur);
  const size = sliderRow('Size', { min: 1, max: B.max, log: true, value: bs.z, fmt: (v) => Math.round(v) + ' px', onInput: (v) => app.setBrushProp('z', v) });
  const op = sliderRow('Opacity', { min: 0.02, max: 1, value: bs.o, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => app.setBrushProp('o', v) });
  const sm = sliderRow('Smoothing', { min: 0, max: 1, value: app.smoothingFor(cur), fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => app.setBrushProp('sm', v) });
  const out = [h('div', { class: 'pop-h' }, h('h3', {}, eraser ? 'Erasers' : 'Brushes'), h('span', { class: 'small' }, B.name)), grid, h('div', { class: 'sec-t' }, 'Settings'), size.el, op.el, sm.el];
  if (!eraser) {
    out.push(h('div', { class: 'sec-t' }, 'Symmetry (just for you)'), seg([[null, 'Off'], ['v', '⇆'], ['h', '⇅'], ['q', '✛'], ['k6', '❄︎']], app.settings.sym || null, (v) => { app.settings.sym = v; app.saveSettings(); app.view.request(); }));
    out.push(toggle('Hold to snap shapes', app.settings.quickShape, (v) => { app.settings.quickShape = v; app.saveSettings(); }, 'Hold still at the end of a line: it straightens, a loop becomes a circle'));
  }
  return out;
}

// ------------------------------------------------------------------ shapes + fill + text
const SHAPES = [['line', 'Line', 'M4 20 20 4'], ['arrow', 'Arrow', 'M4 20 20 4M10 4h10v10'], ['rect', 'Box', 'M4 6h16v12H4z'], ['ellipse', 'Circle', 'M12 4a8 8 0 1 0 0.01 0'], ['triangle', 'Triangle', 'M12 4 21 20H3z'], ['star', 'Star', 'M12 3l2.6 5.8 6.4.6-4.8 4.3 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.4l6.4-.6z'], ['heart', 'Heart', 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z']];
export function shapePanel(app, close) {
  const grid = h('div', { class: 'shapes' }, SHAPES.map(([id, name, d]) => h('button', { class: app.settings.shape === id ? 'on' : '', onclick: () => { app.settings.shape = id; app.saveSettings(); app.setTool('shape'); close(); } },
    h('span', { html: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>` }), name)));
  return [h('div', { class: 'pop-h' }, h('h3', {}, 'Shapes')), grid,
    toggle('Filled', app.settings.shapeFill, (v) => { app.settings.shapeFill = v; app.saveSettings(); }, 'Fill boxes, circles, stars and hearts'),
    h('p', { class: 'small' }, 'Shapes use your current brush, size and colour. Hold Shift for perfect squares and circles.')];
}
export function fillPanel(app) {
  return [h('div', { class: 'pop-h' }, h('h3', {}, 'Fill')),
    sliderRow('Tolerance', { min: 0, max: 80, value: app.settings.fillTol, fmt: (v) => Math.round(v) + '%', onInput: (v) => { app.settings.fillTol = Math.round(v); }, onDone: () => app.saveSettings() }).el,
    toggle('Use lines on all layers', app.settings.fillAll, (v) => { app.settings.fillAll = v; app.saveSettings(); }, 'Colour in line art that lives on another layer'),
    h('p', { class: 'small' }, 'Tap inside an area to fill it with your colour.')];
}

// ------------------------------------------------------------------ layers
export function layersPanel(app, close) {
  const box = h('div');
  const render = () => {
    const doc = app.doc, layers = doc.layerList().slice().reverse();
    const pl = app.partnerLayer;
    const rows = layers.map((L) => {
      const th = makeCanvas(96, 96);
      const tx = th.getContext('2d'); tx.drawImage(L.canvas, 0, 0, 96, 96);
      const eye = h('button', { class: 'ib', title: L.visible ? 'Hide' : 'Show', html: icon(L.visible ? 'eye' : 'eyeoff', 18), onclick: (e) => { e.stopPropagation(); app.layerUpdate(L.id, { visible: !L.visible }); } });
      const row = h('div', { class: 'lyr' + (L.id === app.layerId ? ' on' : ''), onclick: () => { app.selectLayer(L.id); render(); } }, th,
        h('div', { class: 'ln' }, L.name, L.guide ? ' (guide)' : '', pl === L.id && app.partner ? h('span', { class: 'pdot', title: app.partner.name + ' is here', style: { background: app.partner.color } }) : null,
          h('small', {}, Math.round(L.opacity * 100) + '%' + (L.visible ? '' : ' · hidden'))), eye);
      row.addEventListener('dblclick', () => rename(L));
      return row;
    });
    const L = doc.layers.get(app.layerId);
    const op = L ? sliderRow('Opacity', { min: 0, max: 1, value: L.opacity, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => app.layerUpdate(L.id, { opacity: v }, true), onDone: (v) => app.layerUpdate(L.id, { opacity: v }) }) : null;
    const act = (ic, title, fn, dis) => h('button', { class: 'ib', title, 'aria-label': title, html: icon(ic, 19), disabled: !!dis, onclick: fn });
    const list = doc.layerList(), idx = list.findIndex((x) => x.id === app.layerId);
    box.replaceChildren(
      h('div', { class: 'pop-h' }, h('h3', {}, 'Layers'), h('div', { class: 'btns', style: 'gap:2px' },
        act('plus', 'New layer', () => { app.addLayer(); render(); }, list.length >= MAX_LAYERS),
        act('up', 'Move up', () => { app.moveLayer(1); render(); }, idx < 0 || idx >= list.length - 1),
        act('down', 'Move down', () => { app.moveLayer(-1); render(); }, idx <= 0),
        act('trash', 'Delete layer', async () => { if (await confirmSheet('Delete this layer?', 'It disappears for both of you.', 'Delete', true)) { app.deleteLayer(); } }, list.length <= 1))),
      h('div', { class: 'layers' }, rows),
      h('div', { style: 'margin-top:10px' }, op ? op.el : null),
      h('div', { class: 'btns', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', onclick: () => L && rename(L) }, 'Rename'),
        h('button', { class: 'btn sm', onclick: async () => { if (await confirmSheet('Clear this layer?', 'You can undo it.', 'Clear')) app.clearLayer(); } }, 'Clear layer')),
      h('div', { class: 'sec-t' }, 'Paper'),
      h('div', { class: 'papers' }, ['#ffffff', '#fffaf0', '#f6efe4', '#fdf2f6', '#eef5ff', '#eaf6ee', '#2b2735', '#111111', 'transparent'].map((c) => h('button', { class: doc.bg.c === c ? 'on' : '', title: c === 'transparent' ? 'See-through' : c, style: c === 'transparent' ? { background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/12px 12px' } : { background: c }, onclick: () => { app.setPaper(c); render(); } }))),
      refsSection(app, render),
    );
  };
  const rename = (L) => openSheet((close2) => {
    const inp = h('input', { class: 'field', value: L.name, maxlength: 40 });
    const ok = () => { app.layerUpdate(L.id, { name: inp.value.trim() || L.name }); close2(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); e.stopPropagation(); });
    setTimeout(() => inp.select(), 50);
    return [sheetHead('Rename layer', null, close2), inp, h('div', { class: 'btns', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { class: 'btn pri', onclick: ok }, 'Save'))];
  });
  render();
  app.layersPanelRefresh = render;
  void close;
  return box;
}
function refsSection(app, render) {
  const list = app.doc.refs.list || [];
  if (!list.length) return h('div', {}, h('div', { class: 'sec-t' }, 'Trace pictures'), h('p', { class: 'small' }, 'Open a picture from Ideas and tap “Trace” to put it faintly under your drawing.'));
  return h('div', {},
    h('div', { class: 'sec-t' }, 'Trace pictures'),
    toggle('Show trace pictures', !app.refsHidden, (v) => { app.refsHidden = !v; app.view.request(); }),
    ...list.map((r, i) => {
      const im = app.refImage(r.src);
      const th = makeCanvas(64, 64); if (im) { const x = th.getContext('2d'); x.fillStyle = '#fffdf8'; x.fillRect(0, 0, 64, 64); x.drawImage(im, 0, 0, 64, 64); }
      const s = slider({ min: 0.05, max: 1, value: r.o === undefined ? 0.35 : r.o, onInput: (v) => app.updateRef(i, { o: v }, true), onDone: (v) => app.updateRef(i, { o: v }) });
      return h('div', { class: 'lyr', style: 'cursor:default' }, th, h('div', { class: 'ln' }, h('small', {}, 'Strength'), s.el),
        h('button', { class: 'ib', title: 'Move / resize', html: icon('move', 18), onclick: () => { app.setTool('adjust'); app.closePopovers(); app.toast('Drag the picture to move it, drag a corner to resize'); } }),
        h('button', { class: 'ib', title: 'Remove', html: icon('trash', 18), onclick: () => { app.removeRef(i); render(); } }));
    }));
}

// ------------------------------------------------------------------ modes
export function modesSheet(app) {
  return openSheet((close) => {
    const cur = app.doc.mode.id || 'free';
    const opt = {};
    const cards = MODE_LIST.map((m) => {
      const extra = [];
      if (m.id === 'split') extra.push(seg([['v', 'Left | right'], ['h', 'Top / bottom']], 'v', (v) => { opt.split = { o: v }; }));
      if (m.id === 'mirror') { const sel = h('select', { class: 'chip-select', onchange: (e) => { opt.mirror = { sym: e.target.value }; } }, SYMS.map(([v, l]) => h('option', { value: v }, l))); extra.push(sel); }
      if (m.id === 'turns') extra.push(seg([[10, '10 s'], [30, '30 s'], [60, '1 min']], 30, (v) => { opt.turns = { sec: v }; }));
      if (m.id === 'fold') extra.push(seg([[3, '3 parts'], [4, '4 parts']], 3, (v) => { opt.fold = { n: v }; }));
      if (m.id === 'challenge') extra.push(seg([[60, '1 min'], [90, '1.5 min'], [180, '3 min']], 90, (v) => { opt.challenge = { ...(opt.challenge || {}), sec: v }; }));
      if (m.id === 'guess') extra.push(seg([[60, '60 s'], [80, '80 s'], [120, '2 min']], 80, (v) => { opt.guess = { sec: v }; }));
      const fresh = ['fold', 'challenge', 'guess'].includes(m.id);
      return h('div', { class: 'mcard' + (m.id === cur ? ' on' : '') },
        h('div', { class: 'me' }, m.emoji), h('div', { class: 'mn' }, m.name), h('div', { class: 'md' }, m.desc),
        extra.length ? h('div', { class: 'mo' }, extra) : null,
        h('div', { class: 'btns', style: 'margin-top:6px' }, h('button', { class: 'btn sm pri', onclick: () => { close(); app.modes.start(m.id, opt[m.id] || {}); app.toast(`${m.name}${fresh ? ' — fresh page, your drawing is saved' : ''}`); } }, m.id === cur ? 'Restart' : 'Start'),
          fresh ? h('span', { class: 'small', style: 'align-self:center' }, 'starts a new page') : null));
    });
    return [sheetHead('Play together', app.partner ? `Both of you switch to the mode you pick.` : 'Modes work alone too, but they are best with your partner.', close), h('div', { class: 'modes' }, cards)];
  }, { wide: true });
}

// ------------------------------------------------------------------ invite / connection
export function inviteSheet(app) {
  return openSheet((close) => {
    const title = h('h2', {}), codeEl = h('div', { class: 'code-big' }), dot = h('span', { class: 'dotlive', style: 'position:static;border:0' }), stText = h('span'), keyEl = h('b', { style: 'font-family:ui-monospace,Menlo,monospace' });
    const codeIn = h('input', { class: 'field', placeholder: 'Their room code', maxlength: 10, autocapitalize: 'characters', autocomplete: 'off', style: 'text-transform:uppercase;letter-spacing:3px;text-align:center' });
    const join = () => { if (app.joinCode(codeIn.value)) close(); };
    codeIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
    const refresh = () => {
      const net = app.net, room = app.room, p = app.partner;
      title.textContent = p ? 'Drawing together 💞' : 'Invite your partner';
      codeEl.textContent = room.code;
      dot.className = 'dotlive ' + (p ? 'ok' : 'wait');
      stText.textContent = p ? `Connected with ${p.name}${net.via === 'relay' ? ' (backup relay)' : ''}${net.rtt ? ' · ' + net.rtt + ' ms' : ''}` : net.text || 'Starting…';
      keyEl.textContent = room.key ? room.key.replace(/(.{4})(?=.)/g, '$1-') : 'none';
    };
    const link = () => app.inviteLink();
    refresh();
    app.inviteRefresh = refresh;
    return [h('div', { class: 'sheet-h' }, title, h('button', { class: 'ib', 'aria-label': 'Close', onclick: close, html: icon('x') })),
      h('div', { class: 'card', style: 'text-align:center' },
        h('div', { class: 'small', style: 'font-weight:800;margin-bottom:6px' }, 'YOUR ROOM CODE'), codeEl,
        h('div', { class: 'status-line', style: 'justify-content:center;margin-top:10px' }, dot, stText),
        h('div', { class: 'btns', style: 'justify-content:center;margin-top:12px' },
          navigator.share ? h('button', { class: 'btn pri', onclick: () => navigator.share({ title: 'Draw with me on Doodle Duet', text: 'Come draw with me! 💞', url: link() }).catch(() => {}) }, h('span', { html: icon('share', 18) }), 'Send invite') : null,
          h('button', { class: 'btn' + (navigator.share ? '' : ' pri'), onclick: async () => { try { await navigator.clipboard.writeText(link()); app.toast('Invite link copied'); } catch (e) { prompt('Copy this link', link()); } } }, h('span', { html: icon('link', 18) }), 'Copy link'))),
      h('p', { class: 'small', style: 'margin:12px 2px' }, 'Send the link to your partner (Messages, WhatsApp, AirDrop). The link works best: it also carries a secret backup key, so you connect even on networks that block direct links. Opening the same link later reconnects you to this room.'),
      h('div', { class: 'sec-t' }, 'Join your partner instead'),
      h('div', { style: 'display:flex;gap:8px' }, codeIn, h('button', { class: 'btn pri', onclick: join }, 'Join')),
      h('details', { style: 'margin-top:14px' }, h('summary', {}, 'More'),
        h('div', { class: 'small', style: 'margin:8px 0' }, 'Backup key (already inside the link): ', keyEl),
        h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: async () => { if (await confirmSheet('Make a new room?', 'Your partner will need the new link or code.', 'New room')) { app.newRoom(); inviteSheet(app); } } }, 'New room code')))];
  }, { onClose: () => { app.inviteRefresh = null; } });
}

// ------------------------------------------------------------------ gallery + new drawing
export function gallerySheet(app) {
  return openSheet((close) => {
    const grid = h('div', { class: 'gal' }, h('div', { class: 'small' }, 'Loading…'));
    const load = async () => {
      await app.saveNow();
      const items = await store.listDocs().catch(() => []);
      if (!items.length) { grid.replaceChildren(h('div', { class: 'small' }, 'Nothing saved yet. Drawings save themselves while you draw.')); return; }
      grid.replaceChildren(...items.map((it) => {
        const on = it.id === app.doc.id;
        const del = h('button', { title: 'Delete', html: icon('trash', 16), onclick: async (e) => { e.stopPropagation(); if (await confirmSheet('Delete this drawing?', 'It is removed from this device (your partner keeps their copy).', 'Delete', true)) { await store.deleteDoc(it.id); if (on) app.newDoc({}, true); gallerySheet(app); } } });
        const dl = h('button', { title: 'Save image', html: icon('download', 16), onclick: async (e) => { e.stopPropagation(); app.exportDocById(it.id); } });
        return h('button', { class: 'gi' + (on ? ' on' : ''), onclick: () => { close(); if (!on) app.openDoc(it.id); } },
          h('img', { src: it.thumb, alt: '' }), h('div', { class: 'gx' }, dl, del),
          h('div', { class: 'gt' }, h('b', {}, it.title || (on ? 'This drawing' : 'Drawing')), new Date(it.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })));
      }));
    };
    load();
    return [sheetHead('Gallery', 'Every drawing is saved on this device. Opening one shows it to your partner too.', close),
      h('div', { class: 'btns', style: 'margin-bottom:14px' }, h('button', { class: 'btn pri', onclick: () => { close(); newDocSheet(app); } }, h('span', { html: icon('plus', 18) }), 'New drawing')), grid];
  }, { wide: true });
}
export const SIZES = [['square', 'Square', 1600, 1600], ['land', 'Landscape', 2000, 1400], ['port', 'Portrait', 1400, 2000], ['phone', 'Phone wallpaper', 1170, 2080], ['big', 'Big square', 2048, 2048]];
export function newDocSheet(app) {
  return openSheet((close) => {
    let size = 'square', paper = '#ffffff';
    return [sheetHead('New drawing', 'Your current drawing stays in the Gallery.', close),
      h('div', { class: 'sec-t' }, 'Shape'), seg(SIZES.map(([id, n]) => [id, n]), size, (v) => { size = v; }),
      h('div', { class: 'sec-t' }, 'Paper'), seg([['#ffffff', 'White'], ['#f6efe4', 'Cream'], ['#2b2735', 'Night'], ['transparent', 'See-through']], paper, (v) => { paper = v; }),
      h('div', { class: 'btns', style: 'justify-content:flex-end;margin-top:16px' }, h('button', { class: 'btn pri', onclick: () => { const s = SIZES.find((x) => x[0] === size); close(); app.newDoc({ w: s[2], h: s[3], bg: paper }, true); } }, 'Start drawing'))];
  });
}

// ------------------------------------------------------------------ settings + help
export const PLAYER_COLORS = ['#ff5f9e', '#3d9bff', '#22b88f', '#ffad1f', '#9b7bff', '#ff7a45'];
export function settingsSheet(app) {
  return openSheet((close) => {
    const s = app.settings;
    const name = h('input', { class: 'field', value: app.me.name, maxlength: 24 });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('change', () => app.setProfile({ name: name.value.trim() || app.me.name }));
    const colors = h('div', { class: 'colors', style: 'justify-content:flex-start;margin:8px 0' });
    const paintColors = () => colors.replaceChildren(...PLAYER_COLORS.map((c) => h('button', { class: c === app.me.color ? 'on' : '', style: { background: c }, onclick: () => { app.setProfile({ color: c }); paintColors(); } })));
    paintColors();
    const set = (k) => (v) => { s[k] = v; app.saveSettings(); app.applySettings(); };
    return [sheetHead('Settings', null, close),
      h('div', { class: 'sec-t' }, 'You'), name, colors,
      h('div', { class: 'sec-t' }, 'Drawing'),
      h('div', { class: 'tog' }, h('span', {}, 'Draw with finger', h('small', {}, 'Auto: fingers draw until you use an Apple Pencil, then they only move the canvas')), seg([['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']], s.finger, set('finger'))),
      h('div', { class: 'tog' }, h('span', {}, 'Pencil pressure'), seg([['light', 'Light'], ['normal', 'Normal'], ['firm', 'Firm']], s.pressureCurve, set('pressureCurve'))),
      toggle('Speed changes line width', s.simPressure, set('simPressure'), 'Mouse and finger strokes get thinner when fast, like a real pen'),
      toggle('Rotate canvas with two fingers', s.rotate, set('rotate')),
      toggle('Show my partner\'s pointer', s.showCursor, set('showCursor')),
      toggle('Ideas on the sides', s.rails, set('rails'), 'Picture rails left and right on wide screens'),
      h('div', { class: 'sec-t' }, 'Look'),
      seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme, set('theme')),
      h('div', { class: 'sec-t' }, 'About'),
      h('p', { class: 'small' }, 'Doodle Duet connects your two devices directly (WebRTC). If a network blocks that, it falls back to an encrypted relay through public MQTT servers that only ever see scrambled data. Drawings are saved only on your devices.'),
    ];
  });
}
export function helpSheet(app) {
  const k = (t) => h('span', { class: 'kbd' }, t);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  return openSheet((close) => [sheetHead('Tips & shortcuts', null, close),
    h('div', { class: 'help-grid' },
      h('b', {}, '2 fingers'), h('span', {}, 'pinch to zoom, drag to move, twist to rotate'),
      h('b', {}, '2-finger tap'), h('span', {}, 'undo (3-finger tap: redo)'),
      h('b', {}, 'Hold'), h('span', {}, 'at the end of a stroke to snap a straight line or circle'),
      h('b', {}, 'Apple Pencil'), h('span', {}, 'pressure works; once used, fingers only move the canvas'),
      h('b', {}, 'Mac trackpad'), h('span', {}, 'scroll to move, pinch to zoom'),
      k('B'), h('span', {}, 'brush'), k('E'), h('span', {}, 'eraser'), k('G'), h('span', {}, 'fill'), k('U'), h('span', {}, 'shapes'), k('T'), h('span', {}, 'text'), k('I'), h('span', {}, 'colour picker (or hold Option/Alt)'),
      k('L'), h('span', {}, 'point / laser'), k('Space'), h('span', {}, 'hold to move the canvas'), k('[  ]'), h('span', {}, 'brush size'),
      k(mod + ' Z'), h('span', {}, 'undo'), k(mod + ' ⇧ Z'), h('span', {}, 'redo'), k('0'), h('span', {}, 'fit to screen'), k('+  −'), h('span', {}, 'zoom')),
    h('p', { class: 'small', style: 'margin-top:12px' }, 'Tip: add Doodle Duet to your Home Screen (Share → Add to Home Screen) for full-screen drawing on iPad and iPhone.')]);
}

// ------------------------------------------------------------------ text tool editor
export function textEditor(app, x, y, onDone) {
  const [sx, sy] = app.view.toScreen(x, y);
  const s = app.settings;
  const ta = h('textarea', { rows: 1, placeholder: 'Type…', spellcheck: false });
  const style = () => { ta.style.font = fontPx(s.font, s.textSize * app.view.s); ta.style.color = app.settings.color; fit(); };
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = 'auto'; ta.style.width = Math.max(160, ta.scrollWidth + 8) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) done(true); });
  const fontSel = h('select', { class: 'chip-select', onchange: (e) => { s.font = e.target.value; app.saveSettings(); style(); } }, Object.entries(FONTS).map(([k2, f]) => h('option', { value: k2, selected: k2 === s.font }, f.name)));
  const sizeSl = slider({ min: 12, max: 400, log: true, value: s.textSize, onInput: (v) => { s.textSize = Math.round(v); style(); }, onDone: () => app.saveSettings() });
  sizeSl.el.style.width = '110px';
  const box = h('div', { class: 'texted', style: { left: sx - 6 + 'px', top: sy - 6 + 'px' } }, ta,
    h('div', { class: 'tbar bar' }, fontSel, sizeSl.el, h('button', { class: 'btn sm', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn sm pri', onclick: () => done(true) }, 'Add')));
  let finished = false;
  function done(ok) { if (finished) return; finished = true; box.remove(); onDone(ok ? ta.value.replace(/\s+$/, '') : ''); }
  document.body.append(box);
  style();
  setTimeout(() => ta.focus(), 30);
  return { close: () => done(true) };
}
const fontPx = (key, px) => (FONTS[key] || FONTS.round).css.replace('{z}', Math.max(8, Math.round(px)));
