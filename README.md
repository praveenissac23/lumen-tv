# Lumen TV

A light, fast IPTV player for Fire TV, Google TV and Android TV boxes. It plays your own subscription (Xtream Codes login or M3U link) with a clean 10-foot interface, master search and voice search.

## What's in it

| Area | Features |
| --- | --- |
| Home | Master search bar with mic, last channel playing live, favourite and recent channels, continue watching, **a section for each of your languages (newest 50 films, channels, series)**, any category you pin, live sport now, catch-up from earlier today |
| Languages | Pick Malayalam, Tamil, Hindi and others in Settings > Home and languages, in the order you want. Detected from category names and title tags ("ML:", "[Tamil]"). "All Malayalam" etc. appear at the top of Live TV and Films |
| Long press (hold OK) | On any channel, film or episode: Play, **Download**, **Play in VLC / MX Player / Just Player**, Play in another app, **Copy link**, **Show link as QR code**, favourite, mark as watched, **pin its category to home** |
| Downloads | Sent to **ADM or 1DM** with a clean file name (e.g. `Film (2025).mkv`). When the playlist has the same film in several qualities you choose 4K / 1080p / HEVC / 720p **with the file size of each**. Remember-my-download-app option. Copy link and QR fallbacks |
| Subtitles | Uses subtitles inside the video first; otherwise searches **OpenSubtitles.com** by the file's exact hash (perfect sync) and by title, in your preferred languages. Optional auto-fetch. Size small/medium/large |
| Player | Subtitles, audio language, speed, sleep timer, picture size, download and external player from the Menu button. **Auto-plays the next episode** with a 10 s countdown. Resume points, watched marks |
| Voice search | Fire TV: Menu button opens the search box with the Fire TV keyboard; **hold the Alexa button to dictate** into it. Google TV / Android TV: the remote's mic works directly. Phone remote works everywhere |
| Phone remote | Scan a QR code on the TV to open a page on your phone: type or dictate searches, add Xtream/M3U logins, paste the subtitle key, set a wallpaper. Protected by a 4-digit code |
| Look | Wallpapers (midnight bubbles, deep teal, plum, desert dusk, Kerala green, plain, your own picture), very slow drifting bubbles (paused during playback), five highlight colours, new app icon and TV banner |
| Also | Master search across channels, guide, films and series; TV guide with catch-up; parental PIN; multiple playlists; account expiry; trailers |

## Why it's fast

- The whole catalogue and guide are cached on the device, so the app opens straight onto the home screen and refreshes in the background. With 4,000 channels, 6,000 films and a full guide, the app's own start-up work took under 60 ms in a desktop browser; expect a few hundred milliseconds on a Fire TV Stick.
- The guide (XMLTV) is downloaded and parsed natively in Kotlin, not in the web view.
- Lists and grids only draw the rows on screen, so 10,000+ channels scroll smoothly.
- No frameworks: about 170 KB of JavaScript, a 4-weight font and the system video decoder through ExoPlayer (Media3). The APK should come out at around 3 MB.

## Updates and builds

Every change pushed to `main` is built by GitHub Actions and published as the latest release (`build-N`). The app checks that release on start and every 6 hours; when there's a newer build, the home screen shows **Update available**. Press it, then Install. Settings > About > Check for updates does the same on demand.

Builds are signed with a fixed key kept in two private repository secrets, `KEYSTORE_B64` and `KEYSTORE_PASSWORD` (Settings > Secrets and variables > Actions). Without them a build still works but is signed with a temporary key and won't install over the existing app.

First install on a Fire TV: Settings > My Fire TV > Developer options > Install unknown apps > Downloader: on. Then in Downloader open
`https://github.com/praveenissac23/lumen-tv/releases/latest/download/app-release.apk`.
The first in-app update asks once to allow installs from Lumen TV.

## About the Alexa button

Amazon sends a press of the Alexa button straight to Alexa; no app can take it over. What does work on Fire TV: open Lumen's search (≡ Menu, or the mic on the home screen), then **hold the Alexa button while the Fire TV keyboard is up** and speak. Fire OS types your words into the search box. Amazon has switched this keyboard dictation off and on again on some models in past updates, so the phone remote is there as a dependable backup. The only official route for "Alexa, find X in Lumen" is Amazon's Video Skills Kit, which needs an AWS service and a catalogue integration.

## Subtitles setup

Create a free account at opensubtitles.com, open Profile > API consumers, create a consumer and copy its key. Paste it in Settings > Subtitles (easiest from the phone remote). Free accounts can download a limited number of subtitles per day.

## Project layout

```
web/            the TV interface (vanilla JS modules + CSS), bundled by esbuild
  src/app.js        shell, router, navigation rail, voice overlay, boot
  src/data.js       Xtream Codes API, M3U parser, guide lookups, stream URLs
  src/search.js     master search ranking and spoken-command parsing
  src/actions.js    long-press menu, downloads with quality choice, external players, QR
  src/languages.js  language detection and home sections
  src/subs.js       OpenSubtitles search and auto-subtitles
  src/look.js       wallpapers, bubbles, highlight colour
  src/player.js     playback, on-screen display, zapping, catch-up
  src/nav.js        remote control focus engine
  src/screens/      home, live, guide, films/series, search, settings
android/        Kotlin app: WebView UI over an ExoPlayer video layer
  MainActivity.kt   remote keys, voice permission, lifecycle
  NativeBridge.kt   window.Native: network, cache, voice, player, other apps, subtitles
  LocalServer.kt    phone remote web page on port 8899
  PlayerHost.kt     ExoPlayer setup tuned for IPTV (TS flags, HLS fallback, buffers)
  Net.kt            HTTP with redirects/gzip and the streaming XMLTV parser
tools/          build script, screenshot runner, mock Xtream server, bridge test
design/         icon and banner source (icon.py renders all sizes)
```

`npm run shots` renders every screen with demo data and a mock 4,000-channel Xtream server into `build/shots`.

Lumen plays streams from playlists you add. It does not include any channels or content.
