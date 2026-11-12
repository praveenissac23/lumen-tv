// Settings: playlists, parental control, categories, playback, voice and remote, guide.
import { C, testXtream, refresh, refreshQuick, refreshEpg, loadFromCache, clearEpgCache } from '../data.js';
import { epgInfo } from '../epg.js';
import { S, set, setting, upsertPlaylist, removePlaylist, setLocked, isLocked, setHidden, isHidden, activePlaylist, flush, toggleLang, moveLang, togglePin, langRowsFor, setLangRows, homeSections, setHomeSections, langPrefs, setLangPrefs } from '../store.js';
import { LANGS, langById, langItems } from '../languages.js';
import { langCatList, catYear } from '../languages.js';
import { SUB_LANGS, langName } from '../subs.js';
import { WALLPAPERS, ACCENTS, THEMES, applyLook } from '../look.js';

// automatic update choices (keys are days / hours; 0 = only when you press Refresh)
const DAY_OPTS = [[1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [7, 'Every week'], [14, 'Every 2 weeks'], [0, 'Only when I press Refresh']];
const HOUR_OPTS = [[3, 'Every 3 hours'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every day'], [48, 'Every 2 days'], [0, 'Only when I press Refresh']];
const toMap = (opts) => opts.reduce((m, [k, v]) => { m[k] = v; return m; }, {});
const DAYS = toMap(DAY_OPTS), HOURS = toMap(HOUR_OPTS);
import qrcode from 'qrcode-generator';
import { update, checkForUpdate, installUpdate, currentBuild } from '../updates.js';
import { esc } from '../util.js';
import { focus, focusFirst } from '../nav.js';
import { icon, toast, sheet, form, pinPad } from '../ui.js';
import * as N from '../native.js';
import { accounts, saveAccount, validateAccount, validateSource, preferredProvider, PROVIDERS } from '../torrents.js';

const SECTIONS = [
  ['playlists', 'Playlists', 'list'], ['home', 'Home screen', 'home'], ['langs', 'Languages', 'globe'], ['look', 'Theme and wallpaper', 'image'],
  ['downloads', 'Downloads and players', 'download'], ['debrid', 'Debrid and torrents', 'globe'], ['subs', 'Subtitles', 'subtitles'], ['phone', 'Phone remote', 'phone'],
  ['voice', 'Voice search', 'mic'], ['parental', 'Parental control', 'lock'], ['cats', 'Categories', 'eyeOff'],
  ['playback', 'Playback', 'play'], ['guide', 'TV guide', 'guide'], ['about', 'About', 'tv'],
];

export class SettingsScreen {
  constructor(view, params, app) {
    this.app = app; this.view = view;
    this.sec = params.restore?.sec || 'playlists';
    view.innerHTML = `<div class="st">
      <nav class="st-nav" data-zone="stnav" data-scroll="y" data-pad="12"><div class="st-nav-track" data-group="stnav"><h2 class="col-h">Settings</h2>
        ${SECTIONS.map(([k, l, ic]) => `<button class="f st-sec ${k === this.sec ? 'on' : ''}" data-sec="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div></nav>
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
        ${this.row('Refresh everything now', icon('refresh'), 'refresh', '', C.updatedAt ? `Last updated ${new Date(C.updatedAt).toLocaleString()}` : '')}
        <h2>Update automatically</h2>
        ${[['refreshLive', 'Channels', 'live'], ['refreshMovie', 'Films', 'movie'], ['refreshSeries', 'Series', 'series']].map(([k, label, part]) =>
          this.row(label, DAYS[+setting(k)] || 'Every day', 'pick', k, C.stamps && C.stamps[part] ? `Last updated ${new Date(C.stamps[part]).toLocaleString()}` : 'In the background; the app stays usable')).join('')}
        ${this.row('TV guide', HOURS[+setting('refreshGuideH')] || 'Every 6 hours', 'pick', 'refreshGuideH', 'The guide covers the next 2 days')}
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

  home() {
    const secs = homeSections();
    const cnt = (n) => (n > 0 ? `${n} items` : 'All, keeps loading');
    return `<h1>Home screen</h1>
      <p class="st-intro">Choose what the home screen shows, how many items each row has, and the order. Press OK on a row to change it.</p>
      ${this.row('Style', { billboard: 'Preview banner', rows: 'Just rows', hero: 'Live preview on top', shortcuts: 'Shortcut buttons', spotlight: 'Big Continue card', compact: 'Compact rows' }[setting('homeLayout') || 'rows'], 'pick', 'homeLayout', 'What sits above the rows')}
      ${this.row('Play previews in the banner', this.toggle(setting('autoPreview') !== false), 'tog', 'autoPreview', 'Stay on a film or channel and it starts playing at the top, like Netflix')}
      <h2>Rows, in order</h2>
      ${secs.map((sc, i) => this.row(`${i + 1}. ${sc.label}`, sc.on ? `<span class="pill on">${esc(cnt(sc.n))}</span>` : '<span class="pill">Hidden</span>', 'homerow', sc.id,
        sc.id === 'langs' ? 'Which languages and which rows each gets: Settings > Languages' : sc.id === 'pins' ? 'Hold OK on a category in Live TV or Films to pin it' : '')).join('')}
      ${this.row('Reset home screen', icon('refresh'), 'homereset', '', 'Back to the standard rows and order')}`;
  }

  // One home row: show or hide, how many items, move up or down.
  async editHomeRow(id) {
    const build = () => {
      const secs = homeSections(), i = secs.findIndex((x) => x.id === id), sc = secs[i];
      return [
        { label: sc.on ? 'Shown on the home screen' : 'Hidden from the home screen', value: 'toggle', on: sc.on, icon: sc.on ? 'check' : 'eyeOff' },
        ...[5, 10, 20, 0].map((c) => ({ label: c ? `Show ${c} items` : 'Show all (keeps loading as you scroll)', value: 'n' + c, on: sc.n === c, icon: 'list' })),
        ...(i > 0 ? [{ label: 'Move up', value: 'up', icon: 'chevron' }] : []),
        ...(i < secs.length - 1 ? [{ label: 'Move down', value: 'down', icon: 'chevron' }] : []),
      ];
    };
    await sheet({ title: homeSections().find((x) => x.id === id).label, options: build(), onPick: (v) => {
      const secs = homeSections(), i = secs.findIndex((x) => x.id === id), sc = secs[i];
      if (v === 'toggle') sc.on = !sc.on;
      else if (v[0] === 'n') { sc.n = +v.slice(1); sc.on = true; }
      else if (v === 'up' || v === 'down') { const j = v === 'up' ? i - 1 : i + 1; [secs[i], secs[j]] = [secs[j], secs[i]]; }
      setHomeSections(secs);
      return build();
    } });
    this.show('home');
    const b = this.view.querySelector(`[data-act="homerow"][data-arg="${id}"]`) || this.view.querySelector('#st-body .f');
    if (b) focus(b);
  }


  langs() {
    const present = LANGS.map((l) => ({ ...l, films: langItems('movie', l.id).length, live: langItems('live', l.id).length, series: langItems('series', l.id).length }));
    const mine = S.myLangs.map((id) => present.find((l) => l.id === id)).filter(Boolean);
    const others = present.filter((l) => !S.myLangs.includes(l.id)).sort((a, b) => (b.films + b.live + b.series) - (a.films + a.live + a.series));
    const count = (l) => [l.live && `${l.live} channels`, l.films && `${l.films} films`, l.series && `${l.series} series`].filter(Boolean).join(', ') || 'Nothing found in your playlist';
    const NAMES = { live: 'Channels', films: 'Films', series: 'Series' };
    const shows = (id) => { const r = langRowsFor(id); return ['live', 'films', 'series'].filter((k) => r.includes(k)).map((k) => NAMES[k]).join(' + ') || 'Nothing on home'; };
    return `<h1>Languages</h1>
      <p class="st-intro">Each language you add gets its own rows on the home screen, newest first, as long as you keep scrolling. Press OK on a language to choose its rows or change the order. Hold OK on any category in Live TV or Films to pin it to the home screen too.</p>
      <h2>Your languages, in home screen order</h2>
      ${mine.map((l, i) => this.row(`${i + 1}. ${l.name}`, `<span class="pill">${esc(shows(l.id))}</span>`, 'langedit', l.id, count(l))).join('') || '<p class="st-intro">None yet. Add one below.</p>'}
      ${S.pins.length ? `<h2>Pinned to home</h2>${S.pins.map((p) => { const c = C.cats[p.kind].find((x) => x.id === p.cat); return c ? this.row(c.name, `<span class="pill">Remove</span>`, 'unpin', p.kind + ':' + p.cat, { live: 'Live TV', movie: 'Films', series: 'Series' }[p.kind]) : ''; }).join('')}` : ''}
      <h2>Add a language</h2>
      ${others.map((l) => this.row(l.name, icon('plus'), 'langadd', l.id, count(l))).join('')}`;
  }

  look() {
    const wp = setting('wallpaper');
    const th = setting('theme') || 'classic';
    return `<h1>Theme</h1>
      <div class="swatches themes" data-group="th">${THEMES.map((t) => `<button class="f swatch ${t.id === th ? 'on' : ''}" data-act="theme" data-arg="${t.id}">
        <span class="sw-prev sw-theme" style="--ta:${t.a};--tb:${t.b};--tbg:${t.bg}"><i></i><i></i><i></i></span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small></button>`).join('')}</div>
      <h2>Wallpaper (Classic theme)</h2>
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

  debrid() {
    const a = accounts();
    return `<h1>Debrid and torrents</h1><p class="st-intro">Torrents searches internet torrent indexes. Debrid prepares and plays the torrent you choose; search is not limited to your Debrid cloud. Lumen TV remains your default tab.</p>
      ${Object.entries(PROVIDERS).map(([id, name]) => this.row(name, a[id]?.key ? '<span class="pill on">Key saved</span>' : '<span class="pill">Connect</span>', 'debrid-key', id, a[id]?.key ? (preferredProvider() === id ? 'Preferred provider · Verify or disconnect' : 'Verify or disconnect') : 'Use an API key from your provider account')).join('')}
      ${this.row('Preferred Debrid provider', esc(PROVIDERS[preferredProvider()] || 'Connect an account first'), 'debrid-preferred')}
      <h2>Source search</h2>
      ${this.row('Internet torrent search', this.toggle(setting('internetTorrents') !== false), 'internet-torrents', '', 'Torrentio searches multiple public torrent indexes. No Debrid login is used for this search.')}
      ${this.row('Additional source add-on', esc(setting('torrentSourceName') || 'Optional'), 'torrent-source', '', 'Search an additional Stremio-compatible provider alongside internet torrents.')}
      ${this.row('Preferred quality', (setting('torrentQuality') || 1080) + 'p', 'torrent-quality', '', 'Internet results first, then preferred quality and seed count.')}
      <div class="st-note"><p>Your Debrid API keys are not sent to Torrentio. Cached-only filters from an additional add-on do not restrict internet search. Uncached torrents may need preparation in your Debrid account before they play.</p><p>Torrent browsing opens without a PIN.</p></div>`;
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
      ${this.row('Update the app automatically', this.toggle(setting('autoAppUpdate') !== false), 'tog', 'autoAppUpdate', 'New builds download by themselves; you only press Install')}
      ${this.row('Device', esc(d.model || ''), 'noop')}
      ${this.row('Start-up time', `${window.__bootMs ?? '-'} ms`, 'noop', '', 'Time to show the home screen from cache')}
      ${this.row('Channels, films and series', `${C.live.length}, ${C.movie.length}, ${C.series.length}`, 'noop')}
      <p class="st-intro">Lumen plays streams from the playlists you add. It doesn’t provide any channels or content itself.</p>`;
  }

  async act(a, arg, btn) {
    if (a === 'internet-torrents') { setting('internetTorrents', setting('internetTorrents') === false); this.repaint(btn); return; }
    if (a === 'debrid-key') {
      const existing = accounts()[arg]?.key;
      let action = 'replace';
      if (existing) action = await sheet({ title: PROVIDERS[arg], options: [{ label: 'Check connection', value: 'check' }, { label: 'Replace API key', value: 'replace' }, { label: 'Disconnect account', value: 'remove' }] });
      if (!action) { this.repaint(btn); return; }
      if (action === 'remove') { saveAccount(arg, ''); toast('Account disconnected'); this.repaint(btn); return; }
      let key = existing;
      if (action === 'replace') {
        const v = await form({ title: 'Connect ' + PROVIDERS[arg], note: arg === 'rd' ? 'Get your personal API token from real-debrid.com/apitoken. Your website password is not needed.' : 'Create an API key at alldebrid.com/apikeys. Your website password is not needed.', fields: [{ name: 'key', label: 'API key', type: 'password', required: true }], submit: 'Connect' });
        if (!v) { this.repaint(btn); return; }
        key = v.key;
      }
      toast('Checking your account…');
      try { await validateAccount(arg, key); if (action !== 'check') saveAccount(arg, key); toast(PROVIDERS[arg] + ' connected'); }
      catch (e) { toast(e.message, 'err'); }
      if (this.view.isConnected) this.repaint(btn); return;
    }
    if (a === 'debrid-preferred') {
      const list = Object.keys(PROVIDERS).filter((id) => accounts()[id]?.key);
      if (!list.length) { toast('Connect a Debrid account first'); return; }
      const id = await sheet({ title: 'Preferred provider', options: list.map((id) => ({ label: PROVIDERS[id], value: id, on: preferredProvider() === id })) });
      if (id) setting('debridPreferred', id);
      this.repaint(btn); return;
    }
    if (a === 'torrent-quality') {
      const q = await sheet({ title: 'Preferred quality', options: [1080, 2160, 720].map((n) => ({ label: n + 'p', value: String(n), on: +(setting('torrentQuality') || 1080) === n })) });
      if (q) setting('torrentQuality', +q);
      this.repaint(btn); return;
    }
    if (a === 'torrent-source') {
      let action = 'edit';
      if (setting('torrentSource')) action = await sheet({ title: 'Source provider', options: [{ label: 'Replace provider', value: 'edit' }, { label: 'Remove provider', value: 'remove' }] });
      if (action === 'remove') { setting('torrentSource', ''); setting('torrentSourceName', ''); this.repaint(btn); return; }
      if (!action) { this.repaint(btn); return; }
      const v = await form({ title: 'Additional source provider', note: 'Optional: this provider is searched alongside internet torrents. Removing it does not switch off internet search.', fields: [{ name: 'url', label: 'Manifest URL', value: setting('torrentSource') ? setting('torrentSource') + '/manifest.json' : '', placeholder: 'https://your-provider/manifest.json', required: true }], submit: 'Connect' });
      if (v) {
        toast('Checking the source provider…');
        try { const p = await validateSource(v.url); setting('torrentSource', p.base); setting('torrentSourceName', p.name); toast('Source provider added'); }
        catch (e) { toast(e.message, 'err'); }
      }
      if (this.view.isConnected) this.repaint(btn); return;
    }
    if (a === 'noop') return;
    if (a === 'update') { installUpdate(); return; }
    if (a === 'checkupd') { toast('Checking for updates'); const u = await checkForUpdate({ quiet: false }); if (u) { this.show('about'); installUpdate(); } return; }
    if (a === 'lang') { toggleLang(arg); this.repaint(btn); return; }
    if (a === 'langadd') { toggleLang(arg); toast(`${langById(arg).name} added to your home screen`); this.show('langs'); focusFirst(this.view.querySelector('#st-body')); return; }
    if (a === 'langedit') { this.editLang(arg); return; }
    if (a === 'homerow') { this.editHomeRow(arg); return; }
    if (a === 'homereset') { setHomeSections([]); setting('homeLayout', 'rows'); toast('Home screen reset'); this.show('home'); focusFirst(this.view.querySelector('#st-body')); return; }
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
    if (a === 'wp') { setting('theme', 'classic'); setting('wallpaper', arg); if (arg === 'image' && !setting('wallpaperUrl')) return this.act('wpurl', '', btn); applyLook(); this.repaint(btn); return; }
    if (a === 'accent') { setting('accent', arg); applyLook(); this.repaint(btn); return; }
    if (a === 'theme') { setting('theme', arg); applyLook(); this.repaint(btn); return; }
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
        catalogueRefresh: DAY_OPTS,
        refreshLive: DAY_OPTS,
        refreshMovie: DAY_OPTS,
        refreshSeries: DAY_OPTS,
        refreshGuideH: HOUR_OPTS,
        homeLayout: [['billboard', 'Preview banner (focused title on top)'], ['rows', 'Just rows'], ['hero', 'Live preview on top'], ['shortcuts', 'Shortcut buttons'], ['spotlight', 'Big Continue card'], ['compact', 'Compact rows']],
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
      if (!loadFromCache()) await refreshQuick(() => {});   // usable as soon as channels are in
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
    try { await refresh(() => {}); const pl = activePlaylist(); if (pl) refreshEpg(pl, true).catch(() => {}); toast(`Updated: ${C.live.length} channels, ${C.movie.length} films, ${C.series.length} series`); }
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
    const build = () => {
      const rows = langRowsFor(id), i = S.myLangs.indexOf(id), pr = langPrefs(id);
      const catsOf = (kind) => langCatList(kind, id);
      const chosen = (kind) => { const all = catsOf(kind), p = kind === 'movie' ? pr.movieCats : pr.seriesCats; return p ? `${p.length} chosen` : `all ${all.length}`; };
      return [
        { label: `${name} channels`, value: 'live', on: rows.includes('live'), icon: 'tv' },
        { label: `${name} films`, value: 'films', on: rows.includes('films'), icon: 'film' },
        ...(rows.includes('films') && catsOf('movie').length ? [{ label: `Film categories: ${chosen('movie')}`, value: 'cats-movie', icon: 'list' }] : []),
        { label: `${name} series`, value: 'series', on: rows.includes('series'), icon: 'series' },
        ...(rows.includes('series') && catsOf('series').length ? [{ label: `Series categories: ${chosen('series')}`, value: 'cats-series', icon: 'list' }] : []),
        ...(rows.includes('films') || rows.includes('series') ? [
          { label: pr.order === 'year' ? 'Order: newest year first (2026, 2025, 2024…)' : 'Order: recently added first', value: 'order', icon: 'refresh' },
          { label: pr.split ? 'Layout: a row for each category' : 'Layout: one row', value: 'split', icon: 'list' },
        ] : []),
        ...(i > 0 ? [{ label: 'Move up', value: 'up', icon: 'chevron' }] : []),
        ...(i < S.myLangs.length - 1 ? [{ label: 'Move down', value: 'down', icon: 'chevron' }] : []),
        { label: `Remove ${name} from home`, value: 'remove', icon: 'eyeOff' },
      ];
    };
    await sheet({ title: `${name} on the home screen`, options: build(), onPick: async (v) => {
      const pr = langPrefs(id);
      if (v === 'up' || v === 'down') { moveLang(id, v === 'up' ? -1 : 1); return build(); }
      if (v === 'remove') { toggleLang(id); toast(`${name} removed from home`); return null; }
      if (v === 'order') { setLangPrefs(id, { order: pr.order === 'year' ? 'added' : 'year' }); return build(); }
      if (v === 'split') { setLangPrefs(id, { split: !pr.split }); return build(); }
      if (v === 'cats-movie' || v === 'cats-series') { await this.pickLangCats(id, v === 'cats-movie' ? 'movie' : 'series'); return build(); }
      const r = new Set(langRowsFor(id)); if (r.has(v)) r.delete(v); else r.add(v);
      setLangRows(id, ['live', 'films', 'series'].filter((k) => r.has(k)));
      return build();
    } });
    this.show('langs');
    const b = this.view.querySelector(`[data-act="langedit"][data-arg="${id}"]`) || this.view.querySelector('#st-body .f');
    if (b) focus(b);
  }


  // Tick the provider categories (e.g. Malayalam 2026, 2025, 2024) that feed a language's home row.
  async pickLangCats(id, kind) {
    const mine = langCatList(kind, id);
    const mineIds = new Set(mine.map((c) => c.id));
    const others = C.cats[kind].filter((c) => !mineIds.has(c.id) && !c.adult)
      .map((c, i) => ({ c, i, y: catYear(c.name) })).sort((a, b) => (b.y - a.y) || (a.i - b.i)).map((x) => x.c);
    const key = kind === 'movie' ? 'movieCats' : 'seriesCats';
    const counts = new Map();
    for (const it of C[kind]) counts.set(it.cat, (counts.get(it.cat) || 0) + 1);
    const build = () => {
      const cur = langPrefs(id)[key];
      const on = new Set(cur || mine.map((c) => c.id));
      return [
        { label: cur ? `Use all ${langById(id).name} categories` : `Using all ${langById(id).name} categories`, value: '__all', on: !cur, icon: 'check' },
        ...mine.map((c) => ({ label: `${c.name}  (${counts.get(c.id) || 0})`, value: c.id, on: on.has(c.id), icon: kind === 'movie' ? 'film' : 'series' })),
        ...others.map((c) => ({ label: `+ ${c.name}  (${counts.get(c.id) || 0})`, value: c.id, on: on.has(c.id), icon: 'plus' })),
      ];
    };
    await sheet({ title: `${langById(id).name} ${kind === 'movie' ? 'film' : 'series'} categories on the home screen`, options: build(), onPick: (v) => {
      if (v === '__all') { setLangPrefs(id, { [key]: null }); return build(); }
      const cur = langPrefs(id)[key];
      const on = new Set(cur || mine.map((c) => c.id));
      if (on.has(v)) on.delete(v); else on.add(v);
      if (!on.size) { toast('Keep at least one category'); return build(); }
      const onlyMine = on.size === mine.length && mine.every((c) => on.has(c.id));
      setLangPrefs(id, { [key]: onlyMine ? null : [...mine, ...others].map((c) => c.id).filter((x) => on.has(x)) });
      return build();
    } });
  }


  focus() { focus(this.view.querySelector('.st-sec.on')); }
  save() { return { sec: this.sec }; }
}
