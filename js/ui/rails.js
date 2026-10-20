// "Ideas": picture rails on the left and right edges (wide screens) or a sheet (phones), plus floating reference cards you
// can drag around, resize, trace onto the canvas, or send to your partner's screen.
import { h, clamp } from '../util.js';
import { icon } from '../icons.js';
import { CATEGORIES, itemsIn, svgUrl, nameOf, aspectOf } from '../library.js';
import { openPop, closePop, openSheet, sheetHead } from './widgets.js';
import { prefs } from '../store.js';

export class Ideas {
  constructor(app) {
    this.app = app; this.cardsEl = h('div', { id: 'cards' }); document.body.append(this.cardsEl);
    this.cards = new Map(); this.n = 0; this.z = 1;
    this.fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { this.addPhotos([...e.target.files]); e.target.value = ''; } });
    document.body.append(this.fileIn);
    this.rails = [this._rail('left', prefs.get('railL', 'Animals')), this._rail('right', prefs.get('railR', 'Love'))];
  }
  _rail(side, cat) {
    const sel = h('select', { 'aria-label': 'Picture category', onchange: (e) => { r.cat = e.target.value; prefs.set(side === 'left' ? 'railL' : 'railR', r.cat); this._fill(r); } }, CATEGORIES.map((c) => h('option', { value: c, selected: c === cat }, c)));
    const thumbs = h('div', { class: 'thumbs' });
    const el = h('aside', { class: 'rail bar ' + side, 'aria-label': 'Ideas' }, sel, thumbs);
    document.body.append(el);
    const r = { side, cat, el, thumbs };
    this._fill(r);
    return r;
  }
  _fill(r) { r.thumbs.replaceChildren(...this.thumbsFor(r.cat)); }
  refresh() { for (const r of this.rails) this._fill(r); if (this.sheetRefresh) this.sheetRefresh(); }
  thumbsFor(cat) {
    if (cat === 'My photos') {
      const add = h('button', { class: 'thumb add', onclick: () => this.fileIn.click() }, h('span', { html: icon('camera', 24) }), 'Add photo');
      return [add, ...this.app.photoList.map((p) => this._thumb({ src: 'ph:' + p.id, name: p.name || 'Photo', data: p.data }))];
    }
    return itemsIn(cat).map((it) => this._thumb(it));
  }
  _thumb(it) {
    const inner = it.emoji ? h('span', { class: 'em' }, it.emoji) : h('img', { src: it.svg ? svgUrl(it.svg) : it.data, alt: it.name, loading: 'lazy', draggable: false });
    return h('button', { class: 'thumb', title: it.name, onclick: () => { this.openCard(it.src); if (this.closeSheet) this.closeSheet(); } }, inner);
  }
  /** rails show on wide screens when enabled */
  layout() {
    const on = this.app.settings.rails && innerWidth > 900;
    for (const r of this.rails) r.el.hidden = !on;
    document.documentElement.style.setProperty('--railW', on ? (innerWidth > 1100 ? 106 : 94) + 'px' : '0px');
    return on;
  }
  /** phones: the same pictures in a sheet with tabs */
  sheet() {
    let cat = prefs.get('ideasTab', 'Animals');
    openSheet((close) => {
      this.closeSheet = close;
      const grid = h('div', { class: 'ideas-grid' }), tabs = h('div', { class: 'tabs' });
      const render = () => {
        tabs.replaceChildren(...CATEGORIES.map((c) => h('button', { class: c === cat ? 'on' : '', onclick: () => { cat = c; prefs.set('ideasTab', c); render(); } }, c)));
        grid.replaceChildren(...this.thumbsFor(cat));
      };
      this.sheetRefresh = render;
      render();
      return [sheetHead('Ideas to draw', 'Tap a picture to keep it open while you draw, trace it, or show it to your partner.', close), tabs, h('div', { style: 'height:10px' }), grid];
    }, { wide: true, onClose: () => { this.closeSheet = null; this.sheetRefresh = null; } });
  }

  async addPhotos(files) {
    for (const f of files.slice(0, 12)) {
      try {
        const p = await this.app.addPhotoFile(f);
        if (p && files.length === 1) this.openCard('ph:' + p.id);
      } catch (e) { this.app.toast('Could not read that picture'); }
    }
    this.refresh();
  }

  // ---------------------------------------------------------------- floating cards
  openCard(src, { from } = {}) {
    const ex = this.cards.get(src);
    if (ex) { this.front(ex.el); ex.el.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 200 }); return; }
    const app = this.app, small = innerWidth < 600;
    let w = small ? 190 : 260;
    const imgBox = h('div', { class: 'rimg' });
    const setImg = (im) => {
      imgBox.replaceChildren(im instanceof HTMLCanvasElement ? cloneCanvas(im) : h('img', { src: im.src, alt: '', draggable: false }));
      card.aspect = aspectOf(im); size();
    };
    const im = app.refImage(src, (img) => setImg(img));
    const name = nameOf(src);
    const head = h('div', { class: 'rh' },
      h('span', { class: 'grow' }, name, from ? h('span', { class: 'from' }, ` · from ${from}`) : null),
      app.partner ? h('button', { class: 'ib', title: `Show ${app.partner.name}`, html: icon('send', 17), onclick: () => { app.sendCard(src); app.toast(`Sent to ${app.partner.name}`); } }) : null,
      h('button', { class: 'ib', title: 'Close', html: icon('x', 18), onclick: () => close() }));
    const traceBtn = h('button', { class: 'btn sm pri', onclick: () => this.traceMenu(traceBtn, src) }, h('span', { html: icon('image', 16) }), 'Trace');
    const foot = h('div', { class: 'rf' }, traceBtn, h('button', { class: 'btn sm', onclick: (e) => this.colorsMenu(e.currentTarget, src) }, h('span', { html: icon('palette', 16) }), 'Colours'));
    const grip = h('div', { class: 'rs', title: 'Resize' });
    const el = h('div', { class: 'refcard' }, head, imgBox, foot, grip);
    const card = { el, src, aspect: 1 };
    const railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--railW')) || 0;
    let x = small ? innerWidth - w - 10 : innerWidth - w - railW - 24 - (this.n % 4) * 26, y = (small ? 120 : 140) + (this.n % 4) * 30;
    this.n++;
    const size = () => {
      w = clamp(w, 150, Math.min(innerWidth - 20, 640));
      const ih = clamp(w / (card.aspect || 1), 90, innerHeight * 0.6);
      el.style.width = w + 'px'; imgBox.style.height = ih + 'px';
      x = clamp(x, 4 - w * 0.6, innerWidth - 60); y = clamp(y, 4, innerHeight - 60);
      el.style.left = x + 'px'; el.style.top = y + 'px';
    };
    const close = () => { el.remove(); this.cards.delete(src); };
    card.close = close;
    dragHandle(head, (dx, dy) => { x += dx; y += dy; size(); }, () => this.front(el));
    dragHandle(grip, (dx) => { w += dx; size(); });
    // bring to front with z-index: moving the element in the page during a press would swallow the button's click
    el.addEventListener('pointerdown', () => this.front(el));
    if (im) setImg(im); else size();
    this.cardsEl.append(el); this.front(el);
    this.cards.set(src, card);
    return card;
  }
  front(el) { el.style.zIndex = String(++this.z); }
  traceMenu(anchor, src) {
    const app = this.app;
    openPop(anchor, (close) => {
      const go = (where) => { close(); app.addTrace(src, where); };
      const b = (label, where) => h('button', { class: 'btn sm', style: 'width:100%;justify-content:flex-start', onclick: () => go(where) }, label);
      const split = app.modes.id === 'split' || app.modes.id === 'challenge';
      return [h('div', { class: 'pop-h' }, h('h3', {}, 'Trace where?')),
        h('p', { class: 'small', style: 'margin:0 0 10px' }, 'The picture appears faintly under the drawing for both of you. Fine-tune it in Layers → Trace pictures.'),
        h('div', { style: 'display:grid;gap:6px' },
          split ? b('🙋 My side', 'mine') : null, split ? b('💞 Their side', 'theirs') : null,
          b('Whole page', 'all'), b('Left half', 'left'), b('Right half', 'right'), b('Top half', 'top'), b('Bottom half', 'bottom'), b('Small, in the middle', 'center'))];
    });
  }
  colorsMenu(anchor, src) {
    const app = this.app, cols = app.paletteFrom(src);
    openPop(anchor, (close) => [h('div', { class: 'pop-h' }, h('h3', {}, 'Colours in this picture')),
      cols.length ? h('div', { class: 'sws' }, cols.map((c) => h('button', { style: { background: c }, title: c, onclick: () => { app.setColor(c, true); close(); } }))) : h('p', { class: 'small' }, 'Still loading, try again in a moment.')]);
  }
  closeAll() { for (const c of [...this.cards.values()]) c.close(); closePop(); }
}

function cloneCanvas(c) { const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; d.getContext('2d').drawImage(c, 0, 0); return d; }
function dragHandle(el, onMove, onStart) {
  let last = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault(); last = [e.clientX, e.clientY]; try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } if (onStart) onStart();
  });
  el.addEventListener('pointermove', (e) => { if (!last) return; onMove(e.clientX - last[0], e.clientY - last[1]); last = [e.clientX, e.clientY]; });
  const end = () => { last = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
