// Tiny JSON-file persistence for config + the movie library.
// Everything lives under ./data so the app is fully self-contained and local.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Override with MOVIELIB_DATA_DIR so throwaway/test runs never touch real data.
const DATA_DIR = process.env.MOVIELIB_DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

const DEFAULT_CONFIG = {
  scanRoots: [],
  formats: ['.mkv'],
  omdbApiKey: '',
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file); // atomic-ish replace
}

// ── config ────────────────────────────────────────────────────────────────
export function loadConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  // never store an empty key over an existing one unless explicitly cleared
  writeJson(CONFIG_FILE, next);
  return next;
}

// Public view of config that never leaks the API key.
export function publicConfig() {
  const c = loadConfig();
  return {
    scanRoots: c.scanRoots,
    formats: c.formats,
    hasApiKey: !!c.omdbApiKey,
  };
}

// ── library ───────────────────────────────────────────────────────────────
// Shape: { movies: { [id]: entry }, series: { [seriesKey]: seriesRecord } }.
// `movies` holds one entry per file (kind: 'movie' | 'episode'), keyed by a
// stable id derived from the path. `series` holds one IMDb record per show.
export function loadLibrary() {
  const lib = readJson(LIBRARY_FILE, { movies: {}, series: {} });
  if (!lib.movies) lib.movies = {};
  if (!lib.series) lib.series = {};
  return lib;
}

export function saveLibrary(lib) {
  writeJson(LIBRARY_FILE, lib);
}

export function idForPath(p) {
  return Buffer.from(p, 'utf8').toString('base64url');
}

export function pathForId(id) {
  return Buffer.from(id, 'base64url').toString('utf8');
}
