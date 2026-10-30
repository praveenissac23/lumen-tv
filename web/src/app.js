// App shell: navigation rail, screen router, voice overlay, boot sequence.
import { $, esc, el, hhmm, now } from './util.js';
import * as N from './native.js';
import { initInput, pushLayer, popLayer, focus, focusFirst, clearLayers, topLayer } from './nav.js';
import { C, loadFromCache, refresh, catalogueAge, needsPin, resetProgrammeIndex, testXtream } from './data.js';
import { S, set, setting, sessionUnlocked, unlockSession, flush, upsertPlaylist } from './store.js';
import { icon, toast, pinPad } from './ui.js';
import { mountBackground, applyLook } from './look.js';
import { startUpdateChecks } from './updates.js';
import { search, parseSpoken } from './search.js';
import { player, playLive, exit as exitPlayer, stopPreview } from './player.js';
import { HomeScreen } from './screens/home.js';
import { LiveScreen } from './screens/live.js';
import { GuideScreen } from './screens/guide.js';
import { VodScreen, DetailScreen } from './screens/vod.js';
import { SearchScreen, tryLines } from './screens/searchview.js';
import { SettingsScreen } from './screens/settings.js';

const SCREENS = {
  home: HomeScreen, live: LiveScreen, guide: GuideScreen, movies: VodScreen, series: VodScreen,
  favourites: LiveScreen, detail: DetailScreen, search: SearchScreen, settings: SettingsScreen,
};
const RAIL = [
  ['search', 'search', 'Search'], ['home', 'home', 'Home'], ['live', 'live', 'Live TV'], ['guide', 'guide', 'TV guide'],
  ['movies', 'film', 'Films'], ['series', 'series', 'Series'], ['favourites', 'heart', 'Favourites'], ['settings', 'gear', 'Settings'],
];

const stack = [];
let current = null;           // { name, params, ctl }
const appLayer = { root: null, onKey: appKey };

export const app = { go, back, reload, ensureUnlocked, openVoice, current: () => current };

function railHtml() {
  return `<nav id="rail" class="rail" data-group="rail" data-zone="rail">
    <div class="brand"><span class="mark"><svg viewBox="22 22 64 64" aria-hidden="true"><defs><linearGradient id="lr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d79c"/><stop offset="1" stop-color="#ec8a6e"/></linearGradient></defs>
      <circle cx="54" cy="54" r="26" fill="#161c26"/><circle cx="54" cy="54" r="24" fill="none" stroke="url(#lr)" stroke-width="4"/><path d="M47.5 41.5 Q46 40.6 46 42.4 V65.6 Q46 67.4 47.5 66.5 L67.2 55.2 Q68.8 54 67.2 52.8 Z" fill="url(#lr)"/></svg></span><span class="brand-name">Lumen</span></div>
    ${RAIL.map(([k, ic, label]) => `<button class="f rail-item" data-go="${k}">${icon(ic)}<span>${label}</span></button>`).join('')}
    <div class="rail-foot" id="rail-clock"></div>
  </nav>`;
}

function mountShell() {
  const stage = $('#stage');
  stage.insertAdjacentHTML('beforeend', `
    <div id="app">${railHtml()}<main id="view" data-group="view" data-zone="view"></main></div>
    <div id="player-ui" class="player-ui"></div>
    <div id="overlays"></div>
    <div id="voice" class="voice" hidden></div>
    <div id="toast" class="toast"></div>`);
  mountBackground();
  appLayer.root = $('#app');
  pushLayer(appLayer);
  $('#rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === 'search') return go('search', {});
    stack.length = 0;
    go(b.dataset.go, {}, { root: true });
  });
  $('#rail').addEventListener('focusin', () => $('#app').classList.add('rail-open'));
  $('#rail').addEventListener('focusout', () => setTimeout(() => {
    if (!$('#rail').contains(document.activeElement)) $('#app').classList.remove('rail-open');
  }, 0));
  tickClock();
  setInterval(tickClock, 20000);
}

function freshView(name) {
  const old = $('#view');
  const v = document.createElement('main');
  v.id = 'view'; v.dataset.group = 'view'; v.dataset.zone = 'view';
  v.className = 'view v-' + name;
  v.addEventListener('edge', (e) => { if (e.detail === 'left') focusRail(); });
  old.replaceWith(v);
  document.body.dataset.screen = name;
  return v;
}

function tickClock() {
  const c = $('#rail-clock');
  if (c) c.textContent = hhmm(now());
  document.querySelectorAll('[data-clock]').forEach((n) => (n.textContent = hhmm(now())));
}

function focusRail() {
  const active = $(`#rail [data-go="${railKeyFor(current && current.name)}"]`);
  focus(active || $('#rail .rail-item'));
}
const railKeyFor = (name) => (name === 'detail' ? (current.params.kind === 'series' ? 'series' : 'movies') : name);

function markRail() {
  const k = current && railKeyFor(current.name);
  document.querySelectorAll('#rail .rail-item').forEach((b) => b.classList.toggle('active', b.dataset.go === k));
  // entering the rail from the screen lands on the current section
  const act = $('#rail .rail-item.active');
  if (act) $('#rail')._last = act;
}

// ---------- router ----------
function go(name, params = {}, { root = false, replace = false } = {}) {
  if (current) {
    const st = current.ctl.save ? current.ctl.save() : null;
    if (!replace && !root) stack.push({ name: current.name, params: current.params, st });
    current.ctl.destroy && current.ctl.destroy();
  }
  if (root) stack.length = 0;
  stopPreview();
  const view = freshView(name);
  const ctl = new SCREENS[name](view, { ...params, kind: params.kind || (name === 'series' ? 'series' : name === 'movies' ? 'movie' : params.kind), screen: name }, app);
  current = { name, params, ctl };
  markRail();
  ctl.focus ? ctl.focus() : focusFirst(view);
}

function back() {
  if (!stack.length) {
    if (current && current.name !== 'home') { go('home', {}, { root: true }); return; }
    confirmExit();
    return;
  }
  const prev = stack.pop();
  current.ctl.destroy && current.ctl.destroy();
  stopPreview();
  const view = freshView(prev.name);
  const ctl = new SCREENS[prev.name](view, { ...prev.params, kind: prev.params.kind || (prev.name === 'series' ? 'series' : prev.name === 'movies' ? 'movie' : undefined), screen: prev.name, restore: prev.st }, app);
  current = { name: prev.name, params: prev.params, ctl };
  markRail();
  ctl.focus ? ctl.focus() : focusFirst(view);
}

let exitArmed = 0;
function confirmExit() {
  if (Date.now() - exitArmed < 2500) { flush(); N.exitApp(); return; }
  exitArmed = Date.now();
  toast('Press Back again to exit');
}

function reload() {
  if (!current) return;
  const { name, params } = current;
  const st = current.ctl.save ? current.ctl.save() : null;
  current.ctl.destroy && current.ctl.destroy();
  const view = freshView(name);
  const ctl = new SCREENS[name](view, { ...params, kind: params.kind || (name === 'series' ? 'series' : name === 'movies' ? 'movie' : undefined), screen: name, restore: st }, app);
  current.ctl = ctl;
  if (!$('#rail').contains(document.activeElement) && !document.querySelector('#overlays *')) ctl.focus ? ctl.focus() : focusFirst(view);
}

function appKey(k, e) {
  if (current && current.ctl.onKey && current.ctl.onKey(k, e) === true) return true;
  const inRail = $('#rail').contains(document.activeElement);
  if (k === 'back') {
    if (inRail) { if (current) current.ctl.focus ? current.ctl.focus() : focusFirst($('#view')); return true; }
    back(); return true;
  }
  if (k === 'search') { openVoice(); return true; }
  if (k === 'menu' && setting('menuKey') !== 'options') { openVoice(); return true; }
  if (k === 'guide') { go('guide', {}); return true; }
  if (inRail && k === 'right') { current.ctl.focus ? current.ctl.focus() : focusFirst($('#view')); return true; }
  return false;
}

// ---------- parental PIN ----------
export async function ensureUnlocked(kind, catId) {
  if (!needsPin(kind, catId) || sessionUnlocked(kind, catId)) return true;
  const ok = await pinPad({ title: 'Enter your PIN', subtitle: 'This category is locked', check: (v) => v === S.pin });
  if (ok) unlockSession(kind, catId);
  return ok;
}

// ---------- voice search ----------
let voiceLayer = null;
function openVoice() {
  const v = $('#voice');
  const dev = N.device();
  v.hidden = false;
  v.innerHTML = `<div class="voice-inner">
      <div class="voice-orb">${icon('mic')}<i></i><i></i></div>
      <p class="voice-heard" id="voice-heard">Listening</p>
      <p class="voice-hint" id="voice-hint">Say a channel, film or show. Try ${tryLines().slice(0, 2).join(' or ')}.</p>
    </div>`;
  if (voiceLayer) popLayer(voiceLayer);
  voiceLayer = { root: v, modal: true, onKey: (k) => { if (k === 'back') { closeVoice(); return true; } return true; } };
  pushLayer(voiceLayer);
  v.classList.add('listening');
  if (!dev.voice) {
    // Fire TV: apps can't use the microphone directly, so open the search box with the
    // Fire TV keyboard; holding the Alexa button there dictates straight into it.
    closeVoice();
    go('search', { ime: true }, { replace: !!(current && current.name === 'search') });
    return;
  }
  N.voiceStart();
}
function closeVoice() {
  N.voiceStop();
  const v = $('#voice');
  v.hidden = true; v.className = 'voice';
  if (voiceLayer) { popLayer(voiceLayer); voiceLayer = null; }
}
N.on('voice', (d) => {
  const heard = $('#voice-heard');
  if (!voiceLayer || !heard) return;
  if (d.state === 'partial' || d.state === 'final') { heard.textContent = d.text; $('#voice').classList.add('has-text'); }
  if (d.state === 'error') { heard.textContent = 'Didn’t catch that'; $('#voice-hint').textContent = 'Press the button and speak again.'; $('#voice').classList.remove('listening'); setTimeout(closeVoice, 1600); }
  if (d.state === 'final') {
    const text = d.text;
    setTimeout(() => { closeVoice(); handleSpoken(text); }, 450);
  }
});

N.on('toast', (d) => toast(d.text, 'err'));

// Phone remote page sends text and settings here.
N.on('remote', async (d) => {
  if (d.type === 'search' && d.text) { if (player.mode) exitPlayer(); go('search', { q: d.text, voice: true }); toast(`From your phone: \u201c${d.text}\u201d`); }
  else if (d.type === 'play' && d.text) { if (player.mode) exitPlayer(); handleSpoken('play ' + d.text); }
  else if (d.type === 'oskey') { setting('osKey', d.text); toast('OpenSubtitles key saved'); if (current && current.name === 'settings') reload(); }
  else if (d.type === 'wallpaper') { setting('wallpaperUrl', d.text); setting('wallpaper', 'image'); applyLook(); toast('Wallpaper updated'); }
  else if (d.type === 'playlist') {
    const pl = d.playlist;
    if (!pl) return;
    pl.id = (pl.type === 'xtream' ? 'x' : 'm') + Date.now().toString(36);
    if (pl.type === 'xtream') { try { await testXtream(pl); } catch (e) { toast(`Couldn\u2019t connect: ${e.message}`, 'err'); return; } }
    upsertPlaylist(pl); set('active', pl.id); flush();
    toast('Loading channels from your new playlist');
    try { await refresh(() => {}); resetProgrammeIndex(); toast(`${C.live.length} channels ready`); go('home', {}, { root: true }); }
    catch (e) { toast(`Couldn\u2019t load the playlist: ${e.message}`, 'err'); }
  }
});

async function handleSpoken(text) {
  const p = parseSpoken(text);
  if (p.intent === 'play' || p.number != null) {
    const r = search(text);
    if (r.best && r.best.kind === 'live' && r.best.s >= 700) {
      const ch = r.best.item;
      if (!(await ensureUnlocked('live', ch.cat))) return;
      toast(`Playing ${ch.name}`);
      playLive(ch, C.live, () => reload());
      return;
    }
  }
  go('search', { q: text, voice: true });
}

// ---------- boot ----------
// The TV's web view can scroll clipped containers by itself when focus moves;
// all scrolling here is done with transforms, so undo any native scroll at once.
document.addEventListener('scroll', (e) => {
  const t = e.target;
  if (t && t.nodeType === 1 && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; }
  else if (t === document && (scrollX || scrollY)) scrollTo(0, 0);
}, true);

function boot() {
  const t0 = performance.now();
  document.body.classList.toggle('lite', !!setting('lite'));
  initInput();
  mountShell();
  const hasCache = loadFromCache();
  if (hasCache) start();
  else showLoading();
  const pl = S.playlists.find((p) => p.id === S.active);
  if (pl && (!hasCache || catalogueAge() > 4 * 3600 * 1000)) {
    refresh((part) => {
      resetProgrammeIndex();
      if (!current) { start(); return; }
      if (!player.mode && part !== 'epg') reload();
      if (part === 'epg' && current && ['home', 'live', 'guide'].includes(current.name) && !player.mode) reload();
    }).catch((err) => {
      if (!current) { start(); }
      toast(`Couldn’t refresh ${pl.name}: ${err.message}`, 'err');
    });
  }
  startUpdateChecks();
  window.__bootMs = Math.round(performance.now() - t0);
  document.documentElement.dataset.boot = window.__bootMs;
}

function showLoading() {
  $('#view').innerHTML = `<div class="loading"><i class="spinner"></i><p>Loading your channels</p></div>`;
}

function start() {
  const startOn = setting('startScreen') || 'home';
  go(SCREENS[startOn] ? startOn : 'home', {}, { root: true });
  const last = S.recentLive[0] && C.byId.live.get(S.recentLive[0]);
  if (setting('autoplayLast') && last && N.isNative && !needsPin('live', last.cat)) playLive(last, C.live, () => reload());
}

// Scale the 1920x1080 stage to the window.
function viewSize() {
  // The TV app reports its real size; browsers use the window.
  if (window.Native && window.Native.viewSize) {
    try { const v = JSON.parse(window.Native.viewSize()); if (v.w > 100 && v.h > 100) return v; } catch { /* fall back */ }
  }
  const vv = window.visualViewport;
  return { w: (vv && vv.width) || document.documentElement.clientWidth || innerWidth, h: (vv && vv.height) || document.documentElement.clientHeight || innerHeight };
}
function fit() {
  const v = viewSize();
  const adj = { s: 0.92, m: 1, l: 1.06 }[setting('uiSize')] || 1;   // overscan / preference
  const s = Math.min(v.w / 1920, v.h / 1080) * adj;
  const st = $('#stage');
  const innerWidth = v.w, innerHeight = v.h;
  document.body.style.width = v.w + 'px'; document.body.style.height = v.h + 'px';
  st.style.transform = `scale(${s})`;
  st.style.left = (innerWidth - 1920 * s) / 2 + 'px';
  st.style.top = (innerHeight - 1080 * s) / 2 + 'px';
}
addEventListener('resize', fit);
N.on('resize', () => setTimeout(fit, 50));
addEventListener('load', fit);
setTimeout(fit, 300);
fit();
window.__fit = fit;
boot();
addEventListener('pagehide', flush);
window.__app = app;
window.__C = C;
