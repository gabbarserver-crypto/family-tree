/* Minimal service worker: makes the app installable. It does not cache anything,
   so you always get the latest app and live Supabase data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
