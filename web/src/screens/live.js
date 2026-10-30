// Live TV: categories | channels | preview with now/next and catch-up list.
import { C, nowNext, itemsIn, visibleCats, progs, needsPin, catOf } from '../data.js';
import { S, isFav, toggleFav, setLocked, isLocked, setHidden, setting } from '../store.js';
import { esc, hhmm, now, minutesLeft, debounce, dayLabel } from '../util.js';
import { focus } from '../nav.js';
import { icon, logo, progressBar, VList, toast, sheet, nowSlot, patchNowSlots } from '../ui.js';
import { preview, stopPreview, playLive, playCatchup } from '../player.js';
import { rectOf } from './home.js';
import { langCatEntries } from '../languages.js';
import { itemActions } from '../actions.js';
import { isPinned, togglePin } from '../store.js';

export class LiveScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    const r = params.restore || {};
    this.cat = r.cat || (params.screen === 'favourites' ? '__fav' : params.lang ? '__lang:' + params.lang : params.cat || (S.favs.live.length ? '__fav' : '__all'));
    this.render();
    this.cats = this.catList();
    this.catList_ = new VList(view.querySelector('.lv-cats'), {
      rowH: 76, group: 'cats',
      render: (c) => `<button class="f cat-row ${c.id === this.cat ? 'on' : ''}">${c.icon ? icon(c.icon) : ''}<span>${esc(c.name)}</span>${isPinned('live', c.id) ? icon('pin', 'pinmark') : ''}
        ${needsPin('live', c.id) ? icon('lock', 'lockmark') : `<small>${c.count}</small>`}</button>`,
      onSelect: (c) => this.pickCat(c.id, true),
      onFocus: debounce((c) => this.pickCat(c.id, false), 260),
    });
    this.chList = new VList(view.querySelector('.lv-chans'), {
      rowH: 104, group: 'chans',
      render: (ch) => this.chRow(ch),
      onSelect: (ch) => this.watch(ch),
      onFocus: (ch) => this.showInfo(ch),
    });
    this.catList_.setItems(this.cats, Math.max(0, this.cats.findIndex((c) => c.id === this.cat)));
    this.previewDeb = debounce((ch) => this.startPreview(ch), 650);
    this.loadChannels(r.ch);
    view.addEventListener('click', (e) => {
      const p = e.target.closest('.prog-row');
      if (p && p.dataset.cu) { const prog = this.progRows[+p.dataset.i]; playCatchup(this.infoCh, prog, this.channels, () => this.app.reload()); }
    });
  }

  catList() {
    const counts = new Map();
    for (const ch of C.live) counts.set(ch.cat, (counts.get(ch.cat) || 0) + 1);
    return [
      { id: '__fav', name: 'Favourites', icon: 'heart', count: itemsIn('live', '__fav').length },
      { id: '__recent', name: 'Recently watched', icon: 'history', count: itemsIn('live', '__recent').length },
      { id: '__all', name: 'All channels', icon: 'list', count: C.live.length },
      ...langCatEntries('live'),
      ...visibleCats('live').map((c) => ({ ...c, count: counts.get(c.id) || 0 })),
    ];
  }

  render() {
    this.view.innerHTML = `
      <div class="lv">
        <section class="lv-col lv-catcol"><h2 class="col-h">Live TV</h2><div class="lv-cats"></div></section>
        <section class="lv-col lv-chcol"><h2 class="col-h" id="lv-cattitle"></h2><div class="lv-chans"></div>
          <p class="lv-empty" hidden></p></section>
        <section class="lv-col lv-info">
          <div class="pv-box" id="pv-box"><div class="preview-msg" hidden></div></div>
          <div class="pv-detail" id="pv-detail"></div>
        </section>
      </div>`;
  }

  chRow(ch) {
    const locked = needsPin('live', ch.cat);
    return `<button class="f ch-row">
      <span class="num">${ch.num}</span>${logo(ch, 'sm')}
      <span class="cr-main"><b>${esc(ch.name)}${isFav('live', ch.id) ? icon('heartFill', 'favmark') : ''}${ch.arch ? `<i class="cu-dot" title="Catch-up">${icon('history')}</i>` : ''}</b>
      ${locked ? '<small>Locked</small>' : nowSlot(ch, 'row')}</span>
      ${locked ? '' : nowSlot(ch, 'time', 'cr-time')}</button>`;
  }

  async pickCat(id, focusChannels) {
    if (id !== this.cat) {
      if (needsPin('live', id) && focusChannels) { if (!(await this.app.ensureUnlocked('live', id))) return; }
      this.cat = id;
      this.catList_.refresh();
      this.loadChannels();
    }
    if (focusChannels && this.channels.length) this.chList.focusIndex(this.chList.index);
  }

  loadChannels(selectId) {
    const locked = needsPin('live', this.cat) && !this.app.current; // first paint
    this.channels = itemsIn('live', this.cat);
    const c = this.cats.find((x) => x.id === this.cat);
    this.view.querySelector('#lv-cattitle').innerHTML = `${esc(c ? c.name : 'Channels')}<small>${this.channels.length}</small>`;
    const empty = this.view.querySelector('.lv-empty');
    empty.hidden = !!this.channels.length;
    if (!this.channels.length) empty.textContent = this.cat === '__fav' ? 'Hold OK on any channel and choose Add to favourites.' : 'No channels in this category.';
    let idx = 0;
    if (selectId) idx = Math.max(0, this.channels.findIndex((x) => String(x.id) === String(selectId)));
    this.chList.setItems(this.channels, idx);
    if (this.channels.length) this.showInfo(this.channels[idx]);
    else { this.view.querySelector('#pv-detail').innerHTML = ''; stopPreview(); }
  }

  showInfo(ch) {
    this.infoCh = ch;
    this.renderInfo(ch);
    if (!needsPin('live', ch.cat)) this.previewDeb(ch); else stopPreview();
  }

  // Guide text for the focused channel; called again when guide data arrives.
  renderInfo(ch) {
    const locked = needsPin('live', ch.cat);
    const nn = nowNext(ch);
    const t = now();
    const list = progs(ch);
    // a few past (catch-up) and upcoming programmes
    let i = list.findIndex((p) => p[1] > t);
    if (i < 0) i = list.length;
    const past = ch.arch ? list.slice(Math.max(0, i - 2), i) : [];
    const upcoming = list.slice(i + 1, i + 4);
    this.progRows = [...past, ...upcoming].map((p) => ({ s: p[0], e: p[1], t: p[2], d: p[3] }));
    const d = this.view.querySelector('#pv-detail');
    const keepFocus = d.contains(document.activeElement) ? +document.activeElement.dataset.i : -1;
    d.innerHTML = locked ? `<div class="pv-locked">${icon('lock')}<p>This category is locked. Press OK and enter your PIN to watch.</p></div>` : `
      <div class="pv-ch">${logo(ch, 'md')}<div><b>${esc(ch.name)}</b><small>Channel ${ch.num}${ch.arch ? ` with ${ch.arch}-day catch-up` : ''}</small></div></div>
      ${nn && nn.now ? `<h1>${esc(nn.now.t)}</h1>
        <div class="hero-time"><span>${hhmm(nn.now.s)}</span>${progressBar(nn.now.pct)}<span>${hhmm(nn.now.e)}</span><em>${minutesLeft(nn.now.e)}</em></div>
        ${nn.now.d ? `<p class="pv-desc">${esc(nn.now.d)}</p>` : ''}` : nn === null && !list.length ? '<h1 class="muted">Loading guide…</h1>' : '<h1 class="muted">No guide information for this channel</h1>'}
      ${this.progRows.length ? `<div class="pv-progs" data-group="progs">${this.progRows.map((p, k) => {
        const isPast = p.e <= t;
        return `<button class="f prog-row ${isPast ? 'past' : ''}" data-i="${k}" ${isPast ? 'data-cu="1"' : ''}>
          <span class="pr-time">${dayLabel(p.s) === 'Today' ? '' : dayLabel(p.s) + ' '}${hhmm(p.s)}</span><span class="pr-t">${esc(p.t)}</span>
          ${isPast ? `<span class="pr-cu">${icon('play')}Watch</span>` : ''}</button>`;
      }).join('')}</div>` : ''}`;
    if (keepFocus >= 0) { const b = d.querySelector(`.prog-row[data-i="${keepFocus}"]`) || d.querySelector('.prog-row'); if (b) focus(b); }
  }

  onEpg() {
    patchNowSlots(this.view);
    if (this.infoCh) this.renderInfo(this.infoCh);
  }

  startPreview(ch) {
    if (ch !== this.infoCh) return;
    const r = rectOf(this.view.querySelector('#pv-box'));
    if (r) preview(ch, r);
  }

  async watch(ch) {
    if (!(await this.app.ensureUnlocked('live', ch.cat))) return;
    playLive(ch, this.channels, (last) => {
      this.app.reload();
      // land back on the channel you were watching
      if (last) setTimeout(() => { const i = this.app.current().ctl.channels?.indexOf(last); if (i >= 0) this.app.current().ctl.chList.focusIndex(i); }, 0);
    });
  }

  async options(ch) {
    const cat = catOf('live', ch.cat);
    const opts = [
      { label: isFav('live', ch.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', value: 'fav' },
      { label: 'Open in TV guide', icon: 'guide', value: 'guide' },
    ];
    if (cat) {
      opts.push({ label: isLocked('live', cat.id) ? `Unlock “${cat.name}”` : `Lock “${cat.name}” with PIN`, icon: 'lock', value: 'lock' });
      opts.push({ label: `Hide “${cat.name}”`, icon: 'eyeOff', value: 'hide' });
    }
    const v = await sheet({ title: ch.name, options: opts });
    if (v === 'fav') { toast(toggleFav('live', ch.id) ? 'Added to favourites' : 'Removed from favourites'); this.refreshLists(); }
    if (v === 'guide') this.app.go('guide', { ch: ch.id });
    if (v === 'lock') {
      if (isLocked('live', cat.id) && !(await this.app.ensureUnlocked('live', cat.id))) return;
      setLocked('live', cat.id, !isLocked('live', cat.id)); toast(isLocked('live', cat.id) ? 'Category locked' : 'Category unlocked'); this.refreshLists();
    }
    if (v === 'hide') { setHidden('live', cat.id, true); toast(`${cat.name} hidden. Show it again in Settings.`); this.app.reload(); }
  }

  refreshLists() {
    this.cats = this.catList();
    this.catList_.setItems(this.cats, this.catList_.index);
    const cur = this.channels[this.chList.index];
    this.channels = itemsIn('live', this.cat);
    this.chList.setItems(this.channels, Math.max(0, this.channels.indexOf(cur)));
    if (this.channels.length) this.chList.focusIndex(this.chList.index, true);
  }

  onKey(k) {
    const a = document.activeElement;
    if (this.catList_.key(k) || this.chList.key(k)) return true;
    const inCh = this.chList.has(a), inCat = this.catList_.has(a);
    if (inCh && k === 'left') { this.catList_.focusIndex(this.catList_.index, true); return true; }
    if (inCat && k === 'right') { if (this.channels.length) this.chList.focusIndex(this.chList.index); return true; }
    if (inCat && k === 'left') { focus(document.querySelector(`#rail [data-go="${this.params.screen === 'favourites' ? 'favourites' : 'live'}"]`)); return true; }
    if (inCh && k === 'right') { const p = this.view.querySelector('.prog-row'); if (p) focus(p); return true; }
    if (a && a.closest('.pv-progs') && k === 'left') { this.chList.focusIndex(this.chList.index, true); return true; }
    if (inCh && k === 'hold') { itemActions('live', this.channels[this.chList.index], this.app, { list: this.channels }).then((c) => c && this.refreshLists()); return true; }
    if (inCat && k === 'hold') {
      const c = this.cats[this.catList_.index];
      if (c.id.startsWith('__')) return true;
      toast(togglePin('live', c.id) ? `${c.name} pinned to your home screen` : `${c.name} removed from home`);
      this.catList_.refresh(); return true;
    }
    if (inCh && k === 'menu') { this.options(this.channels[this.chList.index]); return true; }
    if (/^d\d$/.test(k)) { this.typeNumber(k.slice(1)); return true; }
    return false;
  }

  typeNumber(d) {
    this.numBuf = (this.numBuf || '') + d;
    clearTimeout(this.numT);
    toast(`Channel ${this.numBuf}`);
    this.numT = setTimeout(() => {
      const n = +this.numBuf; this.numBuf = '';
      let i = this.channels.findIndex((c) => c.num === n);
      if (i < 0) { this.cat = '__all'; this.catList_.setItems(this.cats, 2); this.loadChannels(); i = this.channels.findIndex((c) => c.num === n); }
      if (i >= 0) this.chList.focusIndex(i); else toast(`No channel ${n}`);
    }, 1100);
  }

  focus() {
    if (this.channels.length) this.chList.focusIndex(this.chList.index, true);
    else this.catList_.focusIndex(this.catList_.index, true);
  }
  save() { return { cat: this.cat, ch: this.channels[this.chList.index]?.id }; }
  destroy() { this.previewDeb.cancel(); stopPreview(); }
}
