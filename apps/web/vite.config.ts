import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O back-end (Fastify) roda separado; em dev com API real, o proxy evita CORS.
// Com VITE_USE_MOCK=true o proxy não é usado: a camada src/mocks responde em memória.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 127.0.0.1 (e não "localhost"): no Windows/Node 17+ "localhost" pode resolver para ::1 (IPv6),
    // e a API escuta em 0.0.0.0 (IPv4) — o proxy falharia com "Erro inesperado" mesmo com a API no ar.
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: { sourcemap: false, target: 'es2022' },
});
