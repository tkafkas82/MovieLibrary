# 🎬 Movie Library

A web app that scans your disks for movie files, pulls IMDb details for each one, and serves a fast, searchable **poster-grid library** in your browser. It's an **installable PWA** you can run fully locally **or** host the UI in the cloud (Vercel) while a tiny local helper does the disk work on each PC.

![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/UI-vanilla%20JS-f7df1e?logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build-none-brightgreen)

> Point it at your movie folders, add a free OMDb key, and it turns a pile of `Blade.Runner.2049.2017.1080p.mkv` files into a clean wall of posters with ratings, directors, and genres.

---

## ✨ Features

- **📁 Disk scanning** — recursively walks every subfolder of the drives/folders you configure (following directory junctions/symlinks, with loop protection), finds `.mkv` (or any extensions you add), and skips system/junk directories. **No folder set? It scans your whole computer.**
- **🧠 Smart filename parsing** — strips scene tags (resolution, source, codec, audio, release group) and extracts the real **title + year**, handling tricky year-titled films like `1917 (2019)` and `Blade Runner 2049`.
- **🎞️ Automatic IMDb enrichment** — scanning **fetches IMDb data right away** (rating, director, genre, plot, poster via the [OMDb API](https://www.omdbapi.com/)); no separate button.
- **🧹 Self-cleaning library** — files you delete from disk are **removed on the next scan** (entries on a disconnected/offline drive are kept, not wiped).
- **🖼️ Poster-grid UI** — a responsive, searchable library that renders straight from a local cache. Zero build step, plain HTML/CSS/JS.
- **▶️ Open & reveal** — launch a movie in your default player or reveal it in Explorer, right from the browser.
- **⚡ Live progress** — scanning and enrichment stream progress over Server-Sent Events, so you watch the library fill in real time.
- **📲 Installable PWA** — install it as a standalone app (its own window, icon, and splash screen) from Chrome/Edge, on desktop or mobile.
- **☁️ Host the UI, keep the data local** — deploy the UI to Vercel and open it from any PC; a small local **helper** does the disk scanning and file-opening on that machine. Your files never leave your computer.
- **☁️ Optional Google sync** — sign in with Google to save your scan folders + OMDb key to your account and restore them on any PC (see below).
- **🗂️ Saved lists** — signed-in users can save the current library as a named list (in the toolbar dropdown, default **"This PC"**) and browse their other saved lists read-only (Play/Reveal/edit are hidden, since those files aren't on this machine).
- **🔒 Local-first** — files, config, cache, and API key always stay on your machine. The cloud only ever serves static HTML/CSS/JS; it never sees your disks.

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

`npm start` works on **Windows, macOS, and Linux** (Node is the only requirement). For one-click launchers that also install deps on first run and open your browser:

| OS | Launcher | Custom port |
| --- | --- | --- |
| Windows | double-click **`start.bat`** | `start.bat 4800` |
| macOS | double-click **`start.command`** (or `./start.sh`) | `./start.sh 4800` |
| Linux | `./start.sh` | `./start.sh 4800` |

> On macOS/Linux, make the scripts executable once: `chmod +x start.sh start.command`.

### First-run setup (in the app)

1. Open **Settings**.
2. Add one or more **scan roots** (e.g. `D:\Movies`, `E:\TV`).
3. Get a free **OMDb API key** at <https://www.omdbapi.com/apikey.aspx> (1,000 lookups/day) and paste it in.
4. **Scan** to index your files, then **Fetch IMDb** to enrich them.

Scanning and browsing work without a key — you only need one for IMDb details/posters.

---

## ☁️ Host the UI on Vercel (run from any PC)

A cloud server **cannot** see your PC's disks or launch your video player — so the disk work has to run on your machine. This app splits cleanly in two:

- **UI** — static files in `public/`. Host them anywhere (Vercel), open from any PC.
- **Helper** — `server.js` running on *your* PC (`http://localhost:4700`). It does the scanning, IMDb lookups, and open/reveal. The hosted UI talks to it over your local network loopback (CORS + Private Network Access are handled for you).

```
   Any PC's browser                    That same PC
┌──────────────────────┐        ┌───────────────────────────┐
│  UI  (Vercel, HTTPS)  │ ─────▶ │  Helper (localhost:4700)   │
│  poster grid, PWA     │  API   │  scan · OMDb · open/reveal │
└──────────────────────┘        └──────────────┬────────────┘
                                                ▼  your disks
```

### Deploy the UI

```bash
npm i -g vercel        # once
vercel                 # from the project root — deploys the static public/ folder
vercel --prod          # promote to your production URL
```

`vercel.json` already pins it to a **pure static** deploy of `public/` (no build, no server). You'll get a URL like `https://your-movies.vercel.app`.

### Run the helper on each PC

The helper is cross-platform (Node runs on Windows, macOS, and Linux) and OS-aware — open/reveal uses `explorer` on Windows, `open`/`open -R` on macOS, and `xdg-open` on Linux.

1. Copy this project folder to the PC.
2. Start the helper and leave it running:
   - **Windows:** double-click `start.bat`
   - **macOS:** double-click `start.command`
   - **Linux / any:** `./start.sh` (or `npm start`)
3. Open your Vercel URL in **Chrome or Edge**. It auto-detects the helper and unlocks scanning/playback. If the helper isn't running, a friendly setup screen walks you through it (and lets you point at a custom port).

> **Browser support:** the hosted-UI → localhost-helper link works in **Chrome/Edge** (and Chromium browsers). Opening the helper's own URL (`http://localhost:4700`) directly works in any browser and needs no cloud at all.

### 🧱 Standalone binaries (no Node needed on the target PC)

Prefer not to install Node on every machine? Build self-contained executables that bundle the Node runtime. From a machine that *does* have Node:

```bash
npm install       # once, pulls the build tooling (esbuild + @yao-pkg/pkg)
npm run build     # cross-compiles all targets into ./dist
```

> **Automated releases + one-click download.** Pushing a version tag runs
> `.github/workflows/release.yml`, which builds all four binaries (ad-hoc-signing
> the macOS ones) and publishes them as a GitHub Release:
> ```bash
> git tag v1.0.0 && git push origin v1.0.0
> ```
> The deployed site's setup screen links to `releases/latest/download/…`, so
> visitors download the right helper for their OS with one click — no need to
> browse GitHub or build anything themselves.

`build.mjs` bundles the ESM source into one file (esbuild) and wraps it in a Node runtime for each OS (pkg). You get, in `dist/`:

| File | Runs on |
| --- | --- |
| `movielibrary-helper-win-x64.exe` | Windows (x64) |
| `movielibrary-helper-macos-x64` | Intel Macs |
| `movielibrary-helper-macos-arm64` | Apple-Silicon Macs |
| `movielibrary-helper-linux-x64` | Linux (x64) |
| `public/` | the UI, copied alongside |

**Distribute:**
- **Vercel-hybrid mode** — ship just the one binary. Double-click it; it runs as an API-only helper and your hosted UI connects to it.
- **Fully local mode** — ship the binary **and** the `public/` folder together (keep them in the same directory). The binary then also serves the local app and opens your browser to it.

The binary writes its cache to a `data/` folder **next to the executable**, so keep it somewhere writable.

> **Easiest (both OSes) — smart double-click launchers.** The site's setup screen offers
> `movielibrary-helper.bat` (Windows) / `movielibrary-helper.command` (macOS). Each downloads
> the right helper **once**, then just re-runs the cached copy — re-downloading only when a
> newer release exists. They're tiny scripts served by the site; the binary itself is fetched
> with `curl` (no browser "mark of the web"/quarantine), which is what avoids SmartScreen /
> Gatekeeper on the binary.
>
> **macOS — easiest:** the site's setup screen offers "Download launcher for macOS", a **zip**
> containing `movielibrary-helper.command` (zipped so the executable bit survives download — a
> raw `.command` served over the web loses `+x` and macOS refuses to run it). Unzip, then
> **right-click → Open** the `.command` once. It `curl`-downloads the right binary (curl downloads
> aren't quarantined, so this sidesteps Gatekeeper on the binary). The setup screen also shows a
> **copy-paste Terminal one-liner** as a no-clicking alternative. The zip is built on the macOS CI
> runner (`zip -X`, which preserves `+x`).
>
> **macOS — raw binary:** binaries cross-built in CI are ad-hoc signed but not *notarized*
> (no paid Apple Developer ID), so a browser-downloaded binary is quarantined. Clear it once:
> ```bash
> xattr -dr com.apple.quarantine ./movielibrary-helper-macos-arm64
> chmod +x ./movielibrary-helper-macos-arm64
> ./movielibrary-helper-macos-arm64      # run from Terminal — don't double-click in Finder
> ```
> (On Linux, `chmod +x` the binary before running.)

### 📲 Install as an app

Open the UI in Chrome/Edge and click **⬇ Install** in the header (or use the browser's install prompt). You get a standalone window with its own icon and splash screen. Works on the Vercel URL and on `localhost` alike.

---

## 🔐 Sign in with Google to sync your settings (optional)

Turn this on to save your **scan folders + OMDb key** to your Google account and have them follow you to any PC — sign in on a new machine and the app pushes those settings straight to that machine's helper. It's built on **Firebase** (Google's own Auth + Firestore), runs entirely client-side, and **stays disabled until you add a config**, so the app works fine without it.

One-time setup (~5 min, free):

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2. **Add a Web app** (`</>`) and copy the `firebaseConfig` object.
3. **Build → Authentication → Sign-in method →** enable **Google**.
4. **Authentication → Settings → Authorized domains →** add your Vercel domain (e.g. `your-app.vercel.app`). `localhost` is already allowed.
5. **Build → Firestore Database → Create database** (production mode).
6. **Firestore → Rules →** publish this (each user can touch only their own doc):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // covers the user's settings doc AND their saved lists subcollection
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
7. Paste your config into **`public/firebase-config.js`** and redeploy:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "…", authDomain: "…", projectId: "…", appId: "…"
   };
   ```

A **Sign in with Google** button then appears in the header. The Firebase web config is not a secret (Google intends it to live in client code) — security comes from the Firestore rule + authorized domains above.

> The OMDb key is stored server-side by the helper and isn't readable by the page, so it syncs to your account the first time you **save Settings with the key entered** while signed in. After that, signing in elsewhere restores it automatically.

---

## ⚙️ Configuration

Config is set from the in-app **Settings** panel and stored server-side in `data/config.json`:

| Setting | Description | Default |
| --- | --- | --- |
| `scanRoots` | Folders/drives to scan recursively | _(none — set in Settings)_ |
| `formats` | File extensions to include | `[".mkv", ".mp4"]` |
| `omdbApiKeys` | One or more OMDb API keys (one per line in Settings). When one hits its 1,000/day cap, enrichment **automatically rotates** to the next. | `[]` |

The server also honours a `PORT` environment variable (default `4700`).

> 🔑 **Multiple keys + rotation.** Add several free OMDb keys and the app fails over automatically when one is exhausted or invalid. Keys live in `data/config.json` (git-ignored) and, if you sign in with Google, sync to your account so they follow you across machines. (They're exposed to the local page — necessary for that sync/management — but OMDb keys are free and low-value.)
>
> 🎁 **Works out of the box.** A shared **default key** (`DEFAULT_OMDB_KEYS` in `server.js`) is used automatically until you add your own, so enrichment works on first run. It's a single free key shared by everyone, so its 1,000/day limit is quickly exhausted — add your own in Settings for reliable, higher limits (the app tells you when it's on the default).

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
├─ server.js              # the local HELPER — Express + REST/SSE + CORS/PNA
├─ lib/
│  ├─ scan.js             # recursive disk walk
│  ├─ parse.js            # filename → title/year (scene-tag stripping)
│  ├─ omdb.js             # OMDb/IMDb lookups
│  └─ store.js            # JSON persistence under data/
├─ public/                # the UI — static PWA (deployed to Vercel)
│  ├─ index.html          # shell + splash + offline setup screen
│  ├─ app.js              # SPA logic + helper detection + install prompt
│  ├─ style.css
│  ├─ manifest.webmanifest
│  ├─ sw.js               # service worker (caches the app shell)
│  ├─ auth.js             # optional Google sign-in + settings sync (Firebase)
│  ├─ firebase-config.js  # your Firebase web config (null = sign-in disabled)
│  └─ icons/              # SVG app icons (standard + maskable)
├─ data/                  # config + library cache (git-ignored, helper-side)
├─ vercel.json            # pins a pure-static deploy of public/
├─ build.mjs              # esbuild bundle → pkg cross-compile (npm run build)
├─ start.bat              # Windows launcher for the helper
├─ start.sh              # macOS/Linux launcher
├─ start.command         # double-clickable macOS launcher
├─ dist/                  # built binaries + public/ (git-ignored)
└─ package.json
```

---

## 📝 Notes

- Filename parsing is heuristic — it handles most scene-release naming, but odd names may mis-parse. Re-enrichment (`?force=1`) and manual removal exist.
- Posters load directly from `m.media-amazon.com` (fine on a local page).
- OMDb is used because it returns IMDb rating + director + genre + poster in one call.

---

*A small personal/hobby project — runs locally, no warranty. Enjoy your movie wall. 🍿*
