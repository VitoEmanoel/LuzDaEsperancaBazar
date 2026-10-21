/**
 * Teste de TELA, no navegador de verdade: fechamento às cegas e definitivo (S6-19), na demonstração (API simulada).
 *  - antes de fechar, a tela não mostra o esperado nem a gaveta; a confirmação repete o valor contado;
 *  - o caixa fecha na hora e só então aparecem o esperado e a diferença, com o pedido de justificativa;
 *  - quem sai sem justificar vê o aviso no Início até responder; justificado, o aviso some.
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp CHROME=/usr/bin/google-chrome-stable node tests-ui/cegas-ui.mjs`
 * A API simulada guarda tudo na memória da página: o roteiro navega sem recarregar.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const ir = (r) => page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, r);
try {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill('vendedor'); await page.getByLabel('Senha', { exact: true }).fill('Vendedor@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/pdv/, { timeout: 15000 });
  await Promise.race([page.getByPlaceholder(/Passe o leitor/).waitFor({ timeout: 15000 }), page.getByRole('heading', { name: /Abrir caixa/ }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    const sel = page.locator('select');
    if (await sel.count()) await sel.selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await page.getByPlaceholder(/Passe o leitor/).waitFor({ timeout: 15000 });
  check((await page.getByRole('button', { name: 'Total do caixa' }).count()) === 0, 'PDV sem o botão "Total do caixa"');

  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  await page.getByRole('heading', { name: 'Fechamento de caixa' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const antes = await page.locator('.card.fechamento').innerText();
  check(!/esperad|gaveta agora|Fundo de troco|Vendas —/i.test(antes.replace('O esperado e a diferença aparecem depois de fechar', '')), 'antes de fechar: sem esperado, sem gaveta e sem totais', antes);
  await page.getByLabel('Dinheiro contado na gaveta (R$)').fill('1,00');
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const conf = page.getByRole('dialog', { name: 'Confirmar o fechamento' });
  await conf.waitFor({ timeout: 5000 });
  check(/R\$\s?1,00/.test(await conf.innerText()) && /não dá para mudar/.test(await conf.innerText()), 'a confirmação repete o valor contado e avisa que não dá para mudar', await conf.innerText());
  await conf.getByRole('button', { name: 'Voltar e contar de novo' }).click();
  check((await page.getByRole('dialog').count()) === 0 && (await page.getByRole('heading', { name: 'Fechamento de caixa' }).count()) === 1, '"Voltar e contar de novo" não fecha o caixa');
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  await conf.getByRole('button', { name: 'Confirmar e fechar' }).click();
  await page.getByRole('heading', { name: 'Caixa fechado' }).waitFor({ timeout: 10000 });
  const depois = await page.locator('.card.fechamento').innerText();
  check(/Esperado:/.test(depois) && /Diferença:/.test(depois), 'depois de fechar: aparecem o esperado e a diferença', depois.slice(0, 300));
  check((await page.getByLabel('Justificativa da diferença (obrigatória)').count()) === 1, 'com diferença, a justificativa é pedida logo em seguida');
  await page.screenshot({ path: `${SHOT}/cegas-fechado.png`, fullPage: true });

  // sai sem justificar: o aviso aparece no Início
  await page.getByRole('link', { name: 'Ir para o início' }).click();
  const aviso = page.getByRole('region', { name: 'Justificativa de caixa pendente' });
  await aviso.waitFor({ timeout: 10000 });
  check(/fechou com diferença/.test(await aviso.innerText()), 'no Início, o aviso "fechou com diferença... Justifique."', await aviso.innerText());
  await aviso.getByLabel('Justificativa da diferença (obrigatória)').fill('ok');
  check(await aviso.getByRole('button', { name: 'Enviar justificativa' }).isDisabled(), 'justificativa curta não envia');
  await aviso.getByLabel('Justificativa da diferença (obrigatória)').fill('Contei só as notas, esqueci as moedas');
  await aviso.getByRole('button', { name: 'Enviar justificativa' }).click();
  await aviso.waitFor({ state: 'detached', timeout: 10000 });
  check(true, 'justificado, o aviso some');
  await ir('/pdv'); await page.waitForTimeout(800); await ir('/'); await page.waitForTimeout(1200);
  check((await page.getByRole('region', { name: 'Justificativa de caixa pendente' }).count()) === 0, 'voltando ao Início, o aviso não reaparece');
  await page.screenshot({ path: `${SHOT}/cegas-inicio.png`, fullPage: true });
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/cegas-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
