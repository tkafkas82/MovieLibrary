// OMDb lookup (https://www.omdbapi.com/). OMDb mirrors IMDb data and returns
// exactly the fields we want: Poster, Genre, Director, Year, imdbRating.
// Strategy: exact title+year -> title only -> search then fetch by imdbID.

const BASE = 'https://www.omdbapi.com/';

// A rotating pool of OMDb keys. `query` advances past a key that is over its
// daily quota ("Request limit reached!") or invalid (HTTP 401 / "Invalid API
// key!"), so a long enrichment run transparently fails over to the next key.
export function createKeyPool(keys) {
  const list = (Array.isArray(keys) ? keys : [keys])
    .map((k) => String(k || '').trim()).filter(Boolean);
  return { keys: list, idx: 0 };
}

const isLimit = (d) => d && d.Response === 'False' && /limit reached/i.test(d.Error || '');
const isBadKey = (d) => d && d.Response === 'False' && /invalid api key/i.test(d.Error || '');

async function query(pool, params) {
  if (!pool || !pool.keys.length) throw new Error('No OMDb API key configured');
  while (pool.idx < pool.keys.length) {
    const url = BASE + '?' + new URLSearchParams({ apikey: pool.keys[pool.idx], ...params });
    const res = await fetch(url);
    if (res.status === 401) { pool.idx += 1; continue; } // invalid key → next
    if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
    const data = await res.json();
    if (isLimit(data) || isBadKey(data)) { pool.idx += 1; continue; } // exhausted/invalid → next
    return data;
  }
  const e = new Error('All OMDb keys are invalid or over their daily limit.');
  e.exhausted = true;
  throw e;
}

// type: 'movie' | 'series'. `pool` comes from createKeyPool().
export async function fetchOmdb(pool, title, year, type = 'movie') {
  let data = await query(pool, year
    ? { t: title, y: String(year), type }
    : { t: title, type });

  if (data.Response === 'False' && year) {
    data = await query(pool, { t: title, type });
  }

  if (data.Response === 'False') {
    const s = await query(pool, { s: title, type });
    if (s.Response === 'True' && Array.isArray(s.Search) && s.Search.length) {
      // Prefer a search hit matching the parsed year, else the first result.
      const pick = (year && s.Search.find((r) => r.Year === String(year))) || s.Search[0];
      data = await query(pool, { i: pick.imdbID });
    }
  }

  if (!data || data.Response === 'False') {
    return { found: false, error: (data && data.Error) || 'Not found' };
  }
  return { found: true, info: normalize(data) };
}

// Fetch a specific title by its IMDb id (used by manual "Fix match").
export async function fetchOmdbById(pool, imdbID) {
  const data = await query(pool, { i: imdbID });
  if (!data || data.Response === 'False') {
    return { found: false, error: (data && data.Error) || 'Not found' };
  }
  return { found: true, info: normalize(data) };
}

// Pull an "tt0000000" id out of a raw id or an IMDb URL.
export function parseImdbId(s) {
  const m = String(s || '').match(/tt\d{6,}/i);
  return m ? m[0].toLowerCase() : null;
}

const clean = (v) => (v && v !== 'N/A' ? v : '');

function normalize(d) {
  return {
    imdbID: d.imdbID || '',
    title: clean(d.Title),
    year: clean(d.Year),
    genre: clean(d.Genre),
    director: clean(d.Director),
    actors: clean(d.Actors),
    rating: clean(d.imdbRating),
    votes: clean(d.imdbVotes),
    poster: clean(d.Poster),
    plot: clean(d.Plot),
    runtime: clean(d.Runtime),
    rated: clean(d.Rated),
    imdbUrl: d.imdbID ? `https://www.imdb.com/title/${d.imdbID}/` : '',
  };
}
