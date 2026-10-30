// Programme guide access. The data lives in a native database (or, in a browser, in memory);
// screens ask for the channels on screen and are patched when answers arrive ('epg' event).
import * as N from './native.js';
import { now } from './util.js';
import { setting } from './store.js';

const nowCache = new Map();    // epg key -> { cur: [s,e,t,d]|null, nxt: [..]|null, at }
const rangeCache = new Map();  // epg key -> { from, to, list: [[s,e,t,d], ...] }
let local = null;              // browser/M3U fallback: { key: [[s,e,t,d], ...] }
let pendingNow = new Set(), pendingRange = new Set(), inflight = new Set(), timer = null;

export const epgKey = (ch) => String(ch.epg || ch.id);
const off = () => (setting('epgOffsetHours') || 0) * 3600;
const shift = (p) => (p ? [p[0] + off(), p[1] + off(), p[2], p[3] || ''] : null);

export function setLocalEpg(map) { local = map || null; clearEpgCache(); }
export function hasLocalEpg() { return !!local; }
export function clearEpgCache() { nowCache.clear(); rangeCache.clear(); inflight.clear(); pendingNow.clear(); pendingRange.clear(); notify(); }

function notify() { document.dispatchEvent(new CustomEvent('epg')); }

// ---------- backend ----------
function localNow(ids, at) {
  const out = {};
  for (const id of ids) {
    const list = local[id] || [];
    let cur = null, nxt = null;
    for (const p of list) { if (p[0] <= at && p[1] > at) cur = p; else if (p[0] > at) { nxt = p; break; } }
    out[id] = [cur, nxt];
  }
  return out;
}
function localRange(ids, from, to) {
  const out = {};
  for (const id of ids) out[id] = (local[id] || []).filter((p) => p[1] > from && p[0] < to);
  return out;
}
async function backendNow(ids, at) {
  if (local) return localNow(ids, at);
  if (!N.isNative) return {};
  return JSON.parse(await N.epgNow(ids.join(','), at));
}
async function backendRange(ids, from, to) {
  if (local) return localRange(ids, from, to);
  if (!N.isNative) return {};
  return JSON.parse(await N.epgRange(ids.join(','), from, to));
}

// Title search for the master search: [{key, s, e, t, d}] inside the window.
export async function searchProgrammes(q, from, to, limit = 60) {
  if (local) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const [key, list] of Object.entries(local)) {
      for (const p of list) {
        if (p[1] <= from || p[0] >= to) continue;
        const t = p[2].toLowerCase();
        if (words.every((w) => t.includes(w))) out.push({ key, s: p[0] + off(), e: p[1] + off(), t: p[2], d: p[3] || '' });
      }
      if (out.length > limit * 4) break;
    }
    return out.sort((a, b) => a.s - b.s).slice(0, limit);
  }
  if (!N.isNative) return [];
  const rows = JSON.parse(await N.epgSearch(q, from - off(), to - off(), limit));
  return rows.map(([key, s, e, t, d]) => ({ key, s: s + off(), e: e + off(), t, d }));
}

// ---------- batched fetching ----------
function schedule() { if (!timer) timer = setTimeout(flush, 30); }
async function flush() {
  timer = null;
  const nowIds = [...pendingNow].filter((k) => !inflight.has('n' + k)).slice(0, 60);
  const rangeIds = [...pendingRange].filter((k) => !inflight.has('r' + k)).slice(0, 12);
  nowIds.forEach((k) => { pendingNow.delete(k); inflight.add('n' + k); });
  rangeIds.forEach((k) => { pendingRange.delete(k); inflight.add('r' + k); });
  if (pendingNow.size || pendingRange.size) schedule();
  const t = now() - off();
  const jobs = [];
  if (nowIds.length) jobs.push(backendNow(nowIds, t).then((r) => {
    for (const k of nowIds) { const v = r[k] || [null, null]; nowCache.set(k, { cur: v[0] || null, nxt: v[1] || null, at: Date.now() }); }
  }).catch(() => { for (const k of nowIds) nowCache.set(k, { cur: null, nxt: null, at: Date.now(), failed: true }); })
    .finally(() => nowIds.forEach((k) => inflight.delete('n' + k))));
  if (rangeIds.length) {
    const from = t - 36 * 3600, to = t + 48 * 3600;
    jobs.push(backendRange(rangeIds, from, to).then((r) => {
      for (const k of rangeIds) rangeCache.set(k, { from, to, list: r[k] || [], at: Date.now() });
    }).catch(() => { for (const k of rangeIds) rangeCache.set(k, { from: t, to: t, list: [], at: Date.now(), failed: true }); })
      .finally(() => rangeIds.forEach((k) => inflight.delete('r' + k))));
  }
  if (jobs.length) { await Promise.all(jobs); notify(); }
}

const STALE = 10 * 60 * 1000;

// Synchronous: answers from cache, requests what is missing.
// Returns { now: {s,e,t,d,pct}|null, next: {...}|null } or null while unknown.
export function nowNext(ch, at = now()) {
  const k = epgKey(ch);
  const mk = (p) => p && { s: p[0], e: p[1], t: p[2], d: p[3] || '', pct: Math.min(1, Math.max(0, (at - p[0]) / (p[1] - p[0]))) };
  const r = rangeCache.get(k);
  if (r && r.list.length && at - off() >= r.from && at - off() <= r.to) {
    const list = r.list;
    let cur = null, nxt = null;
    for (let i = 0; i < list.length; i++) { const p = shift(list[i]); if (p[0] <= at && p[1] > at) { cur = p; nxt = shift(list[i + 1]); break; } if (p[0] > at) { nxt = p; break; } }
    return { now: mk(cur), next: mk(nxt) };
  }
  const e = nowCache.get(k);
  if (e) {
    const cur = shift(e.cur), nxt = shift(e.nxt);
    const fresh = Date.now() - e.at < STALE && (!cur || cur[1] > at) && (!nxt || !cur || nxt[0] >= at - 60);
    if (fresh) return (cur || nxt) ? { now: cur && cur[1] > at ? mk(cur) : null, next: mk(nxt && nxt[0] > at ? nxt : (cur && cur[1] <= at ? null : nxt)) } : (e.failed ? null : { now: null, next: null });
  }
  if (!inflight.has('n' + k)) { pendingNow.add(k); schedule(); }
  return e && e.cur ? { now: mk(shift(e.cur)), next: mk(shift(e.nxt)) } : null;
}

// Synchronous: the channel's programmes for the -36h..+48h window (empty until fetched).
export function progs(ch) {
  const k = epgKey(ch);
  const r = rangeCache.get(k);
  if (r && Date.now() - r.at < 30 * 60 * 1000) return r.list.map(shift);
  if (!inflight.has('r' + k)) { pendingRange.add(k); schedule(); }
  return r ? r.list.map(shift) : [];
}
export function hasProgs(ch) { return rangeCache.has(epgKey(ch)); }

// Ask for several channels at once (e.g. the guide's visible rows).
export function prefetchRanges(chs) { for (const ch of chs) { const k = epgKey(ch); if (!rangeCache.has(k) && !inflight.has('r' + k)) pendingRange.add(k); } if (pendingRange.size) schedule(); }
export function prefetchNow(chs) { for (const ch of chs) { const k = epgKey(ch); if (!nowCache.has(k) && !rangeCache.has(k) && !inflight.has('n' + k)) pendingNow.add(k); } if (pendingNow.size) schedule(); }

// ---------- import ----------
export function epgInfo() {
  if (local) return { count: Object.keys(local).length, importedAt: Date.now(), importing: false };
  if (!N.isNative) return { count: 0, importedAt: 0, importing: false };
  try { return JSON.parse(N.epgInfoRaw()); } catch { return { count: 0, importedAt: 0, importing: false }; }
}

// Download the guide for this playlist's channels into the native database.
export async function importEpg(url, channels, { force = false } = {}) {
  if (!N.isNative) {
    // browser: parse in memory (test/demo only)
    const xml = await N.http(url, { timeout: 120000 });
    setLocalEpg(N.parseXmltvText(xml, now() - 36 * 3600, now() + 48 * 3600));
    return Object.keys(local).length;
  }
  if (local) { local = null; clearEpgCache(); }   // leave the demo guide behind
  const info = epgInfo();
  if (!force && info.importing) return 0;
  if (!force && info.count > 0 && Date.now() - info.importedAt < 6 * 3600 * 1000) return info.count;
  const ids = [...new Set(channels.map((c) => c.epg).filter(Boolean))].join(',');
  const t = now();
  const n = await N.epgImport(url, t - 36 * 3600, t + 48 * 3600, ids);
  clearEpgCache();
  return n;
}

N.on('epg', (d) => { if (d.state === 'ready') { local = null; clearEpgCache(); } });
