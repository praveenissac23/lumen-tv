const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [], loaded = [], saved = [];
const settings = { osKey: 'os-key', subdlKey: 'sd-key', subLangs: ['en'], subAuto: false };
const context = vm.createContext({ URLSearchParams, URL, JSON, Promise, Array, String, Error, setTimeout });
const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../web/src/subs.js'), 'utf8'), { context });
const mocks = {
  './native.js': {
    subtitleHash: async () => ({ hash: 'fingerprint' }),
    call: async (_method, url) => {
      calls.push(url);
      if (url.includes('translate.googleapis.com')) {
        const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)[1]);
        if (q.includes('MERGE')) return JSON.stringify([[[q.replace(/\n/g, ' ').toUpperCase(), q]], null, 'en']);
        return JSON.stringify([q.split('\n').map((l, i, a) => ['ml:' + l + (i < a.length - 1 ? '\n' : ''), l]), null, 'en']);
      }
      if (url.includes('index.php?search=Long%20Film')) return '<tr><td><a href="subs/900/Long.Film.2020.720p.html">x</a> (translated from English)</td></tr><tr><td><a href="subs/901/Long.Film.2020.1080p.html">y</a> (translated from English)</td></tr>';
      if (url.includes('/subs/900/Long.Film.2020.720p.html')) return `<button id="ml" onclick="translate_from_server_folder('ml', 'Long.Film.2020.720p-orig.srt', '/subs/900/')">Translate</button>`;
      if (url.includes('/subs/901/Long.Film.2020.1080p.html')) return `<a href="/subs/902/Long.Film.2020.1080p-en.srt">Download</a><button id="ml" onclick="translate_from_server_folder('ml', 'Long.Film.2020.1080p-orig.srt', '/subs/901/')">Translate</button>`;
      if (url.endsWith('/subs/900/Long.Film.2020.720p-orig.srt')) return '1\n00:00:01,000 --> 00:00:03,000\nWrong cut\n\n2\n00:40:00,000 --> 00:40:02,000\nEnds far too early\n';
      if (url.endsWith('/subs/902/Long.Film.2020.1080p-en.srt')) return '1\n00:00:01,000 --> 00:00:03,000\n<i>Hello there</i>\n\n2\n01:55:00,000 --> 01:55:02,000\nGoodbye & good luck\nMERGE me\n';
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
    saveSubtitle: (key, content) => { saved.push([key, content]); return 'content://tv.lumen.app.files/saved-subtitles/t.srt'; },
    cacheWrite() {}, cacheRead: () => '', cachedSubtitle: () => '',
    tracks: () => ({ text: [] }), selectTrack() {},
  },
  './store.js': { setting: (key) => settings[key], S: {}, set() {} },
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
  // --- no Malayalam file: the right cut's English file is translated here, timings untouched ---
  assert.equal(subs.subtitleCatOriginal(`<button onclick="translate_from_server_folder('ml', 'A B-orig.srt', '/subs/5/')">`, 'ml'), 'https://www.subtitlecat.com/subs/5/A%20B-orig.srt');
  assert.equal(subs.srtEnd('1\n00:00:01,000 --> 01:02:03,500\nx'), 3723);
  assert.equal(subs.fitsVideo('1\n00:00:01,000 --> 00:40:00,000\nx', 7000), false);
  assert.equal(subs.fitsVideo('<html>blocked</html>', 0), false);
  const seen = [];
  const got = await subs.findSubtitle({ title: 'Long Film', year: 2020, durSecs: 7000 }, 'ml', { onProgress: (p) => seen.push(p) });
  assert.equal(got.uri, 'content://tv.lumen.app.files/saved-subtitles/t.srt');
  assert.equal(got.source, 'SubtitleCat, translated');
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1], '1\n00:00:01,000 --> 00:00:03,000\nml:Hello there\n\n2\n01:55:00,000 --> 01:55:02,000\nml:Goodbye and good luck\nMERGE ME\n',
    'numbers and timings kept, tags dropped, a merged answer redone line by line');
  assert.ok(!saved[0][1].includes('Wrong cut'), 'the cut that ends at 40 minutes is never used for a 2-hour film');
  assert.ok(seen.includes(100));
  console.log('Subtitle provider fixtures passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
