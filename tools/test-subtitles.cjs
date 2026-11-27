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
    call: async (_method, url) => {
      calls.push(url);
      if (url.includes('subtitlecat.com/index.php')) return '<a href="subs/123/Show.S01E02.English.html">Show</a>';
      if (url.includes('subtitlecat.com/subs/123/')) return '<a id="download_ml" href="/subs/456/Show.S01E02-ml.srt">Malayalam</a><a id="download_en" href="/subs/456/Show.S01E02-en.srt">English</a>';
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
  assert.equal(await subs.subtitleCatExisting({ title: 'Show.S01E02.mkv' }, 'en'), 'https://www.subtitlecat.com/subs/456/Show.S01E02-en.srt');
  assert.equal(subs.subtitleCatQuery('www.1TamilMV.style - The Court (2026) S01 EP (33-36) TRUE WEB-DL 1080p'),
    'The Court S01E33');
  // --- title clean-up for provider names ---
  const T = (title, extra = {}) => subs.subtitleTarget({ title, ...extra });
  assert.deepEqual({ ...T('Inception (2010)') }, { title: 'Inception', year: 2010, season: 0, episode: 0 });
  assert.deepEqual({ ...T('EN - The Batman [4K] (2022)') }, { title: 'The Batman', year: 2022, season: 0, episode: 0 });
  assert.deepEqual({ ...T('|ML| Aavesham 2024 1080p WEB-DL') }, { title: 'Aavesham', year: 2024, season: 0, episode: 0 });
  assert.deepEqual({ ...T('2012 (2009)') }, { title: '2012', year: 2009, season: 0, episode: 0 });
  assert.deepEqual({ ...T('Vikings [Eng+Hin]', { season: 2, episode: 5 }) }, { title: 'Vikings', year: 0, season: 2, episode: 5 });
  assert.deepEqual({ ...T('Show.Name.S01E02.1080p.mkv') }, { title: 'Show Name', year: 0, season: 1, episode: 2 });
  assert.equal(T('Blade Runner 2049 (2017)').title, 'Blade Runner 2049');
  // --- search results as SubtitleCat serves them (absolute links), with traps ---
  const page = (n) => `<tr><td><a href="https://www.subtitlecat.com/subs/${n}">x</a></td></tr>`;
  const html = [
    page('9/Alien.Romulus.2024.1080p.WEB.html'), page('10/Alien.1979.Directors.Cut.1080p.BluRay.html'),
    page('11/Aliens.1986.html'), page('12/Alien%20%281979%29%201080p%20BluRay.html'), page('13/Alien.Covenant.2017.html'),
  ].join('');
  const ranked = subs.subtitleCatCandidates(html, { title: 'Alien', year: 1979, season: 0, episode: 0 });
  assert.deepEqual([...ranked], ['subs/10/Alien.1979.Directors.Cut.1080p.BluRay.html', 'subs/12/Alien%20%281979%29%201080p%20BluRay.html'],
    'only the 1979 film, never Aliens / Romulus / Covenant');
  const eps = [page('20/Vikings.S02E05.720p.HDTV.html'), page('21/Vikings.S02E06.720p.html'), page('22/Vikings.Valhalla.S02E05.html'), page('23/Vikings.S03E05.html')].join('');
  assert.deepEqual([...subs.subtitleCatCandidates(eps, { title: 'Vikings', year: 0, season: 2, episode: 5 })].slice(0, 1), ['subs/20/Vikings.S02E05.720p.HDTV.html']);
  assert.deepEqual([...subs.subtitleCatCandidates(page('30/Inception.2010.S01E01.html') + page('31/Other.Film.2010.html'), { title: 'Inception', year: 2010, season: 0, episode: 0 })], [],
    'a film never takes an episode or another title');
  // --- language link on a subtitle page ---
  const detail = '<a class="green-link" href="/subs/1667/Inception.2010-en.srt">Download</a><button onclick="translate_from_server_folder(\'ml\')">Translate</button>'
    + '<a href="https://www.subtitlecat.com/subs/1766/Inception.2010-ta.srt">Download</a><a href="https://evil.example/subs/1/x-ml.srt">x</a>';
  assert.equal(subs.subtitleCatLink(detail, 'en'), 'https://www.subtitlecat.com/subs/1667/Inception.2010-en.srt');
  assert.equal(subs.subtitleCatLink(detail, 'ta'), 'https://www.subtitlecat.com/subs/1766/Inception.2010-ta.srt');
  assert.equal(subs.subtitleCatLink(detail, 'ml'), '', 'not translated yet, and never a link from another site');
  console.log('Subtitle provider fixtures passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
