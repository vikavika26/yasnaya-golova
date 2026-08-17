/**
 * Service worker: приложение открывается и работает без сети.
 * Своё — из кэша (обновляем в фоне), погоду — только из сети:
 * устаревший прогноз хуже отсутствующего.
 */
const CACHE = 'yasnaya-golova-v1';
const ASSETS = [
  '.', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/ui.js', 'js/engine.js', 'js/stats.js',
  'js/store.js', 'js/weather.js', 'js/import.js', 'js/xlsx.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;             // погода и геокодер — всегда из сети

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const fetching = fetch(event.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await fetching) || new Response('Офлайн', { status: 503 });
  })());
});
