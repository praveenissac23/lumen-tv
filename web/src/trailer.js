// Full-screen YouTube trailer inside the app (the same warm-start player page as the home banner).
import { pushLayer, popLayer } from './nav.js';
import { toast } from './ui.js';
import { esc } from './util.js';
import { http } from './native.js';

// ---------- finding a trailer ----------
// The provider's YouTube link when it has one, otherwise the top results of a YouTube search for
// "<title> <year> official trailer". Results are remembered on the device, so each title is
// looked up once. Several candidates are kept because some trailers don't allow playing outside YouTube.
const MEM = new Map();
let store = null;
function loadStore() {
  if (store) return store;
  try { store = JSON.parse(localStorage.getItem('c:yt') || '{}'); } catch (e) { store = {}; }
  return store;
}
let saveT = null;
function saveStore() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const keys = Object.keys(store);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 2500)) delete store[k];
    try { localStorage.setItem('c:yt', JSON.stringify(store)); } catch (e) { /* full */ }
  }, 1500);
}
export function cleanTitle(n) {
  return String(n || '')
    .replace(/^\s*(\|[^|]{1,12}\||[A-Z]{2,4}\s*[:|]|[A-Z]{2,4}\s+-)\s*/, '')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\b(4K|UHD|FHD|HD|HQ|HEVC|x26[45]|H\.?26[45]|MULTI|DUAL|AUDIO|HDR|10bit|WEB-?DL|BluRay|Malayalam|Tamil|Hindi|Telugu|Kannada|English|Eng|Hin|Mal|Tam|Dubbed|Sub(bed|s)?)\b/gi, ' ')
    .replace(/[-–|:]+\s*$/, '')
    .replace(/\s+/g, ' ').trim();
}
async function searchYouTube(q) {
  const html = await http('https://www.youtube.com/results?hl=en&search_query=' + encodeURIComponent(q), { timeout: 9000 });
  const out = [];
  const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = re.exec(html)) && out.length < 4) if (!out.includes(m[1])) out.push(m[1]);
  if (!out.length) { const re2 = /"videoId":"([A-Za-z0-9_-]{11})"/g; while ((m = re2.exec(html)) && out.length < 4) if (!out.includes(m[1])) out.push(m[1]); }
  return out;
}
/** Trailer candidates (YouTube IDs, best first) for a film or series. */
export function trailerCandidates(key, { known = '', name = '', year = '', kind = 'movie', info = null } = {}) {
  if (MEM.has(key)) return MEM.get(key);
  const st = loadStore();
  const p = (async () => {
    const first = ytId(known);
    if (st[key] && (!first || st[key][0] === first)) return st[key];
    let list = first ? [first] : [];
    if (!first && info) { const i = ytId((await info.catch(() => null) || {}).trailer); if (i) list = [i]; }
    // always add search results behind the provider's link: some provider links are dead or blocked
    const t = cleanTitle(name);
    if (t) {
      try {
        const yr = /^\d{4}$/.test(String(year)) ? ' ' + year : '';
        const found = await searchYouTube(`${t}${yr} ${kind === 'series' ? 'series ' : ''}official trailer`);
        for (const v of found) if (!list.includes(v)) list.push(v);
      } catch (e) { if (!list.length) { MEM.delete(key); return []; } }
    }
    st[key] = list.slice(0, 5); saveStore();
    return st[key];
  })();
  MEM.set(key, p);
  return p;
}


export function ytId(v) {
  const m = String(v || '').trim().match(/(?:v=|youtu\.be\/|embed\/|shorts\/)?([A-Za-z0-9_-]{11})(?:[?&#]|$)/);
  return m ? m[1] : '';
}

export function ytPageUrl() {
  // Android loads the app from a file, which YouTube won't play under; the page gets a web address
  return location.protocol === 'file:' ? 'https://thumb.lumen/yt.html' : 'yt.html';
}

let open = null;

export function playTrailer(trailer, title = '') {
  const list = (Array.isArray(trailer) ? trailer : [trailer]).map(ytId).filter(Boolean);
  if (!list.length) { toast('No trailer found for this title'); return; }
  let n = 0;
  const id = () => list[n];
  closeTrailer();
  const stage = document.getElementById('stage') || document.body;
  const ov = document.createElement('div');
  ov.className = 'trailer-ov';
  ov.innerHTML = `<iframe allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1"></iframe>
    <div class="trailer-cover"><span class="spinner"></span></div>
    <div class="trailer-hint"><b>${esc(title)}</b><span>Trailer · OK pause · ◀ ▶ 10 s · Back closes</span></div>`;
  stage.appendChild(ov);
  const f = ov.querySelector('iframe');
  const send = (m) => { try { f.contentWindow.postMessage(m, '*'); } catch (e) { /* frame gone */ } };
  let hintT = null;
  const showHint = () => { ov.classList.add('hint'); clearTimeout(hintT); hintT = setTimeout(() => ov.classList.remove('hint'), 3500); };
  const onMsg = (e) => {
    const m = e.data;
    if (!m || !m.yt || e.source !== f.contentWindow) return;
    if (m.ev === 'ready') send({ cmd: 'play', id: id(), start: 0 });
    // uncover once it has been playing long enough for YouTube's start-up buttons to go
    if (m.ev === 'playing' && !ov.classList.contains('on')) setTimeout(() => ov.classList.add('on'), 600);
    if (m.ev === 'ended') closeTrailer();
    if (m.ev === 'error') {
      // not allowed outside YouTube, removed…: try the next one
      if (++n < list.length) { send({ cmd: 'play', id: id(), start: 0 }); return; }
      closeTrailer(); toast("This trailer can't be played");
    }
  };
  window.addEventListener('message', onMsg);
  f.src = ytPageUrl();
  const layer = {
    root: ov, modal: true,
    onKey: (k) => {
      if (k === 'back') { closeTrailer(); return true; }
      if (k === 'ok' || k === 'playpause' || k === 'play' || k === 'pause') { send({ cmd: 'toggle' }); showHint(); }
      if (k === 'left' || k === 'rew') { send({ cmd: 'seek', by: -10 }); showHint(); }
      if (k === 'right' || k === 'ffwd') { send({ cmd: 'seek', by: 10 }); showHint(); }
      if (k === 'up' || k === 'down') showHint();
      return true;
    },
  };
  pushLayer(layer);
  showHint();
  open = { ov, layer, onMsg, send, hintT: () => clearTimeout(hintT) };
}

export function closeTrailer() {
  if (!open) return;
  const o = open; open = null;
  o.send({ cmd: 'stop' });
  o.hintT();
  window.removeEventListener('message', o.onMsg);
  popLayer(o.layer);
  o.ov.remove();
}
