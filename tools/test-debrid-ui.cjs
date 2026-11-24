// Exercises the real Debrid screen and Search tab with 69 cloud videos.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const bundle = esbuild.buildSync({ stdin: {
  contents: `import {DebridScreen} from './web/src/screens/debrid.js';
    import {SearchScreen} from './web/src/screens/searchview.js';
    import * as db from './web/src/debrid-library.js';
    import {saveAccount} from './web/src/torrents.js';
    import {setting,set} from './web/src/store.js';
    window.test={DebridScreen,SearchScreen,db,saveAccount,setting,set};`,
  resolveDir: process.cwd(),
}, bundle: true, write: false, format: 'iife', target: 'chrome69' }).outputFiles[0].text;
const dom = new JSDOM('<!doctype html><div id="stage"><main id="view"></main><div id="overlays"></div><div id="toast"></div></div>',
  { url: 'https://lumen.test', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, disk = new Map(), responses = new Map(), external = [], subtitleRequests = [];
w.Native = {
  cacheRead: (key) => disk.get(key) || null,
  cacheWrite: (key, value) => disk.set(key, value),
  deviceInfo: () => '{}',
  apps: () => JSON.stringify([{ pkg: 'org.videolan.vlc', name: 'VLC', role: 'player' },
    { pkg: 'idm.internet.download.manager', name: '1DM', role: 'download' }]),
  openWith: (...args) => { external.push(args); return true; },
  subtitleHash: (id) => Promise.resolve().then(() => w.__nat('head', { id, ok: true, hash: 'test-hash' })),
  prepareSubtitle: (id, url) => {
    subtitleRequests.push(url); responses.set(id, 'content://tv.lumen.app.files/subtitles/malayalam.srt');
    Promise.resolve().then(() => w.__nat('call', { id, ok: true }));
  },
  call: (id, method, url, headers, body) => {
    let data;
    if (url.endsWith('/magnet/status')) data = { status: 'success', data: { magnets:
      Array.from({ length: 69 }, (_, i) => ({ id: i + 1, filename: i < 4 ? `The Court (2026) S01 EP (${i*4+1}-${i*4+4})` : `Video ${String(i+1).padStart(2,'0')}`, statusCode: 4, completionDate: 100-i })) } };
    else if (url.endsWith('/magnet/files')) {
      const fields = new URLSearchParams(body), ids = [...fields.values()];
      data = { status: 'success', data: { magnets: ids.map((magnetId) => ({ id: magnetId,
        files: [{ n: +magnetId <= 4 ? `The Court (2026) S01 EP (${(+magnetId-1)*4+1}-${(+magnetId-1)*4+4}).mkv` : `Video ${String(magnetId).padStart(2,'0')}.mkv`, s: 1200,
          l: `https://alldebrid.com/f/${magnetId}` }] })) } };
    } else if (url.endsWith('/user/links')) data = { status: 'success', data: { links: [] } };
    else if (url.endsWith('/link/unlock')) data = { status: 'success', data: { link: 'https://cdn.example/video.mkv' } };
    else if (url.includes('api.subdl.com')) {
      const lang = url.includes('languages=ML') ? 'ml' : 'en';
      data = { status: true, subtitles: [{ unpack_files: [
        { url: '/subtitle/test/' + lang, name: 'Video 01.srt', language: lang.toUpperCase(), format: 'srt' },
      ] }] };
    }
    else throw Error('Unexpected ' + url);
    responses.set(id, JSON.stringify(data));
    Promise.resolve().then(() => w.__nat('call', { id, ok: true }));
  },
  take: (id) => { const result = responses.get(id); responses.delete(id); return result; },
};
w.eval(bundle);
const { DebridScreen, SearchScreen, db, saveAccount, setting, set } = w.test;
const app = { go() {}, back() {}, reload() {}, openVoice() {} };
(async () => {
  saveAccount('ad', 'test-account');
  const view = w.document.getElementById('view');
  const screen = new DebridScreen(view, {}, app);
  await db.refreshLibrary(true);
  assert.equal(db.library().files.length, 69);
  assert.equal(view.querySelectorAll('.db-card .db-play').length, 69, 'all 69 files visible');
  db.savePlaylist({ id: 'p', name: 'Season', items: [db.library().files[0].id, db.library().files[1].id], autoplay: true });
  const target = view.querySelectorAll('[data-action="add"]')[40];
  const targetId = target.dataset.file, scroller = view.querySelector('.db-content');
  scroller._off = -2400; scroller.style.transform = 'translate3d(0,-2400px,0)';
  target.focus();
  const adding = screen.action(target);
  w.document.querySelector('#overlays .sheet-item').click();
  await adding;
  assert.equal(view.querySelector('.db-content')._off, -2400, 'scroll stays at selected file');
  assert.equal(w.document.activeElement.dataset.file, targetId, 'focus returns to the same file');
  const sort = view.querySelector('[data-action="sort"]'), sorting = screen.action(sort);
  w.document.querySelectorAll('#overlays .sheet-item')[2].click();
  await sorting;
  assert.equal(screen.sort, 'name', 'file name sort is selectable');
  setting('subdlKey', 'test-subdl-key');
  const opening = screen.action(view.querySelector('[data-action="play"]'));
  assert.ok([...w.document.querySelectorAll('#overlays .sheet-item')].some((b) => b.textContent.includes('VLC')));
  [...w.document.querySelectorAll('#overlays .sheet-item')].find((b) => b.textContent.includes('VLC · Malayalam')).click();
  await opening;
  assert.equal(external[0][0], 'org.videolan.vlc', 'Debrid file opens in selected player');
  assert.ok(subtitleRequests[0].includes('/subtitle/test/ml'), 'Malayalam subtitle downloaded before VLC starts');
  assert.equal(JSON.parse(external[0][2]).subtitle, 'content://tv.lumen.app.files/subtitles/malayalam.srt');
  const english = screen.action(view.querySelector('[data-action="play"]'));
  [...w.document.querySelectorAll('#overlays .sheet-item')].find((b) => b.textContent.includes('VLC') && !b.textContent.includes('Malayalam')).click();
  await english;
  assert.ok(subtitleRequests[1].includes('/subtitle/test/en'), 'ordinary VLC play searches English without a language prompt');
  const downloading = screen.action(view.querySelector('[data-action="download"]'));
  [...w.document.querySelectorAll('#overlays .sheet-item')].find((b) => b.textContent.includes('1DM')).click();
  await downloading;
  assert.equal(external[2][0], 'idm.internet.download.manager', 'Debrid download opens 1DM');
  assert.equal(JSON.parse(external[2][2]).mode, 'download');
  view.querySelector('[data-action="series"]').click();
  assert.equal(view.querySelectorAll('[data-action="open-series"]').length, 1, 'series is grouped automatically');
  view.querySelector('[data-action="open-series"]').click();
  assert.equal(view.querySelectorAll('.db-card .db-play').length, 4, 'all episode packs appear in order');
  assert.match(view.querySelectorAll('.db-card .db-copy b')[0].textContent, /\(1-4\)/);
  set('progress', { ['debrid:' + db.library().files[1].id]: { pos: 40000, dur: 180000 } });
  screen.paint();
  assert.match(view.querySelector('[data-action="playall"]').textContent, /Continue series/);
  assert.ok(view.querySelector('[data-action="playstart"]'), 'restarting a series remains available');
  view.querySelector('[data-action="savegroup"]').click();
  assert.equal(db.savedPlaylist(screen.playlistId).items.length, 4, 'one action saves the complete series');
  screen.playlistId = 'p'; screen.paint();
  assert.equal(view.querySelectorAll('.db-card .db-play').length, 3);
  view.querySelector('[data-action="down"]').click();
  assert.equal(db.savedPlaylist('p').items[0], db.library().files[1].id, 'reorder works via UI');
  screen.destroy();
  view.innerHTML = '';
  const search = new SearchScreen(view, { q: 'Video 05' }, app);
  await search.switchTab('debrid');
  assert.ok(view.querySelector('#sr-debrid').textContent.includes('Video 05'), 'search finds cloud file');
  assert.equal(view.querySelector('.sr-debrid-pane').hidden, false);
  search.destroy();
  w.close();
  console.log('Debrid screen and search fixtures passed');
})().catch((e) => { w.close(); console.error(e); process.exitCode = 1; });
