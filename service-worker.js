self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// CACHE VERSION: ezt és az APP_VERSION-t együtt növeld!
// Pl: APP_VERSION = "5.31" és itt: CACHE_VERSION = "v5.40"
const CACHE_VERSION = "v5.48";
const CACHE_NAME = `citymap-cache-${CACHE_VERSION}`;

const CORE = [
  "./",
  "./app.js",
  "./db.js",
  "./manifest.json",
  "./service-worker.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/user.png",
  "./icons/arrow.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // addAll fails the whole install if ONE file is missing (e.g. when
        // GitHub Pages hasn't refreshed yet). Add items one-by-one instead.
        await Promise.allSettled(
          CORE.map((u) => cache.add(u).catch(() => null))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith("citymap-cache-") && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // csak saját origin
  if (url.origin !== self.location.origin) return;

  // index.html mindig hálózatról
  if (url.pathname === "/" || url.pathname.endsWith("index.html")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});