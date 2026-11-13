// Optional catalogue/source adapter. Playback starts only after an explicit source action.
// Accounts are separate from the IPTV state and are never sent to search add-ons.
import * as N from './native.js';
import { setting } from './store.js';

export const PROVIDERS = { rd: 'Real-Debrid', ad: 'AllDebrid' };
export const INTERNET_TORRENTS = 'https://torrentio.strem.fun';
const CATALOGUE = 'https://v3-cinemeta.strem.io';
const cache = new Map();
const jobs = new Map(); // in-memory IDs: retry preparation without adding the magnet again
const KEY = 'debrid-accounts';
const readyCache = new Map();
export function accounts() {
  try {
    const value = JSON.parse(N.cacheRead(KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function saveAccount(id, key) {
  const a = accounts();
  if (key) a[id] = { key }; else delete a[id];
  N.cacheWrite(KEY, JSON.stringify(a));
  jobs.clear(); readyCache.clear();
}
export function preferredProvider() {
  const a = accounts(), id = setting('debridPreferred');
  return a[id]?.key ? id : Object.keys(PROVIDERS).find((p) => a[p]?.key) || '';
}
export function sourceBase(value) {
  const u = new URL(String(value || '').trim().replace(/^stremio:\/\//i, 'https://'));
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) throw new Error('Use an HTTPS add-on manifest URL without a query or fragment.');
  return u.href.replace(/\/manifest\.json\/?$/, '').replace(/\/$/, '');
}
function mediaUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol) ? url : ''; } catch { return ''; }
}
async function json(url) {
  let value;
  try { value = JSON.parse(await N.http(url, { timeout: 12000 })); }
  catch { throw new Error('The search provider did not respond. Please retry.'); }
  return value;
}
async function memo(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.data;
  const data = await load();
  if (data.sourceErrors?.length) return data;
  if (cache.size >= 12) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
  return data;
}
export async function findTitles(query) {
  const q = query.trim().slice(0, 160);
  if (q.length < 2) return [];
  return memo('q:' + q.toLowerCase(), async () => {
    const results = await Promise.all(['movie', 'series'].map((type) => json(`${CATALOGUE}/catalog/${type}/top/search=${encodeURIComponent(q)}.json`).then((value) => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' }))));
    if (results.every((r) => r.status === 'rejected')) throw new Error('Title search is unavailable. Your IPTV search is still available.');
    const seen = new Set(), out = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      for (const m of (Array.isArray(r.value.metas) ? r.value.metas : []).slice(0, 20)) {
        const type = ['movie', 'series'][i], id = String(m.id || '');
        if (!/^tt\d+$/.test(id) || seen.has(type + id)) continue;
        seen.add(type + id);
        out.push({ id, type, name: String(m.name || 'Untitled'), img: mediaUrl(m.poster), year: String(m.releaseInfo || '').slice(0, 12) });
      }
    });
    return out;
  });
}
export async function titleMeta(item) {
  return memo('meta:' + item.type + ':' + item.id, async () => {
    const r = await json(`${CATALOGUE}/meta/${item.type}/${encodeURIComponent(item.id)}.json`);
    return r.meta || {};
  });
}
export async function validateSource(value) {
  const base = sourceBase(value), m = await json(base + '/manifest.json');
  if (!(m.resources || []).some((r) => (typeof r === 'string' ? r : r.name) === 'stream')) throw new Error('This add-on does not provide streams.');
  return { base, name: String(m.name || 'Source provider').slice(0, 80) };
}
export function normaliseSources(streams) {
  const seen = new Set(), out = [];
  // Rank before limiting display rows so a long list of 4K releases does not
  // exclude the user's preferred 1080p releases further down the response.
  for (const s of streams.slice(0, 1000)) {
    if (!s || typeof s !== 'object') continue;
    let url = mediaUrl(s.url), hash = /^[a-f\d]{40}$/i.test(s.infoHash || '') ? s.infoHash.toLowerCase() : '';
    const providerText = [s.name,s.title,s.description].filter(Boolean).join(' ');
    const pendingCloud = /\b(?:RD|AD)\s*(?:download|uncached)|not\s*cached/i.test(providerText);
    if (url && pendingCloud) {
      // A Debrid add-on's download resolver may create a cloud job just by opening
      // its URL. Convert it back to a magnet, never send that resolver to VLC.
      if (!hash) { try { hash = /(?:^|\/)([a-f\d]{40})(?:\/|$)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() || ''; } catch { } }
      url = '';
    }
    // External web pages and streams requiring request headers cannot be handed to every player.
    if ((!url && !hash) || s.behaviorHints?.proxyHeaders?.request) continue;
    const fileIdx = Number.isInteger(s.fileIdx) && s.fileIdx >= 0 ? s.fileIdx : null;
    const key = url || hash + ':' + fileIdx;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = [s.name, s.title, s.description].filter(Boolean).join(' · ').slice(0, 500);
    const quality = /2160|\b4k\b/i.test(text) ? 2160 : /1080/.test(text) ? 1080 : /720/.test(text) ? 720 : /480/.test(text) ? 480 : 0;
    const seedMatch = /(?:👤|seed(?:er)?s?\s*[:=]?)\s*([\d,]+)/i.exec(text);
    const seeds = Number.isFinite(+s.seeders) ? +s.seeders : seedMatch ? +seedMatch[1].replace(/,/g, '') : null;
    const trackers=[...new Set((Array.isArray(s.sources)?s.sources:[]).slice(0,64).map(source=>{
      if(typeof source!=='string'||!source.startsWith('tracker:'))return '';
      try {const value=source.slice(8),u=new URL(value);return ['http:','https:','udp:'].includes(u.protocol)&&u.hostname&&value.length<=2048?value:'';}catch{return '';}
    }).filter(Boolean))].slice(0,32);
    out.push({ key, url, hash, fileIdx, trackers, text: text || 'Source', quality, seeds, size: +s.behaviorHints?.videoSize || 0,
      sourceLabel: String(s._lumenSource || '').slice(0, 100), sourceType: s._lumenScope || 'custom' });
  }
  const quality = +(setting('torrentQuality') || 1080);
  const distance = (s) => s.quality === quality ? 0 : !s.quality ? 10000 : s.quality < quality ? quality - s.quality : 3000 + s.quality;
  return out.sort((a, b) => Number(!!b.url) - Number(!!a.url) || Number(b.sourceType === 'internet') - Number(a.sourceType === 'internet') || distance(a) - distance(b) || (b.seeds || 0) - (a.seeds || 0)).slice(0, 150);
}
export function searchProviders() {
  const providers = [];
  if (setting('internetTorrents') !== false) providers.push({ base: INTERNET_TORRENTS, name: 'Internet · Torrentio', scope: 'internet' });
  const custom = setting('torrentSource');
  if (custom) {
    const base = sourceBase(custom);
    if (!providers.some((p) => p.base === base)) providers.push({ base, name: setting('torrentSourceName') || 'Additional source', scope: 'custom' });
  }
  return providers;
}
export async function findSources(type, id, { refresh = false } = {}) {
  const providers = searchProviders();
  if (!providers.length) return [];
  const key = 'streams:' + providers.map((p) => p.base).join('|') + ':' + type + ':' + id + ':' + (setting('torrentQuality') || 1080);
  if (refresh) cache.delete(key);
  return memo(key, async () => {
    const results = await Promise.all(providers.map(async (p) => {
      try {
        const r = await json(`${p.base}/stream/${type}/${encodeURIComponent(id)}.json`);
        if (!Array.isArray(r.streams)) throw new Error('Invalid stream response');
        return { ...p, streams: r.streams.slice(0, 500).map((s) => ({ ...s, _lumenSource: p.name, _lumenScope: p.scope })) };
      } catch { return { ...p, error: true, streams: [] }; }
    }));
    const errors = results.filter((p) => p.error).map((p) => p.name);
    if (errors.length === providers.length) throw new Error('Internet torrent sources are unavailable. Please retry; this is separate from your Debrid connection.');
    const sources = normaliseSources(results.reduce((all, p) => all.concat(p.streams), []));
    sources.sourceErrors = errors;
    const count = sources.filter((s) => s.sourceType === 'internet').length;
    sources.sourceSummary = `${count} internet torrents${sources.length > count ? ` · ${sources.length - count} additional sources` : ''}. Press OK on a source for playback and other actions.`;
    if (errors.length) sources.sourceSummary += ' Unavailable: ' + errors.join(', ') + '.';
    return sources;
  });
}
async function api(id, path, method = 'GET', fields, overrideKey) {
  const key = overrideKey || accounts()[id]?.key;
  if (!key) throw new Error(`Connect ${PROVIDERS[id]} in Settings > Debrid and torrents.`);
  const headers = { Authorization: 'Bearer ' + key };
  let body = '';
  if (fields) { body = Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const base = id === 'rd' ? 'https://api.real-debrid.com/rest/1.0/' : 'https://api.alldebrid.com/';
  let raw;
  try { raw = await N.call(method, base + path, headers, body); }
  catch { throw new Error(`${PROVIDERS[id]} request failed. Check your key, subscription and connection.`); }
  let r;
  try { r = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`${PROVIDERS[id]} returned an invalid response.`); }
  if (r.error || r.status === 'error') {
    const code = String(id === 'rd' ? r.error_code ?? r.error : r.error?.code || '');
    if (id === 'rd' ? /^(8|bad_token)$/.test(code) : /^(AUTH_|API_KEY)/.test(code)) throw new Error(`${PROVIDERS[id]} key is invalid or expired. Reconnect it in Debrid settings.`);
    if (id === 'rd' && /^(10|11)$/.test(code)) throw new Error('Real-Debrid requires account verification. Complete it on the Real-Debrid website, then retry.');
    if (id === 'rd' && /^(9|14|15)$/.test(code)) throw new Error('Real-Debrid denied account access. Check your account status and subscription.');
    if (id === 'rd' ? /^20$/.test(code) : /PREMIUM|SUBSCRIPTION/.test(code)) throw new Error(`${PROVIDERS[id]} subscription is required or has expired.`);
    throw new Error(`${PROVIDERS[id]} could not complete this request. Try another source or check your subscription.`);
  }
  return id === 'ad' ? r.data || {} : r;
}
export async function validateAccount(id, key) {
  if (!PROVIDERS[id] || !key || /\s/.test(key)) throw new Error('Paste a valid API key.');
  const r = await api(id, id === 'rd' ? 'user' : 'v4/user', 'GET', null, key);
  if (id === 'rd' ? !r.username : !r.user?.username) throw new Error('The account could not be verified.');
  return true;
}
export function videoFiles(files) {
  return files.filter((f) => /\.(mkv|mp4|avi|mov|m4v|ts|webm)$/i.test(f.name || '') && !/(?:^|[\/._ -])sample(?:[\/._ -]|$)/i.test(f.name));
}
export function flattenFiles(files, prefix = '') {
  const out = [];
  for (const f of files || []) {
    const name = prefix + (f.n || '');
    if (Array.isArray(f.e)) out.push(...flattenFiles(f.e, name + '/'));
    else out.push({ name, size: +f.s || 0, link: f.l });
  }
  return out;
}
// Never assume the first/largest file is the requested episode in a season pack.
export async function chooseVideo(files, stream, episode, choose) {
  const videos = videoFiles(files);
  if (!videos.length) throw new Error('No playable video file was found in this torrent.');
  let candidates = videos;
  if (episode) {
    const se = new RegExp(`(?:s0*${episode.season}e0*${episode.episode}(?!\\d)|\\b0*${episode.season}x0*${episode.episode}(?!\\d))`, 'i');
    const matches = videos.filter((f) => se.test(f.name));
    if (matches.length === 1) return matches[0];
    // Never silently select a clearly different episode, even when the index says so.
    candidates = matches.length ? matches : videos.filter((f) => !/(?:s\d+e\d+|\b\d+x\d+)/i.test(f.name));
    if (!candidates.length) throw new Error('The requested episode was not found in this torrent. Try another source.');
  }
  if (stream.fileIdx != null && candidates.includes(files[stream.fileIdx])) return files[stream.fileIdx];
  if (candidates.length === 1) return candidates[0];
  const selected = await choose(candidates);
  if (!selected) throw new Error('Cancelled');
  return selected;
}
// One bounded status check per click; preparing torrents stay in the provider's cloud.
export async function resolveSource(stream, provider, episode, choose, active = () => true, existingOnly = false) {
  if (!active()) throw new Error('Cancelled');
  if (stream.url) return { url: stream.url };
  if (!stream.hash) throw new Error('This source is not supported.');
  if (!provider) throw new Error('Connect a Debrid account in Settings > Debrid and torrents.');
  const jk = provider + ':' + stream.hash + ':' + (episode?.id || '') + ':' + (stream.fileIdx ?? '');
  let job = jobs.get(jk);
  if (provider === 'rd') {
    if (!job && existingOnly) throw new Error('This source is no longer ready in Real-Debrid. Nothing was uploaded.');
    if (!job) {
      const r = await api('rd', 'torrents/addMagnet', 'POST', { magnet: 'magnet:?xt=urn:btih:' + stream.hash });
      if (!r.id) throw new Error('Real-Debrid did not accept the torrent.');
      job = { id: r.id }; jobs.set(jk, job);
    }
    let r = await api('rd', 'torrents/info/' + job.id);
    if (!active()) throw new Error('Cancelled');
    if (r.status === 'waiting_files_selection' && existingOnly) throw new Error('This source is not ready in Real-Debrid. Nothing was uploaded.');
    if (r.status === 'waiting_files_selection') {
      const files = (r.files || []).map((f) => ({ name: f.path, size: f.bytes, id: f.id }));
      const f = await chooseVideo(files, stream, episode, choose);
      if (!active()) throw new Error('Cancelled');
      job.file = f.id;
      await api('rd', 'torrents/selectFiles/' + job.id, 'POST', { files: String(f.id) });
      r = await api('rd', 'torrents/info/' + job.id);
    }
    if (r.status !== 'downloaded') {
      if (/error|dead|virus/.test(r.status || '')) { jobs.delete(jk); throw new Error('This torrent could not be prepared. Try another source.'); }
      throw new Error('Preparing in Real-Debrid. Try another source now, or select this source again later.');
    }
    const selected = (r.files || []).filter((f) => f.selected).map((f, i) => ({ id: f.id, name: f.path, size: f.bytes, link: r.links?.[i] }));
    const allFiles = (r.files || []).map((f) => selected.find((s) => s.id === f.id) || { name: f.path, size: f.bytes });
    const f = job.file ? selected.find((s) => s.id === job.file) : await chooseVideo(allFiles, stream, episode, choose);
    if (!f?.link) throw new Error('The requested file is not ready. Try another source.');
    if (!active()) throw new Error('Cancelled');
    const unlocked = await api('rd', 'unrestrict/link', 'POST', { link: f.link });
    if (!mediaUrl(unlocked.download)) throw new Error('Real-Debrid has not supplied a playable link.');
    return { url: unlocked.download, file: f.name.split('/').pop(), size: f.size };
  }
  if (!job && existingOnly) throw new Error('This source is no longer ready in AllDebrid. Nothing was uploaded.');
  if (!job) {
    const r = await api('ad', 'v4/magnet/upload', 'POST', { 'magnets[]': 'magnet:?xt=urn:btih:' + stream.hash });
    const m = r.magnets?.[0];
    if (!m?.id) throw new Error('AllDebrid did not accept the torrent.');
    job = { id: m.id }; jobs.set(jk, job);
  }
  const r = await api('ad', 'v4.1/magnet/status', 'POST', { id: job.id });
  const m = Array.isArray(r.magnets) ? r.magnets.find((x) => String(x.id) === String(job.id)) : r.magnets;
  if (!m || +m.statusCode !== 4) {
    if (+m?.statusCode >= 7) { jobs.delete(jk); throw new Error('This torrent could not be prepared. Try another source.'); }
    throw new Error('Preparing in AllDebrid. Try another source now, or select this source again later.');
  }
  if (!active()) throw new Error('Cancelled');
  const result = await api('ad', 'v4/magnet/files', 'POST', { 'id[]': job.id });
  const files = flattenFiles(result.magnets?.find((x) => String(x.id) === String(job.id))?.files || m.files);
  // AllDebrid's file tree has no torrent file-index guarantee: match episode or ask.
  const f = await chooseVideo(files.filter(f => mediaUrl(f.link)), { ...stream, fileIdx: null }, episode, choose);
  if (!active()) throw new Error('Cancelled');
  const unlocked = await api('ad', 'v4/link/unlock', 'POST', { link: f.link });
  if (!mediaUrl(unlocked.link)) throw new Error('AllDebrid has not supplied a playable link.');
  return { url: unlocked.link, file: f.name.split('/').pop(), size: f.size };
}


export function magnetUrl(stream) {
  if (!/^[a-f\d]{40}$/i.test(stream.hash || '')) throw new Error('No supported magnet link.');
  return 'magnet:?xt=urn:btih:' + stream.hash + (stream.trackers||[]).map(tracker=>'&tr='+encodeURIComponent(tracker)).join('');
}
export function torrentServerBase(value) {
  const u = new URL(String(value || '').trim());
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Enter an HTTP or HTTPS TorrServer address without a password or query.');
  return u.href.replace(/\/$/, '');
}
// Read-only checks. Connecting an account never means a torrent is cached.
export async function readySources(sources, refresh = false) {
  const found = new Map(), errors = [];
  await Promise.all(Object.keys(PROVIDERS).filter(p => accounts()[p]?.key).map(async provider => {
    const key = provider + ':' + accounts()[provider].key;
    let entry = readyCache.get(key);
    try {
      if (refresh || !entry || Date.now() - entry.time > 30000) {
        const promise = (async () => {
          const result = provider === 'rd' ? await api('rd', 'torrents?limit=1000') : await api('ad', 'v4.1/magnet/status', 'POST', { status:'ready' });
          const list = provider === 'rd' ? result : result.magnets;
          const rows = Array.isArray(list) ? list : list?.id ? [list] : [];
          return rows.filter(m => provider === 'rd' ? m.status === 'downloaded' : +m.statusCode === 4).map(m => {
            let hash = String(m.hash || '').toLowerCase();
            if (!/^[a-f\d]{40}$/.test(hash)) {
              const known = [...jobs.entries()].find(([k,j]) => k.startsWith(provider+':') && String(j.id) === String(m.id));
              hash = known ? known[0].split(':')[1] : '';
            }
            return {hash,id:m.id,provider};
          }).filter(m => /^[a-f\d]{40}$/.test(m.hash) && m.id != null);
        })();
        entry = { time:Date.now(), promise }; readyCache.set(key,entry);
        promise.catch(() => readyCache.delete(key));
      }
      for (const m of await entry.promise) if (sources.some(s => s.hash === m.hash)) {
        const list = found.get(m.hash) || []; list.push(m); found.set(m.hash,list);
      }
    } catch { errors.push(PROVIDERS[provider]); }
  }));
  return { found, errors };
}
export async function resolvePlayable(stream, provider, episode, choose, active = () => true) {
  if (!active()) throw new Error('Cancelled');
  if (stream.url) return {url:stream.url};
  let availabilityTimer;
  const {found} = await Promise.race([readySources([stream]), new Promise(resolve => { availabilityTimer=setTimeout(()=>resolve({found:new Map()}),1200); })]).finally(()=>clearTimeout(availabilityTimer));
  if (!active()) throw new Error('Cancelled');
  const available = found.get(stream.hash) || [];
  const ready = available.find(m => m.provider === provider) || available[0];
  if (ready) {
    const jk = ready.provider + ':' + stream.hash + ':' + (episode?.id || '') + ':' + (stream.fileIdx ?? '');
    jobs.set(jk,{id:ready.id});
    try { return await resolveSource(stream,ready.provider,episode,choose,active,true); }
    catch(e) { if(e.message==='Cancelled' || !active()) throw new Error('Cancelled'); readyCache.clear(); stream.readyProviders=[]; }
  }
  if (N.hasLocalTorrentEngine) {
    const metadata=await N.torrentPrepare(magnetUrl(stream));
    if(!active()){N.torrentCancel();throw new Error('Cancelled');}
    let file;
    try { file=await chooseVideo(metadata.files || [],stream,episode,choose); } catch(e) { N.torrentCancel();throw e; }
    if(!active()){N.torrentCancel();throw new Error('Cancelled');}
    return N.torrentStart(metadata.hash,file.id);
  }
  const configured = setting('torrentServer');
  if (!configured) return {url:magnetUrl(stream),magnet:true};
  const base = torrentServerBase(configured), query = new URLSearchParams({link:magnetUrl(stream)});
  let metadata;
  try { metadata = JSON.parse(await N.http(base+'/stream?'+query+'&stat', {timeout:20000})); }
  catch { throw new Error('Torrent streaming server is unavailable. Check TorrServer in settings. Nothing was uploaded to Debrid.'); }
  if (!active()) throw new Error('Cancelled');
  const files = (metadata.file_stats || []).slice().sort((a,b)=>a.id-b.id).map(f=>({name:f.path,size:f.length,id:f.id}));
  const file = await chooseVideo(files,stream,episode,choose);
  if (!active()) throw new Error('Cancelled');
  query.set('index',String(file.id)); query.set('play','');
  return {url:base+'/stream?'+query,file:file.name.split('/').pop(),size:file.size};
}
export async function prepareDebrid(stream, provider, episode, choose, active) {
  if (!stream.hash) throw new Error('This source contains a video link, not a torrent to upload.');
  readyCache.clear();
  try { await resolveSource({...stream,url:''},provider,episode,choose,active); return true; }
  catch(e) { if (/^Preparing in /.test(e.message)) return false; throw e; }
  finally { readyCache.clear(); }
}
