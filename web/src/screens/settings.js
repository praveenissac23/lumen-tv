// Settings: playlists, parental control, categories, playback, voice and remote, guide.
import { C, testXtream, refresh, refreshEpg, loadFromCache, clearEpgCache } from '../data.js';
import { epgInfo } from '../epg.js';
import { S, set, setting, upsertPlaylist, removePlaylist, setLocked, isLocked, setHidden, isHidden, activePlaylist, flush, toggleLang, moveLang, togglePin, langRowsFor, setLangRows } from '../store.js';
import { LANGS, langById, langItems } from '../languages.js';
import { SUB_LANGS, langName } from '../subs.js';
import { WALLPAPERS, ACCENTS, applyLook } from '../look.js';
import qrcode from 'qrcode-generator';
import { update, checkForUpdate, installUpdate, currentBuild } from '../updates.js';
import { esc } from '../util.js';
import { focus, focusFirst } from '../nav.js';
import { icon, toast, sheet, form, pinPad } from '../ui.js';
import * as N from '../native.js';

const SECTIONS = [
  ['playlists', 'Playlists', 'list'], ['langs', 'Home and languages', 'globe'], ['look', 'Wallpaper and colour', 'image'],
  ['downloads', 'Downloads and players', 'download'], ['subs', 'Subtitles', 'subtitles'], ['phone', 'Phone remote', 'phone'],
  ['voice', 'Voice search', 'mic'], ['parental', 'Parental control', 'lock'], ['cats', 'Categories', 'eyeOff'],
  ['playback', 'Playback', 'play'], ['guide', 'TV guide', 'guide'], ['about', 'About', 'tv'],
];

export class SettingsScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view;
    this.sec = params.restore?.sec || 'playlists';
    view.innerHTML = `<div class="st">
      <nav class="st-nav" data-group="stnav" data-zone="stnav"><h2 class="col-h">Settings</h2>
        ${SECTIONS.map(([k, l, ic]) => `<button class="f st-sec ${k === this.sec ? 'on' : ''}" data-sec="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
      <section class="st-panel" data-scroll="y" data-pad="40" data-zone="stbody"><div class="st-track" id="st-body" data-group="stbody"></div></section></div>`;
    view.querySelector('.st-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) { this.show(b.dataset.sec); focusFirst(view.querySelector('#st-body')); } });
    view.querySelector('.st-nav').addEventListener('focused', (e) => { const b = e.target.closest('[data-sec]'); if (b && b.dataset.sec !== this.sec) this.show(b.dataset.sec); });
    view.querySelector('#st-body').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) this.act(b.dataset.act, b.dataset.arg, b); });
    this.show(this.sec);
  }

  show(sec) {
    this.sec = sec;
    this.view.querySelectorAll('.st-sec').forEach((b) => b.classList.toggle('on', b.dataset.sec === sec));
    const body = this.view.querySelector('#st-body');
    body._off = 0; body.style.transform = '';
    body.innerHTML = this[sec]();
  }

  row(label, value, act, arg = '', hint = '') {
    return `<button class="f st-row" data-act="${act}" data-arg="${esc(arg)}"><span class="st-l"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
      <span class="st-v">${value}</span></button>`;
  }
  toggle(on) { return `<span class="switch ${on ? 'on' : ''}"><i></i></span>`; }

  playlists() {
    const act = S.active;
    const info = C.info || {};
    const exp = info.expires ? new Date(info.expires * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    return `<h1>Playlists</h1>
      <p class="st-intro">Add the Xtream login or M3U link from your IPTV provider. Channels load from this device’s cache, so the app opens instantly and refreshes in the background.</p>
      ${S.playlists.map((p) => this.row(p.name, p.id === act ? '<span class="pill on">In use</span>' : '<span class="pill">Use</span>', 'pl', p.id,
        p.type === 'xtream' ? `Xtream: ${p.server}` : `M3U: ${p.url.slice(0, 60)}`)).join('')}
      ${!S.playlists.length ? this.row('Demo channels', '<span class="pill on">In use</span>', 'noop', '', 'Sample data so you can try the app') : ''}
      ${this.row('Add Xtream Codes login', icon('plus'), 'addx', '', 'Server address, username and password')}
      ${this.row('Add M3U playlist link', icon('plus'), 'addm', '', 'Optional XMLTV guide link')}
      ${activePlaylist() ? `<h2>Current subscription</h2>
        ${this.row('Refresh channels and guide', icon('refresh'), 'refresh', '', C.updatedAt ? `Last updated ${new Date(C.updatedAt).toLocaleString()}` : '')}
        ${info.status ? this.row('Account status', esc(info.status), 'noop') : ''}
        ${exp ? this.row('Expires', esc(exp), 'noop') : ''}
        ${info.maxConn ? this.row('Connections', `${esc(info.active ?? 0)} of ${esc(info.maxConn)} in use`, 'noop') : ''}` : ''}`;
  }

  parental() {
    const lockedCats = Object.keys(S.locked).length;
    return `<h1>Parental control</h1>
      <p class="st-intro">Locked categories ask for your PIN once per session. The default PIN is 0000.</p>
      ${this.row('Change PIN', icon('chevron'), 'pin')}
      ${this.row('Lock adult categories automatically', this.toggle(setting('lockAdult')), 'tog', 'lockAdult', 'Categories with 18+ or adult in the name')}
      <h2>Live TV categories</h2><p class="st-intro">${lockedCats ? `${lockedCats} locked` : 'None locked yet'}</p>
      ${C.cats.live.map((c) => this.row(c.name, this.toggle(isLocked('live', c.id) || (c.adult && setting('lockAdult'))), 'lock', 'live:' + c.id)).join('')}
      ${C.cats.movie.length ? `<h2>Film categories</h2>${C.cats.movie.map((c) => this.row(c.name, this.toggle(isLocked('movie', c.id) || (c.adult && setting('lockAdult'))), 'lock', 'movie:' + c.id)).join('')}` : ''}`;
  }

  cats() {
    const block = (kind, title) => C.cats[kind].length ? `<h2>${title}</h2>${C.cats[kind].map((c) => this.row(c.name, this.toggle(!isHidden(kind, c.id)), 'hide', kind + ':' + c.id)).join('')}` : '';
    return `<h1>Categories</h1><p class="st-intro">Switch off categories you never watch. They disappear from lists, the guide and search.</p>
      ${block('live', 'Live TV')}${block('movie', 'Films')}${block('series', 'Series')}`;
  }

  playback() {
    const buf = { low: 'Low (fast start)', normal: 'Normal', high: 'High (unstable internet)' };
    const fit = { fit: 'Fit to screen', fill: 'Stretch to fill', zoom: 'Zoom and crop' };
    return `<h1>Playback</h1>
      ${this.row('Play last channel when the app opens', this.toggle(setting('autoplayLast')), 'tog', 'autoplayLast')}
      ${this.row('Preview channels while browsing', this.toggle(setting('preview')), 'tog', 'preview', 'Plays the focused channel in the small window')}
      ${this.row('Buffer size', esc(buf[setting('buffer')]), 'pick', 'buffer')}
      ${this.row('Picture', esc(fit[setting('resize')]), 'pick', 'resize')}
      ${this.row('Live stream format', setting('liveFormat') === 'm3u8' ? 'HLS (.m3u8)' : 'MPEG-TS (.ts)', 'pick', 'liveFormat', 'Switch if channels stutter or won’t start')}
      ${this.row('Channel up and down', setting('zapKeys') === 'reversed' ? 'Up goes to next channel' : 'Up goes to previous channel', 'pick', 'zapKeys')}`;
  }

  langs() {
    const present = LANGS.map((l) => ({ ...l, films: langItems('movie', l.id).length, live: langItems('live', l.id).length, series: langItems('series', l.id).length }));
    const mine = S.myLangs.map((id) => present.find((l) => l.id === id)).filter(Boolean);
    const others = present.filter((l) => !S.myLangs.includes(l.id)).sort((a, b) => (b.films + b.live + b.series) - (a.films + a.live + a.series));
    const count = (l) => [l.live && `${l.live} channels`, l.films && `${l.films} films`, l.series && `${l.series} series`].filter(Boolean).join(', ') || 'Nothing found in your playlist';
    const NAMES = { live: 'Channels', films: 'Films', series: 'Series' };
    const shows = (id) => { const r = langRowsFor(id); return ['live', 'films', 'series'].filter((k) => r.includes(k)).map((k) => NAMES[k]).join(' + ') || 'Nothing on home'; };
    return `<h1>Home and languages</h1>
      <p class="st-intro">Each language you add gets its own rows on the home screen, newest first, as long as you keep scrolling. Press OK on a language to choose its rows or change the order. Hold OK on any category in Live TV or Films to pin it to the home screen too.</p>
      <h2>Your languages, in home screen order</h2>
      ${mine.map((l, i) => this.row(`${i + 1}. ${l.name}`, `<span class="pill">${esc(shows(l.id))}</span>`, 'langedit', l.id, count(l))).join('') || '<p class="st-intro">None yet. Add one below.</p>'}
      ${S.pins.length ? `<h2>Pinned to home</h2>${S.pins.map((p) => { const c = C.cats[p.kind].find((x) => x.id === p.cat); return c ? this.row(c.name, `<span class="pill">Remove</span>`, 'unpin', p.kind + ':' + p.cat, { live: 'Live TV', movie: 'Films', series: 'Series' }[p.kind]) : ''; }).join('')}` : ''}
      <h2>Add a language</h2>
      ${others.map((l) => this.row(l.name, icon('plus'), 'langadd', l.id, count(l))).join('')}`;
  }

  look() {
    const wp = setting('wallpaper');
    return `<h1>Wallpaper and colour</h1>
      <div class="swatches" data-group="wp">${WALLPAPERS.map((w) => `<button class="f swatch ${w.id === wp ? 'on' : ''}" data-act="wp" data-arg="${w.id}">
        <span class="sw-prev wp-${w.id}"${w.id === 'image' && setting('wallpaperUrl') ? ` style="background-image:url('${esc(setting('wallpaperUrl'))}')"` : ''}>${w.id === 'bubbles' ? '<i></i><i></i><i></i>' : ''}${w.id === 'image' && !setting('wallpaperUrl') ? icon('image') : ''}</span><b>${esc(w.name)}</b></button>`).join('')}</div>
      ${this.row('Moving bubbles', this.toggle(setting('motion')), 'tog', 'motion', 'Very slow, light shapes in the background. Paused while a video plays.')}
      ${this.row('Your own picture', setting('wallpaperUrl') ? esc(setting('wallpaperUrl').slice(0, 40)) : icon('chevron'), 'wpurl', '', 'Link to any image, or send one from your phone')}
      <h2>Screen</h2>
      ${this.row('Screen size', { s: 'Smaller (if edges are cut off)', m: 'Fit the TV', l: 'Larger' }[setting('uiSize') || 'm'], 'pick', 'uiSize', 'Adjusts the whole interface to your TV')}
      ${this.row('Lighter animations', this.toggle(setting('lite')), 'tog', 'lite', 'Smoother on Fire TV Sticks and older TVs')}
      <h2>Highlight colour</h2>
      <div class="swatches accents" data-group="ac">${ACCENTS.map((a) => `<button class="f swatch acc ${a.id === setting('accent') ? 'on' : ''}" data-act="accent" data-arg="${a.id}"><span class="sw-dot" style="background:${a.c}"></span><b>${esc(a.name)}</b></button>`).join('')}</div>`;
  }

  downloads() {
    const apps = N.installedApps();
    const dls = apps.filter((a) => a.role === 'download'), pls = apps.filter((a) => a.role === 'player');
    const name = (pkg, list, none) => (list.find((a) => a.pkg === pkg) || {}).name || none;
    return `<h1>Downloads and players</h1>
      <p class="st-intro">Films and episodes have a Download button, and every channel, film and episode has Play in VLC or MX Player, Copy link and QR code when you hold OK.</p>
      ${this.row('Download with', name(setting('downloader'), dls, 'Ask every time'), 'pickapp', 'downloader', dls.length ? `Installed: ${dls.map((a) => a.name).join(', ')}` : 'ADM or 1DM not found. Install one from the app store, or use Copy link.')}
      <h2>Default player</h2>
      ${[['playerLive', 'Live TV'], ['playerMovie', 'Films'], ['playerSeries', 'Series']].map(([k, l]) => this.row(l, esc(setting(k) && setting(k) !== 'lumen' ? name(setting(k), pls, 'Lumen player') : 'Lumen player'), 'defplayer', k,
        pls.length ? 'Choose the built-in player, or ' + pls.map((a) => a.name).join(' or ') : 'Install VLC or MX Player from the app store to choose it here')).join('')}
      <h2>Downloads</h2>
      <div class="st-note">
        <h2>Faster downloads</h2>
        <ul><li>In ADM or 1DM, set downloads to use 8 or more parts (threads). Large films then download several pieces at once.</li>
        <li>Some IPTV servers allow only one connection per account. If a download fails or stalls, set parts to 1, and stop watching while it downloads.</li>
        <li>When a film exists in several qualities in your playlist (4K, 1080p, HEVC), you’re shown each one with its file size before downloading. HEVC versions are the same picture in a smaller file.</li></ul>
      </div>`;
  }

  subs() {
    const langs = setting('subLangs') || [];
    const key = setting('osKey');
    return `<h1>Subtitles</h1>
      <p class="st-intro">Subtitles inside a video are used first. Otherwise they can be fetched from OpenSubtitles.com, matched to the exact file when the server allows it.</p>
      ${this.row('Fetch subtitles automatically', this.toggle(setting('subAuto')), 'tog', 'subAuto', 'For films and episodes, in your first language below')}
      ${this.row('OpenSubtitles API key', key ? 'Saved' : '<span class="pill">Add</span>', 'oskey', '', key ? key.slice(0, 4) + '…' + key.slice(-3) : 'Free: sign up at opensubtitles.com, then Profile > API consumers')}
      ${this.row('Subtitle size', { s: 'Small', m: 'Medium', l: 'Large' }[setting('subSize') || 'm'], 'pick', 'subSize')}
      <h2>Languages, in order of preference</h2>
      ${SUB_LANGS.map(([iso, nm]) => this.row(nm, `${langs.includes(iso) ? `<span class="order">${langs.indexOf(iso) + 1}</span>` : ''}${this.toggle(langs.includes(iso))}`, 'sublang', iso)).join('')}`;
  }

  phone() {
    const c = N.companion();
    let qr = '';
    if (c && c.url) { const q = qrcode(0, 'M'); q.addData(c.url); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
    return `<h1>Phone remote</h1>
      <p class="st-intro">Use your phone to type or dictate searches, paste playlist logins, subtitle keys and wallpaper links, instead of the TV keyboard. Your phone must be on the same Wi-Fi.</p>
      ${c && c.url ? `<div class="phone-card"><div class="qr-box sm">${qr}</div><div><p>Scan with your phone camera, or open</p><b class="big">${esc(c.url)}</b><p>Code: <b>${esc(c.pin)}</b></p></div></div>`
        : window.__desktop ? '<p class="st-intro">The phone remote is part of the TV app. On a Mac, type and paste straight into the app.</p>' : '<p class="st-intro">The phone page isn’t running. Check that the TV is connected to Wi-Fi.</p>'}
      <div class="st-note"><h2>On the phone page</h2><ul><li>Search box: type, or tap the microphone on your phone keyboard to speak. Results open on the TV.</li>
      <li>Add an Xtream login or M3U link</li><li>Paste your OpenSubtitles key</li><li>Set a wallpaper from an image link</li></ul></div>`;
  }

  voice() {
    const d = N.device();
    return `<h1>Voice search</h1>
      <p class="st-intro">${d.voice ? 'This device lets apps listen directly: press the ≡ Menu button or the search button anywhere.' : 'This device doesn’t let apps listen to the microphone directly, so voice search uses the Fire TV keyboard’s dictation.'}</p>
      ${this.row('Menu button', setting('menuKey') === 'options' ? 'Opens options' : 'Starts voice search', 'pick', 'menuKey', 'The ≡ button on the remote')}
      <div class="st-note">
        <h2>With the Alexa remote</h2>
        <ol><li>Press ≡ Menu, or select a microphone button in the app. The Amazon keyboard opens.</li>
        <li>While the keyboard is open, hold the Alexa (mic) button and speak. Your words are typed in.</li>
        <li>Press the keyboard’s Search key, or Back, and the results appear. Back on an empty box cancels.</li></ol>
        <p>Pressing the Alexa button when the keyboard isn’t open always goes to Alexa: Amazon doesn’t let apps take over that button. You can say “Alexa, open Lumen TV” to launch the app.</p>
        <h2>Other ways</h2>
        <ul><li>Phone remote: speak into your phone keyboard and the search runs on the TV.</li><li>Google TV and Android TV: the remote’s microphone button works directly.</li></ul>
        <h2>What to say</h2>
        <ul><li>A channel: “Kerala Vision” or “channel 12”, then OK plays it</li><li>A film or show by name</li><li>A programme: “football” finds matches on now and on catch-up</li></ul>
      </div>`;
  }

  guide() {
    const o = setting('epgOffsetHours') || 0;
    return `<h1>TV guide</h1>
      ${this.row('Refresh guide now', icon('refresh'), 'epg', '', (() => { const i = epgInfo(); return i.importing ? 'Downloading the guide now…' : i.count ? `${(+i.count).toLocaleString()} programmes, updated ${new Date(+i.importedAt).toLocaleString()}` : 'No guide loaded yet. It also refreshes every 6 hours'; })())}
      ${this.row('Guide time shift', o === 0 ? 'No shift' : `${o > 0 ? '+' : ''}${o} h`, 'pick', 'epgOffsetHours', 'Use this if programme times are off by whole hours')}
      ${this.row('Start screen', { home: 'Home', live: 'Live TV', guide: 'TV guide' }[setting('startScreen') || 'home'], 'pick', 'startScreen')}`;
  }

  about() {
    const d = N.device();
    return `<h1>About</h1>
      ${this.row('App version', `Lumen TV ${esc(N.device().version || '')}`, 'noop', '', `Build ${currentBuild() || '-'}`)}
      ${update.available ? this.row(`Install update (build ${update.available.build})`, '<span class="pill on">Install</span>', 'update') : this.row('Check for updates', icon('refresh'), 'checkupd', '', 'Updates are also checked automatically')}
      ${this.row('Device', esc(d.model || ''), 'noop')}
      ${this.row('Start-up time', `${window.__bootMs ?? '-'} ms`, 'noop', '', 'Time to show the home screen from cache')}
      ${this.row('Channels, films and series', `${C.live.length}, ${C.movie.length}, ${C.series.length}`, 'noop')}
      <p class="st-intro">Lumen plays streams from the playlists you add. It doesn’t provide any channels or content itself.</p>`;
  }

  async act(a, arg, btn) {
    if (a === 'noop') return;
    if (a === 'update') { installUpdate(); return; }
    if (a === 'checkupd') { toast('Checking for updates'); const u = await checkForUpdate({ quiet: false }); if (u) { this.show('about'); installUpdate(); } return; }
    if (a === 'lang') { toggleLang(arg); this.repaint(btn); return; }
    if (a === 'langadd') { toggleLang(arg); toast(`${langById(arg).name} added to your home screen`); this.show('langs'); focusFirst(this.view.querySelector('#st-body')); return; }
    if (a === 'langedit') { this.editLang(arg); return; }
    if (a === 'defplayer') {
      const pls = N.installedApps().filter((x) => x.role === 'player');
      const cur = setting(arg) || 'lumen';
      const v = await sheet({ title: { playerLive: 'Live TV plays in', playerMovie: 'Films play in', playerSeries: 'Series play in' }[arg],
        options: [{ label: 'Lumen player (built in)', value: 'lumen', on: cur === 'lumen', icon: 'play' }, ...pls.map((x) => ({ label: x.name, value: x.pkg, on: cur === x.pkg, icon: 'play' }))] });
      if (v != null) setting(arg, v);
      this.repaint(btn); return;
    }
    if (a === 'langup') { moveLang(arg, -1); this.repaint(btn); return; }
    if (a === 'langrow') {
      const r = new Set((setting('homeLangRows') || 'films,live').split(','));
      if (r.has(arg)) r.delete(arg); else r.add(arg);
      setting('homeLangRows', [...r].filter(Boolean).join(',')); this.repaint(btn); return;
    }
    if (a === 'unpin') { const [kind, cat] = arg.split(':'); togglePin(kind, cat); this.show('langs'); focusFirst(this.view.querySelector('#st-body')); return; }
    if (a === 'wp') { setting('wallpaper', arg); if (arg === 'image' && !setting('wallpaperUrl')) return this.act('wpurl', '', btn); applyLook(); this.repaint(btn); return; }
    if (a === 'accent') { setting('accent', arg); applyLook(); this.repaint(btn); return; }
    if (a === 'wpurl') {
      const v = await form({ title: 'Wallpaper picture', note: 'Paste a link to a JPG or PNG. Tip: send it from the phone remote instead of typing.', fields: [{ name: 'url', label: 'Image link', value: setting('wallpaperUrl'), placeholder: 'https://\u2026/picture.jpg' }] });
      if (v) { setting('wallpaperUrl', v.url); if (v.url) setting('wallpaper', 'image'); applyLook(); }
      this.repaint(btn); return;
    }
    if (a === 'pickapp') {
      const dls = N.installedApps().filter((x) => x.role === 'download');
      const v = await sheet({ title: 'Download with', options: [{ label: 'Ask every time', value: '', on: !setting('downloader') }, ...dls.map((x) => ({ label: x.name, value: x.pkg, on: setting('downloader') === x.pkg, icon: 'download' }))] });
      if (v != null) setting('downloader', v);
      this.repaint(btn); return;
    }
    if (a === 'oskey') {
      const v = await form({ title: 'OpenSubtitles API key', note: 'Create a free account at opensubtitles.com, open Profile > API consumers, create one and copy its key.', fields: [{ name: 'key', label: 'API key', value: setting('osKey') }] });
      if (v) setting('osKey', v.key);
      this.repaint(btn); return;
    }
    if (a === 'sublang') {
      const l = [...(setting('subLangs') || [])];
      const i = l.indexOf(arg);
      if (i >= 0) l.splice(i, 1); else l.push(arg);
      setting('subLangs', l); this.repaint(btn); return;
    }
    if (a === 'tog') {
      setting(arg, !setting(arg));
      if (arg === 'lite') document.body.classList.toggle('lite', !!setting('lite'));
      if (arg === 'motion') applyLook();
      this.repaint(btn); return;
    }
    if (a === 'lock') {
      const [kind, id] = arg.split(':');
      if (!(await this.app.ensureUnlocked(kind, id))) return;
      setLocked(kind, id, !isLocked(kind, id)); this.repaint(btn); return;
    }
    if (a === 'hide') { const [kind, id] = arg.split(':'); setHidden(kind, id, !isHidden(kind, id)); this.repaint(btn); return; }
    if (a === 'pin') {
      const ok = await pinPad({ title: 'Enter current PIN', subtitle: 'To change your PIN', check: (v) => v === S.pin });
      if (!ok) return focus(btn);
      let first = null;
      await pinPad({ title: 'Choose a new PIN', subtitle: 'Four digits', check: (v) => { first = v; return true; } });
      if (first && first.length === 4) {
        const same = await pinPad({ title: 'Enter it again', subtitle: 'To confirm', check: (v) => v === first });
        if (same) { set('pin', first); toast('PIN changed'); }
      }
      focus(btn); return;
    }
    if (a === 'pick') {
      const choices = {
        buffer: [['low', 'Low (fast start)'], ['normal', 'Normal'], ['high', 'High (unstable internet)']],
        resize: [['fit', 'Fit to screen'], ['fill', 'Stretch to fill'], ['zoom', 'Zoom and crop']],
        liveFormat: [['ts', 'MPEG-TS (.ts)'], ['m3u8', 'HLS (.m3u8)']],
        zapKeys: [['updown', 'Up goes to previous channel'], ['reversed', 'Up goes to next channel']],
        menuKey: [['voice', 'Starts voice search'], ['options', 'Opens options']],
        epgOffsetHours: [-3, -2, -1, 0, 1, 2, 3].map((h) => [h, h === 0 ? 'No shift' : `${h > 0 ? '+' : ''}${h} h`]),
        startScreen: [['home', 'Home'], ['live', 'Live TV'], ['guide', 'TV guide']],
        subSize: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']],
        uiSize: [['s', 'Smaller (if edges are cut off)'], ['m', 'Fit the TV'], ['l', 'Larger']],
      }[arg];
      const cur = setting(arg) ?? choices[0][0];
      const v = await sheet({ title: btn.querySelector('b').textContent, options: choices.map(([val, label]) => ({ label, value: String(val), on: String(cur) === String(val) })), focusIndex: Math.max(0, choices.findIndex(([val]) => String(val) === String(cur))) });
      if (v != null) { setting(arg, arg === 'epgOffsetHours' ? +v : v); if (arg === 'epgOffsetHours') clearEpgCache(); if (arg === 'uiSize' && window.__fit) window.__fit(); }
      this.repaint(btn); return;
    }
    if (a === 'addx' || (a === 'edit' && arg)) return this.addXtream(btn);
    if (a === 'addm') return this.addM3u(btn);
    if (a === 'pl') return this.playlistMenu(arg, btn);
    if (a === 'refresh') return this.doRefresh(btn);
    if (a === 'epg') {
      const pl = activePlaylist();
      if (!pl) { toast('The demo guide doesn’t need refreshing'); return; }
      toast('Refreshing the guide');
      refreshEpg(pl, true).then(() => toast('Guide updated')).catch((e) => toast(`Guide refresh failed: ${e.message}`, 'err'));
    }
  }

  repaint(btn) {
    const sel = `[data-act="${btn.dataset.act}"][data-arg="${CSS.escape(btn.dataset.arg)}"]`;
    const body = this.view.querySelector('#st-body');
    const off = body._off, tr = body.style.transform;
    body.innerHTML = this[this.sec]();
    body._off = off; body.style.transform = tr;
    focus(body.querySelector(sel) || body.querySelector('.f'), { noScroll: true });
  }

  async addXtream(btn, existing) {
    const v = await form({
      title: existing ? 'Edit Xtream login' : 'Add Xtream Codes login',
      note: 'Your provider sends these details by email or WhatsApp.',
      fields: [
        { name: 'name', label: 'Name', value: existing?.name || 'My TV', required: true },
        { name: 'server', label: 'Server address', value: existing?.server || '', placeholder: 'http://example.com:8080', required: true },
        { name: 'user', label: 'Username', value: existing?.user || '', required: true },
        { name: 'pass', label: 'Password', value: existing?.pass || '', type: 'password', required: true },
      ],
      submit: 'Connect',
    });
    if (!v) return focus(btn);
    const pl = { id: existing?.id || 'x' + Date.now().toString(36), type: 'xtream', ...v };
    toast('Checking your login');
    try {
      await testXtream(pl);
    } catch (e) {
      toast(`Couldn’t connect: ${e.message}`, 'err');
      return focus(btn);
    }
    upsertPlaylist(pl);
    await this.activate(pl.id, btn);
  }

  async addM3u(btn, existing) {
    const v = await form({
      title: 'Add M3U playlist link',
      fields: [
        { name: 'name', label: 'Name', value: existing?.name || 'My playlist', required: true },
        { name: 'url', label: 'Playlist link', value: existing?.url || '', placeholder: 'http://…/get.php?…&type=m3u_plus', required: true },
        { name: 'epgUrl', label: 'Guide (XMLTV) link, optional', value: existing?.epgUrl || '' },
      ],
      submit: 'Add playlist',
    });
    if (!v) return focus(btn);
    const pl = { id: existing?.id || 'm' + Date.now().toString(36), type: 'm3u', ...v };
    upsertPlaylist(pl);
    await this.activate(pl.id, btn);
  }

  async activate(id, btn) {
    set('active', id); flush();
    toast('Loading channels');
    try {
      if (!loadFromCache()) await refresh(() => {});
      else refresh(() => {}).catch(() => {});
      toast(`${C.live.length} channels ready`);
    } catch (e) {
      toast(`Couldn’t load the playlist: ${e.message}`, 'err');
    }
    this.show('playlists');
    focusFirst(this.view.querySelector('#st-body'));
  }

  async playlistMenu(id, btn) {
    const pl = S.playlists.find((p) => p.id === id);
    const v = await sheet({ title: pl.name, options: [
      { label: 'Use this playlist', value: 'use', icon: 'check', on: S.active === id },
      { label: 'Edit details', value: 'edit', icon: 'list' },
      { label: 'Remove', value: 'remove', icon: 'eyeOff' },
    ] });
    if (v === 'use') return this.activate(id, btn);
    if (v === 'edit') return pl.type === 'xtream' ? this.addXtream(btn, pl) : this.addM3u(btn, pl);
    if (v === 'remove') {
      removePlaylist(id); flush();
      loadFromCache();
      toast(`${pl.name} removed`);
      this.show('playlists'); focusFirst(this.view.querySelector('#st-body'));
      return;
    }
    focus(btn);
  }

  async doRefresh(btn) {
    toast('Refreshing channels');
    try { await refresh(() => {}); toast(`Updated: ${C.live.length} channels, ${C.movie.length} films, ${C.series.length} series`); }
    catch (e) { toast(`Refresh failed: ${e.message}`, 'err'); }
    this.show('playlists'); focus(this.view.querySelector('[data-act="refresh"]'));
  }

  onKey(k) {
    const a = document.activeElement;
    if (k === 'hold' && a && a.dataset.act === 'lang' && S.myLangs.includes(a.dataset.arg)) {
      moveLang(a.dataset.arg, -1); this.repaint(a); return true;
    }
    if (a && a.closest('.st-nav') && k === 'right') { focusFirst(this.view.querySelector('#st-body')); return true; }
    if (a && a.closest('#st-body') && k === 'left') { focus(this.view.querySelector('.st-sec.on')); return true; }
    if (a && a.closest('.st-nav') && k === 'left') { focus(document.querySelector('#rail [data-go="settings"]')); return true; }
    return false;
  }

  // One language: which rows it gets on the home screen, and its place in the order.
  async editLang(id) {
    const name = langById(id).name;
    let focusAt = 0;
    for (;;) {
      const rows = langRowsFor(id), i = S.myLangs.indexOf(id);
      const opts = [
        { label: `${name} channels`, value: 'live', on: rows.includes('live'), icon: 'tv' },
        { label: `${name} films`, value: 'films', on: rows.includes('films'), icon: 'film' },
        { label: `${name} series`, value: 'series', on: rows.includes('series'), icon: 'series' },
        ...(i > 0 ? [{ label: 'Move up', value: 'up', icon: 'chevron' }] : []),
        ...(i < S.myLangs.length - 1 ? [{ label: 'Move down', value: 'down', icon: 'chevron' }] : []),
        { label: `Remove ${name} from home`, value: 'remove', icon: 'eyeOff' },
      ];
      const v = await sheet({ title: `${name} on the home screen`, options: opts, focusIndex: focusAt });
      if (v == null) break;
      focusAt = Math.max(0, opts.findIndex((o) => o.value === v));
      if (v === 'up' || v === 'down') { moveLang(id, v === 'up' ? -1 : 1); if (!S.myLangs.includes(id)) break; continue; }
      if (v === 'remove') { toggleLang(id); toast(`${name} removed from home`); break; }
      const r = new Set(rows); if (r.has(v)) r.delete(v); else r.add(v);
      setLangRows(id, ['live', 'films', 'series'].filter((k) => r.has(k)));
    }
    this.show('langs');
    const b = this.view.querySelector(`[data-act="langedit"][data-arg="${id}"]`) || this.view.querySelector('#st-body .f');
    if (b) focus(b);
  }

  focus() { focus(this.view.querySelector('.st-sec.on')); }
  save() { return { sec: this.sec }; }
}
