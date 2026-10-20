/**
 * Sprint 2 (S2-15): produto de código único, cadastro no lote, devolução e aprovação pelo Admin, nova entrada,
 * PEPS por produto, estorno de produto de várias unidades e duas vendas disputando a última unidade.
 * Também as lacunas apontadas pelo QA em 19/10/2026: preço adulterado na venda, campo extra ignorado,
 * reenvio de recebimento com o mesmo id e corpo do erro no padrão RFC 9457. Dados 100% fictícios.
 * Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:produto
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1';
let falhas = 0, oks = 0;
function check(cond: unknown, nome: string, extra?: unknown) {
  if (cond) { oks++; console.log(`  ✔ ${nome}`); } else { falhas++; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 320) : ''); }
}
class Cliente {
  token: string | null = null;
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, ct, data: (ct.includes('json') ? await r.json().catch(() => null) : null) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  async login(login: string, senha: string) { const r = await this.post('/auth/login', { login, senha }); if (r.status === 200) this.token = r.data.accessToken; return r; }
}

async function novoUsuario(admin: Cliente, perfil: string, login: string) {
  const perfilId = ((await admin.get('/perfis')).data as any[]).find((p) => p.nome === perfil).id;
  const u = (await admin.post('/usuarios', { id: uuid(), nome: `Teste ${login}`, login, perfilId })).data;
  const c = new Cliente();
  await c.login(login, u.senhaProvisoria);
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Produto-Senha-2026' });
  await c.login(login, 'Produto-Senha-2026');
  return c;
}

async function main() {
  const admin = new Cliente();
  if ((await admin.login('admin', SENHA_ADMIN)).status !== 200) throw new Error('Rode o smoke antes (ele define a senha do admin) ou informe ADMIN_SENHA');
  const caixa = new Cliente();
  if ((await caixa.login('caixa1', 'Caixa-Senha-2026')).status !== 200) throw new Error('Rode o smoke antes: falta o operador caixa1');
  const cx = (await caixa.get('/caixas/atual')).data;
  if (!cx?.id) throw new Error('O operador caixa1 precisa de um caixa aberto (o smoke deixa um aberto)');
  const sufixo = uuid().slice(0, 6);
  const est = await novoUsuario(admin, 'Estoquista', `est_${sufixo}`);
  const cats = (await admin.get('/categorias')).data as any[];
  const utens = (await admin.post('/categorias', { id: uuid(), nome: `Utilidades ${sufixo}`, precoPadrao: '4.00', vendaPorCategoria: false })).data;
  const outra = cats.find((c) => c.nome === 'Roupa adulto');
  const base = { terminalId: cx.terminalId, caixaId: cx.id };
  const vender = (cli: Cliente, cb: { terminalId: string; caixaId: string }, itens: unknown[], valor: string) =>
    cli.put(`/vendas/${uuid()}`, { ...cb, itens, pagamentos: [{ forma: 'PIX', valor, valorRecebido: valor }] });
  const catalogo = async () => ((await caixa.get('/pdv/catalogo')).data.itensEtiquetados as any[]);

  console.log('Lote: parceiro obrigatório, o Estoquista cria o parceiro na hora (S2-06)');
  const parc = await est.post('/parceiros', { id: uuid(), nome: `Doadora ${sufixo}`, tipo: 'PESSOA_FISICA' });
  check(parc.status === 201, 'Estoquista cria parceiro', parc.data);
  check((await est.patch(`/parceiros/${parc.data.id}`, { ativo: false })).status === 403, 'Estoquista não edita nem desativa parceiro');
  check((await est.post('/lotes', { id: uuid(), tipo: 'DOACAO' })).data?.code === 'PARCEIRO_OBRIGATORIO', 'doação sem parceiro é recusada');
  const loteA = (await est.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.data.id, numero: 999999, status: 'TRIADO' })).data;
  check(loteA.status === 'ABERTO' && loteA.numero !== 999999, 'campo extra no corpo é ignorado (lista branca)', loteA);

  console.log('Cadastro no lote: fica "cadastrado", sem estoque (S2-07)');
  const caneca = { id: uuid(), categoriaId: utens.id, controle: 'ETIQUETADO', quantidade: 3, valorAtribuido: '2.00', localDestino: 'BAZAR',
    produto: { tituloEtiqueta: 'Caneca branca', nome: 'Caneca de porcelana branca', preco: '7.00', marca: 'Fictícia', cor: 'branca' } };
  check((await est.post(`/lotes/${loteA.id}/itens`, { ...caneca, valorAtribuido: undefined })).status === 400, 'produto sem valor atribuído => 400 (P-06)');
  check((await est.post(`/lotes/${loteA.id}/itens`, { ...caneca, produto: { ...caneca.produto, tituloEtiqueta: '' } })).status === 400, 'produto sem título da etiqueta => 400');
  const itA = await est.post(`/lotes/${loteA.id}/itens`, caneca);
  check(itA.status === 201 && itA.data.status === 'CADASTRADO' && /^BZ\d{6}$/.test(itA.data.codigo) && itA.data.produto?.pecaUnica === false, 'produto novo cadastrado com código BZ', itA.data);
  check((await est.post(`/lotes/${loteA.id}/itens`, caneca)).status === 200, 'reenvio do mesmo id devolve o item (idempotente)');
  const codigo = itA.data.codigo as string;
  check(!(await catalogo()).some((p) => p.codigo === codigo), 'cadastrado não aparece no PDV');
  check((await est.get(`/estoque?busca=${codigo}`)).data.total === 0, 'cadastrado não aparece no estoque');
  const vestido = await est.post(`/lotes/${loteA.id}/itens`, { id: uuid(), categoriaId: utens.id, controle: 'ETIQUETADO', quantidade: 1, valorAtribuido: '5.00', localDestino: 'BAZAR', produto: { tituloEtiqueta: 'Vaso', nome: 'Vaso de vidro', preco: '20.00', pecaUnica: true } });
  check(vestido.status === 201 && vestido.data.produto.pecaUnica, 'peça única cadastrada', vestido.data);
  let lA = (await est.get(`/lotes/${loteA.id}`)).data;
  check(lA.aprovados === 0 && lA.pendentes === 2 && lA.valorAtribuido === '0.00', 'prestação do lote não conta o que não foi aprovado', lA);
  const et = (await est.post('/etiquetas/preparar', { produtos: [{ produtoId: itA.data.produto.id, quantidade: 3 }] })).data.itens;
  check(et?.length === 1 && et[0].codigo === codigo && et[0].titulo === 'Caneca branca' && et[0].preco === '7.00' && et[0].quantidade === 3, 'etiqueta do produto: título curto, preço e código', et);

  console.log('Devolução e correção (P-14)');
  check((await est.post(`/itens/${itA.data.id}/aprovar`)).data?.code === 'AUTO_APROVACAO', 'Estoquista não aprova o que ele mesmo cadastrou (S3-22)');
  check((await caixa.post(`/itens/${itA.data.id}/devolver`, { motivo: 'Confira a quantidade' })).status === 403, 'Vendedor não devolve');
  check((await admin.post(`/itens/${itA.data.id}/devolver`, { motivo: 'ruim' })).status === 400, 'devolver exige motivo (5+ caracteres)');
  const dev = await admin.post(`/itens/${itA.data.id}/devolver`, { motivo: 'Confira a quantidade e o preço' });
  check(dev.status === 200 && dev.data.status === 'DEVOLVIDO' && dev.data.motivoDevolucao === 'Confira a quantidade e o preço', 'Admin devolve com motivo', dev.data);
  check((await admin.post(`/itens/${itA.data.id}/aprovar`)).data?.code === 'ITEM_DEVOLVIDO', 'devolvido não é aprovado antes da correção');
  const cor = await est.patch(`/lotes/${loteA.id}/itens/${itA.data.id}`, { quantidade: 4, produto: { preco: '8.00' } });
  check(cor.status === 200 && cor.data.status === 'CADASTRADO' && cor.data.quantidade === 4 && cor.data.produto.preco === '8.00' && !cor.data.motivoDevolucao, 'Estoquista corrige e o item volta a cadastrado', cor.data);
  check((await est.patch(`/lotes/${loteA.id}/itens/${vestido.data.id}`, { quantidade: 2 })).data?.code === 'PECA_UNICA_QTD', 'correção não deixa peça única com 2 unidades');
  const vira = await est.patch(`/lotes/${loteA.id}/itens/${vestido.data.id}`, { quantidade: 2, produto: { pecaUnica: false } });
  check(vira.status === 200 && vira.data.quantidade === 2 && vira.data.produto.pecaUnica === false, 'na mesma correção deixa de ser peça única e passa a 2 unidades', vira.data);
  const volta = await est.patch(`/lotes/${loteA.id}/itens/${vestido.data.id}`, { quantidade: 1, produto: { pecaUnica: true } });
  check(volta.status === 200 && volta.data.quantidade === 1 && volta.data.produto.pecaUnica === true, 'e volta a peça única com 1 unidade', volta.data);

  console.log('Aprovação: o saldo só sobe aqui (S2-05, S2-09)');
  const apr = await admin.post(`/itens/${itA.data.id}/aprovar`);
  check(apr.status === 200 && apr.data.status === 'APROVADO', 'Admin aprova o item', apr.data);
  check((await admin.post(`/itens/${itA.data.id}/aprovar`)).status === 200, 'aprovar de novo não duplica (reenvio)');
  check((await est.patch(`/lotes/${loteA.id}/itens/${itA.data.id}`, { quantidade: 9 })).data?.code === 'ITEM_APROVADO', 'aprovado não se corrige pelo cadastro');
  check((await admin.post(`/itens/${itA.data.id}/devolver`, { motivo: 'Tarde demais' })).data?.code === 'ITEM_APROVADO', 'aprovado não é devolvido');
  let noPdv = (await catalogo()).find((p) => p.codigo === codigo);
  check(noPdv?.saldoBazar === 4 && noPdv.preco === '8.00', 'aprovado aparece no PDV com 4 unidades e o preço do produto', noPdv);
  check((await admin.post(`/lotes/${loteA.id}/aprovar`)).data?.aprovadosAgora === 1, 'aprovar o lote aprova o que falta (a peça única)');
  lA = (await est.get(`/lotes/${loteA.id}`)).data;
  check(lA.aprovados === 5 && lA.pendentes === 0 && lA.valorAtribuido === '13.00', 'prestação do lote conta os aprovados (4 × 2,00 + 5,00)', lA);

  console.log('Nova entrada do mesmo produto em outro lote (S2-08)');
  const loteB = (await est.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.data.id })).data;
  const prod = (await est.get(`/produtos?busca=${codigo}`)).data.items[0];
  check(prod?.codigo === codigo && prod.saldoBazar === 4, 'busca o produto pelo código', prod);
  check((await est.post(`/lotes/${loteB.id}/itens`, { id: uuid(), categoriaId: utens.id, controle: 'ETIQUETADO', quantidade: 1, valorAtribuido: '1.00', localDestino: 'BAZAR', produtoId: vestido.data.produto.id })).data?.code === 'PECA_UNICA_ENTRADA', 'peça única não recebe nova entrada');
  check((await est.post(`/lotes/${loteB.id}/itens`, { id: uuid(), categoriaId: outra.id, controle: 'ETIQUETADO', quantidade: 1, valorAtribuido: '1.00', localDestino: 'BAZAR', produtoId: prod.id })).data?.code === 'CATEGORIA_DO_PRODUTO', 'nova entrada tem a categoria do produto');
  const itB = await est.post(`/lotes/${loteB.id}/itens`, { id: uuid(), categoriaId: utens.id, controle: 'ETIQUETADO', quantidade: 2, valorAtribuido: '3.00', localDestino: 'BAZAR', produtoId: prod.id });
  check(itB.status === 201 && itB.data.codigo === codigo && itB.data.preco === '8.00', 'nova entrada usa o mesmo código e não muda o preço', itB.data);
  await admin.post(`/lotes/${loteB.id}/aprovar`);
  noPdv = (await catalogo()).find((p) => p.codigo === codigo);
  check(noPdv?.saldoBazar === 6, 'o PDV soma as entradas do produto (4 + 2)', noPdv);

  console.log('Venda por PEPS sobre o produto (S2-10)');
  check((await vender(caixa, base, [{ codigo, quantidade: 1, preco: '0.01' }], '8.00')).status === 400, 'preço enviado pelo front é recusado (o servidor decide o preço)');
  check((await vender(caixa, base, [{ codigo: vestido.data.codigo, quantidade: 2 }], '40.00')).data?.code === 'CODIGO_DUPLICADO', 'peça única não vende 2 unidades');
  const v = await vender(caixa, base, [{ codigo, quantidade: 3 }, { codigo, quantidade: 2 }], '40.00');
  const porLote = (v.data?.itens ?? []).map((i: any) => `${i.loteNumero}:${i.quantidade}`).sort().join(',');
  check(v.status === 201 && v.data.total === '40.00', 'o mesmo código repetido soma (5 × 8,00)', v.data);
  check(porLote === `${loteA.numero}:4,${loteB.numero}:1`, `PEPS: lote mais antigo primeiro (${porLote})`);
  noPdv = (await catalogo()).find((p) => p.codigo === codigo);
  check(noPdv?.saldoBazar === 1, 'resta 1 unidade no Bazar', noPdv);
  check((await vender(caixa, base, [{ codigo, quantidade: 2 }], '16.00')).data?.code === 'SALDO_INSUFICIENTE', 'pedir mais do que há => SALDO_INSUFICIENTE');
  const canc = await admin.post(`/vendas/${v.data.id}/cancelar`, { motivo: 'Teste de estorno do produto' });
  noPdv = (await catalogo()).find((p) => p.codigo === codigo);
  check(canc.status === 200 && noPdv?.saldoBazar === 6, 'cancelar devolve as 5 unidades às duas entradas (estorno de várias unidades)', { canc: canc.data?.code, noPdv });
  const v2 = await vender(caixa, base, [{ codigo, quantidade: 5 }], '40.00');
  check(v2.status === 201, 'vende de novo depois do estorno', v2.data);

  console.log('Duas vendas disputando a última unidade');
  const op2 = await novoUsuario(admin, 'Vendedor', `cx_${sufixo}`);
  const term = (await admin.post('/terminais', { id: uuid(), nome: `Produto ${sufixo}` })).data;
  const cx2 = (await op2.post('/caixas', { id: uuid(), terminalId: term.id, fundoTroco: '0.00' })).data;
  const base2 = { terminalId: term.id, caixaId: cx2.id };
  const r = await Promise.all([vender(caixa, base, [{ codigo, quantidade: 1 }], '8.00'), vender(op2, base2, [{ codigo, quantidade: 1 }], '8.00')]);
  check(r.filter((x) => x.status === 201).length === 1 && r.some((x) => x.data?.code === 'ITEM_INDISPONIVEL'), 'só um dos dois caixas leva a última unidade', r.map((x) => [x.status, x.data?.code]));
  check(!(await catalogo()).some((p) => p.codigo === codigo), 'produto sem saldo sai do PDV');
  // a disputa de uma unidade entre várias vendas ao mesmo tempo não deixa saldo negativo
  const itC = await est.post(`/lotes/${loteB.id}/itens`, { id: uuid(), categoriaId: utens.id, controle: 'ETIQUETADO', quantidade: 3, valorAtribuido: '3.00', localDestino: 'BAZAR', produtoId: prod.id });
  check(itC.status === 201, 'terceira entrada do produto no lote aberto', itC.data);
  await admin.post(`/lotes/${loteB.id}/aprovar`);
  const r3 = await Promise.all([1, 2, 3, 4].map((n) => vender(n % 2 ? caixa : op2, n % 2 ? base : base2, [{ codigo, quantidade: 1 }], '8.00')));
  check(r3.filter((x) => x.status === 201).length === 3 && r3.filter((x) => x.status === 409).length === 1, 'quatro vendas de 1 unidade sobre 3: três passam, uma é recusada', r3.map((x) => [x.status, x.data?.code]));

  console.log('Lacunas do QA: recebimento reenviado e corpo do erro (RFC 9457)');
  const cli = (await admin.post('/clientes/busca', { termo: 'maria' })).data[0];
  const conta = (await admin.post('/contas-receber', { id: uuid(), clienteId: cli.id, descricao: `Teste ${sufixo}`, valor: '30.00', vencimento: new Date().toISOString().slice(0, 10) })).data;
  const rid = uuid();
  const rec1 = await admin.post(`/contas-receber/${conta.id}/recebimentos`, { id: rid, valor: '10.00', forma: 'PIX' });
  const rec2 = await admin.post(`/contas-receber/${conta.id}/recebimentos`, { id: rid, valor: '10.00', forma: 'PIX' });
  const rec3 = await admin.post(`/contas-receber/${conta.id}/recebimentos`, { id: uuid(), valor: '20.00', forma: 'PIX' });
  check(rec1.status === 201 && rec2.status === 200 && rec2.data.id === rid && rec3.status === 201, 'recebimento reenviado com o mesmo id não recebe duas vezes (o saldo de 20 ainda cabe)', [rec1.status, rec2.status, rec3.status, rec3.data?.code]);
  const e404 = await admin.get('/rota-que-nao-existe');
  check(e404.status === 404 && e404.ct.includes('application/problem+json') && e404.data.type && e404.data.title && e404.data.status === 404 && !('stack' in e404.data), 'erro 404 no padrão RFC 9457, sem stack', e404);
  const e400 = await est.post(`/lotes/${loteA.id}/itens`, { id: 'x' });
  check(e400.status === 400 && e400.data.code === 'VALIDACAO' && e400.data.status === 400 && Array.isArray(e400.data.errors) && !('stack' in e400.data), 'erro de validação no padrão RFC 9457, com os campos', e400.data);

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
