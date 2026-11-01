// Thin wrapper around the Android bridge (window.Native, see NativeBridge.kt).
// In a desktop browser everything falls back to web APIs so the UI can be
// developed and screenshotted without a TV.

const N = window.Native || null;
export const isNative = !!N;
// On the TV the video is drawn behind this page, so the page itself must be see-through.
if (N) document.documentElement.classList.add('native');

const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
function emit(evt, data) { (listeners[evt] || []).forEach((f) => f(data)); }

const pending = new Map();
let seq = 0;

// Native -> JS entry point.
window.__nat = (evt, data) => {
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* keep string */ } }
  if (evt === 'head' || evt === 'call') {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(evt === 'call' ? N.take(data.id) : data); else p.reject(new Error(data.error || 'Request failed'));
    return;
  }
  if (evt === 'http' || evt === 'catalog' || (evt === 'epg' && data.id != null)) {
    const p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      if (data.ok) p.resolve(evt === 'http' ? N.take(data.id) : (data.count != null ? data.count : true));
      else p.reject(new Error(data.error || `HTTP ${data.status}`));
    }
    if (evt !== 'epg') return;
  }
  emit(evt, data);
};

export function device() {
  if (N) { try { return JSON.parse(N.deviceInfo()); } catch { /* fallthrough */ } }
  const sr = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  return { fireTv: false, voice: sr, model: 'Browser', version: 'dev' };
}

// GET a URL as text. Native side does the request (no CORS, keeps connections warm).
export function http(url, { timeout = 20000 } = {}) {
  if (N) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      N.http(id, url, timeout);
    });
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  return fetch(url, { signal: ctl.signal }).then((r) => {
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

// Stream a big Xtream list natively into cache file `key`; resolves with the item count.
export function catalog(url, kind, key) {
  if (!N) return null; // browser: caller falls back to http + JSON
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); N.catalog(id, url, kind, key); });
}

// Programme guide (native SQLite). Each resolves with a JSON string.
function callNative(fn) {
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); fn(id); });
}
export const epgImport = (url, from, to, idsCsv) => callNative((id) => N.epgImport(id, url, from, to, idsCsv));
export const epgNow = (idsCsv, at) => callNative((id) => N.epgNow(id, idsCsv, at));
export const epgRange = (idsCsv, from, to) => callNative((id) => N.epgRange(id, idsCsv, from, to));
export const epgSearch = (q, from, to, limit) => callNative((id) => N.epgSearch(id, q, from, to, limit));
export const epgInfoRaw = () => N.epgInfo();
export const parseXmltvText = (xml, from, to) => parseXmltv(xml, from, to);

// Disk cache for catalogue and EPG (instant start-up).
export function cacheRead(key) {
  try { return N ? N.cacheRead(key) : localStorage.getItem('c:' + key); } catch { return null; }
}
export function cacheWrite(key, text) {
  try { if (N) N.cacheWrite(key, text); else localStorage.setItem('c:' + key, text); } catch { /* quota */ }
}

// ---- Voice -------------------------------------------------------------
let webRec = null;
export function voiceStart() {
  if (N) { N.voiceStart(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { emit('voice', { state: 'error', text: 'Voice input is not available on this device' }); return; }
  webRec = new SR();
  webRec.interimResults = true;
  webRec.lang = navigator.language || 'en-US';
  webRec.onstart = () => emit('voice', { state: 'listening' });
  webRec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    emit('voice', { state: r.isFinal ? 'final' : 'partial', text: r[0].transcript });
  };
  webRec.onerror = (e) => emit('voice', { state: 'error', text: e.error });
  webRec.onend = () => emit('voice', { state: 'end' });
  webRec.start();
}
export function voiceStop() { if (N) N.voiceStop(); else if (webRec) webRec.abort(); }

// ---- Player ------------------------------------------------------------
// rect is in stage pixels (1920x1080); null = full screen.
let video = null;
// Convert a stage rectangle (1920x1080 design pixels) into fractions of the screen,
// so the native video lines up whatever the scaling.
function frac(rect) {
  if (!rect) return null;
  const st = document.getElementById('stage');
  const b = st.getBoundingClientRect();
  const k = b.width / 1920;
  const v = window.__viewSize ? window.__viewSize() : { w: innerWidth, h: innerHeight };
  const W = v.w, H = v.h;
  return { fx: (b.left + rect.x * k) / W, fy: (b.top + rect.y * k) / H, fw: (rect.w * k) / W, fh: (rect.h * k) / H };
}
export function play(url, { rect = null, start = 0, live = true } = {}) {
  if (N) { N.play(url, JSON.stringify({ rect: frac(rect), start, live })); return; }
  video ||= document.getElementById('webvideo');
  if (!video) return;
  setRect(rect);
  video.hidden = false;
  video.src = url;
  video.currentTime = start / 1000;
  video.play().catch(() => emit('player', { state: 'error', msg: 'This stream format needs the TV app to play' }));
}
export function setRect(rect) {
  if (N) { N.setRect(JSON.stringify(frac(rect))); return; }
  if (!video) return;
  Object.assign(video.style, rect
    ? { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' }
    : { left: 0, top: 0, width: '1920px', height: '1080px' });
}
export function stop() {
  if (N) { N.stop(); return; }
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true; }
}
export function pause(p) {
  if (N) { p ? N.pause() : N.resume(); return; }
  if (video) p ? video.pause() : video.play();
}
export function seekBy(ms) {
  if (N) { N.seekBy(ms); return; }
  if (video) video.currentTime = Math.max(0, video.currentTime + ms / 1000);
}
export function seekTo(ms) {
  if (N) { N.seekTo(ms); return; }
  if (video) video.currentTime = ms / 1000;
}
export function setResize(mode) { if (N) N.setResize(mode); }
export function setBuffer(ms) { if (N) N.setBuffer(ms); }
export function exitApp() { if (N) N.exit(); }

if (!N) {
  // Browser: forward <video> progress like the native player does.
  setInterval(() => {
    if (video && !video.paused && !video.hidden) emit('progress', { pos: video.currentTime * 1000, dur: (video.duration || 0) * 1000 });
  }, 1000);
}

// Browser-side XMLTV parse (the app does this natively for speed).
function parseXmltv(xml, from, to) {
  const out = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1];
    const s = xtTime(/start="([^"]+)"/.exec(a)?.[1]);
    const e = xtTime(/stop="([^"]+)"/.exec(a)?.[1]);
    if (!s || e < from || s > to) continue;
    const ch = /channel="([^"]+)"/.exec(a)?.[1];
    const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2])?.[1] || '';
    const d = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2])?.[1] || '';
    (out[ch] ||= []).push([s, e, decode(t), decode(d).slice(0, 400)]);
  }
  return out;
}
function xtTime(v) {
  if (!v) return 0;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec(v);
  if (!m) return 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  if (m[7]) { const sign = m[7][0] === '-' ? -1 : 1; t -= sign * (+m[7].slice(1, 3) * 3600 + +m[7].slice(3) * 60); }
  return t;
}
function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

// ---- other apps (download managers, external players) ----
// Known apps; the native side reports which are installed.
export const KNOWN_APPS = [
  { pkg: 'com.dv.adm', name: 'ADM', role: 'download' },
  { pkg: 'com.dv.adm.pay', name: 'ADM Pro', role: 'download' },
  { pkg: 'idm.internet.download.manager', name: '1DM', role: 'download' },
  { pkg: 'idm.internet.download.manager.plus', name: '1DM+', role: 'download' },
  { pkg: 'idm.internet.download.manager.adm.lite', name: '1DM Lite', role: 'download' },
  { pkg: 'org.videolan.vlc', name: 'VLC', role: 'player' },
  { pkg: 'com.mxtech.videoplayer.ad', name: 'MX Player', role: 'player' },
  { pkg: 'com.mxtech.videoplayer.pro', name: 'MX Player Pro', role: 'player' },
  { pkg: 'com.brouken.player', name: 'Just Player', role: 'player' },
];
export function installedApps() {
  if (N) { try { return JSON.parse(N.apps()); } catch { return []; } }
  // Browser preview: pretend the common ones are installed so the menus can be seen.
  return KNOWN_APPS.filter((a) => ['com.dv.adm', 'idm.internet.download.manager', 'org.videolan.vlc', 'com.mxtech.videoplayer.ad'].includes(a.pkg));
}
// mode: 'play' | 'download'; pkg '' opens Android's app chooser
export function openWith(pkg, url, { title = '', file = '', mode = 'play', position = 0 } = {}) {
  if (N) return N.openWith(pkg, url, JSON.stringify({ title, file, mode, position }));
  window.open(url, '_blank');
  return true;
}
export function copyText(text) {
  if (N) { N.copy(text); return; }
  try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
}
// Size and type of a URL without downloading it
export function head(url) {
  if (N) {
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); N.head(id, url); });
  }
  return fetch(url, { method: 'HEAD' }).then((r) => ({ size: +r.headers.get('content-length') || 0, type: r.headers.get('content-type') || '' }));
}
// JSON API call done natively (no CORS), used for OpenSubtitles
export function call(method, url, headers, body) {
  if (N) {
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); N.call(id, method, url, JSON.stringify(headers || {}), body || ''); });
  }
  return fetch(url, { method, headers, body: body || undefined }).then((r) => r.text());
}
export function openUrl(url) { if (N) N.openUrl(url); else window.open(url, '_blank'); }

// ---- subtitles and tracks ----
export function tracks() { if (N) { try { return JSON.parse(N.tracks()); } catch { return { audio: [], text: [] }; } } return { audio: [], text: [] }; }
export function selectTrack(type, id) { if (N) N.selectTrack(type, String(id)); }
// Download a subtitle file natively and attach it to the current video
export function loadSubtitle(url, lang, name) { if (N) N.loadSubtitle(url, lang || 'und', name || ''); }
export function subtitleHash(url) {
  if (!N) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve: (d) => resolve(d && d.hash ? d : null), reject }); N.subtitleHash(id, url); });
}
export function setSpeed(x) { if (N) N.setSpeed(x); else if (video) video.playbackRate = x; }

// ---- phone companion page (local web server on the TV) ----
export function companion() { if (N) { try { return JSON.parse(N.companion()); } catch { return null; } } return { url: 'http://192.168.1.24:8899', pin: '4821' }; }
export function showKeyboard() { if (N) N.showKeyboard(); }

// Native search box (TextEntry.kt): the TV keyboard opens; holding the remote's mic button dictates.
// Resolves with the text, or null if cancelled. Returns null when not running on the TV.
let textWaiter = null;
export function textInput(title, hint, initial = '') {
  if (!N || !N.textInput) return null;
  return new Promise((resolve) => {
    if (textWaiter) textWaiter(null);
    textWaiter = resolve;
    N.textInput(title, hint, initial || '');
  });
}
on('textinput', (d) => { const w = textWaiter; textWaiter = null; if (w) w(d && d.text ? String(d.text) : null); });
export function installUpdate(url) { if (N && N.installUpdate) N.installUpdate(url); }
// mode: 'auto' | 'amazon' | 'downloader' (TV only)
export function installUpdateWith(url, mode) { if (N && N.installUpdateWith) N.installUpdateWith(url, mode); else installUpdate(url); }
