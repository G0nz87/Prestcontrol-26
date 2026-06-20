const CACHE_PREFIX = 'prestcontrol-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v1`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './core/firebase.js',
  './repositories/index.js',
  './repositories/Repository.js',
  './repositories/ClienteRepository.js',
  './repositories/PrestamoRepository.js',
  './services/index.js',
  './services/ClienteService.js',
  './services/PrestamoService.js',
  './services/AuthService.js',
  './ui/index.js',
  './ui/clientes.js',
  './ui/prestamos.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (url.origin === self.location.origin && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;

      if (request.mode === 'navigate') {
        const appShell = await caches.match('./index.html');
        if (appShell) return appShell;
      }

      throw error;
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const visibleClient = clients.find(client => client.url.startsWith(self.location.origin));
      if (visibleClient) {
        visibleClient.navigate(targetUrl);
        return visibleClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
