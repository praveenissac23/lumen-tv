"""Renders the Lumen TV icon, adaptive icon layers and TV banner to PNG with headless Chromium."""
import os, base64
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
FONT = base64.b64encode(open(os.path.join(ROOT, 'web', 'fonts', 'schibsted-grotesk-latin-700-normal.woff2'), 'rb').read()).decode()

# The mark: a glowing play prism inside a lens ring, with drifting bubbles. 108x108 grid (adaptive icon units).
DEFS = '''
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2738"/><stop offset=".55" stop-color="#121822"/><stop offset="1" stop-color="#0c0f15"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f3c983" stop-opacity=".55"/><stop offset=".6" stop-color="#ec8a6e" stop-opacity=".12"/><stop offset="1" stop-color="#ec8a6e" stop-opacity="0"/></radialGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d79c"/><stop offset=".5" stop-color="#cfa968"/><stop offset="1" stop-color="#ec8a6e"/></linearGradient>
  <linearGradient id="play" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4dc"/><stop offset=".45" stop-color="#f3c983"/><stop offset="1" stop-color="#ec8a6e"/></linearGradient>
  <linearGradient id="facet" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <radialGradient id="bub" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#fffaf0"/><stop offset=".4" stop-color="#f6d79c" stop-opacity=".9"/><stop offset="1" stop-color="#ec8a6e" stop-opacity=".5"/></radialGradient><radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset=".45" stop-color="#f6d79c" stop-opacity=".35"/><stop offset="1" stop-color="#f6d79c" stop-opacity="0"/></radialGradient>
</defs>'''
MARK = '''
  <circle cx="54" cy="54" r="30" fill="url(#glow)"/>
  <circle cx="54" cy="54" r="24" fill="none" stroke="url(#ring)" stroke-width="3.2"/>
  <path d="M47.5 41.5 Q46 40.6 46 42.4 V65.6 Q46 67.4 47.5 66.5 L67.2 55.2 Q68.8 54 67.2 52.8 Z" fill="url(#play)"/>
  <path d="M47.5 41.5 Q46 40.6 46 42.4 V54 L68 54 Q68.6 53.4 67.2 52.8 Z" fill="url(#facet)" opacity=".5"/>
  <circle cx="79" cy="31" r="9" fill="url(#halo)"/><circle cx="79" cy="31" r="4.2" fill="url(#bub)"/>
  <circle cx="86.5" cy="43.5" r="4.6" fill="url(#halo)"/><circle cx="86.5" cy="43.5" r="2.1" fill="url(#bub)"/>
  <circle cx="28" cy="77" r="6.6" fill="url(#halo)"/><circle cx="28" cy="77" r="3" fill="url(#bub)"/>'''

def svg_full(px):      # legacy square icon with rounded corners
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="9 9 90 90">{DEFS}<rect x="9" y="9" width="90" height="90" rx="20" fill="url(#bg)"/>{MARK}</svg>'
def svg_fg(px):        # adaptive foreground: mark only, full 108 grid (safe zone 66)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 108 108">{DEFS}<g transform="translate(54 54) scale(.82) translate(-54 -54)">{MARK}</g></svg>'
def svg_bg(px):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 108 108">{DEFS}<rect width="108" height="108" fill="url(#bg)"/></svg>'
def html_banner():
    return f'''<html><head><style>@font-face{{font-family:S;src:url(data:font/woff2;base64,{FONT})}}
body{{margin:0;width:640px;height:360px;overflow:hidden;font-family:S}}
.b{{position:relative;width:640px;height:360px;background:radial-gradient(120% 120% at 15% 10%,#243149,#121822 55%,#0b0e14);display:flex;align-items:center;gap:14px;padding-left:40px;box-sizing:border-box}}
.t{{color:#f2ece1;font-size:76px;font-weight:700;letter-spacing:-2px;line-height:1;white-space:nowrap}}.t span{{color:#cfa968}}
.s{{color:#a7adb5;font-size:27px;margin-top:10px;letter-spacing:.2px}}
i{{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,.28),rgba(159,192,255,.07) 55%,transparent 72%)}}</style></head>
<body><div class="b"><i style="width:180px;height:180px;right:-30px;top:-50px"></i><i style="width:90px;height:90px;right:150px;bottom:20px"></i>
<svg width="210" height="210" viewBox="9 9 90 90" style="flex:none">{DEFS}{MARK}</svg><div><div class="t">Lumen<span> TV</span></div><div class="s">Live TV, films and series</div></div></div></body></html>'''

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    def shoot(svg, px, path):
        pg.set_viewport_size({'width': px, 'height': px})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        pg.screenshot(path=path, omit_background=True, clip={'x': 0, 'y': 0, 'width': px, 'height': px})
    for d, k in DENS.items():
        shoot(svg_full(int(48 * k)), int(48 * k), f'{RES}/mipmap-{d}/ic_launcher.png')
        shoot(svg_fg(int(108 * k)), int(108 * k), f'{RES}/mipmap-{d}/ic_launcher_fg.png')
        shoot(svg_bg(int(108 * k)), int(108 * k), f'{RES}/mipmap-{d}/ic_launcher_bg.png')
    pg.set_viewport_size({'width': 640, 'height': 360})
    pg.set_content(html_banner()); pg.wait_for_timeout(300)
    os.makedirs(f'{RES}/drawable-xhdpi', exist_ok=True)
    pg.screenshot(path=f'{RES}/drawable-xhdpi/banner.png')
    shoot(svg_full(512), 512, os.path.join(ROOT, 'design', 'icon-512.png'))
    pg.set_viewport_size({'width': 640, 'height': 360}); pg.set_content(html_banner()); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(ROOT, 'design', 'banner.png'))
    b.close()
print('done')
