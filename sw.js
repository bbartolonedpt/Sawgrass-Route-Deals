self.addEventListener('install', e => {
  e.waitUntil(caches.open('sawgrass-v1').then(cache => cache.addAll([
    './', './index.html', './css/styles.css', './js/app.js', './js/sw-register.js', './data/stores.json'
  ])));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});