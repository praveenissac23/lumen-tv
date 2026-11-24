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

// item: {title, year, season, episode, url}
export async function searchSubs(item, langs = setting('subLangs')) {
  if (!hasKey()) throw new Error('NO_KEY');
  const osKey = (setting('osKey') || '').trim();
  const sdKey = (setting('subdlKey') || '').trim();
  const q = new URLSearchParams();
  q.set('languages', (langs && langs.length ? langs : ['en']).join(','));
  let hash = null;
  if (item.url) { try { hash = await N.subtitleHash(item.url); } catch { hash = null; } }
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
    if (hash) { const p = new URLSearchParams(q); p.set('moviehash', hash.hash); await run(p).catch(() => {}); }
    const p = new URLSearchParams(q);
    p.set('query', item.title);
    if (item.season) { p.set('season_number', item.season); p.set('episode_number', item.episode); p.set('type', 'episode'); }
    else { if (item.year) p.set('year', item.year); p.set('type', 'movie'); }
    await run(p);
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
          downloads: 0, hashMatch: false, hi: !!f.hi });
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

export async function loadOnline(result, stillCurrent = () => true) {
  if (result.source === 'SubDL') {
    if (stillCurrent()) N.loadSubtitle(result.url, result.lang, result.name);
    return { link: result.url };
  }
  const text = await N.call('POST', `${API}/download`, headers(), JSON.stringify({ file_id: result.fileId }));
  const d = JSON.parse(text);
  if (!d.link) throw new Error(d.message || 'Download limit reached for today');
  if (stillCurrent()) N.loadSubtitle(d.link, result.lang, result.name);
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
  if (!setting('subAuto') || !hasKey()) return;
  try {
    const r = await (prefetched || searchSubs(item, langs));
    if (!r.length || !stillCurrent()) return;
    await loadOnline(r[0], stillCurrent);
    if (stillCurrent()) notify && notify(`Subtitles: ${langName(r[0].lang)}${r[0].hashMatch ? ', matched to this file' : ''}`);
  } catch { /* stay quiet: auto mode */ }
}
