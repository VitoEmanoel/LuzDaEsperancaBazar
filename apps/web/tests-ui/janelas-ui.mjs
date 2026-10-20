/**
 * Teste de TELA, no navegador de verdade: as janelas do PDV (CPF Não, tirar por quantidade, pagamento com troco, comprovante, sangria, total do caixa) e onde fica o foco em cada uma.
 * Prova o conserto do foco das janelas (o foco ia para o ✕ a cada tecla). NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   1. o `playwright-core` já é dependência de desenvolvimento do apps/web (`npm install` na raiz)
 *   2. dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/janelas-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}${a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label') + ']' : ''}${a.placeholder ? '[ph=' + a.placeholder + ']' : ''}${a.innerText ? '[' + a.innerText.slice(0, 25) + ']' : ''}` : 'nada'; });
const dentro = async () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
try {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill('vendedor'); await page.getByLabel('Senha', { exact: true }).fill('Vendedor@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/pdv/, { timeout: 15000 });
  await Promise.race([page.locator('.cat-btn').first().waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await page.locator('.cat-btn').first().waitFor({ timeout: 15000 });

  // primeiro item: responde "Não" ao CPF (atalho do botão)
  await page.locator('.cat-btn').first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click();
  await page.locator('.carrinho li').first().waitFor({ timeout: 5000 });
  check(true, 'CPF: botão "Não" segue a venda sem CPF e o item entra no carrinho');
  await page.locator('.cat-btn').first().click(); // 2º item da mesma categoria: não pergunta de novo
  check((await page.getByRole('dialog').count()) === 0, 'o segundo item da mesma venda não pergunta o CPF de novo');

  // tirar por quantidade: ✕ da linha com 2 unidades abre a janela com o foco no campo
  await page.locator('.carrinho li button').first().click();
  await page.getByRole('dialog').getByText('Quantas unidades tirar').waitFor({ timeout: 5000 });
  check((await foco()).includes('INPUT'), 'tirar por quantidade: o foco está no campo', await foco());
  await page.keyboard.type('1', { delay: 20 });
  await page.getByRole('dialog').getByRole('button', { name: /^Tirar 1/ }).click();
  check((await page.locator('.carrinho li').first().innerText()).startsWith('1×'), 'tirar 1 de 2 deixa 1 unidade no carrinho', (await page.locator('.carrinho li').first().innerText()).slice(0, 30));

  // pagamento: foco no valor recebido; digitar vários dígitos mantém o foco
  await page.getByRole('button', { name: /Pagamento \(F4\)/ }).click();
  await page.getByRole('dialog').getByText('Total').first().waitFor({ timeout: 5000 });
  await page.getByPlaceholder('Digite quanto recebeu').waitFor({ timeout: 5000 });
  check((await foco()).includes('ph=Digite quanto recebeu'), 'pagamento: o foco está no valor recebido (sem passar por outro botão)', await foco());
  let saiu = null;
  for (const ch of '100') { await page.keyboard.type(ch, { delay: 30 }); if (!(await foco()).includes('ph=Digite quanto recebeu') && saiu === null) saiu = await foco(); }
  check(saiu === null, 'pagamento: digitar o valor não tira o foco do campo', { saiu });
  check((await page.getByText(/Troco a devolver/).innerText()).includes('R$'), 'pagamento: mostra o troco de uma nota de R$ 100 numa conta de R$ 10', await page.getByText(/Troco a devolver/).innerText().catch(() => 'sem troco'));
  await page.screenshot({ path: `${SHOT}/janela-pagamento.png` });
  await page.getByRole('button', { name: /Finalizar venda/ }).click();
  await page.getByRole('dialog').getByText('Venda concluída').waitFor({ timeout: 8000 });
  check((await foco()).includes('Nova venda'), 'comprovante: o foco está em "Nova venda"', await foco());
  await page.keyboard.press('Enter');
  check((await page.getByRole('dialog').count()) === 0, 'Enter em "Nova venda" fecha o comprovante');

  // sangria: foco no valor, digitação mantém o foco; mostra o dinheiro da gaveta
  await page.getByRole('button', { name: /Sangria\/Suprimento/ }).click();
  await page.getByRole('dialog').getByText('Dinheiro na gaveta agora').waitFor({ timeout: 5000 });
  check((await foco()).includes('INPUT'), 'sangria: o foco está no campo do valor', await foco());
  await page.keyboard.type('12', { delay: 30 });
  check((await foco()).includes('INPUT') && await dentro(), 'sangria: digitar não tira o foco do campo', await foco());
  await page.keyboard.press('Escape');
  check((await page.getByRole('dialog').count()) === 0, 'Esc fecha a janela da sangria');

  // total do caixa abre e fecha
  await page.getByRole('button', { name: 'Total do caixa' }).click();
  await page.getByRole('dialog').getByText('Total do caixa agora').waitFor({ timeout: 5000 });
  check(await dentro(), 'total do caixa: o foco está dentro da janela', await foco());
  await page.keyboard.press('Escape');
  check((await page.getByRole('dialog').count()) === 0, 'Esc fecha o total do caixa');
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/janelas-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
