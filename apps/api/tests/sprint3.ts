/**
 * Sprint 3: o Estoquista também aprova (não o que ele mesmo cadastrou, S3-22), a fila de aprovação (S3-01), o Financeiro
 * lê os lotes (S3-12), ajuste só de saída (S3-03), tela do produto e edição (S3-04), custo com permissão (S3-05),
 * preço por Admin e Estoquista (S3-08), desconto no produto (S3-09) com o preço efetivo no PDV e na venda (S3-10),
 * o desconto nos relatórios (S3-11) e a auditoria do parceiro sem dado pessoal (S3-16). Dados 100% fictícios.
 * Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:sprint3
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
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Sprint3-Senha-2026' });
  await c.login(login, 'Sprint3-Senha-2026');
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
  const est1 = await novoUsuario(admin, 'Estoquista', `e1_${sufixo}`);
  const est2 = await novoUsuario(admin, 'Estoquista', `e2_${sufixo}`);
  const fin = await novoUsuario(admin, 'Financeiro', `fi_${sufixo}`);
  const base = { terminalId: cx.terminalId, caixaId: cx.id };
  const cat = (await admin.post('/categorias', { id: uuid(), nome: `Sprint3 ${sufixo}`, precoPadrao: '4.00', vendaPorCategoria: false })).data;
  const parc = (await est1.post('/parceiros', { id: uuid(), nome: `Doador S3 ${sufixo}`, tipo: 'PESSOA_FISICA' })).data;
  const catalogo = async () => ((await caixa.get('/pdv/catalogo')).data.itensEtiquetados as any[]);

  console.log('Aprovação por outra pessoa (S3-22, P-16) e fila (S3-01)');
  const lote = (await est1.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id })).data;
  const item = (nome: string, preco: string, qtd: number) => ({ id: uuid(), categoriaId: cat.id, controle: 'ETIQUETADO', quantidade: qtd, valorAtribuido: '2.00', localDestino: 'BAZAR',
    produto: { tituloEtiqueta: nome, nome: `${nome} ${sufixo}`, preco } });
  const a = (await est1.post(`/lotes/${lote.id}/itens`, item('Jarra', '20.00', 4))).data;
  const b = (await est1.post(`/lotes/${lote.id}/itens`, item('Prato', '6.00', 2))).data;
  const c = (await est2.post(`/lotes/${lote.id}/itens`, item('Copo', '3.00', 5))).data;
  check(a.criadoPorId && a.criadoPorId === b.criadoPorId && a.criadoPorId !== c.criadoPorId, 'o item diz quem cadastrou', [a.criadoPorId, c.criadoPorId]);
  const fila1 = (await est1.get('/aprovacoes')).data as any[];
  const naFila = (id: string) => fila1.find((x) => x.id === id);
  check(naFila(a.id)?.podeConferir === false && naFila(c.id)?.podeConferir === true && naFila(a.id)?.loteNumero === lote.numero && naFila(a.id)?.criadoPorNome,
    'a fila mostra o que espera aprovação, de quem é e quem pode conferir', [naFila(a.id), naFila(c.id)]);
  check((await est1.post(`/itens/${a.id}/aprovar`)).data?.code === 'AUTO_APROVACAO', 'Estoquista não aprova o próprio cadastro');
  check((await est1.post(`/itens/${b.id}/devolver`, { motivo: 'Confira o preço' })).data?.code === 'AUTO_APROVACAO', 'Estoquista não devolve o próprio cadastro');
  const apr = await est2.post(`/itens/${a.id}/aprovar`);
  check(apr.status === 200 && apr.data.status === 'APROVADO', 'outro Estoquista aprova', apr.data);
  const dev = await est2.post(`/itens/${b.id}/devolver`, { motivo: 'Faltou a cor do prato' });
  check(dev.status === 200 && dev.data.status === 'DEVOLVIDO', 'outro Estoquista devolve', dev.data);
  const devs = (await est1.get('/aprovacoes?status=DEVOLVIDO')).data as any[];
  check(devs.some((x) => x.id === b.id && x.motivoDevolucao), 'a fila também lista os devolvidos', devs.length);
  await est1.patch(`/lotes/${lote.id}/itens/${b.id}`, { valorAtribuido: '2.00' });
  const lap = await est1.post(`/lotes/${lote.id}/aprovar`);
  check(lap.status === 200 && lap.data.aprovadosAgora === 1 && lap.data.deixadosParaOutraPessoa === 1, 'aprovar o lote: o Estoquista aprova o do colega e deixa o dele para outra pessoa', lap.data);
  check((await est2.post(`/lotes/${lote.id}/aprovar`)).data?.aprovadosAgora === 1, 'o colega aprova o que faltou');
  const loteAdm = (await admin.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id })).data;
  const d = (await admin.post(`/lotes/${loteAdm.id}/itens`, item('Bule', '15.00', 1))).data;
  check((await admin.post(`/itens/${d.id}/aprovar`)).data?.status === 'APROVADO', 'o Administrador aprova o próprio cadastro');

  console.log('Financeiro lê os lotes, sem alterar (S3-12, P-07)');
  const lf = await fin.get(`/lotes/${lote.id}`);
  check(lf.status === 200 && lf.data.itens.length === 3 && lf.data.valorAtribuido !== undefined, 'Financeiro abre o lote (com o custo: tem "ver custo")', lf.status);
  check((await fin.post(`/lotes/${lote.id}/itens`, item('X', '1.00', 1))).status === 403 && (await fin.post(`/lotes/${lote.id}/encerrar`)).status === 403, 'Financeiro não cadastra nem encerra lote');

  console.log('Ajuste só de saída (S3-03)');
  check((await admin.post('/ajustes', { id: uuid(), itemId: c.id, local: 'BAZAR', tipo: 'AJUSTE_ENTRADA', quantidade: 1, motivo: 'Contagem física' })).status === 400, 'ajuste de entrada recusado');
  check((await admin.post('/ajustes', { id: uuid(), itemId: c.id, local: 'BAZAR', tipo: 'AJUSTE_SAIDA', quantidade: 1, motivo: 'Faltou na contagem' })).status === 204, 'ajuste de saída aceito');

  console.log('Produto: dados, edição e histórico (S3-04); custo (S3-05)');
  const pid = a.produto.id as string;
  let p = (await est1.get(`/produtos/${pid}`)).data;
  check(p.codigo === a.codigo && p.saldoBazar === 4 && p.entradas.length === 1 && p.entradas[0].valorAtribuido === '2.00' && p.eventos.some((e: any) => e.tipo === 'ENTRADA'), 'produto com saldo, entradas, custo e histórico', p);
  check((await est1.patch(`/produtos/${pid}`, { marca: 'Fictícia S3', cor: 'azul' })).status === 204, 'Estoquista edita os dados do produto');
  check((await est1.patch(`/produtos/${pid}`, { codigo: 'BZ000000' })).status === 400, 'o código não se edita (campo fora da lista)');
  check((await fin.patch(`/produtos/${pid}`, { cor: 'verde' })).status === 403, 'Financeiro não edita o produto');
  p = (await est1.get(`/produtos/${pid}`)).data;
  check(p.marca === 'Fictícia S3' && p.eventos.some((e: any) => e.tipo === 'PRODUTO_ALTERADO'), 'a edição aparece no produto e no histórico', p.eventos.map((e: any) => e.tipo));
  const pdv = (await caixa.get(`/itens/codigo/${a.codigo}`)).data;
  const adm = (await admin.get(`/itens/codigo/${a.codigo}`)).data;
  check(pdv && !('valorAtribuido' in pdv) && adm?.valorAtribuido === '2.00', 'o PDV (Vendedor) não recebe o custo; quem pode ver custo recebe', { pdv, adm });

  console.log('Preço por Admin e Estoquista (S3-08)');
  check((await est1.patch(`/produtos/${pid}/preco`, { preco: '22.00', motivo: 'Reajuste de vitrine' })).status === 204, 'Estoquista muda o preço com motivo');
  check((await est1.patch(`/produtos/${pid}/preco`, { preco: '22.00', motivo: 'ok' })).status === 400, 'preço sem motivo de 5+ caracteres é recusado');
  check((await fin.patch(`/produtos/${pid}/preco`, { preco: '1.00', motivo: 'Não deveria' })).status === 403, 'Financeiro não muda o preço');

  console.log('Desconto no produto (S3-09) e preço efetivo no PDV e na venda (S3-10)');
  check((await est1.put(`/produtos/${pid}/desconto`, { tipo: 'PERCENTUAL', valor: '10.00', motivo: 'Não deveria' })).status === 403, 'Estoquista não dá desconto');
  check((await fin.put(`/produtos/${pid}/desconto`, { tipo: 'PERCENTUAL', valor: '100.00', motivo: 'Promoção total' })).status === 400, 'desconto de 100% é recusado');
  check((await fin.put(`/produtos/${pid}/desconto`, { tipo: 'PRECO', valor: '22.00', motivo: 'Promoção sem desconto' })).status === 400, 'preço promocional igual ao preço é recusado');
  check((await fin.put(`/produtos/${pid}/desconto`, { tipo: 'PERCENTUAL', valor: '10.00', ate: '2020-01-01', motivo: 'Data velha' })).status === 400, 'validade no passado é recusada');
  const ds = await fin.put(`/produtos/${pid}/desconto`, { tipo: 'PERCENTUAL', valor: '25.00', motivo: 'Promoção de primavera' });
  check(ds.status === 200, 'Financeiro dá 25% de desconto, sem validade (P-05: opcional)', ds.data);
  p = (await admin.get(`/produtos/${pid}`)).data;
  check(p.preco === '22.00' && p.precoEfetivo === '16.50' && p.desconto?.tipo === 'PERCENTUAL' && p.desconto?.vigente === true, 'produto mostra o preço, o preço com desconto e o desconto vigente', p);
  let noPdv = (await catalogo()).find((x) => x.codigo === a.codigo);
  check(noPdv?.preco === '16.50' && noPdv?.precoSemDesconto === '22.00', 'o PDV recebe o preço com desconto e o preço cheio', noPdv);
  check((await est1.get(`/estoque?busca=${a.codigo}`)).data.items[0]?.preco === '16.50', 'o estoque mostra o preço efetivo');
  // o Vendedor tem limite de desconto 0%: o desconto do produto não conta no limite
  const v = await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: a.codigo, quantidade: 2 }], pagamentos: [{ forma: 'PIX', valor: '33.00', valorRecebido: '33.00' }] });
  check(v.status === 201 && v.data.total === '33.00', 'venda pelo preço com desconto, sem esbarrar no limite do Vendedor', v.data);
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: a.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '22.00', valorRecebido: '22.00' }] })).data?.code === 'PAGAMENTO_DIVERGENTE', 'o servidor cobra o preço com desconto (não o cheio)');
  const hoje = new Date().toISOString().slice(0, 10);
  const rv = (await admin.get(`/relatorios/vendas?de=${hoje}&ate=${hoje}`)).data;
  const linha = rv.linhas.find((l: any) => l.numero === v.data.numero);
  check(rv.colunas.some((x: any) => x.chave === 'descontoProduto') && linha?.descontoProduto === '11.00' && linha?.descontoPdv === '0.00', 'o relatório de vendas mostra o desconto do produto à parte do desconto do PDV (S3-11)', linha);
  const rd = (await admin.get(`/relatorios/vendas?de=${hoje}&ate=${hoje}&agrupar=dia`)).data;
  check(Number(rd.totais?.descontoProduto) >= 11, 'o relatório por dia soma o desconto do produto', rd.totais);
  check((await fin.post(`/produtos/${pid}/desconto/encerrar`, { motivo: 'Fim da promoção' })).status === 204, 'Financeiro encerra o desconto');
  noPdv = (await catalogo()).find((x) => x.codigo === a.codigo);
  check(noPdv?.preco === '22.00' && !noPdv?.precoSemDesconto, 'sem desconto, o PDV volta ao preço cheio', noPdv);
  check((await fin.post(`/produtos/${pid}/desconto/encerrar`, { motivo: 'De novo' })).data?.code === 'SEM_DESCONTO', 'encerrar sem desconto é recusado');
  await fin.put(`/produtos/${pid}/desconto`, { tipo: 'PRECO', valor: '18.00', motivo: 'Preço promocional', ate: hoje });
  check((await admin.get(`/produtos/${pid}`)).data.precoEfetivo === '18.00', 'preço promocional válido até hoje vale hoje');
  await est1.patch(`/produtos/${pid}/preco`, { preco: '17.00', motivo: 'Baixou abaixo da promoção' });
  p = (await admin.get(`/produtos/${pid}`)).data;
  check(!p.desconto && p.precoEfetivo === '17.00' && p.eventos.filter((e: any) => e.tipo === 'DESCONTO_PRODUTO_ENCERRADO').length === 2, 'preço novo abaixo da promoção encerra o desconto (com auditoria)', p);

  console.log('Auditoria do parceiro sem dado pessoal (S3-16)');
  check((await admin.patch(`/parceiros/${parc.id}`, { cidade: 'Cidade Fictícia', telefone: '86999990000' })).status === 200, 'Admin edita o parceiro');
  const aud = (await admin.get('/auditoria?entidade=parceiro&acao=CADASTRO_ALTERADO')).data.items as any[];
  // o conteúdo (só os nomes dos campos, sem os valores) é conferido no banco: database/09_testes_0010.sql
  check(aud.some((x) => x.entidadeId === parc.id), 'a alteração do parceiro vai para a auditoria', aud.length);

  console.log('Correções do QA: custo em todas as respostas do lote, preço na triagem com desconto, perfil desativado');
  await admin.post('/perfis', { nome: `Entrada sem custo ${sufixo}`, permissoes: ['entrada.registrar', 'estoque.consultar'] });
  const semC = await novoUsuario(admin, `Entrada sem custo ${sufixo}`, `sc_${sufixo}`);
  const loteSc = { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id };
  const l1 = await semC.post('/lotes', loteSc), l2 = await semC.post('/lotes', loteSc);
  const itSc = item('Bacia', '9.00', 1);
  const i1 = await semC.post(`/lotes/${loteSc.id}/itens`, itSc), i2 = await semC.post(`/lotes/${loteSc.id}/itens`, itSc);
  const enc = await semC.post(`/lotes/${loteSc.id}/encerrar`);
  check(l1.status === 201 && l2.status === 200 && i1.status === 201 && i2.status === 200 && enc.status === 200
    && [l1, l2, i1, i2, enc].every((r) => !('valorAtribuido' in r.data) && !('valorCompra' in r.data)),
    'sem custo.consultar, criar, reenviar e encerrar o lote não mostram o custo', [l1.data, i1.data, enc.data]);
  const loteT = (await est1.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id })).data;
  const t = (await est1.post(`/lotes/${loteT.id}/itens`, item('Panela', '30.00', 1))).data;
  check((await fin.put(`/produtos/${t.produto.id}/desconto`, { tipo: 'PRECO', valor: '25.00', motivo: 'Promoção da panela' })).status === 200, 'desconto no produto ainda não aprovado');
  const corr = await est1.patch(`/lotes/${loteT.id}/itens/${t.id}`, { produto: { preco: '24.00' } });
  const pt = (await admin.get(`/produtos/${t.produto.id}`)).data;
  check(corr.status === 200 && !pt.desconto && pt.preco === '24.00' && pt.eventos.some((e: any) => e.tipo === 'DESCONTO_PRODUTO_ENCERRADO'),
    'corrigir o preço na triagem abaixo da promoção encerra o desconto (sem erro do banco)', [corr.data, pt.desconto, pt.preco]);
  const pf = (await admin.post('/perfis', { nome: `Desativado ${sufixo}`, permissoes: [] })).data;
  await admin.post(`/perfis/${pf.id}/desativar`);
  check((await admin.patch(`/perfis/${pf.id}`, { permissoes: ['estoque.consultar'] })).data?.code === 'PERFIL_INATIVO', 'perfil desativado não se edita');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
