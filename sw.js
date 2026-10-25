const CACHE = 'eventos-v2.0.0';
const ASSETS = ['./','index.html','style.css','app.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','assets/logo-cobreces.webp','assets/logo-wrslot.webp'];
// Instala saltando la caché HTTP para no guardar archivos antiguos.
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('eventos-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (siempre la versión publicada); caché solo sin conexión.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('./') : undefined))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
// 2.0.0: aviso push del servidor. iOS exige mostrar SIEMPRE una notificación por cada push.
// Misma etiqueta que la notificación local (app.js → evTag) para que el mismo evento no salga dos veces.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  const ids = Array.isArray(d.ids) ? d.ids : [], tag = d.code && ids.length ? 'ev-' + d.code + '-' + ids.at(-1) : 'eventos-push';
  const icon = d.kind === 'pinchazos' ? '🛞 ' : d.kind === 'clima' ? '❄ ' : '⚠ ';
  const pad = n => String(n).padStart(2, '0'), s = Math.floor((d.at || 0) / 1000);
  const body = 'Tiempo de rally ' + pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async cs => {
    const open = cs.filter(c => c.visibilityState === 'visible');
    cs.forEach(c => c.postMessage({ type: 'push', ids, code: d.code })); // la app abierta lanza su alarma fuerte local
    const prev = await self.registration.getNotifications({ tag });
    const quiet = open.length > 0 || prev.length > 0; // ya avisado (app abierta o notificación local): se reemplaza sin volver a sonar
    return self.registration.showNotification(icon + (d.title || 'Nuevo evento'), { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      renotify: !quiet, silent: quiet, requireInteraction: true, vibrate: [400, 150, 400, 150, 800], data: { code: d.code, ids } });
  }));
});
// iOS/Chrome pueden renovar la suscripción: la app la vuelve a registrar al abrirse (resubscribe en app.js).
