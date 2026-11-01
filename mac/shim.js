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

  document.documentElement.classList.add('desktop');
})();
