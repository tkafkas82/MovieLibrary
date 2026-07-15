// Turn a scene/release filename (and its folder path) into a best-guess entry:
//  - a movie:   { kind:'movie',   title, year }
//  - an episode:{ kind:'episode', series, season, episode, year }
// TV episodes are detected from SxxExx / NxNN markers in the filename, or from a
// "Season NN" / "SNN" parent folder.

import path from 'node:path';

// Tokens that mark the end of the real title (quality/source/codec/audio/group tags).
const STOP = /^(1080p|720p|480p|2160p|4k|uhd|hd|sd|bluray|blu-ray|bdrip|brrip|bdremux|remux|web-?dl|web-?rip|webrip|hdrip|hdtv|dvdrip|dvdscr|cam|ts|hdcam|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|eac3|dts|dts-hd|ddp?5|ddp?7|5\.1|7\.1|truehd|atmos|hdr|hdr10|dovi|dv|imax|proper|repack|extended|unrated|remastered|director|directors|cut|theatrical|limited|internal|complete|multi|dual|dubbed|subbed|hardsub|ita|eng|esp|fra|ger|rus|hindi|yify|yts|rarbg|evo|fgt|sparks|amiable|ntb|tigole|qxr|psa)$/i;

const YEAR_RE = /^(19|20)\d{2}$/;
// A whole folder name that denotes a season: "Season 1", "Season_01", "S01", "s1".
const SEASON_DIR = /^(?:season[ ._-]*|s)(\d{1,2})$/i;
const DRIVE_DIR = /^[a-z]:$/i;

const stripExt = (n) => n.replace(/\.[^.]+$/, '');

function extractYear(s) {
  const m = s.replace(/[._]+/g, ' ').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

// Clean a raw title fragment: separators -> spaces, cut at first year/quality tag.
function cleanTitle(raw) {
  const cleaned = String(raw || '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const toks = cleaned.split(' ');
  let cut = toks.length;
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i].replace(/[()[\]]/g, '');
    if (YEAR_RE.test(t) || STOP.test(t)) { cut = i; break; }
  }
  return toks.slice(0, cut).join(' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect an episode marker in a filename base. Returns {index, season, episode}.
function matchEpisode(s) {
  let m = s.match(/\bS(\d{1,2})[ ._-]?E(\d{1,3})\b/i);        // S01E02, S1E2, S01.E02
  if (m) return { index: m.index, season: +m[1], episode: +m[2] };
  m = s.match(/\b(\d{1,2})x(\d{2,3})\b/);                     // 1x02
  if (m) return { index: m.index, season: +m[1], episode: +m[2] };
  m = s.match(/\bSeason[ ._-]*(\d{1,2})[ ._-]*Episode[ ._-]*(\d{1,3})\b/i);
  if (m) return { index: m.index, season: +m[1], episode: +m[2] };
  return null;
}

function bestSeriesFromDirs(dirs) {
  for (let i = dirs.length - 1; i >= 0; i--) {
    const d = dirs[i];
    if (DRIVE_DIR.test(d) || SEASON_DIR.test(d)) continue;
    const t = cleanTitle(d);
    if (t && t.length >= 2) return t;
  }
  return '';
}

// Movie title/year (also used as the fallback for non-episode files).
export function parseMovie(fileName) {
  const base = stripExt(fileName);
  const cleaned = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ');

  // Use the LAST plausible year with title tokens before it (handles year-titled
  // films like "Blade Runner 2049 (2017)" -> title "Blade Runner 2049", year 2017).
  let yearIdx = -1;
  let year = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[()[\]]/g, '');
    if (YEAR_RE.test(t)) {
      const y = Number(t);
      if (y >= 1900 && y <= 2099 && i > 0) { yearIdx = i; year = y; }
    }
  }

  let titleTokens;
  if (yearIdx > 0) {
    titleTokens = tokens.slice(0, yearIdx);
  } else {
    let stopIdx = -1;
    for (let i = 1; i < tokens.length; i++) {
      if (STOP.test(tokens[i].replace(/[()[\]]/g, ''))) { stopIdx = i; break; }
    }
    titleTokens = stopIdx > 0 ? tokens.slice(0, stopIdx) : tokens;
  }

  let title = titleTokens.join(' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) title = cleaned;
  return { title, year };
}

// Classify a full file path as a movie or a TV episode.
export function parseEntry(filePath) {
  const fileName = path.basename(filePath);
  const base = stripExt(fileName);
  const dirs = path.dirname(filePath).split(/[\\/]+/).filter(Boolean);

  // 1) Episode marker in the filename itself.
  const ep = matchEpisode(base);
  if (ep) {
    let series = cleanTitle(base.slice(0, ep.index));
    if (!series || series.length < 2) series = bestSeriesFromDirs(dirs);
    return { kind: 'episode', series: series || 'Unknown Series', season: ep.season, episode: ep.episode, year: extractYear(base) };
  }

  // 2) A "Season NN" / "SNN" parent folder marks these as episodes.
  for (let i = dirs.length - 1; i >= 0; i--) {
    const sm = dirs[i].match(SEASON_DIR);
    if (sm) {
      const season = Number(sm[1]);
      const series = cleanTitle(dirs[i - 1] || '') || bestSeriesFromDirs(dirs.slice(0, i)) || cleanTitle(base) || dirs[i];
      const em = base.match(/\b(?:e|ep|episode)[ ._-]*(\d{1,3})\b/i) || base.match(/^\s*(\d{1,3})\b/);
      const episode = em ? Number(em[1]) : null;
      return { kind: 'episode', series: series || 'Unknown Series', season, episode, year: extractYear(base) };
    }
  }

  // 3) Movie.
  const m = parseMovie(fileName);
  return { kind: 'movie', title: m.title, year: m.year };
}

// Stable key for grouping episodes into a series.
export function seriesKeyOf(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
