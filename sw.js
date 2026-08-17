/* Copyright (c) August 2026 Andres Patrignani. */
/*
 * sw.js — service worker for offline use and installability.
 *
 * Network-FIRST: every request tries the network and only falls back to the
 * cache when offline. That means a fresh deploy is always seen immediately
 * (no stale-content trap), while a revisit still works with no connection.
 * Only same-origin GETs are cached; CDN, Earth Engine and map tiles pass
 * straight through. The cache name carries the app version (from the
 * ?v=... on the registration URL), so bumping the version clears old caches.
 */

/* Brand-agnostic cache name (version-scoped) so renaming the app never edits
   this worker. The version rides in on the ?v=... of the registration URL. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `app-cache-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
