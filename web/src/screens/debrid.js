// Personal AllDebrid library and local play queues.
import { accounts } from '../torrents.js';
import { library, allItems, seriesGroups, playlists, savedPlaylist, fileById, refreshLibrary, playableFile,
  savePlaylist, removePlaylist, addToPlaylist, movePlaylistItem } from '../debrid-library.js';
import { esc, bytes } from '../util.js';
import { progressOf } from '../store.js';
import { icon, toast, sheet, form } from '../ui.js';
import { focus, focusFirst } from '../nav.js';
import { playVod } from '../player.js';
import * as N from '../native.js';
import { hasAutoProvider, searchSubs, subtitleLink, subtitleCatExisting, subtitleCatQuery, langName, cachedSubtitle, rememberSubtitle } from '../subs.js';

const displayName = (f) => f.name.split('/').pop();
const groupCard = (g) => `<button class="f db-collection" data-action="open-series" data-id="${esc(g.id)}"><span class="db-art">${icon('series')}</span><span><b>${esc(g.title)}</b><small>Season ${g.season} · ${g.files.length} videos · episode order ready</small></span><span>Open →</span></button>`;
function continueAt(files) {
  let last = -1;
  files.forEach((f, i) => { if ((progressOf('debrid:' + f.id)?.pos || 0) > 0) last = i; });
  if (last < 0) return 0;
  const progress = progressOf('debrid:' + files[last].id);
  return progress.dur > 0 && progress.dur - progress.pos < 120000 ? (last + 1) % files.length : last;
}
const fileCard = (f, index = -1, position = 0) => `<div class="db-card ${index === 0 || position === 1 ? 'db-first' : ''}">
  <span class="db-art">${index < 0 && !position ? icon('film') : String(position || index + 1).padStart(2, '0')}</span>
  <span class="db-copy"><b>${esc(displayName(f))}</b><small>${esc(f.source === 'saved' ? 'Saved link' : f.magnetName || 'AllDebrid')} · ${bytes(f.size)}</small></span>
  <span class="db-actions"><button class="f db-button db-play" data-action="play" data-file="${esc(f.id)}">${icon('play')} Play</button>
  ${index < 0 ? `<button class="f db-button" data-action="add" data-file="${esc(f.id)}">${icon('plus')} Add to playlist</button>`
    : `<button class="f db-button" data-action="up" data-index="${index}">↑</button><button class="f db-button" data-action="down" data-index="${index}">↓</button><button class="f db-button" data-action="remove" data-index="${index}">Remove</button>`}
  <button class="f db-button" data-action="download" data-file="${esc(f.id)}">${icon('download')} Download</button></span></div>`;

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

export async function playDebrid(fileId, playlistId = '', app, groupIds = null) {
  const p = savedPlaylist(playlistId) || (groupIds ? { items: groupIds, autoplay: true } : null);
  const index = p ? p.items.indexOf(fileId) : -1;
  const choices = [{ label: 'Lumen TV player', hint: index >= 0 && p.autoplay !== false ? 'Plays the next playlist file automatically' : 'Plays here with online subtitles', value: 'lumen', icon: 'play' },
    ...N.installedApps().filter((a) => a.role === 'player').flatMap((a) => [
      { label: a.name, hint: 'Searches English subtitles automatically', value: a.pkg, icon: 'external' },
      { label: `${a.name} · Malayalam subtitles`, hint: 'Search Malayalam only when selected', value: a.pkg + '|ml', icon: 'subtitles' },
    ])];
  const chosen = await sheet({ title: 'Play in which player?', options: choices });
  if (!chosen) return;
  const language = chosen.endsWith('|ml') ? 'ml' : 'en';
  const playerPkg = chosen.replace(/\|ml$/, '');
  toast('Getting a fresh AllDebrid playback link…');
  try {
    const item = await playableFile(fileId);
    let subtitle = chosen !== 'lumen' ? cachedSubtitle(item, language) : '';
    if (chosen !== 'lumen' && !subtitle) {
      const lang = language;
      toast(`Finding ${langName(lang)} subtitles…`);
      try {
        const bundled = /\bEP\s*\(\d+\s*-\s*\d+\)/i.test(item.title);
        const cat = !bundled ? await subtitleCatExisting(item, lang).catch(() => '') : '';
        if (cat) subtitle = await rememberSubtitle(item, lang, { source: 'SubtitleCat', url: cat }, cat);
        else {
          const matches = hasAutoProvider() ? await Promise.race([searchSubs({ title: item.title, url: item.url }, [lang], { automatic: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Subtitle search timed out')), 15000))]) : [];
          if (matches.length) {
            const found = await subtitleLink(matches[0]);
            subtitle = await rememberSubtitle(item, lang, matches[0], found.link);
          } else if (lang === 'ml') {
            const searchUrl = 'https://www.subtitlecat.com/index.php?search=' + encodeURIComponent(subtitleCatQuery(item.title));
            if (N.openSubtitleCat(searchUrl, item.url, playerPkg, item.title)) return;
            throw new Error('The subtitle browser is unavailable on this device.');
          } else toast('No English subtitle found on SubtitleCat. Add a free SubDL key in Settings for another automatic source.', 'err');
        }
      } catch (e) {
        if (lang === 'ml') {
          const choice = await sheet({ title: 'Malayalam subtitle unavailable', options: [
            { label: 'Play without Malayalam subtitles', hint: e.message, value: 'play' },
            { label: 'Cancel', value: 'cancel' },
          ] });
          if (choice !== 'play') return;
        } else toast(`Subtitles unavailable: ${e.message}. Opening the video.`, 'err');
      }
    }
    const queue = p && p.autoplay !== false && index >= 0
      ? p.items.slice(index + 1).map((id) => ({
        item: { title: displayName(fileById(id) || { name: 'Next file' }) },
        key: 'debrid:' + id, prepare: () => playableFile(id),
      })) : [];
    // Play queues need the built-in player to detect the end of each video.
    playVod(item, 'debrid:' + fileId, () => app?.reload(), chosen === 'lumen' ? queue : [],
      { forceBuiltIn: chosen === 'lumen', playerPkg: chosen === 'lumen' ? null : playerPkg, subtitle });
  } catch (e) { toast('Debrid playback: ' + e.message, 'err'); }
}

export async function downloadDebrid(fileId) {
  const f = fileById(fileId);
  if (!f) return toast('Refresh the Debrid library and try again.', 'err');
  const managers = N.installedApps().filter((a) => a.role === 'download');
  const pkg = await sheet({ title: 'Download with', options: [
    ...managers.map((a) => ({ label: a.name, value: a.pkg, icon: 'download' })),
    { label: 'Choose another download app', value: 'chooser', icon: 'external' },
  ] });
  if (!pkg) return;
  try {
    toast('Getting a fresh download link…');
    const item = await playableFile(fileId);
    const ok = N.openWith(pkg === 'chooser' ? '' : pkg, item.url,
      { title: displayName(f), file: displayName(f), mode: 'download' });
    if (ok === false) toast('That download app could not open the link.', 'err');
  } catch (e) { toast('Debrid download: ' + e.message, 'err'); }
}

export class DebridScreen {
  constructor(view, params, app) {
    this.view = view; this.app = app; this.dead = false; this.mode = params.restore?.mode || 'files';
    this.playlistId = params.id || params.restore?.playlistId || '';
    this.seriesId = params.restore?.seriesId || '';
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
    this.timer = setInterval(() => { if (!this.dead && accounts().ad?.key) this.refresh(false); }, 60000);
  }
  async refresh(force) {
    if (!accounts().ad?.key) return;
    try { await refreshLibrary(force); } catch (e) { if (!this.dead) { this.error = e.message; this.paint(false); } }
  }
  paint(keepFocus = true) {
    const host = this.view.querySelector('.db-content'), old = keepFocus ? (this.restoreFocus || document.activeElement) : null;
    this.restoreFocus = null;
    const wasInView = !!old && this.view.contains(old);
    const scroll = keepFocus ? host._off || 0 : 0;
    const action = old?.dataset.action, id = old?.dataset.file, idx = old?.dataset.index;
    const connected = !!accounts().ad?.key;
    const p = savedPlaylist(this.playlistId);
    const snap = library();
    const groups = seriesGroups(snap.files);
    const group = groups.find((g) => g.id === this.seriesId);
    let html = `<div class="db-kicker">CONNECTED LIBRARY · ALLDEBRID</div>
      <div class="db-heading"><div><h1>${p ? esc(p.name) : group ? esc(group.title) : 'Debrid library'}</h1>
      <p>${p ? 'Move files up or down to set your play order.' : group ? `Season ${group.season} · ${group.files.length} videos in episode order` : 'Your AllDebrid uploads and saved video links appear here automatically.'}</p></div>
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
    } else if (group) {
      html += `<div class="db-hero"><button class="f db-mainplay" data-action="playall">${icon('play')} ${continueAt(group.files) ? 'Continue series' : 'Play in episode order'}</button>
        <span>${group.files.length} videos · continues automatically in Lumen TV</span>
        ${continueAt(group.files) ? '<button class="f db-toggle" data-action="playstart">Start from episode 1</button>' : ''}</div>
        <div class="db-tools"><button class="f db-chip" data-action="back-series">← All series</button>
          <button class="f db-chip" data-action="savegroup">Save as editable playlist</button></div>
        <div class="db-list">${group.files.map((f, i) => fileCard(f, -1, i + 1)).join('')}</div>`;
    } else {
      const files = allItems().filter((f) => f.name.toLowerCase().includes(this.query.toLowerCase()));
      if (this.sort === 'name') files.sort((a,b) => a.name.localeCompare(b.name));
      else if (this.sort === 'name-desc') files.sort((a,b) => b.name.localeCompare(a.name));
      else if (this.sort === 'oldest') files.sort((a,b) => (a.added || 0) - (b.added || 0));
      else if (this.sort === 'size') files.sort((a,b) => (b.size || 0) - (a.size || 0));
      html += `<div class="db-stats"><div><b>${snap.magnets.length}</b><small>Cloud uploads</small></div>
        <div><b>${snap.files.length}</b><small>Playable files</small></div><div><b>${groups.length}</b><small>Series groups</small></div><div><b>${playlists().length}</b><small>My playlists</small></div></div>
        <div class="db-tools"><button class="f db-chip ${this.mode === 'files' ? 'active' : ''}" data-action="files">All files</button>
          <button class="f db-chip ${this.mode === 'series' ? 'active' : ''}" data-action="series">Series groups</button>
          <button class="f db-chip ${this.mode === 'playlists' ? 'active' : ''}" data-action="playlists">My playlists</button>
          <button class="f db-chip" data-action="refresh">${icon('refresh')} Refresh</button>
          <button class="f db-chip" data-action="sort">Sort: ${{ recent: 'Newest', oldest: 'Oldest', name: 'Name A–Z', 'name-desc': 'Name Z–A', size: 'Largest' }[this.sort] || 'Newest'}</button></div>`;
      if (this.mode === 'playlists') {
        html += '<div class="db-section">Your play queues</div><div class="db-list">' +
          playlists().map((pl) => `<button class="f db-collection" data-action="open" data-id="${esc(pl.id)}"><span class="db-art">${icon('list')}</span><span><b>${esc(pl.name)}</b><small>${pl.items.length} files · Autoplay ${pl.autoplay === false ? 'off' : 'on'}</small></span><span>Open →</span></button>`).join('') +
          '<button class="f db-chip" data-action="new">+ Create playlist</button></div>';
      } else if (this.mode === 'series') {
        html += '<div class="db-section">Automatically grouped series</div><div class="db-list">' +
          (groups.map(groupCard).join('') ||
          '<div class="db-empty">Series with two or more recognised episodes will appear here automatically.</div>') + '</div>';
      } else {
        if (groups.length) html += `<div class="db-section">Series ready to play <small>${groups.length}</small></div>
          <div class="db-list">${groups.slice(0, 5).map(groupCard).join('')}</div>`;
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
    if (wasInView) focus(same || host.querySelector('.f'), { noScroll: !!same });
  }
  async action(b) {
    const a = b.dataset.action, p = savedPlaylist(this.playlistId), id = b.dataset.file;
    if (a === 'settings') return this.app.go('settings', { restore: { sec: 'debrid' } });
    if (a === 'refresh') { toast('Refreshing your AllDebrid library…'); return this.refresh(true); }
    if (a === 'files' || a === 'playlists' || a === 'series') { this.mode = a; this.playlistId = ''; this.seriesId = ''; return this.paint(); }
    if (a === 'sort') {
      const choice = await sheet({ title: 'Sort Debrid files', options: [
        { label: 'Newest first', value: 'recent', on: this.sort === 'recent' },
        { label: 'Oldest first', value: 'oldest', on: this.sort === 'oldest' },
        { label: 'File name A–Z', value: 'name', on: this.sort === 'name' },
        { label: 'File name Z–A', value: 'name-desc', on: this.sort === 'name-desc' },
        { label: 'Largest first', value: 'size', on: this.sort === 'size' },
      ] });
      if (choice) { this.sort = choice; this.restoreFocus = b; this.paint(); }
      return;
    }
    if (a === 'addmore' || a === 'back') { this.playlistId = ''; this.mode = 'files'; return this.paint(); }
    if (a === 'back-series') { this.seriesId = ''; this.mode = 'series'; return this.paint(); }
    if (a === 'open-series') { this.seriesId = b.dataset.id; this.playlistId = ''; this.mode = 'series'; return this.paint(); }
    if (a === 'open') { this.playlistId = b.dataset.id; this.seriesId = ''; return this.paint(); }
    if (a === 'savegroup') {
      const group = seriesGroups().find((g) => g.id === this.seriesId);
      if (!group) return;
      const id = 'db-series:' + group.id;
      savePlaylist({ id, name: `${group.title} · Season ${group.season}`, items: group.files.map((f) => f.id), autoplay: true });
      this.seriesId = ''; this.playlistId = id; this.mode = 'playlists'; this.paint();
      toast('Series saved. You can now rearrange its videos.');
      return;
    }
    if (a === 'add') { if (await addFileToPlaylist(id) && !this.dead) { this.restoreFocus = b; this.paint(); } return; }
    if (a === 'download') return downloadDebrid(id);
    if (a === 'play') return playDebrid(id, p?.id || '', this.app, this.seriesId ? seriesGroups().find((g) => g.id === this.seriesId)?.files.map((f) => f.id) : null);
    if (a === 'playall' || a === 'playstart') {
      const group = this.seriesId ? seriesGroups().find((g) => g.id === this.seriesId) : null;
      const first = p?.items.find(fileById) || group?.files[a === 'playstart' ? 0 : continueAt(group.files)]?.id;
      if (first) return playDebrid(first, p?.id || '', this.app, group?.files.map((f) => f.id));
      return toast('Add a playable file first');
    }
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
  save() { return { mode: this.mode, playlistId: this.playlistId, seriesId: this.seriesId, query: this.query, sort: this.sort }; }
  destroy() { this.dead = true; document.removeEventListener('debrid-library-changed', this.listener);
    document.removeEventListener('debrid-account-changed', this.listener); clearInterval(this.timer); }
}
