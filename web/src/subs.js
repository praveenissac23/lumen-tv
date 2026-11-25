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

// SubtitleCat publishes already translated SRT files. This is a best-effort
// search for an existing Malayalam track; its website does not offer a
// supported translation API for starting a new job from a TV app.
export async function subtitleCatExisting(item, lang = 'en') {
  if (!['en', 'ml'].includes(lang)) return '';
  const title = String(item.title || '').replace(/\.[^.]{2,4}$/, '');
  const episode = /\b(?:S\d{1,2}E\d{1,3}|EP[ ._-]?\d{1,3})\b/i.exec(title)?.[0]?.replace(/[^A-Z0-9]/gi, '').toLowerCase();
  const base = 'https://www.subtitlecat.com/';
  const html = await N.call('GET', base + 'index.php?search=' + encodeURIComponent(title), {});
  const pages = [...html.matchAll(/href=["']\/?(subs\/\d+\/[^"'<>]+?\.html)["']/gi)]
    .map((m) => m[1]).filter((x, i, all) => all.indexOf(x) === i).slice(0, 8);
  for (const page of pages) {
    const decoded = decodeURIComponent(page).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (episode && !decoded.includes(episode)) continue;
    const detail = await N.call('GET', base + page, {});
    const anchor = [...detail.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0])
      .find((a) => a.includes('download_' + lang));
    const link = anchor && /\bhref=["']([^"']+\.srt(?:\?[^"']*)?)["']/i.exec(anchor)?.[1];
    if (link && /^\/?subs\/\d+\//.test(link)) return new URL(link, base).href;
  }
  return '';
}
export const subtitleCatMalayalam = (item) => subtitleCatExisting(item, 'ml');

export function subtitleCatQuery(title) {
  const clean = String(title || '').replace(/^www\.[^ ]+\s*-\s*/i, '');
  const tv = /^(.+?)\s*\(\d{4}\)\s*S(\d{1,2})\s*EP\s*\((\d{1,3})(?:\s*-\s*\d{1,3})?\)/i.exec(clean);
  if (tv) return `${tv[1].trim()} S${tv[2].padStart(2, '0')}E${tv[3].padStart(2, '0')}`;
  return clean.replace(/\b(?:TRUE|WEB-DL|1080p|720p|AVC|AAC|x264|x265)\b.*$/i, '').trim() || clean;
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
  const cached = langs.map((lang) => ({ lang, uri: cachedSubtitle(item, lang) })).find((x) => x.uri);
  if (cached) {
    if (stillCurrent()) { N.loadSubtitle(cached.uri, cached.lang, 'Saved subtitle'); notify && notify(`Subtitles: ${langName(cached.lang)}`); }
    return;
  }
  if (langs.includes('en') || langs.includes('ml')) {
    const language = langs.includes('en') ? 'en' : 'ml';
    try {
      const cat = await subtitleCatExisting(item, language);
      if (cat && stillCurrent()) {
        const uri = await rememberSubtitle(item, language, { source: 'SubtitleCat', url: cat }, cat);
        if (stillCurrent()) { N.loadSubtitle(uri || cat, language, 'SubtitleCat'); notify && notify(`Subtitles: ${langName(language)}`); }
        return;
      }
    } catch { /* try another source */ }
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
