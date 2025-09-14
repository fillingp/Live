const CACHE_NAME = 'gemini-live-audio-v2'; // Incremented cache version
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  '/index.js',
  // Pin CDN URLs to match importmap exactly
  'https://esm.sh/lit@3.3.0',
  'https://esm.sh/@lit/context@1.1.5',
  'https://esm.sh/@google/genai@1.15.0',
  'https://esm.sh/three@0.176.0',
  'https://esm.sh/three@0.176.0/addons/loaders/EXRLoader.js',
  'https://esm.sh/three@0.176.0/addons/postprocessing/EffectComposer.js',
  'https://esm.sh/three@0.176.0/addons/postprocessing/RenderPass.js',
  'https://esm.sh/three@0.176.0/addons/postprocessing/ShaderPass.js',
  'https://esm.sh/three@0.176.0/addons/postprocessing/UnrealBloomPass.js',
  'https://esm.sh/three@0.176.0/addons/shaders/FXAAShader.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching initial assets');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Use a stale-while-revalidate strategy for all GET requests.
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(response => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(error => {
            console.error('Fetch failed:', error);
            // In a real-world scenario, you might want to return a custom offline page
            // return caches.match('/offline.html');
        });

        // Return the cached response immediately if available, otherwise wait for the network
        return response || fetchPromise;
      });
    })
  );
});
