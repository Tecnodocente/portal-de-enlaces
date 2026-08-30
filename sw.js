const CACHE_PREFIX = 'portal-de-enlaces-';
const SERVICE_WORKER_VERSION = '2.4.8';
const CACHE_NAME = CACHE_PREFIX + SERVICE_WORKER_VERSION;
const SHELL_URLS = [
  './',
  './index.html',
  './config.js',
  './portal-core.js',
  './card-visuals.js',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './version.json',
  './assets/branding/favicon.png',
  './assets/branding/apple-touch-icon.png',
  './assets/branding/logo-centro.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/cards/library.json',
  './assets/cards/recursos.webp',
  './assets/cards/digital.webp',
  './assets/cards/organizacion.webp',
  './assets/cards/comunidad.webp',
  './assets/cards/alumnado.webp',
  './assets/cards/incidencias.webp',
  './assets/cards/mantenimiento.webp',
  './assets/cards/espacios.webp',
  './assets/cards/formularios.webp',
  './assets/cards/documentacion.webp',
  './assets/cards/semantic-symbols.svg',
  './assets/cards/semantic-scenes.svg'
];

function canonicalCacheKey(request) {
  const url = new URL(typeof request === 'string' ? request : request.url, self.location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async function (url) {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error('No se puede precachear ' + url);
      await cache.put(canonicalCacheKey(url), response);
    }));
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (name) {
      return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME ? caches.delete(name) : Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Nunca cachea el backend.

  event.respondWith((async function () {
    const cacheKey = canonicalCacheKey(request);
    const isVersionRequest = /\/version\.json$/i.test(url.pathname);
    try {
      const response = await fetch(request, { cache: isVersionRequest ? 'no-store' : 'no-cache' });
      if (response && response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(cacheKey, response.clone());
        } catch (_) {
          // Un fallo de escritura de caché no invalida una respuesta de red correcta.
        }
      }
      return response;
    } catch (_) {
      const cached = await caches.match(cacheKey);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw _;
    }
  })());
});
