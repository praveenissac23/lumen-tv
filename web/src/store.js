// Everything the viewer changes: playlists, favourites, progress, locks, settings.
import { cacheRead, cacheWrite } from './native.js';
import { debounce } from './util.js';

const DEFAULTS = {
  playlists: [],
  active: 'demo',
  favs: { live: [], movie: [], series: [] },
  recentLive: [],          // channel ids, newest first
  recentVod: [],           // films and episodes started, newest first: {key, kind, id, seriesId, title, sub, poster, t}
  progress: {},            // "movie:ID" / "ep:ID" -> {pos, dur, t, title, poster, seriesId}
  pin: '0000',
  locked: {},              // "live:catId" -> true
  hidden: {},              // "live:catId" -> true
  recentSearches: [],
  myLangs: ['malayalam', 'tamil', 'hindi'],   // languages shown as home sections
  pins: [],                // [{kind, cat}] categories pinned to the home screen
  langRows: { malayalam: ['live', 'films'], tamil: ['films'], hindi: ['films'] },   // home rows per language
  watched: {},             // "movie:ID" / "ep:ID" -> true once finished
  settings: {
    autoplayLast: true,
    preview: true,
    buffer: 'normal',      // low | normal | high
    resize: 'fit',         // fit | fill | zoom
    zapKeys: 'updown',     // updown | reversed
    epgOffsetHours: 0,
    lockAdult: true,
    wallpaper: 'bubbles',  // bubbles | plain | teal | plum | dusk | image
    wallpaperUrl: '',
    motion: true,          // slowly moving bubbles
    accent: 'brass',       // brass | teal | coral | violet
    subLangs: ['en'],      // preferred subtitle languages (ISO 639-1)
    subAuto: false,        // fetch subtitles online automatically for films and episodes
    subSize: 'm',          // s | m | l
    osKey: '',             // OpenSubtitles API key
    downloader: '',        // remembered download app package ('' = ask)
    extPlayer: '',         // remembered external player package
    playerLive: 'lumen',   // default player per section: 'lumen' (built in) or an app package
    playerMovie: 'lumen',
    playerSeries: 'lumen',
    nextEpisode: true,     // auto-play the next episode
    homeLangRows: 'films,live', // which rows each language gets
    uiSize: 'm',           // s | m | l  screen size adjustment
    lite: true,            // lighter animations for TV sticks
    autoAppUpdate: true,   // download new app builds by themselves and show the Install screen
    catalogueRefresh: 1,   // days between automatic channel/film updates (0 = only when you press Refresh)
    homeLayout: 'rows',    // rows | hero | shortcuts | spotlight | compact
  },
};

let state;
try { state = JSON.parse(cacheRead('state') || 'null'); } catch { state = null; }
state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), state || {});
state.settings = Object.assign({}, DEFAULTS.settings, state.settings || {});
state.favs = Object.assign({ live: [], movie: [], series: [] }, state.favs || {});

const saveNow = () => cacheWrite('state', JSON.stringify(state));
const save = debounce(saveNow, 400);

export const S = new Proxy({}, { get: (_, k) => state[k] });
export function set(k, v) { state[k] = v; save(); }
export function setting(k, v) {
  if (v === undefined) return state.settings[k];
  state.settings[k] = v; save();
}
export function flush() { save.cancel(); saveNow(); }

// ---- favourites ----
export function isFav(kind, id) { return state.favs[kind].includes(String(id)); }
export function toggleFav(kind, id) {
  id = String(id);
  const list = state.favs[kind];
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  save();
  return i < 0;
}

// ---- recent channels ----
// Home screen sections, in order. n = number of items (0 = all, rows keep loading as you scroll).
export const HOME_SECTIONS = [
  { id: 'cont', label: 'Continue watching', on: true, n: 5 },
  { id: 'recentLive', label: 'Recently watched channels', on: true, n: 5 },
  { id: 'recentVod', label: 'Recently watched films and series', on: false, n: 5 },
  { id: 'favs', label: 'Favourite channels', on: true, n: 20 },
  { id: 'langs', label: 'Your language rows', on: true, n: 0 },
  { id: 'pins', label: 'Pinned categories', on: true, n: 0 },
  { id: 'newFilms', label: 'Recently added films (all languages)', on: false, n: 0 },
  { id: 'newSeries', label: 'Recently added series (all languages)', on: false, n: 0 },
  { id: 'sport', label: 'Sport channels', on: false, n: 0 },
];
export function homeSections() {
  const saved = Array.isArray(state.settings.homeRows) ? state.settings.homeRows : [];
  const out = [];
  for (const s of saved) { const d = HOME_SECTIONS.find((x) => x.id === s.id); if (d && !out.some((o) => o.id === s.id)) out.push({ ...d, ...s, label: d.label }); }
  for (const d of HOME_SECTIONS) if (!out.some((o) => o.id === d.id)) out.push({ ...d });
  return out;
}
export function setHomeSections(list) { state.settings.homeRows = list.map(({ id, on, n }) => ({ id, on, n })); save(); }

export function pushRecentVod(e) {
  const key = e.seriesId ? 'series:' + e.seriesId : e.key;   // a series appears once, with its latest episode
  state.recentVod = [{ ...e, rkey: key, t: Date.now() }, ...(state.recentVod || []).filter((x) => (x.rkey || x.key) !== key)].slice(0, 30);
  save();
}
export function pushRecentLive(id) {
  id = String(id);
  state.recentLive = [id, ...state.recentLive.filter((x) => x !== id)].slice(0, 30);
  save();
}

// ---- resume points ----
export function saveProgress(key, info) {
  if (!key || !(info.pos >= 0)) return;
  const done = info.dur > 0 && info.pos / info.dur > 0.94;
  if (done) state.watched[key] = true;
  if (done || info.pos < 30000) delete state.progress[key];
  else state.progress[key] = { ...state.progress[key], ...info, t: Date.now() };
  save();
}
export function progressOf(key) { return state.progress[key] || null; }
export function continueList() {
  return Object.entries(state.progress)
    .map(([key, v]) => ({ key, ...v }))
    .filter((v) => v.url || v.id)
    .sort((a, b) => (b.t || 0) - (a.t || 0))
    .slice(0, 20);
}

// ---- parental ----
export function isLocked(kind, cat) { return !!state.locked[`${kind}:${cat}`]; }
export function setLocked(kind, cat, v) { if (v) state.locked[`${kind}:${cat}`] = true; else delete state.locked[`${kind}:${cat}`]; save(); }
export function isHidden(kind, cat) { return !!state.hidden[`${kind}:${cat}`]; }
export function setHidden(kind, cat, v) { if (v) state.hidden[`${kind}:${cat}`] = true; else delete state.hidden[`${kind}:${cat}`]; save(); }

// PIN unlocks last for the session (like TiviMate) so you're not asked on every zap.
const unlocked = new Set();
export function sessionUnlocked(kind, cat) { return unlocked.has(`${kind}:${cat}`); }
export function unlockSession(kind, cat) { unlocked.add(`${kind}:${cat}`); }

// ---- search history ----
export function pushSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  state.recentSearches = [q, ...state.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  save();
}

// ---- playlists ----
export function activePlaylist() {
  return state.playlists.find((p) => p.id === state.active) || null;
}
export function upsertPlaylist(p) {
  const i = state.playlists.findIndex((x) => x.id === p.id);
  if (i >= 0) state.playlists[i] = p; else state.playlists.push(p);
  save();
}
export function removePlaylist(id) {
  state.playlists = state.playlists.filter((p) => p.id !== id);
  if (state.active === id) state.active = state.playlists[0]?.id || 'demo';
  save();
}

// ---- pins and languages ----
export function isPinned(kind, cat) { return state.pins.some((p) => p.kind === kind && p.cat === cat); }
export function togglePin(kind, cat) {
  const on = isPinned(kind, cat);
  state.pins = on ? state.pins.filter((p) => !(p.kind === kind && p.cat === cat)) : [...state.pins, { kind, cat }];
  save();
  return !on;
}
export function langRowsFor(id) { return (state.langRows && state.langRows[id]) || ['films']; }
export function setLangRows(id, rows) { state.langRows = { ...(state.langRows || {}), [id]: rows }; save(); }
export function toggleLang(id) {
  const on = state.myLangs.includes(id);
  state.myLangs = on ? state.myLangs.filter((x) => x !== id) : [...state.myLangs, id];
  if (!on && !(state.langRows && state.langRows[id])) state.langRows = { ...(state.langRows || {}), [id]: ['films'] };
  save();
  return !on;
}
export function moveLang(id, dir) {
  const a = state.myLangs, i = a.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; save();
}
export function isWatched(key) { return !!state.watched[key]; }
export function setWatched(key, v) { if (v) state.watched[key] = true; else delete state.watched[key]; save(); }
