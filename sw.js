// Network-first so GitHub Pages updates show up immediately; the cache is the offline fallback.
const CACHE = 'basicir-v2-2';
const FILES = ['./', 'index.html', 'app.js', 'rules.js', 'generator.js', 'store.js', 'manifest.json', 'icon.svg', 'instruments/card.js', 'instruments/dicdi.js', 'instruments/hsi.js', 'instruments/index.js', 'instruments/overlay.js', 'instruments/rmi.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // cache: 'no-cache' revalidates with the server, so a stale HTTP-cached module can never be
  // mixed with a fresh app.js (that mismatch breaks the whole page with a missing-export error).
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then((res) => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy))); }
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
