// Service worker: кэширует файлы приложения, чтобы оно открывалось без интернета.
// Файлы берутся из сети, а кэш нужен для работы офлайн. VERSION меняй, если переименовал или удалил файлы.
const VERSION = 'v3';
const CACHE = `money-${VERSION}`;
// Большой модуль чтения PDF (vendor/pdfjs) не кэшируется заранее — он загрузится при первом импорте PDF.
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/utils.js',
  './js/ui.js',
  './js/charts.js',
  './js/qr.js',
  './js/import.js',
  './js/lock.js',
  './js/views/home.js',
  './js/views/history.js',
  './js/views/budgets.js',
  './js/views/plans.js',
  './js/views/goals.js',
  './js/views/debts.js',
  './js/views/more.js',
  './js/views/txSheet.js',
  './js/views/scanner.js',
  './js/views/importSheet.js',
  './js/views/onboarding.js',
  './js/views/photo.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Сначала сеть (чтобы сразу получать обновления), при отсутствии интернета — кэш.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
