"""Runs the UI with a fake window.Native to check the JS <-> Android bridge contract.

The fake records every call with its argument types, mirroring the Kotlin signatures in
NativeBridge.kt, so a mismatch (wrong argument count or type) shows up here.
"""
import os, sys, json, threading, http.server, functools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_xtream
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'build', 'web')

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        from urllib.parse import urlparse
        u = urlparse(self.path); r = mock_xtream.handle(u.path, u.query)
        if r is None: return super().do_GET()
        c, t, b = r; self.send_response(c); self.send_header('Content-Type', t); self.end_headers(); self.wfile.write(b)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=WEB))
threading.Thread(target=srv.serve_forever, daemon=True).start()

# Kotlin signatures: name -> list of JS types expected
SIG = {
    'deviceInfo': [], 'exit': [], 'http': ['number', 'string', 'number'], 'take': ['number'],
    'viewSize': [], 'catalog': ['number', 'string', 'string', 'string'], 'cacheRead': ['string'], 'cacheWrite': ['string', 'string'],
    'epgImport': ['number', 'string', 'number', 'number', 'string'], 'epgInfo': [], 'epgNow': ['number', 'string', 'number'],
    'epgRange': ['number', 'string', 'number', 'number'], 'epgSearch': ['number', 'string', 'number', 'number', 'number'],
    'voiceStart': [], 'voiceStop': [], 'play': ['string', 'string'], 'stop': [], 'pause': [], 'resume': [],
    'seekBy': ['number'], 'seekTo': ['number'], 'setRect': ['string'], 'setResize': ['string'], 'setBuffer': ['number'],
    'apps': [], 'openWith': ['string', 'string', 'string'], 'copy': ['string'], 'openUrl': ['string'], 'head': ['number', 'string'],
    'call': ['number', 'string', 'string', 'string', 'string'], 'subtitleHash': ['number', 'string'], 'loadSubtitle': ['string', 'string', 'string'],
    'tracks': [], 'installUpdate': ['string'], 'selectTrack': ['string', 'string'], 'setSpeed': ['number'], 'companion': [], 'showKeyboard': [],
}
MOCK = """
(() => {
  const SIG = %s; const log = []; window.__calls = log; const store = {}; const bodies = {};
  const fire = (e, d) => setTimeout(() => window.__nat(e, JSON.stringify(d)), 5);
  const impl = {
    deviceInfo: () => JSON.stringify({fireTv: true, voice: true, model: 'Amazon AFTKA', version: '1.0'}),
    apps: () => JSON.stringify([{pkg: 'com.dv.adm', name: 'ADM', role: 'download'}, {pkg: 'org.videolan.vlc', name: 'VLC', role: 'player'}]),
    openWith: () => true,
    head: (id, url) => fire('head', {id, ok: true, size: 1234567890, type: 'video/mp4'}),
    tracks: () => JSON.stringify({audio: [{id: '0:0', label: 'Malayalam', lang: 'ml', selected: true}, {id: '0:1', label: 'Tamil', lang: 'ta', selected: false}], text: []}),
    companion: () => JSON.stringify({url: 'http://192.168.1.5:8899', pin: '1234'}),
    subtitleHash: (id) => fire('head', {id, ok: true, hash: '8e245d9679d31e12', size: 1234567890}),
    call: (id, m, url) => { bodies[id] = url.includes('/download') ? JSON.stringify({link: 'https://example.com/x.srt'}) : JSON.stringify({data: [{attributes: {language: 'en', release: 'Demo.Release', download_count: 10, moviehash_match: true, files: [{file_id: 42}]}}]}); fire('call', {id, ok: true}); },
    http: (id, url, t) => { fetch(url).then(r => r.ok ? r.text() : Promise.reject(r.status)).then(b => { bodies[id] = b; fire('http', {id, ok: true}); }, e => fire('http', {id, ok: false, error: 'HTTP ' + e})); },
    take: (id) => { const b = bodies[id]; delete bodies[id]; return b; },
    viewSize: () => JSON.stringify({w: innerWidth, h: innerHeight}),
    catalog: (id, url, kind, key) => {
      const XF = { live: {stream_id:'id',num:'num',name:'name',category_id:'cat',stream_icon:'logo',epg_channel_id:'epg',tv_archive:'arch',tv_archive_duration:'archDays'},
        movie: {stream_id:'id',name:'name',category_id:'cat',stream_icon:'img',rating_5based:'r5',rating:'r',year:'year',releaseDate:'date',added:'added',container_extension:'ext'},
        series: {series_id:'id',name:'name',category_id:'cat',cover:'img',rating_5based:'r5',releaseDate:'date',release_date:'date',last_modified:'added',plot:'plot',genre:'genre'} }[kind];
      fetch(url).then(r => r.json()).then(arr => { const out = (Array.isArray(arr) ? arr : []).map(o => { const c = {}; for (const [f, t] of Object.entries(XF)) if (o[f] != null && o[f] !== '') c[t] = o[f]; return c; });
        store[key] = JSON.stringify(out); fire('catalog', {id, ok: true, count: out.length}); }, e => fire('catalog', {id, ok: false, error: String(e)}));
    },
    epgImport: (id, url, f, t, ids) => { window.__epgIds = ids; window.__epgDone = true; fire('epg', {state: 'importing', count: 5000}); fire('epg', {id, state: 'ready', ok: true, count: 12345}); },
    epgInfo: () => JSON.stringify({importedAt: window.__epgDone ? Date.now() - 60000 : 0, count: window.__epgDone ? 12345 : 0, importing: false}),
    epgNow: (id, ids, at) => { const o = {}; for (const k of ids.split(',')) o[k] = [[at - 600, at + 1200, 'Now on ' + k, 'Demo programme'], [at + 1200, at + 3000, 'Next on ' + k, '']]; bodies[id] = JSON.stringify(o); fire('call', {id, ok: true}); },
    epgRange: (id, ids, f, t) => { const o = {}; const now = Date.now() / 1000 | 0; for (const k of ids.split(',')) { const l = []; for (let s = now - 7200; s < now + 7200; s += 1800) l.push([s, s + 1800, 'Show ' + ((s / 1800) %% 7 | 0) + ' on ' + k, '']); o[k] = l; } bodies[id] = JSON.stringify(o); fire('call', {id, ok: true}); },
    epgSearch: (id, q, f, t, limit) => { const now = Date.now() / 1000 | 0; bodies[id] = JSON.stringify([[window.__epgIds ? window.__epgIds.split(',')[0] : 'x', now - 600, now + 1200, 'Match for ' + q, '']]); fire('call', {id, ok: true}); },
    cacheRead: (k) => (k in store ? store[k] : null),
    cacheWrite: (k, v) => { store[k] = v; },
    voiceStart: () => { fire('voice', {state: 'listening'}); setTimeout(() => fire('voice', {state: 'final', text: 'play atlas sports two'}), 50); },
  };
  window.Native = {};
  for (const [name, types] of Object.entries(SIG)) {
    window.Native[name] = (...args) => {
      const got = args.map(a => a === null ? 'null' : typeof a);
      const ok = got.length === types.length && got.every((g, i) => g === types[i]);
      log.push({name, ok, got: got.join(','), args: args.map(a => String(a).slice(0, 80))});
      return impl[name] ? impl[name](...args) : undefined;
    };
  }
})();
""" % json.dumps(SIG)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1920, 'height': 1080})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto('http://127.0.0.1:8766/index.html')
    page.wait_for_function('window.__bootMs !== undefined')
    page.wait_for_timeout(800)                      # home preview -> play(rect)
    page.keyboard.press('F1')                       # Menu key -> voice -> "play atlas sports two"
    page.wait_for_timeout(1200)
    playing = page.evaluate("document.body.classList.contains('playing')")
    osd = page.evaluate("document.querySelector('.osd-ch h1')?.textContent || ''")
    page.keyboard.press('ArrowDown'); page.wait_for_timeout(200)   # zap
    page.keyboard.press('Escape'); page.wait_for_timeout(300)      # back to browse
    if page.evaluate("document.body.classList.contains('playing')"): page.keyboard.press('Escape'); page.wait_for_timeout(300)
    print('player closed:', not page.evaluate("document.body.classList.contains('playing')"))
    # add an Xtream playlist through the native http path
    page.evaluate("__app.go('settings', {}, {root:true})"); page.wait_for_timeout(200)
    page.evaluate("document.querySelector('[data-act=addx]').click()"); page.wait_for_timeout(150)
    for k, v in {'server': '127.0.0.1:8766', 'user': 'demo', 'pass': 'demo'}.items(): page.fill(f'input[name={k}]', v)
    page.evaluate("document.querySelector('[data-a=ok]').click()")
    page.wait_for_function("document.querySelector('#toast').textContent.includes('channels ready')", timeout=30000)
    page.wait_for_timeout(600)
    page.evaluate("__app.go('live', {}, {root:true})"); page.wait_for_timeout(900)
    print('live row now:', page.evaluate("document.querySelector('.ch-row .nn-row small')?.textContent"))
    if os.environ.get('DBG'):
        print(page.evaluate("[...document.querySelectorAll('.ch-row')].slice(0,2).map(r => r.outerHTML.slice(0,500))"))
        print('epg calls', page.evaluate("window.__calls.filter(c => c.name.startsWith('epg')).map(c => c.name + ' ' + c.args.join('|').slice(0,120))"))
        print('vlist', page.evaluate("JSON.stringify({host: document.querySelector('.lv-chans')?.offsetHeight, rows: document.querySelectorAll('.lv-chans .vrow').length, allrows: document.querySelectorAll('.vrow').length, zap: document.querySelectorAll('.zap-list .vrow').length, nnIn: [...document.querySelectorAll('.nn')].slice(0,1).map(e => e.closest('.vrow, .row-track, .zap-list, section')?.className)})"))
        print('live epg ids', page.evaluate("__C.live.slice(0,5).map(c => c.id + ':' + c.epg)"))
    page.evaluate("__app.go('guide', {}, {root:true})"); page.wait_for_timeout(900)
    print('guide cells:', page.evaluate("document.querySelectorAll('.g-prog:not(.empty)').length"))
    if os.environ.get('DBG'):
        print('guide rows', page.evaluate("document.querySelectorAll('.g-row').length"), page.evaluate("window.__calls.filter(c => c.name == 'epgRange').map(c => c.args[1].slice(0,80))"))
        print(page.evaluate("[...document.querySelectorAll('.g-row')].slice(0,3).map(r => r.textContent.replace(/\\s+/g,' ').slice(0,100))"))
    page.evaluate("__app.go('search', {q: 'match'})"); page.wait_for_timeout(900)
    print('on tv results:', page.evaluate("document.querySelectorAll('.prog-tile').length"))
    # long-press menu -> external player, download path with HEAD, subtitles search
    page.evaluate("__app.go('home', {}, {root:true})"); page.wait_for_timeout(400)
    page.evaluate("__app.go('detail', {kind:'movie', id: __C.movie[0].id})"); page.wait_for_timeout(400)
    page.evaluate("document.querySelector('[data-a=download]').click()")
    page.wait_for_selector('.sheet-item', timeout=10000); page.wait_for_timeout(200)
    print('download sheet:', page.evaluate("document.querySelector('.sheet h2').textContent"))
    page.keyboard.press('Enter'); page.wait_for_timeout(300)          # ADM (only one quality -> straight to app list)
    page.wait_for_timeout(300); page.keyboard.press('Enter'); page.wait_for_timeout(500)          # always use ADM
    page.evaluate("document.querySelector('[data-a=more]').click()"); page.wait_for_timeout(300)
    page.evaluate("[...document.querySelectorAll('.sheet-item')].find(b => b.textContent.includes('VLC')).click()"); page.wait_for_timeout(300)
    page.evaluate("__app.go('settings', {restore: {sec: 'phone'}}, {root:true})"); page.wait_for_timeout(300)
    calls = page.evaluate('window.__calls')
    bad = [c for c in calls if not c['ok']]
    names = sorted({c['name'] for c in calls})
    print('voice -> playing:', playing, '| OSD channel:', osd.strip())
    print('bridge methods used:', ', '.join(names))
    print('play calls:', [c['args'] for c in calls if c['name'] == 'play'][:2])
    print('openWith calls:', [c['args'][0] + ' ' + c['args'][2][:60] for c in calls if c['name'] == 'openWith'])
    print('signature mismatches:', bad or 'none')
    print('page errors:', errs or 'none')
    b.close()
srv.shutdown()
