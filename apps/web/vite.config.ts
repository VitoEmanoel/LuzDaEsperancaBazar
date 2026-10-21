import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// HTTPS só para TESTE (S5-13): o celular só libera a câmera em página segura. Com VITE_HTTPS_CERT e VITE_HTTPS_KEY
// (caminhos de um certificado autoassinado, fora do repositório; veja o README do apps/web) o servidor de desenvolvimento
// abre em https. Não é a hospedagem do sistema (P-03 continua aberta).
const cert = process.env.VITE_HTTPS_CERT;
const key = process.env.VITE_HTTPS_KEY;
if (!!cert !== !!key) throw new Error('[vite] para o HTTPS de teste informe as duas variáveis: VITE_HTTPS_CERT e VITE_HTTPS_KEY');
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;

// O back-end (Fastify) roda separado; em dev com API real, o proxy evita CORS.
// Com VITE_USE_MOCK=true o proxy não é usado: a camada src/mocks responde em memória.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https,
    // 127.0.0.1 (e não "localhost"): no Windows/Node 17+ "localhost" pode resolver para ::1 (IPv6),
    // e a API escuta em 0.0.0.0 (IPv4) — o proxy falharia com "Erro inesperado" mesmo com a API no ar.
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: { sourcemap: false, target: 'es2022' },
});
