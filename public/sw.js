// KroniBola service worker.
//
// Strategy:
//   - Precache the app shell + logo so installed PWAs open instantly.
//   - Runtime-cache same-origin static assets and Google Fonts (cache-first).
//   - HTML navigations: network-first with cache fallback (so the user always
//     gets the freshest page when online, but a cached copy when offline).
//   - NEVER cache /api/* — registration and admin data must always be live.
//
// Bump CACHE_VERSION when you change this file or want to invalidate old
// caches (e.g. after a major UI rewrite).

const CACHE_VERSION = 'v1';
const CACHE_STATIC = `kronibola-static-${CACHE_VERSION}`;
const CACHE_RUNTIME = `kronibola-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/logo-v2.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API calls — registration/admin data must always be live.
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigations: network-first, fall back to cache when offline so the
  // user can still see the last page they visited with no signal.
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_RUNTIME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Same-origin static + Google Fonts: cache-first, populate on miss.
  const isCacheable = url.origin === location.origin
    || url.host === 'fonts.googleapis.com'
    || url.host === 'fonts.gstatic.com';

  if (isCacheable) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        // Skip non-OK and opaque responses (e.g. 404s, third-party redirects)
        // — we don't want to poison the cache with broken assets.
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(CACHE_RUNTIME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  }
});
