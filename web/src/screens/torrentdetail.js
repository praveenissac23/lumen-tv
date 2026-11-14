import { findSources, titleMeta, resolvePlayable, prepareDebrid, readySources, magnetUrl, accounts, preferredProvider, PROVIDERS, searchProviders } from '../torrents.js';
import { setting } from '../store.js';
import { esc, bytes, safeFile } from '../util.js';
import { icon, poster, sheet, toast } from '../ui.js';
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
    this.phase = 'loading'; this.token = 0; this.actionToken = 0;
    const item = this.item;
    view.innerHTML = `<div class="td">
      <aside class="td-info">${poster(item)}<h1>${esc(item.name)}</h1><p>${esc(item.year)} · ${item.type === 'series' ? 'Series' : 'Film'}</p><p id="td-description"></p>
        <button class="f btn" id="td-settings">${icon('gear')}Torrent settings</button></aside>
      <section class="td-main"><div class="td-heading"><h1 id="td-heading">${item.type === 'series' ? 'Choose an episode' : 'Choose a source'}</h1></div>
        <p class="td-play-hint">Press OK on a source to play in VLC. Hold OK or press Menu for more options.</p>
        <div id="td-seasons" class="chips" data-group="tdseasons"></div>
        <div class="td-scroll" data-scroll="y" data-pad="14"><div id="td-list" class="td-list" data-group="tdlist"><p class="st-intro">Loading…</p></div></div>
        <p id="td-status" class="td-status" role="status"></p>
        <small class="td-foot">Green means confirmed ready. Uploads happen only when you choose Upload.</small>
      </section></div>`;
    view.querySelector('#td-settings').onclick = () => app.go('settings', { restore: { sec: 'debrid' } });
    view.querySelector('#td-seasons').onclick = (e) => { const b = e.target.closest('[data-season]'); if (b) { this.season = +b.dataset.season; this.paintEpisodes(); focus(this.view.querySelector(`[data-season="${this.season}"]`)); } };
    view.querySelector('#td-list').onclick = (e) => {
      if (this.suppressSourceClick) { this.suppressSourceClick = false; e.preventDefault(); return; }
      const b = e.target.closest('[data-source],[data-episode],[data-retry]');
      if (!b) return;
      if (b.hasAttribute('data-retry')) return this.loadSources(true, true);
      if (b.dataset.episode != null) { this.episode = this.episodes[+b.dataset.episode]; this.index = 0; this.loadSources(true); }
      else this.activateSource(b);
    };
    const sourceList = view.querySelector('#td-list');
    sourceList.oncontextmenu = e => { const row=e.target.closest('[data-source]'); if(row){e.preventDefault();this.sourceOptions(row);} };
    sourceList.onpointerdown = e => {
      const row=e.target.closest('[data-source]'); if(!row || e.button !== 0) return;
      this.suppressSourceClick=false;
      this.holdTimer=setTimeout(()=>{this.suppressSourceClick=true;this.sourceOptions(row);},650);
    };
    for(const event of ['pointerup','pointercancel','pointerleave']) sourceList.addEventListener(event,()=>clearTimeout(this.holdTimer));
    view.addEventListener('focused', (e) => { if (e.target.dataset.source != null) { this.index = +e.target.dataset.source; this.markSelection(); } });

    this.load();
  }
  list(html, move = false) {
    if (this.dead) return;
    const node = this.view.querySelector('#td-list');
    const hadFocus = node.contains(document.activeElement);
    node._off = 0; node.style.transform = ''; node.innerHTML = html;
    if (move || hadFocus) focus(node.querySelector('.f') || this.view.querySelector('#td-settings'));
  }
  status(message) { if (!this.dead) this.view.querySelector('#td-status').textContent = message; }
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
    this.busy = false; this.phase = 'episodes'; this.status('');
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
    this.busy = false; this.phase = 'sources'; this.sources = []; this.status('Searching internet torrent indexes…');
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
        const via = this.sourceProvider(s); const ready = !!s.readyProviders?.length;
        return `<button class="f td-source ${ready ? 'td-debrid' : ''} ${i === this.index ? 'selected' : ''}" data-source="${i}"><b>${s.quality ? s.quality + 'p' : 'Quality unknown'} <span class="td-route ${ready ? 'td-route-debrid' : 'td-route-external'}">${icon(ready ? 'check' : s.url ? 'play' : 'globe')}<span data-route>${esc(this.routeLabel(s))}</span></span></b><span>${esc(s.text)}</span><small>${[esc(s.sourceLabel), s.size ? bytes(s.size) : '', s.seeds != null ? s.seeds.toLocaleString() + ' seeds' : ''].filter(Boolean).join(' · ')}</small><span class="td-row-play">${icon('play')}OK · Play in VLC</span></button>`;
      }).join('');
      this.list((rows || '<p class="st-intro">No supported internet torrents were found for this title. Try another source or your IPTV library.</p>') + '<button class="f btn" data-retry>Search sources again</button>', move);

      this.status(sources.sourceSummary || 'Search complete.');
      this.refreshAvailability(token, refresh);
      if (document.activeElement === this.view.querySelector('#td-settings') && !document.querySelector('#overlays .sheet-wrap')) focus(this.view.querySelector(`[data-source="${this.index}"]`));
    } catch (e) {
      if (!this.dead && token === this.token) { this.status(e.message); this.list('<button class="f btn" data-retry>Retry sources</button>', move); }
    }
  }
  sourceProvider(source) {
    if(source.readyProviders?.length) return PROVIDERS[source.readyProviders[0].provider];
    let host=''; try { host=new URL(source.url).hostname; } catch { }
    if (/(^|\.)real-debrid\.(com|net)$/.test(host) || /(?:\[RD[+ ]?\]|\bRD\+)/i.test(source.text)) return 'Real-Debrid link';
    if (/(^|\.)alldebrid\.(com|net)$/.test(host) || /(?:\[AD[+ ]?\]|\bAD\+)/i.test(source.text)) return 'AllDebrid link';
    return '';
  }
  routeLabel(source) {
    if(source.readyProviders?.length) return 'Ready in ' + source.readyProviders.map(m=>PROVIDERS[m.provider]).join(' / ');
    return source.url ? (this.sourceProvider(source) || 'Direct video link') : 'External torrent';
  }
  async refreshAvailability(token = this.token, refresh = false) {
    const sources=this.sources;
    const {found,errors}=await readySources(sources,refresh);
    if(this.dead || token !== this.token || this.sources !== sources) return;
    for(const source of sources) source.readyProviders=found.get(source.hash)||[];
    this.refreshRoutes();
    if(errors.length) this.status((sources.sourceSummary||'')+' Availability unknown for '+errors.join(', ')+'.');
  }
  activateSource(button) {
    const index = +button.dataset.source;
    if (!Number.isInteger(index) || !this.sources?.[index]) return;
    if(this.busy) {
      if(index===this.index)return;
      N.torrentCancel(); ++this.actionToken; this.busy=false; this.clearPending();
    }
    this.index = index; this.markSelection(); this.launch(false,{pkg:'org.videolan.vlc',autoFile:true});
  }
  refreshRoutes() {
    this.view.querySelectorAll('[data-source]').forEach(button => {
      const source=this.sources[+button.dataset.source], ready=!!source.readyProviders?.length;
      button.classList.toggle('td-debrid',ready);
      button.querySelector('.td-route').classList.toggle('td-route-debrid',ready);
      button.querySelector('.td-route').classList.toggle('td-route-external',!ready);
      button.querySelector('[data-route]').textContent=this.routeLabel(source);
      button.querySelector('.td-row-play').innerHTML=icon('list') + 'OK · Play in VLC';
    });
  }
  async sourceOptions(row) {
    if(this.dead || this.menuOpen) return;
    if(this.busy) N.torrentCancel();
    this.index=+row.dataset.source; this.markSelection();
    const stream=this.sources?.[this.index]; if(!stream) return;
    this.clearPending(); this.status('Choose an action for this source.');
    ++this.actionToken; this.busy=false; this.menuOpen=true;
    const options=[
      {label:'Play in VLC',value:'vlc',icon:'play',hint:stream.url||stream.readyProviders?.length?'Ready video link':N.hasLocalTorrentEngine?'Stream with Lumen':'Needs a torrent engine'},
      {label:'Open with another player',value:'open',icon:'external'},
      {label:'Download using…',value:'download',icon:'download'},
      ...(stream.hash?Object.entries(PROVIDERS).map(([provider,name])=>({label:'Upload to '+name,value:'upload:'+provider,icon:'plus',hint:accounts()[provider]?.key?'Only when you choose this action':'Connect account in settings'})):[]),
      ...(stream.hash?[{label:'Open magnet in torrent app',value:'magnet',icon:'globe',hint:'Uses an installed torrent app; no Debrid upload'}]:[]),
    ];
    const choice=await sheet({title:`Source ${this.index + 1} · ${stream.quality ? stream.quality + 'p' : 'Actions'}`,options});
    this.menuOpen=false; if(this.dead) return;
    focus(this.view.querySelector(`[data-source="${this.index}"]`));
    if(choice==='vlc') this.launch(false,{pkg:'org.videolan.vlc'});
    else if(choice==='open') this.launch(false,{pkg:''});
    else if(choice==='magnet') this.openMagnet(stream);
    else if(choice?.startsWith('upload:')) {
      const provider=choice.split(':')[1];
      if(!accounts()[provider]?.key) this.app.go('settings',{restore:{sec:'debrid'}});
      else this.launch(false,{prepareProvider:provider});
    } else if(choice==='download') {
      const pkg=await sheet({title:'Download using',options:[...N.installedApps().filter(a=>a.role==='download').map(a=>({label:a.name,value:a.pkg,icon:'download'})),{label:'Other downloader (IDM / Radium…)',value:'__other',icon:'external'}]});
      if(this.dead) return;
      focus(this.view.querySelector(`[data-source="${this.index}"]`));
      if(pkg!=null) this.launch(true,{pkg:pkg==='__other'?'':pkg});
    }
  }
  openMagnet(stream, pkg='') {
    const ok=N.openWith(pkg,magnetUrl(stream),{title:this.item.name,mode:'magnet'});
    this.status(ok===false?'No torrent app accepted this magnet. Install a torrent-streaming app or configure TorrServer in settings.':'Opening external torrent app. Nothing was uploaded to Debrid.');
  }
  markSelection() { this.view.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('selected', +b.dataset.source === this.index)); }
  clearPending() {
    this.view.querySelectorAll('[aria-busy="true"]').forEach(row=>{row.removeAttribute('aria-busy');row.querySelector('.td-row-play').innerHTML=icon('list')+'OK · Play in VLC';});
  }
  async launch(download, {pkg=null,prepareProvider=null,autoFile=false} = {}) {
    if (this.busy || !this.sources?.length || this.dead) return;
    this.busy = true;
    const pendingRow=this.view.querySelector(`[data-source="${this.index}"]`);
    if(pendingRow){pendingRow.setAttribute('aria-busy','true');pendingRow.querySelector('.td-row-play').textContent='Preparing video… Hold OK or press Menu for options';}
    const action = ++this.actionToken;
    const token = this.token, stream = this.sources[this.index];
    const alive = () => !this.dead && token === this.token && action === this.actionToken;
    this.status(stream.url || stream.readyProviders?.length ? 'Opening the selected video link…' : N.hasLocalTorrentEngine ? 'Starting torrent stream… Connecting to peers and buffering video.' : 'Checking the selected source…');
    try {
      const result = await (prepareProvider ? prepareDebrid : resolvePlayable)(stream, prepareProvider || this.provider || preferredProvider(), this.episode, async (files) => {
        if (!alive()) return null;
        if(autoFile && !this.episode) return files.reduce((best,file)=>(+file.size||0)>(+best.size||0)?file:best,files[0]);
        const value = await sheet({ title: 'Choose the video file', options: files.slice(0, 200).map((f, i) => ({ label: f.name, hint: f.size ? bytes(f.size) : '', value: String(i) })) });
        return alive() && value != null ? files[+value] : null;
      }, alive, message=>{if(alive())this.status(message);});
      if (!alive()) return;
      if (prepareProvider) {
        this.status(result ? 'Ready in '+PROVIDERS[prepareProvider]+'. Select the source to play.' : 'Added to '+PROVIDERS[prepareProvider]+'. Preparing there; no player was opened.');
        this.refreshAvailability(this.token,true); return;
      }
      this.refreshRoutes();
      if (result.magnet) {
        const magnetPkg = pkg ?? (download ? setting('downloader') || '' : '');
        if((download || pkg!=null) && !magnetPkg.startsWith('idm.internet.download.manager')) { this.status('VLC and HTTP downloaders need a video URL. Configure TorrServer, choose a ready video link, or open this magnet in a torrent app. Nothing was uploaded.'); return; }
        this.openMagnet(stream,magnetPkg); return;
      }
      if (pkg!=null) {
        const ok=N.openWith(pkg,result.url,{title:this.item.name,file:result.file||safeFile(this.item.name)+'.mp4',mode:download?'download':'play',torrent:!download});
        if(ok===false) {const message='The selected app could not open this video link. Check that it is installed.';this.status(message);toast(message,'err');}
        else this.status('Opening '+(download?'download manager':'player')+'…'); return;
      }
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
    } catch (e) { if (alive()) {const message=e.message === 'Cancelled' ? 'Selection cancelled.' : e.message;this.status(message);if(e.message!=='Cancelled')toast(message,'err');} }
    finally { if (alive()) { this.busy = false; this.clearPending(); if (!this.view.contains(document.activeElement)) focus(this.view.querySelector(`[data-source="${this.index}"]`)); } }
  }
  onKey(k) {
    const row = document.activeElement?.closest('[data-source]');
    if (row && this.view.contains(row)) {
      if (k === 'hold' || k === 'menu') { this.sourceOptions(row); return true; }
      if (k === 'ok' || k === 'play' || k === 'playpause') { this.activateSource(row); return true; }
      if (k === 'right') { this.sourceOptions(row); return true; }
    }
    if (k === 'back' && this.episode && this.item.type === 'series' && this.phase === 'sources') {
      if(this.busy)N.torrentCancel();
      ++this.token; this.episode = null; this.paintEpisodes(true); return true;
    }
    if (k === 'left' && document.activeElement?.hasAttribute('data-source')) { focus(this.view.querySelector('#td-settings')); return true; }
    return false;
  }
  focus() { if (!document.querySelector('#overlays .sheet-wrap')) focus(this.view.querySelector(`[data-source="${this.index}"]`) || this.view.querySelector('#td-settings')); }
  save() { return { episode: this.episode, season: this.season, index: this.index }; }
  destroy() { if(this.busy)N.torrentCancel();this.dead = true; ++this.token; ++this.actionToken; clearTimeout(this.holdTimer); }
}
