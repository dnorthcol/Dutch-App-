// Service worker:
// - Network-first for HTML / JS / JSON: updates show up immediately when online,
//   fall back to cache when offline
// - Cache-first for static assets (icons, manifest, css): they rarely change
const VERSION = "v4";
const CACHE = `nlcards-${VERSION}`;
const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "vocab.json",
  "grammar.json",
  "texts.json",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFreshAsset(url) {
  return /\.(html|js|json)$/i.test(url.pathname) || url.pathname === "/" || url.pathname.endsWith("/");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isFreshAsset(url)) {
    // Network-first
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else {
    // Cache-first for static assets
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
      )
    );
  }
});
