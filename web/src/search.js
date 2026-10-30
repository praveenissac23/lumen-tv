// Master search across channels, programmes (EPG), films and series.
// Tolerant of typos, quality tags, word order and spoken numbers.
import { C, programmeIndex } from './data.js';
import { norm, now } from './util.js';
import { S } from './store.js';

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3 };
const COMMANDS = /^(please\s+)?(play|watch|open|show( me)?|search( for)?|find|put on|switch to|tune to|go to|turn on|i want to watch)\s+/;
const FILLER = /\b(the channel|channel|the movie|movie|film|the series|series|tv show|show)\s*$/;

// Turn a spoken phrase into { q, intent, number }
export function parseSpoken(text) {
  let t = norm(text);
  let intent = 'search';
  const m = COMMANDS.exec(t);
  if (m) { if (/play|watch|put on|switch|tune|turn on|want/.test(m[2])) intent = 'play'; t = t.slice(m[0].length); }
  t = t.replace(FILLER, '').trim();
  t = t.split(' ').map((w) => (w in NUM_WORDS ? String(NUM_WORDS[w]) : w)).join(' ');
  const num = /^(channel\s+)?(\d{1,5})$/.exec(t);
  return { q: t, intent, number: num ? +num[2] : null };
}

function lev1(a, b, max) {
  // bounded Damerau-Levenshtein, early exit
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1), cur = new Array(b.length + 1), pp = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v; if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) { pp[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}

function words(it) { return it.w || (it.w = it.n.split(' ')); }

export function score(it, q, qt) {
  const n = it.n;
  if (!n) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 850 - Math.min(80, n.length - q.length);
  const w = words(it);
  let prefixAll = true, containAll = true, fuzzyAll = true, firstWordHit = false;
  for (let i = 0; i < qt.length; i++) {
    const t = qt[i];
    let p = false, c = false, f = false;
    for (let j = 0; j < w.length; j++) {
      const x = w[j];
      if (x.startsWith(t)) { p = c = f = true; if (j === 0 && i === 0) firstWordHit = true; break; }
      if (!c && x.includes(t)) c = true;
      if (!f && t.length >= 4) {
        const max = t.length >= 7 ? 2 : 1;
        if (lev1(t, x.slice(0, t.length + 1), max) <= max || lev1(t, x, max) <= max) f = true;
      }
    }
    if (!p) prefixAll = false;
    if (!c && !p) containAll = false;
    if (!f && !c && !p) fuzzyAll = false;
    if (!fuzzyAll) return n.includes(q) ? 400 : 0;
  }
  if (prefixAll) return (firstWordHit ? 700 : 620) - Math.min(60, w.length * 4);
  if (n.includes(q)) return 420;
  if (containAll) return 320;
  if (fuzzyAll) return 170;
  return 0;
}

function top(list, q, qt, limit, boost) {
  const out = [];
  let min = 0;
  for (const it of list) {
    let s = score(it, q, qt);
    if (!s) continue;
    if (boost) s += boost(it);
    if (out.length < limit) { out.push([s, it]); if (out.length === limit) { out.sort((a, b) => b[0] - a[0]); min = out[limit - 1][0]; } }
    else if (s > min) { out[limit - 1] = [s, it]; out.sort((a, b) => b[0] - a[0]); min = out[limit - 1][0]; }
  }
  return out.sort((a, b) => b[0] - a[0]);
}

export function search(raw, { limit = 24 } = {}) {
  const parsed = parseSpoken(raw);
  const q = parsed.q;
  const empty = { q, intent: parsed.intent, best: null, live: [], progs: [], movie: [], series: [], total: 0 };
  if (!q) return empty;
  const qt = q.split(' ').filter(Boolean);
  const t0 = performance.now();
  const favLive = new Set(S.favs.live), recent = new Set(S.recentLive);

  let live = top(C.live, q, qt, limit, (ch) => (favLive.has(String(ch.id)) ? 60 : 0) + (recent.has(String(ch.id)) ? 30 : 0));
  if (parsed.number != null) {
    const ch = C.live.find((c) => c.num === parsed.number);
    if (ch) live = [[1200, ch], ...live.filter(([, c]) => c !== ch)];
  }
  const t = now();
  const progs = top(programmeIndex(), q, qt, limit * 2, (p) => (p.s <= t && p.e > t ? 80 : p.s > t ? 40 - Math.min(40, (p.s - t) / 3600) : 0))
    .filter(([, p], i, arr) => arr.findIndex(([, x]) => x.ch === p.ch && x.s === p.s) === i)
    .slice(0, limit);
  const movie = top(C.movie, q, qt, limit);
  const series = top(C.series, q, qt, limit);

  const cands = [
    live[0] && { kind: 'live', s: live[0][0] + 5, item: live[0][1] },
    progs[0] && { kind: 'prog', s: progs[0][0] - 10, item: progs[0][1] },
    movie[0] && { kind: 'movie', s: movie[0][0], item: movie[0][1] },
    series[0] && { kind: 'series', s: series[0][0], item: series[0][1] },
  ].filter(Boolean).sort((a, b) => b.s - a.s);

  return {
    q, intent: parsed.intent, ms: performance.now() - t0,
    best: cands[0] && cands[0].s >= 600 ? cands[0] : null,
    live: live.map((x) => x[1]), progs: progs.map((x) => x[1]), movie: movie.map((x) => x[1]), series: series.map((x) => x[1]),
    total: live.length + progs.length + movie.length + series.length,
  };
}

// Quick suggestions while typing (top names only)
export function suggest(raw, n = 6) {
  const r = search(raw, { limit: 6 });
  const names = [];
  for (const it of [...r.live, ...r.movie, ...r.series, ...r.progs]) {
    const name = it.name || it.t;
    if (!names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name);
    if (names.length >= n) break;
  }
  return names;
}
