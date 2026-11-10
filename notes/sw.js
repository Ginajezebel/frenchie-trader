// Lets My Notes open without internet. Network first so updates show up; cached copy when offline.
const CACHE = "mynotes-v12";
const FILES = ["./", "./index.html", "./icon-phoenix-180.png", "./manifest.json", "./icon-phoenix-512.png", "./icon-clever-180.png", "./sat-tile.jpg", "./homework-tile.jpg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin || e.request.headers.has("range") || e.request.url.endsWith(".mp4")) return;
  e.respondWith(fetch(e.request, {cache: "no-cache"}).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
