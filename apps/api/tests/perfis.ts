/**
 * Bateria de acesso por perfil: cada perfil padrão (Administrador, Estoquista, Vendedor, Financeiro) tenta acessar
 * o que é dele e o que NÃO é, e o servidor decide (403). Também confere as permissões semeadas, o perfil
 * personalizado criado pelo Admin e a proteção dos perfis padrão. Dados 100% fictícios.
 * Rodar DEPOIS do smoke (usa a senha do admin que ele define). Uso: API_URL=... npm run test:perfis
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1';
let falhas = 0, oks = 0;
function check(cond: unknown, nome: string, extra?: unknown) {
  if (cond) { oks++; console.log(`  ✔ ${nome}`); } else { falhas++; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

class Cliente {
  token: string | null = null;
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await r.json().catch(() => null) : null;
    return { status: r.status, data: data as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  async login(login: string, senha: string) {
    const r = await this.post('/auth/login', { login, senha });
    if (r.status === 200) this.token = r.data.accessToken;
    return r;
  }
}

type Perfil = 'admin' | 'estoquista' | 'vendedor' | 'financeiro';
const TODOS: Perfil[] = ['admin', 'estoquista', 'vendedor', 'financeiro'];

/** [método, rota, corpo, quem PODE (os demais devem receber 403)] */
const ACESSOS: [string, string, unknown, Perfil[]][] = [
  ['GET', '/usuarios', undefined, ['admin']],
  ['GET', '/perfis', undefined, ['admin']],
  ['GET', '/auditoria', undefined, ['admin']],
  ['GET', '/parametros', undefined, ['admin']],
  ['GET', '/regras-fiscais', undefined, ['admin']],
  ['POST', '/categorias', {}, ['admin']],
  ['GET', '/lotes', undefined, ['admin', 'estoquista']],
  ['GET', '/estoque', undefined, ['admin', 'estoquista', 'financeiro']],
  ['GET', '/itens/codigo/BZ999999', undefined, TODOS], // leitura de código: PDV (vendedor) e estoque
  ['GET', '/contas-pagar', undefined, ['admin', 'financeiro']],
  ['GET', '/contas-receber', undefined, ['admin', 'financeiro']],
  ['GET', '/financeiro/resumo', undefined, ['admin', 'financeiro']],
  ['GET', '/caixas', undefined, ['admin', 'financeiro']],
  ['GET', '/caixas/atual', undefined, ['vendedor']],
  ['POST', '/caixas', {}, ['vendedor']],
  ['GET', '/pdv/catalogo', undefined, ['vendedor']],
  ['GET', '/vendas', undefined, ['admin', 'vendedor']],
  ['GET', '/terminais', undefined, ['admin', 'vendedor']],
  ['GET', '/relatorios/vendas?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'financeiro']],
  ['GET', '/relatorios/fiado?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'financeiro']],
  ['GET', '/relatorios/estoque?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'estoquista', 'financeiro']],
  ['GET', '/relatorios/descartes?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'estoquista', 'financeiro']],
  ['GET', '/relatorios/transferencias?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'estoquista', 'financeiro']],
];

/** O que cada perfil padrão carrega (a migração 0005). */
const PERMISSOES_ESPERADAS: Record<Perfil, string[]> = {
  admin: [], // calculado: tudo menos caixa.operar
  vendedor: ['caixa.operar', 'clientes.gerenciar'],
  estoquista: ['cadastros.consultar', 'entrada.registrar', 'estoque.consultar', 'estoque.transferir', 'relatorios.estoque'],
  financeiro: ['cadastros.consultar', 'contas_pagar.gerenciar', 'contas_receber.lancar', 'contas_receber.receber', 'estoque.consultar', 'relatorios.consultar', 'relatorios.estoque'],
};

async function novoUsuario(admin: Cliente, login: string, perfilId: string) {
  const u = (await admin.post('/usuarios', { id: uuid(), nome: `Teste ${login}`, login, perfilId })).data;
  const c = new Cliente();
  await c.login(login, u.senhaProvisoria);
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Perfis-Senha-2026-x' });
  const l = await c.login(login, 'Perfis-Senha-2026-x');
  return { cliente: c, me: l.data?.user ?? l.data };
}

async function main() {
  const admin = new Cliente();
  const l = await admin.login('admin', SENHA_ADMIN);
  if (l.status !== 200) throw new Error('Rode o smoke antes (ele define a senha do admin) ou informe ADMIN_SENHA');

  console.log('Perfis padrão e permissões semeadas');
  const perfis = (await admin.get('/perfis')).data as { id: string; nome: string; padrao: boolean; permissoes: string[] }[];
  const porNome = (n: string) => perfis.find((p) => p.nome === n)!;
  const ids: Record<Perfil, string> = { admin: porNome('Administrador')?.id, estoquista: porNome('Estoquista')?.id, vendedor: porNome('Vendedor')?.id, financeiro: porNome('Financeiro')?.id };
  check(Object.values(ids).every(Boolean), 'os 4 perfis padrão existem (Administrador, Estoquista, Vendedor, Financeiro)', perfis.map((p) => p.nome));
  check(!perfis.some((p) => p.nome === 'Caixa' || p.nome === 'Triagem'), 'perfis antigos (Caixa, Triagem) já foram renomeados');
  const todasPerms = ((await admin.get('/permissoes')).data as { codigo: string }[]).map((p) => p.codigo);
  PERMISSOES_ESPERADAS.admin = todasPerms.filter((p) => p !== 'caixa.operar').sort();
  for (const k of TODOS) {
    const reais = [...(porNome({ admin: 'Administrador', estoquista: 'Estoquista', vendedor: 'Vendedor', financeiro: 'Financeiro' }[k])?.permissoes ?? [])].sort();
    check(JSON.stringify(reais) === JSON.stringify([...PERMISSOES_ESPERADAS[k]].sort()), `permissões do perfil ${k} conferem com a matriz`, { reais, esperadas: PERMISSOES_ESPERADAS[k] });
  }
  check(!todasPerms.includes('sincronizacao.resolver'), 'permissão de sincronização não existe mais');

  console.log('Acesso por perfil (o servidor decide)');
  const clientes: Record<Perfil, Cliente> = { admin, estoquista: null as any, vendedor: null as any, financeiro: null as any };
  const sufixo = uuid().slice(0, 6);
  for (const k of ['estoquista', 'vendedor', 'financeiro'] as const) clientes[k] = (await novoUsuario(admin, `p_${k}_${sufixo}`, ids[k])).cliente;
  for (const [metodo, rota, corpo, podem] of ACESSOS) {
    for (const k of TODOS) {
      const r = await clientes[k].req(metodo, rota, corpo);
      const deveria = podem.includes(k);
      check(deveria ? r.status !== 403 : r.status === 403, `${k} ${deveria ? 'acessa' : 'NÃO acessa'} ${metodo} ${rota.split('?')[0]}`, { status: r.status, code: r.data?.code });
    }
  }
  // Relatório fora do grupo de estoque: a recusa vem do servidor mesmo com a permissão de estoque
  check((await clientes.estoquista.get('/relatorios/prestacao-contas?de=2026-01-01&ate=2026-12-31')).status === 403, 'estoquista não vê prestação de contas (receita)');

  console.log('Cada um vê só o seu');
  const vAdm = (await admin.get('/vendas')).data, vVend = (await clientes.vendedor.get('/vendas')).data;
  check(vAdm.total > 0 && vVend.total === 0, 'vendedor só vê as próprias vendas; o Administrador vê todas', { admin: vAdm.total, vendedor: vVend.total });
  const mes = (await clientes.vendedor.get('/caixas/atual'));
  check(mes.status === 404, 'vendedor sem caixa aberto não recebe caixa de outro operador', mes.status);

  console.log('Perfil personalizado criado pelo Admin e proteção dos padrão');
  const novo = (await admin.post('/perfis', { nome: `Conferente ${sufixo}`, permissoes: ['estoque.consultar'] })).data;
  check(novo?.id && novo.padrao === false, 'Admin cria um perfil personalizado', novo);
  const conf = (await novoUsuario(admin, `p_conf_${sufixo}`, novo.id)).cliente;
  check((await conf.get('/estoque')).status !== 403, 'perfil personalizado acessa só o que recebeu (estoque)');
  check((await conf.get('/lotes')).status === 403 && (await conf.get('/contas-pagar')).status === 403, 'perfil personalizado não acessa o que não recebeu');
  check((await admin.patch(`/perfis/${ids.vendedor}`, { nome: 'Outro nome' })).data?.code === 'PERFIL_PADRAO', 'perfil padrão não pode ser renomeado');
  check((await admin.patch(`/perfis/${novo.id}`, { permissoes: ['estoque.consultar', 'lotes.inexistente'] })).status === 400, 'permissão desconhecida é recusada');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
