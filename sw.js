const CACHE_NAME = 'gemini-live-audio-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  // Note: The main JS module is loaded via importmap, so we cache the ESM source.
  // Make sure the version numbers match what's in your index.html
  'https://esm.sh/lit@^3.3.0',
  'https://esm.sh/lit@^3.3.0/index.js',
  'https://esm.sh/@google/genai@^1.15.0',
  'https://esm.sh/three@^0.176.0',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
