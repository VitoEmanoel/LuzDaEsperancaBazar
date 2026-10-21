/**
 * Teste de TELA da leitura pela câmera (S5-12), no navegador de verdade, sobre a demonstração (API simulada).
 * A "webcam" é um vídeo falso do Chromium (`--use-file-for-fake-video-capture`) com a etiqueta do produto BZ000006
 * desenhada pelo próprio gerador do sistema (Code 128) e, num segundo vídeo, a mesma etiqueta em Code 39 (as antigas).
 *  - PDV: lê pela câmera, pergunta o CPF no primeiro bip e lança 1 unidade só (a câmera vê o mesmo quadro várias vezes);
 *  - Estoque: o código lido preenche a busca e filtra a lista; a etiqueta antiga (Code 39) também é lida;
 *  - a câmera desliga ao ler e ao cancelar; permissão negada mostra a mensagem; sem câmera o botão não aparece.
 * NÃO faz parte do build nem de nenhum script do projeto.
 *
 * Como rodar (a demonstração precisa estar no ar: `VITE_USE_MOCK=true npx vite --port 5174`, dentro de apps/web):
 *   1. o `playwright-core` já é dependência de desenvolvimento do apps/web (`npm install` na raiz)
 *   2. dentro de apps/web: `URL=http://localhost:5174 SHOT=/tmp node tests-ui/camera-ui.mjs`
 * Usa o Chromium que o Playwright já baixou em ~/.cache/ms-playwright/chromium-1243, ou o do sistema com CHROME=/usr/bin/google-chrome-stable.
 * Os vídeos falsos são gravados em SHOT (camera-128.y4m e camera-39.y4m).
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:5174';
const SHOT = process.env.SHOT ?? '/tmp';
const CHROME = process.env.CHROME ?? process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const CODIGO = 'BZ000006'; // Caneca branca: várias unidades no Bazar da demonstração
let falhas = 0;
const check = (ok, nome, extra) => { console.log(`${ok ? '✔' : '✘'} ${nome}`, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) falhas++; };

// Code 39 (etiquetas antigas): 9 elementos por caractere, começando por barra; 1 = largo (3 módulos), 0 = estreito
const C39 = { '*': '010010100', B: '001001001', Z: '011010000', 0: '000110100', 6: '001110000' };
const modulos39 = (t) => [...`*${t}*`].map((c) => [...C39[c]].map((w, i) => (i % 2 ? '0' : '1').repeat(w === '1' ? 3 : 1)).join('') + '0').join('');

const W = 640, H = 480;
/** Desenha a etiqueta num canvas da própria demonstração (o gerador Code 128 é o do sistema) e devolve a luminância (Y). */
async function quadro(navegador, tipo) {
  const pg = await navegador.newPage();
  await pg.goto(`${URL}/login`);
  const y = await pg.evaluate(async ({ tipo, codigo, m39, W, H }) => {
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (tipo === '128') {
      const { code128Svg } = await import('/src/shared/lib/barcode.ts');
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(code128Svg(codigo).replace('<svg ', `<svg width="${W - 40}" height="220" `));
      await img.decode();
      ctx.drawImage(img, 20, 110, W - 40, 220);
    } else {
      const largura = Math.floor((W - 40) / m39.length);
      ctx.fillStyle = '#000';
      [...m39].forEach((b, i) => { if (b === '1') ctx.fillRect(20 + i * largura, 110, largura, 220); });
    }
    const d = ctx.getImageData(0, 0, W, H).data;
    return Array.from({ length: W * H }, (_, i) => Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]));
  }, { tipo, codigo: CODIGO, m39: modulos39(CODIGO), W, H });
  await pg.close();
  return Buffer.from(y);
}
/** Vídeo y4m (4:2:0) de um quadro só: o Chromium repete o quadro para sempre. */
function gravarY4m(caminho, luma) {
  const croma = Buffer.alloc((W / 2) * (H / 2), 128);
  writeFileSync(caminho, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\nFRAME\n`), luma, croma, croma]));
}

// guarda as câmeras abertas pela página para conferir que todas desligaram
const espiao = () => {
  window.__trilhas = [];
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => { const s = await original(c); window.__trilhas.push(...s.getTracks()); return s; };
};
const desligadas = (page) => page.evaluate(() => window.__trilhas.length > 0 && window.__trilhas.every((t) => t.readyState === 'ended'));

async function entrar(page, usuario, senha) {
  await page.goto(`${URL}/login`);
  await page.getByLabel('Usuário').fill(usuario); await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  if (usuario === 'vendedor') await page.waitForURL(/\/pdv/, { timeout: 15000 });
  else await page.getByRole('button', { name: 'Sair' }).waitFor({ timeout: 15000 });
}
/** Navega sem recarregar (recarregar desloga na demonstração). */
const ir = (page, rota) => page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, rota);
const camera = (video) => chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });

const base = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
gravarY4m(`${SHOT}/camera-128.y4m`, await quadro(base, '128'));
gravarY4m(`${SHOT}/camera-39.y4m`, await quadro(base, '39'));
await base.close();

let nav = await camera(`${SHOT}/camera-128.y4m`);
try {
  // ---------- PDV ----------
  let ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  await ctx.addInitScript(espiao);
  let page = await ctx.newPage();
  await entrar(page, 'vendedor', 'Vendedor@123');
  await Promise.race([page.locator('.cat-btn').first().waitFor({ timeout: 15000 }), page.getByRole('heading', { name: 'Abrir caixa' }).waitFor({ timeout: 15000 })]);
  if (page.url().includes('/pdv/abrir')) {
    await page.locator('select').selectOption({ index: 1 });
    await page.getByLabel(/Saldo inicial/).fill('50');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.waitForURL(/\/pdv$/, { timeout: 15000 });
  }
  await page.locator('.cat-btn').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Ler pela câmera' }).click();
  await page.getByRole('dialog', { name: /Ler pela câmera/ }).waitFor({ timeout: 5000 });
  check(true, 'PDV: a janela da câmera abre');
  // o código lido segue como um bip: no primeiro item da venda, a pergunta do CPF
  await page.getByRole('dialog').getByText('A compra é', { exact: false }).waitFor({ timeout: 20000 });
  check(true, 'PDV: o código foi lido e o primeiro bip pergunta o CPF');
  check(await page.getByRole('dialog').count() === 1, 'PDV: a janela da câmera fechou antes da pergunta do CPF (uma janela só)', await page.getByRole('dialog').count());
  check(await desligadas(page), 'PDV: a câmera desligou depois da leitura');
  await page.screenshot({ path: `${SHOT}/camera-1-cpf.png` });
  await page.getByRole('button', { name: /Não/ }).click();
  await page.locator('ul.carrinho li').first().waitFor({ timeout: 5000 });
  const linhas = await page.locator('ul.carrinho li').allInnerTexts();
  check(linhas.length === 1 && linhas[0].includes(CODIGO) && linhas[0].startsWith('1×'), 'PDV: o carrinho tem 1 unidade da caneca (a leitura não se repetiu)', linhas);
  check(/Caneca.*restam 5 no Bazar/.test(await page.locator('#msg-leitura').innerText()), 'PDV: a mensagem mostra o produto, o preço e "restam N"', await page.locator('#msg-leitura').innerText());
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-describedby') === 'msg-leitura'), 'PDV: o foco volta ao campo do código (o leitor USB continua funcionando)');
  await page.keyboard.press('F2');
  check(await page.evaluate(() => document.activeElement?.classList.contains('qtd')), 'PDV: os atalhos voltam a valer depois da câmera (F2)');
  // cancelar com a câmera abrindo: ela desliga
  await page.evaluate(() => { window.__trilhas = []; });
  await page.getByRole('button', { name: 'Ler pela câmera' }).click();
  await page.getByRole('dialog').getByText(/Aponte a câmera|Abrindo a câmera/).waitFor({ timeout: 5000 });
  await page.keyboard.press('F4');
  check(await page.getByRole('dialog', { name: /Pagamento/ }).count() === 0, 'PDV: com a câmera aberta, F4 não abre o pagamento');
  await page.getByRole('dialog').getByRole('button', { name: /Cancelar/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => window.__trilhas.every((t) => t.readyState === 'ended')), 'PDV: cancelar desliga a câmera');
  check((await page.locator('ul.carrinho li').count()) === 1, 'PDV: cancelar não lança nada');
  await ctx.close();

  // ---------- Estoque (Code 128) ----------
  ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  await ctx.addInitScript(espiao);
  page = await ctx.newPage();
  await entrar(page, 'estoquista', 'Estoquista@123');
  await ir(page, '/estoque');
  await page.getByRole('heading', { name: 'Estoque' }).waitFor({ timeout: 10000 });
  await page.locator('table.table tbody tr').first().waitFor({ timeout: 10000 });
  const antes = await page.locator('table.table tbody tr').count();
  await page.getByRole('button', { name: 'Ler pela câmera' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 });
  check((await page.getByLabel('Buscar (descrição ou código)').inputValue()) === CODIGO, 'Estoque: o código lido preenche a busca');
  await page.waitForFunction((c) => { const tr = [...document.querySelectorAll('table.table tbody tr')]; return tr.length > 0 && tr.every((x) => x.innerText.includes(c)); }, CODIGO, { timeout: 10000 }).catch(() => {});
  const depois = await page.locator('table.table tbody tr').allInnerTexts();
  check(depois.length >= 1 && depois.length < antes && depois.every((t) => t.includes(CODIGO)), 'Estoque: a lista filtra pelo código lido', { antes, depois: depois.length });
  check(await desligadas(page), 'Estoque: a câmera desligou depois da leitura');
  await page.screenshot({ path: `${SHOT}/camera-2-estoque.png` });
  await ctx.close();
  await nav.close();

  // ---------- etiqueta antiga (Code 39) ----------
  nav = await camera(`${SHOT}/camera-39.y4m`);
  ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  page = await ctx.newPage();
  await entrar(page, 'estoquista', 'Estoquista@123');
  await ir(page, '/estoque');
  await page.getByRole('button', { name: 'Ler pela câmera' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  check((await page.getByLabel('Buscar (descrição ou código)').inputValue()) === CODIGO, 'Estoque: a etiqueta antiga (Code 39) também é lida', await page.getByLabel('Buscar (descrição ou código)').inputValue());
  await ctx.close();

  // ---------- permissão negada e aparelho sem câmera ----------
  ctx = await nav.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negado', 'NotAllowedError')); });
  page = await ctx.newPage();
  await entrar(page, 'estoquista', 'Estoquista@123');
  await ir(page, '/estoque');
  await page.getByRole('button', { name: 'Ler pela câmera' }).click();
  const alerta = page.getByRole('dialog').getByRole('alert');
  await alerta.waitFor({ timeout: 10000 });
  check(/não deu permissão/.test(await alerta.innerText()), 'permissão negada: a janela explica como liberar a câmera', await alerta.innerText());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
  check(true, 'permissão negada: Esc fecha a janela');
  await ctx.close();

  ctx = await nav.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); });
  page = await ctx.newPage();
  await entrar(page, 'estoquista', 'Estoquista@123');
  await ir(page, '/estoque');
  await page.getByRole('heading', { name: 'Estoque' }).waitFor({ timeout: 10000 });
  check(await page.getByRole('button', { name: 'Ler pela câmera' }).count() === 0, 'sem câmera (ou página sem HTTPS) o botão não aparece');
  await ctx.close();
} catch (e) {
  console.error('erro no roteiro:', e.message);
  falhas++;
} finally {
  await nav.close();
}
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
