// Films and series: category list + poster grid, and the detail page.
import { C, itemsIn, visibleCats, needsPin, vodInfo, seriesInfo, movieUrl, episodeUrl } from '../data.js';
import { S, isFav, toggleFav, progressOf, isWatched, isPinned, togglePin } from '../store.js';
import { esc, debounce, duration } from '../util.js';
import { focus, focusFirst } from '../nav.js';
import { icon, poster, stars, progressBar, VList, VGrid, toast } from '../ui.js';
import { playVod } from '../player.js';
import { langCatEntries } from '../languages.js';
import { itemActions, download } from '../actions.js';
import { openUrl } from '../native.js';

const SORTS = [['added', 'Recently added'], ['name', 'A to Z'], ['rating', 'Top rated'], ['year', 'Newest']];

export class VodScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    this.kind = params.kind === 'series' ? 'series' : 'movie';
    const r = params.restore || {};
    this.cat = r.cat || (params.lang ? '__lang:' + params.lang : params.cat) || '__all';
    this.sort = r.sort || 'added';
    const counts = new Map();
    for (const it of C[this.kind]) counts.set(it.cat, (counts.get(it.cat) || 0) + 1);
    this.cats = [
      { id: '__all', name: this.kind === 'series' ? 'All series' : 'All films', icon: 'list', count: C[this.kind].length },
      { id: '__fav', name: 'Favourites', icon: 'heart', count: itemsIn(this.kind, '__fav').length },
      ...langCatEntries(this.kind),
      ...visibleCats(this.kind).map((c) => ({ ...c, count: counts.get(c.id) || 0 })),
    ];
    view.innerHTML = `<div class="vd">
      <section class="lv-col lv-catcol"><h2 class="col-h">${this.kind === 'series' ? 'Series' : 'Films'}</h2><div class="vd-cats"></div></section>
      <section class="vd-main">
        <header class="vd-head"><h2 class="col-h" id="vd-title"></h2>
          <div class="chips" data-group="sort">${SORTS.map(([k, l]) => `<button class="f chip ${k === this.sort ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div></header>
        <div class="vd-grid"></div><p class="lv-empty" hidden></p>
      </section></div>`;
    this.catList = new VList(view.querySelector('.vd-cats'), {
      rowH: 76, group: 'cats',
      render: (c) => `<button class="f cat-row ${c.id === this.cat ? 'on' : ''}">${c.icon ? icon(c.icon) : ''}<span>${esc(c.name)}</span>${isPinned(this.kind, c.id) ? icon('pin', 'pinmark') : ''}${needsPin(this.kind, c.id) ? icon('lock', 'lockmark') : `<small>${c.count}</small>`}</button>`,
      onSelect: (c) => this.pickCat(c.id, true),
      onFocus: debounce((c) => this.pickCat(c.id, false), 300),
    });
    this.grid = new VGrid(view.querySelector('.vd-grid'), {
      cols: 6, cellH: 372, group: 'grid',
      render: (it) => {
        const pr = this.kind === 'movie' && progressOf('movie:' + it.id);
        const seen = this.kind === 'movie' && isWatched('movie:' + it.id);
        return `<button class="f tile poster-tile">${poster(it)}${pr ? progressBar(pr.pos / pr.dur, 'over') : ''}${seen ? `<span class="seen-badge">${icon('check')}</span>` : ''}
          <span class="pt-cap"><b>${esc(it.name)}</b><small>${it.year || ''}${it.rating ? ' ' : ''}${stars(it.rating)}</small></span></button>`;
      },
      onSelect: (it) => this.app.go('detail', { kind: this.kind, id: it.id }),
    });
    view.querySelector('.chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b) return;
      this.sort = b.dataset.sort;
      view.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      this.load();
    });
    this.catList.setItems(this.cats, Math.max(0, this.cats.findIndex((c) => c.id === this.cat)));
    this.load(r.index || 0);
  }

  async pickCat(id, focusGrid) {
    if (id !== this.cat) {
      if (needsPin(this.kind, id)) { if (!focusGrid || !(await this.app.ensureUnlocked(this.kind, id))) return; }
      this.cat = id; this.catList.refresh(); this.load();
    }
    if (focusGrid && this.items.length) this.grid.focusIndex(0);
  }

  load(index = 0) {
    let items = itemsIn(this.kind, this.cat);
    if (this.cat === '__all') items = items.filter((x) => !needsPin(this.kind, x.cat));
    const s = this.sort;
    // plain comparisons on pre-normalised names: localeCompare over 50,000 titles takes seconds on a TV stick
    items = [...items].sort(s === 'name' ? (a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)
      : s === 'rating' ? (a, b) => (b.rating || 0) - (a.rating || 0)
      : s === 'year' ? (a, b) => (b.year || 0) - (a.year || 0) || b.added - a.added
      : (a, b) => b.added - a.added);
    this.items = items;
    const c = this.cats.find((x) => x.id === this.cat);
    this.view.querySelector('#vd-title').innerHTML = `${esc(c ? c.name : '')}<small>${items.length}</small>`;
    const empty = this.view.querySelector('.lv-empty');
    empty.hidden = !!items.length;
    empty.textContent = this.cat === '__fav' ? 'Hold OK on any title and choose Add to favourites.' : 'Nothing here yet.';
    this.grid.setItems(items, index);
  }

  onKey(k) {
    const a = document.activeElement;
    if (this.catList.key(k)) return true;
    if (this.catList.has(a) && k === 'hold') {
      const c = this.cats[this.catList.index];
      if (c.id.startsWith('__')) return true;
      toast(togglePin(this.kind, c.id) ? `${c.name} pinned to your home screen` : `${c.name} removed from home`);
      this.catList.refresh(); return true;
    }
    if (this.grid.has(a)) {
      if (k === 'up' && this.grid.index < 6) { focus(this.view.querySelector('.chip.on')); return true; }
      if (k === 'left' && this.grid.index % 6 === 0) { this.catList.focusIndex(this.catList.index, true); return true; }
      if (k === 'hold' || k === 'menu') { const it = this.items[this.grid.index]; itemActions(this.kind, it, this.app).then((c) => c && this.grid.paint()); return true; }
      if (this.grid.key(k)) return true;
    }
    if (this.catList.has(a) && k === 'right') { if (this.items.length) this.grid.focusIndex(this.grid.index, true); else focus(this.view.querySelector('.chip.on')); return true; }
    if (this.catList.has(a) && k === 'left') { focus(document.querySelector(`#rail [data-go="${this.kind === 'series' ? 'series' : 'movies'}"]`)); return true; }
    if (a && a.classList.contains('chip') && k === 'down' && this.items.length) { this.grid.focusIndex(this.grid.index, true); return true; }
    if (a && a.classList.contains('chip') && k === 'left' && a === this.view.querySelector('.chip')) { this.catList.focusIndex(this.catList.index, true); return true; }
    return false;
  }

  focus() { if (this.items.length) this.grid.focusIndex(this.grid.index, true); else this.catList.focusIndex(this.catList.index, true); }
  save() { return { cat: this.cat, sort: this.sort, index: this.grid.index }; }
}

// ---------------------------------------------------------------------------
export class DetailScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    this.kind = params.kind;
    this.item = C.byId[this.kind].get(String(params.id));
    if (!this.item) { view.innerHTML = '<div class="empty"><h2>This title is no longer in your playlist</h2></div>'; return; }
    this.season = params.restore?.season || null;
    this.render();
    if (this.kind === 'movie') vodInfo(this.item.id).then((i) => i && this.fill(i)).catch(() => {});
    else seriesInfo(this.item.id).then((i) => { this.info = i; this.fill(i); this.paintSeasons(); }).catch(() => this.paintSeasons());
  }

  render() {
    const it = this.item;
    const key = 'movie:' + it.id;
    const pr = this.kind === 'movie' ? progressOf(key) : null;
    this.view.innerHTML = `<div class="dt ${this.kind}">
      <div class="dt-backdrop">${poster(it, true)}</div>
      <div class="dt-body">
        <div class="dt-poster">${poster(it)}</div>
        <div class="dt-info">
          <h1>${esc(it.name)}</h1>
          <p class="dt-meta">${it.year ? `<span>${it.year}</span>` : ''}${it.rating ? stars(it.rating) : ''}<span id="dt-genre">${esc(it.genre || '')}</span><span id="dt-dur"></span></p>
          <p class="dt-plot" id="dt-plot">${esc(it.plot || '')}</p>
          <p class="dt-cast" id="dt-cast"></p>
          <div class="dt-actions" data-group="actions">
            ${this.kind === 'movie' ? (pr
              ? `<button class="f btn primary" data-a="resume">${icon('play')}Resume from ${duration(pr.pos / 1000)}</button><button class="f btn" data-a="play">${icon('history')}Start from the beginning</button>`
              : `<button class="f btn primary" data-a="play">${icon('play')}Play</button>`) : `<button class="f btn primary" data-a="next">${icon('play')}<span id="dt-nextlabel">Play</span></button>`}
            ${this.kind === 'movie' ? `<button class="f btn" data-a="download">${icon('download')}Download</button>` : ''}
            <button class="f btn" data-a="trailer" hidden>${icon('play')}Trailer</button>
            <button class="f btn icon-only" data-a="fav" aria-label="Favourite">${icon(isFav(this.kind, it.id) ? 'heartFill' : 'heart')}</button>
            ${this.kind === 'movie' ? `<button class="f btn icon-only" data-a="more" aria-label="More">${icon('more')}</button>` : ''}
          </div>
          ${pr ? `<div class="dt-progress">${progressBar(pr.pos / pr.dur)}<small>${Math.round((pr.dur - pr.pos) / 60000)} min left</small></div>` : ''}
        </div>
        ${this.kind === 'series' ? `<div class="dt-episodes"><div class="chips seasons" data-group="seasons"></div><div class="ep-list"></div></div>` : ''}
      </div></div>`;
    this.view.querySelector('.dt-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this.action(b.dataset.a);
    });
  }

  fill(i) {
    const q = (s) => this.view.querySelector(s);
    if (i.trailer) { this.trailer = i.trailer; q('[data-a="trailer"]').hidden = false; }
    if (i.height && q('#dt-dur')) q('#dt-dur').textContent = [i.dur, i.height >= 2000 ? '4K' : i.height >= 1000 ? '1080p' : i.height >= 700 ? '720p' : ''].filter(Boolean).join(' \u00b7 ');
    if (i.plot && q('#dt-plot')) q('#dt-plot').textContent = i.plot;
    if (i.genre && q('#dt-genre')) q('#dt-genre').textContent = i.genre;
    if (i.dur && q('#dt-dur')) q('#dt-dur').textContent = i.dur;
    if ((i.cast || i.director) && q('#dt-cast')) q('#dt-cast').textContent = [i.director && `Director: ${i.director}`, i.cast && `Cast: ${i.cast}`].filter(Boolean).join('. ');
  }

  paintSeasons() {
    const seasons = this.info ? Object.keys(this.info.seasons).sort((a, b) => a - b) : [];
    const box = this.view.querySelector('.seasons');
    if (!box) return;
    if (!seasons.length) { box.innerHTML = '<p class="muted">No episodes found for this series.</p>'; return; }
    // resume the latest watched episode
    const next = this.nextEpisode();
    if (!this.season) this.season = next ? next.season : seasons[0];
    box.innerHTML = seasons.map((s) => `<button class="f chip ${s === this.season ? 'on' : ''}" data-season="${s}">Season ${s}</button>`).join('');
    box.onclick = (e) => { const b = e.target.closest('[data-season]'); if (b) { this.season = b.dataset.season; box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); this.paintEpisodes(); } };
    box.addEventListener('focused', (e) => { const b = e.target.closest('[data-season]'); if (b && b.dataset.season !== this.season) b.click(); });
    const lbl = this.view.querySelector('#dt-nextlabel');
    if (lbl && next) lbl.textContent = next.resume ? `Resume S${next.season} E${next.ep.num}` : `Play S${next.season} E${next.ep.num}`;
    this.paintEpisodes();
  }

  nextEpisode() {
    if (!this.info) return null;
    let best = null;
    for (const [sn, eps] of Object.entries(this.info.seasons)) {
      for (const ep of eps) {
        const p = progressOf('ep:' + ep.id);
        if (p && (!best || p.t > best.t)) best = { season: sn, ep, t: p.t, resume: true };
      }
    }
    if (best) return best;
    const first = Object.keys(this.info.seasons).sort((a, b) => a - b)[0];
    return first ? { season: first, ep: this.info.seasons[first][0] } : null;
  }

  paintEpisodes() {
    const eps = this.info.seasons[this.season] || [];
    this.eps = eps;
    if (!this.epList) {
      this.epList = new VList(this.view.querySelector('.ep-list'), {
        rowH: 116, group: 'eps',
        render: (ep) => {
          const p = progressOf('ep:' + ep.id);
          const seen = isWatched('ep:' + ep.id);
          return `<button class="f ep-row ${seen ? 'seen' : ''}"><span class="ep-num">${seen ? icon('check') : ep.num}</span><span class="ep-main"><b>${esc(ep.title)}</b><small>${esc(ep.dur || '')}${p ? ` – ${Math.round((p.dur - p.pos) / 60000)} min left` : ''}</small>
            ${p ? progressBar(p.pos / p.dur, 'thin') : ''}</span>${icon('play', 'ep-play')}</button>`;
        },
        onSelect: (ep) => this.playEp(ep),
      });
    }
    this.epList.setItems(eps, 0);
  }

  epItem(season, ep) {
    const it = this.item;
    return { title: it.name, sub: `Season ${season}, episode ${ep.num}: ${ep.title}`, url: episodeUrl(ep), poster: it.img, ext: ep.ext,
      seriesId: it.id, seriesName: it.name, season: +season, episode: ep.num, num: ep.num, id: ep.id, kind: 'episode', key: 'ep:' + ep.id };
  }
  // Everything after this episode, across seasons, so playback can continue automatically.
  queueAfter(season, ep) {
    const out = [];
    const seasons = Object.keys(this.info.seasons).sort((a, b) => a - b);
    let found = false;
    for (const sn of seasons) for (const e of this.info.seasons[sn]) {
      if (found) out.push({ item: this.epItem(sn, e), key: 'ep:' + e.id });
      if (e === ep) found = true;
    }
    return out.slice(0, 30);
  }
  playEp(ep) {
    playVod(this.epItem(this.season, ep), 'ep:' + ep.id, () => this.app.reload(), this.queueAfter(this.season, ep));
  }

  async action(a) {
    const it = this.item;
    if (!(await this.app.ensureUnlocked(this.kind, it.cat))) return;
    if (a === 'play' || a === 'resume') {
      const key = 'movie:' + it.id;
      if (a === 'play') { const p = progressOf(key); if (p) p.pos = 0; }
      playVod({ title: it.name, sub: it.year ? String(it.year) : '', url: movieUrl(it), poster: it.img, ext: it.ext, kind: 'movie', id: it.id, year: it.year }, key, () => this.app.reload());
    } else if (a === 'next') {
      const n = this.nextEpisode();
      if (!n) { toast('Episodes are still loading'); return; }
      this.season = n.season;
      this.playEp(n.ep);
    } else if (a === 'download') {
      download('movie', it);
    } else if (a === 'more') {
      itemActions('movie', it, this.app).then((c) => c && this.app.reload());
    } else if (a === 'trailer') {
      openUrl(/^https?:/.test(this.trailer) ? this.trailer : 'https://www.youtube.com/watch?v=' + this.trailer);
    } else if (a === 'fav') {
      const on = toggleFav(this.kind, it.id);
      const b = this.view.querySelector('[data-a="fav"]');
      b.innerHTML = icon(on ? 'heartFill' : 'heart');
      toast(on ? 'Added to favourites' : 'Removed from favourites');
    }
  }

  onKey(k) {
    const a = document.activeElement;
    if (this.epList && this.epList.has(a) && (k === 'hold' || k === 'menu')) {
      const ep = this.eps[this.epList.index];
      itemActions('episode', this.epItem(this.season, ep), this.app, { resumeKey: 'ep:' + ep.id }).then((c) => c && this.epList.refresh());
      return true;
    }
    if (!this.epList && this.kind === 'movie' && (k === 'hold' || k === 'menu')) { this.action('more'); return true; }
    if (this.epList && this.epList.key(k)) return true;
    if (this.epList && this.epList.has(a) && k === 'left') { focus(this.view.querySelector('.dt-actions .btn')); return true; }
    if (this.epList && this.epList.has(a) && k === 'up' && this.epList.index === 0) { focus(this.view.querySelector('.seasons .chip.on')); return true; }
    if (a && a.closest('.seasons') && k === 'down' && this.eps && this.eps.length) { this.epList.focusIndex(0, true); return true; }
    if (a && a.closest('.dt-actions') && k === 'right' && a === this.view.querySelector('.dt-actions .btn:last-child') && this.epList) { this.epList.focusIndex(this.epList.index, true); return true; }
    return false;
  }

  focus() { focusFirst(this.view, '.dt-actions .btn'); }
  save() { return { season: this.season }; }
}
