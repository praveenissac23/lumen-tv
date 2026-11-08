// Full-screen YouTube trailer inside the app (the same warm-start player page as the home banner).
import { pushLayer, popLayer } from './nav.js';
import { toast } from './ui.js';
import { esc } from './util.js';

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
  const id = ytId(trailer);
  if (!id) { toast('No trailer for this title'); return; }
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
    if (m.ev === 'ready') send({ cmd: 'play', id, start: 0 });
    // uncover once it has been playing long enough for YouTube's start-up buttons to go
    if (m.ev === 'playing' && !ov.classList.contains('on')) setTimeout(() => ov.classList.add('on'), 2200);
    if (m.ev === 'ended') closeTrailer();
    if (m.ev === 'error') { closeTrailer(); toast("This trailer can't be played"); }
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
