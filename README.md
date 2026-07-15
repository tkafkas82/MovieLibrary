# 🎬 MKV Movie Library

A **local** web app that scans your disks for movie files, pulls IMDb details for each one, and serves a fast, searchable **poster-grid library** in your browser — all running entirely on your own machine.

![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/UI-vanilla%20JS-f7df1e?logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build-none-brightgreen)

> Point it at your movie folders, add a free OMDb key, and it turns a pile of `Blade.Runner.2049.2017.1080p.mkv` files into a clean wall of posters with ratings, directors, and genres.

---

## ✨ Features

- **📁 Disk scanning** — recursively walks the drives/folders you configure, finds `.mkv` (or any extensions you add), and skips system/junk directories.
- **🧠 Smart filename parsing** — strips scene tags (resolution, source, codec, audio, release group) and extracts the real **title + year**, handling tricky year-titled films like `1917 (2019)` and `Blade Runner 2049`.
- **🎞️ IMDb enrichment** — looks each movie up on the [OMDb API](https://www.omdbapi.com/) (IMDb data) for **rating, director, genre, plot, and poster**.
- **🖼️ Poster-grid UI** — a responsive, searchable library that renders straight from a local cache. Zero build step, plain HTML/CSS/JS.
- **▶️ Open & reveal** — launch a movie in your default player or reveal it in Explorer, right from the browser.
- **⚡ Live progress** — scanning and enrichment stream progress over Server-Sent Events, so you watch the library fill in real time.
- **🔒 Local-first** — everything (files, config, cache, API key) stays on your machine. No cloud, no deploy, no telemetry.

---

## 🚀 Quick start

**Requirements:** [Node.js 18+](https://nodejs.org/) (uses the built-in `fetch`) and a free OMDb API key.

```bash
# 1. Install dependencies (just express)
npm install

# 2. Start the server
npm start
```

Then open **http://localhost:4700**.

On Windows you can also just double-click **`start.bat`** — it installs deps on first run, starts the server, and opens the browser. Pass a port to override: `start.bat 4800`.

### First-run setup (in the app)

1. Open **Settings**.
2. Add one or more **scan roots** (e.g. `D:\Movies`, `E:\TV`).
3. Get a free **OMDb API key** at <https://www.omdbapi.com/apikey.aspx> (1,000 lookups/day) and paste it in.
4. **Scan** to index your files, then **Fetch IMDb** to enrich them.

Scanning and browsing work without a key — you only need one for IMDb details/posters.

---

## ⚙️ Configuration

Config is set from the in-app **Settings** panel and stored server-side in `data/config.json`:

| Setting | Description | Default |
| --- | --- | --- |
| `scanRoots` | Folders/drives to scan recursively | _(none — set in Settings)_ |
| `formats` | File extensions to include | `[".mkv"]` |
| `omdbApiKey` | Your OMDb API key (kept server-side, never sent to the browser) | _(none)_ |

The server also honours a `PORT` environment variable (default `4700`).

> 🔐 **Your API key is never committed.** `data/config.json` and `data/library.json` are git-ignored, and the server only ever exposes `hasApiKey` to the client — not the key itself.

---

## 🧩 How it works

```
Browser (poster grid, SSE)
        │
        ▼
Express server  (server.js)
 ├─ lib/scan.js   → recursive disk walk of scanRoots
 ├─ lib/parse.js  → filename → { title, year }
 ├─ lib/omdb.js   → OMDb lookup (title+year → title → search-by-id)
 └─ lib/store.js  → JSON cache under data/ (keyed by absolute path)
```

1. **Settings** (`POST /api/config`) — save scan roots, formats, and the OMDb key.
2. **Scan** (`GET /api/scan/stream`, SSE) — index files, parse title/year, mark as un-enriched.
3. **Fetch IMDb** (`GET /api/enrich/stream`, SSE) — enrich each movie via OMDb (rate-limited for the free tier; add `?force=1` to re-enrich everything).
4. **Library** (`GET /api/library`) — the cached list the UI renders.
5. **Open / Reveal** (`POST /api/open`, `POST /api/reveal`) — play the file or show it in Explorer.

---

## 📂 Project structure

```
MovieLibrary/
├─ server.js          # Express server + REST/SSE endpoints
├─ lib/
│  ├─ scan.js         # recursive disk walk
│  ├─ parse.js        # filename → title/year (scene-tag stripping)
│  ├─ omdb.js         # OMDb/IMDb lookups
│  └─ store.js        # JSON persistence under data/
├─ public/            # vanilla-JS SPA (index.html, style.css, app.js)
├─ data/              # config + library cache (git-ignored)
├─ start.bat          # Windows launcher (install + run + open browser)
└─ package.json
```

---

## 📝 Notes

- Filename parsing is heuristic — it handles most scene-release naming, but odd names may mis-parse. Re-enrichment (`?force=1`) and manual removal exist.
- Posters load directly from `m.media-amazon.com` (fine on a local page).
- OMDb is used because it returns IMDb rating + director + genre + poster in one call.

---

*A small personal/hobby project — runs locally, no warranty. Enjoy your movie wall. 🍿*
