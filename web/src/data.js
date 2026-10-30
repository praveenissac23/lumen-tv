// Playlist sources (Xtream Codes API and M3U), catalogue cache and EPG lookups.
import { http, catalog, cacheRead, cacheWrite } from './native.js';
import { setLocalEpg, importEpg, nowNext as epgNowNext, progs as epgProgs, clearEpgCache, searchProgrammes } from './epg.js';
import { norm, cleanName, now, bsearch, tagOf, qualityOf } from './util.js';
import { activePlaylist, S, setting } from './store.js';
import { demoCatalog, demoEpg } from './demo.js';

export const C = {
  ready: false,
  source: null,
  live: [], movie: [], series: [],
  cats: { live: [], movie: [], series: [] },
  catMap: { live: new Map(), movie: new Map(), series: new Map() },
  byId: { live: new Map(), movie: new Map(), series: new Map() },
  byEpg: new Map(),   // epg channel id -> first live channel using it
  info: {},           // account info for settings screen
  updatedAt: 0,
};

const ADULT = /\bxxx\b|\badult|18\s*\+|\bporn/i;

// Per-section hydration: normalise names for search and index by id.
function hydrateSection(k, items) {
  C[k] = items || [];
  C.byId[k] = new Map();
  for (const it of C[k]) { it.n = norm(it.name); C.byId[k].set(String(it.id), it); }
  if (k === 'live') { C.byEpg = new Map(); for (const it of C[k]) if (it.epg && !C.byEpg.has(it.epg)) C.byEpg.set(it.epg, it); }
}
function hydrateCats(cats) {
  for (const k of ['live', 'movie', 'series']) {
    C.cats[k] = (cats && cats[k]) || [];
    C.catMap[k] = new Map(C.cats[k].map((c) => [c.id, c]));
    for (const c of C.cats[k]) c.adult = ADULT.test(c.raw || c.name);
  }
}
function hydrate(raw) {
  hydrateCats(raw.cats);
  for (const k of ['live', 'movie', 'series']) hydrateSection(k, raw[k]);
  C.info = raw.info || {};
  C.updatedAt = raw.updatedAt || 0;
  C.ready = true;
}

// Cache files: meta (small) + one file per section, so the home screen can show
// channels before films and series are parsed.
const strip = (arr) => arr.map(({ n, ...rest }) => rest);
function writeSection(pl, k) { cacheWrite(`cat-${k}:${pl.id}`, JSON.stringify(strip(C[k]))); }
function writeMeta(pl) { cacheWrite('cat-meta:' + pl.id, JSON.stringify({ cats: C.cats, info: C.info, updatedAt: C.updatedAt, finished: pl.type !== 'xtream', counts: { live: C.live.length, movie: C.movie.length, series: C.series.length } })); }
// Section files hold compact provider records (Xtream) or finished items (M3U).
function readSection(pl, kind, finished) {
  const raw = readJson(`cat-${kind}:${pl.id}`, []);
  return finished ? raw : raw.map((o) => finishItem(o, kind)).filter(Boolean);
}
function readJson(key, fallback) {
  const raw = cacheRead(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ---------- boot: cache first, network second ----------
// Returns true when channels are usable. Films and series are parsed afterwards
// (onMore is called when they are in), so start-up stays quick on big playlists.
export function loadFromCache(onMore) {
  const pl = activePlaylist();
  if (!pl) {
    hydrate(demoCatalog());
    setLocalEpg(demoEpg(C.live));
    C.source = { type: 'demo', name: 'Demo channels' };
    return true;
  }
  C.source = pl;
  const meta = readJson('cat-meta:' + pl.id, null);
  if (!meta) return false;
  hydrateCats(meta.cats);
  C.info = meta.info || {};
  C.updatedAt = meta.updatedAt || 0;
  const live = readSection(pl, 'live', meta.finished);
  live.forEach((ch, i) => { if (!ch.num) ch.num = i + 1; });
  hydrateSection('live', live);
  if (!C.live.length) return false;
  C.ready = true;
  // films and series a moment later, off the critical path
  setTimeout(() => {
    hydrateSection('movie', readSection(pl, 'movie', meta.finished));
    setTimeout(() => {
      hydrateSection('series', readSection(pl, 'series', meta.finished));
      const want = meta.counts || {};
      const missing = (want.movie && !C.movie.length) || (want.series && !C.series.length);
      if (missing) C.updatedAt = 0;   // a section file is gone: fetch again
      onMore && onMore(missing ? 'missing' : 'vod');
    }, 0);
  }, 50);
  return true;
}

// Fetch the whole catalogue. Resolves when live channels are usable;
// films and series continue in the background (onPartial is called per section).
export async function refresh(onPartial) {
  const pl = activePlaylist();
  if (!pl) return;
  C.source = pl;
  if (pl.type === 'xtream') await refreshXtream(pl, onPartial);
  else await refreshM3u(pl, onPartial);
  C.updatedAt = Date.now();
  writeMeta(pl);
  refreshEpg(pl).then(() => onPartial && onPartial('epg')).catch(() => {});
}

export function catalogueAge() { return C.updatedAt ? Date.now() - C.updatedAt : Infinity; }

// ---------- Xtream Codes ----------
export function xBase(pl) {
  let s = (pl.server || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}
const xApi = (pl, q = '') =>
  `${xBase(pl)}/player_api.php?username=${encodeURIComponent(pl.user)}&password=${encodeURIComponent(pl.pass)}${q}`;
const xJson = async (pl, q) => JSON.parse(await http(xApi(pl, q), { timeout: 45000 }));

export async function testXtream(pl) {
  const r = await xJson(pl, '');
  if (!r.user_info || r.user_info.auth === 0) throw new Error('The server rejected this username or password');
  return r;
}

// Big lists are streamed natively into a compact cache file (see Catalog.kt).
// In a browser the JSON is fetched and reduced here instead.
async function fetchList(pl, action, kind) {
  const url = xApi(pl, '&action=' + action);
  const key = `cat-${kind}:${pl.id}`;
  const nativeJob = catalog(url, kind, key);
  let raw;
  if (nativeJob) { await nativeJob; raw = readJson(key, []); }
  else {
    const arr = JSON.parse(await http(url, { timeout: 120000 }));
    raw = (Array.isArray(arr) ? arr : []).map((o) => compactXtream(o, kind));
  }
  if (!nativeJob) cacheWrite(key, JSON.stringify(raw));   // native already wrote the file
  return raw.map((o) => finishItem(o, kind)).filter(Boolean);
}

const XF = {
  live: { stream_id: 'id', num: 'num', name: 'name', category_id: 'cat', stream_icon: 'logo', epg_channel_id: 'epg', tv_archive: 'arch', tv_archive_duration: 'archDays' },
  movie: { stream_id: 'id', name: 'name', category_id: 'cat', stream_icon: 'img', rating_5based: 'r5', rating: 'r', year: 'year', releaseDate: 'date', added: 'added', container_extension: 'ext' },
  series: { series_id: 'id', name: 'name', category_id: 'cat', cover: 'img', rating_5based: 'r5', releaseDate: 'date', release_date: 'date', last_modified: 'added', plot: 'plot', genre: 'genre' },
};
function compactXtream(o, kind) {
  const out = {};
  for (const [from, to] of Object.entries(XF[kind])) if (o[from] != null && o[from] !== '') out[to] = o[from];
  return out;
}
// Compact record -> the item shape the screens use.
function finishItem(o, kind) {
  if (o.id == null || !o.name) return null;
  const rawName = String(o.name);
  if (kind === 'live') {
    return { id: o.id, num: +o.num || 0, name: cleanName(rawName), tag: tagOf(rawName), cat: String(o.cat ?? ''), logo: o.logo || '', epg: o.epg || '',
      arch: +o.arch ? (+o.archDays || 3) : 0 };
  }
  if (kind === 'movie') {
    return { id: o.id, name: noYear(cleanName(rawName)), tag: tagOf(rawName), q: qualityOf(rawName), cat: String(o.cat ?? ''), img: o.img || '',
      rating: +o.r5 || (+o.r ? +o.r / 2 : 0), year: yearOf(rawName, o.year || o.date), added: +o.added || 0, ext: o.ext || 'mp4' };
  }
  return { id: o.id, name: noYear(cleanName(rawName)), tag: tagOf(rawName), cat: String(o.cat ?? ''), img: o.img || '', rating: +o.r5 || 0,
    year: yearOf(rawName, o.date), added: +o.added || 0, plot: String(o.plot || '').slice(0, 300), genre: o.genre || '' };
}

async function refreshXtream(pl, onPartial) {
  const acc = await testXtream(pl);
  const ui = acc.user_info || {};
  C.info = {
    status: ui.status, expires: ui.exp_date ? +ui.exp_date : null, maxConn: ui.max_connections,
    active: ui.active_cons, tz: acc.server_info?.timezone || null,
  };
  const [lc, live] = await Promise.all([xJson(pl, '&action=get_live_categories'), fetchList(pl, 'get_live_streams', 'live')]);
  live.forEach((ch, i) => { if (!ch.num) ch.num = i + 1; });
  hydrateCats({ live: mapCats(lc), movie: C.cats.movie, series: C.cats.series });
  hydrateSection('live', live);
  C.ready = true;
  onPartial && onPartial('live');

  const [vc, sc] = await Promise.all([xJson(pl, '&action=get_vod_categories'), xJson(pl, '&action=get_series_categories')]);
  hydrateCats({ live: C.cats.live, movie: mapCats(vc), series: mapCats(sc) });
  hydrateSection('movie', await fetchList(pl, 'get_vod_streams', 'movie'));
  hydrateSection('series', await fetchList(pl, 'get_series', 'series'));
  onPartial && onPartial('vod');
}

const noYear = (n) => n.replace(/\s*[([]?(19|20)\d{2}[)\]]?\s*$/, '').trim() || n;
const mapCats = (arr) => (arr || []).map((c) => ({ id: String(c.category_id), name: cleanName(c.category_name), raw: c.category_name || '' }));
function yearOf(name, date) {
  const m = /\b(19|20)\d{2}\b/.exec(String(date || '')) || /\((19|20)\d{2}\)/.exec(name || '');
  return m ? +m[0].replace(/\D/g, '') : 0;
}

export async function vodInfo(id) {
  const pl = activePlaylist();
  if (!pl || pl.type !== 'xtream') return null;
  const key = 'vod2:' + pl.id + ':' + id;
  const cached = cacheRead(key);
  if (cached) return JSON.parse(cached);
  const r = await xJson(pl, '&action=get_vod_info&vod_id=' + id);
  const i = r.info || {};
  const v = i.video || {};
  const out = { plot: i.plot || i.description || '', cast: i.cast || '', director: i.director || '', genre: i.genre || '',
    dur: i.duration || '', durSecs: +i.duration_secs || 0, backdrop: (i.backdrop_path || [])[0] || '', trailer: i.youtube_trailer || '',
    height: +v.height || 0, codec: v.codec_name || '', bitrate: +i.bitrate || 0, tmdb: i.tmdb_id || '', imdb: i.imdb_id || '' };
  cacheWrite(key, JSON.stringify(out));
  return out;
}

export async function seriesInfo(id) {
  const pl = activePlaylist();
  if (!pl) return demoSeriesInfo(id);
  if (pl.type !== 'xtream') return m3uSeriesInfo(id);
  const r = await xJson(pl, '&action=get_series_info&series_id=' + id);
  const seasons = {};
  for (const [sn, eps] of Object.entries(r.episodes || {})) {
    seasons[sn] = eps.map((e) => ({
      id: e.id, num: +e.episode_num, title: e.title || `Episode ${e.episode_num}`, ext: e.container_extension || 'mp4',
      plot: e.info?.plot || '', dur: e.info?.duration || '', img: e.info?.movie_image || '',
    }));
  }
  return { plot: r.info?.plot || '', cast: r.info?.cast || '', genre: r.info?.genre || '', backdrop: (r.info?.backdrop_path || [])[0] || '', seasons };
}

// ---------- M3U ----------
let m3uSeries = new Map();

async function refreshM3u(pl, onPartial) {
  const text = await http(pl.url, { timeout: 60000 });
  const parsed = parseM3u(text);
  if (!pl.epgUrl && parsed.epgUrl) pl.epgUrl = parsed.epgUrl;
  hydrate({ ...parsed, info: C.info, updatedAt: C.updatedAt });
  for (const k of ['live', 'movie', 'series']) writeSection(pl, k);
  onPartial && onPartial('live');
  onPartial && onPartial('vod');
}

export function parseM3u(text) {
  const lines = text.split(/\r?\n/);
  const live = [], movie = [], seriesMap = new Map();
  const cats = { live: new Map(), movie: new Map(), series: new Map() };
  let epgUrl = (/url-tvg="([^"]+)"/.exec(lines[0] || '') || /x-tvg-url="([^"]+)"/.exec(lines[0] || ''))?.[1] || '';
  epgUrl = epgUrl.split(',')[0];
  let cur = null, n = 0;
  const attr = (s, k) => (new RegExp(k + '="([^"]*)"').exec(s) || [])[1] || '';
  const catId = (kind, name) => {
    name = name || 'Uncategorised';
    if (!cats[kind].has(name)) cats[kind].set(name, { id: 'g' + cats[kind].size, name: cleanName(name), raw: name });
    return cats[kind].get(name).id;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf('",') >= 0 ? line.indexOf(',', line.lastIndexOf('"')) : line.indexOf(',');
      cur = {
        name: line.slice(comma + 1).trim(), logo: attr(line, 'tvg-logo'), epg: attr(line, 'tvg-id'),
        group: attr(line, 'group-title'), arch: +attr(line, 'catchup-days') || +attr(line, 'tvg-rec') || 0,
        catchupSrc: attr(line, 'catchup-source'),
      };
    } else if (line.startsWith('#EXTGRP:') && cur) {
      cur.group ||= line.slice(8).trim();
    } else if (!line.startsWith('#') && cur) {
      const url = line;
      const isSeries = /\/series\//i.test(url);
      const isMovie = !isSeries && (/\/movie\//i.test(url) || /\.(mp4|mkv|avi|mov)(\?|$)/i.test(url));
      if (isSeries) {
        const m = /^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})/i.exec(cur.name);
        const sname = cleanName(m ? m[1] : cur.name);
        let s = seriesMap.get(sname);
        if (!s) { s = { id: 's' + seriesMap.size, name: sname, cat: catId('series', cur.group), img: cur.logo, seasons: {} }; seriesMap.set(sname, s); }
        const sn = m ? +m[2] : 1;
        (s.seasons[sn] ||= []).push({ id: url, num: m ? +m[3] : s.seasons[sn].length + 1, title: cur.name, url, ext: '' });
      } else if (isMovie) {
        movie.push({ id: 'm' + movie.length, name: noYear(cleanName(cur.name)), tag: tagOf(cur.name), q: qualityOf(cur.name), cat: catId('movie', cur.group), img: cur.logo, url, rating: 0, year: yearOf(cur.name), added: movie.length });
      } else {
        live.push({ id: 'l' + live.length, num: ++n, name: cleanName(cur.name), tag: tagOf(cur.name), cat: catId('live', cur.group), logo: cur.logo, epg: cur.epg, arch: cur.arch, url, catchupSrc: cur.catchupSrc });
      }
      cur = null;
    }
  }
  m3uSeries = seriesMap;
  const series = [...seriesMap.values()].map(({ seasons, ...s }) => s);
  return {
    live, movie, series, epgUrl,
    cats: { live: [...cats.live.values()], movie: [...cats.movie.values()], series: [...cats.series.values()] },
  };
}

function m3uSeriesInfo(id) {
  const s = [...m3uSeries.values()].find((x) => x.id === id);
  return { plot: '', seasons: s ? s.seasons : {} };
}

// ---------- EPG ----------
export function epgUrlFor(pl) {
  return pl.type === 'xtream'
    ? `${xBase(pl)}/xmltv.php?username=${encodeURIComponent(pl.user)}&password=${encodeURIComponent(pl.pass)}`
    : pl.epgUrl;
}
export async function refreshEpg(pl, force = false) {
  const url = epgUrlFor(pl);
  if (!url) return 0;
  return importEpg(url, C.live, { force });
}
export const nowNext = epgNowNext;
export const progs = epgProgs;
export { bsearch, clearEpgCache, searchProgrammes };

// ---------- playback URLs ----------
export function liveUrl(ch) {
  if (ch.url) return ch.url;
  const pl = activePlaylist();
  if (!pl) return demoStreamUrl();
  const ext = setting('liveFormat') === 'm3u8' ? 'm3u8' : 'ts';
  return `${xBase(pl)}/live/${encodeURIComponent(pl.user)}/${encodeURIComponent(pl.pass)}/${ch.id}.${ext}`;
}
export function movieUrl(m) {
  if (m.url) return m.url;
  const pl = activePlaylist();
  if (!pl) return demoStreamUrl();
  return `${xBase(pl)}/movie/${encodeURIComponent(pl.user)}/${encodeURIComponent(pl.pass)}/${m.id}.${m.ext || 'mp4'}`;
}
export function episodeUrl(ep) {
  if (ep.url) return ep.url;
  const pl = activePlaylist();
  if (!pl) return demoStreamUrl();
  return `${xBase(pl)}/series/${encodeURIComponent(pl.user)}/${encodeURIComponent(pl.pass)}/${ep.id}.${ep.ext || 'mp4'}`;
}
// Catch-up (Xtream timeshift, or M3U catchup-source with {utc}/{duration} placeholders)
export function catchupUrl(ch, start, end) {
  const durMin = Math.max(1, Math.round((end - start) / 60));
  const realStart = start - off();
  if (ch.url) {
    if (!ch.catchupSrc) return ch.url + (ch.url.includes('?') ? '&' : '?') + `utc=${realStart}&lutc=${now()}`;
    return ch.catchupSrc.replace('{utc}', realStart).replace('{start}', realStart).replace('{duration}', durMin * 60)
      .replace('{utcend}', realStart + durMin * 60).replace('{lutc}', now());
  }
  const pl = activePlaylist();
  if (!pl) return demoStreamUrl();
  const tz = C.info.tz;
  const d = new Date(realStart * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const stamp = `${parts.year}-${parts.month}-${parts.day}:${parts.hour === '24' ? '00' : parts.hour}-${parts.minute}`;
  return `${xBase(pl)}/timeshift/${encodeURIComponent(pl.user)}/${encodeURIComponent(pl.pass)}/${durMin}/${stamp}/${ch.id}.ts`;
}

function demoStreamUrl() { return ''; }
function demoSeriesInfo(id) {
  const s = C.byId.series.get(String(id));
  const seasons = {};
  const n = s ? 2 + (s.name.length % 3) : 2;
  for (let sn = 1; sn <= n; sn++) {
    seasons[sn] = Array.from({ length: 6 + ((sn * 3) % 5) }, (_, i) => ({
      id: `${id}-${sn}-${i + 1}`, num: i + 1, title: EP_TITLES[(i + sn * 2 + (s?.name.length || 0)) % EP_TITLES.length],
      dur: `${42 + ((i * 7) % 15)} min`, plot: 'Episode summary from your provider appears here.', ext: 'mp4',
    }));
  }
  return { plot: s?.plot || '', genre: s?.genre || '', seasons };
}
const EP_TITLES = ['Arrival', 'The Long Night', 'Tidewater', 'Paper Crowns', 'Northbound', 'The Quiet Room', 'Open Water', 'Fault Lines',
  'Second Chances', 'Glass House', 'Homecoming', 'The Ledger', 'Low Tide', 'Smoke Signals', 'Last Light', 'The Vault'];

// ---------- helpers for screens ----------
export function visibleCats(kind) {
  return C.cats[kind].filter((c) => !S.hidden[`${kind}:${c.id}`]);
}
let langHook = () => [];
export function setLangHook(f) { langHook = f; }
export function itemsIn(kind, catId) {
  if (catId === '__all') return C[kind];
  if (catId.startsWith('__lang:')) return langHook(kind, catId.slice(7));
  if (catId === '__fav') return S.favs[kind].map((id) => C.byId[kind].get(id)).filter(Boolean);
  if (catId === '__recent') return S.recentLive.map((id) => C.byId.live.get(id)).filter(Boolean);
  return C[kind].filter((x) => x.cat === catId);
}
export function catOf(kind, id) { return C.catMap[kind].get(id) || null; }
export function needsPin(kind, catId) {
  const c = catOf(kind, catId);
  if (!c) return false;
  const locked = S.locked[`${kind}:${catId}`] || (c.adult && setting('lockAdult'));
  return !!locked;
}
