// MKV Movie Library — local Express server.
// Scans configured disk roots for .mkv files, parses title/year, enriches via
// OMDb (IMDb data), caches to data/library.json, and serves a poster-grid UI.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scanRoots, listDrives } from './lib/scan.js';
import { parseEntry, seriesKeyOf } from './lib/parse.js';
import { fetchOmdb, fetchOmdbById, parseImdbId } from './lib/omdb.js';
import {
  loadConfig, saveConfig, publicConfig,
  loadLibrary, saveLibrary, idForPath, pathForId,
} from './lib/store.js';

// Real ESM in dev; undefined inside the packaged/bundled binary (which resolves
// its paths from process.execPath instead), so keep this non-fatal.
let __dirname;
try { __dirname = path.dirname(fileURLToPath(import.meta.url)); }
catch { __dirname = path.dirname(process.execPath); }
const PORT = Number(process.env.PORT) || 4700;
const IS_PACKAGED = !!(process.pkg || process.versions.pkg);

// Locate the static UI (`public/`). In dev it sits beside this file. As a
// packaged binary the snapshot is read-only, so we look for a `public/` folder
// on the real disk next to the executable. If none exists, the binary still
// runs perfectly as an API-only helper for a remotely-hosted (Vercel) UI.
function resolvePublicDir() {
  const candidates = IS_PACKAGED
    ? [path.join(path.dirname(process.execPath), 'public'), path.join(__dirname, 'public')]
    : [path.join(__dirname, 'public')];
  return candidates.find((d) => { try { return fs.existsSync(d); } catch { return false; } }) || null;
}
const PUBLIC_DIR = resolvePublicDir();

const app = express();

// ── CORS / Private Network Access ─────────────────────────────────────────
// This process is the *local helper*: it runs on the user's PC and does the
// disk work (scan, enrich, open/reveal) that a cloud server never could. The
// UI may be served from here (http://localhost:PORT) OR from a static host
// like Vercel (https://…vercel.app). In the latter case the page makes
// cross-origin requests to this helper, so we must:
//   1. echo an allowed CORS origin, and
//   2. answer the Chrome "Private Network Access" preflight, which a public
//      (https) page needs before it may call a private address (localhost).
// ALLOW_ORIGIN can pin a single origin; default reflects the caller (fine here
// because the helper only ever exposes the user's own machine to their own
// browser tab, and no cookies/credentials are involved).
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '';
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN || origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
if (PUBLIC_DIR) app.use(express.static(PUBLIC_DIR));

// Lightweight identity/health probe so a remotely-hosted UI can confirm this
// is actually the MovieLibrary helper (and reachable) before using it.
app.get('/api/health', (_req, res) => res.json({ app: 'movielibrary-helper', ok: true }));

// ── helpers ─────────────────────────────────────────────────────────────
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 10000\n\n');
  return (event, data = {}) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function movieList(lib) {
  return Object.values(lib.movies);
}

// Apply a parseEntry() result onto a library entry, registering the series
// record for episodes.
function applyParsed(entry, parsed, lib) {
  entry.kind = parsed.kind;
  if (parsed.kind === 'episode') {
    const key = seriesKeyOf(parsed.series);
    entry.series = parsed.series;
    entry.seriesKey = key;
    entry.season = parsed.season;
    entry.episode = parsed.episode;
    entry.year = parsed.year || null;
    delete entry.title;
    const rec = lib.series[key] || { key, title: parsed.series, year: parsed.year || null, enriched: false, imdb: null, error: null };
    if (parsed.series && parsed.series.length > (rec.title || '').length) rec.title = parsed.series;
    if (!rec.year && parsed.year) rec.year = parsed.year;
    lib.series[key] = rec;
  } else {
    entry.title = parsed.title;
    entry.year = parsed.year;
    delete entry.series; delete entry.seriesKey; delete entry.season; delete entry.episode;
  }
}

function classificationChanged(e, p) {
  if (e.kind !== p.kind) return true;
  if (p.kind === 'episode') {
    return e.seriesKey !== seriesKeyOf(p.series) || e.season !== p.season || e.episode !== p.episode;
  }
  return false;
}

// Build the grouped view the UI renders: standalone movies + series (with their
// IMDb record and episodes nested by season).
function groupedLibrary(lib) {
  const movies = [];
  const seriesMap = new Map(); // key -> { ...record, seasons: Map }

  for (const e of Object.values(lib.movies)) {
    if (e.kind === 'episode') {
      const key = e.seriesKey;
      if (!seriesMap.has(key)) {
        const rec = lib.series[key] || { key, title: e.series, year: e.year || null, enriched: false, imdb: null, error: null };
        seriesMap.set(key, { ...rec, seasons: new Map(), episodeCount: 0, addedAt: e.addedAt || 0 });
      }
      const s = seriesMap.get(key);
      const sn = e.season ?? 0;
      if (!s.seasons.has(sn)) s.seasons.set(sn, []);
      s.seasons.get(sn).push({
        id: e.id, path: e.path, fileName: e.fileName, size: e.size,
        episode: e.episode ?? null, season: sn,
      });
      s.episodeCount += 1;
      s.addedAt = Math.max(s.addedAt, e.addedAt || 0);
    } else {
      movies.push(e);
    }
  }

  const series = [...seriesMap.values()].map((s) => ({
    key: s.key,
    kind: 'series',
    title: (s.imdb && s.imdb.title) || s.title,
    year: (s.imdb && s.imdb.year) || s.year || '',
    imdb: s.imdb || null,
    enriched: !!s.enriched,
    error: s.error || null,
    episodeCount: s.episodeCount,
    addedAt: s.addedAt,
    seasons: [...s.seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, eps]) => ({
        season,
        episodes: eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
      })),
  }));

  return { movies, series };
}

// ── config ──────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ ...publicConfig(), drives: listDrives() });
});

app.post('/api/config', (req, res) => {
  const { scanRoots: roots, formats, omdbApiKey } = req.body || {};
  const patch = {};
  if (Array.isArray(roots)) patch.scanRoots = roots.map((r) => String(r).trim()).filter(Boolean);
  if (Array.isArray(formats) && formats.length) {
    patch.formats = formats.map((f) => {
      f = String(f).trim().toLowerCase();
      return f.startsWith('.') ? f : '.' + f;
    });
  }
  // Only overwrite the key when a value is supplied (empty string clears it).
  if (typeof omdbApiKey === 'string') patch.omdbApiKey = omdbApiKey.trim();
  saveConfig(patch);
  res.json({ ...publicConfig(), drives: listDrives() });
});

// ── library ─────────────────────────────────────────────────────────────
app.get('/api/library', (_req, res) => {
  res.json(groupedLibrary(loadLibrary()));
});

app.delete('/api/library', (_req, res) => {
  saveLibrary({ movies: {}, series: {} });
  res.json({ ok: true });
});

app.delete('/api/library/:id', (req, res) => {
  const lib = loadLibrary();
  delete lib.movies[req.params.id];
  saveLibrary(lib);
  res.json({ ok: true });
});

// ── scan (SSE) ──────────────────────────────────────────────────────────
app.get('/api/scan/stream', async (_req, res) => {
  const send = sse(res);
  const cfg = loadConfig();
  // No folders configured → scan the whole computer (every drive/volume).
  const roots = cfg.scanRoots.length ? cfg.scanRoots : listDrives();
  const wholeSystem = !cfg.scanRoots.length;
  if (!roots.length) {
    send('error', { message: 'No drives found to scan. Add a folder in Settings.' });
    return res.end();
  }
  if (wholeSystem) send('progress', { dir: 'Scanning entire computer…', found: 0 });

  let lastTick = 0;
  try {
    const files = await scanRoots(roots, cfg.formats, (dir, found) => {
      const now = Date.now();
      if (now - lastTick > 120) {
        lastTick = now;
        send('progress', { dir, found });
      }
    });

    const lib = loadLibrary();
    let added = 0;
    let reclassified = 0;
    for (const f of files) {
      const id = idForPath(f.path);
      const parsed = parseEntry(f.path);
      const existing = lib.movies[id];
      if (existing) {
        existing.size = f.size;
        existing.mtime = f.mtime;
        existing.missing = false;
        // Re-classify entries scanned under older logic (e.g. a movie that is
        // really a TV episode) so a re-scan fixes them without a full wipe.
        if (classificationChanged(existing, parsed)) {
          applyParsed(existing, parsed, lib);
          existing.enriched = false;
          existing.imdb = null;
          existing.error = null;
          reclassified += 1;
        }
        continue;
      }
      const entry = {
        id, path: f.path, fileName: f.fileName, size: f.size, mtime: f.mtime,
        enriched: false, imdb: null, error: null, missing: false, addedAt: Date.now(),
      };
      applyParsed(entry, parsed, lib);
      lib.movies[id] = entry;
      added += 1;
    }
    saveLibrary(lib);
    const g = groupedLibrary(lib);
    send('done', { added, reclassified, scanned: files.length, movies: g.movies.length, series: g.series.length });
  } catch (err) {
    send('error', { message: err.message || 'Scan failed' });
  }
  res.end();
});

// ── enrich (SSE) ──────────────────────────────────────────────────────────
app.get('/api/enrich/stream', async (req, res) => {
  const send = sse(res);
  const cfg = loadConfig();
  if (!cfg.omdbApiKey) {
    send('error', { message: 'No OMDb API key set. Add one in Settings (free at omdbapi.com).' });
    return res.end();
  }

  const force = req.query.force === '1';
  const lib = loadLibrary();

  // Build a unified task list: standalone movies + each series (one lookup per
  // show, not per episode).
  const tasks = [];
  for (const m of movieList(lib)) {
    if (m.kind !== 'episode' && (force || !m.enriched)) tasks.push({ type: 'movie', ref: m });
  }
  for (const s of Object.values(lib.series)) {
    if (force || !s.enriched) tasks.push({ type: 'series', ref: s });
  }
  send('start', { count: tasks.length });

  let done = 0;
  let ok = 0;
  let aborted = false;
  req.on('close', () => { aborted = true; });

  for (const t of tasks) {
    if (aborted) break;
    const ref = t.ref;
    try {
      // For series, ignore the parsed year — episode filenames often carry an
      // air year that mismatches the show (title-only is far more reliable).
      const r = t.type === 'series'
        ? await fetchOmdb(cfg.omdbApiKey, ref.title, null, 'series')
        : await fetchOmdb(cfg.omdbApiKey, ref.title, ref.year, 'movie');
      if (r.found) {
        ref.imdb = r.info;
        ref.enriched = true;
        ref.error = null;
        ok += 1;
      } else {
        ref.enriched = true;
        ref.error = r.error || 'Not found';
      }
    } catch (err) {
      ref.error = err.message || 'Lookup failed';
      if (/HTTP 401|Invalid API key/i.test(ref.error)) {
        saveLibrary(lib);
        send('error', { message: 'OMDb rejected the API key (401). Check it in Settings.' });
        return res.end();
      }
    }
    done += 1;
    if (done % 5 === 0) saveLibrary(lib); // periodic checkpoint
    send('progress', {
      done, total: tasks.length, type: t.type,
      title: (ref.imdb && ref.imdb.title) || ref.title,
    });
    await delay(120); // be gentle on the free tier
  }

  saveLibrary(lib);
  send('done', { ok, done, total: tasks.length });
  res.end();
});

// ── manual re-match to a specific IMDb id/URL ─────────────────────────────
app.post('/api/rematch', async (req, res) => {
  const { kind, id, key, imdb } = req.body || {};
  const cfg = loadConfig();
  if (!cfg.omdbApiKey) return res.status(400).json({ error: 'No OMDb API key set.' });
  const imdbId = parseImdbId(imdb);
  if (!imdbId) return res.status(400).json({ error: 'Enter a valid IMDb id or URL, e.g. tt0306414.' });

  let r;
  try { r = await fetchOmdbById(cfg.omdbApiKey, imdbId); }
  catch (err) { return res.status(502).json({ error: err.message }); }
  if (!r.found) return res.status(404).json({ error: r.error || 'Not found on IMDb' });

  const lib = loadLibrary();
  if (kind === 'series') {
    const rec = lib.series[key];
    if (!rec) return res.status(404).json({ error: 'Series not found' });
    rec.imdb = r.info; rec.enriched = true; rec.error = null;
  } else {
    const m = lib.movies[id];
    if (!m) return res.status(404).json({ error: 'Movie not found' });
    m.imdb = r.info; m.enriched = true; m.error = null;
  }
  saveLibrary(lib);
  res.json({ ok: true, info: r.info });
});

// ── open / reveal (cross-platform) ────────────────────────────────────────
// Launch a file in the OS default app, or reveal it in the file manager, and
// bring that app to the foreground (a background helper otherwise just flashes
// the taskbar on Windows). macOS `open` and `open -R` already activate the
// target; Linux depends on the window manager.
function launch(p, { reveal }) {
  const plat = process.platform;

  if (plat === 'win32') {
    if (reveal) return spawn('explorer.exe', ['/select,' + p], { detached: true, stdio: 'ignore' });
    // Open in the default player, then focus it. Windows blocks a background
    // process from stealing focus, so we launch via PowerShell and use
    // AppActivate (best-effort) to raise the new window.
    const psPath = "'" + p.replace(/'/g, "''") + "'";
    const cmd =
      "$ErrorActionPreference='SilentlyContinue';" +
      `$pr = Start-Process -FilePath ${psPath} -PassThru;` +
      'Start-Sleep -Milliseconds 500;' +
      'if ($pr -and -not $pr.HasExited) { (New-Object -ComObject WScript.Shell).AppActivate($pr.Id) | Out-Null }';
    return spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore' });
  }

  if (plat === 'darwin') {
    return spawn('open', reveal ? ['-R', p] : [p], { detached: true, stdio: 'ignore' });
  }

  // linux / other — no universal "select in manager", so reveal opens the dir.
  return spawn('xdg-open', [reveal ? path.dirname(p) : p], { detached: true, stdio: 'ignore' });
}

function openHandler(reveal) {
  return (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    try {
      launch(p, { reveal }).unref();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

app.post('/api/open', openHandler(false));
app.post('/api/reveal', openHandler(true));

// Clean JSON errors (e.g. malformed request body) instead of HTML stack traces.
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// Best-effort "open my default browser at this URL", cross-platform.
function openBrowser(url) {
  try {
    const plat = process.platform;
    if (plat === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (plat === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ignore — just print the URL */ }
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  🎬  MKV Movie Library helper running at ${url}`);
  if (PUBLIC_DIR) {
    console.log('      • Local app is served here — open the URL above, or');
    console.log('      • open your hosted (Vercel) UI; it will connect to this helper.\n');
    // Auto-open the local UI (skip with MOVIELIB_NO_OPEN=1).
    if (!process.env.MOVIELIB_NO_OPEN) openBrowser(url);
  } else {
    console.log('      • API-only helper (no local UI folder found).');
    console.log('      • Open your hosted (Vercel) UI; it will connect to this helper.\n');
  }
});
