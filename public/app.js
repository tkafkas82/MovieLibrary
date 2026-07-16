// Movie Library — frontend logic (vanilla JS). Handles standalone movies
// and TV series (episodes grouped by season).

const state = {
  movies: [],   // kind: 'movie'
  series: [],   // kind: 'series' (with .seasons[].episodes[])
  config: { scanRoots: [], formats: ['.mkv'], hasApiKey: false, drives: [] },
  filters: { q: '', genre: '', sort: 'rating', onlyUnmatched: false },
  stream: null,
  connected: false,
  helperVersion: null,
};

const $ = (id) => document.getElementById(id);

// ── helper connection ─────────────────────────────────────────────────────
// The disk work lives in a small local "helper" (server.js) on the user's PC.
// When this page is served BY that helper (localhost), calls are same-origin.
// When served from a static host (Vercel/https), calls go cross-origin to the
// helper's localhost address, which the user can override (e.g. a custom port).
const DEFAULT_HELPER = 'http://localhost:4700';
const SERVED_LOCALLY = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function helperBase() {
  if (SERVED_LOCALLY) return ''; // same-origin — the helper is serving this page
  return (localStorage.getItem('helperUrl') || DEFAULT_HELPER).replace(/\/+$/, '');
}
// Prefix an /api/… path with the helper base.
const H = (p) => helperBase() + p;

const api = async (path, opts) => {
  const res = await fetch(H(path), opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};

// Fetch the helper's health/identity (and version). Returns the object if it's
// really our helper, else null.
async function getHealth() {
  try {
    const r = await fetch(H('/api/health'), { cache: 'no-store' });
    const j = await r.json();
    return (j && j.app === 'movielibrary-helper') ? j : null;
  } catch { return null; }
}

// ── init ────────────────────────────────────────────────────────────────
async function init() {
  wireEvents();
  registerServiceWorker();
  initSync();
  await connect();
  hideSplash();
}

// ── cloud sync (optional Google login, via window.MovieSync/auth.js) ───────
let pendingCloudApply = null;

function initSync() {
  const S = window.MovieSync;
  if (!S || !S.enabled) return; // sign-in not configured — leave UI hidden
  const area = $('authArea');
  if (area) area.hidden = false;
  // Show the sign-in button right away — don't wait for the Firebase SDK to
  // finish loading over the network. onState re-renders once auth resolves.
  renderAuth({ signedIn: false });
  S.onState((st) => {
    renderAuth(st);
    if (st.signedIn) maybeApplyCloud(st.config);
  });
}

function renderAuth(st) {
  const el = $('authArea');
  if (!el) return;
  if (st.signedIn) {
    el.innerHTML = `<span class="acct" title="Signed in — settings sync to your account">☁ ${esc(st.email || 'account')}</span>
      <button class="btn ghost tiny" id="signOutBtn">Sign out</button>`;
    $('signOutBtn').onclick = () => window.MovieSync.signOut();
  } else {
    el.innerHTML = `<button class="btn ghost tiny" id="signInBtn" title="Sync your folders & OMDb key across devices">Sign in with Google</button>`;
    $('signInBtn').onclick = () => window.MovieSync.signIn();
  }
}

// After sign-in: push the account's saved settings down to the local helper.
async function maybeApplyCloud(cloud) {
  if (!cloud) {
    // First sign-in with no saved settings yet — seed the account from what's
    // configured here (keys included, so they persist from now on).
    window.MovieSync.save({
      scanRoots: state.config.scanRoots,
      formats: state.config.formats,
      omdbApiKeys: state.config.omdbApiKeys || [],
    });
    return;
  }
  if (!state.connected) { pendingCloudApply = cloud; return; } // apply once helper is up
  await applyCloudToHelper(cloud);
}

async function applyCloudToHelper(cloud) {
  const body = {};
  if (Array.isArray(cloud.scanRoots)) body.scanRoots = cloud.scanRoots;
  if (Array.isArray(cloud.formats)) body.formats = cloud.formats;
  // New: array of keys. Legacy cloud docs used a single omdbApiKey string.
  if (Array.isArray(cloud.omdbApiKeys)) body.omdbApiKeys = cloud.omdbApiKeys;
  else if (typeof cloud.omdbApiKey === 'string' && cloud.omdbApiKey) body.omdbApiKeys = [cloud.omdbApiKey];
  if (!Object.keys(body).length) return;
  try {
    state.config = await api('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    render();
    toast('Synced settings from your Google account.');
  } catch (err) { /* helper went away — will re-sync on next connect */ }
}

function hideSplash() {
  const s = $('splash');
  if (!s) return;
  s.classList.add('gone');
  setTimeout(() => { s.hidden = true; }, 600);
}

// Establish (or re-establish) the link to the local helper, then load data.
// Shows a friendly offline screen when the helper isn't reachable.
async function connect() {
  const health = await getHealth();
  const ok = SERVED_LOCALLY || !!health;
  state.connected = ok;
  state.helperVersion = (health && health.version) || null;
  setHelperStatus(ok);
  if (!ok) { showHelperOffline(true); return; }
  showHelperOffline(false);
  try {
    await loadConfig();
    await loadLibrary();
    // A sign-in that happened before the helper was up left settings waiting.
    if (pendingCloudApply) { const c = pendingCloudApply; pendingCloudApply = null; await applyCloudToHelper(c); }
    checkForUpdate();
  } catch {
    state.connected = false;
    setHelperStatus(false);
    showHelperOffline(true);
  }
}

// Compare the connected helper's version against the latest GitHub release and,
// if it's behind, surface an "update" chip + a one-time toast.
function cmpSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

async function checkForUpdate() {
  const chip = $('updateChip');
  if (!chip) return;
  // Re-read the connected helper's version — it may have just been updated.
  const health = await getHealth();
  if (health && health.version) state.helperVersion = health.version;
  const cur = state.helperVersion;
  if (!cur || cur === 'dev') { chip.hidden = true; return; } // unknown/older helper or dev
  const tag = await fetchLatestTag();
  if (!tag) return; // offline / rate-limited — leave the chip as-is
  if (cmpSemver(tag.replace(/^v/, ''), cur) <= 0) { chip.hidden = true; return; } // up to date → hide

  const wasHidden = chip.hidden;
  chip.hidden = false;
  chip.textContent = `⬆ Update helper → ${tag}`;
  // Behave like the download button: fetch the right launcher/binary for this
  // OS (not a GitHub page). Same-origin .bat downloads via the `download` attr;
  // GitHub assets are served as attachments so they download too.
  chip.href = osDownloadHref(tag);
  chip.setAttribute('download', '');
  chip.title = `Download the updated helper for your system (you're on v${cur}). Run it, then restart the helper.`;
  if (wasHidden) toast(`A newer helper is available (${tag}). Click "Update helper" to download it.`);
}

// The download target for the current OS — mirrors the setup screen's button:
// Windows → the .bat launcher; macOS → the launcher zip; Linux → the binary.
function osDownloadHref(tag) {
  const os = detectOS();
  if (os === 'win') return '/movielibrary-helper.bat';
  if (os === 'macArm' || os === 'macIntel') return dlUrl(tag, 'movielibrary-helper-mac.zip');
  return dlUrl(tag, HELPER_ASSETS.linux.file);
}

async function loadConfig() { state.config = await api('/api/config'); }

async function loadLibrary() {
  const data = await api('/api/library');
  state.movies = data.movies || [];
  state.series = data.series || [];
  render();
}

const allItems = () => [...state.movies, ...state.series];

// ── rendering ─────────────────────────────────────────────────────────────
function render() {
  renderStats();
  renderGenreOptions();
  const list = filtered();
  const grid = $('grid');
  const empty = $('empty');

  if (!allItems().length) {
    grid.innerHTML = ''; empty.hidden = false;
    empty.innerHTML = state.config.scanRoots.length
      ? `No movies yet. Click <b>Scan disks</b> to index your <b>${state.config.formats.join(', ')}</b> files.`
      : `Welcome! Click <b>Scan disks</b> to search your whole computer, or open <b>⚙ Settings</b> first to point it at specific folders (faster).`;
    return;
  }
  if (!list.length) { grid.innerHTML = ''; empty.hidden = false; empty.textContent = 'Nothing matches the current filters.'; return; }

  empty.hidden = true;
  grid.innerHTML = list.map(card).join('');
}

function renderStats() {
  const m = state.movies.length;
  const s = state.series.length;
  const matched = state.movies.filter((x) => x.imdb).length + state.series.filter((x) => x.imdb).length;
  const bits = [];
  if (m) bits.push(`${m} movie${m === 1 ? '' : 's'}`);
  if (s) bits.push(`${s} series`);
  const total = m + s;
  $('stats').textContent = total ? `${bits.join(' · ')} · ${matched} matched to IMDb` : '';
}

function renderGenreOptions() {
  const set = new Set();
  for (const it of allItems()) (it.imdb?.genre || '').split(',').forEach((g) => { g = g.trim(); if (g) set.add(g); });
  const cur = state.filters.genre;
  $('genre').innerHTML = '<option value="">All genres</option>' +
    [...set].sort().map((g) => `<option value="${esc(g)}"${g === cur ? ' selected' : ''}>${esc(g)}</option>`).join('');
}

function filtered() {
  const { q, genre, sort, onlyUnmatched } = state.filters;
  const ql = q.toLowerCase();
  const list = allItems().filter((it) => {
    if (onlyUnmatched && it.imdb) return false;
    if (genre && !(it.imdb?.genre || '').toLowerCase().includes(genre.toLowerCase())) return false;
    if (ql) {
      const hay = `${it.title || ''} ${it.imdb?.title || ''} ${it.imdb?.director || ''} ${it.fileName || ''} ${it.series || ''}`.toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });

  const yr = (it) => parseInt(it.imdb?.year || it.year || 0, 10) || 0;
  const rt = (it) => parseFloat(it.imdb?.rating) || 0;
  const ttl = (it) => (it.imdb?.title || it.title || '').toLowerCase();
  const cmp = {
    rating: (a, b) => rt(b) - rt(a) || yr(b) - yr(a),
    year: (a, b) => yr(b) - yr(a),
    yearAsc: (a, b) => yr(a) - yr(b),
    title: (a, b) => ttl(a).localeCompare(ttl(b)),
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  }[sort] || (() => 0);
  return list.sort(cmp);
}

function posterHtml(im, title) {
  return im?.poster
    ? `<img loading="lazy" src="${esc(im.poster)}" alt="" onerror="this.parentNode.classList.add('failed')">`
    : '';
}
function noimg(title) { return `<div class="noimg"><div class="big">🎬</div><div>${esc(title)}</div></div>`; }

function ratingBadge(im) { return im?.rating ? `<div class="rating">★ ${esc(im.rating)}</div>` : ''; }
function genreChips(im) {
  return (im?.genre || '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 3)
    .map((g) => `<span class="genre-chip">${esc(g)}</span>`).join('');
}

function card(it) {
  return it.kind === 'series' ? seriesCard(it) : movieCard(it);
}

function movieCard(m) {
  const im = m.imdb;
  const title = im?.title || m.title || m.fileName;
  const year = im?.year || m.year || '';
  const runtime = im?.runtime ? ` · ${esc(im.runtime)}` : '';
  const director = im?.director ? `<div class="card-sub">🎬 ${esc(im.director)}</div>` : '';
  const unmatched = !im ? `<div class="badge-un">${m.error ? 'not found' : 'not matched'}</div>` : '';
  const imdbLink = im?.imdbUrl ? `<a class="iconbtn" href="${esc(im.imdbUrl)}" target="_blank" rel="noreferrer">IMDb</a>` : '';
  return `<div class="card" data-id="${m.id}" data-kind="movie">
    <div class="poster">${posterHtml(im)}${noimg(title)}${ratingBadge(im)}${unmatched}</div>
    <div class="card-body">
      <div class="card-title">${esc(title)}</div>
      <div class="card-sub">${esc(String(year))}${runtime}</div>
      ${director}
      <div class="genres">${genreChips(im)}</div>
      <div class="card-path" title="${esc(m.path)}">${esc(m.path)}</div>
      <div class="actions">
        <button class="iconbtn" data-act="play" title="Open with default player">▶ Play</button>
        <button class="iconbtn" data-act="reveal" title="Show in Explorer">📁</button>
        ${imdbLink}
        <button class="iconbtn" data-act="rematch" title="Fix IMDb match">🔗</button>
        <button class="iconbtn x" data-act="remove" title="Remove from library">✕</button>
      </div>
    </div>
  </div>`;
}

function seriesCard(s) {
  const im = s.imdb;
  const title = im?.title || s.title;
  const year = im?.year || s.year || '';
  const seasons = s.seasons.length;
  const unmatched = !im ? `<div class="badge-un">${s.error ? 'not found' : 'not matched'}</div>` : '';
  const director = im?.director ? `<div class="card-sub">🎬 ${esc(im.director)}</div>` : '';
  return `<div class="card series" data-key="${esc(s.key)}" data-kind="series">
    <div class="poster">${posterHtml(im)}${noimg(title)}${ratingBadge(im)}
      <div class="tv-badge">📺 SERIES</div>${unmatched}</div>
    <div class="card-body">
      <div class="card-title">${esc(title)}</div>
      <div class="card-sub">${esc(String(year))} · ${seasons} season${seasons === 1 ? '' : 's'} · ${s.episodeCount} ep${s.episodeCount === 1 ? '' : 's'}</div>
      ${director}
      <div class="genres">${genreChips(im)}</div>
      <div class="actions">
        <button class="iconbtn" data-act="open-series" title="View seasons & episodes">View episodes</button>
        ${im?.imdbUrl ? `<a class="iconbtn" href="${esc(im.imdbUrl)}" target="_blank" rel="noreferrer">IMDb</a>` : ''}
      </div>
    </div>
  </div>`;
}

// ── series modal ────────────────────────────────────────────────────────────
function openSeriesModal(s) {
  const im = s.imdb;
  const title = im?.title || s.title;
  const year = im?.year || s.year || '';
  const meta = [year, im?.runtime, im?.rated].filter(Boolean).map(esc).join(' · ');
  const seasons = s.seasons.map((sea) => `
    <div class="season">
      <div class="season-head">${sea.season ? 'Season ' + sea.season : 'Episodes'} <span class="hint">(${sea.episodes.length})</span></div>
      ${sea.episodes.map((ep) => `
        <div class="episode" data-id="${ep.id}">
          <span class="ep-num">${ep.episode != null ? 'E' + String(ep.episode).padStart(2, '0') : '—'}</span>
          <span class="ep-name" title="${esc(ep.path)}">${esc(ep.fileName)}</span>
          <button class="iconbtn tiny" data-act="play" title="Play">▶</button>
          <button class="iconbtn tiny" data-act="reveal" title="Show in Explorer">📁</button>
        </div>`).join('')}
    </div>`).join('');

  $('seriesModalBody').innerHTML = `
    <div class="series-top">
      <div class="series-poster">${im?.poster ? `<img src="${esc(im.poster)}" alt="">` : noimg(title)}</div>
      <div class="series-info">
        <h2>${esc(title)} ${im?.rating ? `<span class="rating inline">★ ${esc(im.rating)}</span>` : ''}</h2>
        <div class="card-sub">${meta}</div>
        ${im?.genre ? `<div class="genres">${genreChips(im)}</div>` : ''}
        ${im?.director ? `<div class="card-sub">🎬 ${esc(im.director)}</div>` : ''}
        ${im?.actors ? `<div class="card-sub">${esc(im.actors)}</div>` : ''}
        ${im?.plot ? `<p class="plot">${esc(im.plot)}</p>` : ''}
        <div class="series-actions">
          ${im?.imdbUrl ? `<a class="btn ghost tiny" href="${esc(im.imdbUrl)}" target="_blank" rel="noreferrer">Open on IMDb</a>` : ''}
          <button class="btn ghost tiny" data-act="rematch-series" data-key="${esc(s.key)}">Fix match</button>
          <button class="btn ghost tiny" data-act="remove-series" data-key="${esc(s.key)}">Remove series</button>
          <div class="spacer"></div>
          <button class="btn tiny" data-act="close-series">Close</button>
        </div>
      </div>
    </div>
    <div class="seasons">${seasons}</div>`;
  $('seriesModal').hidden = false;
}
function closeSeriesModal() { $('seriesModal').hidden = true; }

// ── click handling ──────────────────────────────────────────────────────────
async function onGridClick(e) {
  const btn = e.target.closest('[data-act]');
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;

  if (cardEl.dataset.kind === 'series') {
    const s = state.series.find((x) => x.key === cardEl.dataset.key);
    if (!s) return;
    // Clicking the poster/title or the "View episodes" button opens the modal.
    if (!btn || btn.dataset.act === 'open-series') { openSeriesModal(s); }
    return;
  }

  if (!btn) return;
  const m = state.movies.find((x) => x.id === cardEl.dataset.id);
  if (!m) return;
  const act = btn.dataset.act;
  if (act === 'play') playFile(btn, m.path, m.imdb?.title || m.title || m.fileName);
  else if (act === 'reveal') post('/api/reveal', { path: m.path });
  else if (act === 'rematch') {
    const r = await rematch({ kind: 'movie', id: m.id });
    if (r) { m.imdb = r.info; m.enriched = true; m.error = null; render(); toast('Matched to ' + (r.info.title || 'IMDb') + '.'); }
  } else if (act === 'remove') {
    await api('/api/library/' + m.id, { method: 'DELETE' });
    state.movies = state.movies.filter((x) => x.id !== m.id);
    render();
  }
}

// Prompt for an IMDb id/URL and re-match the given movie/series to it.
async function rematch(body) {
  const val = prompt('Paste the correct IMDb URL or id\n(e.g. https://www.imdb.com/title/tt0306414/ or tt0306414):');
  if (!val) return null;
  try {
    return await api('/api/rematch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, imdb: val }),
    });
  } catch (err) { alert('Re-match failed: ' + err.message); return null; }
}

async function onSeriesModalClick(e) {
  if (e.target === $('seriesModal')) { closeSeriesModal(); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'close-series') { closeSeriesModal(); return; }

  if (act === 'rematch-series') {
    const s = state.series.find((x) => x.key === btn.dataset.key);
    if (!s) return;
    const r = await rematch({ kind: 'series', key: s.key });
    if (r) {
      await loadLibrary();
      const ns = state.series.find((x) => x.key === s.key);
      if (ns) openSeriesModal(ns);
      toast('Matched to ' + (r.info.title || 'IMDb') + '.');
    }
    return;
  }

  if (act === 'remove-series') {
    const s = state.series.find((x) => x.key === btn.dataset.key);
    if (!s || !confirm(`Remove "${s.imdb?.title || s.title}" and its ${s.episodeCount} episodes from the library? (Files are not touched.)`)) return;
    const ids = s.seasons.flatMap((sea) => sea.episodes.map((ep) => ep.id));
    await Promise.all(ids.map((id) => api('/api/library/' + id, { method: 'DELETE' }).catch(() => {})));
    closeSeriesModal();
    await loadLibrary();
    return;
  }

  const epEl = e.target.closest('.episode');
  if (!epEl) return;
  const id = epEl.dataset.id;
  let path = null;
  let fileName = null;
  for (const s of state.series) for (const sea of s.seasons) { const ep = sea.episodes.find((x) => x.id === id); if (ep) { path = ep.path; fileName = ep.fileName; } }
  if (!path) return;
  if (act === 'play') playFile(btn, path, fileName);
  else if (act === 'reveal') post('/api/reveal', { path });
}

const post = (url, body) => fetch(H(url), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).catch(() => {});

// Launch a file in the default player, showing a spinner on the clicked button
// until it opens. We can't observe the native player window from the browser,
// so we hold the "Opening…" state for a short minimum so it reads as launching,
// and report a clear error if the helper couldn't start it.
async function playFile(btn, path, title) {
  if (!btn) { post('/api/open', { path }); return; }
  if (btn.dataset.loading) return; // ignore repeat clicks while opening
  btn.dataset.loading = '1';
  const orig = btn.innerHTML;
  const tiny = btn.classList.contains('tiny');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = tiny ? '<span class="spin"></span>' : '<span class="spin"></span> Opening…';

  const started = Date.now();
  let ok = true;
  try {
    const res = await fetch(H('/api/open'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Could not open the file'); }
  } catch (err) {
    ok = false;
    toast('Could not open the file: ' + (err.message || err));
  }

  const MIN_MS = 1600;
  setTimeout(() => {
    btn.innerHTML = orig; btn.disabled = false; btn.classList.remove('loading'); delete btn.dataset.loading;
    if (ok) toast(`Opening${title ? ` “${title}”` : ''} in your player…`);
  }, Math.max(0, MIN_MS - (Date.now() - started)));
}

// ── scan / enrich (SSE) ────────────────────────────────────────────────────
function startStream(url, { onEvent, label }) {
  if (state.stream) state.stream.close();
  const es = new EventSource(H(url));
  state.stream = es;
  showProgress(true, label, true);
  es.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } onEvent(d, es); };
  es.onerror = () => { es.close(); state.stream = null; showProgress(false); };
}

function endStream(es) { es.close(); state.stream = null; showProgress(false); setBusy(false); }

function startScan() {
  if (!state.config.scanRoots.length) {
    const drives = (state.config.drives || []).join(', ') || 'all drives';
    if (!confirm(`No folders set in Settings, so this will scan your whole computer (${drives}).\n\nThat can take a while. Continue?\n\n(Tip: add specific folders in Settings for a faster, targeted scan.)`)) {
      openSettings();
      return;
    }
  }
  setBusy(true);
  startStream('/api/scan/stream', {
    label: 'Scanning…',
    onEvent: async (d, es) => {
      if (d.event === 'progress') setProgress(null, `Scanning… ${d.found} found — ${d.dir}`);
      else if (d.event === 'done') {
        endStream(es);
        await loadLibrary();
        const bits = [`${d.added} new`];
        if (d.removed) bits.push(`${d.removed} removed`);
        toast(`Scan complete — ${bits.join(' · ')} · ${d.movies} movies, ${d.series} series.`);
        // Fetch IMDb automatically for anything not yet enriched — no separate button.
        if (allItems().some((it) => !it.enriched)) startEnrich({ auto: true });
      } else if (d.event === 'error') { endStream(es); alert(d.message); }
    },
  });
}

function startEnrich(opts = {}) {
  if (!state.config.hasApiKey) { if (opts.auto) return; alert('Add your free OMDb API key in Settings first.'); openSettings(); return; }
  setBusy(true);
  startStream('/api/enrich/stream', {
    label: 'Fetching IMDb…',
    onEvent: async (d, es) => {
      if (d.event === 'start') setProgress(0, `Fetching IMDb data for ${d.count} titles…`);
      else if (d.event === 'progress') {
        const keyNote = d.keys > 1 ? ` [key ${d.key}/${d.keys}]` : '';
        setProgress(d.total ? d.done / d.total : null, `Fetching IMDb… ${d.done}/${d.total}${keyNote} — ${d.title || ''}`);
      }
      else if (d.event === 'done') {
        endStream(es);
        await loadLibrary();
        toast(`IMDb fetch complete — ${d.ok}/${d.total} matched.`);
      } else if (d.event === 'error') { endStream(es); await loadLibrary(); alert(d.message); }
    },
  });
}

// ── progress UI ─────────────────────────────────────────────────────────────
function showProgress(on, label, indeterminate) {
  $('progress').hidden = !on;
  const fill = $('progressFill');
  if (on) { fill.classList.toggle('indeterminate', !!indeterminate); if (indeterminate) fill.style.width = ''; $('progressText').textContent = label || ''; }
}
function setProgress(frac, text) {
  const fill = $('progressFill');
  if (frac == null) { fill.classList.add('indeterminate'); fill.style.width = ''; }
  else { fill.classList.remove('indeterminate'); fill.style.width = Math.round(frac * 100) + '%'; }
  if (text != null) $('progressText').textContent = text;
}
function setBusy(b) { $('scanBtn').disabled = b; }

// ── settings ──────────────────────────────────────────────────────────────
function openSettings() {
  $('scanRoots').value = state.config.scanRoots.join('\n');
  $('formats').value = state.config.formats.join(', ');
  const keys = state.config.omdbApiKeys || [];
  $('omdbKeys').value = keys.join('\n');
  const ks = $('keyStatus');
  if (keys.length) {
    ks.textContent = `✓ ${keys.length} key${keys.length === 1 ? '' : 's'} saved.`;
    ks.className = 'key-status ok';
  } else if (state.config.usingDefaultKey) {
    ks.textContent = 'Using a shared default key (limited 1,000/day for everyone). Add your own above for reliable, higher limits.';
    ks.className = 'key-status no';
  } else {
    ks.textContent = 'No key saved yet.';
    ks.className = 'key-status no';
  }
  $('drives').innerHTML = (state.config.drives || []).map((d) => `<span class="drive-chip" data-drive="${esc(d)}">${esc(d)}</span>`).join('');
  $('settingsModal').hidden = false;
}
function closeSettings() { $('settingsModal').hidden = true; }

async function saveSettings() {
  const scanRoots = $('scanRoots').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const formats = $('formats').value.split(',').map((s) => s.trim()).filter(Boolean);
  const omdbApiKeys = [...new Set($('omdbKeys').value.split('\n').map((s) => s.trim()).filter(Boolean))];
  const body = { scanRoots, formats, omdbApiKeys };
  try {
    state.config = await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) { alert('Could not save settings: ' + err.message); return; }
  // Also sync the full settings (incl. keys) to the signed-in Google account.
  window.MovieSync?.save?.({ scanRoots, formats, omdbApiKeys });
  closeSettings(); render();
  toast(window.MovieSync?.user ? 'Settings saved & synced to your account.' : 'Settings saved.');
}

async function clearLibrary() {
  if (!confirm('Remove all movies and series from the library? (Your files are not touched.)')) return;
  await api('/api/library', { method: 'DELETE' });
  state.movies = []; state.series = [];
  closeSettings(); render();
}

// ── misc ────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c2330;border:1px solid #2a3240;color:#e6edf3;padding:10px 18px;border-radius:8px;z-index:100;box-shadow:0 6px 20px rgba(0,0,0,.4);font-size:.9em;max-width:90vw;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 3400);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── helper status / offline screen ────────────────────────────────────────
function setHelperStatus(ok) {
  const pill = $('helperPill');
  if (!pill) return;
  // Only meaningful when the UI is hosted remotely; hide it in local mode.
  pill.hidden = SERVED_LOCALLY;
  pill.classList.toggle('ok', ok);
  pill.classList.toggle('off', !ok);
  pill.textContent = ok ? '● Helper connected' : '● Helper offline';
}

function showHelperOffline(show) {
  const el = $('helperOffline');
  if (el) el.hidden = !show;
  // Hide the main workspace while offline so the setup screen is the focus.
  document.body.classList.toggle('offline', !!show);
  if (show) {
    const input = $('helperUrlInput');
    if (input) input.value = localStorage.getItem('helperUrl') || DEFAULT_HELPER;
    renderDownloads();
  }
}

// ── download the standalone helper (from GitHub Releases) ─────────────────
const GH_REPO = 'tkafkas82/MovieLibrary';
const DL_BASE = `https://github.com/${GH_REPO}/releases/latest/download/`;
// key → { label, file, run } — `run` is the how-to-launch note for that OS.
const HELPER_ASSETS = {
  win:      { label: 'Windows',              file: 'movielibrary-helper-win-x64.exe',
              run: 'Double-click the downloaded <code>.exe</code>. If Windows SmartScreen warns, click <b>More info → Run anyway</b>.' },
  macArm:   { label: 'macOS (Apple Silicon)', file: 'movielibrary-helper-macos-arm64',
              run: 'macOS quarantines downloads, so open <b>Terminal</b> and run once:<pre>xattr -dr com.apple.quarantine ~/Downloads/movielibrary-helper-macos-arm64\nchmod +x ~/Downloads/movielibrary-helper-macos-arm64\n~/Downloads/movielibrary-helper-macos-arm64</pre>' },
  macIntel: { label: 'macOS (Intel)',        file: 'movielibrary-helper-macos-x64',
              run: 'macOS quarantines downloads, so open <b>Terminal</b> and run once:<pre>xattr -dr com.apple.quarantine ~/Downloads/movielibrary-helper-macos-x64\nchmod +x ~/Downloads/movielibrary-helper-macos-x64\n~/Downloads/movielibrary-helper-macos-x64</pre>' },
  linux:    { label: 'Linux',                file: 'movielibrary-helper-linux-x64',
              run: 'In a terminal:<pre>chmod +x ~/Downloads/movielibrary-helper-linux-x64\n~/Downloads/movielibrary-helper-linux-x64</pre>' },
};

function detectOS() {
  const ua = navigator.userAgent || '';
  const plat = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/win/.test(plat) || /Windows/i.test(ua)) return 'win';
  if (/linux|x11/.test(plat) || (/Linux/i.test(ua) && !/Android/i.test(ua))) return 'linux';
  if (/mac/.test(plat) || /Mac/i.test(ua)) return 'macArm'; // Apple Silicon is the modern default; Intel offered too
  return 'win';
}

// Build a download URL. With a release tag we use a *version-specific* URL so a
// new release is a brand-new link — no stale browser/CDN copy of the old file.
// Falls back to the "latest" alias when the tag lookup fails.
function dlUrl(tag, file) {
  return tag
    ? `https://github.com/${GH_REPO}/releases/download/${encodeURIComponent(tag)}/${file}`
    : `${DL_BASE}${file}`;
}

async function fetchLatestTag() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store',
    });
    if (r.ok) return (await r.json()).tag_name || null;
  } catch { /* offline / rate-limited — fall back to the "latest" alias */ }
  return null;
}

function paintDownloads(tag) {
  const box = $('helperDownload');
  if (!box) return;
  const primaryKey = detectOS();
  const ver = tag ? ` <span class="dl-ver">${esc(tag)}</span>` : '';
  const help = $('runHelp');
  const readme = $('readmeLink');
  if (readme) readme.href = `https://github.com/${GH_REPO}/releases/latest`;

  // All four raw binaries, as a compact "Advanced" list.
  const rawList = ['macArm', 'macIntel', 'win', 'linux']
    .map((k) => `<a href="${dlUrl(tag, HELPER_ASSETS[k].file)}" download>${HELPER_ASSETS[k].label}</a>`).join(' · ');

  // Windows & macOS get a smart double-click launcher (served by this site): it
  // downloads the right binary once, auto-updates only on a new release, and
  // otherwise just re-runs the cached copy.
  const isMac = primaryKey === 'macArm' || primaryKey === 'macIntel';
  const isWin = primaryKey === 'win';

  if (isWin) {
    box.innerHTML = `
      <a class="btn download-primary" href="/movielibrary-helper.bat" download>⬇ Download launcher for Windows${ver}</a>
      <div class="download-others">Advanced — raw binaries: ${rawList}</div>`;
    if (help) help.innerHTML = `<summary>How it works</summary><div class="run-note">
      Double-click <code>movielibrary-helper.bat</code>. If Windows shows a "Windows protected
      your PC" prompt, click <b>More info → Run anyway</b> (one time). It downloads the helper the
      first time, then just re-runs it (updating only when a new version ships). Leave the window open.</div>`;
    return;
  }

  if (isMac) {
    // The launcher ships inside a .zip so the executable bit survives download.
    const oneLiner = `A=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64); curl -fL "https://github.com/${GH_REPO}/releases/latest/download/movielibrary-helper-macos-$A" -o ~/movielibrary-helper && chmod +x ~/movielibrary-helper && ~/movielibrary-helper`;
    box.innerHTML = `
      <a class="btn download-primary" href="${dlUrl(tag, 'movielibrary-helper-mac.zip')}" download>⬇ Download launcher for macOS${ver}</a>
      <div class="download-others">Advanced — raw binaries: ${rawList}</div>`;
    if (help) {
      help.innerHTML = `<summary>How to run it on macOS</summary><div class="run-note">
        <b>Double-click the downloaded <code>.zip</code></b> to unzip it, then <b>right-click</b>
        (Control-click) <code>movielibrary-helper.command</code> → <b>Open</b> → <b>Open</b>
        (one-time — clears Apple's "unidentified developer" warning). It downloads the helper and
        starts it; leave the window open.
        <div class="oneliner">Prefer no clicking around? Paste this into <b>Terminal</b> instead:
          <pre id="macOneLiner">${esc(oneLiner)}</pre>
          <button class="btn tiny" id="copyOneLiner">Copy command</button>
        </div></div>`;
      const cp = $('copyOneLiner');
      if (cp) cp.onclick = () => { navigator.clipboard?.writeText(oneLiner); cp.textContent = 'Copied!'; };
    }
    return;
  }

  // Linux / fallback — raw binary.
  const primary = HELPER_ASSETS[primaryKey];
  box.innerHTML = `
    <a class="btn download-primary" href="${dlUrl(tag, primary.file)}" download>⬇ Download helper for ${primary.label}${ver}</a>
    <div class="download-others">Other systems: ${rawList}</div>`;
  if (help) help.innerHTML = `<summary>How to run it on ${primary.label}</summary><div class="run-note">${primary.run}</div>`;
}

async function renderDownloads() {
  paintDownloads(null);                 // show buttons immediately (latest alias)
  const tag = await fetchLatestTag();   // then upgrade to version-pinned URLs
  if (tag) paintDownloads(tag);
}

// ── PWA: service worker + install prompt ──────────────────────────────────
let deferredInstall = null;
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const btn = $('installBtn');
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const btn = $('installBtn');
    if (btn) btn.hidden = true;
    toast('App installed. Launch it any time from your Start menu / dock.');
  });
}

async function promptInstall() {
  if (!deferredInstall) {
    toast('Use your browser menu → “Install app” to add it (or it may already be installed).');
    return;
  }
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  const btn = $('installBtn');
  if (btn) btn.hidden = true;
}

function wireEvents() {
  $('scanBtn').onclick = startScan;
  $('settingsBtn').onclick = openSettings;
  $('installBtn').onclick = promptInstall;

  // When an update is pending and the user comes back to the tab (e.g. after
  // running the new helper), re-check so the "Update helper" chip disappears
  // once the helper actually reports the new version.
  const recheckUpdate = () => { const c = $('updateChip'); if (c && !c.hidden && !document.hidden) checkForUpdate(); };
  window.addEventListener('focus', recheckUpdate);
  document.addEventListener('visibilitychange', recheckUpdate);

  // Offline / helper-connection screen.
  $('helperRetry').onclick = () => {
    const v = $('helperUrlInput').value.trim();
    if (v) localStorage.setItem('helperUrl', v.replace(/\/+$/, ''));
    connect();
  };
  $('helperPill').onclick = () => { if (!SERVED_LOCALLY) showHelperOffline(true); };
  $('settingsCancel').onclick = closeSettings;
  $('settingsSave').onclick = saveSettings;
  $('clearLibBtn').onclick = clearLibrary;
  $('grid').onclick = onGridClick;
  $('seriesModal').onclick = onSeriesModalClick;
  $('progressCancel').onclick = () => { if (state.stream) { state.stream.close(); state.stream = null; } showProgress(false); setBusy(false); };

  $('search').oninput = (e) => { state.filters.q = e.target.value; render(); };
  $('genre').onchange = (e) => { state.filters.genre = e.target.value; render(); };
  $('sort').onchange = (e) => { state.filters.sort = e.target.value; render(); };
  $('onlyUnmatched').onchange = (e) => { state.filters.onlyUnmatched = e.target.checked; render(); };

  $('drives').onclick = (e) => {
    const chip = e.target.closest('[data-drive]'); if (!chip) return;
    const ta = $('scanRoots');
    const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.includes(chip.dataset.drive)) lines.push(chip.dataset.drive);
    ta.value = lines.join('\n');
  };

  $('settingsModal').onclick = (e) => { if (e.target === $('settingsModal')) closeSettings(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSettings(); closeSeriesModal(); } });
}

init();
