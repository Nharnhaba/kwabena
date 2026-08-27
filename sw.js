const CACHE_NAME = "sika-cache-v45";
const ASSETS = [
  "./",
  "./index.html",
  "./expense.css",
  "./expense.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only handle http/https requests
  if (!url.protocol.startsWith("http")) return;

  // Do not intercept Firestore api requests
  if (url.hostname.includes("firestore.googleapis.com") || url.hostname.includes("googleapis.com")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses from our own origin or trusted CDNs (like gstatic for firebase compat libs)
        const isSelfOrigin = url.origin === self.location.origin;
        const isGstatic = url.hostname === "www.gstatic.com";
        
        if (response && response.status === 200 && (isSelfOrigin || isGstatic)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("./");
      }
    })
  );
});