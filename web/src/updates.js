// Checks GitHub for a newer build of the app and installs it with one press.
import * as N from './native.js';
import { setting } from './store.js';
import { el, esc } from './util.js';
import { icon, toast } from './ui.js';
import { pushLayer, popLayer, focus } from './nav.js';

const REPO = 'praveenissac23/lumen-tv';
// TV builds are tagged build-N (an .apk); Mac builds mac-build-N (a .zip). Each app looks for its own.
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const isMac = () => N.device().platform === 'mac';

export const update = { available: null, checkedAt: 0 };

export function currentBuild() {
  const d = N.device();
  return +d.versionCode || 0;
}

// Returns {build, notes, url} when a newer build exists, otherwise null.
export async function checkForUpdate({ quiet = true } = {}) {
  try {
    const list = JSON.parse(await N.http(API, { timeout: 15000 }));
    update.checkedAt = Date.now();
    const mac = isMac();
    const want = mac ? /^mac-build-\d+$/ : /^build-\d+$/;
    const file = mac ? /\.zip$/i : /\.apk$/i;
    const r = (Array.isArray(list) ? list : []).filter((x) => want.test(x.tag_name || '') && !x.draft)
      .sort((a, b) => (+b.tag_name.replace(/\D/g, '')) - (+a.tag_name.replace(/\D/g, '')))[0] || {};
    const build = +String(r.tag_name || '').replace(/\D/g, '') || 0;
    const asset = (r.assets || []).find((a) => file.test(a.name));
    if (!asset || build <= currentBuild()) {
      update.available = null;
      if (!quiet) toast(`You have the latest version (build ${currentBuild() || '?'})`);
      return null;
    }
    update.available = { build, notes: (r.body || '').slice(0, 400), url: asset.browser_download_url, size: asset.size };
    document.dispatchEvent(new CustomEvent('update-available'));
    return update.available;
  } catch (e) {
    if (!quiet) toast('Couldn’t check for updates. Check the internet connection.', 'err');
    return null;
  }
}

// Check on start, hourly, and when the app comes back to the screen.
// With "Update the app automatically" on (TV), a new build downloads by itself and
// Android's Install screen appears: one press. Never while something is playing.
async function autoUpdate() {
  const u = await checkForUpdate();
  if (!u || isMac() || setting('autoAppUpdate') === false || update.autoTried === u.build) return;
  if (document.body.classList.contains('playing') || document.querySelector('#overlays .sheet-wrap')) {
    setTimeout(autoUpdate, 60 * 1000);          // try again once playback / menus are closed
    return;
  }
  update.autoTried = u.build;
  const s = installUpdate();
  if (s && N.device().canInstall !== false) { const b = s.root.querySelector('[data-a=go]'); if (b) b.click(); }
}
export function startUpdateChecks() {
  if (!N.isNative || setting('autoUpdateCheck') === false) return;
  setTimeout(autoUpdate, 5000);
  setInterval(autoUpdate, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - update.checkedAt > 10 * 60 * 1000) autoUpdate(); });
}

// Full-screen update sheet: permission check first (Fire TV), progress, a step-by-step log,
// and other ways to install if the TV refuses the first one.
const PERM_STEPS = 'Press Home, open Settings > My Fire TV > Developer options > Install unknown apps, and switch Lumen TV on. (No Developer options? Settings > My Fire TV > About: select your Fire TV’s name 7 times.)';
export function installUpdate() {
  const u = update.available;
  if (!u) return;
  const mac = isMac();
  const root = el(`<div class="sheet-wrap center" data-trap><div class="sheet update-sheet">
    <div class="pin-head">${icon('download')}<div><h2>Update to build ${u.build}</h2><p>You have build ${currentBuild()}. Your settings and favourites stay.</p></div></div>
    ${u.notes ? `<p class="update-notes">${esc(u.notes)}</p>` : ''}
    <div class="upd-perm" hidden><p><b>One-time step:</b> ${esc(PERM_STEPS)}</p></div>
    <div class="update-progress" hidden><span class="bar"><i style="width:0%"></i></span><small id="upd-pct">Starting download</small></div>
    <ol class="upd-log" hidden></ol>
    <div class="form-actions" data-group="updbtns">
      <button class="f btn primary" data-a="go">${icon('download')}Install update</button>
      <button class="f btn" data-a="recheck" hidden>${icon('refresh')}I’ve switched it on</button>
      <button class="f btn" data-a="amazon" hidden>Amazon installer</button>
      <button class="f btn" data-a="downloader" hidden>Downloader app</button>
      <button class="f btn" data-a="later">Later</button></div>
  </div></div>`);
  document.getElementById('overlays').appendChild(root);
  const q = (s2) => root.querySelector(s2);
  const close = () => { popLayer(layer); root.remove(); };
  const layer = { root, modal: true, onKey: (k) => { if (k === 'back') { close(); return true; } return false; } };
  const showOthers = () => {
    if (mac) return;
    q('[data-a=amazon]').hidden = false;
    if (N.device().downloader) q('[data-a=downloader]').hidden = false;
  };
  const permOk = () => mac || N.device().canInstall !== false;
  const needPerm = () => {
    q('.upd-perm').hidden = false; q('[data-a=recheck]').hidden = false; q('[data-a=go]').hidden = true;
    showOthers();
    focus(q('[data-a=recheck]'));
  };
  const start = (mode) => {
    q('.update-progress').hidden = false; q('.upd-log').hidden = false;
    q('[data-a=go]').hidden = true; q('[data-a=recheck]').hidden = true; q('.upd-perm').hidden = true;
    focus(q('[data-a=later]'));
    N.installUpdateWith(u.url, mode);
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'later') return close();
    if (a === 'go' || a === 'recheck') { if (!permOk()) { needPerm(); if (a === 'recheck') toast('Lumen TV still isn’t allowed to install apps', 'err'); return; } start('auto'); }
    if (a === 'amazon') start('amazon');
    if (a === 'downloader') start('downloader');
  });
  pushLayer(layer);
  // Fire TV: ask for the permission before downloading, instead of a screen that flickers shut
  if (!permOk()) needPerm(); else focus(q('[data-a=go]'));
  installUpdate.showOthers = showOthers;
  return { root, close };
}

N.on('update', (d) => {
  const pct = document.getElementById('upd-pct');
  const bar = document.querySelector('.update-progress .bar i');
  const log = document.querySelector('.upd-log');
  if (d.state === 'log' && log) { log.hidden = false; log.insertAdjacentHTML('beforeend', `<li>${esc(d.text)}</li>`); }
  if (d.state === 'downloading') { if (bar) bar.style.width = d.pct + '%'; if (pct) pct.textContent = `Downloading ${d.pct}%`; }
  if (d.state === 'installing' && pct) pct.textContent = isMac() ? 'Installing. Lumen TV will restart in a moment.' : 'Choose Install (or Update) on the next screen. Lumen TV reopens by itself when it’s done.';
  if ((d.state === 'permission' || d.state === 'permission-manual') && pct) pct.textContent = 'One time only: ' + PERM_STEPS;
  if (d.state === 'error') {
    if (pct) pct.textContent = `Update failed: ${d.msg}`;
    toast(`Update failed: ${d.msg}`, 'err');
    if (installUpdate.showOthers) installUpdate.showOthers();
    const b = document.querySelector('.update-sheet [data-a=amazon]:not([hidden]), .update-sheet [data-a=downloader]:not([hidden])');
    if (b) focus(b);
  }
});
