// Service worker for the MKV Movie Library PWA.
// Caches only the static app shell (served from the host, e.g. Vercel) so the
// UI opens instantly and works offline as a shell. It deliberately does NOT
// touch requests to the local helper (cross-origin http://localhost:*) or any
// API/SSE calls — those must always hit the live helper.

const CACHE = 'movielib-shell-v11';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/auth.js',
  '/firebase-config.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs for the shell. Let everything else — the
  // cross-origin helper calls, API, SSE, posters — go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Stale-while-revalidate: serve cache fast, refresh in the background.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
