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

## Checks still required

- Run `python tools/test-navigation.py` in real Chromium. This environment cannot launch local Chromium; the provided cloud browser cannot reach the local server. The workflow now runs this check before APK compilation/publication.
- Build the signed APK through GitHub Actions using the existing signing secrets. No Android SDK or signing private key is present locally.
- Confirm APK application ID remains `tv.lumen.app`, version code is higher than the installed version, and certificate fingerprint matches build 36.
- Perform actual TV D-pad/Back/long-press checks, upgrade-in-place retention checks, VLC/MX playback and ADM/1DM downloads with a real subscription. Mocked tests do not verify provider account limits, region/network behaviour or real media playback.
- A source add-on must be configured by the user; no torrent index is bundled. HTTP(S) direct streams and v1 hexadecimal info hashes are supported. Streams requiring custom HTTP headers, external web pages, or unsupported hash formats are excluded.

No APK has been built or published from this work yet. No existing TV installation or remote repository has been changed.
