/**
 * Sprint 6, achados da revisão do protótipo (S6-06): id de operação repetido com outro conteúdo é recusado (S6-14),
 * "Reembolso de venda" não se lança à mão (S6-14), corpos de dinheiro com lista branca estrita (S6-14), o Vendedor sem a base
 * de clientes (S6-15) e sem os dados do doador na consulta do código (S6-16). A carga inicial única (S6-17) está no sprint5.
 * Dados 100% fictícios. Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:sprint6
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1';
const CATEGORIA_REEMBOLSO_ID = '00000000-0000-4000-8000-0000000000c1';
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
    return { status: r.status, data: (ct.includes('json') ? await r.json().catch(() => null) : null) as any };
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
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Sprint6-Senha-2026' });
  await c.login(login, 'Sprint6-Senha-2026');
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

  console.log('S6-14 — venda: o mesmo id é a mesma venda; com outro carrinho, 409');
  const cat = (await caixa.get('/pdv/catalogo')).data;
  const prod = (cat.itensEtiquetados as any[]).find((p) => !p.pecaUnica && p.saldoBazar >= 3);
  const categ = (cat.categorias as any[]).find((c) => c.saldoBazar >= 3 && Number(c.precoPadrao) > 0);
  const item = prod ? { codigo: prod.codigo } : { categoriaId: categ.id };
  const preco = Number(prod ? prod.preco : categ.precoPadrao);
  const corpo = (q: number) => ({ terminalId: cx.terminalId, caixaId: cx.id, itens: [{ ...item, quantidade: q }], pagamentos: [{ forma: 'PIX', valor: (preco * q).toFixed(2), valorRecebido: (preco * q).toFixed(2) }] });
  const idV = uuid();
  let r = await caixa.put(`/vendas/${idV}`, corpo(1));
  check(r.status === 201, 'venda gravada', r.data);
  const numero = r.data?.numero;
  r = await caixa.put(`/vendas/${idV}`, corpo(1));
  check(r.status === 200 && r.data?.numero === numero, 'reenvio da MESMA venda devolve a gravada (não duplica)', r.data);
  r = await caixa.put(`/vendas/${idV}`, corpo(2));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro carrinho é recusado (409 ID_EM_USO)', r.data);
  r = await caixa.put(`/vendas/${uuid()}`, { ...corpo(1), total: '0.01' });
  check(r.status === 400, 'campo desconhecido na venda (total mandado pelo front) é recusado (400)', r.data);

  console.log('S6-14 — transferência e baixa: chave com a impressão do pedido');
  const itens = (await admin.get('/estoque?pageSize=100')).data.items as any[];
  const alvo = itens.find((i) => i.saldoBazar >= 3);
  const saldoAntes = alvo.saldoBazar;
  const idT = uuid();
  const transf = (q: number) => ({ id: idT, itemId: alvo.id, quantidade: q, origem: 'BAZAR', destino: 'DOACOES' });
  r = await admin.post('/transferencias', transf(1));
  check(r.status === 204, 'transferência gravada', r.data);
  r = await admin.post('/transferencias', transf(1));
  const depois = (await admin.get('/estoque?pageSize=100')).data.items.find((i: any) => i.id === alvo.id);
  check(r.status === 204 && depois.saldoBazar === saldoAntes - 1, 'reenvio da mesma transferência não transfere de novo', { status: r.status, antes: saldoAntes, depois: depois.saldoBazar });
  r = await admin.post('/transferencias', transf(2));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outra quantidade é recusado (409), em vez de fingir sucesso', r.data);
  const motivos = (await admin.get('/motivos-baixa')).data;
  const motivoId = (Array.isArray(motivos) ? motivos : motivos.items)?.[0]?.id;
  r = await admin.post('/baixas', { id: idT, itemId: alvo.id, quantidade: 1, local: 'BAZAR', motivoId });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o id de uma transferência usado numa baixa é recusado (outro escopo)', r.data);
  r = await admin.post('/transferencias', { ...transf(1), id: uuid(), extra: 1 });
  check(r.status === 400, 'campo desconhecido na transferência é recusado (400)', r.data);

  console.log('S6-14 — lançamento de caixa e conta a pagar');
  const idL = uuid();
  r = await caixa.post(`/caixas/${cx.id}/lancamentos`, { id: idL, tipo: 'SUPRIMENTO', valor: '5.00', motivo: 'Reforço de teste' });
  check(r.status === 204, 'suprimento gravado', r.data);
  r = await caixa.post(`/caixas/${cx.id}/lancamentos`, { id: idL, tipo: 'SUPRIMENTO', valor: '5.00', motivo: 'Reforço de teste' });
  check(r.status === 204, 'reenvio do mesmo suprimento: sucesso, sem gravar de novo');
  r = await caixa.post(`/caixas/${cx.id}/lancamentos`, { id: idL, tipo: 'SUPRIMENTO', valor: '6.00', motivo: 'Reforço de teste' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro valor é recusado (409)', r.data);
  const idC = uuid();
  const conta = (valor: string) => ({ id: idC, descricao: `Luz de teste ${sufixo}`, valor, vencimento: '2026-12-10' });
  r = await admin.post('/contas-pagar', conta('80.00'));
  check(r.status === 201, 'conta a pagar lançada', r.data);
  r = await admin.post('/contas-pagar', conta('80.00'));
  check(r.status === 200 && r.data?.id === idC, 'reenvio da mesma conta devolve a gravada');
  r = await admin.post('/contas-pagar', conta('90.00'));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro valor é recusado (409)', r.data);
  r = await admin.post('/contas-pagar', { ...conta('80.00'), id: uuid(), categoriaDespesaId: CATEGORIA_REEMBOLSO_ID });
  check(r.status === 400 && r.data?.code === 'CATEGORIA_RESERVADA', '"Reembolso de venda" não se lança à mão (a despesa sumiria das saídas)', r.data);
  r = await admin.patch(`/contas-pagar/${idC}`, { categoriaDespesaId: CATEGORIA_REEMBOLSO_ID });
  check(r.status === 400 && r.data?.code === 'CATEGORIA_RESERVADA', 'nem trocando a categoria de uma conta aberta', r.data);
  r = await admin.post('/contas-pagar', { ...conta('80.00'), id: uuid(), pago: true });
  check(r.status === 400, 'campo desconhecido na conta a pagar é recusado (400)', r.data);

  console.log('S6-15 e S6-16 — Vendedor');
  const vend = await novoUsuario(admin, 'Vendedor', `s6_vend_${sufixo}`);
  r = await vend.get('/clientes');
  check(r.status === 403, 'Vendedor não lista a base de clientes (403)', r.status);
  r = await vend.post('/clientes/busca', { termo: 'Teste' });
  check(r.status === 200, 'Vendedor continua buscando o cliente do fiado', r.status);
  r = await vend.post('/clientes', { id: uuid(), nome: `Cliente Fiado ${sufixo}`, telefone: '86999990000', cienciaAviso: true });
  check(r.status === 201 || r.status === 200, 'Vendedor continua cadastrando o cliente do fiado', r.data);
  const comCodigo = itens.find((i) => i.codigo && i.parceiroNome);
  if (comCodigo) {
    const v = (await vend.get(`/itens/codigo/${comCodigo.codigo}`)).data;
    check(v && v.codigo === comCodigo.codigo && v.parceiroNome === undefined && v.campanhaNome === undefined && v.loteNumero === undefined && v.saldoDoacoes === undefined && typeof v.estaEmDoacoes === 'boolean' && typeof v.saldoBazar === 'number',
      'Vendedor consulta o código sem doador, campanha, lote nem saldo de Doações (só se está em Doações)', v);
    const a = (await admin.get(`/itens/codigo/${comCodigo.codigo}`)).data;
    check(a && a.parceiroNome && typeof a.saldoDoacoes === 'number', 'quem consulta o estoque continua vendo tudo', a);
  } else check(false, 'nenhum produto com código e parceiro para testar a consulta do Vendedor');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
