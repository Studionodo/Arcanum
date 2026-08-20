// sw.js — Arcanum service worker
// Cache-first per gli asset statici, network-only per WebSocket (non applicabile ai SW comunque)

const CACHE_NAME = 'arcanum-v1.17.0';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/crypto.js',
  '/js/db.js',
  '/js/webrtc.js',
  '/js/signaling.js',
  '/js/qr.js',
  '/js/media.js',
  '/js/mutex.js',
  '/js/i18n.js',
  '/js/rain.js',
  '/js/titleFx.js',
  '/js/swipe.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Non intercettare WebSocket o richieste cross-origin (CDN libsodium)
  if (event.request.url.startsWith('ws')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache dinamica solo per risorse same-origin
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
