import { defineConfig } from 'vite';

// SharedArrayBuffer only exists on cross-origin isolated pages. Production hosting sends
// the same headers from public/.htaccess (Apache on Majordomo).
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
