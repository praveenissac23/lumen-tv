// Playlist sources (Xtream Codes API and M3U), catalogue cache and EPG lookups.
import { http, xmltv, cacheRead, cacheWrite } from './native.js';
import { norm, cleanName, now, bsearch, tagOf, qualityOf } from './util.js';
import { activePlaylist, S, setting } from './store.js';
import { demoCatalog, demoEpg } from './demo.js';

export const C = {
  ready: false,
  source: null,
  live: [], movie: [], series: [],
  cats: { live: [], movie: [], series: [] },
  byId: { live: new Map(), movie: new Map(), series: new Map() },
  epg: {},            // epgId -> [[start, end, title, desc], ...] sorted
  info: {},           // account info for settings screen
  updatedAt: 0,
};

const ADULT = /\bxxx\b|\badult|18\s*\+|\bporn/i;

function hydrate(raw) {
  for (const k of ['live', 'movie', 'series']) {
    C[k] = raw[k] || [];
    C.byId[k] = new Map();
    for (const it of C[k]) { it.n = norm(it.name); C.byId[k].set(String(it.id), it); }
    C.cats[k] = raw.cats?.[k] || [];
    for (const c of C.cats[k]) c.adult = ADULT.test(c.name);
  }
  C.info = raw.info || {};
  C.updatedAt = raw.updatedAt || 0;
  C.ready = true;
}

function serialise() {
  const strip = (arr) => arr.map(({ n, ...rest }) => rest);
  return JSON.stringify({ live: strip(C.live), movie: strip(C.movie), series: strip(C.series), cats: C.cats, info: C.info, updatedAt: C.updatedAt });
}

// ---------- boot: cache first, network second ----------
export function loadFromCache() {
  const pl = activePlaylist();
  if (!pl) {
    hydrate(demoCatalog());
    C.epg = demoEpg(C.live);
    C.source = { type: 'demo', name: 'Demo channels' };
    return true;
  }
  C.source = pl;
  const raw = cacheRead('cat:' + pl.id);
  if (!raw) return false;
  try { hydrate(JSON.parse(raw)); } catch { return false; }
  try { C.epg = JSON.parse(cacheRead('epg:' + pl.id) || '{}'); } catch { C.epg = {}; }
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
  cacheWrite('cat:' + pl.id, serialise());
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

async function refreshXtream(pl, onPartial) {
  const acc = await testXtream(pl);
  const ui = acc.user_info || {};
  C.info = {
    status: ui.status, expires: ui.exp_date ? +ui.exp_date : null, maxConn: ui.max_connections,
    active: ui.active_cons, tz: acc.server_info?.timezone || null,
  };
  const [lc, ls] = await Promise.all([xJson(pl, '&action=get_live_categories'), xJson(pl, '&action=get_live_streams')]);
  const cats = { live: mapCats(lc), movie: C.cats.movie, series: C.cats.series };
  const live = (ls || []).map((s, i) => ({
    id: s.stream_id, num: +s.num || i + 1, name: cleanName(s.name), tag: tagOf(s.name), cat: String(s.category_id ?? ''),
    logo: s.stream_icon || '', epg: s.epg_channel_id || '', arch: +s.tv_archive ? +s.tv_archive_duration || 3 : 0,
  }));
  hydrate({ live, movie: C.movie, series: C.series, cats, info: C.info, updatedAt: C.updatedAt });
  onPartial && onPartial('live');

  const [vc, vs, sc, ss] = await Promise.all([
    xJson(pl, '&action=get_vod_categories'), xJson(pl, '&action=get_vod_streams'),
    xJson(pl, '&action=get_series_categories'), xJson(pl, '&action=get_series'),
  ]);
  cats.movie = mapCats(vc);
  cats.series = mapCats(ss && sc ? sc : []);
  const movie = (vs || []).map((v) => ({
    id: v.stream_id, name: noYear(cleanName(v.name)), tag: tagOf(v.name), q: qualityOf(v.name), cat: String(v.category_id ?? ''), img: v.stream_icon || '',
    rating: +v.rating_5based || (+v.rating ? +v.rating / 2 : 0), year: yearOf(v.name, v.year || v.releaseDate),
    added: +v.added || 0, ext: v.container_extension || 'mp4',
  }));
  const series = (ss || []).map((v) => ({
    id: v.series_id, name: noYear(cleanName(v.name)), tag: tagOf(v.name), cat: String(v.category_id ?? ''), img: v.cover || '',
    rating: +v.rating_5based || 0, year: yearOf(v.name, v.releaseDate || v.release_date),
    added: +v.last_modified || 0, plot: (v.plot || '').slice(0, 300), genre: v.genre || '',
  }));
  hydrate({ live: C.live, movie, series, cats, info: C.info, updatedAt: C.updatedAt });
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
  hydrate(parsed);
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
export async function refreshEpg(pl, force = false) {
  const age = Date.now() - (+cacheRead('epgAt:' + pl.id) || 0);
  if (!force && age < 6 * 3600 * 1000 && Object.keys(C.epg).length) return;
  const url = pl.type === 'xtream'
    ? `${xBase(pl)}/xmltv.php?username=${encodeURIComponent(pl.user)}&password=${encodeURIComponent(pl.pass)}`
    : pl.epgUrl;
  if (!url) return;
  const t = now();
  await xmltv(url, 'epg:' + pl.id, t - 3 * 86400, t + 2 * 86400);
  C.epg = JSON.parse(cacheRead('epg:' + pl.id) || '{}');
  cacheWrite('epgAt:' + pl.id, String(Date.now()));
  searchProgIndex = null;
}

const off = () => (setting('epgOffsetHours') || 0) * 3600;

export function progs(ch) {
  const list = ch && C.epg[ch.epg || ch.id];
  if (!list || !list.length) return [];
  const o = off();
  return o ? list.map((p) => [p[0] + o, p[1] + o, p[2], p[3]]) : list;
}

// { now: {s,e,t,d,pct}, next: {...} } or null
export function nowNext(ch, at = now()) {
  const list = progs(ch);
  if (!list.length) return null;
  const i = bsearchArr(list, at);
  const cur = i >= 0 && list[i][1] > at ? list[i] : null;
  const nxt = list[cur ? i + 1 : Math.max(0, i + 1)] || null;
  const mk = (p) => p && { s: p[0], e: p[1], t: p[2], d: p[3] || '', pct: Math.min(1, Math.max(0, (at - p[0]) / (p[1] - p[0]))) };
  return { now: mk(cur), next: mk(nxt && nxt[0] >= at - 60 ? nxt : null) };
}

function bsearchArr(list, t) {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
export { bsearch };

// Programme index for master search (built lazily, next 24 h + last 3 days for catch-up)
let searchProgIndex = null;
export function programmeIndex() {
  if (searchProgIndex) return searchProgIndex;
  const t = now();
  const out = [];
  for (const ch of C.live) {
    const list = progs(ch);
    if (!list.length) continue;
    const from = ch.arch ? t - ch.arch * 86400 : t - 3600;
    for (const p of list) {
      if (p[1] < from || p[0] > t + 86400) continue;
      out.push({ ch, s: p[0], e: p[1], t: p[2], d: p[3] || '', n: norm(p[2]) });
    }
  }
  searchProgIndex = out;
  return out;
}
export function resetProgrammeIndex() { searchProgIndex = null; }

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
export function catOf(kind, id) { return C.cats[kind].find((c) => c.id === id) || null; }
export function needsPin(kind, catId) {
  const c = catOf(kind, catId);
  if (!c) return false;
  const locked = S.locked[`${kind}:${catId}`] || (c.adult && setting('lockAdult'));
  return !!locked;
}
