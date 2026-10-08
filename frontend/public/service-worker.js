/* Service Worker de Integra360.
 *
 * Estrategias:
 *  - Navegación (páginas):  red primero; sin conexión se sirve la app guardada (SPA) y React resuelve la ruta.
 *  - /assets/* (JS/CSS con hash de Vite) y /icons/*: caché primero (el nombre cambia en cada build).
 *  - /uploads/* (imágenes de eventos): se muestra lo guardado y se actualiza en segundo plano.
 *  - /api/*: NUNCA se guarda. La Portería tiene que consultar siempre al servidor: una respuesta
 *    vieja podría dejar entrar dos veces con la misma entrada.
 */
const VERSION = 'v1';
const CACHE_APP = `integra360-app-${VERSION}`;
const CACHE_IMAGENES = `integra360-img-${VERSION}`;
const MAX_IMAGENES = 80;
const PRECARGA = ['/', '/manifest.json', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(PRECARGA)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const vigentes = [CACHE_APP, CACHE_IMAGENES];
      for (const nombre of await caches.keys()) if (!vigentes.includes(nombre)) await caches.delete(nombre);
      await self.clients.claim();
    })()
  );
});

// La app pide activar la versión nueva cuando el usuario toca "Actualizar"
self.addEventListener('message', (event) => {
  if (event.data?.tipo === 'ACTIVAR') self.skipWaiting();
});

const recortar = async (nombre, max) => {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  for (const k of claves.slice(0, Math.max(0, claves.length - max))) await cache.delete(k);
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // siempre a la red

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(request);
          if (respuesta.ok) (await caches.open(CACHE_APP)).put('/', respuesta.clone());
          return respuesta;
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(
      (async () => {
        const guardada = await caches.match(request);
        if (guardada) return guardada;
        const respuesta = await fetch(request);
        if (respuesta.ok) (await caches.open(CACHE_APP)).put(request, respuesta.clone());
        return respuesta;
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/landing/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_IMAGENES);
        const guardada = await cache.match(request);
        const red = fetch(request)
          .then(async (r) => {
            if (r.ok) { await cache.put(request, r.clone()); recortar(CACHE_IMAGENES, MAX_IMAGENES); }
            return r;
          })
          .catch(() => guardada || Response.error());
        if (guardada) { event.waitUntil(red); return guardada; }
        return red;
      })()
    );
  }
});
