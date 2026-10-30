// Full-screen playback with on-screen display, zapping, number entry and catch-up.
import * as N from './native.js';
import { C, nowNext, liveUrl, catchupUrl, progs } from './data.js';
import { S, setting, pushRecentLive, saveProgress, progressOf, isFav, toggleFav } from './store.js';
import { $, esc, hhmm, duration, minutesLeft, now, el } from './util.js';
import { pushLayer, popLayer, focus } from './nav.js';
import { icon, logo, progressBar, toast, sheet, VList, nowSlot, patchNowSlots } from './ui.js';
import { autoSubs, searchSubs, loadOnline, hasKey, langName, SUB_LANGS } from './subs.js';
import { itemActions, download } from './actions.js';
import { bgHole } from './look.js';

const DEMO_URL = N.isNative ? 'asset:///demo.mp4' : 'demo.mp4';
const urlOr = (u) => u || DEMO_URL;

const P = {
  mode: null,          // live | catchup | vod
  ch: null, list: [], prog: null, item: null, resumeKey: null,
  pos: 0, dur: 0, paused: false, lastCh: null,
  osdTimer: null, numBuf: '', numTimer: null, layer: null, onExit: null,
  previewCh: null, retried: false,
  queue: [],           // next episodes: [{item, key}]
  subsTried: false, speed: 1, sleepAt: 0, sleepTimer: null, nextTimer: null,
};
export const player = P;

const root = () => $('#player-ui');

N.on('progress', (d) => {
  P.pos = d.pos; P.dur = d.dur;
  if (P.mode === 'vod' && P.resumeKey && Math.round(d.pos / 1000) % 10 === 0) saveProgress(P.resumeKey, { pos: d.pos, dur: d.dur, ...P.item });
  if (P.mode && osdVisible()) paintProgress();
});
N.on('player', (d) => {
  const status = $('#player-status');
  if (d.state === 'buffering') status && (status.className = 'pstatus show', status.innerHTML = '<i class="spinner"></i>');
  if (d.state === 'ready') {
    status && (status.className = 'pstatus'); P.retried = false;
    if (P.mode === 'vod' && !P.subsTried) {
      P.subsTried = true;
      const it = P.item;
      setTimeout(() => { if (P.item === it) autoSubs(subItem(it), (m) => toast(m)); }, 1200);
    }
  }
  if (d.state === 'ended' && P.mode === 'vod') {
    saveProgress(P.resumeKey, { pos: P.dur, dur: P.dur });
    subsBox().innerHTML = '';
    if (P.queue.length && setting('nextEpisode')) nextCountdown(); else exit();
  }
  if (d.state === 'error') {
    if (!P.retried && P.mode) { P.retried = true; restart(); return; }
    if (status) { status.className = 'pstatus show err'; status.textContent = d.msg || 'This stream didn’t start. Try another channel or check your connection.'; }
    const pv = document.querySelector('.preview-msg'); if (pv) { pv.hidden = false; pv.textContent = 'Preview unavailable'; }
  }
});

// Subtitles from the player (embedded or sideloaded) are drawn by the interface.
N.on('cues', (d) => {
  const box = subsBox();
  const text = (d.text || '').trim();
  box.innerHTML = text ? text.split('\n').map((l) => `<span>${esc(l)}</span>`).join('<br>') : '';
});
function subsBox() {
  let b = document.getElementById('subs');
  if (!b) { b = document.createElement('div'); b.id = 'subs'; document.getElementById('stage').appendChild(b); }
  b.className = 'subs size-' + (setting('subSize') || 'm');
  return b;
}
const subItem = (it) => ({ title: it.seriesName || it.title, year: it.year, season: it.season, episode: it.episode, url: it.url });

function restart() {
  if (P.mode === 'live') startLive(P.ch, false);
  else if (P.mode === 'catchup') playCatchup(P.ch, P.prog);
  else if (P.mode === 'vod') N.play(urlOr(P.item.url), { live: false, start: P.pos });
}

// ---------- preview (small video in Live TV / Guide) ----------
// The UI is drawn over the video. A "hole" element paints the page background
// everywhere except the preview rectangle so the video shows through there.
function hole(rect) { bgHole(rect); }
export function preview(ch, rect) {
  if (!setting('preview') || P.mode) return;
  hole(rect);
  const msg = document.querySelector('.preview-msg'); if (msg) msg.hidden = true;
  if (P.previewCh === ch) { N.setRect(rect); return; }
  P.previewCh = ch;
  N.play(urlOr(liveUrl(ch)), { rect, live: true });
}
export function stopPreview() { if (P.previewCh && !P.mode) N.stop(); P.previewCh = null; if (!P.mode) hole(null); }

// ---------- entry points ----------
export function playLive(ch, list, onExit) {
  P.list = list && list.length ? list : C.live;
  P.onExit = onExit || P.onExit;
  enter('live');
  startLive(ch, true);
}

function startLive(ch, fresh) {
  if (P.ch && P.ch !== ch && P.mode === 'live') P.lastCh = P.ch;
  P.mode = 'live'; P.ch = ch; P.prog = null;
  pushRecentLive(ch.id);
  if (P.previewCh === ch && fresh) N.setRect(null);
  else N.play(urlOr(liveUrl(ch)), { live: true });
  P.previewCh = null;
  paint(); showOsd();
}

export function playCatchup(ch, prog, list, onExit) {
  if (!P.mode) { P.list = list || C.live; P.onExit = onExit || P.onExit; enter('catchup'); }
  P.mode = 'catchup'; P.ch = ch; P.prog = prog;
  N.play(urlOr(catchupUrl(ch, prog.s, prog.e)), { live: false });
  P.previewCh = null;
  paint(); showOsd();
}

// item: {title, url, poster, kind, id, sub}
export function playVod(item, resumeKey, onExit, queue) {
  P.onExit = onExit || P.onExit;
  enter('vod');
  P.mode = 'vod'; P.item = item; P.resumeKey = resumeKey; P.ch = null;
  P.queue = queue || []; P.subsTried = false; clearTimeout(P.nextTimer);
  subsBox().innerHTML = '';
  const prog = resumeKey && progressOf(resumeKey);
  P.pos = prog ? prog.pos : 0; P.dur = prog ? prog.dur : 0;
  N.play(urlOr(item.url), { live: false, start: P.pos });
  P.previewCh = null;
  paint(); showOsd();
}

function enter(mode) {
  hole(null);
  document.body.classList.add('playing');
  P.mode = mode;
  if (!P.layer) {
    P.layer = { root: root(), modal: true, onKey };
    pushLayer(P.layer);
  }
  N.setBuffer({ low: 1500, normal: 4000, high: 12000 }[setting('buffer')] || 4000);
  N.setResize(setting('resize'));
}

export function exit() {
  clearTimeout(P.nextTimer);
  const sb = document.getElementById('subs'); if (sb) sb.innerHTML = '';
  if (P.speed !== 1) { P.speed = 1; N.setSpeed(1); }
  if (P.mode === 'vod' && P.resumeKey) saveProgress(P.resumeKey, { pos: P.pos, dur: P.dur, ...P.item });
  N.stop();
  closeList();
  document.body.classList.remove('playing');
  root().innerHTML = '';
  if (P.layer) { popLayer(P.layer); P.layer = null; }
  const cb = P.onExit; const ch = P.ch;
  P.mode = null; P.onExit = null;
  cb && cb(ch);
}

// ---------- OSD ----------
// Guide data arrived while playing: refresh what is on screen.
export function onEpg() {
  if (!P.mode) return;
  if (listUI) patchNowSlots(listUI.panel);
  if (osdVisible() && P.mode !== 'vod') paint();
}
function osdVisible() { return root().classList.contains('osd'); }
function showOsd(ms = 5000) {
  root().classList.add('osd');
  clearTimeout(P.osdTimer);
  if (!P.paused) P.osdTimer = setTimeout(() => root().classList.remove('osd'), ms);
}
function hideOsd() { clearTimeout(P.osdTimer); root().classList.remove('osd'); }

function paint() {
  const r = root();
  if (P.mode === 'vod') {
    const it = P.item;
    r.innerHTML = `
      <div class="osd-top"><div class="osd-title"><h1>${esc(it.title)}</h1>${it.sub ? `<p>${esc(it.sub)}</p>` : ''}</div><div class="osd-clock" id="osd-clock">${hhmm(now())}</div></div>
      <div class="osd-bottom vod">
        <div class="scrub"><span class="pp">${icon(P.paused ? 'play' : 'pause')}</span>
          <span class="t" id="osd-pos">${duration(P.pos / 1000)}</span>${progressBar(P.dur ? P.pos / P.dur : 0, 'scrubbar')}<span class="t" id="osd-dur">${P.dur ? duration(P.dur / 1000) : '--:--'}</span></div>
        <p class="osd-hint">Left and right skip 10 seconds, hold to skip a minute. ${icon('list')} Menu for subtitles, audio, speed and download.</p>
      </div>
      <div id="player-status" class="pstatus"></div>`;
    return;
  }
  const ch = P.ch;
  const nn = nowNext(ch);
  const isCU = P.mode === 'catchup';
  const cur = isCU ? { ...P.prog, pct: 0 } : nn && nn.now;
  const nxt = isCU ? null : nn && nn.next;
  r.innerHTML = `
    <div class="osd-top">
      <div class="osd-ch"><span class="num">${ch.num}</span>${logo(ch, 'md')}<div><h1>${esc(ch.name)} ${isFav('live', ch.id) ? icon('heartFill', 'favmark') : ''}</h1>
      <p>${isCU ? `<span class="tag cu">Catch-up</span> ${esc(dayLabelTime(P.prog.s))}` : '<span class="tag live">Live</span>'}</p></div></div>
      <div class="osd-clock" id="osd-clock">${hhmm(now())}</div>
    </div>
    <div class="osd-bottom">
      ${cur ? `<div class="osd-now">
        <h2>${esc(cur.t)}</h2>
        <div class="osd-time"><span>${hhmm(cur.s)}</span>${progressBar(isCU ? (P.dur ? P.pos / P.dur : 0) : cur.pct, 'osdbar')}<span>${hhmm(cur.e)}</span>
          <em id="osd-left">${isCU ? '' : minutesLeft(cur.e)}</em></div>
        ${cur.d ? `<p class="osd-desc">${esc(cur.d)}</p>` : ''}
      </div>` : '<div class="osd-now"><h2>No programme information</h2></div>'}
      ${nxt ? `<div class="osd-next"><small>Next at ${hhmm(nxt.s)}</small><span>${esc(nxt.t)}</span></div>` : ''}
      <div class="osd-keys">
        <span><b>${icon('chevron', 'up')}</b><b>${icon('chevron', 'down')}</b> Change channel</span>
        <span><b>OK</b> Channel list</span><span><b>${icon('list')}</b> Options, subtitles, audio</span><span><b>Hold OK</b> More</span>
      </div>
    </div>
    <div id="numentry" class="numentry"></div>
    <div id="player-status" class="pstatus"></div>`;
}

const dayLabelTime = (s) => {
  const d = new Date(s * 1000);
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hhmm(s);
};

function paintProgress() {
  const c = $('#osd-clock'); if (c) c.textContent = hhmm(now());
  if (P.mode === 'vod' || P.mode === 'catchup') {
    const bar = root().querySelector('.scrubbar i, .osdbar i');
    if (bar && P.dur) bar.style.width = (P.pos / P.dur) * 100 + '%';
    const p = $('#osd-pos'); if (p) p.textContent = duration(P.pos / 1000);
    const d = $('#osd-dur'); if (d && P.dur) d.textContent = duration(P.dur / 1000);
  }
}

// ---------- channel list panel (OK while watching) ----------
let listUI = null;
function openList() {
  const panel = el(`<div class="zap-panel"><div class="zap-head">${esc(P.list === C.live ? 'All channels' : 'Channels')}</div><div class="zap-list"></div></div>`);
  root().appendChild(panel);
  const vl = new VList(panel.querySelector('.zap-list'), {
    rowH: 92,
    render: (ch) => `<button class="f zap-row ${ch === P.ch ? 'cur' : ''}"><span class="num">${ch.num}</span>${logo(ch, 'sm')}
        <span class="zr-main"><b>${esc(ch.name)}</b>${nowSlot(ch, 'row')}</span></button>`,
    onSelect: (ch) => { closeList(); startLive(ch, false); },
  });
  vl.setItems(P.list, Math.max(0, P.list.indexOf(P.ch)));
  listUI = { panel, vl };
  vl.focusIndex(vl.index, true);
  root().classList.add('listing');
  hideOsd();
}
function closeList() {
  if (!listUI) return;
  listUI.panel.remove(); listUI = null; root().classList.remove('listing');
}

// ---------- keys ----------
function zap(step) {
  const list = P.list;
  if (!list.length) return;
  let i = list.indexOf(P.ch);
  i = (i + step + list.length) % list.length;
  startLive(list[i], false);
}

function numberKey(d) {
  P.numBuf = (P.numBuf + d).slice(0, 5);
  const box = $('#numentry');
  if (box) { box.textContent = P.numBuf; box.classList.add('show'); }
  clearTimeout(P.numTimer);
  P.numTimer = setTimeout(commitNumber, 1400);
}
function commitNumber() {
  const n = +P.numBuf; P.numBuf = '';
  const box = $('#numentry'); if (box) box.classList.remove('show');
  if (n === 0) { if (P.lastCh) startLive(P.lastCh, false); return; }
  const ch = C.live.find((c) => c.num === n);
  if (!ch) { toast(`No channel ${n}`); return; }
  if (!P.list.includes(ch)) P.list = C.live;
  startLive(ch, false);
}

async function options() {
  hideOsd();
  const isVod = P.mode === 'vod';
  const opts = [];
  if (!isVod) {
    opts.push({ label: isFav('live', P.ch.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', value: 'fav' });
    if (P.ch.arch && P.mode === 'live') opts.push({ label: 'Start this programme over', icon: 'history', value: 'startover' });
    if (P.mode === 'catchup') opts.push({ label: 'Back to live', icon: 'live', value: 'golive' });
    if (P.lastCh) opts.push({ label: `Previous channel: ${P.lastCh.name}`, icon: 'back', value: 'last' });
  }
  const t = N.tracks();
  opts.push({ label: 'Subtitles', icon: 'subtitles', value: 'subs', hint: t.text.find((x) => x.selected) ? langName((t.text.find((x) => x.selected).lang || '').slice(0, 2)) : 'Off' });
  if (t.audio.length > 1) opts.push({ label: 'Audio language', icon: 'audio', value: 'audio', hint: (t.audio.find((x) => x.selected) || {}).label || '' });
  if (isVod) {
    opts.push({ label: 'Playback speed', icon: 'speed', value: 'speed', hint: P.speed === 1 ? 'Normal' : P.speed + '\u00d7' });
    opts.push({ label: 'Download', icon: 'download', value: 'download' });
  }
  opts.push({ label: 'More: external player, copy link, QR', icon: 'external', value: 'more' });
  opts.push({ label: 'Sleep timer', icon: 'moon', value: 'sleep', hint: P.sleepAt ? `Stops at ${hhmm(P.sleepAt / 1000)}` : 'Off' });
  opts.push({ label: 'Picture size', icon: 'tv', value: 'resize', hint: { fit: 'Fit to screen', fill: 'Stretch to fill', zoom: 'Zoom and crop' }[setting('resize')] });
  const v = await sheet({ title: isVod ? P.item.title : P.ch.name, options: opts });
  if (!v) return;
  if (v === 'fav') toast(toggleFav('live', P.ch.id) ? 'Added to favourites' : 'Removed from favourites');
  else if (v === 'startover') { const nn = nowNext(P.ch); if (nn && nn.now) playCatchup(P.ch, nn.now); }
  else if (v === 'golive') startLive(P.ch, false);
  else if (v === 'last') startLive(P.lastCh, false);
  else if (v === 'subs') subtitleMenu();
  else if (v === 'audio') {
    const a = await sheet({ title: 'Audio language', options: t.audio.map((x) => ({ label: x.label, value: x.id, on: x.selected, icon: 'audio' })) });
    if (a != null) N.selectTrack('audio', a);
  } else if (v === 'speed') {
    const sp = await sheet({ title: 'Playback speed', options: [0.75, 1, 1.25, 1.5, 2].map((x) => ({ label: x === 1 ? 'Normal' : x + '\u00d7', value: String(x), on: P.speed === x })) });
    if (sp) { P.speed = +sp; N.setSpeed(P.speed); }
  } else if (v === 'download') download(P.item.kind || 'movie', vodEntity());
  else if (v === 'more') more();
  else if (v === 'sleep') sleepMenu();
  else if (v === 'resize') {
    const modes = { fit: 'Fit to screen', fill: 'Stretch to fill', zoom: 'Zoom and crop' };
    const m = await sheet({ title: 'Picture size', options: Object.entries(modes).map(([k, l]) => ({ label: l, value: k, on: setting('resize') === k, icon: 'tv' })) });
    if (m) { setting('resize', m); N.setResize(m); }
  }
}

// The film/episode being played, in the shape the action menu expects.
function vodEntity() {
  const it = P.item;
  if (it.kind === 'movie') return C.byId.movie.get(String(it.id)) || { ...it, name: it.title };
  return { ...it, key: P.resumeKey, name: it.title };
}
function more() {
  if (P.mode === 'vod') itemActions(P.item.kind === 'movie' ? 'movie' : 'episode', vodEntity(), window.__app, { resumeKey: P.resumeKey });
  else itemActions('live', P.ch, window.__app, { list: P.list });
}

async function subtitleMenu() {
  const t = N.tracks();
  const opts = [{ label: 'Off', value: 'off', on: !t.text.some((x) => x.selected) }];
  for (const x of t.text) opts.push({ label: x.label, value: 'id:' + x.id, on: x.selected, icon: 'subtitles', hint: x.external ? 'Downloaded' : 'In the video' });
  if (P.mode === 'vod') opts.push({ label: 'Search online', value: 'online', icon: 'search', hint: hasKey() ? (setting('subLangs') || []).map(langName).join(', ') : 'Needs a free OpenSubtitles key' });
  opts.push({ label: 'Subtitle size', value: 'size', icon: 'subtitles', hint: { s: 'Small', m: 'Medium', l: 'Large' }[setting('subSize') || 'm'] });
  const v = await sheet({ title: 'Subtitles', options: opts });
  if (!v) return;
  if (v === 'off') { N.selectTrack('text', 'off'); subsBox().innerHTML = ''; return; }
  if (v.startsWith('id:')) { N.selectTrack('text', v.slice(3)); return; }
  if (v === 'size') {
    const z = await sheet({ title: 'Subtitle size', options: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => ({ label: l, value: k, on: setting('subSize') === k })) });
    if (z) { setting('subSize', z); subsBox(); }
    return;
  }
  if (v === 'online') {
    if (!hasKey()) { toast('Add your OpenSubtitles key in Settings > Subtitles. You can paste it from your phone.', 'err'); return; }
    toast('Searching subtitles');
    try {
      const r = await searchSubs(subItem(P.item));
      if (!r.length) { toast('No subtitles found for this title'); return; }
      const pick = await sheet({ title: 'Online subtitles', options: r.slice(0, 30).map((x, i) => ({
        label: `${langName(x.lang)}${x.hashMatch ? ' \u00b7 matches this file' : ''}`, hint: x.name.slice(0, 60), value: String(i), icon: x.hashMatch ? 'check' : 'subtitles' })) });
      if (pick == null) return;
      await loadOnline(r[+pick]);
      toast(`Subtitles loaded: ${langName(r[+pick].lang)}`);
    } catch (e) { toast(e.message === 'NO_KEY' ? 'Add your OpenSubtitles key in Settings' : `Subtitles: ${e.message}`, 'err'); }
  }
}

async function sleepMenu() {
  const opts = [{ label: 'Off', value: '0', on: !P.sleepAt }];
  for (const m of [15, 30, 45, 60, 90, 120]) opts.push({ label: `${m} minutes`, value: String(m) });
  const nn = P.ch && nowNext(P.ch);
  if (nn && nn.now && P.mode === 'live') opts.push({ label: `End of this programme (${hhmm(nn.now.e)})`, value: 'end' });
  if (P.mode === 'vod' && P.dur) opts.push({ label: 'End of this video', value: 'endvod' });
  const v = await sheet({ title: 'Sleep timer', options: opts, focusIndex: P.sleepAt ? 0 : 2 });
  if (v == null) return;
  clearTimeout(P.sleepTimer);
  P.sleepAt = 0;
  let ms = 0;
  if (v === 'end') ms = nn.now.e * 1000 - Date.now();
  else if (v === 'endvod') ms = P.dur - P.pos + 2000;
  else ms = +v * 60000;
  if (!ms) { toast('Sleep timer off'); return; }
  P.sleepAt = Date.now() + ms;
  P.sleepTimer = setTimeout(() => { P.sleepAt = 0; exit(); N.exitApp(); }, ms);
  toast(`Playback stops at ${hhmm(P.sleepAt / 1000)}`);
}

// Auto-play the next episode with a short countdown (OK = now, Back = stop).
function nextCountdown() {
  const nx = P.queue[0];
  let n = 10;
  const box = el(`<div class="next-up"><small>Up next</small><b>${esc(nx.item.sub || nx.item.title)}</b>
    <p>Starting in <span id="next-n">${n}</span> s. OK to play now, Back to stop.</p></div>`);
  root().appendChild(box);
  P.paused = false;
  const go = () => { clearTimeout(P.nextTimer); box.remove(); const q = P.queue.slice(1); playVod(nx.item, nx.key, null, q); };
  const tick = () => { n--; const s = document.getElementById('next-n'); if (s) s.textContent = n; if (n <= 0) go(); else P.nextTimer = setTimeout(tick, 1000); };
  P.nextTimer = setTimeout(tick, 1000);
  P.nextGo = go;
  P.nextBox = box;
}

let seekAcc = 0, seekTimer = null;
function seek(ms) {
  seekAcc += ms;
  P.pos = Math.max(0, Math.min(P.dur || Infinity, P.pos + ms));
  paintProgress(); showOsd();
  clearTimeout(seekTimer);
  seekTimer = setTimeout(() => { N.seekBy(seekAcc); seekAcc = 0; }, 350);
}

function onKey(k, e) {
  if (listUI) {
    if (k === 'back' || k === 'right' || k === 'left') { closeList(); return true; }
    if (listUI.vl.key(k)) return true;
    if (k === 'ok') { document.activeElement.click(); return true; }
    return true;
  }
  if (P.nextBox && P.nextBox.isConnected) {
    if (k === 'ok') { P.nextGo(); return true; }
    if (k === 'back') { clearTimeout(P.nextTimer); P.nextBox.remove(); exit(); return true; }
    return true;
  }
  if (k === 'hold') { more(); return true; }
  if (k === 'back') {
    if (P.numBuf) { P.numBuf = ''; $('#numentry')?.classList.remove('show'); return true; }
    if (osdVisible() && P.mode !== 'vod') { hideOsd(); return true; }
    exit(); return true;
  }
  if (k === 'menu') { options(); return true; }
  if (k === 'info' || k === 'guide') { showOsd(8000); return true; }
  if (/^d\d$/.test(k) && P.mode !== 'vod') { numberKey(k.slice(1)); return true; }

  if (P.mode === 'live' || (P.mode === 'catchup' && (k === 'up' || k === 'down' || k === 'chup' || k === 'chdown'))) {
    const rev = setting('zapKeys') === 'reversed';
    if (k === 'up' || k === 'chup') { zap(rev ? 1 : -1); return true; }
    if (k === 'down' || k === 'chdown') { zap(rev ? -1 : 1); return true; }
    if (k === 'ok') { openList(); return true; }
    if (k === 'left' || k === 'right') { showOsd(); return true; }
    return true;
  }
  // vod / catch-up transport
  if (k === 'ok' || k === 'playpause' || k === 'play' || k === 'pause') {
    P.paused = k === 'play' ? false : k === 'pause' ? true : !P.paused;
    N.pause(P.paused); paint(); showOsd(P.paused ? 1e9 : 4000); return true;
  }
  if (k === 'left' || k === 'rew') { seek(e && e.repeat ? -60000 : -10000); return true; }
  if (k === 'right' || k === 'ffwd') { seek(e && e.repeat ? 60000 : 10000); return true; }
  if (k === 'up' || k === 'down') { showOsd(); return true; }
  return true;
}

// keep the clock and "minutes left" fresh while the OSD is up
setInterval(() => { if (P.mode && osdVisible()) { paintProgress(); const l = $('#osd-left'); const nn = P.ch && nowNext(P.ch); if (l && nn && nn.now) l.textContent = minutesLeft(nn.now.e); } }, 15000);
