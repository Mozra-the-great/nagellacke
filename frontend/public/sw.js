const CACHE = "nagellacke-v__APP_VERSION__";

self.addEventListener("install", e => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.url.includes("/api/")) return;
  // HTML always fetch from network so updated JS bundle hashes are always used
  if (e.request.headers.get("accept")?.includes("text/html")) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached =>
        cached || fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        })
      )
    )
  );
});
