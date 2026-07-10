// Minimal service worker for PWA installability.
//
// Why this exists: Chrome / Edge only surface the "Install app" affordance in
// the address bar when the page is controlled by a service worker that registers
// a `fetch` event handler (alongside a valid manifest, which we already have).
//
// This worker intentionally does NOT cache anything. The fetch listener below
// never calls `respondWith()`, so the browser handles every request with its
// default network behavior — identical to having no service worker at all for
// request handling. Its mere presence is what satisfies the installability check.
//
// We avoid caching deliberately: this app is server-dependent (API, large WASM
// for CAD import, model files) and aggressive precaching would balloon storage
// and risk serving stale bundles. Offline support is intentionally out of scope.

const SW_VERSION = '3dparthub-sw-v1';

// Activate the new worker immediately so the install icon can surface within
// the first session rather than requiring every existing tab to close first.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Take control of clients right away (paired with skipWaiting above).
      await self.clients.claim();
      // We don't write caches today, but evict anything from prior versions so a
      // future caching-capable release stays clean. Keys never matching is fine.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== SW_VERSION).map((key) => caches.delete(key)));
    })(),
  );
});

// The fetch handler that makes this an "installable" PWA. Empty body is
// deliberate: no respondWith() => browser falls through to normal network.
self.addEventListener('fetch', () => {});
