/* Service worker mínimo: permite instalar la app y abrir la pantalla aunque haya mala cobertura.
 * Los datos NUNCA se guardan aquí: las peticiones a Supabase no pasan por la caché. */
const CACHE = "doggy-v14";
const BASICOS = ["./", "index.html", "manifest.json", "icon-192-v2.png", "icon-512-v2.png", "favicon-v2.png", "logo-gestion.png", "logo-registro.png", "logo-facturas.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const peticion = e.request;
  if (peticion.method !== "GET" || new URL(peticion.url).origin !== self.location.origin) return;
  // Primero la red (para que los cambios se vean al momento); la caché solo si no hay conexión.
  e.respondWith(
    fetch(peticion)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((c) => c.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(peticion).then((r) => r || caches.match("index.html")))
  );
});
