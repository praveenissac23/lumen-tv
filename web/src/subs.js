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
export const hasKey = () => !!(setting('osKey') || '').trim();

// item: {title, year, season, episode, url}
export async function searchSubs(item, langs = setting('subLangs')) {
  if (!hasKey()) throw new Error('NO_KEY');
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
      if (!f || results.some((r) => r.fileId === f.file_id)) continue;
      results.push({ fileId: f.file_id, lang: a.language, name: a.release || f.file_name || '', downloads: a.download_count || 0,
        hashMatch: !!a.moviehash_match, hi: !!a.hearing_impaired });
    }
  };
  if (hash) { const p = new URLSearchParams(q); p.set('moviehash', hash.hash); await run(p).catch(() => {}); }
  const p = new URLSearchParams(q);
  p.set('query', item.title);
  if (item.season) { p.set('season_number', item.season); p.set('episode_number', item.episode); p.set('type', 'episode'); }
  else { if (item.year) p.set('year', item.year); p.set('type', 'movie'); }
  await run(p);
  // Exact file matches first, then the order of preferred languages, then popularity.
  const order = (l) => { const i = (langs || []).indexOf(l); return i < 0 ? 99 : i; };
  results.sort((x, y) => (y.hashMatch - x.hashMatch) || (order(x.lang) - order(y.lang)) || (y.downloads - x.downloads));
  return results;
}

export async function loadOnline(result) {
  const text = await N.call('POST', `${API}/download`, headers(), JSON.stringify({ file_id: result.fileId }));
  const d = JSON.parse(text);
  if (!d.link) throw new Error(d.message || 'Download limit reached for today');
  N.loadSubtitle(d.link, result.lang, result.name);
  return d;
}

// Called when a film or episode starts: use an embedded track in a preferred language,
// otherwise fetch the best online match when auto subtitles are on.
export async function autoSubs(item, notify) {
  const langs = setting('subLangs') || [];
  const t = N.tracks();
  const embedded = t.text.find((x) => langs.includes((x.lang || '').slice(0, 2)));
  if (embedded) { N.selectTrack('text', embedded.id); notify && notify(`Subtitles: ${langName(embedded.lang.slice(0, 2))}`); return; }
  if (!setting('subAuto') || !hasKey()) return;
  try {
    const r = await searchSubs(item, langs);
    if (!r.length) return;
    await loadOnline(r[0]);
    notify && notify(`Subtitles: ${langName(r[0].lang)}${r[0].hashMatch ? ', matched to this file' : ''}`);
  } catch { /* stay quiet: auto mode */ }
}
