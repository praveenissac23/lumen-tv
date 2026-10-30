// TV guide: programme grid with time ruler, now line, preview and catch-up.
import { C, progs, nowNext, itemsIn, visibleCats, needsPin } from '../data.js';
import { S, isFav, toggleFav } from '../store.js';
import { esc, hhmm, now, dayLabel, debounce, minutesLeft } from '../util.js';
import { focus } from '../nav.js';
import { icon, logo, progressBar, toast, sheet } from '../ui.js';
import { preview, stopPreview, playLive, playCatchup } from '../player.js';
import { rectOf } from './home.js';
import { itemActions } from '../actions.js';

const PX_MIN = 8.5;             // pixels per minute
const ROW_H = 88;
const GRID_W = 1276;            // timeline width in px
const WIN = GRID_W / PX_MIN * 60; // seconds visible
const SLOT = 1800;

export class GuideScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    const r = params.restore || {};
    this.cat = r.cat || (S.favs.live.length ? '__fav' : '__all');
    this.channels = itemsIn('live', this.cat);
    if (!this.channels.length) { this.cat = '__all'; this.channels = C.live; }
    const t = now();
    this.ft = r.ft || t;                     // focused time
    this.ws = r.ws || Math.floor((t - 1800) / SLOT) * SLOT; // window start
    let ci = 0;
    if (params.ch) ci = this.channels.findIndex((c) => String(c.id) === String(params.ch));
    this.ci = r.ci != null ? r.ci : Math.max(0, ci);
    this.top = Math.max(0, this.ci - 2);
    this.previewDeb = debounce(() => this.startPreview(), 700);
    this.render();
    this.view.addEventListener('click', (e) => {
      const b = e.target.closest('.g-prog');
      if (b) { this.ci = +b.dataset.ci; this.ft = Math.max(+b.dataset.s, Math.min(this.ft, +b.dataset.e - 1)); this.select(); }
    });
    this.tick = setInterval(() => this.paintNowLine(), 30000);
  }

  get rowsVisible() { return 7; }

  render() {
    const catName = this.cat === '__fav' ? 'Favourites' : this.cat === '__all' ? 'All channels' : (C.cats.live.find((c) => c.id === this.cat)?.name || '');
    this.view.innerHTML = `
      <div class="gd">
        <header class="gd-head">
          <div class="gd-detail" id="gd-detail"></div>
          <div class="gd-pv" id="gd-pv"><div class="preview-msg" hidden></div></div>
        </header>
        <div class="gd-ruler"><div class="gd-day"><b id="gd-day"></b><small>${esc(catName)}</small></div><div class="gd-times" id="gd-times"></div></div>
        <div class="gd-grid" id="gd-grid"></div>
        <p class="gd-help"><span><b>OK</b> Watch or catch up</span><span><b>${icon('list')}</b> Change day or category</span><span><b>Hold OK</b> Favourite, external player, copy link</span></p>
      </div>`;
    this.paint();
  }

  paint() {
    const t = now();
    const ws = this.ws, we = ws + WIN;
    // ruler
    let times = '';
    for (let s = ws; s < we - 900; s += SLOT) times += `<span style="left:${((s - ws) / 60) * PX_MIN}px">${hhmm(s)}</span>`;
    this.view.querySelector('#gd-times').innerHTML = times;
    this.view.querySelector('#gd-day').textContent = dayLabel(this.ft);
    // rows
    const vis = this.rowsVisible;
    if (this.ci < this.top) this.top = this.ci;
    if (this.ci > this.top + vis - 1) this.top = this.ci - vis + 1;
    const rows = this.channels.slice(this.top, this.top + vis);
    let html = '';
    rows.forEach((ch, k) => {
      const ci = this.top + k;
      const locked = needsPin('live', ch.cat);
      const list = locked ? [] : progs(ch);
      let cells = '';
      let any = false;
      for (const p of list) {
        if (p[1] <= ws || p[0] >= we) continue;
        any = true;
        const x = Math.max(0, (p[0] - ws) / 60) * PX_MIN;
        const x2 = Math.min(WIN, p[1] - ws) / 60 * PX_MIN;
        const w = Math.max(4, x2 - x - 4);
        const live = p[0] <= t && p[1] > t, past = p[1] <= t;
        cells += `<button class="f g-prog ${live ? 'live' : ''} ${past ? 'past' : ''} ${past && ch.arch ? 'cu' : ''}" data-ci="${ci}" data-s="${p[0]}" data-e="${p[1]}" style="left:${x}px;width:${w}px">
          <b>${esc(p[2])}</b>${w > 150 ? `<small>${hhmm(p[0])}–${hhmm(p[1])}</small>` : ''}${past && ch.arch && w > 60 ? icon('history', 'cu-ic') : ''}</button>`;
      }
      if (!any) cells = `<button class="f g-prog empty" data-ci="${ci}" data-s="${ws}" data-e="${we}" style="left:0;width:${GRID_W - 4}px"><b>${locked ? 'Locked' : 'No guide information'}</b></button>`;
      html += `<div class="g-row ${ci === this.ci ? 'cur' : ''}">
        <div class="g-ch">${logo(ch, 'sm')}<span class="num">${ch.num}</span><b>${esc(ch.name)}</b></div>
        <div class="g-line">${cells}</div></div>`;
    });
    const grid = this.view.querySelector('#gd-grid');
    grid.innerHTML = html + `<i class="now-line" id="now-line"></i>`;
    this.paintNowLine();
    this.focusCell();
  }

  paintNowLine() {
    const l = this.view.querySelector('#now-line');
    if (!l) return;
    const x = ((now() - this.ws) / 60) * PX_MIN;
    l.style.display = x < 0 || x > GRID_W ? 'none' : 'block';
    l.style.left = 380 + x + 'px';
  }

  cellsOf(ci) { return [...this.view.querySelectorAll(`.g-prog[data-ci="${ci}"]`)]; }

  focusCell() {
    const cells = this.cellsOf(this.ci);
    let best = cells.find((c) => +c.dataset.s <= this.ft && +c.dataset.e > this.ft) || cells.find((c) => +c.dataset.s >= this.ft) || cells[cells.length - 1];
    if (!best) return;
    focus(best, { noScroll: true });
    this.cur = best;
    this.showDetail();
  }

  progAt() {
    const ch = this.channels[this.ci];
    const p = progs(ch).find((x) => x[0] <= this.ft && x[1] > this.ft);
    return p ? { s: p[0], e: p[1], t: p[2], d: p[3] } : null;
  }

  showDetail() {
    const ch = this.channels[this.ci];
    if (!ch) return;
    const c = this.cur;
    const s = +c.dataset.s, e = +c.dataset.e, t = now();
    const p = progs(ch).find((x) => x[0] === s);
    const locked = needsPin('live', ch.cat);
    const live = s <= t && e > t, past = e <= t;
    this.view.querySelector('#gd-detail').innerHTML = `
      <div class="pv-ch">${logo(ch, 'md')}<div><b>${esc(ch.name)}</b><small>Channel ${ch.num}</small></div></div>
      <h1>${esc(p ? p[2] : locked ? 'Locked channel' : 'No guide information')}</h1>
      ${p ? `<p class="gd-when">${live ? '<span class="tag live">Live</span>' : past ? (ch.arch ? '<span class="tag cu">Catch-up</span>' : '<span class="tag">Ended</span>') : '<span class="tag">Upcoming</span>'}
        ${dayLabel(s)} ${hhmm(s)}–${hhmm(e)}${live ? `, ${minutesLeft(e)}` : ''}</p>
        ${live ? progressBar((t - s) / (e - s)) : ''}
        ${p[3] ? `<p class="pv-desc">${esc(p[3])}</p>` : ''}` : ''}`;
    this.previewDeb();
  }

  startPreview() {
    const ch = this.channels[this.ci];
    if (!ch || needsPin('live', ch.cat)) { stopPreview(); return; }
    const r = rectOf(this.view.querySelector('#gd-pv'));
    if (r) preview(ch, r);
  }

  move(dir) {
    const cells = this.cellsOf(this.ci);
    const i = cells.indexOf(this.cur);
    if (dir === 'right') {
      const c = this.cur;
      const e = +c.dataset.e;
      if (i < cells.length - 1 && +cells[i + 1].dataset.s < this.ws + WIN - 600) { this.ft = +cells[i + 1].dataset.s; this.focusCell(); return; }
      this.ws += SLOT * 2; this.ft = Math.max(e, this.ft + 1); this.paint(); return;
    }
    if (dir === 'left') {
      const s = +this.cur.dataset.s;
      if (i > 0 && s > this.ws) { this.ft = +cells[i - 1].dataset.s; if (this.ft < this.ws) { this.ws = Math.floor(this.ft / SLOT) * SLOT; this.paint(); } else this.focusCell(); return; }
      const minWs = now() - 3 * 86400;
      if (this.ws <= minWs) { focus(document.querySelector('#rail [data-go="guide"]')); return; }
      this.ws -= SLOT * 2; this.ft = Math.min(this.ft, this.ws + WIN - 1); this.ft = Math.max(this.ws, s - 1); this.paint(); return;
    }
    if (dir === 'up' || dir === 'down') {
      const n = this.ci + (dir === 'up' ? -1 : 1);
      if (n < 0 || n >= this.channels.length) return;
      // keep the time cursor, clamped into the visible window
      this.ft = Math.max(this.ft, this.ws);
      this.ci = n;
      this.paint();
    }
  }

  async select() {
    const ch = this.channels[this.ci];
    if (!(await this.app.ensureUnlocked('live', ch.cat))) return;
    const s = +this.cur.dataset.s, e = +this.cur.dataset.e, t = now();
    const p = progs(ch).find((x) => x[0] === s);
    const back = () => this.app.reload();
    if (!p || (s <= t && e > t)) { playLive(ch, this.channels, back); return; }
    if (e <= t) {
      if (ch.arch && t - s < ch.arch * 86400) { playCatchup(ch, { s, e, t: p[2], d: p[3] }, this.channels, back); return; }
      toast('Catch-up isn’t available for this channel'); return;
    }
    toast(`${p[2]} starts ${dayLabel(s).toLowerCase()} at ${hhmm(s)}`);
  }

  async options() {
    const opts = [
      { label: 'Jump to now', icon: 'live', value: 'now' },
      { label: 'Yesterday evening', icon: 'history', value: 'yest' },
      { label: 'Tomorrow evening', icon: 'guide', value: 'tom' },
      { label: 'Favourites', icon: 'heart', value: 'cat:__fav', on: this.cat === '__fav' },
      { label: 'All channels', icon: 'list', value: 'cat:__all', on: this.cat === '__all' },
      ...visibleCats('live').map((c) => ({ label: c.name, value: 'cat:' + c.id, on: this.cat === c.id, icon: needsPin('live', c.id) ? 'lock' : 'tv' })),
    ];
    const v = await sheet({ title: 'TV guide', options: opts });
    if (!v) { this.focusCell(); return; }
    const d0 = new Date(); d0.setHours(20, 0, 0, 0);
    const eve = d0.getTime() / 1000;
    if (v === 'now') { this.ft = now(); this.ws = Math.floor((this.ft - 1800) / SLOT) * SLOT; }
    else if (v === 'yest') { this.ft = eve - 86400; this.ws = this.ft - 1800; }
    else if (v === 'tom') { this.ft = eve + 86400; this.ws = this.ft - 1800; }
    else if (v.startsWith('cat:')) {
      const id = v.slice(4);
      if (!(await this.app.ensureUnlocked('live', id))) { this.focusCell(); return; }
      const list = itemsIn('live', id);
      if (!list.length) { toast('No channels in this category'); this.focusCell(); return; }
      this.cat = id; this.channels = list; this.ci = 0; this.top = 0;
      this.render(); return;
    }
    this.paint();
  }

  onKey(k) {
    const a = document.activeElement;
    if (!a || !a.classList.contains('g-prog')) return false;
    if (['left', 'right', 'up', 'down'].includes(k)) { this.move(k); return true; }
    if (k === 'ok') { this.select(); return true; }
    if (k === 'chup') { this.ci = Math.max(0, this.ci - this.rowsVisible); this.paint(); return true; }
    if (k === 'chdown') { this.ci = Math.min(this.channels.length - 1, this.ci + this.rowsVisible); this.paint(); return true; }
    if (k === 'hold') { itemActions('live', this.channels[this.ci], this.app, { list: this.channels }).then((c) => c && this.paint()); return true; }
    if (k === 'menu') { this.options(); return true; }
    return false;
  }

  focus() { this.focusCell(); }
  save() { return { cat: this.cat, ci: this.ci, ft: this.ft, ws: this.ws }; }
  destroy() { clearInterval(this.tick); this.previewDeb.cancel(); stopPreview(); }
}
