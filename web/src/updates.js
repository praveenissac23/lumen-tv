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

// Check on start, then every 6 hours while the app is open.
export function startUpdateChecks() {
  if (!N.isNative || setting('autoUpdateCheck') === false) return;
  setTimeout(() => checkForUpdate(), 4000);
  setInterval(() => checkForUpdate(), 60 * 60 * 1000);
  // also whenever the app comes back to the screen, at most every 10 minutes
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - update.checkedAt > 10 * 60 * 1000) checkForUpdate(); });
}

// Full-screen confirmation with download progress.
export function installUpdate() {
  const u = update.available;
  if (!u) return;
  const root = el(`<div class="sheet-wrap center" data-trap><div class="sheet update-sheet">
    <div class="pin-head">${icon('download')}<div><h2>Update to build ${u.build}</h2><p>You have build ${currentBuild()}. Your settings and favourites stay.</p></div></div>
    ${u.notes ? `<p class="update-notes">${esc(u.notes)}</p>` : ''}
    <div class="update-progress" hidden><span class="bar"><i style="width:0%"></i></span><small id="upd-pct">Starting download</small></div>
    <div class="form-actions"><button class="f btn primary" data-a="go">${icon('download')}Install update</button><button class="f btn" data-a="later">Later</button></div>
  </div></div>`);
  document.getElementById('overlays').appendChild(root);
  const close = () => { popLayer(layer); root.remove(); N.on('update', () => {}); };
  const layer = { root, modal: true, onKey: (k) => { if (k === 'back') { close(); return true; } return false; } };
  const prog = root.querySelector('.update-progress');
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'later') return close();
    prog.hidden = false;
    b.disabled = true;
    N.installUpdate(u.url);
  });
  pushLayer(layer);
  focus(root.querySelector('[data-a=go]'));
  return { root, prog, close };
}

N.on('update', (d) => {
  const pct = document.getElementById('upd-pct');
  const bar = document.querySelector('.update-progress .bar i');
  if (d.state === 'downloading') { if (bar) bar.style.width = d.pct + '%'; if (pct) pct.textContent = `Downloading ${d.pct}%`; }
  if (d.state === 'installing' && pct) pct.textContent = isMac() ? 'Installing. Lumen TV will restart in a moment.' : 'Choose Install (or Update) on the next screen. Lumen TV reopens by itself when it’s done.';
  if (d.state === 'permission' && pct) pct.textContent = 'One time only: switch Lumen TV on (Allow / Install unknown apps), then press Back. The update continues by itself.';
  if (d.state === 'permission-manual' && pct) pct.textContent = 'One time only: on the TV open Settings > My Fire TV > Developer options > Install unknown apps, switch Lumen TV on, then come back and press Install update again.';
  if (d.state === 'error') { if (pct) pct.textContent = `Update failed: ${d.msg}`; toast(`Update failed: ${d.msg}`, 'err'); }
});
