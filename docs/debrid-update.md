# Debrid search update — implementation and validation

Baseline: `32ddaf40d7c6c869861ead88f886a32edc1fbce8` (main).
The unmodified web build matched the JavaScript in the supplied build 36 APK byte for byte.
Original APK SHA-256: `9cd34b93e2f53b77ef7055f483614704c7ced7b9285c4af880b4f2f3886bd6ce`.

## Changes

- Keep IPTV search selected by default, with independent debounced online title search.
- Cinemeta supplies film/series metadata; configure an HTTPS Stremio-compatible stream add-on in Settings > Debrid and torrents.
- Add Real-Debrid and AllDebrid API keys, validate accounts, choose preferred provider and quality.
- Keys live in a separate app-private cache file, never in source search requests. This uses the existing storage bridge; keys are not additionally encrypted by this feature.
- Show source quality and seed counts where the add-on supplies them. Deduplicate and sort direct links first, preferred quality next, then seeds. Direct links are not represented as verified cached/ready links. Availability is checked on selection.
- Resolve magnets via Debrid, select the requested episode or ask which file to play. Preparing torrents report their state without blocking navigation or polling indefinitely.
- Use existing film/series player settings and existing ADM/1DM download dispatch. No embedded torrent client or new runtime dependency.
- Continue/recent items reopen source selection to obtain a fresh playback URL.
- Keep focus on keyboard/tabs during background result updates; restore search/tab on Back; ignore late results after leaving.
- Preserve existing settings and respect parental PIN for online catalogue access.
- Correct later theme rules that overrode light-mode focus animations.
- Require original signing secrets and match the build 36 signing certificate before publishing.

## Local checks completed

- `npm test`: 18 deterministic service and DOM tests, including both Debrid API flows, episode selection, cancellation, errors, PIN access, stale-response handling, preserved preferences and player/download handoffs using mocked native interfaces.
- `npm run build`: passes. Bundled JavaScript ~250 KB versus ~225 KB at baseline; CSS ~4 KB larger. Development-only test dependencies are not included in the APK.
- Python browser test syntax compiles; workflow YAML parses; `git diff --check` passes.

## GitHub checks completed

The final branch candidate passed all checks in [build 40](https://github.com/praveenissac23/lumen-tv/actions/runs/43152566935): service/DOM tests, real Chromium navigation (including About remaining on screen), Android release compilation, APK signature verification, certificate match against build 36, package identity, newer version code, and APK size limits.

An earlier candidate was 1,382,600 bytes versus 1,373,363 bytes for build 36. No new runtime dependencies are bundled.

## Remaining practical validation

- Actual TV D-pad/Back/long-press checks, upgrade-in-place retention, VLC/MX playback and ADM/1DM downloads with a real subscription still require a device and account. Mocked tests do not verify provider account limits, region/network behaviour or real media playback.
- A source add-on must be configured by the user; no torrent index is bundled. HTTP(S) direct streams and v1 hexadecimal info hashes are supported. Streams requiring custom HTTP headers, external web pages, or unsupported hash formats are excluded.

The release workflow publishes only main-branch builds after all checks pass. The original uploaded APK remains unchanged. The same app ID and certificate allow the installed application's updater to install the newer version in place.


### Artwork bridge and Torrent PIN removal

Torrent browsing and source details open without a PIN, including when IPTV parental controls are enabled. IPTV parental settings are preserved.

The interface no longer requests the synthetic thumbnail hostname. Android downloads and resizes artwork off the UI thread and delivers JPEG data directly through its JavaScript bridge, with at most three image requests active. Images near the visible area load first. A fresh artwork cache bypasses old failed entries; direct original URLs remain a bounded fallback. Posters, channel logos and home banners share the same path.

Debrid review fixes explicit episode mismatches, missing AllDebrid file links, reconnect messages for invalid keys, and stale Back-navigation playback. Internet torrent discovery remains separate from account credentials. Both providers' API flows, cloud preparation, key errors and cancellation are covered by deterministic tests; subscribed live playback on the user's TV cannot be exercised here.

Release gates now include the shared artwork UI fixture in a real Android WebView. The test downloads a PNG from an isolated HTTP fixture, follows a redirect, decodes Android's returned JPEG data in WebView, repairs a corrupt image cache, and retains a title when artwork is unavailable. Test dependencies and fixtures are excluded from the release APK.


### Search navigation and explicit torrent actions

The keyboard and suggestions share a scrollable track. Down from the keyboard's bottom rows reaches Speak or type, then every suggestion; Up returns through the same region. Selecting a suggestion preserves a valid focus target after repaint.

Normal source activation uses a video URL, an existing ready cloud job, a configured TorrServer, or an installed magnet handler. It never calls the magnet upload endpoints. AllDebrid and Real-Debrid uploads are explicit long-press actions. The menu also offers VLC, Android's other-player chooser, installed download managers, and an external torrent app. Uncached Debrid add-on download resolver links are converted back to magnets instead of triggering cloud preparation through their URLs.

Green Ready badges are based on a matching hash and ready status from read-only account listings. Connecting an account or an add-on's RD+/AD+ label alone does not verify readiness. The supported APIs do not provide a universal passive global-cache check; unknown availability stays unmarked. Availability checks are bounded during activation so a stalled account API does not indefinitely block external playback.

VLC requires a video stream URL and does not consume raw magnets. The optional TorrServer client retrieves torrent file metadata, selects the requested episode/file, and hands VLC an HTTP stream. The server must already run on the user's TV or network; no torrent engine or new runtime library is bundled in Lumen. Without it, magnets are handed to an installed torrent-capable app using a proper magnet intent. Physical device playback and an external server are not available in this environment; service fixtures cover these routes and production protocol is taken from the server's official API.


### OK menu and local torrent playback

OK/click on a source now opens Lumen's full source menu. Menu and hold are optional alternatives. Play/Download controls and the separate account switch above the list are removed; every operation is scoped to the selected source. The menu includes VLC, Android Open With, download managers and explicit Debrid upload actions.

On supported Android devices the native torrent engine is loaded only when a torrent playback action is selected. It retrieves metadata, chooses the requested file/episode, prebuffers verified video data, and serves a tokenized loopback HTTP URL to VLC. A foreground service keeps this stream alive while VLC is open, with a Stop notification and idle cleanup. Returning from the external player stops the local session and removes its temporary data. Internet discovery and optional Debrid ready-link playback are unchanged; raw torrents do not require a separate TorrServer or a Debrid upload on this Android build.

Android 7 / Fire OS 6 or newer is required for the native torrent engine. The APK includes 32-bit ARM for Fire TV Cube compatibility and ARM64, with x86_64 only in the debug test build. The application retains its original minimum SDK and signing identity for existing installations. APK size necessarily increases because the native engine is bundled, while ordinary IPTV browsing never starts it.

Regression checks include an actual local-peer torrent transfer of the bundled demo MP4, HTTP range/HEAD/suffix/invalid-range checks, Android video metadata extraction from the loopback stream, cancellation, and Android DPAD_CENTER/Menu events opening the same source menu. Service/DOM tests cover VLC handoff from a raw torrent and correct episode selection. No live user subscription or physical Fire Cube is available for testing.

### VLC handoff and smaller device-specific updates

Build 60's 10,852,134-byte universal APK contained 4,163,597 compressed bytes of ARM32 engine code and 5,005,410 bytes of ARM64 engine code. The Fire Cube uses an ARM32 application ABI. Releases now supply one engine architecture per APK, with the original app ID/signing certificate and a smaller Fire Cube download. ARM64 remains a separate asset selected by the in-app updater. This does not return a self-contained torrent application to its former 1.5 MB size; doing that requires external torrent processing.

Add-on tracker URLs now survive source normalization, magnet creation and metadata-only handle removal. An empty Android player result no longer stops an active local stream: a recognized player result, Stop, cancellation or idle cleanup controls its lifetime. Source failures are also shown as visible error toasts.

The release gate now installs checksum-pinned official VLC 3.6.5 in the emulator and exercises the minified release APK. It requires direct-video playback, tracker-only torrent peer discovery, playback through the actual Native bridge while Lumen is backgrounded, and a stream that survives an empty activity result. The existing HTTP range/video-frame checks, artwork test and remote input test remain. Physical Fire Cube and live subscriber accounts are outside this automated test environment.
