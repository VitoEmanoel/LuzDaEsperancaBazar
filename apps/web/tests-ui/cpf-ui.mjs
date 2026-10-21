/**
 * Teste de TELA, no navegador de verdade: a pergunta do CPF no primeiro item, o foco ao digitar, a máscara, a validação e o CPF mascarado na barra do PDV.
 * Prova o conserto do foco das janelas (o foco ia para o ✕ a cada tecla). NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   1. o `playwright-core` já é dependência de desenvolvimento do apps/web (`npm install` na raiz)
 *   2. dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/cpf-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}${a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label') + ']' : ''}${a.placeholder ? '[ph=' + a.placeholder + ']' : ''}` : 'nada'; });
try {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill('vendedor');
  await page.getByLabel('Senha', { exact: true }).fill('Vendedor@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/pdv/, { timeout: 15000 });
  // abrir caixa (a demonstração começa sem caixa aberto)
  await Promise.race([page.getByPlaceholder(/Passe o leitor/).waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await page.getByPlaceholder(/Passe o leitor/).waitFor({ timeout: 15000 });
  check(true, 'PDV aberto como Vendedor');

  // primeiro item da venda -> pergunta o CPF
  await page.getByPlaceholder(/Passe o leitor/).fill('BZ000006'); await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog');
  await modal.getByText('A compra é', { exact: false }).waitFor({ timeout: 5000 });
  check(true, 'a pergunta do CPF apareceu no primeiro item');
  check((await foco()).includes('BUTTON') && !(await foco()).includes('Fechar'), 'o foco inicial está no botão Sim (não no ✕)', await foco());
  await page.screenshot({ path: `${SHOT}/cpf-1-pergunta.png` });

  await page.getByRole('button', { name: /Sim, informar/ }).click();
  const campo = page.getByPlaceholder('000.000.000-00');
  await campo.waitFor({ timeout: 5000 });
  check((await foco()).includes('ph=000.000.000-00'), 'ao escolher Sim o foco vai para o campo do CPF', await foco());

  // digitar devagar, como uma pessoa: o foco NÃO pode sair do campo
  let saiu = null;
  for (const ch of '52998224725') {
    await page.keyboard.type(ch, { delay: 30 });
    const f = await foco();
    if (!f.includes('ph=000.000.000-00') && saiu === null) saiu = f;
  }
  check(saiu === null, 'o foco fica no campo durante toda a digitação do CPF', { foco_saiu_para: saiu });
  check((await campo.inputValue()) === '529.982.247-25', 'o campo ficou com o CPF completo e mascarado', await campo.inputValue());
  await page.screenshot({ path: `${SHOT}/cpf-2-digitado.png` });

  const confirmar = page.getByRole('button', { name: /Confirmar CPF/ });
  check(await confirmar.isEnabled(), 'o botão Confirmar CPF fica ativo com um CPF válido');
  await confirmar.click();
  await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  check((await page.getByRole('dialog').count()) === 0, 'a janela fecha depois de confirmar');
  check((await page.locator('.pdv-header').innerText()).includes('529.***.***-25'), 'a barra do PDV mostra o CPF mascarado', (await page.locator('.pdv-header').innerText()).slice(0, 200));
  check((await page.locator('.carrinho li').count()) === 1, 'o item que estava esperando entrou no carrinho', await page.locator('.carrinho li').count());
  await page.screenshot({ path: `${SHOT}/cpf-3-confirmado.png` });

  // CPF inválido não deixa seguir
  await page.getByRole('button', { name: /Trocar CPF/ }).click();
  await page.getByRole('button', { name: /Sim, informar/ }).click();
  await page.getByPlaceholder('000.000.000-00').fill('');
  await page.keyboard.type('12345678900', { delay: 20 });
  check(await page.getByRole('button', { name: /Confirmar CPF/ }).isDisabled(), 'CPF inválido deixa o Confirmar desligado');
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/cpf-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
