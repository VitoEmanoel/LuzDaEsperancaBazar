/**
 * Teste de TELA da acessibilidade (S6-05), no navegador de verdade, sobre a demonstração (API simulada):
 *  - janela: título com id próprio, Esc fecha, clique fora fecha, mas arrastar a seleção de um campo para fora NÃO fecha;
 *    o Tab dá a volta só pelo que se vê;
 *  - abas: só a ativa entra no Tab; setas, Home e End trocam de aba e levam o foco junto;
 *  - aviso (toast) anunciado uma vez só (o container não é região viva).
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/acessibilidade-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}[${(a.getAttribute('aria-label') || a.innerText || a.placeholder || '').trim().slice(0, 30)}]` : 'nada'; });
const ir = (r) => page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, r);

try {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill('admin'); await page.getByLabel('Senha', { exact: true }).fill('Admin@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

  // ---------- abas (Administração) ----------
  await ir('/admin/usuarios');
  await page.getByRole('tab', { name: 'Usuários' }).waitFor({ timeout: 10000 });
  const tabindex = await page.getByRole('tab').evaluateAll((ts) => ts.map((t) => t.getAttribute('tabindex')));
  check(tabindex.filter((x) => x === '0').length === 1 && tabindex.filter((x) => x === '-1').length === tabindex.length - 1, 'abas: só a ativa entra no Tab', tabindex);
  await page.getByRole('tab', { name: 'Usuários' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check(/\/admin\/perfis/.test(page.url()) && (await foco()).includes('Perfis'), 'seta para a direita vai para a aba seguinte e leva o foco', { url: page.url(), foco: await foco() });
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  const ultima = (await page.getByRole('tab').allInnerTexts()).at(-1);
  check((await foco()).includes(ultima), 'End vai para a última aba', { foco: await foco(), ultima });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check((await foco()).includes('Usuários'), 'depois da última, a seta volta à primeira', await foco());

  // ---------- janela: Novo usuário ----------
  await page.getByRole('button', { name: /Novo usuário/ }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.waitFor({ timeout: 5000 });
  const titulo = await dialogo.evaluate((d) => { const id = d.getAttribute('aria-labelledby'); return { id, texto: document.getElementById(id)?.textContent, fixo: id === 'modal-titulo' }; });
  check(!!titulo.texto && !titulo.fixo, 'janela: o título tem id próprio e o aria-labelledby aponta para ele', titulo);
  // arrastar a seleção de um campo para fora da janela não fecha
  const campo = dialogo.locator('input').first();
  await campo.fill('texto para selecionar');
  const c = await campo.boundingBox();
  await page.mouse.move(c.x + 5, c.y + c.height / 2); await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 1, 'janela: arrastar a seleção de um campo para fora NÃO fecha');
  // o contrário: apertar no fundo e soltar dentro da janela também não fecha (o click iria para o fundo, o ancestral comum)
  await page.mouse.move(5, 5); await page.mouse.down();
  await page.mouse.move(c.x + 5, c.y + c.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 1, 'janela: apertar no fundo e soltar dentro NÃO fecha');
  // o Tab dá a volta: do último volta ao primeiro, sem passar por fora
  let saiu = false;
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) { saiu = true; break; } }
  check(!saiu, 'janela: 25 Tabs seguidos não tiram o foco da janela');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0, 'janela: Esc fecha');
  // clique inteiro fora fecha
  await page.getByRole('button', { name: /Novo usuário/ }).click();
  await dialogo.waitFor({ timeout: 5000 });
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0, 'janela: clique fora (apertar e soltar no fundo) fecha');

  // ---------- aviso (toast) ----------
  const toasts = await page.locator('.toasts').evaluate((t) => ({ live: t.getAttribute('aria-live') }));
  check(toasts.live === null, 'aviso: o container não é região viva (cada aviso já é alert/status, sem anúncio dobrado)', toasts);
  await page.screenshot({ path: `${SHOT}/a11y.png` });
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/a11y-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
