/* DWIM TV service worker — makes the site installable and fast.
   Strategy:
   - App shell (HTML/CSS/JS/images): stale-while-revalidate, with precache for offline start
   - Page navigations: network first, fall back to cached shell when offline
   - /api/catalog: network first, cached copy when offline (so the video list still shows)
   - Everything else under /api/, admin and video streams: never cached (live status must be fresh) */
const VERSION = 'dwim-tv-v8';
const SHELL = [
  '/', '/css/styles.css', '/css/ui-v2.css', '/js/ui-v2.js', '/js/app.js', '/js/tv.js', '/js/schedule.js', '/js/pwa.js', '/js/prayer.js', '/js/player.js',
  '/img/logo-64.png', '/img/logo-192.png', '/img/logo-512.png', '/img/favicon-32.png',
  '/img/apple-touch-icon.png', '/offline.html', '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // YouTube, thumbnails, video hosts: browser handles
  if (req.headers.has('range')) return;                    // media streaming
  if (url.pathname.startsWith('/api/admin') || url.pathname === '/admin.html' ||
      url.pathname.startsWith('/js/admin') || url.pathname.startsWith('/css/admin')) return;

  if (url.pathname === '/api/catalog') {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/service.ics') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/').then((r) => r || caches.match('/offline.html')))
    );
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then((r) => r || new Response('{"channels":[],"videos":[]}', { headers: { 'Content-Type': 'application/json' } })));
}

function staleWhileRevalidate(req) {
  return caches.open(VERSION).then((cache) =>
    cache.match(req).then((cached) => {
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    })
  );
}
