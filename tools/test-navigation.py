"""Real Chromium regression gate for the TV shell. Run after npm run build.
No accounts, IPTV subscription or public media downloads are required.
"""
import base64, functools, http.server, json, os, subprocess, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ['/image', '/redirect']:
            body = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOwqdiCFTEMLQkADNVaAaRyP9sAAAAASUVORK5CYII=')
            self.send_response(200); self.send_header('Content-Type', 'image/png'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if path == '/thumb-fail':
            self.send_error(404); return
        super().do_GET()
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'build/web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
seed = {'active':'demo','favs':{'live':['d1'],'movie':['f3'],'series':[]},'settings':{'autoplayLast':False,'autoPreview':False,'preview':False,'lockAdult':True,'lite':True,'motion':False,'torrentSource':'https://source.test','torrentSourceName':'Test provider'}}
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
    page.route('https://torrentio.strem.fun/**', lambda route: route.fulfill(json={'streams':[*({'name':'1080p','title':'Internet release · seeders: 999','infoHash':format(i+1,'040x'),'fileIdx':0} for i in range(40))]}))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
    page.wait_for_function('window.__bootMs !== undefined')
    def focused():
        assert page.evaluate('document.activeElement.classList.contains("f") && document.activeElement.isConnected && document.activeElement.getBoundingClientRect().width > 0'), 'Remote focus lost or hidden'
    for screen in ['home','live','guide','movies','series','settings']:
        page.evaluate('(s)=>__app.go(s,{}, {root:true})',screen)
        for key in ['ArrowDown','ArrowDown','ArrowRight','ArrowDown','ArrowLeft','ArrowUp']:
            page.keyboard.press(key)
            focused()
    page.evaluate('__app.go("settings",{}, {root:true})')
    for _ in range(13):
        page.keyboard.press('ArrowDown')
        focused()
    page.wait_for_function('document.activeElement.dataset.sec === "about" && document.activeElement.getBoundingClientRect().bottom <= innerHeight')
    page.evaluate('__app.go("search",{q:"harbour"},{root:true})')
    page.wait_for_selector('[data-torrent="0"]',state='attached')
    assert page.locator('[data-tab=lumen]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-tab=torrents]').click()
    page.locator('[data-torrent="0"]').click()
    page.wait_for_selector('[data-source="0"]')
    assert page.locator('#td-play').is_enabled()
    assert 'Internet · Torrentio' in page.locator('[data-source="0"]').inner_text()
    assert 'internet torrents' in page.locator('#td-status').inner_text()
    # OK on the remote routes the focused row straight to playback, once.
    page.evaluate("window.__plays=[];__app.current().ctl.launch=function(download){window.__plays.push({index:this.index,download})}")
    page.locator('[data-source="0"]').focus()
    page.keyboard.press('Enter')
    assert page.evaluate('JSON.stringify(__plays)') == '[{"index":0,"download":false}]'
    assert 'OK · Play' in page.locator('[data-source="0"]').inner_text()
    for _ in range(12):
        page.keyboard.press('ArrowDown')
        focused()
    assert page.evaluate('document.activeElement.hasAttribute("data-source")')
    page.keyboard.press('Enter')
    assert page.evaluate('__plays.length') == 2
    assert page.evaluate('__plays[1].index > 0 && !__plays[1].download')
    assert page.locator('#td-play').evaluate('(b)=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}')
    page.keyboard.press('ArrowRight')
    assert page.evaluate('document.activeElement.id') == 'td-download'
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
    # Exercise data-URI decoding and the actual shared UI fixture. Android CI also
    # runs this same fixture against NativeBridge, without a mocked image service.
    fixture = subprocess.run([str(ROOT/'node_modules/.bin/esbuild'), 'tools/artwork-fixture.js', '--bundle', '--format=iife', '--target=chrome69'], text=True, capture_output=True, cwd=ROOT, check=True).stdout
    # Use a valid JPEG supplied by the test server via the same transparent bridge protocol.
    native_mock = """
      window.__imageBase=location.origin;
      const bodies=new Map();
      window.Native={cacheRead:()=>null, take:id=>{const b=bodies.get(id);bodies.delete(id);return b;},
        artwork:(id,url,w)=>fetch(url).then(r=>{if(!r.ok)throw Error();return r.blob()}).then(blob=>new Promise(resolve=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(img.src);resolve(c.toDataURL('image/jpeg'));};img.src=URL.createObjectURL(blob);})).then(data=>{bodies.set(id,data);window.__nat('artwork',{id,ok:true});},()=>window.__nat('artwork',{id,ok:false,error:'Unavailable'}))};
    """
    (ROOT/'build/web/artwork-fixture.html').write_text('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><script>'+native_mock+'</script><script>'+fixture+'</script>')
    page.goto(f'http://127.0.0.1:{server.server_port}/artwork-fixture.html')
    page.wait_for_function('window.__imageResult && __imageResult().loaded && __imageResult().native && __imageResult().missing')
    assert not errors, errors
    page.screenshot(path=str(out/'native-artwork.png'))
    browser.close()
    print('PASS: existing screens, D-pad focus, source selection, Back/tab restoration, actual image decoding through the artwork bridge; no JavaScript errors.')
finally:
 server.shutdown()
