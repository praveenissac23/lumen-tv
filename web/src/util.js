// Small DOM + text helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Lower-case, strip accents, punctuation and quality tags so "BBC One HD" ~ "bbc one".
const TAGS = /\b(fhd|uhd|hd|sd|4k|hevc|h265|1080p?|720p?|50fps|backup|vip)\b/g;
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/^[a-z]{2,3}\s*[:|\-]\s+/, '') // "UK: ", "AR | "
    .replace(TAGS, ' ')
    .replace(/[^a-z0-9؀-ۿऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clean display name (keeps case) — removes country prefixes and quality tags.
export function cleanName(s) {
  return String(s || '')
    .replace(/^\s*[A-Z]{2,3}\s*[:|]\s*/, '')
    .replace(/\s*\b(FHD|UHD|HD|SD|4K|HEVC)\b\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(s || '');
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const now = () => Math.floor(Date.now() / 1000);

export function hhmm(sec) {
  const d = new Date(sec * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function dayLabel(sec) {
  const d = new Date(sec * 1000);
  const t = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function duration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function minutesLeft(endSec) {
  const m = Math.max(0, Math.round((endSec - now()) / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`;
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function initials(name) {
  const w = cleanName(name).split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (/^\d+$/.test(w[1] || '')) return (w[0][0] + w[1]).slice(0, 3).toUpperCase();
  return (w[0][0] + (w[1] ? w[1][0] : w[0][1] || '')).toUpperCase();
}

// Muted, theme-safe hue for generated artwork.
export function tint(name) {
  const h = hash(name) % 360;
  return { a: `hsl(${h} 32% 26%)`, b: `hsl(${(h + 38) % 360} 38% 14%)`, ink: `hsl(${h} 45% 82%)` };
}

// Binary search: last index i with arr[i].s <= t
export function bsearch(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].s <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Language/country tag a provider puts in front of or around a title: "ML: Film", "[Tamil] Film"
export function tagOf(s) {
  s = String(s || '');
  const m = /^\s*([A-Za-z]{2,10})\s*[:|]/.exec(s) || /[[(]([A-Za-z]{3,12})[\])]/.exec(s);
  return m ? m[1].toLowerCase() + ' |' : '';
}

// Quality tag from a provider's raw title, e.g. "Film (2024) 4K HEVC" -> "4K HEVC"
export function qualityOf(s) {
  s = String(s || '');
  const out = [];
  if (/\b(4k|uhd|2160p?)\b/i.test(s)) out.push('4K');
  else if (/\b(fhd|1080p?)\b/i.test(s)) out.push('1080p');
  else if (/\b(720p?)\b/i.test(s)) out.push('720p');
  else if (/\bhd\b/i.test(s)) out.push('HD');
  else if (/\b(sd|480p?)\b/i.test(s)) out.push('SD');
  if (/\b(hevc|h\.?265|x265)\b/i.test(s)) out.push('HEVC');
  if (/\b(hdr|dolby ?vision|dv)\b/i.test(s)) out.push('HDR');
  return out.join(' ');
}

export function bytes(n) {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i < 2 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function safeFile(s) {
  return String(s || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
