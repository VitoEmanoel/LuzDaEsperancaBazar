/**
 * Teste de TELA, no navegador de verdade: troco no recebimento do fiado (S6-20), na demonstração (API simulada).
 *  - a janela separa "Valor a receber" (a dívida paga agora) de "Valor recebido" (o que o cliente entregou, só em dinheiro);
 *  - o troco aparece sobre a parte paga; recebido menor não deixa registrar; o recebido pode passar do saldo;
 *  - PIX e cartão não pedem o recebido; o extrato mostra o recebido e o troco.
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp CHROME=/usr/bin/google-chrome-stable node tests-ui/troco-fiado-ui.mjs`
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
  await page.getByLabel('Usuário').fill('admin'); await page.getByLabel('Senha', { exact: true }).fill('Admin@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(1500);
  await ir('/financeiro/receber');
  await page.getByRole('heading', { name: /Contas a receber/ }).waitFor({ timeout: 10000 });
  const linha = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'Receber' }) }).first();
  const cliente = (await linha.locator('td').first().innerText()).trim();
  await linha.getByRole('button', { name: 'Receber' }).click();
  const d = page.getByRole('dialog', { name: /Receber de/ });
  await d.waitFor({ timeout: 5000 });
  const saldo = (await d.getByLabel('Valor a receber (R$)').inputValue()).trim();
  check(/\d,\d\d$/.test(saldo), '"Valor a receber" vem com o saldo da conta', saldo);
  check((await d.getByLabel('Valor recebido (R$)').count()) === 1, 'em dinheiro, a janela pede o "Valor recebido"');
  const registrar = d.getByRole('button', { name: 'Registrar' });

  // parcial: R$ 5,00 da dívida com uma nota de R$ 10,00
  await d.getByLabel('Valor a receber (R$)').fill('5,00');
  await d.getByLabel('Valor recebido (R$)').fill('10,00');
  check(/Troco a devolver:\s*R\$\s?5,00/.test(await d.innerText()), 'parcial de R$ 5,00 com R$ 10,00: troco R$ 5,00 (sobre a parte paga)', await d.innerText());
  await d.getByLabel('Valor recebido (R$)').fill('4,00');
  check(/Menor que o valor a receber/.test(await d.innerText()) && (await registrar.isDisabled()), 'recebido menor: avisa e não deixa registrar');
  // o recebido pode passar do saldo
  await d.getByLabel('Valor a receber (R$)').fill(saldo);
  await d.getByLabel('Valor recebido (R$)').fill('999,00');
  check(!(await registrar.isDisabled()) && !/Maior que o saldo/.test(await d.innerText()), 'recebido acima do saldo é aceito (o que não pode passar do saldo é o valor a receber)');
  // PIX não tem troco
  await d.getByLabel('Forma de pagamento').selectOption('PIX');
  check((await d.getByLabel('Valor recebido (R$)').count()) === 0 && !/Troco a devolver/.test(await d.innerText()), 'em PIX, sem "Valor recebido" e sem troco');
  await d.getByLabel('Forma de pagamento').selectOption('DINHEIRO');
  await d.getByLabel('Valor a receber (R$)').fill('5,00');
  await d.getByLabel('Valor recebido (R$)').fill('10,00');
  await page.screenshot({ path: `${SHOT}/troco-fiado.png` });
  await registrar.click();
  await d.waitFor({ state: 'detached', timeout: 10000 });
  check(true, 'recebimento registrado');

  // o extrato mostra o recebido e o troco
  await page.getByLabel('Status').selectOption(''); await page.waitForTimeout(800); // parcial sai do filtro "Abertas"
  await page.getByRole('button', { name: cliente }).first().click();
  const ext = page.getByRole('dialog', { name: /Extrato/ });
  await ext.waitFor({ timeout: 5000 });
  await ext.getByText(/recebido R\$/).first().waitFor({ timeout: 8000 }).catch(() => {});
  check(/recebido R\$\s?10,00, troco R\$\s?5,00/.test(await ext.innerText()), 'o extrato mostra "recebido R$ 10,00, troco R$ 5,00"', (await ext.innerText()).slice(0, 600));
  await page.screenshot({ path: `${SHOT}/troco-fiado-extrato.png` });
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/troco-fiado-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
