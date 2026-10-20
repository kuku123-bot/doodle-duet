// Offline support: network first (so updates arrive immediately), cached copy when offline.
const CACHE = 'doodle-duet-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'vendor/peerjs.min.js', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/main.js', 'js/util.js', 'js/icons.js', 'js/doc.js', 'js/brushes.js', 'js/fill.js', 'js/view.js', 'js/input.js', 'js/modes.js',
  'js/library.js', 'js/words.js', 'js/store.js', 'js/ui/widgets.js', 'js/ui/color.js', 'js/ui/panels.js', 'js/ui/rails.js', 'js/replay.js', 'icons/favicon-32.png',
  'js/net/session.js', 'js/net/transport.js', 'js/net/relay.js', 'js/net/relaykey.js', 'js/net/mqtt.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
