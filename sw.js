const SHELL_CACHE = 'ashes-of-vale-shell-v10';
const SHELL_URLS = [
  './',
  './index.html',
  './src/styles.css',
  './src/main.js',
  './src/core/config.js',
  './src/core/engine.js',
  './src/core/physics.js',
  './src/core/assetLoader.js',
  './src/core/lightProbes.js',
  './src/player/controller.js',
  './src/input/touchControls.js',
  './src/weapons/weapons.js',
  './src/fx/effects.js',
  './src/audio/audioSystem.js',
  './src/ai/enemySystem.js',
  './src/world/doors.js',
  './src/world/villageBuilder.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('ashes-of-vale-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.endsWith('assets-manifest.json')) {
    return;
  }

  // Cache-first for immutable CDN libraries (three.js, rapier)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      })
    );
    return;
  }

  // Network-first for origin shell (HTML, JS, CSS) so mobile updates land immediately, offline fallback to cache
  if (url.origin === self.location.origin && !url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        try {
          const resp = await fetch(req, { cache: 'no-cache' });
          if (resp && resp.ok) {
            cache.put(req, resp.clone()).catch(() => {});
          }
          return resp;
        } catch {
          const hit = await cache.match(req);
          return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })
    );
  }
});
