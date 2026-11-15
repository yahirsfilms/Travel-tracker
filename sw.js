const CACHE = "roam-shell-v1.2.3-refinement";
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
  if (event.data?.type === "CHECK_OFFLINE") event.waitUntil((async()=>{const cache=await caches.open(CACHE);const matches=await Promise.all(ASSETS.map(asset=>cache.match(asset)));event.ports?.[0]?.postMessage({ready:matches.every(Boolean),version:CACHE});})());
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
