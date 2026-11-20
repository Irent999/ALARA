import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  // WebXR и автономные гарнитуры (HTC Vive / SteamVR / Meta Quest) требуют безопасный HTTPS-контекст.
  // Флаг активируется при запуске с флагом --https или переменными окружения HTTPS=true / VITE_HTTPS=true.
  const isHttps =
    process.env.HTTPS === 'true' ||
    process.env.VITE_HTTPS === 'true' ||
    process.argv.includes('--https');

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      ...(isHttps ? [basicSsl()] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
