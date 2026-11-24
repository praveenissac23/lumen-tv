// AllDebrid fixtures exercise discovery, stored ordering and fresh-link playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cache = new Map();
const state = { debridPlaylists: [] };
const requests = [];
const context = vm.createContext({
  document: { dispatchEvent() {}, addEventListener() {} }, Event: class Event {},
  Date, JSON, Map, Object, Promise, Array, String, RegExp, URL, encodeURIComponent,
});
const code = fs.readFileSync(require('node:path').join(__dirname, '../web/src/debrid-library.js'), 'utf8');
const mod = new vm.SourceTextModule(code, { context });
const mock = {
  './native.js': {
    cacheRead: (key) => cache.get(key),
    cacheWrite: (key, value) => cache.set(key, value),
  },
  './store.js': { S: state, set: (key, val) => { state[key] = val; } },
  './torrents.js': {
    accounts: () => ({ ad: { key: 'fixture' } }),
    flattenFiles: function flatten(files, prefix = '') {
      return files.flatMap((f) => Array.isArray(f.e) ? flatten(f.e, prefix + f.n + '/') :
        [{ name: prefix + f.n, size: f.s, link: f.l }]);
    },
    videoFiles: (files) => files.filter((f) => /\.(mp4|mkv)$/i.test(f.name)),
    api: async (provider, path, method, fields) => {
      requests.push({ provider, path, fields });
      if (path === 'v4.1/magnet/status') return { magnets: [
        { id: 42, filename: 'A sample season', statusCode: 4, completionDate: 90 },
        { id: 43, filename: 'Still processing', statusCode: 1 },
      ] };
      if (path === 'v4/user/links') return { links: [{ link: 'https://alldebrid.com/f/saved',
        filename: 'Saved.mp4', size: 450, date: 80 }] };
      if (path === 'v4/magnet/files') return { magnets: [{ id: 42, files: [{
        n: 'Season', e: [
          { n: 'Episode.01.mkv', s: 1000, l: 'https://alldebrid.com/f/1' },
          { n: 'Episode.02.mkv', s: 900, l: 'https://alldebrid.com/f/2' },
          { n: 'notes.txt', s: 90, l: 'https://alldebrid.com/f/n' },
        ],
      }] }] };
      if (path === 'v4/link/unlock') return { link: 'https://cdn.example/video.mkv' };
      throw new Error('Unexpected ' + path);
    },
  },
};
async function main() {
  await mod.link(async (specifier) => {
    const exports = mock[specifier];
    if (!exports) throw new Error('Unexpected import ' + specifier);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  const d = mod.namespace;
  const season = Array.from({ length: 48 }, (_, i) => ({
    id: 'episode-' + (48 - i),
    name: `www.1TamilMV.style - The Court (2026) S01 EP (${48 - i}).mkv`,
    added: i,
  }));
  const groups = d.seriesGroups(season);
  assert.equal(groups.length, 1, 'one group for a 48-video season from differently ordered uploads');
  assert.equal(groups[0].files[0].episodeStart, 1, 'autoplay starts with episode 1');
  assert.equal(groups[0].files.at(-1).episodeStart, 48, 'autoplay ends with episode 48');
  await d.refreshLibrary(true);
  assert.equal(d.library().magnets.length, 2, 'all uploads, including processing');
  assert.equal(d.library().files.length, 3, 'nested videos and saved link');
  assert.equal(d.library().files[0].name, 'Season/Episode.01.mkv');
  assert.ok(!d.library().files.some((f) => f.name.endsWith('notes.txt')));
  const a = d.library().files[0].id, b = d.library().files[1].id;
  d.savePlaylist({ id: 'p1', name: 'Season', items: [a, b], autoplay: true });
  d.movePlaylistItem('p1', 1, -1);
  assert.deepEqual([...d.savedPlaylist('p1').items], [b, a], 'saved play order');
  d.addToPlaylist('p1', a);
  assert.equal(d.savedPlaylist('p1').items.length, 2, 'no duplicate');
  const item = await d.playableFile(a);
  assert.equal(item.url, 'https://cdn.example/video.mkv');
  assert.equal(requests.at(-1).path, 'v4/link/unlock');
  assert.equal(requests.at(-1).fields.link, 'https://alldebrid.com/f/1',
    'fresh file link is resolved for playback');
  assert.ok(cache.get('debrid-library'), 'library cached across sessions');
  console.log('Debrid library fixtures passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
