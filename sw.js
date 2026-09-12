const CACHE_PREFIX = 'prestcontrol-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v67`;

const FIREBASE_SDK_OFFLINE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './core/firebase.js',
  './core/helpers.js',
  './core/ui-state.js',
  './core/dom-helpers.js',
  './repositories/index.js',
  './repositories/Repository.js',
  './repositories/ClienteRepository.js',
  './repositories/PrestamoRepository.js',
  './services/index.js',
  './services/ClienteService.js',
  './services/PrestamoService.js',
  './services/AuthService.js',
  './services/MetricasFinancierasService.js',
  './services/CajaService.js',
  './services/RiesgoClienteService.js',
  './ui/historial.js',
  './ui/index.js',
  './ui/clientes.js',
  './ui/prestamos.js',
  './ui/prendas.js',
  './ui/caja.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL.map(asset => new Request(asset, { cache: 'reload' })));
      // Los SDK son necesarios para que Firebase Auth pueda restaurar su usuario
      // persistido al reabrir la PWA offline. Su fallo no invalida el shell local.
      await Promise.allSettled(FIREBASE_SDK_OFFLINE.map(asset =>
        cache.add(new Request(asset, { cache: 'reload', mode: 'cors' }))
      ));
    })
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
      .then(async () => {
        await self.clients.claim();
        // La página coordina la recarga cuando ya no hay formularios ni
        // operaciones financieras activas.
        const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        ventanas.forEach(cliente => cliente.postMessage({
          type: 'PRESTCONTROL_SHELL_READY',
          cacheName: CACHE_NAME
        }));
      })
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    try {
      const response = request.mode === 'navigate'
        ? await fetch(request, { cache: 'no-store' })
        : await fetch(request);
      if ((url.origin === self.location.origin || FIREBASE_SDK_OFFLINE.includes(request.url)) && response.ok) {
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
