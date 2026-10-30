// Home: master search bar, last-channel hero with live preview, content rows.
import { C, nowNext, itemsIn, progs, needsPin } from '../data.js';
import { S, continueList, isFav, setting } from '../store.js';
import { langById, langItems, newest } from '../languages.js';
import { itemActions } from '../actions.js';
import { update, installUpdate } from '../updates.js';
import { esc, hhmm, now, minutesLeft } from '../util.js';
import { focus, reveal } from '../nav.js';
import { icon, logo, poster, progressBar, stars } from '../ui.js';
import { preview, stopPreview, playLive, playVod, playCatchup } from '../player.js';
import { movieUrl, episodeUrl } from '../data.js';

export class HomeScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    this.render();
    this.bind();
  }

  heroChannel() {
    const id = S.recentLive[0] || S.favs.live[0];
    return (id && C.byId.live.get(id)) || C.live.find((c) => nowNext(c)?.now) || C.live[0];
  }

  rows() {
    const rows = [];
    const favs = itemsIn('live', '__fav').slice(0, 20);
    const recent = S.recentLive.map((id) => C.byId.live.get(id)).filter((c) => c && !favs.includes(c)).slice(0, 20);
    if (favs.length) rows.push({ key: 'fav', title: 'Favourite channels', kind: 'live', items: favs });
    if (recent.length) rows.push({ key: 'recent', title: 'Recently watched', kind: 'live', items: recent });
    const cont = continueList();
    if (cont.length) rows.push({ key: 'cont', title: 'Continue watching', kind: 'cont', items: cont });

    // Your languages: newest 50 films, channels on now, and series for each one
    const parts = (setting('homeLangRows') || 'films,live').split(',');
    for (const id of S.myLangs) {
      const lang = langById(id);
      if (!lang) continue;
      const ok = (kind) => (it) => !needsPin(kind, it.cat);
      if (parts.includes('films')) {
        const films = newest(langItems('movie', id).filter(ok('movie')), 50);
        if (films.length) rows.push({ key: 'lf-' + id, title: `New ${lang.name} films`, kind: 'movie', items: films, more: { screen: 'movies', lang: id } });
      }
      if (parts.includes('live')) {
        const ch = langItems('live', id).filter(ok('live')).slice(0, 30);
        if (ch.length) rows.push({ key: 'll-' + id, title: `${lang.name} channels`, kind: 'live', items: ch, more: { screen: 'live', lang: id } });
      }
      if (parts.includes('series')) {
        const se = newest(langItems('series', id).filter(ok('series')), 30);
        if (se.length) rows.push({ key: 'ls-' + id, title: `${lang.name} series`, kind: 'series', items: se, more: { screen: 'series', lang: id } });
      }
    }
    // Categories pinned with a long press
    for (const pin of S.pins) {
      const cat = C.cats[pin.kind].find((c) => c.id === pin.cat);
      if (!cat || needsPin(pin.kind, pin.cat)) continue;
      const items = pin.kind === 'live' ? itemsIn('live', pin.cat).slice(0, 30) : newest(itemsIn(pin.kind, pin.cat), 50);
      if (items.length) rows.push({ key: `pin-${pin.kind}-${pin.cat}`, title: pin.kind === 'live' ? cat.name : `New in ${cat.name}`, kind: pin.kind, items, pinned: true,
        more: { screen: pin.kind === 'movie' ? 'movies' : pin.kind, cat: pin.cat } });
    }

    // live sport right now (or whatever category has the most live programmes)
    const sports = C.cats.live.find((c) => /sport/i.test(c.name));
    if (sports && !needsPin('live', sports.id)) {
      const on = itemsIn('live', sports.id).filter((c) => nowNext(c)?.now).slice(0, 20);
      if (on.length) rows.push({ key: 'sport', title: 'Live sport now', kind: 'live', items: on });
    }
    // catch-up: programmes that finished in the last 6 h on archive channels you watch
    const cu = [];
    const t = now();
    const pool = [...new Set([...favs, ...recent, ...C.live.filter((c) => c.arch).slice(0, 40)])].filter((c) => c.arch && !needsPin('live', c.cat));
    for (const ch of pool) {
      for (const p of progs(ch)) if (p[1] < t && p[1] > t - 6 * 3600 && p[1] - p[0] >= 1800) cu.push({ ch, s: p[0], e: p[1], t: p[2], d: p[3] });
      if (cu.length > 60) break;
    }
    cu.sort((a, b) => b.e - a.e);
    if (cu.length) rows.push({ key: 'cu', title: 'Catch up on earlier today', kind: 'cu', items: cu.slice(0, 16) });

    const movies = [...C.movie].filter((m) => !needsPin('movie', m.cat)).sort((a, b) => b.added - a.added).slice(0, 24);
    if (movies.length) rows.push({ key: 'movies', title: 'Recently added films', kind: 'movie', items: movies });
    const series = [...C.series].filter((m) => !needsPin('series', m.cat)).sort((a, b) => b.added - a.added).slice(0, 24);
    if (series.length) rows.push({ key: 'series', title: 'Series', kind: 'series', items: series });
    return rows;
  }

  tile(kind, it, i) {
    if (kind === 'live') {
      const nn = nowNext(it);
      return `<button class="f tile ch-tile" data-k="live" data-id="${esc(it.id)}">
        <span class="ct-top">${logo(it, 'sm')}<span class="ct-num">${it.num}</span>${isFav('live', it.id) ? icon('heartFill', 'favmark') : ''}</span>
        <span class="ct-name">${esc(it.name)}</span>
        <span class="ct-now">${esc(nn && nn.now ? nn.now.t : 'No guide information')}</span>
        ${nn && nn.now ? progressBar(nn.now.pct, 'thin') : ''}</button>`;
    }
    if (kind === 'cont') {
      return `<button class="f tile land-tile" data-k="cont" data-i="${i}">
        ${poster({ name: it.title, img: it.poster }, true)}
        <span class="lt-cap"><b>${esc(it.title)}</b><small>${esc(it.sub || '')}${it.sub ? ' – ' : ''}${Math.max(1, Math.round((it.dur - it.pos) / 60000))} min left</small></span>
        ${progressBar(it.pos / it.dur, 'over')}</button>`;
    }
    if (kind === 'cu') {
      return `<button class="f tile cu-tile" data-k="cu" data-i="${i}">
        <span class="ct-top">${logo(it.ch, 'sm')}<span class="ct-chname">${esc(it.ch.name)}</span></span>
        <span class="ct-name">${esc(it.t)}</span>
        <span class="ct-now">${hhmm(it.s)}–${hhmm(it.e)}</span>
        <span class="cu-badge">${icon('history')}Catch-up</span></button>`;
    }
    return `<button class="f tile poster-tile" data-k="${kind}" data-id="${esc(it.id)}">
      ${poster(it)}<span class="pt-cap"><b>${esc(it.name)}</b><small>${it.year || ''}${it.rating ? ' ' : ''}${stars(it.rating)}</small></span></button>`;
  }

  render() {
    const ch = this.heroChannel();
    this.hero = ch;
    const nn = ch && nowNext(ch);
    this.rowData = this.rows();
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    this.view.innerHTML = `
      <div class="home-scroll"><div class="home-track">
        <header class="topbar">
          <div class="searchbar" data-group="top">
            <button class="f search-field" id="home-search">${icon('search')}<span>Search channels, films, series and what’s on</span></button>
            <button class="f mic-btn" id="home-mic" aria-label="Voice search">${icon('mic')}</button>
          </div>
          ${update.available ? `<button class="f update-pill" id="home-update">${icon('download')}Update available</button>` : ''}
          <div class="topbar-right"><span class="greet">${greet}</span><span class="clock" data-clock>${hhmm(now())}</span></div>
        </header>
        ${ch ? `<section class="hero" data-group="hero">
          <div class="hero-video" id="hero-video"><div class="preview-msg" hidden></div></div>
          <div class="hero-info">
            <p class="hero-kicker">${S.recentLive[0] ? 'Pick up where you left off' : 'On now'}</p>
            <div class="hero-ch">${logo(ch, 'md')}<div><b>${esc(ch.name)}</b><small>Channel ${ch.num}</small></div></div>
            <h1>${esc(nn && nn.now ? nn.now.t : ch.name)}</h1>
            ${nn && nn.now ? `<div class="hero-time"><span>${hhmm(nn.now.s)}</span>${progressBar(nn.now.pct)}<span>${hhmm(nn.now.e)}</span><em>${minutesLeft(nn.now.e)}</em></div>` : ''}
            ${nn && nn.next ? `<p class="hero-next">Next at ${hhmm(nn.next.s)}: ${esc(nn.next.t)}</p>` : ''}
            <div class="hero-actions">
              <button class="f btn primary" id="hero-watch">${icon('play')}Watch now</button>
              <button class="f btn" id="hero-guide">${icon('guide')}TV guide</button>
              ${ch.arch && nn && nn.now ? `<button class="f btn" id="hero-over">${icon('history')}Start over</button>` : ''}
            </div>
          </div>
        </section>` : ''}
        ${this.rowData.map((r, ri) => `<section class="row row-${r.kind}" data-row="${ri}">
          <h2>${esc(r.title)}${r.pinned ? icon('pin', 'pinmark') : ''}<small>${r.items.length >= 50 ? 'Latest 50' : ''}</small></h2>
          <div class="row-clip" data-scroll="x" data-pad="72"><div class="row-track" data-group="row${ri}">
            ${r.items.map((it, i) => this.tile(r.kind, it, i)).join('')}
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
    const g = v.querySelector('#hero-guide'); if (g) g.onclick = () => this.app.go('guide', { ch: this.hero.id });
    const o = v.querySelector('#hero-over'); if (o) o.onclick = () => { const nn = nowNext(this.hero); playCatchup(this.hero, nn.now, C.live, () => this.app.reload()); };
    v.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const row = this.rowData[+t.closest('[data-row]').dataset.row];
      if (t.dataset.k === 'more') { const m = row.more; this.app.go(m.screen, { lang: m.lang, cat: m.cat }); return; }
      this.open(t.dataset.k, t.dataset.id, t.dataset.i != null ? row.items[+t.dataset.i] : null, row);
    });
    v.addEventListener('focused', (e) => {
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
    // live preview in the hero
    this.previewTimer = setTimeout(() => this.startPreview(), 500);
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
    } else if (kind === 'cu') {
      playCatchup(data.ch, data, C.live, () => this.app.reload());
    } else {
      this.app.go('detail', { kind, id });
    }
  }

  onKey(k) {
    if (k !== 'hold' && k !== 'menu') return false;
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
    focus(this.view.querySelector('#hero-watch') || this.view.querySelector('.tile') || this.view.querySelector('#home-search'));
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

  destroy() { clearTimeout(this.previewTimer); stopPreview(); document.removeEventListener('update-available', this.onUpd); }
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
