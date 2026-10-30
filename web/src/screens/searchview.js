// Master search: on-screen keyboard + voice, instant grouped results.
import { C, nowNext, needsPin } from '../data.js';
import { S, pushSearch, isFav } from '../store.js';
import { esc, hhmm, now, dayLabel, debounce } from '../util.js';
import { focus } from '../nav.js';
import { icon, logo, poster, progressBar, stars } from '../ui.js';
import { search, suggest } from '../search.js';
import { playLive, playCatchup } from '../player.js';
import { itemActions } from '../actions.js';
import { showKeyboard } from '../native.js';

const KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

export class SearchScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view; this.params = params;
    this.q = params.restore?.q ?? params.q ?? '';
    view.innerHTML = `<div class="sr">
      <aside class="sr-kb">
        <div class="sr-box">${icon('search')}<input class="f sr-input" id="sr-input" value="${esc(this.q)}" placeholder="Search" autocomplete="off" spellcheck="false">
          <button class="f mic-btn sm" id="sr-mic" aria-label="Voice search">${icon('mic')}</button></div>
        <div class="kb" data-group="kb">${KEYS.map((k) => `<button class="f key" data-key="${k}">${k}</button>`).join('')}
          <button class="f key wide" data-key=" ">Space</button><button class="f key" data-key="del" aria-label="Delete">${icon('back')}</button><button class="f key" data-key="clear">Clear</button></div>
        ${params.ime ? `<div class="ime-hint">${icon('mic')}<span>Hold the Alexa button and speak. Your words appear in the search box.</span></div>` : ''}
        <div class="sr-sugg" id="sr-sugg" data-group="sugg"></div>
      </aside>
      <section class="sr-results"><div class="sr-scroll" data-scroll="y" data-pad="0"><div class="sr-track" id="sr-track"></div></div></section>
    </div>`;
    this.input = view.querySelector('#sr-input');
    this.run = debounce(() => this.paint(), 120);
    this.input.addEventListener('input', () => { this.q = this.input.value; this.run(); });
    view.querySelector('.kb').addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      const k = b.dataset.key;
      if (k === 'del') this.q = this.q.slice(0, -1);
      else if (k === 'clear') this.q = '';
      else this.q += k;
      this.input.value = this.q;
      this.run();
    });
    view.querySelector('#sr-mic').onclick = () => app.openVoice();
    view.addEventListener('click', (e) => {
      const s = e.target.closest('[data-q]');
      if (s) { this.q = s.dataset.q; this.input.value = this.q; this.paint(); return; }
      const t = e.target.closest('.res');
      if (t) this.open(t);
    });
    view.addEventListener('focused', (e) => {
      // keep result rows in view vertically
      const sec = e.target.closest('.sr-sec');
      const tr = view.querySelector('#sr-track');
      if (!sec) return;
      const y = Math.max(0, sec.offsetTop - 10);
      const max = Math.max(0, tr.scrollHeight - view.querySelector('.sr-scroll').offsetHeight);
      const v = Math.min(y, max);
      tr._off = -v; tr.style.transform = `translate3d(0,${-v}px,0)`;
    });
    this.paint();
  }

  paint() {
    const q = this.q.trim();
    const track = this.view.querySelector('#sr-track');
    track._off = 0; track.style.transform = '';
    const sugg = this.view.querySelector('#sr-sugg');
    if (!q) {
      this.res = null;
      sugg.innerHTML = '';
      track.innerHTML = `<div class="sr-empty">
        <h1>Find anything in your playlist</h1>
        <p>Channels, films, series and programmes on now, later or on catch-up. Press the microphone button to speak.</p>
        ${S.recentSearches.length ? `<h2>Recent searches</h2><div class="chips wrap" data-group="recent">${S.recentSearches.map((s) => `<button class="f chip" data-q="${esc(s)}">${icon('history')}${esc(s)}</button>`).join('')}</div>` : ''}
        <h2>Try saying</h2><ul class="try">${tryLines().map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>`;
      return;
    }
    const r = search(q);
    this.res = r;
    const words = suggest(q, 4).filter((s) => s.toLowerCase() !== q.toLowerCase());
    sugg.innerHTML = words.map((w) => `<button class="f sugg" data-q="${esc(w)}">${icon('search')}<span>${esc(w)}</span></button>`).join('');
    if (!r.total) {
      track.innerHTML = `<div class="sr-empty"><h1>No results for “${esc(q)}”</h1><p>Check the spelling, try fewer words, or search by channel number.</p></div>`;
      return;
    }
    const t = now();
    const best = r.best;
    let html = `<p class="sr-count">${this.params.voice && q === (this.params.q || '').trim() ? `You said “${esc(this.params.q)}”. ` : ''}${r.total} results in ${Math.max(1, Math.round(r.ms))} ms</p>`;
    if (best) html += `<section class="sr-sec sr-best" data-group="best">${this.bestCard(best, t)}</section>`;
    const row = (title, items, render, key) => items.length ? `<section class="sr-sec"><h2>${title}<small>${items.length}</small></h2>
      <div class="row-clip" data-scroll="x" data-pad="72"><div class="row-track" data-group="r-${key}">${items.map(render).join('')}</div></div></section>` : '';
    html += row('Channels', r.live, (ch, i) => this.chTile(ch, i), 'live');
    html += row('On TV', r.progs, (p, i) => this.progTile(p, i, t), 'progs');
    html += row('Films', r.movie, (m, i) => this.posterTile('movie', m, i), 'movie');
    html += row('Series', r.series, (m, i) => this.posterTile('series', m, i), 'series');
    track.innerHTML = html;
  }

  bestCard(b, t) {
    const it = b.item;
    if (b.kind === 'live') {
      const nn = nowNext(it);
      return `<button class="f res best" data-kind="live" data-i="${this.res.live.indexOf(it)}">${logo(it, 'lg')}
        <span class="best-main"><small>Top result: channel ${it.num}</small><b>${esc(it.name)}</b>
        <span>${esc(nn && nn.now ? 'Now: ' + nn.now.t : '')}</span>${nn && nn.now ? progressBar(nn.now.pct) : ''}</span>
        <span class="best-cta">${icon('play')}Watch</span></button>`;
    }
    if (b.kind === 'prog') {
      const live = it.s <= t && it.e > t;
      return `<button class="f res best" data-kind="prog" data-i="${this.res.progs.indexOf(it)}">${logo(it.ch, 'lg')}
        <span class="best-main"><small>Top result: ${live ? 'on now' : it.e <= t ? 'catch-up' : 'coming up'} on ${esc(it.ch.name)}</small><b>${esc(it.t)}</b>
        <span>${dayLabel(it.s)} ${hhmm(it.s)}–${hhmm(it.e)}</span></span>
        <span class="best-cta">${icon('play')}${live ? 'Watch live' : it.e <= t ? 'Catch up' : 'View'}</span></button>`;
    }
    return `<button class="f res best poster" data-kind="${b.kind}" data-id="${esc(it.id)}">${poster(it)}
      <span class="best-main"><small>Top result: ${b.kind === 'movie' ? 'film' : 'series'}</small><b>${esc(it.name)}</b>
      <span>${it.year || ''} ${stars(it.rating)}</span></span><span class="best-cta">${icon('play')}Open</span></button>`;
  }

  chTile(ch, i) {
    const nn = nowNext(ch);
    return `<button class="f tile ch-tile res" data-kind="live" data-i="${i}">
      <span class="ct-top">${logo(ch, 'sm')}<span class="ct-num">${ch.num}</span>${isFav('live', ch.id) ? icon('heartFill', 'favmark') : ''}</span>
      <span class="ct-name">${esc(ch.name)}</span><span class="ct-now">${esc(nn && nn.now ? nn.now.t : '')}</span>${nn && nn.now ? progressBar(nn.now.pct, 'thin') : ''}</button>`;
  }

  progTile(p, i, t) {
    const live = p.s <= t && p.e > t, past = p.e <= t;
    return `<button class="f tile prog-tile res" data-kind="prog" data-i="${i}">
      <span class="ct-top">${logo(p.ch, 'sm')}<span class="ct-chname">${esc(p.ch.name)}</span></span>
      <span class="ct-name">${esc(p.t)}</span>
      <span class="ct-now">${live ? '<span class="tag live">Live</span>' : past ? '<span class="tag cu">Catch-up</span>' : ''}${dayLabel(p.s)} ${hhmm(p.s)}</span>
      ${live ? progressBar((t - p.s) / (p.e - p.s), 'thin') : ''}</button>`;
  }

  posterTile(kind, m, i) {
    return `<button class="f tile poster-tile res" data-kind="${kind}" data-id="${esc(m.id)}">${poster(m)}<span class="pt-cap"><b>${esc(m.name)}</b><small>${m.year || ''}</small></span></button>`;
  }

  async open(t) {
    const kind = t.dataset.kind;
    pushSearch(this.q);
    if (kind === 'live') {
      const ch = this.res.live[+t.dataset.i];
      if (!(await this.app.ensureUnlocked('live', ch.cat))) return;
      playLive(ch, this.res.live, () => this.app.reload());
    } else if (kind === 'prog') {
      const p = this.res.progs[+t.dataset.i];
      if (!(await this.app.ensureUnlocked('live', p.ch.cat))) return;
      const tn = now();
      if (p.s <= tn && p.e > tn) playLive(p.ch, C.live, () => this.app.reload());
      else if (p.e <= tn && p.ch.arch) playCatchup(p.ch, p, C.live, () => this.app.reload());
      else this.app.go('guide', { ch: p.ch.id });
    } else {
      this.app.go('detail', { kind, id: t.dataset.id });
    }
  }

  onKey(k) {
    const a = document.activeElement;
    if (k === 'hold' && a && a.closest('.res')) {
      const t = a.closest('.res'), kind = t.dataset.kind;
      if (kind === 'live') itemActions('live', this.res.live[+t.dataset.i], this.app, { list: this.res.live });
      else if (kind === 'prog') itemActions('live', this.res.progs[+t.dataset.i].ch, this.app);
      else itemActions(kind, C.byId[kind].get(t.dataset.id), this.app);
      return true;
    }
    if (k === 'submit') { pushSearch(this.q); const f = this.view.querySelector('.sr-results .f'); if (f) focus(f); return true; }
    if (a === this.input && k === 'down') { focus(this.view.querySelector('.key')); return true; }
    if (a && a.closest('.kb') && k === 'right') {
      const keys = [...this.view.querySelectorAll('.kb .key')];
      const i = keys.indexOf(a);
      const atEdge = (i < 36 && i % 6 === 5) || i === keys.length - 1;
      if (atEdge) { const f = this.view.querySelector('.sr-results .f'); if (f) focus(f); return true; }
    }
    if (/^d\d$/.test(k) && a && !a.matches('input')) { this.q += k.slice(1); this.input.value = this.q; this.run(); return true; }
    return false;
  }

  focus() {
    if (this.params.ime) { focus(this.input); showKeyboard(); return; }
    if (this.params.voice && this.view.querySelector('.sr-results .f')) { focus(this.view.querySelector('.sr-results .f')); return; }
    focus(this.view.querySelector('.key'));
  }
  save() { return { q: this.q }; }
}

export function tryLines() {
  const ch = C.byId.live.get(S.favs.live[0]) || C.live.find((c) => /sport/i.test(c.name)) || C.live[0];
  const film = C.movie[0];
  const out = [];
  if (ch) out.push(`“Play ${ch.name}”`);
  if (ch) out.push(`“Channel ${ch.num}”`);
  out.push('“Football” to find matches on now');
  if (film) out.push(`“${film.name}”`);
  return out;
}
