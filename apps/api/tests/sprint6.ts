/**
 * Sprint 6, achados da revisão do protótipo (S6-06): id de operação repetido com outro conteúdo é recusado (S6-14),
 * "Reembolso de venda" não se lança à mão (S6-14), corpos de dinheiro com lista branca estrita (S6-14), o Vendedor sem a base
 * de clientes (S6-15) e sem os dados do doador na consulta do código (S6-16). A carga inicial única (S6-17) está no sprint5.
 * Também: reenvio do cadastro de cliente e de lote (S6-22), caixa às cegas (S6-19) e troco no recebimento do fiado (S6-20).
 * Dados 100% fictícios. Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:sprint6
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1';
const CATEGORIA_REEMBOLSO_ID = '00000000-0000-4000-8000-0000000000c1';
const centavos = (v: string) => Math.round(Number(v) * 100);
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

/** Usuário com nome e terminal fixo escolhidos (S6-21), já com a senha trocada. */
async function usuarioCom(admin: Cliente, perfil: string, login: string, nome: string, terminalId?: string) {
  const perfilId = ((await admin.get('/perfis')).data as any[]).find((p) => p.nome === perfil).id;
  const u = (await admin.post('/usuarios', { id: uuid(), nome, login, perfilId, ...(terminalId ? { terminalId } : {}) })).data;
  // um login só: a troca de senha mantém a sessão atual (o login aceita 10 por minuto por IP)
  const c = new Cliente();
  await c.login(login, u.senhaProvisoria);
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Sprint6-Senha-2026' });
  return { c, id: u.id as string, criado: u };
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
  // a impressão do pedido inteiro (S6-14, rodada 4): o mesmo carrinho com outro pagamento, cliente, CPF ou desconto é outra venda
  r = await caixa.put(`/vendas/${idV}`, { ...corpo(1), pagamentos: [{ forma: 'DINHEIRO', valor: preco.toFixed(2), valorRecebido: (preco + 10).toFixed(2) }] });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id e o mesmo carrinho com outro pagamento é recusado (409)', r.data);
  r = await caixa.put(`/vendas/${idV}`, { ...corpo(1), cpf: '529.982.247-25' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com CPF (que a primeira não tinha) é recusado (409)', r.data);
  const idV2 = uuid();
  r = await caixa.put(`/vendas/${idV2}`, corpo(2));
  check(r.status === 201, 'venda de 2 unidades gravada', r.data);
  r = await caixa.put(`/vendas/${idV2}`, { ...corpo(2), itens: [{ ...item, quantidade: 1 }, { ...item, quantidade: 1 }] });
  check(r.status === 200 && r.data?.numero === (await caixa.get(`/vendas/${idV2}/comprovante`)).data?.numero, 'o mesmo carrinho em duas linhas (1 + 1) é a mesma venda: reenvio devolve a gravada', r.data);
  r = await caixa.put(`/vendas/${uuid()}`, { ...corpo(1), total: '0.01' });
  check(r.status === 400, 'campo desconhecido na venda (total mandado pelo front) é recusado (400)', r.data);

  console.log('S6-14 — transferência e baixa: chave com a impressão do pedido');
  const itens = (await admin.get('/estoque?pageSize=100')).data.items as any[];
  const alvo = itens.find((i) => i.saldoBazar >= 2); // transfere 1; o pedido de 2 é recusado antes de mexer no estoque
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
  r = await caixa.post(`/caixas/${cx.id}/lancamentos`, { id: idL, tipo: 'SUPRIMENTO', valor: '5.00', motivo: 'Outro motivo de teste' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro motivo é recusado (409)', r.data);
  const idC = uuid();
  const conta = (valor: string) => ({ id: idC, descricao: `Luz de teste ${sufixo}`, valor, vencimento: '2026-12-10' });
  r = await admin.post('/contas-pagar', conta('80.00'));
  check(r.status === 201, 'conta a pagar lançada', r.data);
  r = await admin.post('/contas-pagar', conta('80.00'));
  check(r.status === 200 && r.data?.id === idC, 'reenvio da mesma conta devolve a gravada');
  r = await admin.post('/contas-pagar', conta('90.00'));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro valor é recusado (409)', r.data);
  r = await admin.post('/contas-pagar', { ...conta('80.00'), favorecido: 'Outro favorecido' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro favorecido é recusado (409)', r.data);
  r = await admin.post('/contas-pagar', { ...conta('80.00'), id: uuid(), categoriaDespesaId: CATEGORIA_REEMBOLSO_ID });
  check(r.status === 400 && r.data?.code === 'CATEGORIA_RESERVADA', '"Reembolso de venda" não se lança à mão (a despesa sumiria das saídas)', r.data);
  r = await admin.patch(`/contas-pagar/${idC}`, { categoriaDespesaId: CATEGORIA_REEMBOLSO_ID });
  check(r.status === 400 && r.data?.code === 'CATEGORIA_RESERVADA', 'nem trocando a categoria de uma conta aberta', r.data);
  r = await admin.post('/contas-pagar', { ...conta('80.00'), id: uuid(), pago: true });
  check(r.status === 400, 'campo desconhecido na conta a pagar é recusado (400)', r.data);

  console.log('S6-14 — recebimento do fiado: a conta da URL e a observação entram na impressão');
  const cli = (await admin.post('/clientes', { id: uuid(), nome: `Cliente Receber ${sufixo}`, telefone: '86988887777', cienciaAviso: true })).data;
  const novaConta = async () => (await admin.post('/contas-receber', { id: uuid(), clienteId: cli.id, descricao: `Fiado ${sufixo}`, valor: '20.00', vencimento: '2026-12-10' })).data;
  const cr1 = await novaConta(), cr2 = await novaConta();
  const idR = uuid();
  const receb = { id: idR, valor: '5.00', forma: 'PIX' };
  r = await admin.post(`/contas-receber/${cr1.id}/recebimentos`, receb);
  check(r.status === 201, 'recebimento gravado', r.data);
  r = await admin.post(`/contas-receber/${cr1.id}/recebimentos`, receb);
  check(r.status === 200 && r.data?.id === idR, 'reenvio do mesmo recebimento devolve o gravado', r.data);
  r = await admin.post(`/contas-receber/${cr1.id}/recebimentos`, { ...receb, observacao: 'outra' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outra observação é recusado (409)', r.data);
  r = await admin.post(`/contas-receber/${cr2.id}/recebimentos`, receb);
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id e o mesmo corpo em OUTRA conta é recusado (a conta da URL conta)', r.data);
  const saldo2 = (await admin.get(`/contas-receber?clienteId=${cli.id}&pageSize=50`)).data?.items?.find((c: any) => c.id === cr2.id)?.saldo;
  check(saldo2 === '20.00', 'e a outra conta continua sem recebimento', saldo2);

  console.log('S6-14 — abrir caixa: o reenvio da própria abertura volta 200 (a chave vem antes da conferência de caixa aberto)');
  const term = (await admin.post('/terminais', { id: uuid(), nome: `Caixa S6 ${sufixo}` })).data;
  const vendA = await novoUsuario(admin, 'Vendedor', `s6_abre_${sufixo}`);
  const abre = { id: uuid(), terminalId: term.id, fundoTroco: '30.00' };
  r = await vendA.post('/caixas', abre);
  check(r.status === 201, 'caixa aberto', r.data);
  r = await vendA.post('/caixas', abre);
  check(r.status === 200 && r.data?.id === abre.id, 'reenvio da mesma abertura devolve o caixa (não CAIXA_JA_ABERTO)', r.data);
  r = await vendA.post('/caixas', { ...abre, fundoTroco: '40.00' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro fundo de troco é recusado (409)', r.data);
  const fechar = (await vendA.post(`/caixas/${abre.id}/fechar`, { id: uuid(), contado: '30.00' }));
  check(fechar.status === 200, 'caixa de teste fechado', fechar.data);

  console.log('S6-15 e S6-16 — Vendedor');
  const vend = await novoUsuario(admin, 'Vendedor', `s6_vend_${sufixo}`);
  r = await vend.get('/clientes');
  check(r.status === 403, 'Vendedor não lista a base de clientes (403)', r.status);
  r = await vend.post('/clientes/busca', { termo: 'Teste' });
  check(r.status === 200, 'Vendedor continua buscando o cliente do fiado', r.status);
  r = await vend.post('/clientes/busca', { termo: '' });
  check(r.status === 400 && r.data?.code === 'TERMO_CURTO', 'Vendedor não lista a base pela busca vazia (400 TERMO_CURTO)', r.data);
  r = await vend.post('/clientes/busca', { termo: '  ab  ' });
  check(r.status === 400 && r.data?.code === 'TERMO_CURTO', 'nem com 2 letras (os espaços não contam)', r.data);
  r = await vend.post('/clientes/busca', {});
  check(r.status === 400 && r.data?.code === 'TERMO_CURTO', 'nem sem o termo', r.data);
  const fin = await novoUsuario(admin, 'Financeiro', `s6_fin_${sufixo}`);
  r = await fin.post('/clientes/busca', { termo: '', ativo: true });
  check(r.status === 200 && Array.isArray(r.data), 'o Financeiro continua listando os clientes para lançar a conta (busca vazia)', r.status);
  r = await admin.post('/clientes/busca', { termo: '' });
  check(r.status === 200, 'o Administrador também', r.status);
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

  console.log('S6-21 e S6-18 — terminal fixo no usuário e terminal ocupado com o primeiro nome (espera 1 min: limite de login)');
  await new Promise((ok) => setTimeout(ok, 61_000));
  const novoTerminal = async (n: string) => (await admin.post('/terminais', { id: uuid(), nome: `${n} ${sufixo}` })).data;
  const [t1, t2, t3, t4] = [await novoTerminal('Caixa A'), await novoTerminal('Caixa B'), await novoTerminal('Caixa C'), await novoTerminal('Caixa D')];
  const ana = await usuarioCom(admin, 'Vendedor', `s6_ana_${sufixo}`, 'Ana  Teste Lima', t1.id);
  check(ana.criado?.terminalId === t1.id && ana.criado?.terminalNome === t1.nome, 'o Admin define o terminal no cadastro do usuário', ana.criado);
  const me = (await ana.c.get('/me')).data;
  check(me?.terminal?.id === t1.id && me.terminal.nome === t1.nome && me.terminal.ativo === true, '/me devolve o terminal fixo', me?.terminal);
  r = await ana.c.post('/caixas', { id: uuid(), terminalId: t2.id, fundoTroco: '10.00' });
  check(r.status === 403 && r.data?.code === 'TERMINAL_DO_USUARIO' && r.data?.title?.includes(t1.nome), 'quem tem terminal não abre outro, nem pela API direto (403)', r.data);
  const caixaAna = uuid();
  r = await ana.c.post('/caixas', { id: caixaAna, terminalId: t1.id, fundoTroco: '10.00' });
  check(r.status === 201, 'abre no terminal dela', r.data);
  await admin.patch(`/usuarios/${ana.id}`, { terminalId: t2.id });
  r = await ana.c.post('/caixas', { id: caixaAna, terminalId: t1.id, fundoTroco: '10.00' });
  check(r.status === 200 && r.data?.id === caixaAna, 'reenvio da abertura depois de o Admin trocar o terminal dela: 200 (a chave vem antes do 403)', r.data);
  await admin.patch(`/usuarios/${ana.id}`, { terminalId: t1.id });
  r = await ana.c.post('/caixas', { id: uuid(), terminalId: t1.id, fundoTroco: '10.00' });
  check(r.status === 409 && r.data?.code === 'CAIXA_JA_ABERTO', 'a própria pessoa com caixa aberto: CAIXA_JA_ABERTO (continua no dela)', r.data);
  const bia = await usuarioCom(admin, 'Vendedor', `s6_bia_${sufixo}`, 'Beatriz Teste Rocha');
  const lista = (await bia.c.get('/terminais')).data as any[];
  const doT1 = lista.find((t) => t.id === t1.id), doT2 = lista.find((t) => t.id === t2.id);
  check(JSON.stringify(doT1) === JSON.stringify({ id: t1.id, nome: t1.nome, ativo: true, ocupadoPor: 'Ana' }), 'GET /terminais do Vendedor: o ocupado traz só o primeiro nome (sem caixa, fundo nem hora)', doT1);
  check(JSON.stringify(doT2) === JSON.stringify({ id: t2.id, nome: t2.nome, ativo: true }), 'e o livre, só id, nome e ativo', doT2);
  check(((await ana.c.get('/terminais')).data as any[]).find((t) => t.id === t1.id)?.ocupadoPor === undefined, 'quem ocupa não vê o próprio nome no terminal dele');
  r = await bia.c.post('/caixas', { id: uuid(), terminalId: t1.id, fundoTroco: '10.00' });
  check(r.status === 409 && r.data?.code === 'TERMINAL_OCUPADO' && r.data?.title === `O ${t1.nome} já está aberto com Ana. Escolha outro terminal.`, 'terminal ocupado por outra pessoa: diz qual e com quem (só o primeiro nome)', r.data);
  const caio = await usuarioCom(admin, 'Vendedor', `s6_caio_${sufixo}`, 'Caio Teste', t1.id);
  r = await caio.c.post('/caixas', { id: uuid(), terminalId: t1.id, fundoTroco: '10.00' });
  check(r.status === 409 && r.data?.code === 'TERMINAL_OCUPADO' && r.data?.title?.includes('Peça para Ana fechar o caixa ou fale com o Administrador'), 'dois no mesmo terminal fixo (turnos): o segundo é avisado com quem está', r.data);
  // corrida: dois abrindo o mesmo terminal ao mesmo tempo
  const dani = await usuarioCom(admin, 'Vendedor', `s6_dani_${sufixo}`, 'Daniela Teste');
  const corrida = await Promise.all([bia.c.post('/caixas', { id: uuid(), terminalId: t2.id, fundoTroco: '0.00' }), dani.c.post('/caixas', { id: uuid(), terminalId: t2.id, fundoTroco: '0.00' })]);
  const venceu = corrida.find((x) => x.status === 201), perdeu = corrida.find((x) => x.status !== 201);
  check(venceu && perdeu?.status === 409 && perdeu.data?.code === 'TERMINAL_OCUPADO' && /aberto com (Beatriz|Daniela)\./.test(perdeu.data?.title ?? ''), 'dois abrindo o mesmo terminal ao mesmo tempo: um abre, o outro recebe o nome de quem abriu', corrida.map((x) => [x.status, x.data?.code, x.data?.title]));
  // a mesma pessoa em dois terminais ao mesmo tempo
  const eva = await usuarioCom(admin, 'Vendedor', `s6_eva_${sufixo}`, 'Eva Teste');
  const duas = await Promise.all([eva.c.post('/caixas', { id: uuid(), terminalId: t3.id, fundoTroco: '0.00' }), eva.c.post('/caixas', { id: uuid(), terminalId: t4.id, fundoTroco: '0.00' })]);
  check(duas.filter((x) => x.status === 201).length === 1 && duas.some((x) => x.status === 409 && x.data?.code === 'CAIXA_JA_ABERTO'), 'a mesma pessoa em dois terminais ao mesmo tempo: um abre, o outro é CAIXA_JA_ABERTO (não "aberto com ela mesma")', duas.map((x) => [x.status, x.data?.code]));
  // ao fechar, o terminal fica livre
  check((await ana.c.post(`/caixas/${caixaAna}/fechar`, { id: uuid(), contado: '10.00' })).status === 200, 'Ana fecha o caixa');
  check(((await bia.c.get('/terminais')).data as any[]).find((t) => t.id === t1.id)?.ocupadoPor === undefined, 'terminal liberado ao fechar');
  // o Admin tira o terminal: a pessoa volta a escolher
  r = await admin.patch(`/usuarios/${ana.id}`, { terminalId: null });
  check(r.status === 200 && r.data?.terminalId === null, 'o Admin tira o terminal fixo', r.data);
  r = await ana.c.post('/caixas', { id: uuid(), terminalId: t4.id, fundoTroco: '0.00' });
  check(r.status === 201 || r.data?.code === 'TERMINAL_OCUPADO', 'sem terminal fixo, abre em outro terminal (o 403 some)', r.data);
  r = await admin.patch(`/usuarios/${ana.id}`, { terminalId: uuid() });
  check(r.status === 400, 'terminal inexistente no cadastro: 400', r.data);
  // terminal desativado
  const t5 = await novoTerminal('Caixa E');
  const fabi = await usuarioCom(admin, 'Vendedor', `s6_fabi_${sufixo}`, 'Fabiana Teste', t5.id);
  await admin.patch(`/terminais/${t5.id}`, { ativo: false });
  await fabi.c.login(`s6_fabi_${sufixo}`, 'Sprint6-Senha-2026');
  const meF = (await fabi.c.get('/me')).data;
  check(meF?.terminal?.id === t5.id && meF.terminal.ativo === false, 'terminal fixo desativado: /me avisa (ativo: false) para a tela mandar falar com o Admin', meF?.terminal);
  r = await fabi.c.post('/caixas', { id: uuid(), terminalId: t5.id, fundoTroco: '0.00' });
  check(r.status === 400, 'e não abre caixa nele', r.data);
  r = await admin.patch(`/usuarios/${fabi.id}`, { terminalId: t5.id });
  check(r.status === 400, 'o Admin não define um terminal desativado', r.data);
  // permissões
  const est = (await usuarioCom(admin, 'Estoquista', `s6_est_${sufixo}`, 'Estela Teste')).c;
  check((await est.get('/terminais')).status === 403, 'Estoquista não lista terminais (403)');
  check((await est.patch(`/usuarios/${ana.id}`, { terminalId: t1.id })).status === 403, 'nem define o terminal de alguém (403)');
  check((await bia.c.patch(`/usuarios/${ana.id}`, { terminalId: t1.id })).status === 403, 'nem o Vendedor (403)');

  console.log('S6-22 — cadastro de cliente e de lote: o mesmo id com outros dados é recusado; corrigido depois de um 400, grava');
  const JA_GRAVADO = 'Este cadastro já foi gravado com outros dados';
  const idCli = uuid();
  const cli22 = (nome: string) => ({ id: idCli, nome, telefone: '86988887777', cienciaAviso: true });
  r = await admin.post('/clientes', cli22(`Maria S622 ${sufixo}`));
  check(r.status === 201, 'cliente cadastrado', r.data);
  r = await admin.post('/clientes', cli22(`Maria S622 ${sufixo}`));
  check(r.status === 200 && r.data?.id === idCli, 'reenvio igual devolve o mesmo cliente (não duplica)', r.data);
  r = await admin.post('/clientes', cli22(`Maria Corrigida ${sufixo}`));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO' && r.data?.title === JA_GRAVADO, 'o mesmo id com outro nome: 409 "já gravado com outros dados" (antes: ok com o nome antigo)', r.data);
  const doCli = (await admin.post('/clientes/busca', { termo: `S622 ${sufixo}` })).data;
  check(Array.isArray(doCli) ? doCli.length === 1 : (doCli?.items ?? []).length === 1, 'continua um cliente só', doCli);
  const idCli2 = uuid();
  r = await admin.post('/clientes', { id: idCli2, nome: `Joana S622 ${sufixo}`, telefone: '8888', cienciaAviso: true });
  check(r.status === 400, 'cliente com telefone sem DDD: 400 (não grava nada)', r.data);
  r = await admin.post('/clientes', { id: idCli2, nome: `Joana S622 ${sufixo}`, telefone: '86988886666', cienciaAviso: true });
  check(r.status === 201, 'corrigido e reenviado com o MESMO id: grava (a recusa não guardou a chave)', r.data);
  r = await vend.post('/clientes', cli22(`Maria Outra ${sufixo}`));
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o id de um cliente usado por outra pessoa com outros dados: 409', r.data);

  const parcs = (await admin.get('/parceiros')).data;
  const parc = (Array.isArray(parcs) ? parcs : parcs.items).find((p: any) => p.ativo !== false);
  const outroParc = (Array.isArray(parcs) ? parcs : parcs.items).find((p: any) => p.ativo !== false && p.id !== parc.id);
  const idLote = uuid();
  r = await admin.post('/lotes', { id: idLote, tipo: 'DOACAO' });
  check(r.status === 400 && r.data?.code === 'PARCEIRO_OBRIGATORIO', 'lote sem doador: 400', r.data);
  r = await admin.post('/lotes', { id: idLote, tipo: 'DOACAO', parceiroId: parc.id });
  check(r.status === 201, 'corrigido e reenviado com o MESMO id: o lote nasce', r.data);
  const numeroLote = r.data?.numero;
  r = await admin.post('/lotes', { id: idLote, tipo: 'DOACAO', parceiroId: parc.id });
  check(r.status === 200 && r.data?.numero === numeroLote, 'reenvio igual devolve o mesmo lote', r.data);
  if (outroParc) {
    r = await admin.post('/lotes', { id: idLote, tipo: 'DOACAO', parceiroId: outroParc.id });
    check(r.status === 409 && r.data?.title === JA_GRAVADO, 'o mesmo id com outro doador: 409 (antes: ok com o doador antigo)', r.data);
  } else check(false, 'falta um segundo parceiro para testar o lote');

  const idItem = uuid();
  const item22 = (quantidade: number) => ({ id: idItem, categoriaId: categ?.id ?? (cat.categorias as any[])[0].id, controle: 'CATEGORIA', quantidade, preco: '5.00', valorAtribuido: '1.00', localDestino: 'BAZAR' });
  r = await admin.post(`/lotes/${idLote}/itens`, item22(2));
  check(r.status === 201, 'item cadastrado no lote', r.data);
  r = await admin.post(`/lotes/${idLote}/itens`, item22(2));
  check(r.status === 200 && r.data?.id === idItem, 'reenvio igual devolve o mesmo item', r.data);
  r = await admin.post(`/lotes/${idLote}/itens`, item22(3));
  check(r.status === 409 && r.data?.title === JA_GRAVADO, 'o mesmo id com outra quantidade: 409 (antes: ok com a quantidade antiga)', r.data);
  const doLote = (await admin.get(`/lotes/${idLote}`)).data;
  const itensDoLote = doLote?.itens ?? [];
  check(itensDoLote.filter((i: any) => i.id === idItem).length === 1 && itensDoLote.find((i: any) => i.id === idItem)?.quantidade === 2, 'no lote, um item só, com a quantidade do primeiro envio', itensDoLote.map((i: any) => [i.id === idItem, i.quantidade]));

  console.log('S6-19 — sangria e fechamento às cegas; fechamento definitivo; justificativa depois, uma vez só');
  const semNumero = (d: any) => d && !/\d/.test(`${d.title ?? ''} ${d.detail ?? ''}`);
  const t19 = (await admin.post('/terminais', { id: uuid(), nome: `Cegas ${sufixo}` })).data;
  const cx19 = uuid();
  r = await vend.post('/caixas', { id: cx19, terminalId: t19.id, fundoTroco: '20.00' });
  check(r.status === 201, 'Vendedor abre o caixa com R$ 20,00', r.data);
  r = await vend.post(`/caixas/${cx19}/lancamentos`, { id: uuid(), tipo: 'SANGRIA', valor: '25.00', motivo: 'Acima do que há' });
  check(r.status === 409 && r.data?.code === 'SANGRIA_ACIMA_SALDO' && semNumero(r.data), 'sangria acima do que há: recusada SEM dizer quanto há', r.data);
  const aud = (await admin.get(`/auditoria?acao=SANGRIA_RECUSADA&pageSize=50`)).data?.items ?? [];
  check(aud.some((x: any) => x.entidadeId === cx19), 'a sangria recusada fica na auditoria (gravada fora da transação que recusou)', aud.length);
  check((await vend.post(`/caixas/${cx19}/lancamentos`, { id: uuid(), tipo: 'SANGRIA', valor: '5.00', motivo: 'Dentro do que há' })).status === 204, 'sangria dentro do que há passa (sobram R$ 15,00)');
  for (const [rota, nome] of [[`/caixas/${cx19}/resumo`, 'o total'], [`/caixas/${cx19}/linha-do-tempo`, 'a linha do tempo'], [`/caixas/${cx19}/fechamento.pdf`, 'a parcial em PDF']] as const) {
    r = await vend.get(rota);
    check(r.status === 403 && r.data?.code === 'CAIXA_ABERTO_AS_CEGAS', `o dono do caixa aberto não vê ${nome}`, r.data ?? r.status);
  }
  check((await vend.get(`/caixas/${cx19}/previa-fechamento`)).status === 404, 'a prévia do fechamento não existe mais');
  r = await admin.get(`/caixas/${cx19}/resumo`);
  check(r.status === 200 && r.data?.esperadoDinheiro === '15.00', 'quem não é o dono e vê relatórios vê o esperado do caixa aberto (R$ 15,00)', r.data);
  const hoje19 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  check(((await admin.get(`/painel/admin?de=${hoje19}&ate=${hoje19}`)).data?.caixasAbertos ?? []).some((c: any) => c.id === cx19 && c.esperadoDinheiro === '15.00'), 'o painel do Admin mostra o caixa aberto de outra pessoa com o esperado');
  // fechamento definitivo
  const idF = uuid();
  r = await vend.post(`/caixas/${cx19}/fechar`, { id: idF, contado: '12.00' });
  check(r.status === 200 && r.data?.status === 'FECHADO' && r.data.esperado === '15.00' && r.data.diferenca === '-3.00' && r.data.semJustificativa === true, 'fecha na hora: só agora aparecem o esperado (R$ 15,00) e a diferença (− R$ 3,00)', r.data);
  r = await vend.post(`/caixas/${cx19}/fechar`, { id: idF, contado: '12.00' });
  check(r.status === 200 && r.data?.diferenca === '-3.00', 'reenvio do mesmo fechamento (resposta perdida) devolve o resultado', r.data);
  r = await vend.post(`/caixas/${cx19}/fechar`, { id: idF, contado: '15.00' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outra contagem é recusado (não dá para recontar)', r.data);
  r = await vend.post(`/caixas/${cx19}/fechar`, { id: uuid(), contado: '15.00' });
  check(r.status === 409 && r.data?.code === 'CAIXA_FECHADO', 'nem com outro id: o caixa já fechou', r.data);
  r = await vend.get(`/caixas/${cx19}/resumo`);
  check(r.status === 200 && r.data?.esperadoDinheiro === '15.00', 'depois de fechado, o dono vê o total', r.data);
  check(((await vend.get('/caixas/minhas-pendencias')).data ?? []).some((c: any) => c.id === cx19), 'a justificativa fica pendente (aviso no próximo acesso)');
  // justificativa
  check((await vend.post(`/caixas/${cx19}/justificativa`, { texto: 'oi' })).status === 400, 'justificativa curta: 400');
  r = await caixa.post(`/caixas/${cx19}/justificativa`, { texto: 'Não fui eu que fechei' });
  check(r.status === 403 && r.data?.code === 'JUSTIFICATIVA_DE_OUTRO', 'outra pessoa não justifica (403)', r.data);
  r = await vend.post(`/caixas/${cx19}/justificativa`, { texto: 'Troco dado a mais numa venda' });
  check(r.status === 200 && r.data?.observacao === 'Troco dado a mais numa venda' && !r.data.semJustificativa, 'quem fechou justifica', r.data);
  r = await vend.post(`/caixas/${cx19}/justificativa`, { texto: 'Troco dado a mais numa venda' });
  check(r.status === 200, 'reenvio do mesmo texto: ok (resposta perdida)', r.data);
  r = await vend.post(`/caixas/${cx19}/justificativa`, { texto: 'Mudei de ideia sobre o motivo' });
  check(r.status === 409 && r.data?.code === 'JUSTIFICATIVA_JA_REGISTRADA', 'outra justificativa depois: 409 (uma vez só)', r.data);
  check(!((await vend.get('/caixas/minhas-pendencias')).data ?? []).some((c: any) => c.id === cx19), 'justificado, o aviso some');
  // caixa sem diferença e caixa aberto
  const cx19b = uuid();
  check((await vend.post('/caixas', { id: cx19b, terminalId: t19.id, fundoTroco: '10.00' })).status === 201, 'abre outro caixa (não bloqueia por pendência)');
  r = await vend.post(`/caixas/${cx19b}/justificativa`, { texto: 'Antes de fechar' });
  check(r.status === 409 && r.data?.code === 'CAIXA_ABERTO', 'caixa aberto não recebe justificativa', r.data);
  check((await vend.post(`/caixas/${cx19b}/fechar`, { id: uuid(), contado: '10.00' })).data?.diferenca === '0.00', 'fecha sem diferença');
  r = await vend.post(`/caixas/${cx19b}/justificativa`, { texto: 'Nada a justificar' });
  check(r.status === 409 && r.data?.code === 'SEM_DIFERENCA', 'caixa sem diferença não recebe justificativa', r.data);
  // conta paga com dinheiro do caixa acima do que há: a mesma recusa às cegas
  const atualAdm = await admin.get('/caixas/atual');
  if (atualAdm.status === 200) {
    const cp19 = (await admin.post('/contas-pagar', { id: uuid(), descricao: `Conta cega ${sufixo}`, valor: '9999.00', vencimento: '2026-12-10' })).data;
    r = await admin.post(`/contas-pagar/${cp19.id}/pagar`, { saiuDoCaixa: true });
    check(r.status === 409 && r.data?.code === 'SANGRIA_ACIMA_SALDO' && semNumero(r.data), 'conta paga com o dinheiro do caixa acima do que há: recusada sem número', r.data);
    const c19 = (await admin.get('/contas-pagar?status=ABERTA&pageSize=100')).data.items.find((c: any) => c.id === cp19.id);
    check(c19?.status === 'ABERTA', 'a conta continua aberta', c19);
    check(((await admin.get(`/auditoria?acao=SANGRIA_RECUSADA&pageSize=50`)).data?.items ?? []).some((x: any) => x.entidadeId === atualAdm.data.id), 'e a tentativa fica na auditoria');
  } else check(false, 'o Admin precisa de um caixa aberto (o smoke deixa um)');

  console.log('S6-20 — troco no recebimento do fiado: só a dívida entra no caixa e na conta; o troco é informativo');
  const cli20 = (await admin.post('/clientes', { id: uuid(), nome: `Cliente Troco ${sufixo}`, telefone: '86977776666', cienciaAviso: true })).data;
  const conta20 = async (valor: string) => (await admin.post('/contas-receber', { id: uuid(), clienteId: cli20.id, descricao: `Fiado troco ${sufixo}`, valor, vencimento: '2026-12-10' })).data;
  const saldo20 = async (id: string) => (await admin.get(`/contas-receber?clienteId=${cli20.id}&pageSize=50`)).data?.items?.find((c: any) => c.id === id);
  const cr20 = await conta20('30.00');
  const cxAdm20 = (await admin.get('/caixas/atual')).data;
  // o Admin opera às cegas o próprio caixa: quem confere o esperado é o Financeiro (relatorios.consultar)
  const esperado20 = async () => (await fin.get(`/caixas/${cxAdm20.id}/resumo`)).data?.esperadoDinheiro;
  const antes20 = await esperado20();
  check(typeof antes20 === 'string', 'o Financeiro vê o esperado do caixa aberto do Admin', antes20);
  const idT20 = uuid();
  const receb20 = { id: idT20, valor: '8.00', forma: 'DINHEIRO', valorRecebido: '10.00', caixaId: cxAdm20.id };
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, receb20);
  check(r.status === 201 && r.data?.valor === '8.00' && r.data?.valorRecebido === '10.00' && r.data?.troco === '2.00', 'parcial em dinheiro: recebe R$ 8,00 com R$ 10,00, troco R$ 2,00', r.data);
  check((await saldo20(cr20.id))?.saldo === '22.00', 'a conta abate só a dívida (saldo R$ 22,00)');
  check(centavos(await esperado20()) - centavos(antes20) === 800, 'o esperado da gaveta sobe só R$ 8,00, não os R$ 10,00 recebidos');
  const desc20 = ((await fin.get(`/caixas/${cxAdm20.id}/linha-do-tempo`)).data?.eventos ?? []).find((e: any) => e.tipo === 'RECEBIMENTO_FIADO' && /recebido 10\.00, troco 2\.00/.test(e.descricao));
  check(desc20?.efeitoDinheiro === '8.00', 'a linha do tempo mostra o recebido e o troco, com efeito de R$ 8,00 na gaveta', desc20);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, receb20);
  check(r.status === 200 && r.data?.id === idT20 && r.data?.troco === '2.00', 'reenvio igual devolve o gravado (200)', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { ...receb20, valorRecebido: '20.00' });
  check(r.status === 409 && r.data?.code === 'ID_EM_USO', 'o mesmo id com outro recebido: 409', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '5.00', forma: 'DINHEIRO', valorRecebido: '4.99' });
  check(r.status === 400 && r.data?.code === 'RECEBIDO_INSUFICIENTE', 'recebido menor que o valor: 400', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '5.00', forma: 'PIX', valorRecebido: '6.00' });
  check(r.status === 400 && r.data?.code === 'TROCO_INVALIDO', 'PIX com recebido diferente do valor: 400', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '5.00', forma: 'CARTAO_DEBITO', valorRecebido: '4.00' });
  check(r.status === 400 && r.data?.code === 'TROCO_INVALIDO', 'cartão com recebido diferente do valor: 400', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '5.00', forma: 'DINHEIRO', valorRecebido: '0.00' });
  check(r.status === 400, 'recebido zero: 400', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '5.00', forma: 'PIX', valorRecebido: '5.00' });
  check(r.status === 201 && r.data?.valorRecebido === undefined && r.data?.troco === undefined, 'PIX com recebido igual ao valor passa, sem recebido nem troco gravados', r.data);
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '17.00', forma: 'DINHEIRO', valorRecebido: '20.00' });
  check(r.status === 201 && r.data?.troco === '3.00', 'o recebido pode passar do saldo (R$ 20,00 para R$ 17,00): troco R$ 3,00, fora do caixa', r.data);
  check((await saldo20(cr20.id))?.status === 'QUITADA', 'a conta fica quitada');
  r = await admin.post(`/contas-receber/${cr20.id}/recebimentos`, { id: uuid(), valor: '0.01', forma: 'DINHEIRO', valorRecebido: '50.00' });
  check(r.status === 409 && r.data?.code === 'CONTA_NAO_ABERTA', 'conta quitada não recebe, nem com recebido alto', r.data);
  const cr20b = await conta20('12.50');
  r = await admin.post(`/contas-receber/${cr20b.id}/recebimentos`, { id: uuid(), valor: '12.50', forma: 'DINHEIRO' });
  check(r.status === 201 && r.data?.valorRecebido === '12.50' && r.data?.troco === '0.00', 'dinheiro sem o recebido: o recebido é o próprio valor, troco zero', r.data);
  r = await admin.post(`/contas-receber/${cr20b.id}/recebimentos`, { id: uuid(), valor: '1.00', forma: 'DINHEIRO', valorRecebido: '2.00', troco: '1.00' });
  check(r.status === 400, 'o troco não vem da tela: campo desconhecido é recusado (400)', r.data);
  const ext20 = (await admin.get(`/clientes/${cli20.id}/extrato`)).data;
  check(ext20?.recebimentos?.find((x: any) => x.id === idT20)?.troco === '2.00', 'o extrato mostra o recebido e o troco', ext20?.recebimentos?.find((x: any) => x.id === idT20));
  // estorno: devolve só o valor da dívida, no caixa e na conta
  check((await admin.post(`/recebimentos/${idT20}/estornar`, { motivo: 'Lançado em duplicidade' })).status === 204, 'estorno do recebimento com troco');
  check(centavos(await esperado20()) === centavos(antes20), 'o esperado volta ao que era (sai só R$ 8,00)');
  check((await saldo20(cr20.id))?.saldo === '8.00', 'a conta volta a dever só R$ 8,00');
  r = await vend.post(`/contas-receber/${cr20b.id}/recebimentos`, { id: uuid(), valor: '1.00', forma: 'DINHEIRO', valorRecebido: '2.00' });
  check(r.status === 403, 'o Vendedor não recebe fiado (403)', r.status);

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
