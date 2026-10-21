/**
 * Teste de TELA da S6-13, no navegador de verdade, sobre a demonstração (API simulada): outro caixa vendeu antes e o
 * servidor recusou a venda por saldo; o PDV ajusta o carrinho sozinho ao que há agora e avisa.
 * "Outro caixa vendeu" é simulado mexendo no estoque da API simulada (ela vive na memória da aba) com o pagamento aberto.
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/estoque-mudou-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const campo = () => page.getByLabel('Código de barras');
const msg = () => page.locator('#msg-leitura').innerText();
const linhas = () => page.locator('.carrinho li').allInnerTexts();
async function ler(texto) { await campo().fill(texto); await campo().press('Enter'); await page.waitForTimeout(300); }
/** "Outro caixa vendeu": deixa o produto com `resta` unidades no Bazar da API simulada. */
const restar = (codigo, resta) => page.evaluate(async ({ codigo, resta }) => {
  const { db } = await import('/src/mocks/db.ts');
  const p = db.produtos.find((x) => x.codigo === codigo);
  let falta = resta;
  for (const i of db.itens.filter((x) => x.produtoId === p.id && x.status === 'APROVADO')) { const q = Math.min(i.saldo.BAZAR, falta); i.saldo.BAZAR = q; falta -= q; }
}, { codigo, resta });
async function pagarEConfirmar() {
  await page.keyboard.press('F4');
  const valor = page.getByPlaceholder('Digite quanto recebeu');
  await valor.waitFor({ timeout: 5000 });
  // digita como o operador (tecla por tecla): o `fill` do Playwright troca o valor por dentro e às vezes se perdia numa nova renderização da janela
  await valor.click();
  await valor.pressSequentially('500', { delay: 40 });
  await page.getByRole('button', { name: /Finalizar venda/ }).waitFor({ state: 'visible' });
}
const finalizar = () => page.getByRole('button', { name: /Finalizar venda/ }).click();

try {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill('vendedor'); await page.getByLabel('Senha', { exact: true }).fill('Vendedor@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/pdv/, { timeout: 15000 });
  await Promise.race([campo().waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await campo().waitFor({ timeout: 15000 });

  // (a) 5 canecas e a jaqueta; com o pagamento aberto, "outro caixa" leva 3 canecas e a jaqueta
  await ler('5*BZ000006');
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click();
  await page.waitForTimeout(300);
  await ler('BZ000001');
  await pagarEConfirmar();
  await restar('BZ000006', 3); await restar('BZ000001', 0);
  await finalizar();
  await page.waitForTimeout(800);
  let l = await linhas();
  check((await page.getByRole('dialog').count()) === 0, 'a venda recusada fecha o pagamento');
  check(l.length === 1 && l[0].startsWith('3×') && /Caneca/.test(l[0]), 'o carrinho foi ajustado: 3 canecas, a jaqueta saiu', l);
  check(/Atenção: o estoque mudou e a venda não foi gravada\. Ajustei o carrinho ao que há agora: Caneca de porcelana branca 5 → 3; Jaqueta jeans saiu\. Confira o total/.test(await msg())
    && (await page.locator('#msg-leitura.aviso').count()) === 1, 'o aviso diz o que mudou', await msg());
  await page.screenshot({ path: `${SHOT}/s613-ajustado.png` });

  // (e) recusa de novo antes de pagar: ajusta só o que mudou nesta rodada
  await pagarEConfirmar();
  await restar('BZ000006', 2);
  await finalizar();
  await page.waitForTimeout(800);
  l = await linhas();
  check(l.length === 1 && l[0].startsWith('2×') && /Caneca de porcelana branca 3 → 2\. Confira/.test(await msg()), 'segunda recusa: ajusta de novo (3 → 2) e diz só o que mudou agora', { l, msg: await msg() });

  // depois do ajuste, a venda grava normalmente (id novo)
  await pagarEConfirmar();
  await finalizar();
  const ok = await page.getByRole('dialog').getByText('Venda concluída').waitFor({ timeout: 8000 }).then(() => true, () => false);
  check(ok, 'com o carrinho ajustado, a venda é gravada');
  if (ok) { await page.keyboard.press('Enter'); await page.waitForTimeout(400); }

  // (c) nada resta: o carrinho fica vazio e o aviso diz isso
  await ler('BZ000002');
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click().catch(() => {});
  await page.waitForTimeout(300);
  await pagarEConfirmar();
  await restar('BZ000002', 0);
  await finalizar();
  await page.waitForTimeout(800);
  check((await linhas()).length === 0 && /Nada do carrinho resta no Bazar \(Vestido de festa saiu\)/.test(await msg()), 'nada resta: carrinho vazio e aviso', { l: await linhas(), msg: await msg() });
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/s613-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
