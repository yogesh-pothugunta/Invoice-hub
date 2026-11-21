const V = "ih-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || r.mode !== "navigate") return;
  e.respondWith(
    fetch(r).then((res) => { const c = res.clone(); caches.open(V).then((ch) => ch.put(r, c)); return res; })
      .catch(() => caches.match(r).then((m) => m || caches.match("/")))
  );
});
