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
    'xmltv': ['number', 'string', 'string', 'number', 'number'], 'cacheRead': ['string'], 'cacheWrite': ['string', 'string'],
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
    xmltv: (id, url, key, f, t) => { store[key] = '{}'; fire('xmltv', {id, ok: true}); },
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
    # add an Xtream playlist through the native http path
    page.evaluate("__app.go('settings', {}, {root:true})"); page.wait_for_timeout(200)
    page.evaluate("document.querySelector('[data-act=addx]').click()"); page.wait_for_timeout(150)
    for k, v in {'server': '127.0.0.1:8766', 'user': 'demo', 'pass': 'demo'}.items(): page.fill(f'input[name={k}]', v)
    page.evaluate("document.querySelector('[data-a=ok]').click()")
    page.wait_for_function("document.querySelector('#toast').textContent.includes('channels ready')", timeout=30000)
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
