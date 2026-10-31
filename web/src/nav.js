// Remote-control input: key normalisation, layer stack, spatial focus movement.
import { on as onNative } from './native.js';

const layers = [];            // [{root, onKey, name}]
export function pushLayer(layer) { layers.push(layer); }
export function popLayer(layer) { const i = layers.lastIndexOf(layer); if (i >= 0) layers.splice(i, 1); }
export function topLayer() { return layers[layers.length - 1]; }
export function clearLayers() { layers.length = 0; }

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', NumpadEnter: 'ok', ' ': 'ok',
  Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
  ContextMenu: 'menu', F1: 'menu', MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause',
  MediaRewind: 'rew', MediaFastForward: 'ffwd', MediaTrackNext: 'ffwd', MediaTrackPrevious: 'rew',
  ChannelUp: 'chup', ChannelDown: 'chdown', PageUp: 'chup', PageDown: 'chdown',
  BrowserSearch: 'search', F2: 'search', Info: 'info', F3: 'guide', Guide: 'guide',
  ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
};

let okDown = 0, okTimer = null, okHeld = false;

function dispatch(name, e) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    if (L.onKey && L.onKey(name, e) === true) return true;
    if (L.modal) break;
  }
  const L = topLayer();
  if (L && ['up', 'down', 'left', 'right'].includes(name)) return move(name, L.root);
  if (name === 'ok') { const a = document.activeElement; if (a && a.classList.contains('f')) { a.click(); return true; } }
  return false;
}

export function initInput() {
  document.addEventListener('keydown', (e) => {
    const inInput = e.target && (e.target.tagName === 'INPUT');
    let name = KEYMAP[e.key];
    if (!name && /^[0-9]$/.test(e.key)) name = 'd' + e.key;
    if (!name && e.keyCode === 4) name = 'back';
    // Computer keyboard: typing a letter anywhere starts a search
    if (!name && !inInput && window.__desktop && e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); dispatch('char:' + e.key, e); return;
    }
    if (!name) return;
    if (inInput) {
      // let typing work; Backspace edits, arrows leave the field vertically
      if (name === 'back' && e.key === 'Backspace' && e.target.value) return;
      if (name === 'left' || name === 'right' || /^d/.test(name)) return;
      if (name === 'ok') { e.preventDefault(); dispatch('submit', e); return; }
    }
    e.preventDefault();
    if (name === 'ok' && !inInput) {
      if (e.repeat) return;
      okDown = performance.now(); okHeld = false;
      clearTimeout(okTimer);
      okTimer = setTimeout(() => { okHeld = true; dispatch('hold', e); }, 650);
      return;
    }
    dispatch(name, e);
  }, true);
  document.addEventListener('keyup', (e) => {
    if (KEYMAP[e.key] !== 'ok' || (e.target && e.target.tagName === 'INPUT')) return;
    clearTimeout(okTimer);
    if (!okHeld && okDown) dispatch('ok', e);
    okDown = 0;
  }, true);
  onNative('key', (d) => dispatch(d.name, null));
  // Pointer/touch support (phones, testing): click = ok on focusable
  document.addEventListener('mouseover', (e) => {
    const f = e.target.closest && e.target.closest('.f');
    if (f && f !== document.activeElement && !f.closest('[aria-hidden="true"]')) focus(f, { noScroll: true });
  });
}

export function sendKey(name) { return dispatch(name, null); }

// ---------- focus ----------
export function focus(elm, { noScroll = false } = {}) {
  if (!elm) return;
  const prev = document.activeElement;
  elm.focus({ preventScroll: true });
  const g = elm.closest('[data-group]');
  if (g) g._last = elm;
  if (!noScroll) reveal(elm);
  if (prev !== elm) elm.dispatchEvent(new CustomEvent('focused', { bubbles: true }));
}

function visible(elm) {
  if (elm.disabled || elm.hidden) return false;
  const r = elm.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(root) {
  return Array.from(root.querySelectorAll('.f')).filter(visible);
}

export function focusFirst(root, sel) {
  const t = (sel && root.querySelector(sel)) || focusables(root)[0];
  if (t) focus(t);
  return t;
}

// Move focus in a direction using geometry, honouring group memory.
export function move(dir, root) {
  const cur = document.activeElement;
  if (!cur || !root.contains(cur) || !cur.classList.contains('f')) { focusFirst(root); return true; }
  // Fast path: left/right inside a sideways row just steps to the neighbouring tile
  // (measuring every button on a busy screen for each key press is what makes a TV stick lag).
  if ((dir === 'left' || dir === 'right') && cur.parentElement && cur.parentElement.parentElement &&
      cur.parentElement.parentElement.dataset.scroll === 'x') {
    let n = dir === 'right' ? cur.nextElementSibling : cur.previousElementSibling;
    while (n && !(n.classList.contains('f') && !n.disabled && !n.hidden)) n = dir === 'right' ? n.nextElementSibling : n.previousElementSibling;
    if (n) { focus(n); return true; }
  }
  const scope = cur.closest('[data-trap]') || root;
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  // Gather candidates that lie in the direction of travel.
  // Up/down never leave a zone (e.g. from the screen into the navigation rail).
  const zone = cur.closest('[data-zone]');
  const cands = [];
  for (const el of focusables(scope)) {
    if (el === cur) continue;
    if ((dir === 'up' || dir === 'down') && el.closest('[data-zone]') !== zone) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let main, cross, beam;
    if (dir === 'right') { if (b.left < a.right - 4 && bx <= ax + 1) continue; main = b.left - a.right; beam = overlap(a.top, a.bottom, b.top, b.bottom); cross = beam ? 0 : Math.abs(by - ay); }
    else if (dir === 'left') { if (b.right > a.left + 4 && bx >= ax - 1) continue; main = a.left - b.right; beam = overlap(a.top, a.bottom, b.top, b.bottom); cross = beam ? 0 : Math.abs(by - ay); }
    else if (dir === 'down') { if (b.top < a.bottom - 4 && by <= ay + 1) continue; main = b.top - a.bottom; beam = overlap(a.left, a.right, b.left, b.right); cross = Math.abs(bx - ax); }
    else { if (b.bottom > a.top + 4 && by >= ay - 1) continue; main = a.top - b.bottom; beam = overlap(a.left, a.right, b.left, b.right); cross = Math.abs(bx - ax); }
    cands.push({ el, main: Math.max(0, main), cross, beam });
  }
  let best = null, bestScore = Infinity;
  if (dir === 'up' || dir === 'down') {
    // Vertical moves go to the nearest row first, then the closest item within it.
    const nearest = Math.min(Infinity, ...cands.map((c) => c.main));
    for (const c of cands) {
      if (c.main > nearest + 48) continue;
      const s = c.cross * (c.beam ? 0.3 : 1);
      if (s < bestScore) { bestScore = s; best = c.el; }
    }
  } else {
    // Horizontal moves stay in the row (beam) before jumping elsewhere.
    for (const c of cands) {
      const s = c.main + c.cross * 2.2 + (c.beam ? 0 : 100000);
      if (s < bestScore) { bestScore = s; best = c.el; }
    }
  }
  if (!best) {
    cur.dispatchEvent(new CustomEvent('edge', { bubbles: true, detail: dir }));
    return true;
  }
  // entering a remembered group
  const g = best.closest('[data-group]');
  if (g && g !== cur.closest('[data-group]') && g._last && g._last.isConnected && visible(g._last)) best = g._last;
  focus(best);
  return true;
}
const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) > 8;

// Keep the focused element inside its scrolling ancestors.
// data-scroll="x" | "y" containers move their first child (the track, position:relative)
// with a transform. Layout offsets are used so in-flight animations don't skew the maths.
function offsetWithin(elm, track) {
  let x = 0, y = 0, n = elm;
  while (n && n !== track) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y };
}
export function reveal(elm) {
  let node = elm.parentElement;
  while (node && node !== document.body) {
    const axis = node.dataset && node.dataset.scroll;
    if (axis) {
      const track = node.firstElementChild;
      if (track && track.contains(elm)) {
        const pad = +(node.dataset.pad || 0);
        const off = track._off || 0;
        const o = offsetWithin(elm, track);
        const x = axis === 'x';
        const start = x ? o.x : o.y, size = x ? elm.offsetWidth : elm.offsetHeight;
        const W = x ? node.offsetWidth : node.offsetHeight;
        const full = x ? Math.max(track.scrollWidth, track.offsetWidth) : Math.max(track.scrollHeight, track.offsetHeight);
        let next = off;
        if (node.dataset.anchor === 'start') next = -(start - pad);
        else if (start + size > -off + W - pad) next = -(start + size - W + pad);
        else if (start < -off + pad) next = -(start - pad);
        next = Math.max(-Math.max(0, full - W), Math.min(0, next));
        if (next !== off) { track._off = next; track.style.transform = x ? `translate3d(${next}px,0,0)` : `translate3d(0,${next}px,0)`; }
      }
    }
    node = node.parentElement;
  }
}
export function resetScroll(node) {
  const track = node && node.firstElementChild;
  if (track) { track._off = 0; track.style.transform = ''; }
}
