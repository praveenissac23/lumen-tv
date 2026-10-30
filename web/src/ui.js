// Shared UI pieces: icons, artwork, toast, dialogs, virtual list.
import { esc, el, initials, tint, $, hhmm } from './util.js';
import { isNative } from './native.js';
import { C, nowNext } from './data.js';
import { pushLayer, popLayer, focus, focusFirst, focusables } from './nav.js';

// ---------- icons (24px line icons, stroke = currentColor) ----------
const P = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  live: '<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="m8.5 2.5 3.5 3.5 3.5-3.5M8 21.5h8"/>',
  guide: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M9 9.5V20M15 14.5h6M9 14.5h3"/>',
  film: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M3.5 8h4M3.5 12h4M3.5 16h4M16.5 8h4M16.5 12h4M16.5 16h4"/>',
  series: '<rect x="3" y="7" width="15" height="13" rx="2"/><path d="M6.5 4h13a1.5 1.5 0 0 1 1.5 1.5V16"/><path d="m9 11 5 2.5L9 16z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  starFill: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor"/>',
  rewind: '<path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z" fill="currentColor" stroke="none"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.5l3 2"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.6L20 15.5M20 20v-4.5h-4.5"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-3 3.4M6.6 7.6A15.5 15.5 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>',
  tv: '<rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M8 21h8"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
  subtitles: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h3M12 12h5M7 15.5h6M15 15.5h2"/>',
  audio: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.3 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.3-3.5-8.5s1-5.9 3.5-8.5z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  downArrow: '<path d="m6 9 6 6 6-6"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------- artwork ----------
// On the TV, images go through the native thumbnail service (small JPEGs, cached on disk).
export function imgUrl(url, w) {
  if (!url) return '';
  return isNative ? `${window.__thumbBase || 'https://thumb.lumen/?'}w=${w}&u=${encodeURIComponent(url)}` : url;
}
// Channel logo with a monogram fallback; real logos load lazily and replace it.
export function logo(ch, size = '') {
  const t = tint(ch.name);
  const img = ch.logo ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(ch.logo, size === 'lg' ? 300 : 128))}" alt="" onerror="this.remove()">` : '';
  return `<span class="logo ${size}" style="--la:${t.a};--lb:${t.b};--li:${t.ink}"><b>${esc(initials(ch.name))}</b>${img}</span>`;
}

// Poster: real image, or generated typographic artwork from the title.
export function poster(item, landscape = false) {
  const t = tint(item.name);
  const img = item.img ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(item.img, landscape ? 960 : 320))}" alt="" onerror="this.remove()">` : '';
  const words = item.name.split(' ');
  return `<span class="art ${landscape ? 'land' : ''}" style="--la:${t.a};--lb:${t.b};--li:${t.ink}">
    <span class="art-title">${esc(words.length > 4 ? words.slice(0, 4).join(' ') + '…' : item.name)}</span>${img}</span>`;
}

// ---------- now/next slots ----------
// Guide data arrives asynchronously; these slots are re-rendered by patchNowSlots() on the 'epg' event.
export function nowInner(ch, style) {
  const nn = nowNext(ch);
  const cur = nn && nn.now;
  if (style === 'tile') return `<span class="ct-now">${esc(cur ? cur.t : nn ? 'No guide information' : '')}</span>${cur ? progressBar(cur.pct, 'thin') : ''}`;
  if (style === 'row') return `<small>${esc(cur ? cur.t : '')}</small>${cur ? progressBar(cur.pct, 'thin') : ''}`;
  if (style === 'time') return cur ? hhmm(cur.e) : '';
  if (style === 'hero') return `<h1>${esc(cur ? cur.t : ch.name)}</h1>
    ${cur ? `<div class="hero-time"><span>${hhmm(cur.s)}</span>${progressBar(cur.pct)}<span>${hhmm(cur.e)}</span><em>${minsLeft(cur.e)}</em></div>` : ''}
    ${nn && nn.next ? `<p class="hero-next">Next at ${hhmm(nn.next.s)}: ${esc(nn.next.t)}</p>` : ''}`;
  if (style === 'best') return `<span>${esc(cur ? 'Now: ' + cur.t : '')}</span>${cur ? progressBar(cur.pct) : ''}`;
  return '';
}
function minsLeft(endSec) {
  const m = Math.max(0, Math.round((endSec - Date.now() / 1000) / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`;
}
export function nowSlot(ch, style, cls = '') {
  return `<span class="nn nn-${style} ${cls}" data-nn="${esc(ch.id)}" data-nns="${style}">${nowInner(ch, style)}</span>`;
}
export function patchNowSlots(root = document) {
  for (const el of root.querySelectorAll('.nn')) {
    const ch = C.byId.live.get(el.dataset.nn);
    if (ch) el.innerHTML = nowInner(ch, el.dataset.nns);
  }
}

export const stars = (r) => (r ? `<span class="rating">${icon('starFill')}${(+r).toFixed(1)}</span>` : '');
export const progressBar = (pct, cls = '') => `<span class="bar ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%"></i></span>`;

// ---------- toast ----------
let toastT;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.className = 'toast show ' + kind;
  t.textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = 'toast'), 2600);
}

// ---------- option sheet (context menu) ----------
export function sheet({ title, options, focusIndex = 0 }) {
  return new Promise((resolve) => {
    clearTimeout(toastT); $('#toast').className = 'toast';
    const root = el(`<div class="sheet-wrap" data-trap><div class="sheet">
      <h2>${esc(title)}</h2>
      <div class="sheet-list">${options.map((o, i) => `<button class="f sheet-item ${o.on ? 'on' : ''}" data-i="${i}">
        ${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}${o.on ? icon('check', 'tick') : ''}</button>`).join('')}</div>
    </div></div>`);
    document.getElementById('overlays').appendChild(root);
    const close = (v) => { popLayer(layer); root.remove(); resolve(v); };
    const layer = { root, modal: true, onKey: (k) => { if (k === 'back' || k === 'menu') { close(null); return true; } return false; } };
    root.addEventListener('click', (e) => { const b = e.target.closest('.sheet-item'); if (b) close(options[+b.dataset.i].value ?? +b.dataset.i); });
    pushLayer(layer);
    focus(root.querySelectorAll('.sheet-item')[focusIndex] || root.querySelector('.sheet-item'));
  });
}

// ---------- PIN pad ----------
export function pinPad({ title = 'Enter PIN', subtitle = 'This category is locked', check }) {
  return new Promise((resolve) => {
    let val = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    const root = el(`<div class="sheet-wrap center" data-trap><div class="sheet pin">
      <div class="pin-head">${icon('lock')}<div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></div>
      <div class="pin-dots">${'<i></i>'.repeat(4)}</div>
      <div class="pin-grid">${keys.map((k) => `<button class="f pin-key ${k.length > 1 ? 'fn' : ''}" data-k="${k}">${k === 'del' ? icon('back') : k === 'ok' ? icon('check') : k}</button>`).join('')}</div>
    </div></div>`);
    document.getElementById('overlays').appendChild(root);
    const dots = root.querySelectorAll('.pin-dots i');
    const paint = (err) => { dots.forEach((d, i) => d.classList.toggle('on', i < val.length)); root.querySelector('.pin').classList.toggle('err', !!err); };
    const close = (v) => { popLayer(layer); root.remove(); resolve(v); };
    const submit = () => {
      if (check(val)) close(true);
      else { val = ''; paint(true); setTimeout(() => paint(false), 500); }
    };
    const press = (k) => {
      if (k === 'del') val = val.slice(0, -1);
      else if (k === 'ok') return submit();
      else if (val.length < 4) val += k;
      paint();
      if (val.length === 4) setTimeout(submit, 120);
    };
    const layer = { root, modal: true, onKey: (k) => {
      if (k === 'back') { close(false); return true; }
      if (/^d\d$/.test(k)) { press(k.slice(1)); return true; }
      return false;
    } };
    root.addEventListener('click', (e) => { const b = e.target.closest('.pin-key'); if (b) press(b.dataset.k); });
    pushLayer(layer);
    focus(root.querySelector('[data-k="5"]'));
  });
}

// ---------- text input dialog (for playlist details on TV) ----------
export function form({ title, fields, submit = 'Save', note = '' }) {
  return new Promise((resolve) => {
    const root = el(`<div class="sheet-wrap center" data-trap><div class="sheet form">
      <h2>${esc(title)}</h2>${note ? `<p class="form-note">${esc(note)}</p>` : ''}
      ${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span>
        <input class="f" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`).join('')}
      <div class="form-actions"><button class="f btn primary" data-a="ok">${esc(submit)}</button><button class="f btn" data-a="cancel">Cancel</button></div>
      <p class="form-err" hidden></p>
    </div></div>`);
    document.getElementById('overlays').appendChild(root);
    const close = (v) => { popLayer(layer); root.remove(); resolve(v); };
    const values = () => Object.fromEntries(fields.map((f) => [f.name, root.querySelector(`[name="${f.name}"]`).value.trim()]));
    const err = root.querySelector('.form-err');
    const ok = async () => {
      const v = values();
      if (fields.some((f) => f.required && !v[f.name])) { err.hidden = false; err.textContent = 'Fill in every required field.'; return; }
      close(v);
    };
    const layer = { root, modal: true, onKey: (k, e) => {
      if (k === 'back') { close(null); return true; }
      if (k === 'submit') { const inputs = [...root.querySelectorAll('input')]; const i = inputs.indexOf(document.activeElement);
        if (i >= 0 && i < inputs.length - 1) focus(inputs[i + 1]); else focus(root.querySelector('[data-a="ok"]')); return true; }
      return false;
    } };
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'ok') ok(); else close(null); });
    pushLayer(layer);
    focusFirst(root);
  });
}

// ---------- virtual list (fixed row height, D-pad aware) ----------
// Renders only visible rows; owns up/down inside itself.
export class VList {
  constructor(host, { rowH, render, onFocus, onSelect, overscan = 3, group }) {
    Object.assign(this, { host, rowH, render, onFocus, onSelect, overscan });
    host.classList.add('vlist');
    if (group) host.dataset.group = group;
    host.innerHTML = '<div class="vtrack"></div>';
    this.track = host.firstChild;
    this.items = []; this.index = 0; this.top = 0;
    this.track.addEventListener('click', (e) => {
      const r = e.target.closest('[data-vi]');
      if (r) { this.index = +r.dataset.vi; onSelect && onSelect(this.items[this.index], this.index); }
    });
    this.track.addEventListener('focused', (e) => {
      const r = e.target.closest('[data-vi]');
      if (r && +r.dataset.vi !== this.index) { this.index = +r.dataset.vi; this.ensure(); onFocus && onFocus(this.items[this.index], this.index); }
    });
  }
  setItems(items, index = 0) {
    this.items = items;
    this.index = Math.max(0, Math.min(index, items.length - 1));
    this.track.style.height = items.length * this.rowH + 'px';
    this.top = -1;
    this.ensure(true);
  }
  get rowsVisible() { return Math.min(Math.ceil(1080 / this.rowH) + 1, Math.ceil(this.host.offsetHeight / this.rowH) + 1); }
  ensure(force) {
    const vis = Math.max(1, Math.min(Math.floor(1080 / this.rowH), Math.floor(this.host.offsetHeight / this.rowH))); // fully visible rows
    let top = this.top < 0 ? 0 : this.top;
    if (this.index < top + 1) top = this.index - 1;
    if (this.index > top + vis - 2) top = this.index - vis + 2;
    top = Math.max(0, Math.min(top, Math.max(0, this.items.length - vis)));
    if (top === this.top && !force) return;
    this.top = top;
    this.track.style.transform = `translate3d(0,${-top * this.rowH}px,0)`;
    this.paint();
  }
  paint() {
    const from = Math.max(0, this.top - this.overscan), to = Math.min(this.items.length, this.top + this.rowsVisible + this.overscan);
    const had = document.activeElement && this.track.contains(document.activeElement);
    let html = '';
    for (let i = from; i < to; i++) html += `<div class="vrow" style="top:${i * this.rowH}px;height:${this.rowH}px">${this.render(this.items[i], i).replace('class="f', `data-vi="${i}" class="f`)}</div>`;
    this.track.innerHTML = html;
    if (had) this.focusIndex(this.index, true);
  }
  node(i) { return this.track.querySelector(`[data-vi="${i}"]`); }
  focusIndex(i, silent) {
    this.index = Math.max(0, Math.min(i, this.items.length - 1));
    this.ensure();
    const n = this.node(this.index);
    if (n) { n.focus({ preventScroll: true }); if (this.host.dataset.group) this.host._last = n; }
    if (!silent && this.onFocus) this.onFocus(this.items[this.index], this.index);
  }
  has(elm) { return this.track.contains(elm); }
  // returns true if handled
  key(k) {
    if (!this.has(document.activeElement)) return false;
    if (k === 'up') { if (this.index === 0) return false; this.focusIndex(this.index - 1); return true; }
    if (k === 'down') { if (this.index >= this.items.length - 1) return true; this.focusIndex(this.index + 1); return true; }
    if (k === 'chup' || k === 'pgup') { this.focusIndex(this.index - this.rowsVisible + 3); return true; }
    if (k === 'chdown' || k === 'pgdown') { this.focusIndex(this.index + this.rowsVisible - 3); return true; }
    return false;
  }
  refresh() { this.paint(); }
}

// ---------- virtual grid (fixed cell size) ----------
export class VGrid {
  constructor(host, { cols, cellH, render, onSelect, onFocus, group }) {
    Object.assign(this, { host, cols, cellH, render, onSelect, onFocus });
    host.classList.add('vgrid');
    if (group) host.dataset.group = group;
    host.innerHTML = '<div class="vtrack"></div>';
    this.track = host.firstChild;
    this.items = []; this.index = 0; this.topRow = -1;
    this.track.addEventListener('click', (e) => {
      const c = e.target.closest('[data-vi]');
      if (c) { this.index = +c.dataset.vi; onSelect && onSelect(this.items[this.index], this.index); }
    });
    this.track.addEventListener('focused', (e) => {
      const c = e.target.closest('[data-vi]');
      if (c) { this.index = +c.dataset.vi; this.ensure(); onFocus && onFocus(this.items[this.index], this.index); }
    });
  }
  setItems(items, index = 0) {
    this.items = items; this.index = Math.min(index, Math.max(0, items.length - 1));
    this.track.style.height = Math.ceil(items.length / this.cols) * this.cellH + 'px';
    this.topRow = -1; this.ensure(true);
  }
  get rowsVisible() { return Math.min(Math.ceil(1080 / this.cellH) + 1, Math.ceil(this.host.offsetHeight / this.cellH)); }
  ensure(force) {
    const row = Math.floor(this.index / this.cols);
    const vis = Math.max(1, Math.min(Math.floor(1080 / this.cellH), Math.floor(this.host.offsetHeight / this.cellH)));
    let top = this.topRow < 0 ? 0 : this.topRow;
    if (row < top) top = row;
    if (row > top + vis - 1) top = row - vis + 1;
    if (top === this.topRow && !force) return;
    this.topRow = top;
    this.track.style.transform = `translate3d(0,${-top * this.cellH}px,0)`;
    this.paint();
  }
  paint() {
    const from = Math.max(0, (this.topRow - 1) * this.cols);
    const to = Math.min(this.items.length, (this.topRow + this.rowsVisible + 2) * this.cols);
    const had = document.activeElement && this.track.contains(document.activeElement);
    const w = 100 / this.cols;
    let html = '';
    for (let i = from; i < to; i++) {
      const r = Math.floor(i / this.cols), c = i % this.cols;
      html += `<div class="vcell" style="top:${r * this.cellH}px;left:${c * w}%;width:${w}%;height:${this.cellH}px">${this.render(this.items[i], i).replace('class="f', `data-vi="${i}" class="f`)}</div>`;
    }
    this.track.innerHTML = html;
    if (had) this.focusIndex(this.index, true);
  }
  focusIndex(i, silent) {
    this.index = Math.max(0, Math.min(i, this.items.length - 1));
    this.ensure();
    const n = this.track.querySelector(`[data-vi="${this.index}"]`);
    if (n) { n.focus({ preventScroll: true }); if (this.host.dataset.group) this.host._last = n; }
    if (!silent && this.onFocus) this.onFocus(this.items[this.index], this.index);
  }
  has(elm) { return this.track.contains(elm); }
  key(k) {
    if (!this.has(document.activeElement)) return false;
    const c = this.index % this.cols;
    if (k === 'left') { if (c === 0) return false; this.focusIndex(this.index - 1); return true; }
    if (k === 'right') { if (c === this.cols - 1 || this.index === this.items.length - 1) return true; this.focusIndex(this.index + 1); return true; }
    if (k === 'up') { if (this.index < this.cols) return false; this.focusIndex(this.index - this.cols); return true; }
    if (k === 'down') { if (this.index + this.cols >= this.items.length) { if (Math.floor(this.index / this.cols) < Math.floor((this.items.length - 1) / this.cols)) this.focusIndex(this.items.length - 1); return true; } this.focusIndex(this.index + this.cols); return true; }
    if (k === 'chdown') { this.focusIndex(this.index + this.cols * 3); return true; }
    if (k === 'chup') { this.focusIndex(this.index - this.cols * 3); return true; }
    return false;
  }
}

export { focusables };
