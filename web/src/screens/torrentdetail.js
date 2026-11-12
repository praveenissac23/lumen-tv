import { findSources, titleMeta, resolveSource, preferredProvider, PROVIDERS, searchProviders } from '../torrents.js';
import { setting } from '../store.js';
import { esc, bytes, safeFile } from '../util.js';
import { icon, poster, sheet } from '../ui.js';
import { focus } from '../nav.js';
import { sendToDownloader } from '../actions.js';
import { playVod } from '../player.js';
import * as N from '../native.js';

export class TorrentDetailScreen {
  constructor(view, params, app) {
    this.view = view; this.app = app; this.item = params.item; this.dead = false;
    this.episode = params.restore?.episode || null;
    this.season = params.restore?.season || 1;
    this.index = params.restore?.index || 0;
    this.phase = 'loading'; this.token = 0;
    const item = this.item;
    const player = N.KNOWN_APPS.find((a) => a.pkg === setting(item.type === 'series' ? 'playerSeries' : 'playerMovie'))?.name;
    const downloader = N.KNOWN_APPS.find((a) => a.pkg === setting('downloader'))?.name;
    view.innerHTML = `<div class="td">
      <aside class="td-info">${poster(item)}<h1>${esc(item.name)}</h1><p>${esc(item.year)} · ${item.type === 'series' ? 'Series' : 'Film'}</p><p id="td-description"></p>
        <button class="f btn" id="td-settings">${icon('gear')}Debrid settings</button></aside>
      <section class="td-main"><div class="td-heading"><h1 id="td-heading">${item.type === 'series' ? 'Choose an episode' : 'Choose a source'}</h1>
        <button class="f chip" id="td-provider">${esc(PROVIDERS[preferredProvider()] || 'Connect account')}</button></div>
        <div class="td-actions" data-group="tdactions"><button class="f btn primary" id="td-play">${icon('play')}${player ? 'Play in ' + esc(player) : 'Play'}</button><button class="f btn" id="td-download">${icon('download')}${downloader ? 'Download with ' + esc(downloader) : 'Download'}</button></div>
        <p class="td-play-hint">Press OK on a source to ${player ? 'play in ' + esc(player) : 'play'}. Right opens Download.</p>
        <div id="td-seasons" class="chips" data-group="tdseasons"></div>
        <div class="td-scroll" data-scroll="y" data-pad="14"><div id="td-list" class="td-list" data-group="tdlist"><p class="st-intro">Loading…</p></div></div>
        <p id="td-status" class="td-status" role="status"></p>
        <small class="td-foot">Uses your existing Lumen player and download settings.</small>
      </section></div>`;
    view.querySelector('#td-settings').onclick = () => app.go('settings', { restore: { sec: 'debrid' } });
    view.querySelector('#td-provider').onclick = () => this.pickProvider();
    view.querySelector('#td-play').onclick = () => this.launch(false);
    view.querySelector('#td-download').onclick = () => this.launch(true);
    view.querySelector('#td-seasons').onclick = (e) => { const b = e.target.closest('[data-season]'); if (b) { this.season = +b.dataset.season; this.paintEpisodes(); focus(this.view.querySelector(`[data-season="${this.season}"]`)); } };
    view.querySelector('#td-list').onclick = (e) => {
      const b = e.target.closest('[data-source],[data-episode],[data-retry]');
      if (!b) return;
      if (b.hasAttribute('data-retry')) return this.loadSources(true, true);
      if (b.dataset.episode != null) { this.episode = this.episodes[+b.dataset.episode]; this.index = 0; this.loadSources(true); }
      else this.activateSource(b);
    };
    view.addEventListener('focused', (e) => { if (e.target.dataset.source != null) { this.index = +e.target.dataset.source; this.markSelection(); } });
    this.actions(false);
    this.load();
  }
  list(html, move = false) {
    if (this.dead) return;
    const node = this.view.querySelector('#td-list');
    const hadFocus = node.contains(document.activeElement);
    node._off = 0; node.style.transform = ''; node.innerHTML = html;
    if (move || hadFocus) focus(node.querySelector('.f') || this.view.querySelector('#td-provider'));
  }
  status(message) { if (!this.dead) this.view.querySelector('#td-status').textContent = message; }
  actions(on) { for (const id of ['td-play', 'td-download']) this.view.querySelector('#' + id).disabled = !on; }
  async load() {
    if (this.item.type === 'movie') { this.loadSources(); return; }
    try {
      const m = await titleMeta(this.item);
      if (this.dead) return;
      this.view.querySelector('#td-description').textContent = String(m.description || '').slice(0, 220);
      this.episodes = (m.videos || []).filter((v) => v.id && Number.isInteger(+v.season) && +v.episode > 0).sort((a, b) => +a.season - +b.season || +a.episode - +b.episode);
      const seasons = [...new Set(this.episodes.map((v) => +v.season))];
      if (!seasons.length) { this.list('<p class="st-intro">Episode information is unavailable. Try again later.</p>'); return; }
      if (!seasons.includes(this.season)) this.season = seasons.find((s) => s > 0) || seasons[0];
      // Bound TV focus targets even for series with hundreds of seasons.
      this.view.querySelector('#td-seasons').innerHTML = '<button class="f chip" id="td-season-pick">Season ' + this.season + '</button>';
      this.view.querySelector('#td-season-pick').onclick = async () => {
        const choice = await sheet({ title: 'Choose a season', options: seasons.map((s) => ({ label: s ? 'Season ' + s : 'Specials', value: String(s), on: s === this.season })) });
        if (this.dead) return;
        if (choice != null) { this.season = +choice; this.epPage = 0; this.episode = null; ++this.token; this.paintEpisodes(); }
        focus(this.view.querySelector('#td-season-pick'));
      };
      if (this.episode) this.loadSources(); else this.paintEpisodes();
    } catch (e) { if (!this.dead) this.list(`<p class="st-intro">${esc(e.message)}</p>`); }
  }
  paintEpisodes(move = false) {
    this.busy = false; this.phase = 'episodes'; this.actions(false); this.status('');
    this.view.querySelector('#td-heading').textContent = 'Choose an episode';
    this.view.querySelector('#td-season-pick').textContent = 'Season ' + this.season;
    // Draw only a page of episodes, not thousands of focusable DOM nodes.
    const episodes = this.episodes.map((v, i) => ({ ...v, i })).filter((v) => +v.season === this.season);
    const page = this.epPage || 0, pages = Math.ceil(episodes.length / 30);
    const shown = episodes.slice(Math.min(page, pages - 1) * 30, (Math.min(page, pages - 1) + 1) * 30);
    this.list(shown.map((v) => `<button class="f td-source" data-episode="${v.i}"><b>Episode ${+v.episode} · ${esc(v.title || 'Untitled')}</b><small>${esc(v.overview || '').slice(0, 120)}</small></button>`).join('') + (pages > 1 ? '<button class="f btn" id="td-more-episodes">Next episodes</button>' : ''), move);
    const more = this.view.querySelector('#td-more-episodes');
    if (more) more.onclick = () => { this.epPage = (page + 1) % pages; this.paintEpisodes(true); };
  }
  async loadSources(move = false, refresh = false) {
    const token = ++this.token;
    this.busy = false; this.phase = 'sources'; this.sources = []; this.actions(false); this.status('Searching internet torrent indexes…');
    this.view.querySelector('#td-heading').textContent = this.episode ? `S${this.episode.season} E${this.episode.episode} · Sources` : 'Choose a source';
    this.list('<p class="st-intro">Loading sources…</p>');
    if (!searchProviders().length) {
      this.status(''); this.list('<p class="st-intro">Internet torrent search is switched off. Enable it in Debrid settings, or add another source provider.</p>');
      if (move) focus(this.view.querySelector('#td-settings')); return;
    }
    try {
      const sources = await findSources(this.item.type, this.episode?.id || this.item.id, { refresh });
      if (this.dead || token !== this.token) return;
      this.sources = sources;
      this.index = Math.min(this.index, Math.max(0, sources.length - 1));
      const rows = sources.map((s, i) => {
        const via = this.sourceProvider(s);
        return `<button class="f td-source ${via ? 'td-debrid' : ''} ${i === this.index ? 'selected' : ''}" data-source="${i}"><b>${s.quality ? s.quality + 'p' : 'Quality unknown'} <span class="td-route ${via ? 'td-route-debrid' : ''}">${icon(via ? 'link' : 'play')}<span data-route>${esc(via || (s.hash ? 'Debrid account needed' : 'Direct stream'))}</span></span></b><span>${esc(s.text)}</span><small>${[esc(s.sourceLabel), s.size ? bytes(s.size) : '', s.seeds != null ? s.seeds.toLocaleString() + ' seeds' : ''].filter(Boolean).join(' · ')}</small><span class="td-row-play">${icon('play')}OK · ${playerLabel(this.item)}</span></button>`;
      }).join('');
      this.list((rows || '<p class="st-intro">No supported internet torrents were found for this title. Try another source or your IPTV library.</p>') + '<button class="f btn" data-retry>Search sources again</button>', move);
      this.actions(!!sources.length);
      this.status(sources.sourceSummary || 'Search complete.');
      if (document.activeElement === this.view.querySelector('#td-provider') && !document.querySelector('#overlays .sheet-wrap')) focus(this.view.querySelector(`[data-source="${this.index}"]`));
    } catch (e) {
      if (!this.dead && token === this.token) { this.status(e.message); this.list('<button class="f btn" data-retry>Retry sources</button>', move); }
    }
  }
  sourceProvider(source) {
    if (source.hash && !source.url) return PROVIDERS[this.provider || preferredProvider()] || '';
    // Label only known provider hostnames or explicit add-on provider markers.
    let host = ''; try { host = new URL(source.url).hostname; } catch { }
    if (/(^|\.)real-debrid\.(com|net)$/.test(host) || /\[RD[+ ]?\]/i.test(source.text)) return 'Real-Debrid link';
    if (/(^|\.)alldebrid\.(com|net)$/.test(host) || /\[AD[+ ]?\]/i.test(source.text)) return 'AllDebrid link';
    return '';
  }
  activateSource(button) {
    const index = +button.dataset.source;
    if (!Number.isInteger(index) || !this.sources?.[index]) return;
    this.index = index; this.markSelection(); this.launch(false);
  }
  refreshRoutes() {
    this.view.querySelectorAll('[data-source]').forEach(button => {
      const source = this.sources[+button.dataset.source], provider = this.sourceProvider(source);
      button.classList.toggle('td-debrid', !!provider);
      button.querySelector('.td-route').classList.toggle('td-route-debrid', !!provider);
      button.querySelector('[data-route]').textContent = provider || (source.hash ? 'Debrid account needed' : 'Direct stream');
    });
  }
  markSelection() { this.view.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('selected', +b.dataset.source === this.index)); }
  async pickProvider() {
    const { accounts } = await import('../torrents.js');
    const a = accounts(), options = Object.keys(PROVIDERS).filter((p) => a[p]?.key).map((p) => ({ label: PROVIDERS[p], value: p, on: (this.provider || preferredProvider()) === p }));
    if (!options.length) { this.app.go('settings', { restore: { sec: 'debrid' } }); return; }
    const p = await sheet({ title: 'Use Debrid account', options });
    if (this.dead) return;
    if (p) { this.provider = p; this.view.querySelector('#td-provider').textContent = PROVIDERS[p]; this.refreshRoutes(); }
    focus(this.view.querySelector('#td-provider'));
  }
  async launch(download) {
    if (this.busy || !this.sources?.length || this.dead) return;
    this.busy = true;
    const token = this.token, stream = this.sources[this.index];
    const alive = () => !this.dead && token === this.token;
    this.actions(false); this.status('Checking the selected source…');
    try {
      const result = await resolveSource(stream, this.provider || preferredProvider(), this.episode, async (files) => {
        if (!alive()) return null;
        const value = await sheet({ title: 'Choose the video file', options: files.slice(0, 200).map((f, i) => ({ label: f.name, hint: f.size ? bytes(f.size) : '', value: String(i) })) });
        return alive() && value != null ? files[+value] : null;
      }, alive);
      if (!alive()) return;
      const sub = this.episode ? `S${this.episode.season} E${this.episode.episode}` : '';
      if (download) {
        const file = result.file || safeFile(this.item.name + (sub ? ' ' + sub : '')) + '.mp4';
        this.status('Opening your download manager…');
        await sendToDownloader(result.url, file, result.size || stream.size);
      } else {
        this.status('Opening your selected player…');
        const key = 'torrent:' + (this.episode?.id || this.item.id);
        playVod({ title: this.item.name, sub, url: result.url, poster: this.item.img, kind: this.episode ? 'episode' : 'movie', id: key, year: this.item.year, torrentItem: this.item, torrentEpisode: this.episode }, key, () => this.app.reload());
      }
    } catch (e) { if (alive()) this.status(e.message === 'Cancelled' ? 'Selection cancelled.' : e.message); }
    finally { if (alive()) { this.busy = false; this.actions(true); if (!this.view.contains(document.activeElement)) focus(this.view.querySelector(`[data-source="${this.index}"]`)); } }
  }
  onKey(k) {
    const row = document.activeElement?.closest('[data-source]');
    if (row && this.view.contains(row)) {
      if (['ok', 'play', 'playpause'].includes(k)) { this.activateSource(row); return true; }
      if (k === 'right') { focus(this.view.querySelector('#td-download')); return true; }
    }
    if (k === 'back' && this.episode && this.item.type === 'series' && this.phase === 'sources') {
      ++this.token; this.episode = null; this.paintEpisodes(true); return true;
    }
    if (k === 'left' && document.activeElement?.hasAttribute('data-source')) { focus(this.view.querySelector('#td-settings')); return true; }
    return false;
  }
  focus() { if (!document.querySelector('#overlays .sheet-wrap')) focus(this.view.querySelector(`[data-source="${this.index}"]`) || this.view.querySelector('#td-provider')); }
  save() { return { episode: this.episode, season: this.season, index: this.index }; }
  destroy() { this.dead = true; ++this.token; }
}

function playerLabel(item) {
  const name = N.KNOWN_APPS.find(a => a.pkg === setting(item.type === 'series' ? 'playerSeries' : 'playerMovie'))?.name;
  return name ? 'Play in ' + esc(name) : 'Play';
}
