"""A fake Xtream Codes server for testing the app end to end (large catalogue, XMLTV guide)."""
import json, time, random
from urllib.parse import urlparse, parse_qs

random.seed(7)
N_LIVE, N_VOD, N_SERIES = 4000, 6000, 900
LCATS = ['UK | News', 'UK | Sports', 'AE | Arabic', 'IN | Malayalam', 'IN | Hindi', 'US | Entertainment', 'Kids', 'Documentary', 'XXX Adult']
WORDS = ['Prime', 'Star', 'Nova', 'Delta', 'Sky', 'One', 'Max', 'Gold', 'Plus', 'Live', 'Arena', 'Vision', 'Asia', 'Gulf', 'Cinema']

def live():
    out = []
    for i in range(N_LIVE):
        c = i % len(LCATS)
        name = f"{LCATS[c][:2]}: {random.choice(WORDS)} {random.choice(WORDS)} {i % 50} {'HD' if i % 3 else 'FHD'}"
        out.append({'num': i + 1, 'name': name, 'stream_type': 'live', 'stream_id': 1000 + i, 'stream_icon': '',
                    'epg_channel_id': f'ch{i}.tv' if i < 300 else '', 'added': str(1700000000 + i), 'category_id': str(c + 1),
                    'tv_archive': 1 if i % 4 == 0 else 0, 'tv_archive_duration': 3 if i % 4 == 0 else 0})
    return out

def vod():
    return [{'num': i + 1, 'name': f"{random.choice(WORDS)} {random.choice(WORDS)} ({2000 + i % 26})", 'stream_type': 'movie',
             'stream_id': 50000 + i, 'stream_icon': '', 'rating': str(round(random.uniform(4, 9), 1)), 'rating_5based': round(random.uniform(2, 4.5), 1),
             'added': str(1700000000 + i * 60), 'category_id': str(100 + i % 6), 'container_extension': 'mkv'} for i in range(N_VOD)]

def series():
    return [{'num': i + 1, 'name': f"{random.choice(WORDS)} Saga {i}", 'series_id': 9000 + i, 'cover': '', 'plot': 'Plot text',
             'genre': 'Drama', 'releaseDate': f'{2010 + i % 15}-01-01', 'rating_5based': 3.5, 'last_modified': str(1700000000 + i), 'category_id': str(200 + i % 4)} for i in range(N_SERIES)]

CACHE = {}
def payload(action):
    if action in CACHE: return CACHE[action]
    data = {
        'get_live_categories': [{'category_id': str(i + 1), 'category_name': n, 'parent_id': 0} for i, n in enumerate(LCATS)],
        'get_live_streams': live(),
        'get_vod_categories': [{'category_id': str(100 + i), 'category_name': n} for i, n in enumerate(['Action', 'Comedy', 'Drama', 'Malayalam', 'Hindi', 'Kids'])],
        'get_vod_streams': vod(),
        'get_series_categories': [{'category_id': str(200 + i), 'category_name': n} for i, n in enumerate(['Drama', 'Crime', 'Comedy', 'Arabic'])],
        'get_series': series(),
    }.get(action)
    CACHE[action] = json.dumps(data).encode()
    return CACHE[action]

def xmltv():
    t0 = int(time.time()) // 3600 * 3600 - 2 * 86400
    parts = ['<?xml version="1.0" encoding="UTF-8"?><tv>']
    for i in range(300):
        t = t0
        k = 0
        while t < t0 + 4 * 86400:
            d = [1800, 3600, 5400][(i + k) % 3]
            s = time.strftime('%Y%m%d%H%M%S', time.gmtime(t)); e = time.strftime('%Y%m%d%H%M%S', time.gmtime(t + d))
            title = ['Evening News', 'Football Tonight: City v United', 'Movie Night', 'Kerala Kitchen', 'Live Cricket', 'Documentary Hour'][(i + k) % 6]
            parts.append(f'<programme start="{s} +0000" stop="{e} +0000" channel="ch{i}.tv"><title lang="en">{title}</title><desc>Programme &amp; details {k}</desc></programme>')
            t += d; k += 1
    parts.append('</tv>')
    return ''.join(parts).encode()

def handle(path, query):
    """Return (status, content_type, body) or None if not an Xtream route."""
    q = parse_qs(query)
    if path.endswith('/player_api.php'):
        if q.get('username', [''])[0] != 'demo' or q.get('password', [''])[0] != 'demo':
            return 200, 'application/json', json.dumps({'user_info': {'auth': 0}}).encode()
        a = q.get('action', [''])[0]
        if not a:
            return 200, 'application/json', json.dumps({'user_info': {'auth': 1, 'status': 'Active', 'exp_date': str(int(time.time()) + 200 * 86400), 'max_connections': '2', 'active_cons': '0'},
                                                         'server_info': {'timezone': 'Asia/Dubai'}}).encode()
        if a == 'get_series_info':
            sid = q.get('series_id', ['0'])[0]
            eps = {str(s): [{'id': f'{sid}{s}{e}', 'episode_num': e, 'title': f'Episode {e}', 'container_extension': 'mp4', 'info': {'duration': '00:45:00'}} for e in range(1, 9)] for s in range(1, 4)}
            return 200, 'application/json', json.dumps({'info': {'plot': 'Series plot'}, 'episodes': eps}).encode()
        if a == 'get_vod_info':
            return 200, 'application/json', json.dumps({'info': {'plot': 'A film plot from the server.', 'cast': 'A. Actor, B. Actor', 'director': 'C. Director', 'genre': 'Action', 'duration': '01:52:00'}}).encode()
        return 200, 'application/json', payload(a)
    if path.endswith('/xmltv.php'):
        return 200, 'application/xml', xmltv()
    return None
