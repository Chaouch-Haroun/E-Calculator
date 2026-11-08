// Rbe7: keeps a copy of the page on the device so it opens without internet.
// The seller's numbers are not cached here: the page keeps them in the browser storage.
const CACHE = "rbe7-v2";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.pathname.includes("/api/")) return;
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {   // fonts: cache first
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; })));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return res; })   // page: newest when online
    .catch(() => caches.match(req).then((r) => r || caches.match("./index.html"))));
});
