# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **local** web app that scans your disks for movie files (`.mkv` by default),
parses a title + year from each filename, enriches them with IMDb details via
the **OMDb API**, caches everything to a local JSON DB, and serves a searchable
poster-grid library at `http://localhost:4700`.

Everything runs on the user's machine against the local filesystem — there is no
cloud/deploy component (same spirit as the sibling LogViewer / NewAlbumReleases
apps).

## Run

- `start.bat` — installs deps on first run (only `express`), starts the server,
  opens the browser. Optional port arg: `start.bat 4800`.
- `npm start` / `node server.js` — start without the launcher. `PORT` env overrides (default 4700).
- Node 18+ required (uses the global `fetch`; no fetch polyfill dependency).

## Architecture

- `server.js` — Express server + REST/SSE endpoints; serves `public/`.
- `lib/scan.js` — recursive disk walk (`scanRoots`); skips system/junk dirs and
  symlinks, swallows EACCES. `listDrives()` suggests existing drive letters.
- `lib/parse.js` — `parseMovie(fileName)` → `{ title, year }`. Strips scene tags
  (resolution/source/codec/audio/group). Uses the **last** plausible year token
  so year-titled films (`Blade Runner 2049 (2017)`, `1917 (2019)`) parse right.
- `lib/omdb.js` — `fetchOmdb(apiKey, title, year)`. Tries title+year → title →
  search-then-fetch-by-imdbID. Returns `{ found, info }` or `{ found:false, error }`.
- `lib/store.js` — JSON persistence under `data/` (`config.json`, `library.json`,
  gitignored). Library keyed by `idForPath` (base64url of the absolute path).
- `public/` — zero-build vanilla-JS SPA (`index.html`, `style.css`, `app.js`).

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
   reveal it in Explorer (`explorer.exe [path]` / `explorer.exe /select,path`).

## Notes / gotchas

- SSE endpoints are **GET** so the browser `EventSource` can consume them; config
  (roots, key) lives server-side, so these need no request body.
- OMDb is the metadata source because it returns IMDb rating + director + genre +
  poster directly. A free key (1000/day) is required for enrichment; scanning and
  listing work without one. Key: https://www.omdbapi.com/apikey.aspx
- Poster images load directly from `m.media-amazon.com` (fine on a local page).
- Filename parsing is heuristic; `?force=1` re-enrichment and manual removal exist,
  but there is no manual "re-match by IMDb id" UI yet — a natural next feature.
