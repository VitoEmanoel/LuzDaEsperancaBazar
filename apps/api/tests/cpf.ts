/**
 * CPF na venda: validação pelos dígitos, limite mensal em reais por CPF (com saldo), CPF obrigatório decidido pelo Admin,
 * CPF só no comprovante, trava contra duas vendas simultâneas do mesmo CPF e limpeza mensal. Dados 100% fictícios.
 * Rodar DEPOIS do smoke (usa a senha do admin e o caixa aberto do operador caixa1). Uso: API_URL=... npm run test:cpf
 */
import { randomUUID as uuid } from 'node:crypto';
import { prisma } from '../src/shared/prisma.js';
import { inicioDoMes } from '../src/modules/pdv/cpf.service.js';

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
    return { status: r.status, data: (ct.includes('json') ? await r.json().catch(() => null) : null) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  async login(login: string, senha: string) { const r = await this.post('/auth/login', { login, senha }); if (r.status === 200) this.token = r.data.accessToken; return r; }
}

// CPFs fictícios com dígitos verificadores válidos
const CPF_A = '52998224725', CPF_B = '11144477735', CPF_C = '39053344705';
const INVALIDO = '12345678900';

async function main() {
  const admin = new Cliente();
  if ((await admin.login('admin', SENHA_ADMIN)).status !== 200) throw new Error('Rode o smoke antes (ele define a senha do admin) ou informe ADMIN_SENHA');
  const caixa = new Cliente();
  if ((await caixa.login('caixa1', 'Caixa-Senha-2026')).status !== 200) throw new Error('Rode o smoke antes: falta o operador caixa1');
  const cx = await caixa.get('/caixas/atual');
  if (cx.status !== 200) throw new Error('O operador caixa1 precisa de um caixa aberto (o smoke deixa um aberto)');

  // estoque próprio para este teste: 60 unidades de roupa a R$ 10,00
  const parc = (await admin.get('/parceiros')).data.find((p: any) => p.especial);
  const roupa = (await admin.get('/categorias')).data.find((c: any) => c.nome === 'Roupa adulto');
  const lote = (await admin.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id })).data;
  await admin.post(`/lotes/${lote.id}/itens`, { id: uuid(), categoriaId: roupa.id, controle: 'CATEGORIA', quantidade: 60, preco: '10.00', localDestino: 'BAZAR' });
  const definir = async (chave: string, valor: string) => (await admin.put('/parametros', { valores: [{ chave, valor }] })).status;
  const vender = (un: number, cpf?: string) => caixa.put(`/vendas/${uuid()}`, {
    terminalId: cx.data.terminalId, caixaId: cx.data.id, itens: [{ categoriaId: roupa.id, quantidade: un }],
    pagamentos: [{ forma: 'PIX', valor: (un * 10).toFixed(2), valorRecebido: (un * 10).toFixed(2) }], ...(cpf ? { cpf } : {}),
  });
  const saldo = async (cpf: string) => (await caixa.post('/pdv/cpf/saldo', { cpf })).data;
  await definir('cpf.limite_mensal', '0'); await definir('cpf.obrigatorio', '0');

  console.log('Validação do CPF (pelos dígitos)');
  check((await caixa.post('/pdv/cpf/saldo', { cpf: 'abc' })).data?.code === 'CPF_INVALIDO', 'letras não são CPF');
  check((await caixa.post('/pdv/cpf/saldo', { cpf: INVALIDO })).data?.code === 'CPF_INVALIDO', 'CPF com dígitos verificadores errados é recusado');
  check((await caixa.post('/pdv/cpf/saldo', { cpf: '111.111.111-11' })).data?.code === 'CPF_INVALIDO', 'CPF de dígitos repetidos é recusado');
  const sA = await caixa.post('/pdv/cpf/saldo', { cpf: '529.982.247-25' });
  check(sA.status === 200 && sA.data.cpf === CPF_A && sA.data.limite === null && sA.data.saldo === null, 'CPF válido com máscara é aceito e vem só com dígitos; sem limite configurado', sA.data);
  check((await vender(1, INVALIDO)).data?.code === 'CPF_INVALIDO', 'venda com CPF inválido é recusada pelo servidor');

  console.log('CPF só no comprovante');
  const v1 = await vender(1, '529.982.247-25');
  check(v1.status === 201 && v1.data.cpf === CPF_A, 'a venda com CPF volta com o CPF inteiro (para o comprovante)', v1.data);
  check((await caixa.get(`/vendas/${v1.data.id}/comprovante`)).data?.cpf === CPF_A, 'o comprovante traz o CPF inteiro');
  const lista = (await caixa.get('/vendas')).data;
  check(lista.items.length > 0 && lista.items.every((v: any) => v.cpf === undefined), 'as listas de vendas não trazem o CPF');
  const aud = JSON.stringify((await admin.get('/auditoria?pageSize=100')).data);
  check(!aud.includes(CPF_A), 'o CPF não vai para a auditoria');

  console.log('Limite mensal em reais por CPF (R$ 100,00)');
  check(await definir('cpf.limite_mensal', '100') === 200, 'o Admin define o limite em Parâmetros');
  check(await definir('cpf.limite_mensal', 'abc') === 400 && await definir('cpf.obrigatorio', '2') === 400, 'valores inválidos nos parâmetros são recusados');
  let s = await saldo(CPF_B);
  check(s.limite === '100.00' && s.comprado === '0.00' && s.saldo === '100.00', 'CPF novo: saldo cheio', s);
  const vB1 = await vender(6, CPF_B);
  check(vB1.status === 201, 'compra de R$ 60 dentro do limite', vB1.data);
  s = await saldo(CPF_B);
  check(s.comprado === '60.00' && s.saldo === '40.00', 'o saldo do CPF baixa para R$ 40,00', s);
  check((await vender(5, CPF_B)).data?.code === 'LIMITE_CPF', 'compra de R$ 50 passa do saldo de R$ 40: recusada (LIMITE_CPF)');
  const vB2 = await vender(4, CPF_B);
  check(vB2.status === 201, 'compra de R$ 40 usa exatamente o saldo', vB2.data);
  s = await saldo(CPF_B);
  check(s.saldo === '0.00', 'saldo zerado', s);
  check((await vender(1, CPF_B)).data?.code === 'LIMITE_CPF', 'com o saldo zerado nem uma peça passa');
  check((await vender(1)).status === 201, 'sem CPF o limite não vale (o CPF não é obrigatório)');
  check((await admin.post(`/vendas/${vB2.data.id}/cancelar`, { motivo: 'Teste: devolver o saldo do CPF' })).status === 200, 'venda cancelada');
  s = await saldo(CPF_B);
  check(s.comprado === '60.00' && s.saldo === '40.00', 'cancelar a venda devolve o saldo do CPF', s);

  console.log('Duas vendas simultâneas do mesmo CPF não passam juntas do limite');
  const [r1, r2] = await Promise.all([vender(6, CPF_C), vender(6, CPF_C)]);
  check([r1, r2].filter((r) => r.status === 201).length === 1 && [r1, r2].some((r) => r.data?.code === 'LIMITE_CPF'), 'uma passa e a outra é recusada', [r1.status, r1.data?.code, r2.status, r2.data?.code]);

  console.log('CPF obrigatório (decidido pelo Admin)');
  check(await definir('cpf.obrigatorio', '1') === 200, 'o Admin marca o CPF como obrigatório');
  check((await caixa.req('GET', '/pdv/catalogo')).data?.cpfObrigatorio === true && (await caixa.req('GET', '/pdv/catalogo')).data?.cpfLimiteMensal === 100, 'o catálogo do PDV informa que o CPF é obrigatório e o limite');
  check((await vender(1)).data?.code === 'CPF_OBRIGATORIO', 'venda sem CPF é recusada');
  check((await vender(1, CPF_A)).status === 201, 'venda com CPF passa');
  await definir('cpf.obrigatorio', '0');
  check((await vender(1)).status === 201, 'com a opção desligada, a venda sem CPF volta a passar');

  console.log('CPF obrigatório sem limite, e limite em branco');
  check(await definir('cpf.limite_mensal', '') === 200, 'limite em branco é aceito (sem limite)');
  check((await saldo(CPF_A)).limite === null, 'limite em branco = sem limite');
  await definir('cpf.obrigatorio', '1');
  check((await vender(1)).data?.code === 'CPF_OBRIGATORIO', 'obrigatório sem limite: venda sem CPF é recusada');
  check((await vender(1, CPF_A)).status === 201, 'obrigatório sem limite: venda com CPF passa');
  await definir('cpf.obrigatorio', '0'); await definir('cpf.limite_mensal', '100');

  console.log('CPF some no fim do mês');
  await prisma.$executeRaw`UPDATE venda_cpf SET criado_em = now() - interval '40 days' WHERE venda_id = ${vB1.data.id}::uuid`;
  check((await prisma.vendaCpf.findUnique({ where: { vendaId: vB1.data.id } })) !== null, 'o CPF de uma compra de mês passado ainda está na tabela até alguém usar o sistema');
  s = await saldo(CPF_A); // qualquer consulta de CPF dispara a limpeza do primeiro uso do mês
  check((await prisma.vendaCpf.findUnique({ where: { vendaId: vB1.data.id } })) === null, 'o CPF do mês passado foi apagado');
  s = await saldo(CPF_B);
  check(s.comprado === '0.00' && s.saldo === '100.00', 'o saldo do CPF zerou na virada do mês', s);
  check((await admin.post(`/vendas/${vB1.data.id}/cancelar`, { motivo: 'Teste: cancelar depois da virada do mês' })).status === 200, 'cancelar uma venda cujo CPF já foi apagado funciona');
  // borda exata da virada: 1 s antes do início do mês some; 1 s depois fica
  const ant = await vender(1, CPF_A), dep = await vender(1, CPF_A);
  const inicio = inicioDoMes();
  await prisma.$executeRaw`UPDATE venda_cpf SET criado_em = ${new Date(inicio.getTime() - 1000)} WHERE venda_id = ${ant.data.id}::uuid`;
  await prisma.$executeRaw`UPDATE venda_cpf SET criado_em = ${new Date(inicio.getTime() + 1000)} WHERE venda_id = ${dep.data.id}::uuid`;
  await saldo(CPF_A);
  check((await prisma.vendaCpf.findUnique({ where: { vendaId: ant.data.id } })) === null && (await prisma.vendaCpf.findUnique({ where: { vendaId: dep.data.id } })) !== null, 'borda da virada: o CPF de 1 s antes do mês some e o de 1 s depois fica');
  const velho = await caixa.get(`/vendas/${vB1.data.id}/comprovante`);
  check(velho.status === 200 && velho.data.cpf === undefined, 'o comprovante antigo continua abrindo, sem o CPF');

  await definir('cpf.limite_mensal', '0'); await definir('cpf.obrigatorio', '0');
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
