// Minimal service worker for PWA installability.
//
// Why this exists: alongside a valid manifest (site.webmanifest) and HTTPS, a
// registered service worker keeps the app recognized as a PWA. Chrome's old
// requirement — a fetch handler that calls respondWith() — was retired in 2023
// (developer.chrome.com/blog/update-install-criteria), so this worker now
// registers NO fetch handler at all: a no-op fetch listener only added per-
// navigation overhead, which recent Chrome versions flag in the console
// ("Fetch event handler is recognized as no-op").
//
// This worker intentionally does NOT cache anything. Offline support is
// deliberately out of scope: the app is server-dependent (API, large WASM
// for CAD import, model files) and aggressive precaching would balloon storage
// and risk serving stale bundles.
//
// Keeping a (handler-less) worker registered matters for users who installed
// the app earlier, and skipWaiting/claim below push this update out to every
// existing registration so the fetch handler disappears after one reload.

const SW_VERSION = '3dparthub-sw-v2';

// Activate the new worker immediately so existing registrations pick up this
// version within the first session rather than requiring every tab to close.
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
