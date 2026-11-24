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
export async function subtitleCatMalayalam(item) {
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
    const link = /<a\b(?=[^>]*\bid=["']download_ml["'])(?=[^>]*\bhref=["']([^"']+\.srt(?:\?[^"']*)?)["'])[^>]*>/i.exec(detail)?.[1];
    if (link && /^\/?subs\/\d+\//.test(link)) return new URL(link, base).href;
  }
  return '';
}

// Start an official SubDL translation only on an explicit Malayalam request.
// The existing SubDL key needs a paid translation entitlement and quota.
export async function translateMalayalam(item, progress = () => {}) {
  const key = (setting('subdlKey') || '').trim();
  if (!key) throw new Error('A SubDL key with a paid translation plan is needed in Settings > Subtitles.');
  const source = (await searchSubs(item, ['en'])).find((r) => r.source === 'SubDL' && r.nId && r.fileNId);
  if (!source) throw new Error('No matching English subtitle was found to translate.');
  const root = 'https://api.subdl.com/api/v2/ai/translations';
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' };
  const getJson = async (method, url, body) => {
    const response = JSON.parse(await N.call(method, url, headers, body ? JSON.stringify(body) : ''));
    if (response.error && !response.job) throw new Error(response.message || response.error);
    return response;
  };
  const data = await getJson('POST', root,
    { n_id: source.nId, file_n_id: source.fileNId, target_language: 'ML', format: 'srt' });
  const id = data.request_id || data.job?.id;
  if (!id || !/^[\w-]+$/.test(id)) throw new Error('The translation service did not start a job.');
  for (let attempt = 0; attempt < 45; attempt++) {
    const job = attempt === 0 ? data.job : (await getJson('GET', root + '/' + id)).job;
    if (job?.download_ready) return root + '/' + id + '/download?api_key=' + encodeURIComponent(key);
    if (['failed', 'aborted'].includes(job?.status)) throw new Error(job.error || 'Translation failed.');
    progress(job?.progress || 0);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Translation is still processing. Try Malayalam again shortly.');
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
  if (!setting('subAuto') || !hasKey()) return;
  try {
    const r = await (prefetched || searchSubs(item, langs));
    if (!r.length || !stillCurrent()) return;
    await loadOnline(r[0], stillCurrent);
    if (stillCurrent()) notify && notify(`Subtitles: ${langName(r[0].lang)}${r[0].hashMatch ? ', matched to this file' : ''}`);
  } catch { /* stay quiet: auto mode */ }
}
