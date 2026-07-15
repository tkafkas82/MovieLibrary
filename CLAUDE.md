# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **local** web app that scans your disks for movie files (`.mkv` by default),
parses a title + year from each filename, enriches them with IMDb details via
the **OMDb API**, caches everything to a local JSON DB, and serves a searchable
poster-grid library at `http://localhost:4700`.

The disk work always runs on the user's machine against the local filesystem.
The app is split into two deployable halves (a **hybrid**):

- **Helper** (`server.js`) — runs locally on each PC (`http://localhost:4700`).
  Does the scanning, OMDb lookups, and open/reveal. Sends CORS + Private
  Network Access headers so a remotely-hosted UI may call it.
- **UI** (`public/`) — a static, installable **PWA**. Can be served by the
  helper itself (localhost, works offline/any browser) OR hosted in the cloud
  (`vercel.json` pins a pure-static deploy of `public/`) and opened from any PC
  in Chrome/Edge, where it auto-detects the local helper.

A cloud server can never see the user's disks, so "deploy the server to Vercel"
is impossible — only the UI is hosted; the helper stays local. Google login was
considered and rejected: the library is a list of machine-specific paths, so
cross-device sync would be meaningless.

## Run

- Cross-platform launchers (install deps on first run, start helper; optional
  port arg): `start.bat` (Windows), `start.sh` (macOS/Linux), `start.command`
  (double-clickable macOS). All just wrap `node server.js`. The server itself
  opens the browser when a local UI is present (skip with `MOVIELIB_NO_OPEN=1`).
- `npm run build` (`build.mjs`) → standalone binaries in `dist/`, no Node needed
  on the target. esbuild bundles the ESM source to one CJS file, then
  `@yao-pkg/pkg` wraps it in a Node runtime per OS.
- `npm start` / `node server.js` — start without the launcher. `PORT` env overrides (default 4700).
- Node 18+ required (uses the global `fetch`; no fetch polyfill dependency).

## Architecture

- `server.js` — the helper: Express + REST/SSE endpoints; serves `public/`;
  CORS/PNA middleware + `GET /api/health` (returns `{app:'movielibrary-helper'}`)
  so a hosted UI can detect it.
- `lib/scan.js` — recursive disk walk (`scanRoots`); skips system/junk dirs,
  swallows EACCES. Follows directory junctions/symlinks (resolves via `stat`)
  with a `visited` realpath set to prevent loops. `listDrives()` suggests roots
  per OS (Windows drive letters / macOS `/Volumes` / Linux `/media`,`/mnt` +
  home). When no `scanRoots` are set, `/api/scan/stream` scans `listDrives()`
  (the whole computer).
- `lib/parse.js` — `parseMovie(fileName)` → `{ title, year }`. Strips scene tags
  (resolution/source/codec/audio/group). Uses the **last** plausible year token
  so year-titled films (`Blade Runner 2049 (2017)`, `1917 (2019)`) parse right.
- `lib/omdb.js` — `fetchOmdb(apiKey, title, year)`. Tries title+year → title →
  search-then-fetch-by-imdbID. Returns `{ found, info }` or `{ found:false, error }`.
- `lib/store.js` — JSON persistence under `data/` (`config.json`, `library.json`,
  gitignored). Library keyed by `idForPath` (base64url of the absolute path).
- `public/` — zero-build vanilla-JS PWA (`index.html`, `style.css`, `app.js`),
  plus `manifest.webmanifest`, `sw.js` (shell cache), and `icons/*.svg`.
  `app.js` resolves a **helper base URL**: same-origin when served by the helper
  (localhost), else `localStorage.helperUrl` || `http://localhost:4700`. All
  `/api/*` calls and the `EventSource` streams route through it. When hosted and
  the helper is unreachable it shows an offline setup screen.
- `vercel.json` — pins a pure-static deploy of `public/` (empty build/install
  commands; sets `sw.js`/manifest headers).
- `public/auth.js` + `public/firebase-config.js` — OPTIONAL Google sign-in +
  settings sync (Firebase Auth + Firestore), exposed to `app.js` as
  `window.MovieSync`. Self-disables unless `firebase-config.js` sets a real
  `window.FIREBASE_CONFIG`. Syncs `{scanRoots, formats, omdbApiKey}` to
  `users/<uid>`. On sign-in the cloud config is POSTed to the helper; on Save
  it's written back. The OMDb key isn't readable client-side (helper hides it),
  so it only reaches the cloud when the user saves Settings with a key typed.

## Data flow

1. **Settings** (`POST /api/config`) — user sets `scanRoots`, `formats`, and the
   OMDb API key. The key is stored server-side and never returned to the client
   (`publicConfig()` exposes only `hasApiKey`).
2. **Scan** (`GET /api/scan/stream`, SSE) — walks roots, adds new files to the
   library (parsed title/year, `enriched:false`), refreshes existing entries.
3. **Fetch IMDb** (`GET /api/enrich/stream`, SSE) — for each un-enriched movie
   (or all, with `?force=1`), calls OMDb, stores `movie.imdb`, streams progress.
   Rate-limited (~120ms/lookup) for the free tier; aborts on 401 (bad key).
4. **Library** (`GET /api/library`) — the whole cached list for rendering.
5. `POST /api/open` / `POST /api/reveal` — launch the file in the default player /
   reveal it in the file manager, cross-platform (`launch()` in server.js):
   Windows `explorer.exe [/select,]`, macOS `open [-R]`, Linux `xdg-open` (reveal
   opens the containing dir).

## Notes / gotchas

- SSE endpoints are **GET** so the browser `EventSource` can consume them; config
  (roots, key) lives server-side, so these need no request body.
- OMDb is the metadata source because it returns IMDb rating + director + genre +
  poster directly. A free key (1000/day) is required for enrichment; scanning and
  listing work without one. Key: https://www.omdbapi.com/apikey.aspx
- Poster images load directly from `m.media-amazon.com` (fine on a local page).
- Filename parsing is heuristic; `?force=1` re-enrichment and manual removal exist.

### Packaging gotchas (`npm run build`)
- **Target Node 22, not 18.** pkg has no prebuilt node18 base binary → it tries
  to compile Node from source (needs Visual Studio) and fails.
- **`--no-bytecode --public` is required.** pkg's default bytecode step spawns the
  *target* Node binary to snapshot V8 bytecode — impossible when cross-compiling
  (and flaky on Windows: `spawn UNKNOWN`). These flags embed plain JS instead.
- **`import.meta.url` is `undefined` in the bundled binary** (esbuild ESM→CJS +
  pkg snapshot), so `fileURLToPath()` would throw at startup. `__dirname` is
  computed in a try/catch in `server.js` + `lib/store.js`.
- **Packaged paths come from `process.execPath`, not `__dirname`** (the snapshot
  is read-only). When `process.pkg`/`process.versions.pkg` is set, `data/` and
  the optional local `public/` are resolved next to the executable.
- **macOS binaries cross-built off a Mac are unsigned** → gatekeeper kills them.
  Users run `xattr -dr com.apple.quarantine` + `codesign --sign -` once.
