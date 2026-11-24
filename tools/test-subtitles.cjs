const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [], loaded = [];
const settings = { osKey: 'os-key', subdlKey: 'sd-key', subLangs: ['en'], subAuto: false };
const context = vm.createContext({ URLSearchParams, URL, JSON, Promise, Array, String, Error, setTimeout });
const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../web/src/subs.js'), 'utf8'), { context });
const mocks = {
  './native.js': {
    subtitleHash: async () => ({ hash: 'fingerprint' }),
    call: async (_method, url, _headers, body) => {
      calls.push(url);
      if (url.includes('subtitlecat.com/index.php')) return '<a href="subs/123/Show.S01E02.English.html">Show</a>';
      if (url.includes('subtitlecat.com/subs/123/')) return '<a id="download_ml" href="/subs/456/Show.S01E02-ml.srt">Malayalam</a>';
      if (url.includes('/api/v2/ai/translations')) {
        assert.deepEqual(JSON.parse(body), { n_id: 'parent', file_n_id: 'ep2', target_language: 'ML', format: 'srt' });
        return JSON.stringify({ request_id: 'job123', job: { download_ready: true } });
      }
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
  const external = await subs.subtitleLink(results[0]);
  assert.equal(external.link, 'https://dl.subdl.com/subtitle/parent/ep2');
  assert.equal(loaded.length, 0, 'external player subtitle lookup does not attach to Lumen player');
  await subs.loadOnline(results[0]);
  assert.equal(loaded[0][0], 'https://dl.subdl.com/subtitle/parent/ep2');
  assert.equal(await subs.subtitleCatMalayalam({ title: 'Show.S01E02.mkv' }), 'https://www.subtitlecat.com/subs/456/Show.S01E02-ml.srt');
  const translated = await subs.translateMalayalam({ title: 'Show', season: 1, episode: 2 });
  assert.equal(translated, 'https://api.subdl.com/api/v2/ai/translations/job123/download?api_key=sd-key');
  console.log('Subtitle provider fixtures passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
