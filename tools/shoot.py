"""Drive the TV UI with simulated remote keys and capture screenshots.

Usage: python3 -I tools/shoot.py <outdir> [scenario ...]
Serves build/web on localhost and runs each scenario in a fresh 1920x1080 page.
"""
import http.server, os, sys, threading, functools, json, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'build', 'web')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build', 'shots')
os.makedirs(OUT, exist_ok=True)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=WEB)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_xtream

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        from urllib.parse import urlparse
        u = urlparse(self.path)
        r = mock_xtream.handle(u.path, u.query)
        if r is None:
            return super().do_GET()
        code, ctype, body = r
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers()
        self.wfile.write(body)
Handler = functools.partial(Quiet, directory=WEB)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

# Seed state: a few favourites, recent channels and resume points, as after a week of use.
SEED = {
    'favs': {'live': ['d1', 'd11', 'd12', 'd51', 'd70', 'd76', 'd88'], 'movie': ['f3'], 'series': ['sr0']},
    'recentLive': ['d12', 'd1', 'd51', 'd23', 'd76'],
    'progress': {
        'movie:f0': {'pos': 2460000, 'dur': 6600000, 't': 3, 'title': 'The Glass Harbour', 'sub': '2025'},
        'ep:sr0-1-3': {'pos': 1300000, 'dur': 2700000, 't': 2, 'title': 'Harbour City', 'sub': 'S1 E3: Tidewater'},
        'movie:f5': {'pos': 900000, 'dur': 7100000, 't': 1, 'title': 'Red Dune', 'sub': '2026'},
    },
    'recentSearches': ['football', 'kerala', 'glass harbour'],
}

def key(page, k, n=1, delay=110):
    for _ in range(n):
        page.keyboard.press(k)
        page.wait_for_timeout(delay)

def ok(page, wait=350):
    page.keyboard.down('Enter'); page.wait_for_timeout(60); page.keyboard.up('Enter'); page.wait_for_timeout(wait)

def shot(page, name):
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, name + '.png'))
    print('saved', name)

def scenario_home(page):
    shot(page, '01-home')
    key(page, 'ArrowDown', 3); key(page, 'ArrowRight', 1)
    shot(page, '02-home-continue')
    key(page, 'ArrowDown', 1); key(page, 'ArrowRight', 2)
    shot(page, '02b-home-rows')

def scenario_rail(page):
    key(page, 'ArrowLeft', 3)
    shot(page, '03-rail')

def scenario_search(page):
    page.evaluate("__app.go('search', {keyboard: true})")
    page.wait_for_timeout(300)
    shot(page, '04-search-empty')
    for ch in 'atlas':
        page.evaluate(f"document.querySelector('[data-key=\"{ch}\"]').click()")
        page.wait_for_timeout(60)
    page.wait_for_timeout(300)
    shot(page, '05-search-typing')

def scenario_search_prog(page):
    page.evaluate("__app.go('search', {q: 'football', voice: true})")
    page.wait_for_timeout(400)
    shot(page, '06-search-voice-result')

def scenario_voice(page):
    page.evaluate("__app.openVoice()")
    page.wait_for_timeout(200)
    page.evaluate("window.__nat('voice', {state:'partial', text:'play kerala vision'})")
    shot(page, '07-voice-listening')

def scenario_live(page):
    page.evaluate("__app.go('live', {}, {root:true})")
    page.wait_for_timeout(300)
    key(page, 'ArrowDown', 2)
    page.wait_for_timeout(1200)
    shot(page, '08-live-tv')

def scenario_guide(page):
    page.evaluate("__app.go('guide', {}, {root:true})")
    page.wait_for_timeout(300)
    key(page, 'ArrowDown', 1); key(page, 'ArrowRight', 1)
    page.wait_for_timeout(1200)
    shot(page, '09-guide')

def scenario_movies(page):
    page.evaluate("__app.go('movies', {}, {root:true})")
    page.wait_for_timeout(300)
    key(page, 'ArrowRight', 2); key(page, 'ArrowDown', 1)
    shot(page, '10-films')

def scenario_detail(page):
    page.evaluate("__app.go('detail', {kind:'series', id:'sr0'})")
    page.wait_for_timeout(500)
    shot(page, '11-series-detail')

def scenario_player(page):
    page.evaluate("__app.go('live', {}, {root:true})")
    page.wait_for_timeout(300)
    ok(page, 1500)
    shot(page, '12-player-osd')
    ok(page, 500)
    shot(page, '13-player-channel-list')

def scenario_settings(page):
    page.evaluate("__app.go('settings', {}, {root:true})")
    page.wait_for_timeout(300)
    shot(page, '14-settings')
    key(page, 'ArrowDown', 4)
    shot(page, '15-settings-voice')

def scenario_pin(page):
    page.evaluate("__app.go('live', {}, {root:true})")
    page.wait_for_timeout(300)
    # walk to the locked 18+ category and open it
    page.evaluate("""(() => { const s = __app.current().ctl; const i = s.cats.findIndex(c => /18/.test(c.name)); s.catList_.focusIndex(i, true); })()""")
    page.wait_for_timeout(100)
    ok(page, 500)
    shot(page, '16-parental-pin')

def scenario_xtream(page):
    """Add a real Xtream login through the settings form and use the big catalogue."""
    page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_function("window.__bootMs !== undefined")
    page.evaluate("__app.go('settings', {}, {root:true})"); page.wait_for_timeout(200)
    page.evaluate("document.querySelector('[data-act=addx]').click()"); page.wait_for_timeout(200)
    page.fill('input[name=name]', 'Home IPTV')
    page.fill('input[name=server]', 'http://127.0.0.1:8765')
    page.fill('input[name=user]', 'demo')
    page.fill('input[name=pass]', 'demo')
    shot(page, '17-add-xtream')
    page.evaluate("document.querySelector('[data-a=ok]').click()")
    page.wait_for_function("document.querySelector('#toast').textContent.includes('channels ready')", timeout=30000)
    page.wait_for_timeout(2500)  # guide download + parse
    print('   toast:', page.evaluate("document.querySelector('#toast').textContent"))
    shot(page, '18-xtream-settings')
    page.evaluate("__app.go('live', {}, {root:true})"); page.wait_for_timeout(300)
    key(page, 'ArrowDown', 3); page.wait_for_timeout(900)
    shot(page, '19-xtream-live')
    t = page.evaluate("(() => { const t0 = performance.now(); __app.go('search', {q: 'football'}); return performance.now() - t0; })()")
    print(f'   search screen with 4000 channels, 6000 films, guide: {t:.0f} ms')
    shot(page, '20-xtream-search')
    page.reload(); page.wait_for_function("window.__bootMs !== undefined")
    print('   cold start from cache:', page.evaluate('window.__bootMs'), 'ms,', page.evaluate("document.body.dataset.screen"), 'screen,',
          page.evaluate("document.querySelectorAll('.tile').length"), 'tiles; cache bytes', page.evaluate("Object.keys(localStorage).map(k => k + ':' + localStorage[k].length).join(' ')"))
    shot(page, '21-xtream-home-after-restart')

def scenario_actions(page):
    """Long-press a film: action menu, then download with quality choice, downloader choice and QR."""
    gid = page.evaluate("[...document.defaultView.__C.movie].find(m => m.name === 'The Glass Harbour' && m.q === '1080p').id")
    page.evaluate(f"__app.go('detail', {{kind:'movie', id:'{gid}'}})"); page.wait_for_timeout(500)
    shot(page, '22-film-detail')
    page.evaluate("document.querySelector('[data-a=more]').click()"); page.wait_for_timeout(400)
    shot(page, '23-film-long-press-menu')
    key(page, 'Escape')
    page.evaluate("document.querySelector('[data-a=download]').click()"); page.wait_for_timeout(1500)
    shot(page, '24-download-quality')
    key(page, 'ArrowDown', 1); ok(page, 500)
    shot(page, '25-download-app')
    key(page, 'ArrowDown', 4); ok(page, 600)
    shot(page, '26-download-qr')

def scenario_live_hold(page):
    page.evaluate("__app.go('live', {}, {root:true})"); page.wait_for_timeout(300)
    page.keyboard.down('Enter'); page.wait_for_timeout(800); page.keyboard.up('Enter'); page.wait_for_timeout(400)
    shot(page, '27-channel-long-press')

def scenario_player_menu(page):
    page.evaluate("__app.go('detail', {kind:'series', id:'sr0'})"); page.wait_for_timeout(500)
    page.evaluate("document.querySelector('[data-a=next]').click()"); page.wait_for_timeout(1200)
    page.evaluate("window.__nat('cues', {text: 'Every light on the harbour went out at once.'})")
    key(page, 'F1'); page.wait_for_timeout(400)
    shot(page, '28-player-options')
    key(page, 'Escape'); page.wait_for_timeout(200)
    page.evaluate("window.__nat('player', {state:'ended'})"); page.wait_for_timeout(600)
    shot(page, '29-next-episode')

def scenario_settings_new(page):
    for sec, name in [('langs', '30-settings-languages'), ('look', '31-settings-wallpaper'), ('downloads', '32-settings-downloads'),
                      ('subs', '33-settings-subtitles'), ('phone', '34-settings-phone-remote'), ('voice', '35-settings-voice')]:
        page.evaluate(f"__app.go('settings', {{restore: {{sec: '{sec}'}}}}, {{root:true}})"); page.wait_for_timeout(300)
        shot(page, name)

def scenario_ime(page):
    page.evaluate("__app.go('search', {ime: true})"); page.wait_for_timeout(300)
    page.fill('#sr-input', 'kerala')
    page.wait_for_timeout(400)
    shot(page, '36-voice-dictation-search')

def scenario_wallpaper(page):
    page.evaluate("__app.go('settings', {restore: {sec: 'look'}}, {root:true})"); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('[data-act=wp][data-arg=teal]').click()"); page.wait_for_timeout(100)
    page.evaluate("document.querySelector('[data-act=accent][data-arg=teal]').click()"); page.wait_for_timeout(100)
    page.evaluate("__app.go('home', {}, {root:true})"); page.wait_for_timeout(900)
    shot(page, '37-home-teal-wallpaper')

def scenario_lang_films(page):
    page.evaluate("__app.go('movies', {lang: 'malayalam'}, {root:true})"); page.wait_for_timeout(400)
    shot(page, '38-films-malayalam')

SCEN = {k[9:]: v for k, v in globals().items() if k.startswith('scenario_')}

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    names = sys.argv[2:] or list(SCEN)
    for name in names:
        ctx = b.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('c:state', {json.dumps(json.dumps(SEED))}); sessionStorage.setItem('seeded', '1'); }}")
        page.goto('http://127.0.0.1:8765/index.html')
        page.wait_for_function("window.__bootMs !== undefined")
        page.wait_for_timeout(600)
        try:
            SCEN[name](page)
        except Exception as e:
            errs.append('SCENARIO FAILED: ' + str(e).splitlines()[0] + ' ' + ' '.join(str(e).splitlines()[1:4]))
        boot = page.evaluate('window.__bootMs')
        print(f'  {name}: boot {boot} ms', ('ERRORS: ' + ' | '.join(errs)) if errs else '')
        ctx.close()
    b.close()
srv.shutdown()
