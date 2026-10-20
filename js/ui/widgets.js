// Small UI building blocks: pointer-driven sliders (native range inputs are unreliable under touch-action:none on iPad),
// popovers, sheets, toasts, switches.
import { h, clamp } from '../util.js';
import { icon } from '../icons.js';

/** slider({min,max,value,step,vertical,log,fmt,onInput,onDone}) -> { el, set(v), get() } */
export function slider(o) {
  const { min, max, vertical = false, log = false, step = 0 } = o;
  let value = o.value;
  const fill = h('div', { class: 'fill' }), knob = h('div', { class: 'knob' }), bub = h('div', { class: 'bub' });
  const track = h('div', { class: 'track' }, fill, knob);
  const el = h('div', { class: 'sl ' + (vertical ? 'v' : 'hz') }, track, vertical ? bub : null);
  const toT = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t) => { let v = log ? min * Math.pow(max / min, t) : min + t * (max - min); if (step) v = Math.round(v / step) * step; return clamp(v, min, max); };
  const paint = () => {
    const t = clamp(toT(value), 0, 1);
    if (vertical) { fill.style.height = t * 100 + '%'; knob.style.bottom = t * 100 + '%'; bub.style.bottom = t * 100 + '%'; }
    else { fill.style.width = t * 100 + '%'; knob.style.left = t * 100 + '%'; }
    bub.textContent = o.fmt ? o.fmt(value) : String(Math.round(value));
  };
  const at = (e) => {
    const r = track.getBoundingClientRect();
    const t = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const v = fromT(clamp(t, 0, 1));
    if (v !== value) { value = v; paint(); if (o.onInput) o.onInput(v); }
  };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); dragging = true; el.classList.add('drag'); try { track.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } at(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) at(e); });
  const end = () => { if (!dragging) return; dragging = false; el.classList.remove('drag'); if (o.onDone) o.onDone(value); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  paint();
  return { el, set(v) { value = clamp(v, min, max); paint(); }, get: () => value };
}
/** a labelled horizontal slider row */
export function sliderRow(label, o) {
  const val = h('span', { class: 'val' });
  const fmt = o.fmt || ((v) => String(Math.round(v)));
  const s = slider({ ...o, onInput: (v) => { val.textContent = fmt(v); if (o.onInput) o.onInput(v); } });
  val.textContent = fmt(o.value);
  const row = h('div', { class: 'row-sl' }, h('span', { class: 'lab' }, label), s.el, val);
  return { el: row, set: (v) => { s.set(v); val.textContent = fmt(v); } };
}
export function toggle(label, on, onChange, sub) {
  const sw = h('span', { class: 'sw' + (on ? ' on' : '') });
  const row = h('button', { class: 'tog', type: 'button' }, h('span', { style: 'text-align:left' }, label, sub ? h('small', {}, sub) : null), sw);
  row.addEventListener('click', () => { on = !on; sw.classList.toggle('on', on); onChange(on); });
  return row;
}
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const render = () => {
    el.replaceChildren(...options.map(([v, label, ic]) => h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; render(); onChange(v); } }, ic ? h('span', { html: icon(ic, 16) }) : null, label)));
  };
  render();
  return el;
}

// ------------------------------------------------------------------ popover
let popState = null;
export function openPop(anchor, build, { onClose, place = 'auto' } = {}) {
  closePop();
  const pop = h('div', { id: 'pop', role: 'dialog' });
  document.body.append(pop);
  const close = () => closePop();
  pop.append(...[].concat(build(close)).filter(Boolean));
  const r = anchor.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const pw = Math.min(pop.offsetWidth || 340, W - 16), ph = pop.offsetHeight;
  let x, y;
  if (place === 'right' || (place === 'auto' && r.left < 120 && r.top > 80 && r.bottom < H - 120)) { x = r.right + 10; y = clamp(r.top + r.height / 2 - ph / 2, 8, H - ph - 8); }
  else if (r.top > H / 2) { x = clamp(r.left + r.width / 2 - pw / 2, 8, W - pw - 8); y = Math.max(8, r.top - ph - 10); }
  else { x = clamp(r.left + r.width / 2 - pw / 2, 8, W - pw - 8); y = Math.min(r.bottom + 10, H - ph - 8); }
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target) && !e.target.closest('#scrim')) closePop(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  popState = { pop, anchor, outside, onClose };
  return pop;
}
export function closePop() {
  if (!popState) return false;
  const { pop, outside, onClose } = popState;
  popState = null;
  document.removeEventListener('pointerdown', outside, true);
  pop.remove();
  if (onClose) onClose();
  return true;
}
export const popOpenFor = (anchor) => !!popState && popState.anchor === anchor;
export const popIsOpen = () => !!popState;

// ------------------------------------------------------------------ sheet (modal)
let sheetState = null;
export function openSheet(build, { wide = false, onClose, dismissable = true } = {}) {
  closeSheet();
  const sheet = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog' });
  const scrim = h('div', { id: 'scrim' }, sheet);
  const close = () => closeSheet();
  sheet.append(...[].concat(build(close)).filter(Boolean));
  if (dismissable) scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) closeSheet(); });
  document.body.append(scrim);
  sheetState = { scrim, onClose };
  return sheet;
}
export function closeSheet() {
  if (!sheetState) return false;
  const { scrim, onClose } = sheetState;
  sheetState = null;
  scrim.remove();
  if (onClose) onClose();
  return true;
}
export const sheetOpen = () => !!sheetState;
export function sheetHead(title, sub, close) {
  return h('div', { class: 'sheet-h' }, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : null), close ? h('button', { class: 'ib', 'aria-label': 'Close', onclick: close, html: icon('x') }) : null);
}
export function confirmSheet(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet((close) => [
      sheetHead(title, text),
      h('div', { class: 'btns', style: 'justify-content:flex-end;margin-top:8px' },
        h('button', { class: 'btn', onclick: () => { answered = true; close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'bad' : 'pri'), onclick: () => { answered = true; close(); resolve(true); } }, okLabel)),
    ], { onClose: () => { if (!answered) resolve(false); } });
  });
}

// ------------------------------------------------------------------ toasts
export function toast(text, ms = 2200) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  for (const t of box.children) if (t.textContent === text) return; // no duplicates piling up
  const t = h('div', { class: 'toast' }, text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}
