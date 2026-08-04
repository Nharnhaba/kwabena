const CACHE_NAME = "sika-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/expense.css",
  "/expense.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// 1. Install Event: Cache all core application files shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching app shell assets");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Erase obsolete storage versions out of memory
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", k);
            return caches.delete(k);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// 3. Fetch Event: Serve cached content instantly first, fall back to network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached asset if it exists, otherwise pull from server network
      return cachedResponse || fetch(event.request);
    })
  );
});
