// The user's AllDebrid cloud library. Persistent playlists hold stable file identities,
// never temporary unlocked download URLs.
import * as N from './native.js';
import { S, set } from './store.js';
import { api, accounts, flattenFiles, videoFiles } from './torrents.js';

const CACHE = 'debrid-library';
let snapshot = { magnets: [], files: [], updatedAt: 0 };
let inFlight = null;
try {
  if (accounts().ad?.key) {
    const saved = JSON.parse(N.cacheRead(CACHE) || 'null');
    if (saved && Array.isArray(saved.magnets) && Array.isArray(saved.files)) snapshot = saved;
  }
} catch { /* refresh on entry */ }

export const library = () => snapshot;
export const playlists = () => Array.isArray(S.debridPlaylists) ? S.debridPlaylists : [];
export const fileById = (id) => snapshot.files.find((f) => f.id === id);
export function allItems() {
  return [...snapshot.files].sort((a, b) => (b.added || 0) - (a.added || 0) || a.name.localeCompare(b.name));
}
// A series is recognised from the video name, not a magnet ID: uploads can contain
// one episode, several episodes, or a single multi-episode video.
export function seriesGroups(files = snapshot.files) {
  const groups = new Map();
  for (const file of files) {
    const raw = (file.name || file.magnetName || '').split('/').pop()
      .replace(/^www\.[^\s]+\s*[-–]\s*/i, '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const season = /\bS(?:eason)?[ ._-]*0*(\d{1,2})(?=[ ._-]|E|$)/i.exec(raw);
    const episode = /\bS\d{1,2}[ ._-]*E0*(\d{1,3})(?:[ ._-]*[-–][ ._-]*0*(\d{1,3}))?|\bEP(?:isodes?)?[ ._-]*\(?0*(\d{1,3})(?:[ ._-]*[-–][ ._-]*0*(\d{1,3}))?\)?/i.exec(raw);
    if (!season && !episode) continue;
    const cut = Math.min(season?.index ?? raw.length, episode?.index ?? raw.length);
    const title = raw.slice(0, cut).replace(/[\s._-]+$/g, '').replace(/[._]+/g, ' ').trim();
    if (title.length < 3) continue;
    const seasonNumber = season ? +season[1] : 1;
    const start = +(episode?.[1] || episode?.[3] || 0);
    const end = +(episode?.[2] || episode?.[4] || start);
    const id = title.toLowerCase().replace(/[\s._-]+/g, ' ') + '|s' + seasonNumber;
    if (!groups.has(id)) groups.set(id, { id, title, season: seasonNumber, files: [], added: 0 });
    const g = groups.get(id);
    g.files.push({ ...file, episodeStart: start, episodeEnd: end });
    g.added = Math.max(g.added, file.added || 0);
  }
  return [...groups.values()].filter((g) => g.files.length > 1).map((g) => {
    g.files.sort((a, b) => a.episodeStart - b.episodeStart || a.episodeEnd - b.episodeEnd || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return g;
  }).sort((a, b) => b.added - a.added || a.title.localeCompare(b.title));
}
export function savedPlaylist(id) { return playlists().find((p) => p.id === id); }
export function savePlaylist(p) {
  const others = playlists().filter((x) => x.id !== p.id);
  set('debridPlaylists', [...others, { ...p, items: [...p.items] }]);
}
export function removePlaylist(id) { set('debridPlaylists', playlists().filter((p) => p.id !== id)); }
export function movePlaylistItem(id, index, offset) {
  const p = savedPlaylist(id), to = index + offset;
  if (!p || to < 0 || to >= p.items.length) return;
  const items = [...p.items]; [items[index], items[to]] = [items[to], items[index]];
  savePlaylist({ ...p, items });
}
export function addToPlaylist(id, fileId) {
  const p = savedPlaylist(id);
  if (p && !p.items.includes(fileId)) savePlaylist({ ...p, items: [...p.items, fileId] });
}
function emit() { document.dispatchEvent(new Event('debrid-library-changed')); }
export function resetLibrary() { snapshot = { magnets: [], files: [], updatedAt: 0 }; emit(); }
document.addEventListener('debrid-account-changed', resetLibrary);

function asVideo(m, entries) {
  return videoFiles(flattenFiles(entries)).filter((f) => /^https?:\/\//i.test(f.link || '')).map((f, index) => ({
    id: 'm:' + m.id + ':' + index, magnetId: String(m.id), name: f.name, size: f.size,
    link: f.link, magnetName: m.filename || '', added: +(m.completionDate || m.uploadDate) || 0,
    source: 'magnet',
  }));
}
export async function refreshLibrary(force = false) {
  if (!accounts().ad?.key) { resetLibrary(); return snapshot; }
  if (inFlight) return inFlight;
  if (!force && Date.now() - snapshot.updatedAt < 120000) return snapshot;
  inFlight = (async () => {
    // No session/counter means a full snapshot, including uploads made on the website.
    const [status, saved] = await Promise.all([
      api('ad', 'v4.1/magnet/status', 'POST'),
      api('ad', 'v4/user/links').catch(() => ({ links: [] })),
    ]);
    const magnets = Array.isArray(status.magnets) ? status.magnets : status.magnets?.id ? [status.magnets] : [];
    const ready = magnets.filter((m) => +m.statusCode === 4);
    const files = [];
    const previous = new Map(snapshot.files.filter((f) => f.source === 'magnet').map((f) => [f.magnetId, f]));
    // AllDebrid accepts an array of IDs. Small batches keep the UI responsive.
    for (let start = 0; start < ready.length; start += 15) {
      const batch = ready.slice(start, start + 15);
      const fields = {};
      batch.forEach((m, i) => { fields['id[' + i + ']'] = m.id; });
      try {
        const result = await api('ad', 'v4/magnet/files', 'POST', fields);
        for (const m of batch) {
          const entry = (result.magnets || []).find((x) => String(x.id) === String(m.id));
          if (entry?.files) files.push(...asVideo(m, entry.files));
          else if (previous.has(String(m.id))) {
            files.push(...snapshot.files.filter((f) => f.magnetId === String(m.id)));
          }
        }
      } catch {
        for (const m of batch) files.push(...snapshot.files.filter((f) => f.magnetId === String(m.id)));
      }
      snapshot = { magnets, files: [...files], updatedAt: snapshot.updatedAt };
      emit();
    }
    for (const [i, f] of (saved.links || []).entries()) {
      if (!/\.(mkv|mp4|avi|mov|m4v|ts|webm)$/i.test(f.filename || '')) continue;
      files.push({
        id: 's:' + encodeURIComponent(f.link), name: f.filename, size: +f.size || 0,
        link: f.link, added: +f.date || 0, source: 'saved',
      });
    }
    snapshot = { magnets, files, updatedAt: Date.now() };
    N.cacheWrite(CACHE, JSON.stringify(snapshot));
    emit();
    return snapshot;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export async function playableFile(id) {
  const f = fileById(id);
  if (!f) throw new Error('This file is no longer in your AllDebrid library. Refresh the library.');
  let link = f.link;
  if (f.source === 'magnet') {
    const result = await api('ad', 'v4/magnet/files', 'POST', { 'id[]': f.magnetId });
    const magnet = (result.magnets || []).find((m) => String(m.id) === f.magnetId);
    const fresh = videoFiles(flattenFiles(magnet?.files || [])).find((x) => x.name === f.name);
    if (!fresh?.link) throw new Error('This file is no longer ready in AllDebrid.');
    link = fresh.link;
  }
  const result = await api('ad', 'v4/link/unlock', 'POST', { link });
  if (!/^https?:\/\//i.test(result.link || '')) throw new Error('AllDebrid did not return a playable video link.');
  return { title: f.name.replace(/\.[^.]+$/, '').split('/').pop(), url: result.link,
    id: f.id, kind: 'movie', file: f.name, sub: '', ext: f.name.split('.').pop() };
}
