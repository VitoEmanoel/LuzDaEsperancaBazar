/**
 * Sprint 4: etiquetas (S4-01 a S4-05). Tamanho do rolo nos parâmetros, preço normal na etiqueta mesmo com desconto (P-18),
 * qualquer produto ativo (mesmo sem saldo), teto de etiquetas, histórico da impressão na auditoria do produto e quem pode.
 * PDV (S4-09): o servidor recusa mais unidades do que há no Bazar. Dados 100% fictícios.
 * Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:sprint4
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
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Sprint4-Senha-2026' });
  await c.login(login, 'Sprint4-Senha-2026');
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
  const est = await novoUsuario(admin, 'Estoquista', `e4_${sufixo}`);
  const fin = await novoUsuario(admin, 'Financeiro', `f4_${sufixo}`);
  const cat = (await admin.post('/categorias', { id: uuid(), nome: `Sprint4 ${sufixo}`, precoPadrao: '4.00', vendaPorCategoria: false })).data;
  const parc = (await est.post('/parceiros', { id: uuid(), nome: `Doador S4 ${sufixo}`, tipo: 'PESSOA_FISICA' })).data;
  const lote = (await est.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id })).data;
  const item = (nome: string, preco: string, qtd: number) => ({ id: uuid(), categoriaId: cat.id, controle: 'ETIQUETADO', quantidade: qtd, valorAtribuido: '2.00', localDestino: 'BAZAR',
    produto: { tituloEtiqueta: nome, nome: `${nome} ${sufixo}`, preco } });
  const a = (await est.post(`/lotes/${lote.id}/itens`, item('Jarra azul', '20.00', 3))).data;
  const b = (await est.post(`/lotes/${lote.id}/itens`, item('Bandeja', '9.00', 1))).data;
  const pa = a.produto.id as string, pb = b.produto.id as string;

  console.log('Tamanho do rolo (S4-01)');
  const cfg = (await est.get('/etiquetas/config')).data;
  check(cfg.larguraMm === 50 && cfg.alturaMm === 30, 'rolo padrão 50 x 30 mm até a impressora chegar (P-02)', cfg);
  check((await admin.put('/parametros', { valores: [{ chave: 'etiqueta.largura_mm', valor: '10' }] })).data?.code === 'VALIDACAO', 'largura fora da faixa (20 a 120 mm) é recusada');
  check((await admin.put('/parametros', { valores: [{ chave: 'etiqueta.largura_mm', valor: '60' }, { chave: 'etiqueta.altura_mm', valor: '40' }] })).status === 200, 'Admin muda o tamanho do rolo');
  const cfg2 = (await est.get('/etiquetas/config')).data;
  check(cfg2.larguraMm === 60 && cfg2.alturaMm === 40, 'a etiqueta passa a usar o rolo novo', cfg2);
  await admin.put('/parametros', { valores: [{ chave: 'etiqueta.largura_mm', valor: '50' }, { chave: 'etiqueta.altura_mm', valor: '30' }] });

  console.log('Etiqueta do produto (S4-02, P-18)');
  let r = await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 3 }, { produtoId: pb, quantidade: 1 }] });
  check(r.status === 200 && r.data.itens.length === 2 && r.data.itens[0].codigo === a.codigo && r.data.itens[0].titulo === 'Jarra azul' && r.data.itens[0].preco === '20.00' && r.data.itens[0].quantidade === 3,
    'etiqueta com título curto, código e preço, na ordem pedida', r.data);
  check(r.status === 200, 'produto ainda não aprovado (sem saldo no Bazar) também ganha etiqueta', r.status);
  check((await admin.post(`/lotes/${lote.id}/aprovar`)).data?.aprovadosAgora === 2, 'Admin aprova o lote');
  check((await fin.put(`/produtos/${pa}/desconto`, { tipo: 'PRECO', valor: '15.00', motivo: 'Promoção da jarra' })).status === 200, 'Financeiro dá desconto');
  r = await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 1 }] });
  check(r.data?.itens?.[0]?.preco === '20.00', 'com desconto, a etiqueta continua com o preço normal (o desconto aparece no caixa)', r.data);

  console.log('Pedido inválido');
  check((await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 0 }] })).data?.code === 'VALIDACAO', 'quantidade zero é recusada');
  check((await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 300 }, { produtoId: pb, quantidade: 201 }] })).data?.code === 'ETIQUETAS_DEMAIS', 'mais de 500 etiquetas por vez é recusado');
  check((await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 1 }, { produtoId: pa, quantidade: 2 }] })).data?.code === 'VALIDACAO', 'produto repetido no pedido é recusado');
  check((await est.post('/etiquetas/preparar', { produtos: [{ produtoId: uuid(), quantidade: 1 }] })).data?.code === 'VALIDACAO', 'produto inexistente é recusado');
  check((await est.post('/etiquetas/preparar', { produtos: [{ produtoId: pa, quantidade: 1 }], extra: 1 })).data?.code === 'VALIDACAO', 'campo fora da lista é recusado');

  console.log('Histórico da impressão (S4-05)');
  r = await est.post('/etiquetas/impressoes', { produtos: [{ produtoId: pa, quantidade: 2 }] });
  check(r.status === 200 && r.data.itens[0].quantidade === 2 && r.data.larguraMm === 50, 'impressão devolve os dados e o rolo', r.data);
  const ev = ((await admin.get(`/produtos/${pa}`)).data.eventos as any[]).filter((e) => e.tipo === 'ETIQUETAS_IMPRESSAS');
  check(ev.length === 1 && ev[0].depois?.quantidade === 2 && ev[0].depois?.rolo === '50x30' && ev[0].usuarioNome === `Teste e4_${sufixo}`, 'a impressão fica no histórico do produto: quem, quando e quantas', ev);
  const prep = ((await admin.get(`/produtos/${pb}`)).data.eventos as any[]).filter((e) => e.tipo === 'ETIQUETAS_IMPRESSAS');
  check(prep.length === 0, 'só pré-visualizar não vai para o histórico', prep);

  console.log('Quem imprime: Admin e Estoquista');
  check((await fin.get('/etiquetas/config')).status === 403, 'Financeiro não imprime etiquetas');
  check((await caixa.post('/etiquetas/impressoes', { produtos: [{ produtoId: pa, quantidade: 1 }] })).status === 403, 'Vendedor não imprime etiquetas');
  check((await admin.post('/etiquetas/impressoes', { produtos: [{ produtoId: pb, quantidade: 1 }] })).status === 200, 'Admin imprime etiquetas');

  console.log('PDV: mais unidades do que há no Bazar (S4-09)');
  const base = { terminalId: cx.terminalId, caixaId: cx.id };
  const v = await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: a.codigo, quantidade: 4 }], pagamentos: [{ forma: 'PIX', valor: '60.00', valorRecebido: '60.00' }] });
  check(v.status === 409 && v.data?.code === 'SALDO_INSUFICIENTE', '4 unidades com 3 no Bazar: o servidor recusa', v.data);
  const v2 = await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: a.codigo, quantidade: 3 }], pagamentos: [{ forma: 'PIX', valor: '45.00', valorRecebido: '45.00' }] });
  check(v2.status === 201 || v2.status === 200, '3 unidades de uma vez (3*código) vendem com o preço com desconto', v2.data);

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
