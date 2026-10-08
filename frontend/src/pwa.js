import { useSyncExternalStore } from 'react';

/**
 * Registro del Service Worker y estado de la PWA (instalable / actualización disponible).
 * En desarrollo no se registra (el SW cachearía los módulos de Vite); se puede forzar con VITE_SW_DEV=true.
 */
let estado = { instalable: false, actualizacion: false, instalada: false };
let eventoInstalacion = null;
let workerEnEspera = null;
const oyentes = new Set();
const cambiar = (parcial) => {
  estado = { ...estado, ...parcial };
  oyentes.forEach((f) => f());
};

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function registrarPWA() {
  cambiar({ instalada: standalone() });

  // Chrome / Edge / Android: el navegador ofrece instalar; guardamos el evento para el botón propio
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacion = e;
    cambiar({ instalable: true });
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacion = null;
    cambiar({ instalable: false, instalada: true });
  });

  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD && import.meta.env.VITE_SW_DEV !== 'true') return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      const avisar = (w) => { workerEnEspera = w; cambiar({ actualizacion: true }); };
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        nuevo?.addEventListener('statechange', () => {
          // "installed" con un SW ya controlando la página = hay una versión nueva esperando
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisar(nuevo);
        });
      });
      // Buscar versiones nuevas cada hora (la Portería puede quedar abierta toda la noche)
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('No se pudo registrar el Service Worker', err);
    }
  });

  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });
}

export async function instalarPWA() {
  if (!eventoInstalacion) return false;
  eventoInstalacion.prompt();
  const { outcome } = await eventoInstalacion.userChoice;
  eventoInstalacion = null;
  cambiar({ instalable: false });
  return outcome === 'accepted';
}

export function actualizarPWA() {
  workerEnEspera?.postMessage({ tipo: 'ACTIVAR' });
}

export function descartarActualizacion() {
  cambiar({ actualizacion: false });
}

export const usePWA = () =>
  useSyncExternalStore(
    (f) => { oyentes.add(f); return () => oyentes.delete(f); },
    () => estado
  );
