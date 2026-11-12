"""Real Chromium regression gate for the TV shell. Run after npm run build.
No accounts, IPTV subscription or public media downloads are required.
"""
import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'build/web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
seed = {'active':'demo','favs':{'live':['d1'],'movie':['f3'],'series':[]},'settings':{'autoplayLast':False,'autoPreview':False,'preview':False,'lockAdult':False,'lite':True,'motion':False,'torrentSource':'https://source.test','torrentSourceName':'Test provider'}}
meta = {'id':'tt100','name':'Test Harbour','type':'movie','releaseInfo':'2025'}
errors = []
try:
 with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    page = browser.new_page(viewport={'width':1920,'height':1080})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script('localStorage.setItem("c:state",'+json.dumps(json.dumps(seed))+');')
    page.route('https://v3-cinemeta.strem.io/**', lambda route: route.fulfill(json={'metas':[meta]} if '/catalog/movie/' in route.request.url else {'metas':[]}))
    page.route('https://source.test/**', lambda route: route.fulfill(json={'streams':[{'name':'1080p','title':'English · 2 GB','url':'https://cdn.test/video.mp4'},{'name':'720p','infoHash':'a'*40,'title':'seeders: 123'}]}))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.wait_for_function('window.__bootMs !== undefined')
    def focused():
        assert page.evaluate('document.activeElement.classList.contains("f") && document.activeElement.isConnected && document.activeElement.getBoundingClientRect().width > 0'), 'Remote focus lost or hidden'
    for screen in ['home','live','guide','movies','series','settings']:
        page.evaluate('(s)=>__app.go(s,{}, {root:true})',screen)
        for key in ['ArrowDown','ArrowDown','ArrowRight','ArrowDown','ArrowLeft','ArrowUp']:
            page.keyboard.press(key)
            focused()
    page.evaluate('__app.go("search",{q:"harbour"},{root:true})')
    page.wait_for_selector('[data-torrent="0"]',state='attached')
    assert page.locator('[data-tab=lumen]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-tab=torrents]').click()
    page.locator('[data-torrent="0"]').click()
    page.wait_for_selector('[data-source="0"]')
    assert page.locator('#td-play').is_enabled()
    for key in ['ArrowDown','ArrowDown','ArrowUp','ArrowLeft','ArrowRight']:
        page.keyboard.press(key)
        focused()
    page.keyboard.press('Escape')
    page.wait_for_selector('[data-torrent="0"]')
    assert page.locator('[data-tab=torrents]').get_attribute('aria-pressed') == 'true'
    assert page.locator('#sr-input').input_value() == 'harbour'
    page.wait_for_function('document.activeElement.hasAttribute("data-torrent")')
    # Holding Right stays on the row and never escapes into another group.
    page.keyboard.down('ArrowRight')
    page.keyboard.up('ArrowRight')
    focused()
    page.evaluate('__app.go("settings",{restore:{sec:"debrid"}},{root:true})')
    assert page.locator('[data-act=debrid-key]').count() == 2
    assert not errors, errors
    out = ROOT / 'build/navigation-shots'
    out.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(out/'debrid-settings.png'))
    browser.close()
    print('PASS: existing screens, D-pad focus, source selection, Back/tab restoration; no JavaScript errors.')
finally:
 server.shutdown()
