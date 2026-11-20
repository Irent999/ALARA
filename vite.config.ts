import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  // В локальной среде (ПК / локальная сеть для HTC Vive) включаем HTTPS по умолчанию через basicSsl().
  // В облачном превью (Cloud Run за nginx-прокси, где TLS уже терминируется снаружи и задан K_SERVICE)
  // внутренний dev-сервер должен слушать HTTP на 0.0.0.0:3000, иначе reverse-proxy не пройдёт healthcheck.
  const isCloudProxy = Boolean(process.env.K_SERVICE) && process.env.HTTPS !== 'true';
  const useHttps = process.env.HTTPS !== 'false' && !isCloudProxy;

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      ...(useHttps ? [basicSsl()] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      ...(useHttps ? { https: {} } : {}),
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
      ...(useHttps ? { https: {} } : {}),
    },
  };
});
