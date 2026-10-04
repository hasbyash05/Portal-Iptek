const CACHE_NAME = 'iptek-pwa-v16';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/auth.js',
  '/js/router.js',
  '/js/academic.js',
  '/js/attendance.js',
  '/js/finance.js',
  '/js/dashboard.js',
  '/js/app.js',
  '/img/favicon.svg',
  '/img/logo.jpg',
  '/img/bg-logo.jpg',
  '/asset/background.jpg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        urlsToCache.map(url => {
          return cache.add(url).catch(err => {
            console.warn('[SW] Failed to pre-cache ' + url + ':', err);
          });
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // Hanya proses request GET
  if (event.request.method !== 'GET') return;
  // Jangan pernah cegat endpoint API dinamis
  if (event.request.url.includes('/api/')) return;

  // 1. Khusus navigasi halaman HTML (buka web / refresh): Network-First dengan fallback cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            return cached || caches.match('/index.html') || caches.match('/');
          });
        })
    );
    return;
  }

  // 2. Aset statis (CSS, JS, Gambar, Font): Cache-First dengan Network Fallback
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(err => {
        console.warn('[SW] Fetch failed for ' + event.request.url, err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
