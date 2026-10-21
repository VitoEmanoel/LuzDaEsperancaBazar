/**
 * Teste de TELA dos ajustes da validação no PDV (S6-09 e S6-10), no navegador de verdade, sobre a demonstração (API simulada):
 *  - a venda por categoria saiu da tela;
 *  - o campo Qtd. ao lado do código: vale para o próximo bip, volta a 1 depois de lançar, fica como está num erro,
 *    o `n*código` manda mais que ele, Esc e Enter no campo, F2 e o celular;
 *  - acima do saldo (S6-11): lança o que há e avisa; peça única lança 1 e avisa; sem nada, avisa e não lança.
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/qtd-pdv-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 */
import { chromium } from 'playwright-core';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}[${(a.getAttribute('aria-label') || a.placeholder || a.className || '').slice(0, 40)}]` : 'nada'; });
const campo = () => page.getByLabel('Código de barras'); // pelo rótulo: no celular o placeholder é mais curto (S6-12)
const qtd = () => page.getByLabel('Qtd. (F2)');
const msg = () => page.locator('#msg-leitura').innerText();
const linhas = () => page.locator('.carrinho li').allInnerTexts();
async function ler(texto) { await campo().fill(texto); await campo().press('Enter'); await page.waitForTimeout(300); }

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

  // S6-09: a venda por categoria saiu da tela
  check(await page.getByText('Venda por categoria').count() === 0 && await page.locator('.cat-btn').count() === 0, 'a venda por categoria não aparece mais no PDV');
  check((await qtd().inputValue()) === '1', 'o Qtd. começa em 1', await qtd().inputValue());
  await page.screenshot({ path: `${SHOT}/qtd-1-tela.png` });

  // F2 leva ao Qtd.; Enter nele volta ao código sem ler nada
  await page.keyboard.press('F2');
  check((await foco()).includes('qtd'), 'F2 leva o foco ao Qtd.', await foco());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check((await foco()).includes('Passe o leitor') && (await msg()).trim() === '', 'Enter no Qtd. leva ao código e não lê nada', { foco: await foco(), msg: await msg() });

  // primeiro bip com Qtd. 3: a pergunta do CPF espera; "Não" lança 3 e o campo volta a 1
  await qtd().fill('3');
  await ler('BZ000006');
  await page.getByRole('dialog').getByRole('button', { name: /^Não/ }).click();
  await page.waitForTimeout(400);
  let l = await linhas();
  check(l.length === 1 && l[0].startsWith('3×') && /restam 3 no Bazar/.test(await msg()), 'Qtd. 3 + bip lança 3 canecas (depois da pergunta do CPF)', { l, msg: await msg() });
  check((await qtd().inputValue()) === '1', 'depois de lançar, o Qtd. volta a 1', await qtd().inputValue());

  // erro: o Qtd. fica como estava
  await qtd().fill('4');
  await ler('BZ999999');
  check(/não encontrado/.test(await msg()) && (await qtd().inputValue()) === '4', 'código que não existe: avisa e o Qtd. continua 4', { msg: await msg(), qtd: await qtd().inputValue() });
  // S6-11: peça única com Qtd. 3 lança 1 e avisa; acima do saldo lança o que há e avisa; o Qtd. volta a 1 (lançou)
  await qtd().fill('3');
  await ler('BZ000001');
  l = await linhas();
  check(l.length === 2 && l[1].startsWith('1×') && /Atenção: Jaqueta jeans é peça única\. Lancei 1 de 3/.test(await msg()) && (await qtd().inputValue()) === '1',
    'peça única com Qtd. 3 lança 1, avisa e o Qtd. volta a 1', { l, msg: await msg(), qtd: await qtd().inputValue() });
  check((await page.locator('#msg-leitura.aviso').count()) === 1, 'o aviso tem estilo próprio (nem ok nem erro)');
  await qtd().fill('7');
  await ler('BZ000006');
  check((await linhas())[0].startsWith('6×') && /Atenção: só restavam 3 de Caneca.*\(há 6, 3 já no carrinho\)\. Lancei 3 de 7/.test(await msg()) && (await qtd().inputValue()) === '1',
    'Qtd. 7 com só 3 no Bazar: lança 3, avisa e o Qtd. volta a 1', { msg: await msg(), l: await linhas() });
  await qtd().fill('2');
  await ler('BZ000006');
  check((await linhas())[0].startsWith('6×') && /Não resta Caneca/.test(await msg()) && (await qtd().inputValue()) === '2', 'sem nada no Bazar: avisa, não lança e o Qtd. fica', { msg: await msg(), qtd: await qtd().inputValue() });

  // `n*código` manda mais que o Qtd. (e também lança o que há: Copo tem 3)
  await qtd().fill('5');
  await ler('2*BZ000020');
  l = await linhas();
  check(l.some((x) => x.startsWith('2×') && /Copo/.test(x)) && (await qtd().inputValue()) === '1', '2*código com Qtd. 5 lança 2 (o n* manda) e o Qtd. volta a 1', { l, qtd: await qtd().inputValue() });
  await ler('4*BZ000020');
  l = await linhas();
  check(l.some((x) => x.startsWith('3×') && /Copo/.test(x)) && /só restavam 1 de Copo.*\(há 3, 2 já no carrinho\)\. Lancei 1 de 4/.test(await msg()), '4*código com só 1 restante: lança 1 e avisa', { l, msg: await msg() });

  // Esc no Qtd.: volta a 1 e leva ao código; com o campo vazio também, sem perguntar se tira item
  await qtd().fill('9');
  await qtd().focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check((await qtd().inputValue()) === '1' && (await foco()).includes('Passe o leitor'), 'Esc no Qtd. volta a 1 e leva ao código');
  await qtd().fill('');
  await qtd().focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog').count()) === 0 && (await qtd().inputValue()) === '1' && (await linhas())[0].startsWith('6×'), 'Esc no Qtd. vazio não pergunta nem tira item', { dialogos: await page.getByRole('dialog').count(), l: await linhas() });

  // Qtd. vazio ou 0 vale 1
  await qtd().fill('');
  await ler('BZ000023');
  l = await linhas();
  check(l.length === 4 && l[3].startsWith('1×') && /Livro/.test(l[3]), 'Qtd. vazio lança 1', l);

  // dois bips seguidos do mesmo produto acima do saldo (Panela, saldo 2): o segundo é recusado
  await qtd().fill('2');
  await campo().fill('BZ000021'); await campo().press('Enter');
  await campo().fill('BZ000021'); await campo().press('Enter');
  await page.waitForTimeout(500);
  l = await linhas();
  const panela = l.find((x) => /Panela/.test(x)) ?? '';
  check(panela.startsWith('2×'), 'dois bips seguidos da Panela (saldo 2, Qtd. 2 no primeiro): fica com 2, o segundo é recusado', { l, msg: await msg() });

  // celular: os dois campos cabem, sem rolar a página para o lado
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  const larg = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: innerWidth }));
  const caixaQtd = await qtd().boundingBox(), caixaCod = await campo().boundingBox();
  check(larg.doc <= larg.tela && caixaQtd && caixaCod && caixaCod.x + caixaCod.width <= 390, 'no celular (390 px) o Qtd. e o código cabem, sem rolar para o lado', { larg, caixaQtd, caixaCod });
  await page.screenshot({ path: `${SHOT}/qtd-2-celular.png` });
} catch (e) { console.log('ERRO DO TESTE:', e.message.split('\n')[0]); falhas++; await page.screenshot({ path: `${SHOT}/qtd-erro.png` }).catch(() => {}); }
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
