// OMDb lookup (https://www.omdbapi.com/). OMDb mirrors IMDb data and returns
// exactly the fields we want: Poster, Genre, Director, Year, imdbRating.
// Strategy: exact title+year -> title only -> search then fetch by imdbID.

const BASE = 'https://www.omdbapi.com/';

async function query(apiKey, params) {
  const url = BASE + '?' + new URLSearchParams({ apikey: apiKey, ...params });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
  return res.json();
}

// type: 'movie' | 'series'
export async function fetchOmdb(apiKey, title, year, type = 'movie') {
  if (!apiKey) throw new Error('No OMDb API key configured');

  let data = await query(apiKey, year
    ? { t: title, y: String(year), type }
    : { t: title, type });

  if (data.Response === 'False' && year) {
    data = await query(apiKey, { t: title, type });
  }

  if (data.Response === 'False') {
    const s = await query(apiKey, { s: title, type });
    if (s.Response === 'True' && Array.isArray(s.Search) && s.Search.length) {
      // Prefer a search hit matching the parsed year, else the first result.
      const pick = (year && s.Search.find((r) => r.Year === String(year))) || s.Search[0];
      data = await query(apiKey, { i: pick.imdbID });
    }
  }

  if (!data || data.Response === 'False') {
    return { found: false, error: (data && data.Error) || 'Not found' };
  }
  return { found: true, info: normalize(data) };
}

// Fetch a specific title by its IMDb id (used by manual "Fix match").
export async function fetchOmdbById(apiKey, imdbID) {
  if (!apiKey) throw new Error('No OMDb API key configured');
  const data = await query(apiKey, { i: imdbID });
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
