/**
 * Teste de TELA da Sprint 4, no navegador de verdade, sobre a demonstração (API simulada):
 *  - Estoque: linha por categoria explica que o preço é o da categoria; o Admin muda dali (botão com a categoria já escolhida).
 *  - PDV: `n*código`, "restam N", peça única, a confirmação do Esc (foco em Cancelar, S ou Shift+S tira, Esc cancela, S do leitor não vale) (S4-08, S4-09, S4-19);
 *  - Imprimir etiquetas: busca, quantidade, pré-visualização no tamanho do rolo, o papel em PDF (uma página de 50 x 30 mm
 *    por etiqueta) e o código de barras LIDO por um leitor de verdade (zbarimg) no PDF (S4-02 a S4-05).
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   1. o `playwright-core` já é dependência de desenvolvimento do apps/web (`npm install` na raiz)
 *   2. dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/sprint4-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 * A leitura do código no PDF usa `pdftoppm` e `zbarimg` (pacotes poppler e zbar); sem eles, essa conferência é pulada.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}[${(a.innerText || a.getAttribute('aria-label') || a.placeholder || '').slice(0, 30)}]` : 'nada'; });
const temProg = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`]); return true; } catch { return false; } };

async function entrar(usuario, senha) {
  await page.context().clearCookies();
  await page.goto(`${URL}/login`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill(usuario); await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}
const campo = () => page.getByPlaceholder('Passe o leitor ou digite e tecle Enter');
const msg = () => page.locator('#msg-leitura').innerText();
async function ler(texto) { await campo().fill(texto); await campo().press('Enter'); await page.waitForTimeout(250); }
const linhas = () => page.locator('.carrinho li').allInnerTexts();
// navegação dentro do app: na demonstração a sessão fica na memória e recarregar a página desloga
async function ir(caminho) { await page.evaluate((c) => { history.pushState({}, '', c); dispatchEvent(new PopStateEvent('popstate')); }, caminho); await page.waitForTimeout(700); }

try {
  // ---------------- PDV ----------------
  await entrar('vendedor', 'Vendedor@123');
  await Promise.race([page.getByPlaceholder(/Passe o leitor/).waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await campo().waitFor({ timeout: 15000 });

  await ler('2*BZ000006');
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click(); // primeiro bip: CPF
  await page.waitForTimeout(300);
  let l = await linhas();
  check(l.length === 1 && l[0].startsWith('2×') && /restam 4 no Bazar/.test(await msg()), '2*BZ000006 lança 2 canecas e mostra "restam 4"', { l, msg: await msg() });
  await ler('BZ000006');
  l = await linhas();
  check(l[0].startsWith('3×') && /3× Caneca.*R\$\s?7,00.*restam 3 no Bazar/.test(await msg()), 'bipar de novo soma 1 e mostra produto, preço e "restam 3"', { l, msg: await msg() });
  await ler('5*BZ000006');
  check((await linhas())[0].startsWith('6×') && /Atenção: só restavam 3 de Caneca.*\(há 6, 3 já no carrinho\)\. Lancei 3 de 5/.test(await msg()) && (await page.locator('#msg-leitura.aviso').count()) === 1,
    'acima do saldo lança o que há e avisa (S6-11)', { l: await linhas(), msg: await msg() });
  await ler('BZ000006');
  check((await linhas())[0].startsWith('6×') && /Não resta Caneca.*6 que havia já estão no carrinho/.test(await msg()), 'sem nada no Bazar: avisa e não lança', await msg());
  await ler('0*BZ000006');
  check(/quantidade vai de 1 a 999/.test(await msg()) && (await campo().inputValue()) === '0*BZ000006', 'quantidade zero avisa e o texto volta ao campo para corrigir', await msg());
  await page.keyboard.press('Escape');
  check((await campo().inputValue()) === '' && (await page.getByRole('dialog').count()) === 0, 'Esc com texto só limpa o campo (não pergunta nem tira item)');
  await ler('2*BZ000001');
  check((await linhas()).length === 2 && /Atenção: Jaqueta jeans é peça única\. Lancei 1 de 2/.test(await msg()), '2*código de peça única lança 1 e avisa (S6-11)', await msg());
  await ler('BZ000001');
  check((await linhas()).length === 2 && /já está no carrinho \(peça única\)/.test(await msg()), 'a mesma peça única de novo é recusada', await msg());

  // Esc com o campo vazio pergunta; o foco nasce em Cancelar, então o Enter do leitor não tira nada
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByText('Tirar o último item?').waitFor({ timeout: 5000 });
  check((await foco()).includes('Cancelar'), 'Esc com o campo vazio pergunta, com o foco em Cancelar', await foco());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0 && (await linhas()).length === 2, 'Enter (como o do leitor) cancela: nada sai do carrinho');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByText('Tirar o último item?').waitFor({ timeout: 5000 });
  await page.keyboard.type('BZ0', { delay: 10 }); // leitor digitando rápido: o S colado não vale (aqui nem há S, só confere que nada sai)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await linhas()).length === 2, 'Esc dentro da pergunta cancela e a digitação rápida do leitor não tira o item');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByText('Tirar o último item?').waitFor({ timeout: 5000 });
  await page.waitForTimeout(150);
  await page.keyboard.type('SB01', { delay: 10 }); // código que começa com S, na velocidade do leitor
  await page.waitForTimeout(300);
  check((await linhas()).length === 2, 'código que começa com S, digitado rápido, não tira o item', await linhas());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Remover último (Esc)' }).click();
  await page.getByRole('dialog').getByText('Tirar o último item?').waitFor({ timeout: 5000 });
  await page.waitForTimeout(150);
  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  l = await linhas();
  check(l.length === 1 && l[0].startsWith('6×'), 'o botão "Remover último" também pergunta; S tira a peça', l);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByText('Ficam 5 no carrinho').waitFor({ timeout: 5000 });
  await page.getByRole('dialog').getByRole('button', { name: /Sim, tirar 1/ }).click();
  await page.waitForTimeout(300);
  check((await linhas())[0]?.startsWith('5×'), 'linha com 6: tira só 1 (clique em "Sim, tirar 1")', await linhas());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByText('Ficam 4 no carrinho').waitFor({ timeout: 5000 });
  await page.waitForTimeout(150);
  await page.keyboard.press('Shift+S');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0 && !(await linhas())[0]?.startsWith('5×'), 'S maiúsculo (Shift + S) também tira', await linhas());
  await page.keyboard.press('F2');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0 && (await foco()).includes('Passe o leitor'), 'Esc no campo de quantidade volta a 1 e devolve o foco ao código', await foco());
  await page.screenshot({ path: `${SHOT}/s4-pdv.png` });

  // ---------------- Imprimir etiquetas ----------------
  await entrar('estoquista', 'Estoquista@123');
  const menuEtq = await page.getByRole('link', { name: 'Imprimir etiquetas' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(menuEtq, 'o Estoquista tem "Imprimir etiquetas" no menu');
  // o botão Etiqueta da linha do Estoque abre a tela já com aquele produto, pronto para imprimir
  await ir('/estoque');
  const etqLinha = page.getByRole('link', { name: 'Etiqueta', exact: true }).first();
  await etqLinha.waitFor({ timeout: 10000 });
  await etqLinha.click();
  await page.locator('.etiquetas-previa .etiqueta').first().waitFor({ timeout: 10000 }).catch(() => {});
  check((await page.getByLabel(/^Etiquetas de /).count()) === 1 && (await page.locator('.etiquetas-previa .etiqueta').count()) === 1,
    'Etiqueta no Estoque abre a tela já com o produto escolhido e a pré-visualização', page.url());
  await page.getByRole('button', { name: /^Tirar / }).click(); // a lista volta vazia para o resto do roteiro
  // linha por categoria: sem botão de preço do produto nem etiqueta, e diz por quê (o Estoquista não muda o preço da categoria)
  await ir('/estoque');
  const linhaCat = page.locator('tr', { hasText: 'Roupa adulto (lote 1)' });
  await linhaCat.waitFor({ timeout: 10000 });
  check(/Preço da categoria, sem etiqueta/.test(await linhaCat.innerText()) && !(await linhaCat.getByRole('link', { name: 'Etiqueta' }).count()) && !(await linhaCat.getByRole('button').count()),
    'linha por categoria explica "Preço da categoria, sem etiqueta" (Estoquista)', await linhaCat.innerText());
  await ir('/estoque/etiquetas');
  await ir('/estoque/etiquetas');
  await page.getByText(/Rolo de 50 × 30 mm/).waitFor({ timeout: 10000 });
  check(true, 'a tela mostra o tamanho do rolo (50 × 30 mm)');
  await page.getByLabel(/Buscar produto/).fill('Caneca');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Adicionar' }).first().click();
  const qtd = page.getByLabel(/Etiquetas de Caneca/);
  check((await qtd.inputValue()) === '6', 'ao adicionar, a quantidade sugerida é uma por unidade em estoque (6)', await qtd.inputValue());
  await qtd.fill('2');
  const previa = page.locator('.etiquetas-previa .etiqueta').first();
  const caixa = await previa.boundingBox();
  // 50 x 30 mm a 96 dpi = 189 x 113 px
  check(caixa && Math.abs(caixa.width - 189) < 3 && Math.abs(caixa.height - 113) < 3, 'pré-visualização no tamanho real do rolo', caixa);
  check(/Caneca branca/.test(await previa.innerText()) && /BZ000006/.test(await previa.innerText()) && /7,00/.test(await previa.innerText()), 'etiqueta com título, código e preço', await previa.innerText());
  await previa.screenshot({ path: `${SHOT}/s4-etiqueta.png` });

  // a impressão: o print() falha de propósito para o papel ficar na tela e virar PDF
  await page.evaluate(() => { window.print = () => { window.__imprimiu = (window.__imprimiu ?? 0) + 1; throw new Error('papel fica para o teste'); }; });
  await page.getByRole('button', { name: 'Imprimir 2 etiqueta(s)' }).click();
  await page.locator('.etiquetas-papel').waitFor({ state: 'attached', timeout: 5000 });
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__imprimiu) === 1 && (await page.locator('.etiquetas-papel .etiqueta').count()) === 2, 'Imprimir monta 2 etiquetas e chama a impressão');
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(`${SHOT}/s4-etiquetas.pdf`, pdf);
  if (temProg('pdfinfo')) {
    const info = execFileSync('pdfinfo', [`${SHOT}/s4-etiquetas.pdf`]).toString();
    const pags = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    const [w, h] = (/Page size:\s+([\d.]+) x ([\d.]+)/.exec(info) ?? []).slice(1).map(Number);
    // 50 x 30 mm = 141,7 x 85 pt
    check(pags === 2 && Math.abs(w - 141.7) < 1.5 && Math.abs(h - 85) < 1.5, 'o papel sai com uma página de 50 x 30 mm por etiqueta (nada do resto da tela)', { pags, w, h });
  } else console.log('  (pdfinfo ausente: tamanho do PDF não conferido)');
  if (temProg('pdftoppm') && temProg('zbarimg')) {
    execFileSync('pdftoppm', ['-r', '300', '-f', '1', '-l', '1', '-png', `${SHOT}/s4-etiquetas.pdf`, `${SHOT}/s4-etiqueta-papel`]);
    const lido = execFileSync('sh', ['-c', `zbarimg -q ${SHOT}/s4-etiqueta-papel*.png || true`]).toString().trim();
    check(lido === 'CODE-128:BZ000006', 'o leitor lê o código de barras da etiqueta impressa (Code 128, BZ000006)', lido);
  } else console.log('  (pdftoppm ou zbarimg ausente: leitura do código não conferida)');

  // o histórico do produto registra a impressão (S4-05)
  await ir('/estoque');
  await page.getByRole('link', { name: /Caneca de porcelana branca/ }).first().click();
  await page.getByText('Dados do produto').first().waitFor({ timeout: 10000 }); // não 'Histórico': o aviso da impressão também tem a palavra
  const textoProduto = await page.locator('body').innerText();
  // títulos em maiúsculas pelo CSS: compara sem diferenciar
  check(/Etiquetas impressas[\s\S]*2 etiqueta\(s\)/i.test(textoProduto), 'a tela do produto mostra a impressão no histórico', textoProduto.slice(-600));
  check(await page.getByRole('link', { name: 'Imprimir etiquetas' }).count() > 0, 'a tela do produto tem o atalho Imprimir etiquetas');

  // o Vendedor não imprime
  await entrar('vendedor', 'Vendedor@123');
  await ir('/estoque/etiquetas');
  check(!(await page.locator('.etiquetas-previa, input[aria-label^="Etiquetas de"]').count()) && !page.url().endsWith('/estoque/etiquetas') || /permissão|não tem acesso|Acesso negado/i.test(await page.locator('body').innerText()),
    'o Vendedor não abre a tela de etiquetas', page.url());

  // o Admin muda o preço da categoria direto da linha: a janela já abre com a categoria e o foco no preço
  await entrar('admin', 'Admin@123');
  await ir('/estoque');
  const linhaAdm = page.locator('tr', { hasText: 'Roupa adulto (lote 1)' });
  await linhaAdm.getByRole('button', { name: 'Preço da categoria Roupa adulto' }).click();
  const janela = page.getByRole('dialog');
  await janela.getByText('Preço padrão da categoria').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => (document.querySelector('[role=dialog] select')?.options.length ?? 0) > 1, null, { timeout: 5000 }); // as categorias chegam depois
  const escolhida = await janela.getByLabel('Categoria').evaluate((el) => el.options[el.selectedIndex].text);
  check(/^Roupa adulto/.test(escolhida) && /Novo preço/.test(await page.evaluate(() => document.activeElement?.closest('.field')?.innerText ?? '')),
    'Admin: "Preço da categoria" na linha abre a janela com a categoria escolhida e o foco no novo preço', escolhida);
  await janela.getByLabel(/Novo preço/).fill('12');
  await janela.getByLabel(/Motivo/).fill('Teste da Sprint 4');
  await janela.getByRole('button', { name: 'Salvar preço' }).click();
  await page.waitForTimeout(800);
  check(/R\$\s?12,00/.test(await linhaAdm.innerText()), 'o preço novo da categoria aparece na linha', await linhaAdm.innerText());
} catch (e) {
  falhas++;
  console.log('ERRO DO TESTE:', e.message.split('\n')[0]);
  await page.screenshot({ path: `${SHOT}/s4-erro.png` }).catch(() => {});
}
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
