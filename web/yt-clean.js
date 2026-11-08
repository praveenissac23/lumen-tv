// Runs inside YouTube's player frame (injected by the app): hides every bit of YouTube's own
// interface (play/pause button, progress line, title, logo, end screens), keeping only the
// picture and the subtitles.
(function () {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return;
  var css = '.html5-video-player>*:not(.html5-video-container):not(.ytp-caption-window-container){display:none!important;opacity:0!important}'
    + '.ytp-caption-window-container{display:block!important}'
    + '.ytp-large-play-button,.ytp-bezel,.ytp-bezel-text-wrapper,.ytp-spinner,.ytp-pause-overlay,.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-watermark,.ytp-progress-bar-container,.ytp-cued-thumbnail-overlay,.ytp-ce-element,.ytp-endscreen-content,.ytp-player-content,.ytp-overlay,.ytp-paid-content-overlay,.ytp-impression-link,.ytp-youtube-button{display:none!important}'
    + '*{cursor:none!important}';
  function add() {
    if (document.getElementById('lumen-clean')) return;
    var s = document.createElement('style'); s.id = 'lumen-clean'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.documentElement) add();
  document.addEventListener('DOMContentLoaded', add);
})();
