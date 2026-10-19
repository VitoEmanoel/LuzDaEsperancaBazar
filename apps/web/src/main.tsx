import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { setTransport } from './shared/api/http';
// Fontes do brandbook servidas pelo próprio app (CSP 'self': nada de CDN).
import '@fontsource-variable/lora/wght.css';
import '@fontsource-variable/nunito/wght.css';
import './styles/index.css';

async function bootstrap() {
  // API simulada SÓ em desenvolvimento: em `vite build`, import.meta.env.DEV é `false`
  // e o bloco (com o import dinâmico) é removido do bundle de produção.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true') {
    const { mockTransport } = await import('./mocks/server');
    setTransport(mockTransport);
    console.info('[dev] API simulada ativa (ver README)');
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void bootstrap();
