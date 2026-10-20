// Colour picker: saturation/brightness square, hue strip, hex, a curated palette, recent colours and your partner's colour.
import { h, clamp, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, validHex } from '../util.js';
import { icon } from '../icons.js';

export const PALETTE = [
  '#2f2940', '#000000', '#5c5470', '#9a93a8', '#c9c3d3', '#ffffff', '#f6e7d3', '#c98b5a', '#7a4b2e',
  '#e5484d', '#ff7a45', '#ffb020', '#ffd84d', '#5bc26a', '#1fa39a', '#3d8bff', '#7a5ac8', '#ff5fa2',
  '#ffb3b8', '#ffd2a8', '#fff1a8', '#c7f0c4', '#b6ece6', '#bcd8ff', '#d9cbff', '#ffc9e3', '#e7dccd',
];

export function colorPanel(app, close) {
  let [hu, sa, va] = rgbToHsv(...hexToRgb(app.settings.color));
  const [cv, cx] = (() => { const c = document.createElement('canvas'); c.width = 300; c.height = 170; return [c, c.getContext('2d')]; })();
  const ring = h('div', { class: 'ring' }), hring = h('div', { class: 'ring' });
  const sv = h('div', { class: 'sv' }, cv, ring), hue = h('div', { class: 'hue' }, hring);
  const now = h('div', { class: 'now' }), hex = h('input', { maxlength: 7, spellcheck: false, autocomplete: 'off', 'aria-label': 'Hex colour' });
  const drawSV = () => {
    const [r, g, b] = hsvToRgb(hu, 1, 1);
    cx.fillStyle = rgbToHex(r, g, b); cx.fillRect(0, 0, 300, 170);
    let gr = cx.createLinearGradient(0, 0, 300, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 300, 170);
    gr = cx.createLinearGradient(0, 0, 0, 170); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); cx.fillStyle = gr; cx.fillRect(0, 0, 300, 170);
  };
  const paint = (fromHex) => {
    const col = rgbToHex(...hsvToRgb(hu, sa, va));
    ring.style.left = sa * 100 + '%'; ring.style.top = (1 - va) * 100 + '%'; ring.style.background = col;
    hring.style.left = (hu / 360) * 100 + '%'; hring.style.background = rgbToHex(...hsvToRgb(hu, 1, 1));
    now.style.background = col;
    if (!fromHex) hex.value = col.toUpperCase();
    return col;
  };
  const commit = (col) => { app.setColor(col, false); };
  const drag = (el, fn) => {
    let on = false;
    el.addEventListener('pointerdown', (e) => { on = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } fn(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (on) fn(e); });
    const end = () => { if (on) { on = false; app.setColor(paint(), true); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  drag(sv, (e) => { const r = sv.getBoundingClientRect(); sa = clamp((e.clientX - r.left) / r.width, 0, 1); va = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); commit(paint()); });
  drag(hue, (e) => { const r = hue.getBoundingClientRect(); hu = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360; if (sa < 0.05 && va > 0.95) { sa = 0.8; va = 0.9; } drawSV(); commit(paint()); });
  hex.addEventListener('input', () => {
    let v = hex.value.trim(); if (!v.startsWith('#')) v = '#' + v;
    if (validHex(v)) { [hu, sa, va] = rgbToHsv(...hexToRgb(v)); drawSV(); paint(true); app.setColor(v.toLowerCase(), true); }
  });
  hex.addEventListener('keydown', (e) => e.stopPropagation());
  const pick = (c) => { [hu, sa, va] = rgbToHsv(...hexToRgb(c)); drawSV(); paint(); app.setColor(c, true); refreshSw(); };
  const swatches = h('div', { class: 'sws' });
  const recents = h('div', { class: 'sws' }), recT = h('div', { class: 'sec-t' }, 'Recent');
  const refreshSw = () => {
    const cur = app.settings.color;
    swatches.replaceChildren(...PALETTE.map((c) => h('button', { style: { background: c }, class: c === cur ? 'on' : '', title: c, onclick: () => pick(c) })));
    const rec = (app.settings.recent || []).filter((c) => !PALETTE.includes(c)).slice(0, 9);
    recents.replaceChildren(...rec.map((c) => h('button', { style: { background: c }, class: c === cur ? 'on' : '', title: c, onclick: () => pick(c) })));
    recT.hidden = !rec.length;
  };
  drawSV(); paint();
  const partner = app.partner;
  const out = [
    h('div', { class: 'pop-h' }, h('h3', {}, 'Colour'), h('div', { class: 'btns' },
      h('button', { class: 'btn sm', onclick: () => { close(); app.setTool('pick'); app.toast('Tap the canvas to pick a colour'); } }, h('span', { html: icon('pipette', 16) }), 'Pick'),
      partner ? h('button', { class: 'btn sm', title: `${partner.name}'s colour`, onclick: () => pick(partner.color) }, h('span', { class: 'mini', style: { background: partner.color, width: '16px', height: '16px' } }), partner.name.split(' ')[0]) : null)),
    sv, hue, h('div', { class: 'hexrow' }, now, hex),
    h('div', { class: 'sec-t' }, 'Palette'), swatches,
    recT, recents,
  ];
  refreshSw();
  return out;
}
