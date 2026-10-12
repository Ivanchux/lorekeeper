/* ==========================================================
   SERVICE WORKER
   - Guarda la "carcasa" de la app para que abra sin conexión.
   - Guarda las portadas que se van viendo para que la
     biblioteca se vea completa también sin conexión.
   - Atiende los botones del aviso de «sesión en marcha»
     (Pausar / Terminar) y reenvía la orden a la app.
   - Las librerías pesadas (OCR, ~6 MB) no se precargan: se
     guardan en caché la primera vez que se usan.
   Sube CACHE_VERSION cada vez que cambies archivos de APP_SHELL.
   ========================================================== */

const CACHE_VERSION = 'lk-v11';
const COVERS_CACHE = 'lk-covers';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/themes.css',
  './css/base.css',
  './css/book3d.css',
  './css/features.css',
  './css/motion.css',
  './css/mobile.css',
  './js/util.js',
  './js/prefs.js',
  './js/books.js',
  './js/storage.js',
  './js/rpg.js',
  './js/audio.js',
  './js/fx.js',
  './js/achievements.js',
  './js/summary.js',
  './js/theme.js',
  './js/api.js',
  './js/book3d.js',
  './js/charts.js',
  './js/ui.js',
  './js/cards.js',
  './js/csv.js',
  './js/scanner.js',
  './js/ocr.js',
  './js/sync.js',
  './js/reminder.js',
  './js/timer.js',
  './js/onboarding.js',
  './js/views/library.js',
  './js/views/search.js',
  './js/views/book.js',
  './js/views/stats.js',
  './js/views/rosco.js',
  './js/views/settings.js',
  './js/views/importer.js',
  './js/views/extras.js',
  './js/app.js',
  './js/vendor/zxing.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Borra cachés de versiones anteriores (las portadas se conservan)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== COVERS_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return; // sincronización: siempre directa a la red

  // Archivos propios: red primero (para recibir cambios) y caché si no hay conexión
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Portadas de otros dominios: caché primero
  if (request.destination === 'image') {
    event.respondWith(
      caches.open(COVERS_CACHE).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              cache.put(request, res.clone());
              return res;
            })
        )
      )
    );
  }
  // Resto (APIs de búsqueda): directo a la red
});

/* ---------- Botones del aviso «Leyendo…» ---------- */
// El estado del temporizador vive en localStorage, al que el Service Worker no
// tiene acceso. Por eso el aviso solo reenvía la orden a la app (abierta o no).
self.addEventListener('notificationclick', (event) => {
  const action = event.action || 'open';
  event.notification.close();
  if (event.notification.data?.type !== 'timer') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((c) => 'focus' in c) || null;
      if (client) {
        client.postMessage({ type: 'lk-notif', action });
        // Pausar/reanudar no necesita traer la app al primer plano
        if (action === 'finish' || action === 'open') await client.focus();
        return;
      }
      // App cerrada: se abre con la orden en la dirección
      return self.clients.openWindow(`./?notif=${encodeURIComponent(action)}#/biblioteca`);
    })
  );
});
