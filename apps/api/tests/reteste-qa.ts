/**
 * Regressão dos 12 tickets do QA (docs/qa/2026-10-05_reteste-qa.md) — parte de API.
 * Rodar DEPOIS do smoke, no mesmo banco de TESTE (usa o admin com a senha que o smoke define).
 * Uso: API_URL=http://127.0.0.1:3000/api/v1 npm run test:reteste
 * Dados 100% fictícios (CPF/CNPJ de exemplo, válidos só no cálculo).
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1'; // definida pelo smoke
let falhas = 0, oks = 0;
function check(cond: unknown, nome: string, extra?: unknown) {
  if (cond) { oks++; console.log(`  ✔ ${nome}`); } else { falhas++; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const campo = (r: { data: any }) => r.data?.errors?.[0]?.campo;

class Cliente {
  token: string | null = null; cookie = '';
  async req(method: string, path: string, body?: unknown, form?: FormData) {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (form) payload = form; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]!;
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, data: (ct.includes('json') ? await r.json().catch(() => null) : await r.arrayBuffer()) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  async login(login: string, senha: string) { const r = await this.post('/auth/login', { login, senha }); if (r.status === 200) this.token = r.data.accessToken; return r; }
}

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
const cents = (m: string) => Math.round(Number(m) * 100);

async function main() {
  const admin = new Cliente();
  const l = await admin.login('admin', SENHA_ADMIN);
  if (l.status !== 200) throw new Error('Rode o smoke antes (ele define a senha do admin) ou informe ADMIN_SENHA');

  console.log('Ticket 3 — categoria vendida por categoria exige preço');
  let r = await admin.post('/categorias', { id: uuid(), nome: `Sem preço ${uuid().slice(0, 6)}`, vendaPorCategoria: true });
  check(r.status === 400 && campo(r) === 'precoPadrao', 'sem preço → 400 no campo precoPadrao', r.data);
  r = await admin.post('/categorias', { id: uuid(), nome: `Preço zero ${uuid().slice(0, 6)}`, vendaPorCategoria: true, precoPadrao: '0.00' });
  check(r.status === 400 && campo(r) === 'precoPadrao', 'preço 0,00 → 400', r.data);
  const catSemVpc = (await admin.post('/categorias', { id: uuid(), nome: `Etiquetadas ${uuid().slice(0, 6)}`, vendaPorCategoria: false })).data;
  check(catSemVpc?.id, 'categoria SEM venda por categoria pode ficar sem preço', catSemVpc);
  r = await admin.patch(`/categorias/${catSemVpc.id}`, { vendaPorCategoria: true });
  check(r.status === 400 && campo(r) === 'precoPadrao', 'PATCH ligando venda por categoria sem preço → 400 (vale o estado final)', r.data);
  r = await admin.patch(`/categorias/${catSemVpc.id}`, { vendaPorCategoria: true, precoPadrao: '7.50' });
  check(r.status === 200 && r.data.vendaPorCategoria === true, 'com preço > 0 → 200', r.data);
  const csvCat = new FormData();
  csvCat.append('arquivo', new Blob([`nome;preco_padrao;venda_por_categoria\nImportada sem preço ${uuid().slice(0, 4)};;sim\n`], { type: 'text/csv' }), 'categorias.csv');
  r = await admin.req('POST', '/importacoes/categorias', undefined, csvCat);
  check(r.status === 200 && r.data.gravado === false && r.data.erros?.[0]?.linha, 'importação registra erro por linha', r.data);

  console.log('Ticket 4 — CPF/CNPJ com dígito verificador');
  r = await admin.post('/parceiros', { id: uuid(), nome: `Repetido ${uuid().slice(0, 6)}`, tipo: 'EMPRESA', documento: '11111111111111' });
  check(r.status === 400 && campo(r) === 'documento', 'CNPJ 11111111111111 → 400 no campo documento', r.data);
  r = await admin.post('/parceiros', { id: uuid(), nome: `CNPJ errado ${uuid().slice(0, 6)}`, tipo: 'EMPRESA', documento: '11222333000182' });
  check(r.status === 400 && campo(r) === 'documento', 'CNPJ com DV errado → 400', r.data);
  r = await admin.post('/parceiros', { id: uuid(), nome: `CPF errado ${uuid().slice(0, 6)}`, tipo: 'PESSOA_FISICA', documento: '52998224724' });
  check(r.status === 400 && campo(r) === 'documento', 'CPF com DV errado → 400', r.data);
  const pj = await admin.post('/parceiros', { id: uuid(), nome: `Empresa válida ${uuid().slice(0, 6)}`, tipo: 'EMPRESA', documento: '11222333000181' });
  check(pj.status === 201 && pj.data.tipo === 'EMPRESA' && pj.data.documentoExibicao === '11.222.333/0001-81', 'CNPJ válido → 201, tipo gravado (ticket 5)', pj.data);
  const pf = await admin.post('/parceiros', { id: uuid(), nome: `Pessoa válida ${uuid().slice(0, 6)}`, tipo: 'PESSOA_FISICA', documento: '52998224725' });
  check(pf.status === 201 && pf.data.documentoExibicao?.startsWith('•••') && !JSON.stringify(pf.data).includes('52998224725'), 'CPF válido → 201 e nunca volta inteiro (LGPD)', pf.data);

  console.log('Ticket 10 — parceiro especial');
  const especial = (await admin.get('/parceiros')).data.find((p: any) => p.especial);
  r = await admin.patch(`/parceiros/${especial.id}`, { nome: especial.nome, tipo: 'OUTRO', cidade: 'Parnaíba' });
  check(r.status === 200, 'PATCH com o MESMO nome → 200', r.data);
  r = await admin.patch(`/parceiros/${especial.id}`, { nome: 'Outro nome' });
  check(r.data?.code === 'PARCEIRO_ESPECIAL', 'renomear de verdade → 409 PARCEIRO_ESPECIAL', r.data);

  console.log('Ticket 11 — carga inicial com "Doações" acentuado');
  const catCarga = (await admin.post('/categorias', { id: uuid(), nome: `Carga ${uuid().slice(0, 6)}`, precoPadrao: '3.00', vendaPorCategoria: true })).data;
  const csvCarga = new FormData();
  csvCarga.append('arquivo', new Blob([`categoria;quantidade;preco;estoque;controle\n${catCarga.nome};2;3,00;Doações;Categoria\n${catCarga.nome};1;3,00; doacoes ;categoria\n${catCarga.nome};1;3,00;Bazar;CATEGORIA\n`], { type: 'text/csv' }), 'carga.csv');
  r = await admin.req('POST', '/carga-inicial', undefined, csvCarga);
  check(r.status === 200 && r.data.gravado === true && r.data.erros.length === 0, '"Doações", " doacoes " e "Categoria" aceitos', r.data);

  console.log('Ticket 6 — valor atribuído em lote de compra');
  const forn = pj.data;
  const compra = (await admin.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: forn.id, valorCompra: '50.00', pago: false, vencimento: hoje })).data;
  r = await admin.post(`/lotes/${compra.id}/itens`, { id: uuid(), categoriaId: catCarga.id, controle: 'CATEGORIA', quantidade: 5, preco: '8.00', localDestino: 'BAZAR' });
  check(r.status === 400 && campo(r) === 'valorAtribuido', 'compra sem valor atribuído → 400', r.data);
  r = await admin.post(`/lotes/${compra.id}/itens`, { id: uuid(), categoriaId: catCarga.id, controle: 'CATEGORIA', quantidade: 5, preco: '8.00', valorAtribuido: '0.00', localDestino: 'BAZAR' });
  check(r.status === 400 && campo(r) === 'valorAtribuido', 'compra com custo zero → 400 (S2)', r.data);
  r = await admin.post(`/lotes/${compra.id}/itens`, { id: uuid(), categoriaId: catCarga.id, controle: 'CATEGORIA', quantidade: 5, preco: '8.00', valorAtribuido: '2.00', localDestino: 'BAZAR' });
  check(r.status === 201, 'compra com custo unitário → 201', r.data);
  await admin.post(`/lotes/${compra.id}/aprovar`); // o valor atribuído conta depois da aprovação (S2)
  const loteDet = (await admin.get(`/lotes/${compra.id}`)).data;
  check(loteDet.valorAtribuido === '10.00', 'valor atribuído do lote = 5 × 2,00 (não o preço de venda)', loteDet);

  console.log('Ticket 1 — forma de pagamento no fiado e nas contas');
  const term = (await admin.post('/terminais', { id: uuid(), nome: `Reteste ${uuid().slice(0, 4)}` })).data;
  // O Admin não opera caixa: este bloco usa o operador caixa1 (perfil personalizado, Vendedor + financeiro, criado pelo smoke).
  const mista = new Cliente(); await mista.login('caixa1', 'Caixa-Senha-2026');
  let cx = await mista.get('/caixas/atual');
  if (cx.status === 404) cx = await mista.post('/caixas', { id: uuid(), terminalId: term.id, fundoTroco: '50.00' });
  check(cx.data?.operadorId, 'caixa traz operadorId', cx.data);
  const caixaId = cx.data.id;
  const cliente = (await admin.post('/clientes', { id: uuid(), nome: 'Cliente Reteste', telefone: `8699${String(Date.now()).slice(-7)}`, cienciaAviso: true })).data;
  const conta = (await mista.post('/contas-receber', { id: uuid(), clienteId: cliente.id, descricao: 'Fiado reteste', valor: '30.00', vencimento: hoje })).data;
  const antes = (await mista.get(`/caixas/${caixaId}/previa-fechamento`)).data;
  r = await mista.post(`/contas-receber/${conta.id}/recebimentos`, { id: uuid(), valor: '10.00', caixaId, forma: 'PIX' });
  check(r.status === 201 && r.data.forma === 'PIX', 'recebimento PIX no caixa gravado como PIX', r.data);
  const depoisPix = (await mista.get(`/caixas/${caixaId}/previa-fechamento`)).data;
  check(depoisPix.esperadoDinheiro === antes.esperadoDinheiro, 'PIX não entra no dinheiro esperado', { antes: antes.esperadoDinheiro, depois: depoisPix.esperadoDinheiro });
  await mista.post(`/contas-receber/${conta.id}/recebimentos`, { id: uuid(), valor: '5.00', caixaId, forma: 'DINHEIRO' });
  const depoisDin = (await mista.get(`/caixas/${caixaId}/previa-fechamento`)).data;
  check(cents(depoisDin.esperadoDinheiro) - cents(antes.esperadoDinheiro) === 500, 'dinheiro entra no esperado (+5,00)', depoisDin);
  const catDesp = (await mista.get('/categorias-despesa')).data[0] ?? (await admin.post('/categorias-despesa', { id: uuid(), nome: 'Despesas gerais (reteste)' })).data;
  const cp = (await mista.post('/contas-pagar', { id: uuid(), descricao: 'Conta reteste', categoriaDespesaId: catDesp.id, valor: '12.00', vencimento: hoje })).data;
  r = await mista.post(`/contas-pagar/${cp.id}/pagar`, { saiuDoCaixa: false, formaPagamento: 'CARTAO_DEBITO' });
  check(r.data?.formaPagamento === 'CARTAO_DEBITO', 'conta paga fora do caixa grava a forma escolhida', r.data);

  console.log('Ticket 2 — instituição para o comprovante');
  await admin.put('/instituicao', { nome: 'Associação Exemplo (fictícia)', cnpj: '11222333000181', endereco: 'Parnaíba – PI', telefone: '' });
  const operador = (await admin.get('/usuarios')).data.items?.find?.((u: any) => u.login === 'caixa1') ?? null;
  const caixa = new Cliente(); const lc = await caixa.login('caixa1', 'Caixa-Senha-2026');
  if (operador && lc.status === 200) {
    r = await caixa.get('/instituicao');
    check(r.status === 200 && r.data.cnpj, 'perfil Caixa lê nome e CNPJ (GET /instituicao)', r.data);
  } else {
    r = await admin.get('/instituicao');
    check(r.status === 200 && r.data.cnpj, 'GET /instituicao', r.data);
  }
  const cat = await admin.get('/pdv/catalogo');

  console.log('Ticket 7 — relatórios de vendas e descartes');
  const q = `de=2026-01-01&ate=${hoje}`;
  const lista = (await admin.get(`/relatorios/vendas?${q}`)).data;
  check(lista.blocos?.[0]?.titulo?.includes('canceladas'), 'canceladas em bloco próprio', lista.blocos);
  check(!lista.linhas.some((x: any) => x.status === 'CANCELADA'), 'lista principal só com concluídas');
  for (const ag of ['dia', 'forma', 'categoria', 'operador']) {
    const rel = (await admin.get(`/relatorios/vendas?${q}&agrupar=${ag}`)).data;
    const soma = rel.linhas.reduce((s: number, x: any) => s + cents(x.total), 0);
    check(rel.linhas.length > 0 && soma === cents(lista.totais.total) && cents(rel.totais.total) === soma, `total por ${ag} bate com o total geral`, { soma, geral: lista.totais.total, totais: rel.totais });
  }
  const parcDesc = (await admin.get('/parceiros')).data.find((p: any) => p.nome.startsWith('Loja Parceira Alfa'));
  const desc = (await admin.get(`/relatorios/descartes?${q}&parceiroId=${parcDesc.id}`)).data;
  check(desc.blocos?.[0]?.titulo?.includes('motivo') && desc.linhas.every((x: any) => String(x.parceiro).includes('Loja Parceira Alfa')), 'descartes filtrados por parceiro + total por motivo', desc);
  const porMotivo = (await admin.get(`/relatorios/descartes?${q}&parceiroId=${parcDesc.id}&agrupar=motivo`)).data;
  check(porMotivo.colunas[0].chave === 'motivo' && porMotivo.totais.quantidade === desc.linhas.length, 'agrupar=motivo soma a quantidade', porMotivo);
  const outro = (await admin.get(`/relatorios/descartes?${q}&parceiroId=${pj.data.id}`)).data;
  check(outro.linhas.length === 0, 'parceiro sem descartes → vazio');
  const csv = await admin.get(`/relatorios/vendas?${q}&agrupar=forma&formato=csv`);
  const txt = new TextDecoder().decode(csv.data as ArrayBuffer);
  check(csv.status === 200 && txt.includes('Vendas canceladas') && txt.includes('Totais'), 'CSV com o mesmo filtro, totais e bloco de canceladas');
  const pdf = await admin.get(`/relatorios/descartes?${q}&agrupar=motivo&formato=pdf`);
  check(pdf.status === 200 && new TextDecoder().decode((pdf.data as ArrayBuffer).slice(0, 5)) === '%PDF-', 'PDF agrupado');
  check((await admin.get(`/relatorios/vendas?${q}&agrupar=xpto`)).status === 400, 'agrupar inválido → 400');
  check((await admin.get(`/relatorios/descartes?${q}&parceiroId=nao-e-uuid`)).status === 400, 'parceiroId inválido → 400');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
