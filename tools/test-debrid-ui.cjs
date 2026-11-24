// Exercises the real Debrid screen and Search tab with 69 cloud videos.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const bundle = esbuild.buildSync({ stdin: {
  contents: `import {DebridScreen} from './web/src/screens/debrid.js';
    import {SearchScreen} from './web/src/screens/searchview.js';
    import * as db from './web/src/debrid-library.js';
    import {saveAccount} from './web/src/torrents.js';
    window.test={DebridScreen,SearchScreen,db,saveAccount};`,
  resolveDir: process.cwd(),
}, bundle: true, write: false, format: 'iife', target: 'chrome69' }).outputFiles[0].text;
const dom = new JSDOM('<!doctype html><div id="stage"><main id="view"></main><div id="overlays"></div><div id="toast"></div></div>',
  { url: 'https://lumen.test', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, disk = new Map(), responses = new Map();
w.Native = {
  cacheRead: (key) => disk.get(key) || null,
  cacheWrite: (key, value) => disk.set(key, value),
  deviceInfo: () => '{}',
  apps: () => '[]',
  call: (id, method, url, headers, body) => {
    let data;
    if (url.endsWith('/magnet/status')) data = { status: 'success', data: { magnets:
      Array.from({ length: 69 }, (_, i) => ({ id: i + 1, filename: `Video ${String(i+1).padStart(2,'0')}`, statusCode: 4, completionDate: 100-i })) } };
    else if (url.endsWith('/magnet/files')) {
      const fields = new URLSearchParams(body), ids = [...fields.values()];
      data = { status: 'success', data: { magnets: ids.map((magnetId) => ({ id: magnetId,
        files: [{ n: `Video ${String(magnetId).padStart(2,'0')}.mkv`, s: 1200,
          l: `https://alldebrid.com/f/${magnetId}` }] })) } };
    } else if (url.endsWith('/user/links')) data = { status: 'success', data: { links: [] } };
    else if (url.endsWith('/link/unlock')) data = { status: 'success', data: { link: 'https://cdn.example/video.mkv' } };
    else throw Error('Unexpected ' + url);
    responses.set(id, JSON.stringify(data));
    Promise.resolve().then(() => w.__nat('call', { id, ok: true }));
  },
  take: (id) => { const result = responses.get(id); responses.delete(id); return result; },
};
w.eval(bundle);
const { DebridScreen, SearchScreen, db, saveAccount } = w.test;
const app = { go() {}, back() {}, reload() {}, openVoice() {} };
(async () => {
  saveAccount('ad', 'test-account');
  const view = w.document.getElementById('view');
  const screen = new DebridScreen(view, {}, app);
  await db.refreshLibrary(true);
  assert.equal(db.library().files.length, 69);
  assert.equal(view.querySelectorAll('.db-card .db-play').length, 69, 'all 69 files visible');
  db.savePlaylist({ id: 'p', name: 'Season', items: [db.library().files[0].id, db.library().files[1].id], autoplay: true });
  screen.playlistId = 'p'; screen.paint();
  assert.equal(view.querySelectorAll('.db-card .db-play').length, 2);
  view.querySelector('[data-action="down"]').click();
  assert.equal(db.savedPlaylist('p').items[0], db.library().files[1].id, 'reorder works via UI');
  screen.destroy();
  view.innerHTML = '';
  const search = new SearchScreen(view, { q: 'Video 01' }, app);
  await search.switchTab('debrid');
  assert.ok(view.querySelector('#sr-debrid').textContent.includes('Video 01'), 'search finds cloud file');
  assert.equal(view.querySelector('.sr-debrid-pane').hidden, false);
  search.destroy();
  w.close();
  console.log('Debrid screen and search fixtures passed');
})().catch((e) => { w.close(); console.error(e); process.exitCode = 1; });
