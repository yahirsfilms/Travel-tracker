const CACHE = "roam-shell-v1.1.3-accounting";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./core.js",
  "./accounting.js",
  "./db.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("message", (event) => {
  if (event.data === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("roam-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL(self.registration.scope).pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request, { ignoreSearch: true });
      if (hit) return hit;
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return await cache.match("./index.html");
        }
      }
      return fetch(event.request);
    })(),
  );
});
