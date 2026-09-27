var CACHE = "yt-analytics-v1";
var ASSETS = [
  "/youtube-dashboard/",
  "/youtube-dashboard/index.html",
  "/youtube-dashboard/style.css",
  "/youtube-dashboard/app.js",
  "/youtube-dashboard/manifest.json",
  "/youtube-dashboard/icon-192.png",
  "/youtube-dashboard/icon-512.png",
  "/youtube-dashboard/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Network-first for YouTube API calls (always fresh)
  if (url.hostname.indexOf("googleapis.com") >= 0) {
    e.respondWith(
      fetch(e.request).catch(function () { return caches.match(e.request); })
    );
    return;
  }
  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (resp) {
        var clone = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        return resp;
      });
    })
  );
});
