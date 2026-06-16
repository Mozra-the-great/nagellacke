// Evicts any previously installed v2 service worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister().then(() => {
    return self.clients.matchAll({ type: 'window' });
  }).then((clients) => {
    clients.forEach((c) => c.navigate(c.url));
  });
});
