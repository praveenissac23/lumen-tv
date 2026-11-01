// Home: master search bar, last-channel hero with live preview, content rows.
import { C, nowNext, itemsIn, progs, needsPin } from '../data.js';
import { S, continueList, isFav, setting, langRowsFor } from '../store.js';
import { langById, langItems, newest } from '../languages.js';
import { itemActions } from '../actions.js';
import { update, installUpdate } from '../updates.js';
import { esc, hhmm, now, minutesLeft } from '../util.js';
import { focus, reveal } from '../nav.js';
import { icon, logo, poster, progressBar, stars, nowSlot, patchNowSlots } from '../ui.js';
import { prefetchNow, hasProgs } from '../epg.js';
import { preview, stopPreview, playLive, playVod, playCatchup } from '../player.js';
import { movieUrl, episodeUrl } from '../data.js';

const CHUNK = 30;   // tiles added to a row at a time

// Newest-first lists, sorted once per catalogue load (sorting 50,000 films on every visit is slow on a TV stick).
const sorted = new Map();
function newestAll(key, list) {
  const k = `${key}:${C.updatedAt}:${list.length}`;
  let v = sorted.get(k);
  if (!v) {
    v = list.slice().sort((a, b) => (b.added || 0) - (a.added || 0));
    for (const old of sorted.keys()) if (old.startsWith(key + ':')) sorted.delete(old);
    sorted.set(k, v);
  }
  return v;
}

export class HomeScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    this.render();
    this.bind();
  }

  heroChannel() {
    const id = S.recentLive[0] || S.favs.live[0];
    return (id && C.byId.live.get(id)) || C.live[0];
  }

  rows() {
    const rows = [];
    const favs = itemsIn('live', '__fav').slice(0, 20);
    const recent = S.recentLive.map((id) => C.byId.live.get(id)).filter(Boolean);
    // 1. Continue watching: films and episodes you stopped part-way, newest first
    const cont = continueList().slice(0, 5);
    if (cont.length) rows.push({ key: 'cont', title: 'Continue watching', kind: 'cont', items: cont });
    // 2. Recently watched channels
    const rch = recent.filter((c) => !needsPin('live', c.cat)).slice(0, 5);
    if (rch.length) rows.push({ key: 'recent', title: 'Recently watched channels', kind: 'live', items: rch, more: { screen: 'live', cat: '__recent' } });
    // 3. Recently watched films and series
    const rv = (S.recentVod || []).slice(0, 5);
    if (rv.length) rows.push({ key: 'rv', title: 'Recently watched films and series', kind: 'rv', items: rv });
    if (favs.length) rows.push({ key: 'fav', title: 'Favourite channels', kind: 'live', items: favs, more: { screen: 'live', cat: '__fav' } });

    // Your languages: the rows chosen for each one (Settings > Home and languages), newest first, unlimited
    for (const id of S.myLangs) {
      const lang = langById(id);
      if (!lang) continue;
      const parts = langRowsFor(id);
      const ok = (kind) => (it) => !needsPin(kind, it.cat);
      if (parts.includes('films')) {
        const films = newestAll('lf-' + id, langItems('movie', id).filter(ok('movie')));
        if (films.length) rows.push({ key: 'lf-' + id, title: `New ${lang.name} films`, kind: 'movie', items: films, more: { screen: 'movies', lang: id } });
      }
      if (parts.includes('live')) {
        const ch = langItems('live', id).filter(ok('live'));
        if (ch.length) rows.push({ key: 'll-' + id, title: `${lang.name} channels`, kind: 'live', items: ch, more: { screen: 'live', lang: id } });
      }
      if (parts.includes('series')) {
        const se = newestAll('ls-' + id, langItems('series', id).filter(ok('series')));
        if (se.length) rows.push({ key: 'ls-' + id, title: `${lang.name} series`, kind: 'series', items: se, more: { screen: 'series', lang: id } });
      }
    }
    // Categories pinned with a long press
    for (const pin of S.pins) {
      const cat = C.cats[pin.kind].find((c) => c.id === pin.cat);
      if (!cat || needsPin(pin.kind, pin.cat)) continue;
      const items = pin.kind === 'live' ? itemsIn('live', pin.cat) : newestAll(`pin-${pin.kind}-${pin.cat}`, itemsIn(pin.kind, pin.cat));
      if (items.length) rows.push({ key: `pin-${pin.kind}-${pin.cat}`, title: pin.kind === 'live' ? cat.name : `New in ${cat.name}`, kind: pin.kind, items, pinned: true,
        more: { screen: pin.kind === 'movie' ? 'movies' : pin.kind, cat: pin.cat } });
    }

    this.cuPool = [];
    return rows;
  }

  tile(kind, it, i) {
    if (kind === 'live') {
      return `<button class="f tile ch-tile" data-k="live" data-id="${esc(it.id)}">
        <span class="ct-top">${logo(it, 'sm')}<span class="ct-num">${it.num}</span>${isFav('live', it.id) ? icon('heartFill', 'favmark') : ''}</span>
        <span class="ct-name">${esc(it.name)}</span>
        ${nowSlot(it, 'tile')}</button>`;
    }
    if (kind === 'cont') {
      return `<button class="f tile land-tile" data-k="cont" data-i="${i}">
        ${poster({ name: it.title, img: it.poster }, true)}
        <span class="lt-cap"><b>${esc(it.title)}</b><small>${esc(it.sub || '')}${it.sub ? ' – ' : ''}${it.dur > 0 ? `${Math.max(1, Math.round((it.dur - it.pos) / 60000))} min left` : `Resume from ${Math.floor(it.pos / 60000)} min`}</small></span>
        ${it.dur > 0 ? progressBar(it.pos / it.dur, 'over') : ''}</button>`;
    }
    if (kind === 'cu') {
      return `<button class="f tile cu-tile" data-k="cu" data-i="${i}">
        <span class="ct-top">${logo(it.ch, 'sm')}<span class="ct-chname">${esc(it.ch.name)}</span></span>
        <span class="ct-name">${esc(it.t)}</span>
        <span class="ct-now">${hhmm(it.s)}–${hhmm(it.e)}</span>
        <span class="cu-badge">${icon('history')}Catch-up</span></button>`;
    }
    if (kind === 'rv') {
      return `<button class="f tile poster-tile" data-k="rv" data-i="${i}">
        ${poster({ name: it.title, img: it.poster })}<span class="pt-cap"><b>${esc(it.title)}</b><small>${esc(it.sub || (it.kind === 'movie' ? 'Film' : ''))}</small></span></button>`;
    }
    return `<button class="f tile poster-tile" data-k="${kind}" data-id="${esc(it.id)}">
      ${poster(it)}<span class="pt-cap"><b>${esc(it.name)}</b><small>${it.year || ''}${it.rating ? ' ' : ''}${stars(it.rating)}</small></span></button>`;
  }

  render() {
    const ch = this.heroChannel();
    this.hero = ch;
    this.rowData = this.rows();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const layout = this.layout = this.params.layout || setting('homeLayout') || 'rows';
    this.view.classList.toggle('home-compact', layout === 'compact');
    this.view.innerHTML = `
      <div class="home-scroll" data-scroll="y"><div class="home-track">
        <header class="topbar">
          <div class="searchbar" data-group="top">
            <button class="f search-field" id="home-search">${icon('search')}<span>Search channels, films, series and what’s on</span></button>
            <button class="f mic-btn" id="home-mic" aria-label="Voice search">${icon('mic')}</button>
          </div>
          ${update.available ? `<button class="f update-pill" id="home-update">${icon('download')}Update available</button>` : ''}
          <div class="topbar-right"><span class="greet">${greet}</span><span class="clock" data-clock>${hhmm(now())}</span></div>
        </header>
        ${this.top(ch)}
        ${ch && layout === 'hero' ? `<section class="hero" data-group="hero">
          <div class="hero-video" id="hero-video"><div class="preview-msg" hidden></div></div>
          <div class="hero-info">
            <p class="hero-kicker">${S.recentLive[0] ? 'Pick up where you left off' : 'On now'}</p>
            <div class="hero-ch">${logo(ch, 'md')}<div><b>${esc(ch.name)}</b><small>Channel ${ch.num}</small></div></div>
            ${nowSlot(ch, 'hero')}
            <div class="hero-actions">
              <button class="f btn primary" id="hero-watch">${icon('play')}Watch now</button>
              <button class="f btn" id="hero-guide">${icon('guide')}TV guide</button>
              ${ch.arch ? `<button class="f btn" id="hero-over">${icon('history')}Start over</button>` : ''}
            </div>
          </div>
        </section>` : ''}
        ${this.rowData.map((r, ri) => `<section class="row row-${r.kind}" data-row="${ri}">
          <h2>${esc(r.title)}${r.pinned ? icon('pin', 'pinmark') : ''}<small>${r.items.length > 12 ? r.items.length.toLocaleString() : ''}</small><span class="row-hint" hidden>${icon('back')}Back: start of row, then menu</span></h2>
          <div class="row-clip" data-scroll="x" data-pad="72"><div class="row-track" data-group="row${ri}">
            ${r.items.slice(0, (r.shown = Math.min(r.items.length, CHUNK))).map((it, i) => this.tile(r.kind, it, i)).join('')}
            ${r.more ? `<button class="f tile more-tile ${r.kind === 'movie' || r.kind === 'series' ? 'tall' : ''}" data-k="more">${icon('chevron')}<span>See all</span></button>` : ''}
          </div></div></section>`).join('')}
        ${!this.rowData.length ? `<section class="empty"><h2>Add a playlist to get started</h2><p>Open Settings and add your Xtream login or M3U link.</p></section>` : ''}
      </div></div>`;
  }

  bind() {
    const v = this.view;
    v.querySelector('#home-search').onclick = () => this.app.go('search', { keyboard: true });
    v.querySelector('#home-mic').onclick = () => this.app.openVoice();
    const up = v.querySelector('#home-update'); if (up) up.onclick = () => installUpdate();
    this.onUpd = () => { if (!this.view.querySelector('#home-update') && this.app.current() && this.app.current().ctl === this) this.app.reload(); };
    document.addEventListener('update-available', this.onUpd);
    const w = v.querySelector('#hero-watch'); if (w) w.onclick = () => this.watch(this.hero);
    v.querySelectorAll('.shortcut').forEach((b) => { b.onclick = () => (b.dataset.go === 'search' ? this.app.go('search', {}) : this.app.go(b.dataset.go, {})); });
    const sp = v.querySelector('#spot-play');
    if (sp) sp.onclick = () => {
      const c = this.rowData.find((r) => r.kind === 'cont');
      if (sp.dataset.k === 'cont' && c) this.open('cont', null, c.items[0], c); else if (this.hero) this.watch(this.hero);
    };
    this.onProg = () => { if (this.app.current() && this.app.current().ctl === this) this.app.reload(); };
    document.addEventListener('progress-changed', this.onProg);
    const g = v.querySelector('#hero-guide'); if (g) g.onclick = () => this.app.go('guide', { ch: this.hero.id });
    const o = v.querySelector('#hero-over'); if (o) o.onclick = () => { const nn = nowNext(this.hero); if (nn && nn.now) playCatchup(this.hero, nn.now, C.live, () => this.app.reload()); else this.watch(this.hero); };
    prefetchNow(this.rowData.flatMap((r) => (r.kind === 'live' ? r.items.slice(0, 12) : [])));
    v.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const row = this.rowData[+t.closest('[data-row]').dataset.row];
      if (t.dataset.k === 'more') { const m = row.more; this.app.go(m.screen, { lang: m.lang, cat: m.cat }); return; }
      this.open(t.dataset.k, t.dataset.id, t.dataset.i != null ? row.items[+t.dataset.i] : null, row);
    });
    v.addEventListener('focused', (e) => {
      // rows are endless: add the next tiles when focus gets near the last one shown
      const tile = e.target.closest('.tile');
      const rowEl = tile && tile.closest('[data-row]');
      if (rowEl && tile.dataset.k !== 'more') {
        const r = this.rowData[+rowEl.dataset.row];
        const idx = [...tile.parentElement.children].indexOf(tile);
        // once you're a few tiles in, show how to get back
        const hint = rowEl.querySelector('.row-hint');
        if (hint) hint.hidden = idx < 5;
        for (const h of v.querySelectorAll('.row-hint')) if (h !== hint) h.hidden = true;
        if (r && r.shown < r.items.length && idx >= r.shown - 8) this.growRow(rowEl);
      }
      // clicking with the mouse shouldn't move the page
      if (window.__pointerFocus && Date.now() - window.__pointerFocus < 400) return;
      // focusing the hero region keeps the page at the top; rows scroll the page
      const inHero = e.target.closest('.hero, .topbar');
      const scroller = v.querySelector('.home-scroll');
      const tr = scroller.firstElementChild;
      if (inHero) {
        if (tr._off) { tr._off = 0; tr.style.transform = ''; clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => this.startPreview(), 350); }
      } else {
        const sec = e.target.closest('.row');
        if (sec) {
          // first row sits under the hero; later rows scroll to just below the top edge
          const y = sec.dataset.row === '0' ? 0 : Math.max(0, sec.offsetTop - 64);
          if (y && !tr._off) { clearTimeout(this.previewTimer); stopPreview(); }
          if (!y && tr._off) { clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => this.startPreview(), 350); }
          tr._off = -y; tr.style.transform = y ? `translate3d(0,${-y}px,0)` : '';
        }
      }
    });
    // Trackpad (Mac): rows keep loading while you scroll them; the hero preview pauses when scrolled away
    v.addEventListener('wheelscrolled', (e) => {
      if (e.detail.axis === 'x') {
        const rowEl = e.target.closest('[data-row]');
        const track = e.target.firstElementChild;
        if (rowEl && track && -e.detail.off + e.target.clientWidth > track.scrollWidth - 900) this.growRow(rowEl);
        return;
      }
      clearTimeout(this.previewTimer);
      if (e.detail.off < -200) stopPreview();
      else this.previewTimer = setTimeout(() => { const tr = v.querySelector('.home-track'); if (!tr._off || tr._off > -200) this.startPreview(); }, 400);
    });
    // live preview in the hero
    this.previewTimer = setTimeout(() => this.startPreview(), 500);
  }

  // The area under the search bar, depending on Settings > Home and languages > Home screen style.
  top(ch) {
    const L = this.layout;
    if (L === 'shortcuts') {
      const items = [['live', 'live', 'Live TV'], ['guide', 'guide', 'TV guide'], ['movies', 'film', 'Films'], ['series', 'series', 'Series'], ['favourites', 'heart', 'Favourites'], ['search', 'search', 'Search']];
      return `<section class="shortcuts" data-group="sc">${items.map(([go, ic, l]) => `<button class="f shortcut" data-go="${go}">${icon(ic)}<span>${l}</span></button>`).join('')}</section>`;
    }
    if (L === 'spotlight') {
      const c = this.rowData.find((r) => r.kind === 'cont');
      const it = c && c.items[0];
      if (it) {
        return `<section class="spotlight" data-group="spot"><button class="f spot-card" id="spot-play" data-k="cont">
          ${poster({ name: it.title, img: it.poster }, true)}
          <span class="spot-info"><small>Continue watching</small><b>${esc(it.title)}</b><span>${esc(it.sub || '')}</span>
          ${it.dur > 0 ? progressBar(it.pos / it.dur) : ''}<em>${icon('play')}Resume</em></span></button></section>`;
      }
      if (ch) {
        return `<section class="spotlight" data-group="spot"><button class="f spot-card live" id="spot-play" data-k="live">
          <span class="spot-logo">${logo(ch, 'lg')}</span>
          <span class="spot-info"><small>Your last channel</small><b>${esc(ch.name)}</b>${nowSlot(ch, 'best')}<em>${icon('play')}Watch</em></span></button></section>`;
      }
    }
    return '';
  }

  // Add the next tiles to an endless row.
  growRow(rowEl) {
    const r = this.rowData[+rowEl.dataset.row];
    if (!r || r.shown >= r.items.length) return;
    const track = rowEl.querySelector('.row-track');
    const from = r.shown, to = Math.min(r.items.length, from + CHUNK);
    r.shown = to;
    const html = r.items.slice(from, to).map((it, k) => this.tile(r.kind, it, from + k)).join('');
    const more = track.querySelector('.more-tile');
    if (more) more.insertAdjacentHTML('beforebegin', html); else track.insertAdjacentHTML('beforeend', html);
    patchNowSlots(rowEl);
  }

  startPreview() {
    const box = this.view.querySelector('#hero-video');
    if (!box || !this.hero || needsPin('live', this.hero.cat)) return;
    const r = rectOf(box);
    if (r) preview(this.hero, r);
  }

  async watch(ch) {
    if (!(await this.app.ensureUnlocked('live', ch.cat))) return;
    playLive(ch, C.live, () => this.app.reload());
  }

  async open(kind, id, data, row) {
    if (kind === 'live') {
      const ch = C.byId.live.get(id);
      if (!(await this.app.ensureUnlocked('live', ch.cat))) return;
      playLive(ch, row.items, () => this.app.reload());
    } else if (kind === 'cont') {
      const url = data.key.startsWith('movie:') ? movieUrl({ id: data.key.slice(6), ext: data.ext, url: data.url }) : episodeUrl({ id: data.key.slice(3), ext: data.ext, url: data.url });
      playVod({ ...data, url }, data.key, () => this.app.reload());
    } else if (kind === 'rv') {
      if (data.seriesId) this.app.go('detail', { kind: 'series', id: data.seriesId });
      else this.app.go('detail', { kind: 'movie', id: data.id });
    } else if (kind === 'cu') {
      playCatchup(data.ch, data, C.live, () => this.app.reload());
    } else {
      this.app.go('detail', { kind, id });
    }
  }

  onKey(k, e) {
    if (k !== 'hold') return false;   // ≡ Menu stays search everywhere; hold OK opens a tile's options
    const t = document.activeElement && document.activeElement.closest('.tile');
    if (!t || t.dataset.k === 'more') return false;
    const row = this.rowData[+t.closest('[data-row]').dataset.row];
    const kind = t.dataset.k;
    if (kind === 'live' || kind === 'movie' || kind === 'series') {
      const item = C.byId[kind].get(t.dataset.id);
      itemActions(kind, item, this.app, { list: row.items, row }).then((changed) => { if (changed) this.app.reload(); });
      return true;
    }
    if (kind === 'cont') {
      const d = row.items[+t.dataset.i];
      itemActions(d.key.startsWith('movie:') ? 'movie' : 'episode', d, this.app, { resumeKey: d.key }).then((c) => { if (c) this.app.reload(); });
      return true;
    }
    return false;
  }

  focus() {
    const r = this.params.restore;
    if (r && r.sel) {
      const t = this.view.querySelector(r.sel);
      if (t) { focus(t); return; }
    }
    focus(this.view.querySelector('#spot-play') || this.view.querySelector('#hero-watch') || this.view.querySelector('.shortcut') || this.view.querySelector('.tile') || this.view.querySelector('#home-search'));
  }

  save() {
    const a = document.activeElement;
    if (!a || !this.view.contains(a)) return null;
    if (a.id) return { sel: '#' + a.id };
    const row = a.closest('[data-row]');
    if (row) {
      const i = [...row.querySelectorAll('.tile')].indexOf(a);
      return { sel: `[data-row="${row.dataset.row}"] .tile:nth-child(${i + 1})` };
    }
    return null;
  }

  // Guide answers arrived: refresh the now/next text in place; add the catch-up row once its data is in.
  onEpg() {
    patchNowSlots(this.view);
    if (!this.view.querySelector('.row-cu') && this.cuPool && this.cuPool.length && this.cuPool.every(hasProgs) && !this.cuTried) {
      this.cuTried = true;
      if (this.rows().some((r) => r.kind === 'cu')) this.app.reload();
    }
  }

  destroy() {
    document.removeEventListener('progress-changed', this.onProg); clearTimeout(this.previewTimer); stopPreview(); document.removeEventListener('update-available', this.onUpd); }
}

// rect of an element in stage coordinates
export function rectOf(node) {
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const k = s.width / 1920;
  if (!r.width) return null;
  return { x: Math.round((r.left - s.left) / k), y: Math.round((r.top - s.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k) };
}
