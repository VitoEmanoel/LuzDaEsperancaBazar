/**
 * Teste de TELA, no navegador de verdade (Sprint 2): Novo lote com parceiro obrigatório e criado na hora,
 * cadastro de produto novo e de nova entrada, devolução e aprovação pelo Administrador, correção pelo estoquista
 * e o PDV somando as unidades de um produto bipado de novo. NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   1. numa pasta FORA do projeto: `npm init -y && npm i playwright-core`
 *   2. copie este arquivo para lá e rode: `URL=http://localhost:5174 SHOT=/tmp node produto-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243 (ajuste o caminho se a versão for outra,
 * ou use CHROME=/usr/bin/google-chrome-stable).
 * A demonstração guarda tudo na memória da aba: o teste nunca recarrega a página (só navega pelos links).
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
const CHROME = process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const naJanela = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]') && ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName));

async function entrar(usuario, senha) {
  await page.getByLabel('Usuário').fill(usuario); await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  if (usuario === 'vendedor') await page.waitForURL(/\/pdv/, { timeout: 15000 }); // o PDV é tela cheia, sem o menu
  else await page.getByRole('button', { name: 'Sair' }).waitFor({ timeout: 15000 });
}
async function sair() { await page.getByRole('button', { name: 'Sair' }).click(); await page.getByLabel('Usuário').waitFor({ timeout: 10000 }); }
async function abrirLote(numero) {
  await page.getByRole('link', { name: 'Lotes de entrada' }).click();
  await page.getByRole('row', { name: new RegExp(`#${numero}\\b`) }).getByRole('link').click();
  await page.getByRole('heading', { name: new RegExp(`Lote #${numero}`) }).waitFor({ timeout: 10000 });
}
const linha = (texto) => page.getByRole('row', { name: new RegExp(texto) });

try {
  await page.goto(`${URL}/login`);
  await entrar('estoquista', 'Estoquista@123');

  // ---------- Novo lote (S2-12) ----------
  await page.getByRole('link', { name: 'Lotes de entrada' }).click();
  await page.getByRole('link', { name: '+ Novo lote' }).click();
  const criarLote = page.getByRole('button', { name: 'Criar lote e cadastrar produtos' });
  await criarLote.waitFor({ timeout: 10000 });
  check(await criarLote.isDisabled(), 'sem parceiro o lote não pode ser criado');
  await page.getByRole('button', { name: '+ Novo parceiro' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  check(await naJanela(), 'a janela do novo parceiro abre com o foco no nome');
  await page.keyboard.type('Dona Teste da Silva', { delay: 15 });
  check(await naJanela(), 'o foco fica no nome enquanto digita');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar parceiro' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
  const escolhido = await page.getByLabel(/Parceiro \/ doador/).evaluate((el) => el.options[el.selectedIndex]?.text);
  check(escolhido === 'Dona Teste da Silva', 'o parceiro criado já fica escolhido', escolhido);
  check(!(await criarLote.isDisabled()), 'com parceiro o lote pode ser criado');
  await criarLote.click();
  const titulo = page.getByRole('heading', { name: /Lote #\d+ — cadastro de produtos/ });
  await titulo.waitFor({ timeout: 10000 });
  const numero = (await titulo.innerText()).match(/#(\d+)/)[1];
  check(true, `lote #${numero} criado e a tela de cadastro abriu`);

  // ---------- Cadastrar produtos do lote (S2-13) ----------
  const cad = page.locator('.col-aprovar'); // o cartão "Cadastrar"
  await cad.locator('select').first().selectOption({ label: 'Utensílios' });
  await page.getByLabel('Título da etiqueta (curto)').fill('Jarra azul');
  await page.getByLabel('Nome do produto').fill('Jarra de vidro azul');
  await page.getByLabel('Preço de venda (R$)').fill('12,50');
  await cad.getByLabel('Quantidade').fill('3');
  await page.getByLabel('Valor atribuído (unitário, R$)').fill('4');
  await page.getByRole('button', { name: 'Cadastrar (aguarda aprovação)' }).click();
  await linha('Jarra de vidro azul').waitFor({ timeout: 10000 });
  check(await linha('Jarra de vidro azul').getByText('Aguardando aprovação').isVisible(), 'produto novo cadastrado aguardando aprovação');
  check((await linha('Jarra de vidro azul').innerText()).match(/BZ\d{6}/) !== null, 'o produto ganhou um código BZ');
  check((await page.getByRole('button', { name: /Aprovar lote/ }).count()) === 0, 'o estoquista não vê o botão de aprovar');

  await page.getByLabel('Produto que já existe').check();
  await page.getByLabel('Buscar produto (código ou nome)').fill('caneca');
  await page.getByRole('button', { name: /BZ000006 — Caneca/ }).click();
  await cad.getByLabel('Quantidade').fill('2');
  await page.getByLabel('Valor atribuído (unitário, R$)').fill('1,50');
  await page.getByRole('button', { name: 'Cadastrar (aguarda aprovação)' }).click();
  await linha('Caneca de porcelana').waitFor({ timeout: 10000 });
  check((await linha('Caneca de porcelana').innerText()).includes('BZ000006'), 'nova entrada do produto que já existe usa o mesmo código');
  const pend = await page.locator('.contadores .card', { hasText: 'Aguardando aprovação' }).locator('strong').innerText();
  check(pend === '2', 'o contador mostra 2 itens aguardando aprovação', pend);
  await page.screenshot({ path: `${SHOT}/s2-cadastro-estoquista.png`, fullPage: true });
  await sair();

  // ---------- Administrador: devolve um item e aprova o outro (S2-09) ----------
  await entrar('admin', 'Admin@123');
  await abrirLote(numero);
  check(await page.getByRole('button', { name: 'Aprovar lote (2)' }).isVisible(), 'o Administrador vê "Aprovar lote (2)"');
  await linha('Jarra de vidro azul').getByRole('button', { name: 'Devolver' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  check(await naJanela(), 'a janela de devolução abre com o foco no motivo');
  await page.keyboard.type('Confira a quantidade de jarras', { delay: 10 });
  await page.getByRole('dialog').getByRole('button', { name: 'Devolver' }).click();
  await linha('Jarra de vidro azul').getByText('Devolvido').waitFor({ timeout: 10000 });
  check(await linha('Jarra de vidro azul').getByText('Confira a quantidade de jarras').isVisible(), 'o item devolvido mostra o motivo');
  await page.getByRole('button', { name: 'Aprovar lote (1)' }).click();
  await linha('Caneca de porcelana').getByText('Aprovado').waitFor({ timeout: 10000 });
  const noEstoque = await page.locator('.contadores .card', { hasText: 'No estoque' }).locator('strong').innerText();
  check(noEstoque === '2', 'aprovar o lote põe as 2 canecas no estoque (o devolvido fica de fora)', noEstoque);
  await page.screenshot({ path: `${SHOT}/s2-aprovacao-admin.png`, fullPage: true });
  await sair();

  // ---------- Estoquista corrige e reenvia ----------
  await entrar('estoquista', 'Estoquista@123');
  await abrirLote(numero);
  await linha('Jarra de vidro azul').getByRole('button', { name: 'Corrigir e reenviar' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  check(await page.getByRole('dialog').getByText('Motivo da devolução: Confira a quantidade de jarras').isVisible(), 'a correção mostra o motivo da devolução');
  await page.getByRole('dialog').getByLabel('Quantidade').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Corrigir e reenviar' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
  await linha('Jarra de vidro azul').getByText('Aguardando aprovação').waitFor({ timeout: 10000 });
  check((await linha('Jarra de vidro azul').innerText()).includes('\t2\t') || (await linha('Jarra de vidro azul').locator('td').nth(2).innerText()) === '2', 'corrigido para 2 e de volta à aprovação');
  await sair();

  // ---------- PDV: o mesmo produto bipado de novo soma uma unidade ----------
  await entrar('vendedor', 'Vendedor@123');
  await Promise.race([page.locator('.cat-btn').first().waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.locator('.cat-btn').first().waitFor({ timeout: 15000 });
  }
  const bip = async (c) => { await page.getByPlaceholder(/Passe o leitor/).fill(c); await page.keyboard.press('Enter'); };
  await bip('BZ000006');
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click();
  await page.locator('.carrinho li').first().waitFor({ timeout: 5000 });
  await bip('BZ000006');
  await page.waitForTimeout(300);
  const carrinho = await page.locator('.carrinho li').first().innerText();
  check((await page.locator('.carrinho li').count()) === 1 && /2\s*×/.test(carrinho), 'o mesmo produto bipado duas vezes vira 2 unidades na mesma linha', carrinho);
  await bip('BZ000001');
  await bip('BZ000001');
  await page.waitForTimeout(300);
  check((await page.locator('.carrinho li').count()) === 2, 'peça única bipada de novo não entra duas vezes');
  await page.screenshot({ path: `${SHOT}/s2-pdv-produto.png` });
} catch (e) {
  falhas++; console.log('✘ erro no roteiro:', e.message.split('\n')[0]);
  await page.screenshot({ path: `${SHOT}/s2-erro.png`, fullPage: true }).catch(() => {});
}
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
