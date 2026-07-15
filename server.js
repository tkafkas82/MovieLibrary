// MKV Movie Library — local Express server.
// Scans configured disk roots for .mkv files, parses title/year, enriches via
// OMDb (IMDb data), caches to data/library.json, and serves a poster-grid UI.

import express from 'express';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4700;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  if (!cfg.scanRoots.length) {
    send('error', { message: 'No scan folders configured. Add folders in Settings.' });
    return res.end();
  }

  let lastTick = 0;
  try {
    const files = await scanRoots(cfg.scanRoots, cfg.formats, (dir, found) => {
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

// ── open / reveal in Explorer ─────────────────────────────────────────────
app.post('/api/open', (req, res) => {
  const { path: p } = req.body || {};
  if (!p) return res.status(400).json({ error: 'path required' });
  try {
    spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reveal', (req, res) => {
  const { path: p } = req.body || {};
  if (!p) return res.status(400).json({ error: 'path required' });
  try {
    // explorer often exits with code 1 even on success — fire and forget.
    spawn('explorer.exe', ['/select,' + p], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clean JSON errors (e.g. malformed request body) instead of HTML stack traces.
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`\n  🎬  MKV Movie Library running at http://localhost:${PORT}\n`);
});
