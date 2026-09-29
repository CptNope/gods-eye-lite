// God's Eye Lite service worker.
// - App shell: cache-first (precached, versioned).
// - CDN libraries (Cesium, satellite.js): stale-while-revalidate.
// - Map tiles: cache-first with a size cap so revisited areas load offline.
// - Live data APIs: network-only (the app itself keeps stale copies where useful).
const VERSION = 'gel-v3';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/util.js', './js/styles.js',
  './js/layers/flights.js', './js/layers/satellites.js', './js/layers/quakes.js', './js/layers/launches.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const TILE_HOSTS = ['server.arcgisonline.com', 'gibs.earthdata.nasa.gov', 'basemaps.cartocdn.com'];
const LIB_HOSTS = ['cdn.jsdelivr.net'];
const TILE_CACHE = VERSION + '-tiles';
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }
  if (LIB_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(staleWhileRevalidate(req, VERSION + '-lib'));
    return;
  }
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(cacheFirstTile(req));
  }
  // everything else (live feeds) goes straight to the network
});

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

async function cacheFirstTile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
