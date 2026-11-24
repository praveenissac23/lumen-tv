const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [], loaded = [];
const settings = { osKey: 'os-key', subdlKey: 'sd-key', subLangs: ['en'], subAuto: false };
const context = vm.createContext({ URLSearchParams, URL, JSON, Promise, Array, String, Error });
const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../web/src/subs.js'), 'utf8'), { context });
const mocks = {
  './native.js': {
    subtitleHash: async () => ({ hash: 'fingerprint' }),
    call: async (_method, url) => {
      calls.push(url);
      if (url.includes('api.subdl.com')) return JSON.stringify({ status: true, subtitles: [
        { release_name: 'Season', unpack_files: [
          { url: '/subtitle/parent/ep1', name: 'episode1.srt', language: 'EN', episode: 1 },
          { url: '/subtitle/parent/ep2', name: 'episode2.srt', language: 'EN', episode: 2 },
        ] },
      ] });
      if (url.includes('/subtitles')) return JSON.stringify({ data: [] });
      throw Error('Unexpected URL');
    },
    loadSubtitle: (...args) => loaded.push(args),
    tracks: () => ({ text: [] }), selectTrack() {},
  },
  './store.js': { setting: (key) => settings[key] },
  './languages.js': { LANGS: [] },
};
(async () => {
  await mod.link(async (specifier) => {
    const exports = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      Object.entries(exports).forEach(([key, val]) => this.setExport(key, val));
    }, { context });
  });
  await mod.evaluate();
  const subs = mod.namespace;
  const results = await subs.searchSubs({ title: 'Show', season: 1, episode: 2, url: 'https://video.example/Show.S01E02.mkv' });
  assert.equal(results.length, 1, 'only the matching episode subtitle');
  assert.equal(results[0].source, 'SubDL');
  assert.ok(calls.some((url) => url.includes('api.subdl.com') && url.includes('unpack=1')));
  await subs.loadOnline(results[0]);
  assert.equal(loaded[0][0], 'https://dl.subdl.com/subtitle/parent/ep2');
  console.log('Subtitle provider fixtures passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
