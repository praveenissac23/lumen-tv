// Wallpapers, slowly drifting bubbles and highlight colour.
import { setting } from './store.js';
import { esc } from './util.js';

export const WALLPAPERS = [
  { id: 'bubbles', name: 'Midnight bubbles' },
  { id: 'plain', name: 'Plain dark' },
  { id: 'teal', name: 'Deep teal' },
  { id: 'plum', name: 'Plum' },
  { id: 'dusk', name: 'Desert dusk' },
  { id: 'forest', name: 'Kerala green' },
  { id: 'image', name: 'Your picture' },
];
// Whole-app colour themes: background, surfaces, highlight and glow together.
export const THEMES = [
  { id: 'cinema', name: 'Cinema', sub: 'Ember red to amber, on black', a: '#ff2f45', b: '#ffc15c', bg: '#0a0809' },
  { id: 'aurora', name: 'Aurora', sub: 'Cyan and violet northern lights', a: '#2bf0d0', b: '#9b6bff', bg: '#060a14' },
  { id: 'royal', name: 'Royal', sub: 'Gold on warm black', a: '#b8862c', b: '#fff0c2', bg: '#0b0a09' },
  { id: 'neon', name: 'Neon', sub: 'Magenta and electric blue', a: '#ff2fa0', b: '#3f7bff', bg: '#08050f' },
  { id: 'classic', name: 'Classic', sub: 'Your wallpaper and highlight colour below', a: '#cfa968', b: '#e6c88f', bg: '#12161b' },
];
export const ACCENTS = [
  { id: 'brass', name: 'Brass', c: '#cfa968', c2: '#e6c88f', on: '#1d160a' },
  { id: 'teal', name: 'Lagoon', c: '#5cc4b4', c2: '#8fdccf', on: '#06201c' },
  { id: 'coral', name: 'Coral', c: '#ec8a6e', c2: '#f4ad97', on: '#2a0f07' },
  { id: 'violet', name: 'Violet', c: '#a996ee', c2: '#c6b8f5', on: '#160f2e' },
  { id: 'sky', name: 'Sky', c: '#72b6ea', c2: '#a1cff2', on: '#071a2a' },
];

// Bubble layout: position, size, colour mix and drift timing. Few, large and soft.
const BUBBLES = [
  [8, 18, 520, 'a', 95, 0], [70, 8, 640, 'b', 120, -30], [42, 70, 760, 'c', 140, -60],
  [88, 62, 420, 'a', 105, -15], [22, 88, 380, 'b', 130, -45], [55, 32, 300, 'c', 110, -80],
];

export function mountBackground() {
  const stage = document.getElementById('stage');
  let bg = document.getElementById('bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'bg';
    bg.innerHTML = `<div class="bg-img"></div><div class="bubbles">${BUBBLES.map(([x, y, s, c, d, delay], i) =>
      `<i class="bub b${c}" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;animation-duration:${d}s;animation-delay:${delay}s;--dx:${i % 2 ? -1 : 1}"></i>`).join('')}</div>`;
    stage.insertBefore(bg, stage.querySelector('#hole'));
  }
  applyLook();
}

export function applyLook() {
  const st = document.getElementById('stage');
  const theme = setting('theme') || 'classic';
  const themed = theme !== 'classic';
  if (themed) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  const wp = themed ? 'theme' : setting('wallpaper') || 'bubbles';
  st.dataset.wp = wp;
  st.classList.toggle('motion', !!setting('motion') && (wp === 'bubbles' || wp === 'teal' || wp === 'plum' || wp === 'dusk' || wp === 'forest'));
  const img = document.querySelector('#bg .bg-img');
  if (img) img.style.backgroundImage = wp === 'image' && setting('wallpaperUrl') ? `url("${esc(setting('wallpaperUrl'))}")` : '';
  const a = ACCENTS.find((x) => x.id === setting('accent')) || ACCENTS[0];
  const r = document.documentElement.style;
  if (themed) { for (const k of ['--brass', '--brass-2', '--on-brass', '--glow']) r.removeProperty(k); return; }
  r.setProperty('--brass', a.c); r.setProperty('--brass-2', a.c2); r.setProperty('--on-brass', a.on);
  r.setProperty('--glow', a.c + '73');
}

// Cut a window in the wallpaper so the video preview underneath shows through.
export function bgHole(rect) {
  const bg = document.getElementById('bg');
  if (!bg) return;
  if (!rect) { bg.style.clipPath = ''; return; }
  const { x, y, w, h } = rect;
  bg.style.clipPath = `polygon(evenodd, 0 0, 1920px 0, 1920px 1080px, 0 1080px, 0 0, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
}
