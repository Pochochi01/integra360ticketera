import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Backend al que apunta el proxy de desarrollo (por defecto el local)
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4000';

// `--mode https` (o VITE_HTTPS=true) sirve por https con un certificado autofirmado y expone el servidor en la red local,
// para probar la Portería desde un celular: la cámara (getUserMedia) y el Service Worker
// sólo funcionan en https o en localhost.
const proxy = {
  '/uploads': API_TARGET,
  '/api': {
    target: API_TARGET,
    // Reenvía el host original para que el backend detecte el tenant por subdominio
    configure: (p) => {
      p.on('proxyReq', (proxyReq, req) => proxyReq.setHeader('x-forwarded-host', req.headers.host));
    },
  },
};

export default defineConfig(({ mode }) => {
  const HTTPS = mode === 'https' || process.env.VITE_HTTPS === 'true';
  return {
    plugins: [react(), tailwindcss(), ...(HTTPS ? [basicSsl({ name: 'integra360' })] : [])],
    server: {
      port: 5173,
      host: HTTPS || undefined,
      // Permite probar tenants por subdominio: http://norte.localhost:5173
      allowedHosts: ['.localhost'],
      proxy,
    },
    // `npm run build && npm run preview`: la versión de producción, con Service Worker activo
    preview: {
      port: 4173,
      host: HTTPS || undefined,
      proxy,
    },
  };
});
