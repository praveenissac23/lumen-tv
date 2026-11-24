// Personal AllDebrid library and local play queues.
import { accounts } from '../torrents.js';
import { library, allItems, playlists, savedPlaylist, fileById, refreshLibrary, playableFile,
  savePlaylist, removePlaylist, addToPlaylist, movePlaylistItem } from '../debrid-library.js';
import { esc, bytes } from '../util.js';
import { icon, toast, sheet, form } from '../ui.js';
import { focus, focusFirst } from '../nav.js';
import { playVod } from '../player.js';

const displayName = (f) => f.name.split('/').pop();
const fileCard = (f, index = -1) => `<div class="db-card ${index === 0 ? 'db-first' : ''}">
  <span class="db-art">${index < 0 ? icon('film') : String(index + 1).padStart(2, '0')}</span>
  <span class="db-copy"><b>${esc(displayName(f))}</b><small>${esc(f.source === 'saved' ? 'Saved link' : f.magnetName || 'AllDebrid')} · ${bytes(f.size)}</small></span>
  <span class="db-actions"><button class="f db-button db-play" data-action="play" data-file="${esc(f.id)}">${icon('play')} Play</button>
  ${index < 0 ? `<button class="f db-button" data-action="add" data-file="${esc(f.id)}">${icon('plus')} Add to playlist</button>`
    : `<button class="f db-button" data-action="up" data-index="${index}">↑</button><button class="f db-button" data-action="down" data-index="${index}">↓</button><button class="f db-button" data-action="remove" data-index="${index}">Remove</button>`}</span></div>`;

export async function addFileToPlaylist(fileId) {
  const opts = playlists().map((p) => ({ label: p.name, hint: p.items.length + ' files', value: p.id }));
  opts.push({ label: 'Create new playlist', value: 'new', icon: 'plus' });
  const id = await sheet({ title: 'Add to playlist', options: opts });
  if (!id) return false;
  if (id === 'new') {
    const name = await form({ title: 'New Debrid playlist',
      fields: [{ name: 'name', label: 'Playlist name', required: true, value: '' }], submit: 'Create playlist' });
    if (!name?.name?.trim()) return false;
    savePlaylist({ id: 'db-' + Date.now().toString(36), name: name.name.trim().slice(0, 90), items: [fileId], autoplay: true });
  } else addToPlaylist(id, fileId);
  toast('Added to your playlist');
  return true;
}

export async function playDebrid(fileId, playlistId = '', app) {
  const p = savedPlaylist(playlistId);
  const index = p ? p.items.indexOf(fileId) : -1;
  toast('Getting a fresh AllDebrid playback link…');
  try {
    const item = await playableFile(fileId);
    const queue = p && p.autoplay !== false && index >= 0
      ? p.items.slice(index + 1).map((id) => ({
        item: { title: displayName(fileById(id) || { name: 'Next file' }) },
        key: 'debrid:' + id, prepare: () => playableFile(id),
      })) : [];
    // Play queues need the built-in player to detect the end of each video.
    playVod(item, 'debrid:' + fileId, () => app?.reload(), queue, { forceBuiltIn: true });
  } catch (e) { toast('Debrid playback: ' + e.message, 'err'); }
}

export class DebridScreen {
  constructor(view, params, app) {
    this.view = view; this.app = app; this.dead = false; this.mode = params.restore?.mode || 'files';
    this.playlistId = params.id || params.restore?.playlistId || '';
    this.query = params.restore?.query || '';
    this.sort = params.restore?.sort || 'recent';
    view.innerHTML = '<div class="db-page" data-scroll="y" data-pad="36"><div class="db-content"></div></div>';
    this.paint();
    this.listener = () => { if (!this.dead) this.paint(); };
    document.addEventListener('debrid-library-changed', this.listener);
    document.addEventListener('debrid-account-changed', this.listener);
    view.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) this.action(b); });
    view.addEventListener('focused', (e) => {
      // Remote navigation uses the app's transform-based scroll engine.
    });
    if (accounts().ad?.key) this.refresh(false);
  }
  async refresh(force) {
    if (!accounts().ad?.key) return;
    try { await refreshLibrary(force); } catch (e) { if (!this.dead) { this.error = e.message; this.paint(false); } }
  }
  paint(keepFocus = true) {
    const host = this.view.querySelector('.db-content'), old = keepFocus ? document.activeElement : null;
    const wasInView = !!old && this.view.contains(old);
    const scroll = keepFocus ? host._off || 0 : 0;
    const action = old?.dataset.action, id = old?.dataset.file, idx = old?.dataset.index;
    const connected = !!accounts().ad?.key;
    const p = savedPlaylist(this.playlistId);
    const snap = library();
    let html = `<div class="db-kicker">CONNECTED LIBRARY · ALLDEBRID</div>
      <div class="db-heading"><div><h1>${p ? esc(p.name) : 'Debrid library'}</h1>
      <p>${p ? 'Move files up or down to set your play order.' : 'Your AllDebrid uploads and saved video links appear here automatically.'}</p></div>
      <div class="db-glow">${icon('play')}</div></div>`;
    if (!connected) {
      html += '<div class="db-empty"><h2>Connect your AllDebrid account</h2><p>Once connected, your uploaded videos will appear here.</p><button class="f btn" data-action="settings">Open Debrid settings</button></div>';
    } else if (p) {
      const files = p.items.map(fileById).filter(Boolean);
      html += `<div class="db-hero"><button class="f db-mainplay" data-action="playall">${icon('play')} Play all from beginning</button>
        <span>${files.length} files · continues where you left off</span><button class="f db-toggle" data-action="autoplay">Autoplay next ${p.autoplay === false ? 'OFF' : 'ON'}</button></div>
        <div class="db-tools"><button class="f db-chip" data-action="back">← All files</button>
        <button class="f db-chip" data-action="addmore">+ Add more files</button>
        <button class="f db-chip" data-action="rename">Rename playlist</button>
        <button class="f db-chip" data-action="delete">Delete playlist</button></div>
        <div class="db-list">${files.length ? files.map((f, i) => fileCard(f, i)).join('') : '<div class="db-empty">No available videos in this playlist. Add one from your library.</div>'}</div>`;
      const missing = p.items.length - files.length;
      if (missing) html += `<p class="db-note">${missing} item(s) are missing from AllDebrid. Refresh the library to check again.</p>`;
    } else {
      const files = allItems().filter((f) => f.name.toLowerCase().includes(this.query.toLowerCase()));
      if (this.sort === 'name') files.sort((a,b) => a.name.localeCompare(b.name));
      html += `<div class="db-stats"><div><b>${snap.magnets.length}</b><small>Cloud uploads</small></div>
        <div><b>${snap.files.length}</b><small>Playable files</small></div><div><b>${playlists().length}</b><small>My playlists</small></div></div>
        <div class="db-tools"><button class="f db-chip ${this.mode === 'files' ? 'active' : ''}" data-action="files">All files</button>
          <button class="f db-chip ${this.mode === 'playlists' ? 'active' : ''}" data-action="playlists">My playlists</button>
          <button class="f db-chip" data-action="refresh">${icon('refresh')} Refresh</button>
          <button class="f db-chip" data-action="sort">Sort: ${this.sort === 'name' ? 'Name' : 'Newest'}</button></div>`;
      if (this.mode === 'playlists') {
        html += '<div class="db-section">Your play queues</div><div class="db-list">' +
          playlists().map((pl) => `<button class="f db-collection" data-action="open" data-id="${esc(pl.id)}"><span class="db-art">${icon('list')}</span><span><b>${esc(pl.name)}</b><small>${pl.items.length} files · Autoplay ${pl.autoplay === false ? 'off' : 'on'}</small></span><span>Open →</span></button>`).join('') +
          '<button class="f db-chip" data-action="new">+ Create playlist</button></div>';
      } else {
        html += `<div class="db-section">All playable files <small>${files.length}</small></div>
          <div class="db-list">${files.map((f) => fileCard(f)).join('') || '<div class="db-empty">No video files yet. Add a magnet in AllDebrid and press Refresh.</div>'}</div>`;
        const pending = snap.magnets.filter((m) => +m.statusCode !== 4);
        if (pending.length) html += `<div class="db-section">Processing uploads <small>${pending.length}</small></div>
          ${pending.map((m) => `<div class="db-card"><span class="db-art">${icon('download')}</span><span class="db-copy"><b>${esc(m.filename || 'Preparing upload')}</b><small>${esc(m.status || 'Processing')}</small></span></div>`).join('')}`;
      }
    }
    if (this.error) html += `<p class="db-note">${esc(this.error)} · Try Refresh.</p>`;
    host.innerHTML = html;
    host._off = scroll; host.style.transform = scroll ? `translate3d(0,${scroll}px,0)` : '';
    const same = [...host.querySelectorAll('[data-action]')].find((b) => b.dataset.action === action && b.dataset.file === id && b.dataset.index === idx);
    if (wasInView) focus(same || host.querySelector('.f'));
  }
  async action(b) {
    const a = b.dataset.action, p = savedPlaylist(this.playlistId), id = b.dataset.file;
    if (a === 'settings') return this.app.go('settings', { restore: { sec: 'debrid' } });
    if (a === 'refresh') { toast('Refreshing your AllDebrid library…'); return this.refresh(true); }
    if (a === 'files' || a === 'playlists') { this.mode = a; this.playlistId = ''; return this.paint(); }
    if (a === 'sort') { this.sort = this.sort === 'name' ? 'recent' : 'name'; return this.paint(); }
    if (a === 'addmore' || a === 'back') { this.playlistId = ''; this.mode = 'files'; return this.paint(); }
    if (a === 'open') { this.playlistId = b.dataset.id; return this.paint(); }
    if (a === 'add') { if (await addFileToPlaylist(id)) this.paint(); return; }
    if (a === 'play') return playDebrid(id, p?.id || '', this.app);
    if (a === 'playall') { const first = p.items.find(fileById); if (first) return playDebrid(first, p.id, this.app); return toast('Add a playable file first'); }
    if (a === 'autoplay') { savePlaylist({ ...p, autoplay: p.autoplay === false }); return this.paint(); }
    if (a === 'up' || a === 'down') { movePlaylistItem(p.id, +b.dataset.index, a === 'up' ? -1 : 1); return this.paint(); }
    if (a === 'remove') { const items = [...p.items]; items.splice(+b.dataset.index, 1); savePlaylist({ ...p, items }); return this.paint(); }
    if (a === 'new' || a === 'rename') {
      const result = await form({ title: a === 'new' ? 'New Debrid playlist' : 'Rename playlist',
        fields: [{ name: 'name', label: 'Name', value: p?.name || '', required: true }], submit: 'Save' });
      if (result?.name?.trim()) { const next = p || { id: 'db-' + Date.now().toString(36), items: [], autoplay: true };
        savePlaylist({ ...next, name: result.name.trim().slice(0, 90) }); this.playlistId = next.id; this.paint(); }
      return;
    }
    if (a === 'delete') {
      const choice = await sheet({ title: 'Delete this playlist?', options: [
        { label: 'Keep playlist', value: 'keep' }, { label: 'Delete playlist only', value: 'delete', hint: 'Videos stay in AllDebrid' },
      ] });
      if (choice === 'delete') { removePlaylist(p.id); this.playlistId = ''; this.mode = 'playlists'; this.paint(); }
    }
  }
  focus() { focusFirst(this.view); }
  save() { return { mode: this.mode, playlistId: this.playlistId, query: this.query, sort: this.sort }; }
  destroy() { this.dead = true; document.removeEventListener('debrid-library-changed', this.listener);
    document.removeEventListener('debrid-account-changed', this.listener); }
}
