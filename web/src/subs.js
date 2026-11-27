// Online subtitles from OpenSubtitles.com: search by exact file hash (perfect sync) and by title,
// pick the preferred language automatically, or let the viewer choose.
import * as N from './native.js';
import { setting } from './store.js';
import { LANGS } from './languages.js';

const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'LumenTV v1.0';

export const SUB_LANGS = [
  ['en', 'English'], ['ml', 'Malayalam'], ['ta', 'Tamil'], ['hi', 'Hindi'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ar', 'Arabic'],
  ['bn', 'Bengali'], ['ur', 'Urdu'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['pt', 'Portuguese'], ['tl', 'Filipino'],
];
export const langName = (iso) => (SUB_LANGS.find((l) => l[0] === iso) || LANGS.find((l) => l.iso === iso) || [iso, iso])[1] || iso;

function headers() {
  return { 'Api-Key': setting('osKey'), 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' };
}
export const hasKey = () => !!((setting('osKey') || '').trim() || (setting('subdlKey') || '').trim());
export const hasAutoProvider = () => !!(setting('subdlKey') || '').trim();

// Save the downloaded SRT under a stable title/language key. A replay can load
// it immediately, even after an app restart, without another provider download.
const subtitleIdentity = (item, lang) => ['subfile', String(item.title || '').toLowerCase().trim().slice(0,140),
  item.year || '', item.season || '', item.episode || '', lang].join(':');
const fileKey = (result) => result.source === 'OpenSubtitles' ? 'opensubtitles:' + result.fileId : result.source.toLowerCase() + ':' + result.url;
export function cachedSubtitle(item, lang) {
  try {
    const key = N.cacheRead?.(subtitleIdentity(item, lang));
    return key && N.cachedSubtitle?.(key) || '';
  } catch { return ''; }
}
export async function rememberSubtitle(item, lang, result, url) {
  const key = fileKey(result);
  const uri = await N.prepareSubtitle(url, key);
  if (uri) N.cacheWrite?.(subtitleIdentity(item, lang), key);
  return uri;
}

// item: {title, year, season, episode, url}
export async function searchSubs(item, langs = setting('subLangs'), { automatic = false } = {}) {
  if (!hasKey()) throw new Error('NO_KEY');
  const osKey = automatic ? '' : (setting('osKey') || '').trim();
  const sdKey = (setting('subdlKey') || '').trim();
  const q = new URLSearchParams();
  q.set('languages', (langs && langs.length ? langs : ['en']).join(','));
  const results = [];
  const run = async (params) => {
    const text = await N.call('GET', `${API}/subtitles?${params}`, headers());
    const data = JSON.parse(text).data || [];
    for (const d of data) {
      const a = d.attributes || {}, f = (a.files || [])[0];
      if (!f || results.some((r) => r.source === 'OpenSubtitles' && r.fileId === f.file_id)) continue;
      results.push({ source: 'OpenSubtitles', fileId: f.file_id, lang: a.language, name: a.release || f.file_name || '', downloads: a.download_count || 0,
        hashMatch: !!a.moviehash_match, hi: !!a.hearing_impaired });
    }
  };
  const work = [];
  if (osKey) work.push((async () => {
    const p = new URLSearchParams(q);
    p.set('query', item.title);
    if (item.season) { p.set('season_number', item.season); p.set('episode_number', item.episode); p.set('type', 'episode'); }
    else { if (item.year) p.set('year', item.year); p.set('type', 'movie'); }
    const titleSearch = run(p);
    const exactSearch = item.url ? (async () => {
      let timer;
      const hash = await Promise.race([
        N.subtitleHash(item.url).catch(() => null),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 3500); }),
      ]);
      clearTimeout(timer);
      if (!hash) return;
      const byHash = new URLSearchParams(q); byHash.set('moviehash', hash.hash);
      await run(byHash).catch(() => {});
    })() : Promise.resolve();
    await Promise.all([titleSearch, exactSearch]);
  })());
  if (sdKey) work.push((async () => {
    const p = new URLSearchParams({ api_key: sdKey, languages: (langs?.length ? langs : ['en']).join(',').toUpperCase(),
      unpack: '1', subs_per_page: '30', client: 'custom_integration' });
    if (item.title) p.set('film_name', item.title);
    else p.set('file_name', new URL(item.url).pathname.split('/').pop());
    if (item.season) {
      p.set('type', 'tv'); p.set('season_number', item.season); p.set('episode_number', item.episode);
    } else { p.set('type', 'movie'); if (item.year) p.set('year', item.year); }
    const data = JSON.parse(await N.call('GET', 'https://api.subdl.com/api/v1/subtitles?' + p, { Accept: 'application/json' }));
    if (data.status === false) throw new Error(data.error || 'SubDL search failed');
    for (const sub of data.subtitles || []) {
      // The unpack endpoint provides a direct subtitle file; a ZIP cannot be
      // handed to the TV player as an external text track.
      for (const f of sub.unpack_files || []) {
        if (!/^\/subtitle\/[\w/-]+$/.test(f.url || '')) continue;
        if (String(f.format || 'srt').toLowerCase() !== 'srt') continue;
        if (item.episode && +f.episode && +f.episode !== +item.episode) continue;
        results.push({ source: 'SubDL', url: 'https://dl.subdl.com' + f.url,
          lang: String(f.language || '').toLowerCase(), name: f.release_name || f.name || sub.release_name || '',
          downloads: 0, hashMatch: false, hi: !!f.hi, nId: f.url.split('/')[2], fileNId: f.file_n_id || f.url.split('/')[3] });
      }
    }
  })());
  const settled = await Promise.all(work.map((p) => p.then((value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }))));
  if (!results.length && settled.every((x) => x.status === 'rejected')) throw settled[0].reason;
  // Exact file matches first, then the order of preferred languages, then popularity.
  const order = (l) => { const i = (langs || []).indexOf(l); return i < 0 ? 99 : i; };
  results.sort((x, y) => (y.hashMatch - x.hashMatch) || (order(x.lang) - order(y.lang)) ||
    (x.source === 'SubDL' ? -1 : 1) - (y.source === 'SubDL' ? -1 : 1) || (y.downloads - x.downloads));
  return results;
}

// ---------- SubtitleCat (no account or key needed) ----------
// Search by title, keep only results that really are this film / this episode, open the best few
// pages and take the ready-made SRT in the wanted language.
const CAT = 'https://www.subtitlecat.com/';
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const norm = (v) => String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const two = (n) => String(n).padStart(2, '0');

// What to search for: the bare title, plus year / season / episode read from the item or its name.
export function subtitleTarget(item) {
  let raw = String(item.title || '').replace(/\.(mkv|mp4|avi|m4v|ts|mov|wmv)$/i, '').replace(/^www\.[^ ]+\s*-\s*/i, '');
  const ep = /\bS(\d{1,2})[ ._-]?E(?:P)?[ ._-]?\(?(\d{1,3})\b/i.exec(raw) || /\bS(\d{1,2})\s*EP\s*\(?(\d{1,3})/i.exec(raw);
  const season = +item.season || (ep ? +ep[1] : 0), episode = +item.episode || (ep ? +ep[2] : 0);
  const yr = /[\[(]((?:19|20)\d{2})[\])]/.exec(raw) || /\b((?:19|20)\d{2})\b(?!.*\b(?:19|20)\d{2}\b)/.exec(raw.replace(/^\s*(?:19|20)\d{2}\b/, ''));
  const year = /^(?:19|20)\d{2}$/.test(String(item.year || '')) ? +item.year : (yr ? +yr[1] : 0);
  let title = raw
    .replace(/^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2,4}\s*[:|]|[A-Z]{2,4}\s+-)\s*/, '')
    .replace(/\bS\d{1,2}[ ._-]?E(?:P)?[ ._-]?\(?\d{1,3}.*$/i, '').replace(/\bS\d{1,2}\s*EP\b.*$/i, '')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4K|UHD|FHD|HDR|HEVC|x26[45]|H\.?26[45]|WEB-?DL|WEBRip|BluRay|BRRip|HDRip|TRUE|MULTI|DUAL|AUDIO|10bit|AAC|AVC|DDP?5\.1)\b.*$/i, ' ')
    .replace(/[._]+/g, ' ');
  if (year) title = title.replace(new RegExp('\\b' + year + '\\b.*$'), ' ');
  title = title.replace(/[-–|:]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title: title || raw.trim(), year, season, episode };
}

// Rank the search results; anything that is clearly another title, year or episode is dropped.
export function subtitleCatCandidates(html, target) {
  const want = norm(target.title);
  if (!want) return [];
  const words = want.split(' ');
  const seen = new Set(), out = [];
  const re = /href=["'](?:https?:\/\/(?:www\.)?subtitlecat\.com)?\/?(subs\/\d+\/[^"'<>]+?\.html)["']/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const page = m[1];
    if (seen.has(page)) continue;
    seen.add(page);
    let name = page.split('/').pop().replace(/\.html$/i, '');
    try { name = decodeURIComponent(name); } catch (e) { /* keep as is */ }
    const n = norm(name);
    const starts = n === want || n.startsWith(want + ' ');
    if (!starts && !words.every((w) => (' ' + n + ' ').includes(' ' + w + ' '))) continue;
    const epTag = /\bs(\d{1,2}) ?e(\d{1,3})\b/.exec(n);
    if (target.episode) {
      if (!epTag || +epTag[2] !== target.episode || (target.season && +epTag[1] !== target.season)) continue;
    } else if (epTag) continue;
    const years = (n.slice(want.length).match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    if (!target.episode && target.year && years.length && !years.some((y) => Math.abs(y - target.year) <= 1)) continue;
    // a longer title that merely begins with ours ("Alien" vs "Alien Romulus") only counts when the year agrees
    const rest = starts ? n.slice(want.length).trim() : '';
    const exact = starts && (!rest || /^(?:(?:19|20)\d{2}|s\d{1,2} ?e\d|\d{3,4}p|bluray|brrip|web|hdrip|dvdrip|extended|remastered|unrated|proper|repack|en|eng|english)\b/.test(rest));
    const score = (exact ? 4 : 0) + (starts ? 1 : 0) + (target.year && years.includes(target.year) ? 3 : 0) - i * 0.01;
    out.push({ page, score }); i++;
  }
  return out.sort((x, y) => y.score - x.score).map((x) => x.page);
}

export function subtitleCatLink(detail, lang) {
  const hrefs = [];
  const re = /href=["']([^"']+?\.srt(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(detail))) hrefs.push(m[1]);
  const path = (h) => { try { return new URL(h, CAT); } catch (e) { return null; } };
  const ok = (u) => u && /(^|\.)subtitlecat\.com$/.test(u.hostname) && /^\/subs\/\d+\//.test(u.pathname);
  const byName = hrefs.map(path).find((u) => ok(u) && new RegExp('-' + lang + '\\.srt$', 'i').test(u.pathname));
  if (byName) return byName.href.replace(/^http:/, 'https:');
  const anchor = (detail.match(/<a\b[^>]*>/gi) || []).find((x) => new RegExp('download_' + lang + '\\b').test(x));
  const link = anchor && /\bhref=["']([^"']+\.srt(?:\?[^"']*)?)["']/i.exec(anchor);
  const u = link && path(link[1]);
  return ok(u) ? u.href.replace(/^http:/, 'https:') : '';
}

const catMemo = new Map();
export function subtitleCatExisting(item, lang = 'en') {
  const t = subtitleTarget(item);
  const key = [norm(t.title), t.year, t.season, t.episode, lang].join('|');
  if (!catMemo.has(key)) {
    const p = catLookup(t, lang).catch((e) => { catMemo.delete(key); throw e; });
    catMemo.set(key, p);
    if (catMemo.size > 60) catMemo.delete(catMemo.keys().next().value);
  }
  return catMemo.get(key);
}
async function catLookup(t, lang) {
  if (!t.title) return '';
  const queries = t.episode ? [`${t.title} S${two(t.season || 1)}E${two(t.episode)}`]
    : t.year ? [`${t.title} ${t.year}`, t.title] : [t.title];
  for (const q of queries) {
    const html = await N.call('GET', CAT + 'index.php?search=' + encodeURIComponent(q), BROWSER);
    const pages = subtitleCatCandidates(html, t).slice(0, 4);
    if (!pages.length) continue;
    // open the best few at once; take the best-ranked one that has the language ready
    const links = await Promise.all(pages.map((page) => N.call('GET', CAT + page, BROWSER).then((d) => subtitleCatLink(d, lang), () => '')));
    const hit = links.find(Boolean);
    if (hit) return hit;
  }
  return '';
}

// One place that answers "which subtitle file goes with this film / episode": the copy saved on
// this device, else SubtitleCat, else SubDL when a key is set. Resolves to { uri, lang, source } or null.
export async function findSubtitle(item, lang = 'en') {
  const saved = cachedSubtitle(item, lang);
  if (saved) return { uri: saved, lang, source: 'Saved' };
  try {
    const cat = await subtitleCatExisting(item, lang);
    if (cat) {
      const uri = await rememberSubtitle(item, lang, { source: 'SubtitleCat', url: cat }, cat).catch(() => '');
      return { uri: uri || cat, lang, source: 'SubtitleCat' };
    }
  } catch (e) { /* next source */ }
  if (hasAutoProvider()) {
    try {
      const r = await searchSubs(item, [lang], { automatic: true });
      if (r.length) {
        const d = await subtitleLink(r[0]);
        const uri = await rememberSubtitle(item, lang, r[0], d.link).catch(() => '');
        return { uri: uri || d.link, lang, source: r[0].source };
      }
    } catch (e) { /* none */ }
  }
  return null;
}
// The language films and series start with: 'en' unless changed; '' = no automatic subtitles.
export function subtitleLanguage() {
  if (!setting('subAuto')) return '';
  const l = setting('subLangs') || [];
  return l[0] || 'en';
}
export const subtitleCatMalayalam = (item) => subtitleCatExisting(item, 'ml');

export function subtitleCatQuery(title) {
  const t = subtitleTarget({ title });
  return t.episode ? `${t.title} S${two(t.season || 1)}E${two(t.episode)}` : t.title;
}

export async function loadOnline(result, stillCurrent = () => true) {
  const d = await subtitleLink(result);
  if (stillCurrent()) N.loadSubtitle(d.link, result.lang, result.name);
  return d;
}

// Resolve the same ranked subtitle for either the built-in player or an external app.
export async function subtitleLink(result) {
  if (result.source === 'SubDL') return { link: result.url };
  const text = await N.call('POST', `${API}/download`, headers(), JSON.stringify({ file_id: result.fileId }));
  const d = JSON.parse(text);
  if (!d.link) throw new Error(d.message || 'Download limit reached for today');
  return d;
}

// Called when a film or episode starts: use an embedded track in a preferred language,
// otherwise fetch the best online match when auto subtitles are on.
export async function autoSubs(item, notify, prefetched = null, stillCurrent = () => true) {
  if (!stillCurrent()) return;
  const langs = setting('subLangs') || [];
  const t = N.tracks();
  const embedded = t.text.find((x) => langs.includes((x.lang || '').slice(0, 2)));
  if (embedded) { N.selectTrack('text', embedded.id); notify && notify(`Subtitles: ${langName(embedded.lang.slice(0, 2))}`); return; }
  if (!setting('subAuto')) return;
  // the first preferred language, from the saved copy, SubtitleCat or SubDL
  const first = langs[0] || 'en';
  const found = await findSubtitle(item, first);
  if (found) {
    if (stillCurrent()) { N.loadSubtitle(found.uri, found.lang, found.source); notify && notify(`Subtitles: ${langName(found.lang)}`); }
    return;
  }
  if (!hasAutoProvider()) return;
  try {
    const r = await (prefetched || searchSubs(item, langs, { automatic: true }));
    if (!r.length || !stillCurrent()) return;
    const d = await subtitleLink(r[0]);
    const uri = await rememberSubtitle(item, r[0].lang, r[0], d.link);
    if (stillCurrent()) {
      N.loadSubtitle(uri || d.link, r[0].lang, r[0].name);
      notify && notify(`Subtitles: ${langName(r[0].lang)}${r[0].hashMatch ? ', matched to this file' : ''}`);
    }
  } catch { /* stay quiet: auto mode */ }
}

// Switch the language films and series start with ('' turns automatic subtitles off).
export function setSubtitleLanguage(lang) {
  if (!lang) { setting('subAuto', false); return; }
  const rest = (setting('subLangs') || []).filter((x) => x !== lang);
  setting('subLangs', [lang, ...rest]);
  setting('subAuto', true);
}
