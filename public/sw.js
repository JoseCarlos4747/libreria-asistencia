self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('libreria-store').then((cache) => cache.addAll([
      '/login.html',
      '/empleado.html',
      '/admin.html',
    ])),
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request)),
  );
});