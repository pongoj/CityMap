self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// CACHE VERSION: ezt és az APP_VERSION-t együtt növeld!
// Pl: APP_VERSION = "5.31" és itt: CACHE_VERSION = "v5.40"
const CACHE_VERSION = "v5.51.16";
const CACHE_NAME = `citymap-cache-${CACHE_VERSION}`;

const CORE = [
  "./",
  "./index.html",
  "./js/db.js",
  "./js/version.js",
  "./js/00_utils.js",
  "./js/06_update_check.js",
  "./js/06_map_utils.js",
  "./js/01_core.js",
  "./js/11_photos.js",
  "./js/10_markers_map.js",
  "./js/30_settings_modal.js",
  "./js/32_color_editor.js",
  "./js/31_settings_types.js",
  "./js/33_settings_status.js",
  "./js/40_nav_mode.js",
  "./js/41_nav_rotation.js",
  "./js/42_compass_motion.js",
  "./js/43_geolocation_watch.js",
  "./js/03_ui_forms.js",
  "./js/20_filter_export.js",
  "./js/61_header_filter_pops.js",
  "./js/60_longpress_add.js",
  "./js/04_boot.js",
  "./styles.css",
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

  // HTML navigáció mindig hálózatról (GitHub Pages alatt a path pl. /CityMap/)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // index.html explicit (pl. "index.html")
  if (url.pathname.endsWith("index.html")) {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }

  // Verzió ellenőrzéshez (checkForUpdateOnline) mindig hálózatról,
  // különben a SW cache-ből jön vissza és nem derül ki a frissítés.
  if (url.pathname.endsWith("/js/version.js")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});