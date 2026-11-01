// Injected by the Mac app before the interface loads: window.Native, backed by the app's
// local server (synchronous requests, so methods return values like Android's bridge).
(() => {
  const T = '__TOKEN__';
  const call = (m, args) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/native/' + m + '?t=' + T, false);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify(args));
    if (x.status === 204) return null;
    if (x.status !== 200) throw new Error('Native.' + m + ' failed (' + x.status + ')');
    return x.responseText;
  };
  const names = ['deviceInfo', 'viewSize', 'exit', 'http', 'take', 'catalog', 'epgImport', 'epgInfo', 'epgNow', 'epgRange', 'epgSearch',
    'cacheRead', 'cacheWrite', 'voiceStart', 'voiceStop', 'play', 'stop', 'pause', 'resume', 'seekBy', 'seekTo', 'setRect', 'setResize',
    'setBuffer', 'apps', 'openWith', 'copy', 'openUrl', 'head', 'call', 'subtitleHash', 'loadSubtitle', 'tracks', 'selectTrack',
    'setSpeed', 'companion', 'showKeyboard', 'installUpdate'];
  const N = {};
  for (const m of names) N[m] = (...a) => call(m, a);
  N.openWith = (...a) => call('openWith', a) === 'true';
  window.Native = N;
  window.__thumbBase = '/thumb?';
  window.__desktop = true;

  // Trackpad and mouse wheel move through the interface like the arrow keys:
  // one step per notch (or per ~1 cm of trackpad travel), never faster than the screen can follow.
  let ax = 0, ay = 0, lastT = 0, lastStep = 0;
  const STEP_Y = 110, STEP_X = 90, MIN_GAP = 70;
  const press = (key) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  addEventListener('wheel', (e) => {
    const t = Date.now();
    window.__lastWheel = t;
    if (t - lastT > 220) { ax = 0; ay = 0; }      // a new gesture
    lastT = t;
    // lines/pages (mouse wheels on some settings) -> pixels
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    ax += e.deltaX * k; ay += e.deltaY * k;
    if (t - lastStep < MIN_GAP) return;
    if (Math.abs(ay) >= STEP_Y && Math.abs(ay) >= Math.abs(ax)) { press(ay > 0 ? 'ArrowDown' : 'ArrowUp'); ay = 0; ax = 0; lastStep = t; }
    else if (Math.abs(ax) >= STEP_X) { press(ax > 0 ? 'ArrowRight' : 'ArrowLeft'); ax = 0; ay = 0; lastStep = t; }
  }, { passive: true });
})();
