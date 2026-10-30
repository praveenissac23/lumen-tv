// Long-press menu for channels, films, series and episodes:
// play, download (ADM / 1DM), external players (VLC / MX), copy link, QR, favourites, pin to home.
import qrcode from 'qrcode-generator';
import { C, liveUrl, movieUrl, episodeUrl, catOf, vodInfo } from './data.js';
import { S, setting, isFav, toggleFav, isPinned, togglePin, isWatched, setWatched, progressOf } from './store.js';
import * as N from './native.js';
import { esc, el, bytes, safeFile, norm } from './util.js';
import { sheet, toast, icon } from './ui.js';
import { pushLayer, popLayer, focus } from './nav.js';
import { playLive, playVod } from './player.js';

const apps = (role) => N.installedApps().filter((a) => a.role === role);
const appName = (pkg) => (N.KNOWN_APPS.find((a) => a.pkg === pkg) || {}).name || 'the app';

// ---------- links and file names ----------
export function linkOf(kind, item) {
  if (kind === 'live') return liveUrl(item);
  if (kind === 'movie') return movieUrl(item);
  if (kind === 'episode') return item.key ? episodeUrl({ id: item.key.slice(3), ext: item.ext, url: item.url }) : episodeUrl(item);
  return '';
}
function absolute(url) {
  if (!url) return location.href.replace(/[^/]*$/, '') + 'demo.mp4'; // demo mode
  return url;
}
function fileName(kind, item, ext) {
  if (kind === 'movie') {
    const base = item.year && !String(item.name).includes(String(item.year)) ? `${item.name} (${item.year})` : item.name;
    return safeFile(base) + '.' + (ext || item.ext || 'mp4');
  }
  if (kind === 'episode') {
    const s = String(item.season || '').padStart(2, '0'), e = String(item.num || '').padStart(2, '0');
    const base = item.seriesName ? `${item.seriesName} S${s}E${e}` : item.title;
    return safeFile(base) + '.' + (ext || item.ext || 'mp4');
  }
  return safeFile(item.name || 'stream') + '.ts';
}
const titleOf = (kind, item) => (kind === 'episode' ? (item.seriesName ? `${item.seriesName} S${item.season}E${item.num}` : item.title) : item.name || item.title);

// ---------- main menu ----------
// Resolves true when something changed that the screen should repaint (favourite, pin, watched).
export async function itemActions(kind, item, app, ctx = {}) {
  if (!item) return false;
  const players = apps('player');
  const dls = apps('download');
  const link = absolute(linkOf(kind, item));
  const cat = item.cat != null && kind !== 'episode' ? catOf(kind, item.cat) : null;
  const opts = [];
  if (kind === 'live') opts.push({ label: 'Watch', icon: 'play', value: 'play' });
  if (kind === 'movie' || kind === 'episode') opts.push({ label: progressOf(ctx.resumeKey || resumeKey(kind, item)) ? 'Resume' : 'Play', icon: 'play', value: 'play' });
  if (kind === 'series') opts.push({ label: 'Open series', icon: 'series', value: 'open' });
  if (kind === 'movie' || kind === 'episode') {
    opts.push({ label: 'Download', icon: 'download', value: 'download', hint: dls.length ? choiceHint('downloader', dls) : 'Opens your download app' });
  }
  if (kind !== 'series') {
    for (const p of players) opts.push({ label: `Play in ${p.name}`, icon: 'external', value: 'ext:' + p.pkg });
    opts.push({ label: 'Play in another app', icon: 'external', value: 'ext:' });
    opts.push({ label: 'Copy link', icon: 'link', value: 'copy' });
    opts.push({ label: 'Show link as QR code', icon: 'qr', value: 'qr', hint: 'Scan with your phone' });
  }
  if (kind !== 'episode') opts.push({ label: isFav(kind, item.id) ? 'Remove from favourites' : 'Add to favourites', icon: isFav(kind, item.id) ? 'heartFill' : 'heart', value: 'fav' });
  if (kind === 'movie' || kind === 'episode') {
    const key = ctx.resumeKey || resumeKey(kind, item);
    opts.push({ label: isWatched(key) ? 'Mark as not watched' : 'Mark as watched', icon: 'check', value: 'watched' });
  }
  if (cat) opts.push({ label: isPinned(kind, cat.id) ? `Remove “${cat.name}” from home` : `Pin “${cat.name}” to home`, icon: 'pin', value: 'pin' });
  if (kind === 'live') opts.push({ label: 'Open in TV guide', icon: 'guide', value: 'guide' });

  const v = await sheet({ title: titleOf(kind, item), options: opts });
  if (!v) return false;
  if (v === 'play') {
    if (kind === 'live') { if (await app.ensureUnlocked('live', item.cat)) playLive(item, ctx.list || C.live, () => app.reload()); return false; }
    const key = ctx.resumeKey || resumeKey(kind, item);
    playVod({ title: titleOf(kind, item), sub: kind === 'movie' ? String(item.year || '') : item.sub || '', url: linkOf(kind, item), poster: item.img || item.poster,
      ext: item.ext, kind, id: item.id, year: item.year, seriesId: item.seriesId }, key, () => app.reload());
    return false;
  }
  if (v === 'open') { app.go('detail', { kind: 'series', id: item.id }); return false; }
  if (v === 'download') { await download(kind, item); return false; }
  if (v.startsWith('ext:')) { await external(v.slice(4), kind, item, link, ctx); return false; }
  if (v === 'copy') { N.copyText(link); toast('Link copied. Paste it in any app.'); return false; }
  if (v === 'qr') { showQr(titleOf(kind, item), link); return false; }
  if (v === 'fav') { toast(toggleFav(kind, item.id) ? 'Added to favourites' : 'Removed from favourites'); return true; }
  if (v === 'watched') { const key = ctx.resumeKey || resumeKey(kind, item); setWatched(key, !isWatched(key)); toast(isWatched(key) ? 'Marked as watched' : 'Marked as not watched'); return true; }
  if (v === 'pin') { toast(togglePin(kind, cat.id) ? `${cat.name} pinned to your home screen` : `${cat.name} removed from home`); return true; }
  if (v === 'guide') { app.go('guide', { ch: item.id }); return false; }
  return false;
}

export const resumeKey = (kind, item) => (kind === 'movie' ? 'movie:' + item.id : item.key || 'ep:' + item.id);
function choiceHint(settingKey, list) {
  const pkg = setting(settingKey);
  const a = list.find((x) => x.pkg === pkg);
  return a ? `With ${a.name}` : list.map((x) => x.name).join(' or ');
}

// ---------- external players ----------
async function external(pkg, kind, item, link, ctx) {
  const p = progressOf(ctx.resumeKey || resumeKey(kind, item));
  const ok = N.openWith(pkg, link, { title: titleOf(kind, item), mode: 'play', position: p ? Math.round(p.pos) : 0 });
  if (ok === false) toast(`${appName(pkg)} couldn’t open this link`, 'err');
}

// ---------- downloads ----------
// Other copies of the same film in the playlist (4K, 1080p, HEVC...) become quality choices.
function variants(kind, item) {
  if (kind !== 'movie') return [item];
  const n = item.n || norm(item.name);
  const list = C.movie.filter((m) => (m.n || norm(m.name)) === n && (!item.year || !m.year || m.year === item.year));
  return list.length ? list : [item];
}
const RANK = { '4K': 4, '1080p': 3, 'HD': 2, '720p': 2, 'SD': 1 };
const rank = (q) => RANK[(q || '').split(' ')[0]] || 0;

export async function download(kind, item) {
  const list = variants(kind, item);
  let pick = list[0];
  // Look up sizes (HEAD requests) and quality, so the choice is informed.
  toast(list.length > 1 ? 'Checking available qualities' : 'Checking file size');
  const info = await Promise.all(list.map(async (it) => {
    const url = absolute(linkOf(kind, it));
    let size = 0, q = it.q || '';
    try { const h = await withTimeout(N.head(url), 7000); size = h.size || 0; } catch { /* unknown */ }
    if (!q && kind === 'movie') { try { const vi = await vodInfo(it.id); if (vi && vi.height) q = vi.height >= 2000 ? '4K' : vi.height >= 1000 ? '1080p' : vi.height >= 700 ? '720p' : 'SD'; if (vi && /hevc|265/i.test(vi.codec)) q += ' HEVC'; } catch { /* ignore */ } }
    if (!N.isNative && !it.url && !activeIsReal()) size = demoSize(q, it.name); // browser demo only
    return { it, url, size, q, ext: (it.ext || 'mp4').toUpperCase() };
  }));
  info.sort((a, b) => rank(b.q) - rank(a.q) || b.size - a.size);
  let chosen = info[0];
  if (info.length > 1) {
    const v = await sheet({
      title: 'Choose quality',
      options: info.map((x, i) => ({ label: [x.q || 'Standard', x.ext].join(' · '), hint: x.size ? bytes(x.size) : 'Size unknown', icon: 'download', value: String(i) })),
    });
    if (v == null) return;
    chosen = info[+v];
  }
  pick = chosen.it;
  const name = fileName(kind, kind === 'movie' ? pick : item, (pick.ext || item.ext || 'mp4'));
  await sendToDownloader(chosen.url, name, chosen.size);
}

async function sendToDownloader(url, file, size) {
  const dls = apps('download');
  let pkg = setting('downloader');
  if (pkg && !dls.some((a) => a.pkg === pkg)) pkg = '';
  if (!pkg) {
    const opts = [
      ...dls.map((a) => ({ label: a.name, icon: 'download', value: a.pkg, hint: 'Fast, multi-part download' })),
      { label: 'Another app', icon: 'external', value: '__other' },
      { label: 'Copy link', icon: 'link', value: '__copy', hint: 'Paste into any download app' },
      { label: 'Show QR code', icon: 'qr', value: '__qr', hint: 'Download on your phone or laptop' },
    ];
    const v = await sheet({ title: `Download ${file}${size ? ` (${bytes(size)})` : ''}`, options: opts });
    if (!v) return;
    if (v === '__copy') { N.copyText(url); toast('Link copied'); return; }
    if (v === '__qr') { showQr(file, url); return; }
    pkg = v === '__other' ? '' : v;
    if (pkg) {
      const again = await sheet({ title: `Always download with ${appName(pkg)}?`, options: [
        { label: `Yes, use ${appName(pkg)} every time`, value: 'yes', icon: 'check' },
        { label: 'Ask me each time', value: 'no', icon: 'list' },
      ] });
      if (again === 'yes') setting('downloader', pkg);
    }
  }
  const ok = N.openWith(pkg, url, { title: file, file, mode: 'download' });
  if (ok === false) toast(`${appName(pkg)} didn’t accept the link. Try Copy link instead.`, 'err');
  else toast(pkg ? `Sent to ${appName(pkg)}: ${file}` : 'Choose an app to download with');
}

// ---------- QR code ----------
export function showQr(title, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  const root = el(`<div class="sheet-wrap center" data-trap><div class="sheet qr-sheet">
    <div class="qr-box">${svg}</div>
    <div class="qr-text"><h2>${esc(title)}</h2><p>Scan with your phone camera to open or download this link.</p>
      <p class="qr-link">${esc(text.length > 120 ? text.slice(0, 117) + '…' : text)}</p>
      <button class="f btn" data-a="copy">${icon('link')}Copy link</button></div></div></div>`);
  document.getElementById('overlays').appendChild(root);
  const close = () => { popLayer(layer); root.remove(); };
  const layer = { root, modal: true, onKey: (k) => { if (k === 'back' || k === 'ok' && document.activeElement?.dataset.a !== 'copy') { close(); return true; } return false; } };
  root.querySelector('[data-a=copy]').onclick = () => { N.copyText(text); toast('Link copied'); };
  pushLayer(layer);
  focus(root.querySelector('[data-a=copy]'));
}

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
function activeIsReal() { return S.playlists.some((p) => p.id === S.active); }
function demoSize(q, name) {
  const base = { '4K': 9.4e9, '1080p': 2.3e9, '720p': 1.1e9, 'SD': 0.7e9 }[(q || '').split(' ')[0]] || 1.6e9;
  return Math.round(base * (0.8 + ((name || '').length % 7) / 15) * (/HEVC/.test(q) ? 0.6 : 1));
}
