/**
 * API SIMULADA — roteador em memória que imita o Fastify da seção 5.
 * Comportamentos imitados de propósito, para o front lidar com eles desde já:
 *  - toda rota declara permissão; rota sem declaração = 403 (fail secure);
 *  - 401 com token expirado (access de 15 min) e refresh com rotação;
 *  - bloqueio após 5 senhas erradas (429), mensagem genérica no login;
 *  - erros RFC 9457 com requestId e `code` de negócio (409);
 *  - PUT /vendas/:id idempotente, PEPS na venda por categoria, saldo nunca negativo;
 *  - caixaId/terminalId conferidos contra a sessão (anti-IDOR).
 * NADA disto vai para o build de produção (ver main.tsx).
 */
import type { Transport, TransportRequest, TransportResponse } from '../shared/api/http';
import type {
  CatalogoPdv, ContaReceber, FormaPagamento, HistoricoEvento, ItemEstoque, LocalEstoque, Me, Permissao,
  ProblemDetails, RelatorioResposta, Venda, VendaRequest,
} from '../shared/api/types';
import { PERFIL_ADMIN_ID, PERMISSOES } from '../shared/api/types';
import { fromCents, toCents } from '../shared/lib/money';
import { cpfValido, soDigitos } from '../shared/lib/cpf';
import { uuid } from '../shared/lib/uuid';
import { db, FORMAS, type CaixaDb, type ItemDb, type ProdutoDb, type UsuarioDb, type VendaDb } from './db';

// ---------------- infraestrutura ----------------
type Ctx = { user: UsuarioDb; params: Record<string, string>; query: URLSearchParams; body: any; headers: Record<string, string> };
type Handler = (c: Ctx) => TransportResponse | Promise<TransportResponse>;
type Regra = Permissao[] | 'publica' | 'autenticado';
const rotas: { method: string; re: RegExp; keys: string[]; regra: Regra; h: Handler }[] = [];

function rota(method: string, path: string, regra: Regra, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  rotas.push({ method, re, keys, regra, h });
}
const uid = (): string => uuid(); // não crypto.randomUUID direto: ele não existe fora de https/localhost (celular pelo IP da rede)
const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}): TransportResponse =>
  ({ status, headers: { 'content-type': 'application/json', ...headers }, body });
function problem(status: number, title: string, code?: string, detail?: string, errors?: ProblemDetails['errors']): TransportResponse {
  return { status, headers: { 'content-type': 'application/problem+json' }, body: { type: `https://bazar.local/erros/${code ?? status}`, title, status, code, detail, errors, requestId: uid().slice(0, 8) } satisfies ProblemDetails };
}
class Falha extends Error { constructor(public r: TransportResponse) { super('falha'); } }
function falha(status: number, title: string, code?: string, detail?: string): never { throw new Falha(problem(status, title, code, detail)); }
function exigir(cond: unknown, campo: string): void { if (!cond) falha(400, 'Dados inválidos', 'VALIDACAO', `Campo obrigatório ou inválido: ${campo}`); }
function paginar<T>(arr: T[], q: URLSearchParams) {
  const page = Math.max(1, Number(q.get('page') ?? 1));
  const pageSize = Math.min(100, Number(q.get('pageSize') ?? 20));
  return { items: arr.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: arr.length };
}
const perfilDe = (u: UsuarioDb) => db.perfis.find((p) => p.id === u.perfilId)!;
/** Descrição e área de cada permissão (as mesmas da API real: usuarios.routes.ts). */
const DESCRICOES: Record<Permissao, string> = {
  'usuarios.gerenciar': 'Usuários e redefinição de senha', 'perfis.gerenciar': 'Perfis, permissões e limite de desconto',
  'auditoria.consultar': 'Trilha de auditoria', 'cadastros.gerenciar': 'Categorias, parceiros, campanhas, motivos, importação',
  'cadastros.consultar': 'Consultar cadastros', 'clientes.gerenciar': 'Clientes', 'parametros.gerenciar': 'Parâmetros e dados da instituição',
  'entrada.registrar': 'Lotes, cadastro dos produtos do lote, descartes, etiquetas, encerrar o lote', 'triagem.reabrir': 'Reabrir lote, reverter descarte',
  'produtos.aprovar': 'Aprovar ou devolver os produtos cadastrados nos lotes', 'parceiros.criar': 'Criar parceiro (doador) ao registrar o lote',
  'estoque.consultar': 'Estoque, produtos e lotes (só leitura)', 'estoque.transferir': 'Transferir entre bazar e doações',
  'estoque.ajustar': 'Baixa, ajuste de saída, preço da categoria, carga inicial',
  'custo.consultar': 'Ver o custo (valor atribuído) dos produtos e do estoque', 'produtos.preco': 'Alterar o preço de venda do produto',
  'produtos.desconto': 'Dar e encerrar desconto no produto', 'caixa.operar': 'Abrir/fechar caixa, vender, sangria, suprimento',
  'venda.cancelar': 'Cancelar venda', 'venda.desconto_autorizar': 'Desconto acima do limite do perfil', 'terminais.gerenciar': 'Pontos de caixa',
  'contas_pagar.gerenciar': 'Contas a pagar e lote de compra', 'contas_receber.receber': 'Receber fiado, extrato do cliente',
  'contas_receber.lancar': 'Conta a receber manual', 'recebimento.estornar': 'Estornar recebimento',
  'relatorios.consultar': 'Relatórios, prestação de contas, histórico de caixas', 'relatorios.estoque': 'Relatórios de estoque, descartes e transferências',
  'fiscal.gerenciar': 'Regra de imposto', 'privacidade.gerenciar': 'Exportar e anonimizar titulares',
};
const GRUPO_DE: [string, Permissao[]][] = [
  ['Vendas e caixa', ['caixa.operar', 'venda.cancelar', 'venda.desconto_autorizar', 'clientes.gerenciar']],
  ['Entradas e estoque', ['entrada.registrar', 'triagem.reabrir', 'produtos.aprovar', 'parceiros.criar', 'estoque.consultar', 'estoque.transferir', 'estoque.ajustar', 'custo.consultar', 'produtos.preco', 'produtos.desconto', 'cadastros.consultar']],
  ['Financeiro', ['contas_pagar.gerenciar', 'contas_receber.receber', 'contas_receber.lancar', 'recebimento.estornar']],
  ['Relatórios', ['relatorios.consultar', 'relatorios.estoque']],
  ['Administração', ['usuarios.gerenciar', 'perfis.gerenciar', 'auditoria.consultar', 'cadastros.gerenciar', 'parametros.gerenciar', 'terminais.gerenciar', 'fiscal.gerenciar', 'privacidade.gerenciar']],
];
const GRUPOS = Object.fromEntries(GRUPO_DE.flatMap(([g, ps]) => ps.map((p) => [p, g]))) as Record<Permissao, string>;
const nomeUser = (id: string) => db.usuarios.find((u) => u.id === id)?.nome ?? '—';
function auditar(user: UsuarioDb, acao: string, entidade: string, entidadeId: string) {
  // Sem PII: só ids e nome de ação (RN-29).
  db.auditoria.unshift({ id: uid(), ocorridoEm: now(), usuarioNome: user.nome, acao, entidade, entidadeId });
}
const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date(iso));
const noPeriodo = (iso: string, q: URLSearchParams) => {
  const d = localDate(iso);
  return (!q.get('de') || d >= q.get('de')!) && (!q.get('ate') || d <= q.get('ate')!);
};

// ---------------- sessão / tokens ----------------
const ACCESS_TTL = 15 * 60_000;
const access = new Map<string, { userId: string; exp: number }>();
const refresh = new Map<string, { userId: string; familia: string; usado: boolean }>();
/** Simula o cookie HttpOnly: o JS da aplicação NUNCA acessa esta variável. */
let cookieRefresh: string | null = null;
const tentativas = new Map<string, { erros: number; bloqueadoAte: number }>();

function emitirTokens(userId: string, familia = uid()) {
  const at = 'mock.' + uid();
  access.set(at, { userId, exp: Date.now() + ACCESS_TTL });
  const rt = uid();
  refresh.set(rt, { userId, familia, usado: false });
  cookieRefresh = rt;
  return { accessToken: at, expiresIn: ACCESS_TTL / 1000 };
}
function meDe(u: UsuarioDb): Me {
  const p = perfilDe(u);
  return { id: u.id, nome: u.nome, login: u.login, perfil: { id: p.id, nome: p.nome }, permissoes: p.permissoes, limiteDesconto: p.limiteDesconto, trocarSenha: u.trocarSenha };
}

rota('POST', '/auth/login', 'publica', ({ body }) => {
  const login = String(body?.login ?? '').trim().toLowerCase();
  const t = tentativas.get(login) ?? { erros: 0, bloqueadoAte: 0 };
  if (t.bloqueadoAte > Date.now()) return problem(429, 'Muitas tentativas. Tente novamente em alguns minutos.', 'LOGIN_BLOQUEADO');
  const u = db.usuarios.find((x) => x.login === login && x.ativo);
  if (!u || u.senha !== body?.senha) {
    t.erros++;
    if (t.erros >= 5) { t.bloqueadoAte = Date.now() + 10 * 60_000; t.erros = 0; }
    tentativas.set(login, t);
    return problem(401, 'Login ou senha inválidos', 'CREDENCIAIS_INVALIDAS'); // mensagem genérica
  }
  tentativas.delete(login);
  return ok({ ...emitirTokens(u.id), usuario: meDe(u) });
});
rota('POST', '/auth/refresh', 'publica', () => {
  const r = cookieRefresh ? refresh.get(cookieRefresh) : undefined;
  if (!r) return problem(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
  if (r.usado) { // reuso de token antigo => revoga a família inteira
    for (const [k, v] of refresh) if (v.familia === r.familia) refresh.delete(k);
    cookieRefresh = null;
    return problem(401, 'Sessão revogada', 'REFRESH_REUTILIZADO');
  }
  r.usado = true;
  return ok(emitirTokens(r.userId, r.familia));
});
rota('POST', '/auth/logout', 'autenticado', ({ headers }) => {
  access.delete(headers.authorization?.replace('Bearer ', '') ?? '');
  if (cookieRefresh) refresh.delete(cookieRefresh);
  cookieRefresh = null;
  return { status: 204, headers: {}, body: null };
});
rota('PUT', '/auth/senha', 'autenticado', ({ user, body }) => {
  if (user.senha !== body?.senhaAtual) return problem(400, 'Senha atual incorreta', 'SENHA_ATUAL_INVALIDA');
  const nova = String(body?.novaSenha ?? '');
  if (nova.length < 8 || nova === body.senhaAtual) return problem(400, 'A nova senha deve ter no mínimo 8 caracteres e ser diferente da atual', 'SENHA_FRACA');
  user.senha = nova; user.trocarSenha = false;
  auditar(user, 'SENHA_ALTERADA', 'usuario', user.id);
  return { status: 204, headers: {}, body: null };
});
rota('GET', '/me', 'autenticado', ({ user }) => ok(meDe(user)));

// ---------------- ACS: usuários, perfis, auditoria ----------------
const usuarioDto = (u: UsuarioDb) => ({ id: u.id, nome: u.nome, login: u.login, perfilId: u.perfilId, perfilNome: perfilDe(u).nome, ativo: u.ativo });
const senhaProvisoria = () => 'Tmp-' + uid().slice(0, 8);
rota('GET', '/usuarios', ['usuarios.gerenciar'], ({ query }) => {
  const b = (query.get('busca') ?? '').toLowerCase();
  return ok(paginar(db.usuarios.filter((u) => (!b || u.nome.toLowerCase().includes(b) || u.login.includes(b)) && (query.get('ativo') === null || String(u.ativo) === query.get('ativo'))).map(usuarioDto), query));
});
rota('POST', '/usuarios', ['usuarios.gerenciar'], ({ user, body }) => {
  exigir(body?.nome, 'nome'); exigir(body?.login, 'login'); exigir(db.perfis.some((p) => p.id === body?.perfilId), 'perfilId');
  if (db.usuarios.some((u) => u.login === body.login)) return problem(409, 'Login já existe', 'LOGIN_DUPLICADO');
  const senha = senhaProvisoria();
  const u: UsuarioDb = { id: body.id ?? uid(), nome: body.nome, login: String(body.login).toLowerCase(), senha, perfilId: body.perfilId, ativo: true, trocarSenha: true };
  db.usuarios.push(u); auditar(user, 'USUARIO_CRIADO', 'usuario', u.id);
  return ok({ ...usuarioDto(u), senhaProvisoria: senha }, 201);
});
rota('PATCH', '/usuarios/:id', ['usuarios.gerenciar'], ({ user, params, body }) => {
  const u = db.usuarios.find((x) => x.id === params.id); if (!u) return problem(404, 'Usuário não encontrado');
  if (u.id === user.id && body?.ativo === false) return problem(409, 'Você não pode desativar o próprio usuário', 'AUTO_DESATIVACAO');
  Object.assign(u, pick(body, ['nome', 'perfilId', 'ativo'])); auditar(user, 'USUARIO_ALTERADO', 'usuario', u.id);
  return ok(usuarioDto(u));
});
rota('POST', '/usuarios/:id/redefinir-senha', ['usuarios.gerenciar'], ({ user, params }) => {
  const u = db.usuarios.find((x) => x.id === params.id); if (!u) return problem(404, 'Usuário não encontrado');
  u.senha = senhaProvisoria(); u.trocarSenha = true; auditar(user, 'SENHA_REDEFINIDA', 'usuario', u.id);
  return ok({ senhaProvisoria: u.senha });
});
rota('GET', '/perfis', ['perfis.gerenciar', 'usuarios.gerenciar'], () => ok(db.perfis.filter((p) => p.ativo !== false)));
rota('GET', '/permissoes', ['perfis.gerenciar'], () => ok(PERMISSOES.map((c) => ({ codigo: c, descricao: DESCRICOES[c], grupo: GRUPOS[c] }))));
/** Nome de perfil único entre os ativos, sem diferença de maiúsculas (como a API real). */
const nomePerfilUsado = (nome: string, ignorar?: string) => db.perfis.some((p) => p.ativo !== false && p.id !== ignorar && p.nome.trim().toLowerCase() === String(nome).trim().toLowerCase());
rota('POST', '/perfis', ['perfis.gerenciar'], ({ user, body }) => {
  exigir(body?.nome, 'nome');
  if (nomePerfilUsado(body.nome)) return problem(409, 'Já existe um perfil com este nome', 'NOME_DUPLICADO');
  const p = { id: body.id ?? uid(), nome: body.nome, padrao: false, permissoes: (body.permissoes ?? []).filter((x: string) => (PERMISSOES as readonly string[]).includes(x)), limiteDesconto: body.limiteDesconto ?? '0.00' };
  db.perfis.push(p); auditar(user, 'PERFIL_CRIADO', 'perfil', p.id); return ok(p, 201);
});
rota('PATCH', '/perfis/:id', ['perfis.gerenciar'], ({ user, params, body }) => {
  const p = db.perfis.find((x) => x.id === params.id); if (!p) return problem(404, 'Perfil não encontrado');
  if (p.ativo === false) return problem(409, 'O perfil está desativado e não se edita', 'PERFIL_INATIVO');
  if (p.padrao && body?.nome && body.nome !== p.nome) return problem(409, 'Perfis padrão não podem ser renomeados', 'PERFIL_PADRAO');
  if (body?.nome && nomePerfilUsado(body.nome, p.id)) return problem(409, 'Já existe um perfil com este nome', 'NOME_DUPLICADO');
  if (p.id === PERFIL_ADMIN_ID && body?.permissoes && !['usuarios.gerenciar', 'perfis.gerenciar'].every((x) => body.permissoes.includes(x))) {
    return problem(409, 'O perfil Administrador precisa manter usuarios.gerenciar e perfis.gerenciar', 'PERFIL_ADMIN_PROTEGIDO');
  }
  Object.assign(p, pick(body, ['nome', 'permissoes', 'limiteDesconto'])); auditar(user, 'PERFIL_ALTERADO', 'perfil', p.id);
  return ok(p);
});
rota('POST', '/perfis/:id/desativar', ['perfis.gerenciar'], ({ user, params }) => {
  const p = db.perfis.find((x) => x.id === params.id); if (!p) return problem(404, 'Perfil não encontrado');
  if (p.padrao) return problem(409, 'Perfis padrão não são desativados', 'PERFIL_PADRAO');
  if (db.usuarios.some((u) => u.perfilId === p.id && u.ativo)) return problem(409, 'Há usuário ativo com este perfil: troque o perfil dele antes de desativar', 'PERFIL_EM_USO');
  p.ativo = false; auditar(user, 'PERFIL_DESATIVADO', 'perfil', p.id); return ok(p);
});
rota('GET', '/auditoria', ['auditoria.consultar'], ({ query }) => ok(paginar(db.auditoria.filter((a) =>
  (!query.get('acao') || a.acao.includes(query.get('acao')!.toUpperCase())) && (!query.get('entidade') || a.entidade === query.get('entidade')) && noPeriodo(a.ocorridoEm, query)), query)));

function pick(o: any, keys: string[]) { const r: any = {}; keys.forEach((k) => { if (o && k in o) r[k] = o[k]; }); return r; }

// ---------------- CAD ----------------
/** Mesmas regras do servidor (apps/api/src/shared/documento.ts) — a API simulada não pode ser mais permissiva. */
function docValido(d: string): boolean {
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => { const r = pesos.reduce((s, p, i) => s + Number(base[i]) * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) return dv(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[9]) && dv(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[10]);
  return dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) && dv(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
}
const exibirDoc = (d?: string) => (!d ? undefined : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : `•••.•••.••${d.slice(8, 9)}-${d.slice(9)}`);
const erroCampo = (campo: string, mensagem: string) => ({ status: 400, headers: { 'content-type': 'application/problem+json' }, body: { type: 'about:blank', status: 400, title: 'Dados inválidos', code: 'VALIDACAO', detail: `${campo}: ${mensagem}`, errors: [{ campo, mensagem }] } });
function validarCadastro(tipo: string, dados: any, atual?: any): TransportResponse | null {
  if (tipo === 'categorias') {
    const vpc = dados.vendaPorCategoria ?? atual?.vendaPorCategoria; const preco = dados.precoPadrao ?? atual?.precoPadrao;
    if (vpc && !(toCents(preco ?? '0') > 0)) return erroCampo('precoPadrao', 'obrigatório e maior que zero quando a categoria é vendida por categoria');
  }
  if (tipo === 'parceiros' && dados.documento !== undefined && !docValido(String(dados.documento))) return erroCampo('documento', 'CPF/CNPJ inválido (dígito verificador não confere)');
  return null;
}
const dtoCadastro = (tipo: string, x: any) => {
  if (tipo !== 'parceiros') return x;
  const { documento, ...resto } = x; return { ...resto, documentoExibicao: exibirDoc(documento) };
};
const cadastros = { categorias: db.categorias, parceiros: db.parceiros, campanhas: db.campanhas, 'motivos-descarte': db.motivosDescarte, 'motivos-baixa': db.motivosBaixa, 'categorias-despesa': db.categoriasDespesa } as Record<string, { id: string; nome: string; ativo: boolean }[]>;
for (const [tipo, lista] of Object.entries(cadastros)) {
  rota('GET', `/${tipo}`, ['cadastros.consultar', 'cadastros.gerenciar', 'caixa.operar', 'entrada.registrar', 'estoque.consultar', 'contas_pagar.gerenciar'], ({ query }) => {
    const b = (query.get('busca') ?? '').toLowerCase();
    return ok(lista.filter((x) => (!b || x.nome.toLowerCase().includes(b)) && (query.get('ativo') === null || String(x.ativo) === query.get('ativo'))).map((x) => dtoCadastro(tipo, x)));
  });
  rota('POST', `/${tipo}`, tipo === 'parceiros' ? ['cadastros.gerenciar', 'parceiros.criar'] : ['cadastros.gerenciar'], ({ user, body }) => {
    exigir(body?.nome?.trim(), 'nome');
    const ja = lista.find((x) => x.id === body.id); if (ja) return ok(dtoCadastro(tipo, ja)); // reenvio com o mesmo id
    if (lista.some((x) => x.nome.toLowerCase() === body.nome.trim().toLowerCase())) return problem(409, 'Já existe um cadastro com este nome', 'NOME_DUPLICADO');
    const invalido = validarCadastro(tipo, body); if (invalido) return invalido;
    const novo = { ...(tipo === 'parceiros' ? { tipo: 'OUTRO' } : {}), ...body, id: body.id ?? uid(), nome: body.nome.trim(), ativo: true };
    lista.push(novo); auditar(user, 'CADASTRO_CRIADO', tipo, novo.id); return ok(dtoCadastro(tipo, novo), 201);
  });
  rota('PATCH', `/${tipo}/:id`, ['cadastros.gerenciar'], ({ user, params, body }) => {
    const x = lista.find((i) => i.id === params.id); if (!x) return problem(404, 'Registro não encontrado');
    const renomeia = body?.nome !== undefined && body.nome !== x.nome;
    if ((x as any).especial && (body?.ativo === false || renomeia)) return problem(409, 'O parceiro especial não pode ser desativado nem renomeado', 'PARCEIRO_ESPECIAL');
    const invalido = validarCadastro(tipo, body ?? {}, x); if (invalido) return invalido;
    const { id: _ignora, ...resto } = body ?? {};
    Object.assign(x, resto); auditar(user, 'CADASTRO_ALTERADO', tipo, x.id); return ok(dtoCadastro(tipo, x));
  });
}
rota('POST', '/clientes/busca', ['clientes.gerenciar', 'caixa.operar', 'contas_receber.receber', 'privacidade.gerenciar'], ({ body }) => {
  const t = String(body?.termo ?? '').toLowerCase().trim();
  const r = db.clientes.filter((c) => !c.anonimizado && (body?.ativo === undefined || c.ativo === body.ativo) && (!t || c.nome.toLowerCase().includes(t) || c.telefone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '§')));
  return ok(r.slice(0, 50));
});
rota('GET', '/clientes', ['clientes.gerenciar'], () => ok(db.clientes.filter((c) => !c.anonimizado)));
rota('POST', '/clientes', ['clientes.gerenciar', 'caixa.operar'], ({ user, body }) => {
  exigir(body?.nome?.trim(), 'nome'); exigir(/\d{10,11}/.test(String(body?.telefone ?? '').replace(/\D/g, '')), 'telefone');
  exigir(body?.cienciaAviso === true, 'cienciaAviso');
  const existente = db.clientes.find((c) => c.id === body.id); if (existente) return ok(existente); // idempotente
  const c = { id: body.id ?? uid(), nome: body.nome.trim(), telefone: body.telefone, ativo: true, cienciaAviso: true };
  db.clientes.push(c); auditar(user, 'CLIENTE_CRIADO', 'cliente', c.id); return ok(c, 201);
});
rota('PATCH', '/clientes/:id', ['clientes.gerenciar'], ({ user, params, body }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c) return problem(404, 'Cliente não encontrado');
  Object.assign(c, pick(body, ['nome', 'telefone', 'ativo'])); auditar(user, 'CLIENTE_ALTERADO', 'cliente', c.id); return ok(c);
});
rota('GET', '/instituicao', ['parametros.gerenciar', 'caixa.operar'], () => ok(db.instituicao));
rota('PUT', '/instituicao', ['parametros.gerenciar'], ({ user, body }) => { Object.assign(db.instituicao, pick(body, ['nome', 'cnpj', 'endereco', 'telefone'])); auditar(user, 'INSTITUICAO_ALTERADA', 'instituicao', '1'); return ok(db.instituicao); });

// ---------------- ENT / TRI ----------------
const nomeParc = (id?: string) => db.parceiros.find((p) => p.id === id)?.nome;
const nomeCamp = (id?: string) => db.campanhas.find((p) => p.id === id)?.nome;
const nomeCat = (id: string) => db.categorias.find((c) => c.id === id)?.nome ?? '—';
const produtoDto = (p: ProdutoDb) => ({ ...p, preco: fromCents(p.preco) });
function itemLoteDto(i: ItemDb) {
  const p = db.produtos.find((x) => x.id === i.produtoId);
  return {
    id: i.id, controle: i.controle, codigo: i.codigo, descricao: i.descricao, categoriaId: i.categoriaId, categoriaNome: nomeCat(i.categoriaId),
    quantidade: i.quantidadeInicial, preco: fromCents(i.preco), valorAtribuido: fromCents(i.valorAtribuido ?? i.preco), localDestino: i.localInicial,
    status: i.status, motivoDevolucao: i.motivoDevolucao, produto: p ? produtoDto(p) : undefined, criadoPorId: i.criadoPorId,
  };
}
/** Sem a permissão de ver custo (S3-05), o valor atribuído e o valor da compra não saem. */
function semCusto<T extends Record<string, unknown>>(user: UsuarioDb, o: T): T {
  if (perfilDe(user).permissoes.includes('custo.consultar')) return o;
  const { valorAtribuido: _v, valorCompra: _c, ...resto } = o;
  return resto as T;
}
/** Quem cadastrou não aprova nem devolve o próprio item; só o perfil Administrador pode (S3-22). */
const podeConferir = (user: UsuarioDb, i: ItemDb) => user.perfilId === PERFIL_ADMIN_ID || !i.criadoPorId || i.criadoPorId !== user.id;
const LEITURA_LOTES: Permissao[] = ['entrada.registrar', 'produtos.aprovar', 'estoque.consultar'];
function loteDto(l: (typeof db.lotes)[number]) {
  const itens = db.itens.filter((i) => i.loteId === l.id);
  return {
    id: l.id, numero: l.numero, tipo: l.tipo, parceiroId: l.parceiroId, parceiroNome: nomeParc(l.parceiroId), campanhaId: l.campanhaId, campanhaNome: nomeCamp(l.campanhaId),
    documento: l.documento, temAnexo: l.temAnexo, recebidoEm: l.recebidoEm, status: l.status,
    aprovados: itens.filter((i) => i.status === 'APROVADO').reduce((s, i) => s + i.quantidadeInicial, 0),
    pendentes: itens.filter((i) => i.status === 'CADASTRADO').length, devolvidos: itens.filter((i) => i.status === 'DEVOLVIDO').length,
    descartados: db.descartes.filter((d) => d.loteId === l.id && !d.revertido).length,
    valorAtribuido: fromCents(itens.filter((i) => i.status === 'APROVADO').reduce((s, i) => s + (i.valorAtribuido ?? i.preco) * i.quantidadeInicial, 0)),
    valorCompra: l.valorCompra !== undefined ? fromCents(l.valorCompra) : undefined, pago: l.pago,
  };
}
rota('GET', '/lotes', LEITURA_LOTES, ({ user, query }) => ok(paginar(db.lotes
  .filter((l) => (!query.get('parceiroId') || l.parceiroId === query.get('parceiroId')) && (!query.get('campanhaId') || l.campanhaId === query.get('campanhaId')) && (!query.get('status') || l.status === query.get('status')) && noPeriodo(l.recebidoEm, query))
  .sort((a, b) => b.numero - a.numero).map((l) => semCusto(user, loteDto(l))), query)));
rota('GET', '/lotes/:id', LEITURA_LOTES, ({ user, params }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  return ok({
    ...semCusto(user, loteDto(l)),
    itens: db.itens.filter((i) => i.loteId === l.id).map((i) => semCusto(user, itemLoteDto(i))),
    descartes: db.descartes.filter((d) => d.loteId === l.id).map((d) => ({ id: d.id, categoriaNome: nomeCat(d.categoriaId), motivoNome: db.motivosDescarte.find((m) => m.id === d.motivoId)?.nome ?? '—', registradoEm: d.registradoEm, revertido: d.revertido })),
  });
});
rota('POST', '/lotes', ['entrada.registrar'], ({ user, body }) => {
  exigir(['DOACAO', 'COMPRA', 'SALDO_INICIAL'].includes(body?.tipo), 'tipo');
  if (!body.parceiroId) return problem(400, 'Informe o parceiro (doador) do lote', 'PARCEIRO_OBRIGATORIO'); // RN-04 (S2-06): campanha opcional
  if (body.tipo === 'COMPRA') {
    if (!perfilDe(user).permissoes.includes('contas_pagar.gerenciar')) return problem(403, 'Registrar compra exige permissão de contas a pagar');
    exigir(body.valorCompra && toCents(body.valorCompra) > 0, 'valorCompra');
  }
  if (db.lotes.some((l) => l.id === body.id)) return ok(loteDto(db.lotes.find((l) => l.id === body.id)!));
  const l = { id: body.id ?? uid(), numero: ++db.seq.lote, tipo: body.tipo, parceiroId: body.parceiroId || undefined, campanhaId: body.campanhaId || undefined, documento: body.documento, temAnexo: false, recebidoEm: now(), status: 'ABERTO' as const, valorCompra: body.valorCompra ? toCents(body.valorCompra) : undefined, pago: body.pago };
  db.lotes.push(l);
  if (body.tipo === 'COMPRA') db.contasPagar.push({ id: uid(), descricao: `Compra — lote ${l.numero}`, categoriaDespesaId: db.categoriasDespesa[1]!.id, categoriaDespesaNome: db.categoriasDespesa[1]!.nome, valor: body.valorCompra, vencimento: body.vencimento ?? localDate(now()), status: body.pago ? 'PAGA' : 'ABERTA', pagaEm: body.pago ? now() : undefined });
  auditar(user, 'LOTE_CRIADO', 'lote_entrada', l.id); return ok(loteDto(l), 201);
});
rota('POST', '/lotes/:id/documento', ['entrada.registrar'], ({ params, body }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  const f = (body as FormData).get('arquivo') as File | null;
  if (!f) return problem(400, 'Arquivo obrigatório');
  if (f.size > 5 * 1024 * 1024) return problem(413, 'Arquivo maior que 5 MB', 'ANEXO_GRANDE');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return problem(415, 'Tipo de arquivo não aceito (PDF, PNG ou JPEG)', 'TIPO_INVALIDO');
  l.temAnexo = true; return { status: 204, headers: {}, body: null };
});
rota('GET', '/lotes/:id/documento', LEITURA_LOTES, () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: new Blob(['(anexo simulado)'], { type: 'text/plain' }) }));
function loteAberto(id: string) {
  const l = db.lotes.find((x) => x.id === id); if (!l) falha(404, 'Lote não encontrado');
  if (l!.status !== 'ABERTO') falha(409, 'Lote já triado não aceita registros', 'LOTE_TRIADO');
  return l!;
}
let seqCodigo = 100;
rota('POST', '/lotes/:id/itens', ['entrada.registrar'], ({ user, params, body }) => {
  const existente = db.itens.find((i) => i.id === body?.id);
  if (existente) return ok(itemLoteDto(existente)); // reenvio idempotente
  const l = loteAberto(params.id!);
  exigir(db.categorias.some((c) => c.id === body?.categoriaId && c.ativo), 'categoriaId');
  exigir(['ETIQUETADO', 'CATEGORIA'].includes(body.controle), 'controle');
  exigir(Number.isInteger(body.quantidade) && body.quantidade > 0, 'quantidade'); exigir(['BAZAR', 'DOACOES'].includes(body.localDestino), 'localDestino');
  if ((l as any).tipo === 'COMPRA' && !body.valorAtribuido) return erroCampo('valorAtribuido', 'obrigatório em lote de compra (custo unitário)');
  let produto: ProdutoDb | undefined;
  if (body.controle === 'CATEGORIA') exigir(toCents(body.preco ?? '0') > 0 || body.valorAtribuido, 'valorAtribuido');
  else {
    exigir(body.valorAtribuido, 'valorAtribuido');
    if (body.produtoId) {
      produto = db.produtos.find((p) => p.id === body.produtoId); exigir(produto, 'produtoId');
      if (produto!.categoriaId !== body.categoriaId) return problem(409, 'A entrada tem a categoria do produto', 'CATEGORIA_DO_PRODUTO');
      if (produto!.pecaUnica) return problem(409, 'Peça única não recebe nova entrada: cadastre um produto novo', 'PECA_UNICA_ENTRADA');
    } else {
      const p = body.produto ?? {};
      exigir(String(p.tituloEtiqueta ?? '').trim(), 'produto.tituloEtiqueta'); exigir(String(p.nome ?? '').trim(), 'produto.nome'); exigir(toCents(p.preco ?? '0') > 0, 'produto.preco');
      if (p.pecaUnica && body.quantidade !== 1) return problem(400, 'Peça única tem quantidade 1', 'PECA_UNICA_QTD');
      produto = { ...p, id: uid(), codigo: `BZ${String(++seqCodigo).padStart(6, '0')}`, tituloEtiqueta: p.tituloEtiqueta.trim(), nome: p.nome.trim(), categoriaId: body.categoriaId, preco: toCents(p.preco), pecaUnica: !!p.pecaUnica };
      db.produtos.push(produto!);
    }
  }
  const it: ItemDb = {
    id: body.id ?? uid(), codigo: produto?.codigo, descricao: body.descricao?.trim() || produto?.nome || `${nomeCat(body.categoriaId)} (lote ${l.numero})`,
    categoriaId: body.categoriaId, controle: body.controle, preco: produto ? produto.preco : toCents(body.preco ?? body.valorAtribuido),
    valorAtribuido: body.valorAtribuido ? toCents(body.valorAtribuido) : undefined, loteId: l.id, criadoEm: now(), quantidadeInicial: body.quantidade,
    localInicial: body.localDestino, saldo: { BAZAR: 0, DOACOES: 0 }, produtoId: produto?.id, status: 'CADASTRADO', // sem estoque até a aprovação
    criadoPorId: user.id,
  };
  db.itens.push(it); auditar(user, 'ITEM_CADASTRADO', 'item', it.id);
  return ok(itemLoteDto(it), 201);
});
rota('PATCH', '/lotes/:id/itens/:itemId', ['entrada.registrar'], ({ user, params, body }) => {
  const it = db.itens.find((i) => i.id === params.itemId && i.loteId === params.id); if (!it) return problem(404, 'Item não encontrado');
  if (it.status === 'APROVADO') return problem(409, 'Item já aprovado: a correção agora é pelo estoque', 'ITEM_APROVADO');
  const p = db.produtos.find((x) => x.id === it.produtoId);
  const q = body?.quantidade ?? it.quantidadeInicial;
  if (p?.pecaUnica && q !== 1) return problem(400, 'Peça única tem quantidade 1', 'PECA_UNICA_QTD');
  if (p && body?.produto) {
    if (db.itens.some((i) => i.produtoId === p.id && i.id !== it.id)) return problem(409, 'Este produto tem outras entradas: corrija o produto na tela do produto', 'PRODUTO_EM_USO');
    const { preco, ...resto } = body.produto; Object.assign(p, resto); if (preco) { p.preco = toCents(preco); it.preco = p.preco; }
    if (resto.nome) it.descricao = resto.nome;
  }
  it.quantidadeInicial = q;
  if (body?.valorAtribuido !== undefined) it.valorAtribuido = toCents(body.valorAtribuido);
  if (body?.localDestino) it.localInicial = body.localDestino;
  const reenvio = it.status === 'DEVOLVIDO';
  it.status = 'CADASTRADO'; it.motivoDevolucao = undefined;
  auditar(user, reenvio ? 'ITEM_REENVIADO' : 'ITEM_CORRIGIDO', 'item', it.id); return ok(itemLoteDto(it));
});
function aprovarItem(it: ItemDb, user: UsuarioDb) {
  it.status = 'APROVADO'; it.saldo[it.localInicial] += it.quantidadeInicial;
  const l = db.lotes.find((x) => x.id === it.loteId)!;
  db.movs.push({ id: uid(), itemId: it.id, tipo: 'ENTRADA', quantidade: it.quantidadeInicial, local: it.localInicial, ocorridoEm: now(), usuarioNome: user.nome, descricao: `Aprovação do lote ${l.numero}` });
  auditar(user, 'ITEM_APROVADO', 'item', it.id);
}
rota('POST', '/itens/:id/aprovar', ['produtos.aprovar'], ({ user, params }) => {
  const it = db.itens.find((i) => i.id === params.id); if (!it) return problem(404, 'Item não encontrado');
  if (it.status === 'DEVOLVIDO') return problem(409, 'Item devolvido: o estoquista corrige e reenvia antes da aprovação', 'ITEM_DEVOLVIDO');
  if (it.status === 'CADASTRADO' && !podeConferir(user, it)) return problem(409, 'Quem cadastrou o item não aprova nem devolve o próprio cadastro: outra pessoa confere', 'AUTO_APROVACAO');
  if (it.status === 'CADASTRADO') aprovarItem(it, user);
  return ok(itemLoteDto(it));
});
rota('POST', '/itens/:id/devolver', ['produtos.aprovar'], ({ user, params, body }) => {
  const it = db.itens.find((i) => i.id === params.id); if (!it) return problem(404, 'Item não encontrado');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  if (it.status === 'APROVADO') return problem(409, 'Item já aprovado não é devolvido', 'ITEM_APROVADO');
  if (!podeConferir(user, it)) return problem(409, 'Quem cadastrou o item não aprova nem devolve o próprio cadastro: outra pessoa confere', 'AUTO_APROVACAO');
  it.status = 'DEVOLVIDO'; it.motivoDevolucao = body.motivo.trim(); auditar(user, 'ITEM_DEVOLVIDO', 'item', it.id);
  return ok(itemLoteDto(it));
});
rota('POST', '/lotes/:id/aprovar', ['produtos.aprovar'], ({ user, params }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  const todos = db.itens.filter((i) => i.loteId === l.id && i.status === 'CADASTRADO');
  const pend = todos.filter((i) => podeConferir(user, i)); // os próprios ficam para outra pessoa (S3-22)
  pend.forEach((i) => aprovarItem(i, user)); auditar(user, 'LOTE_APROVADO', 'lote_entrada', l.id);
  return ok({ ...semCusto(user, loteDto(l)), aprovadosAgora: pend.length, deixadosParaOutraPessoa: todos.length - pend.length });
});
rota('GET', '/aprovacoes', ['produtos.aprovar'], ({ user, query }) => {
  const status = query.get('status') === 'DEVOLVIDO' ? 'DEVOLVIDO' : 'CADASTRADO';
  return ok(db.itens.filter((i) => i.status === status).map((i) => {
    const l = db.lotes.find((x) => x.id === i.loteId)!;
    return { ...semCusto(user, itemLoteDto(i)), criadoPorNome: i.criadoPorId ? nomeUser(i.criadoPorId) : '—', criadoEm: i.criadoEm,
      loteId: l.id, loteNumero: l.numero, loteTipo: l.tipo, parceiroNome: nomeParc(l.parceiroId), campanhaNome: nomeCamp(l.campanhaId), podeConferir: podeConferir(user, i) };
  }));
});
rota('GET', '/produtos', ['entrada.registrar', 'estoque.consultar', 'produtos.aprovar'], ({ query }) => {
  const b = (query.get('busca') ?? '').trim().toLowerCase();
  return ok(paginar(db.produtos.filter((p) => !b || p.codigo.toLowerCase() === b || p.nome.toLowerCase().includes(b) || p.tituloEtiqueta.toLowerCase().includes(b))
    .map((p) => {
      const its = db.itens.filter((i) => i.produtoId === p.id);
      return { ...produtoDto(p), categoriaNome: nomeCat(p.categoriaId), saldoBazar: its.reduce((s, i) => s + i.saldo.BAZAR, 0), saldoDoacoes: its.reduce((s, i) => s + i.saldo.DOACOES, 0) };
    }), query));
});
rota('POST', '/lotes/:id/descartes', ['entrada.registrar'], ({ params, body }) => {
  const l = loteAberto(params.id!);
  exigir(db.categorias.some((c) => c.id === body?.categoriaId), 'categoriaId'); exigir(db.motivosDescarte.some((m) => m.id === body.motivoId && m.ativo), 'motivoId');
  if (db.descartes.some((d) => d.id === body.id)) return ok({ id: body.id }, 200);
  const d = { id: body.id ?? uid(), loteId: l.id, categoriaId: body.categoriaId, motivoId: body.motivoId, registradoEm: now(), revertido: false };
  db.descartes.push(d); // sem movimentação de estoque (RN-01)
  return ok({ id: d.id, categoriaNome: nomeCat(d.categoriaId), motivoNome: db.motivosDescarte.find((m) => m.id === d.motivoId)!.nome, registradoEm: d.registradoEm, revertido: false }, 201);
});
rota('POST', '/lotes/:id/encerrar', ['entrada.registrar'], ({ user, params }) => { const l = loteAberto(params.id!); l.status = 'TRIADO'; auditar(user, 'LOTE_ENCERRADO', 'lote_entrada', l.id); return ok(loteDto(l)); });
rota('POST', '/lotes/:id/reabrir', ['triagem.reabrir'], ({ user, params, body }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo'); l.status = 'ABERTO'; auditar(user, 'LOTE_REABERTO', 'lote_entrada', l.id); return ok(loteDto(l));
});
rota('POST', '/descartes/:id/reverter', ['triagem.reabrir'], ({ user, params, body }) => {
  const d = db.descartes.find((x) => x.id === params.id); if (!d) return problem(404, 'Descarte não encontrado');
  if (d.revertido) return problem(409, 'Descarte já revertido', 'DESCARTE_REVERTIDO');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  const l = db.lotes.find((x) => x.id === d.loteId)!; l.status = 'ABERTO'; d.revertido = true; // item deve passar por nova triagem
  auditar(user, 'DESCARTE_REVERTIDO', 'descarte', d.id); return { status: 204, headers: {}, body: null };
});
rota('GET', '/etiquetas', ['entrada.registrar'], ({ query }) => {
  const ids = (query.get('itens') ?? '').split(',').filter(Boolean);
  return ok(db.itens.filter((i) => ids.includes(i.id) && i.produtoId).map((i) => { const p = db.produtos.find((x) => x.id === i.produtoId)!; return { itemId: i.id, codigo: p.codigo, descricao: p.tituloEtiqueta, preco: fromCents(p.preco) }; }));
});

// ---------------- EST ----------------
/** Preço efetivo do produto agora (S3-10): a mesma conta de fn_preco_efetivo na API real. */
function efetivo(p: ProdutoDb): number {
  const d = p.desconto;
  if (!d || (d.ate && d.ate < localDate(now()))) return p.preco;
  return d.tipo === 'PERCENTUAL' ? Math.max(1, Math.round((p.preco * (10_000 - d.valor)) / 10_000)) : Math.min(d.valor, p.preco);
}
function itemDto(i: ItemDb, user?: UsuarioDb): ItemEstoque {
  const l = db.lotes.find((x) => x.id === i.loteId)!;
  const p = db.produtos.find((x) => x.id === i.produtoId);
  const preco = p ? efetivo(p) : i.preco;
  return {
    id: i.id, codigo: i.codigo, descricao: i.descricao, categoriaId: i.categoriaId, categoriaNome: nomeCat(i.categoriaId), controle: i.controle,
    preco: fromCents(preco), ...(p && preco < p.preco ? { precoSemDesconto: fromCents(p.preco) } : {}), produtoId: p?.id, pecaUnica: p?.pecaUnica,
    ...(user && perfilDe(user).permissoes.includes('custo.consultar') ? { valorAtribuido: fromCents(i.valorAtribuido ?? i.preco) } : {}),
    loteId: l.id, loteNumero: l.numero, parceiroNome: nomeParc(l.parceiroId), campanhaNome: nomeCamp(l.campanhaId), saldoBazar: i.saldo.BAZAR, saldoDoacoes: i.saldo.DOACOES,
  };
}
function mover(i: ItemDb, local: LocalEstoque, delta: number, tipo: HistoricoEvento['tipo'], user: string, descricao: string) {
  if (i.saldo[local] + delta < 0) falha(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${i.descricao}: saldo ${i.saldo[local]} em ${local}`);
  i.saldo[local] += delta;
  db.movs.push({ id: uid(), itemId: i.id, tipo, quantidade: delta, local, ocorridoEm: now(), usuarioNome: user, descricao });
}
rota('GET', '/estoque', ['estoque.consultar'], ({ user, query }) => {
  const b = (query.get('busca') ?? '').toLowerCase(); const local = query.get('local');
  return ok(paginar(db.itens.filter((i) => {
    const l = db.lotes.find((x) => x.id === i.loteId)!;
    return (i.saldo.BAZAR + i.saldo.DOACOES > 0) && (!local || i.saldo[local as LocalEstoque] > 0) && (!query.get('categoriaId') || i.categoriaId === query.get('categoriaId'))
      && (!query.get('parceiroId') || l.parceiroId === query.get('parceiroId')) && (!query.get('campanhaId') || l.campanhaId === query.get('campanhaId')) && (!query.get('loteId') || l.id === query.get('loteId'))
      && (!b || i.descricao.toLowerCase().includes(b) || (i.codigo ?? '').toLowerCase().includes(b));
  }).map((i) => itemDto(i, user)), query));
});
rota('GET', '/itens/codigo/:codigo', ['estoque.consultar', 'caixa.operar'], ({ user, params }) => {
  const doCodigo = db.itens.filter((x) => x.status === 'APROVADO' && x.codigo === decodeURIComponent(params.codigo!).toUpperCase());
  const i = doCodigo.find((x) => x.saldo.BAZAR > 0) ?? doCodigo[0]; // a entrada que será vendida primeiro
  return i ? ok(itemDto(i, user)) : problem(404, 'Código não encontrado', 'CODIGO_INEXISTENTE');
});
rota('GET', '/itens/:id/historico', ['estoque.consultar'], ({ user, params }) => {
  const i = db.itens.find((x) => x.id === params.id); if (!i) return problem(404, 'Item não encontrado');
  const l = db.lotes.find((x) => x.id === i.loteId)!;
  const eventos: HistoricoEvento[] = [
    { ocorridoEm: l.recebidoEm, tipo: 'TRIAGEM' as const, descricao: `Lote ${l.numero} recebido — ${nomeParc(l.parceiroId) ?? nomeCamp(l.campanhaId)}`, quantidade: 0 },
    ...db.movs.filter((m) => m.itemId === i.id).map((m) => ({ ocorridoEm: m.ocorridoEm, tipo: m.tipo, descricao: m.descricao, quantidade: m.quantidade, local: m.local, usuarioNome: m.usuarioNome })),
  ].sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm));
  return ok({ item: itemDto(i, user), eventos });
});
function acharItem(body: any) {
  const i = body?.itemId ? db.itens.find((x) => x.id === body.itemId) : db.itens.find((x) => x.codigo === String(body?.codigo ?? '').toUpperCase());
  if (!i) falha(404, 'Item não encontrado', 'ITEM_INEXISTENTE'); return i!;
}
const jaFeito = new Set<string>(); // idempotência genérica de escritas com id do cliente
function idem(id: string | undefined) { if (id && jaFeito.has(id)) return true; if (id) jaFeito.add(id); return false; }
rota('POST', '/transferencias', ['estoque.transferir'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  const i = acharItem(body); const q = Number(body.quantidade);
  exigir(Number.isInteger(q) && q > 0, 'quantidade'); exigir(body.origem !== body.destino, 'destino');
  mover(i, body.origem, -q, 'TRANSFERENCIA', user.nome, `Transferência ${body.origem} → ${body.destino}${body.motivo ? ` (${body.motivo})` : ''}`);
  mover(i, body.destino, q, 'TRANSFERENCIA', user.nome, `Transferência ${body.origem} → ${body.destino}`);
  auditar(user, 'TRANSFERENCIA', 'item', i.id); return { status: 204, headers: {}, body: null };
});
rota('POST', '/baixas', ['estoque.ajustar'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  const i = acharItem(body); const m = db.motivosBaixa.find((x) => x.id === body.motivoId); exigir(m, 'motivoId');
  mover(i, body.local, -Number(body.quantidade), 'BAIXA', user.nome, `Baixa: ${m!.nome}`); auditar(user, 'BAIXA', 'item', i.id);
  return { status: 204, headers: {}, body: null };
});
rota('POST', '/ajustes', ['estoque.ajustar'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  // S3-03: o ajuste de inventário é só de saída
  exigir(body?.tipo === undefined || body.tipo === 'AJUSTE_SAIDA', 'tipo');
  const i = acharItem(body); exigir(String(body.motivo ?? '').trim().length >= 5, 'motivo');
  const q = -Number(body.quantidade); body.tipo = 'AJUSTE_SAIDA';
  mover(i, body.local, q, body.tipo, user.nome, `Ajuste de inventário: ${body.motivo}`); auditar(user, body.tipo, 'item', i.id);
  return { status: 204, headers: {}, body: null };
});
/** Preço do produto (S3-08): vale para todas as entradas; se não ficar acima do promocional, a promoção acaba. */
function mudarPreco(user: UsuarioDb, p: ProdutoDb, body: any): TransportResponse {
  const c = toCents(body?.preco ?? 0); exigir(c > 0, 'preco'); exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  const antes = p.preco;
  p.preco = c; db.itens.filter((x) => x.produtoId === p.id).forEach((x) => { x.preco = p.preco; });
  const encerrado = p.desconto?.tipo === 'PRECO' && p.desconto.valor >= c ? p.desconto : undefined;
  historicoProduto(p.id, user, 'PRECO_PRODUTO', { preco: fromCents(antes) }, { preco: fromCents(c), motivo: body.motivo.trim() });
  auditar(user, 'PRECO_PRODUTO', 'produto', p.id);
  if (encerrado) {
    p.desconto = undefined;
    historicoProduto(p.id, user, 'DESCONTO_PRODUTO_ENCERRADO', { tipo: 'PRECO', valor: fromCents(encerrado.valor) }, { motivo: 'O preço novo ficou igual ou abaixo do preço promocional' });
    auditar(user, 'DESCONTO_PRODUTO_ENCERRADO', 'produto', p.id);
  }
  return { status: 204, headers: {}, body: null };
}
rota('PATCH', '/itens/:id/preco', ['produtos.preco'], ({ user, params, body }) => {
  const i = db.itens.find((x) => x.id === params.id); if (!i) return problem(404, 'Item não encontrado');
  const p = db.produtos.find((x) => x.id === i.produtoId); if (!p) return problem(409, 'Item por categoria usa o preço padrão da categoria', 'PRECO_DA_CATEGORIA');
  return mudarPreco(user, p, body);
});
// ---------------- produto (S3-04, S3-08, S3-09) ----------------
const eventosProduto = new Map<string, { ocorridoEm: string; tipo: string; usuarioNome: string; antes?: Record<string, unknown>; depois?: Record<string, unknown> }[]>();
function historicoProduto(id: string, user: UsuarioDb, tipo: string, antes?: Record<string, unknown>, depois?: Record<string, unknown>) {
  eventosProduto.set(id, [...(eventosProduto.get(id) ?? []), { ocorridoEm: now(), tipo, usuarioNome: user.nome, antes, depois }]);
}
rota('GET', '/produtos/:id', ['estoque.consultar', 'entrada.registrar', 'produtos.aprovar'], ({ user, params }) => {
  const p = db.produtos.find((x) => x.id === params.id); if (!p) return problem(404, 'Produto não encontrado');
  const verCusto = perfilDe(user).permissoes.includes('custo.consultar');
  const its = db.itens.filter((i) => i.produtoId === p.id);
  const entradas = its.map((i) => {
    const l = db.lotes.find((x) => x.id === i.loteId)!;
    return { itemId: i.id, loteId: l.id, loteNumero: l.numero, recebidoEm: l.recebidoEm, origem: [nomeParc(l.parceiroId), nomeCamp(l.campanhaId)].filter(Boolean).join(' · ') || undefined,
      status: i.status, quantidade: i.quantidadeInicial, saldoBazar: i.saldo.BAZAR, saldoDoacoes: i.saldo.DOACOES, ...(verCusto ? { valorAtribuido: fromCents(i.valorAtribuido ?? i.preco) } : {}) };
  });
  const LOCAL_MOV: Record<string, 'origem' | 'destino'> = {};
  const eventos = [
    ...db.movs.filter((m) => its.some((i) => i.id === m.itemId)).map((m) => ({
      ocorridoEm: m.ocorridoEm, tipo: m.tipo, usuarioNome: m.usuarioNome, loteNumero: db.lotes.find((l) => l.id === its.find((i) => i.id === m.itemId)!.loteId)!.numero,
      quantidade: Math.abs(m.quantidade), [LOCAL_MOV[m.tipo] ?? (m.quantidade < 0 ? 'origem' : 'destino')]: m.local, detalhe: m.descricao,
    })),
    ...(eventosProduto.get(p.id) ?? []),
  ].sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm));
  const d = p.desconto;
  return ok({
    ...produtoDto(p), desconto: undefined, categoriaNome: nomeCat(p.categoriaId), precoEfetivo: fromCents(efetivo(p)), ativo: true, criadoEm: its[0]?.criadoEm ?? now(),
    ...(d ? { desconto: { tipo: d.tipo, valor: fromCents(d.valor), ate: d.ate, motivo: d.motivo, porNome: d.porNome, em: d.em, vigente: !d.ate || d.ate >= localDate(now()) } } : {}),
    saldoBazar: entradas.reduce((s, e) => s + e.saldoBazar, 0), saldoDoacoes: entradas.reduce((s, e) => s + e.saldoDoacoes, 0), entradas, eventos,
  });
});
rota('PATCH', '/produtos/:id', ['entrada.registrar'], ({ user, params, body }) => {
  const p = db.produtos.find((x) => x.id === params.id); if (!p) return problem(404, 'Produto não encontrado');
  const campos = pick(body, ['tituloEtiqueta', 'nome', 'modelo', 'marca', 'ano', 'tipo', 'tamanho', 'cor', 'condicao']);
  if (!Object.keys(campos).length || Object.keys(body ?? {}).some((k) => !(k in campos))) return problem(400, 'Dados inválidos', 'VALIDACAO');
  const antes = pick(p, Object.keys(campos));
  Object.assign(p, Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v ?? undefined])));
  if (campos.nome) db.itens.filter((i) => i.produtoId === p.id && i.controle === 'ETIQUETADO').forEach((i) => { i.descricao = p.nome; });
  historicoProduto(p.id, user, 'PRODUTO_ALTERADO', antes, campos); auditar(user, 'PRODUTO_ALTERADO', 'produto', p.id);
  return { status: 204, headers: {}, body: null };
});
rota('PATCH', '/produtos/:id/preco', ['produtos.preco'], ({ user, params, body }) => {
  const p = db.produtos.find((x) => x.id === params.id); if (!p) return problem(404, 'Produto não encontrado');
  return mudarPreco(user, p, body);
});
rota('PUT', '/produtos/:id/desconto', ['produtos.desconto'], ({ user, params, body }) => {
  const p = db.produtos.find((x) => x.id === params.id); if (!p) return problem(404, 'Produto não encontrado');
  const v = toCents(body?.valor ?? 0);
  exigir(body?.tipo === 'PERCENTUAL' || body?.tipo === 'PRECO', 'tipo');
  exigir(v > 0 && (body.tipo === 'PERCENTUAL' ? v < 10_000 : v < p.preco), 'valor');
  exigir(!body.ate || body.ate >= localDate(now()), 'ate');
  exigir(String(body.motivo ?? '').trim().length >= 5, 'motivo');
  p.desconto = { tipo: body.tipo, valor: v, ate: body.ate || undefined, motivo: body.motivo.trim(), porNome: user.nome, em: now() };
  historicoProduto(p.id, user, 'DESCONTO_PRODUTO', undefined, { tipo: body.tipo, valor: fromCents(v), ate: body.ate, motivo: body.motivo.trim() });
  auditar(user, 'DESCONTO_PRODUTO', 'produto', p.id); return ok({ ok: true });
});
rota('POST', '/produtos/:id/desconto/encerrar', ['produtos.desconto'], ({ user, params, body }) => {
  const p = db.produtos.find((x) => x.id === params.id); if (!p) return problem(404, 'Produto não encontrado');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  if (!p.desconto) return problem(409, 'O produto não tem desconto', 'SEM_DESCONTO');
  p.desconto = undefined; historicoProduto(p.id, user, 'DESCONTO_PRODUTO_ENCERRADO', undefined, { motivo: body.motivo.trim() });
  auditar(user, 'DESCONTO_PRODUTO_ENCERRADO', 'produto', p.id); return { status: 204, headers: {}, body: null };
});
rota('PATCH', '/categorias/:id/preco', ['estoque.ajustar'], ({ user, params, body }) => {
  const c = db.categorias.find((x) => x.id === params.id); if (!c) return problem(404, 'Categoria não encontrada');
  exigir(toCents(body?.preco ?? 0) > 0, 'preco'); exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  c.precoPadrao = fromCents(toCents(body.preco)); db.itens.filter((i) => i.categoriaId === c.id && i.controle === 'CATEGORIA').forEach((i) => { i.preco = toCents(body.preco); });
  auditar(user, 'PRECO_CATEGORIA', 'categoria', c.id); return { status: 204, headers: {}, body: null };
});
rota('POST', '/carga-inicial', ['estoque.ajustar'], ({ body }) => {
  const f = (body as FormData).get('arquivo') as File | null; if (!f) return problem(400, 'Arquivo obrigatório');
  // Simulação: sempre devolve 2 erros por linha e NÃO grava nada (tudo ou nada).
  return ok({ gravado: false, linhas: 12, erros: [{ linha: 4, mensagem: 'Categoria "Brinquedos" não cadastrada' }, { linha: 9, mensagem: 'Preço inválido: "dez"' }] });
});

// ---------------- PDV ----------------
rota('GET', '/pdv/catalogo', ['caixa.operar'], ({ headers }) => {
  const cat: CatalogoPdv = {
    versao: '',
    categorias: db.categorias.filter((c) => c.ativo && c.vendaPorCategoria).map((c) => ({
      ...c, saldoBazar: db.itens.filter((i) => i.controle === 'CATEGORIA' && i.categoriaId === c.id).reduce((s, i) => s + i.saldo.BAZAR, 0),
    })),
    // um por produto com saldo no Bazar, somando as entradas aprovadas
    itensEtiquetados: db.produtos.map((p) => ({ p, saldo: db.itens.filter((i) => i.produtoId === p.id).reduce((s, i) => s + i.saldo.BAZAR, 0) }))
      .filter((x) => x.saldo > 0).map(({ p, saldo }) => ({ itemId: p.id, codigo: p.codigo, descricao: p.nome, preco: fromCents(efetivo(p)), ...(efetivo(p) < p.preco ? { precoSemDesconto: fromCents(p.preco) } : {}), saldoBazar: saldo, pecaUnica: p.pecaUnica })),
    clientesFiado: db.clientes.filter((c) => c.ativo && !c.anonimizado).map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone })),
    regrasFiscais: db.regrasFiscais.filter((r) => !r.vigenciaFim),
    cpfObrigatorio: cpfConfig().obrigatorio, cpfLimiteMensal: cpfConfig().limiteCents / 100,
  };
  const etag = `"${hash(JSON.stringify(cat))}"`;
  if (headers['if-none-match'] === etag) return { status: 304, headers: { etag }, body: null };
  cat.versao = etag; return ok(cat, 200, { etag });
});
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

/** Regra da venda (o servidor real faz isso numa transação única conferida no COMMIT). */
function processarVenda(id: string, req: VendaRequest, user: UsuarioDb): VendaDb {
  const existente = db.vendas.find((v) => v.id === id); if (existente) return existente; // idempotência
  const caixa = db.caixas.find((c) => c.id === req.caixaId);
  if (!caixa) falha(404, 'Caixa não encontrado', 'CAIXA_INEXISTENTE');
  if (caixa!.operadorId !== user.id || caixa!.terminalId !== req.terminalId) falha(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR'); // anti-IDOR
  if (caixa!.status !== 'ABERTO') falha(409, 'Caixa fechado', 'CAIXA_FECHADO');
  if (!req.itens?.length) falha(400, 'Venda sem itens', 'VENDA_VAZIA');
  // Snapshot para desfazer se algo falhar (simula ROLLBACK).
  const snap = db.itens.map((i) => ({ i, s: { ...i.saldo } })); const movLen = db.movs.length;
  try {
    const alocacoes: VendaDb['alocacoes'] = []; const linhas: Venda['itens'] = [];
    // o mesmo código repetido soma (como na API real): uma linha por produto
    const itensReq: VendaRequest['itens'] = [];
    for (const it of req.itens) {
      const igual = 'codigo' in it ? itensReq.find((x) => 'codigo' in x && x.codigo.toUpperCase() === it.codigo.toUpperCase()) : undefined;
      if (igual) igual.quantidade += it.quantidade; else itensReq.push({ ...it });
    }
    for (const it of itensReq) {
      if ('codigo' in it) {
        // produto pelo código: PEPS entre as entradas aprovadas com saldo no Bazar (S2-10)
        const p = db.produtos.find((x) => x.codigo === it.codigo.toUpperCase());
        if (!p) falha(409, 'Código não encontrado', 'CODIGO_INEXISTENTE', it.codigo);
        if (p!.pecaUnica && it.quantidade > 1) falha(409, 'A mesma peça aparece duas vezes na venda', 'CODIGO_DUPLICADO', it.codigo);
        const doProduto = db.itens.filter((x) => x.produtoId === p!.id && x.status === 'APROVADO');
        const cand = doProduto.filter((x) => x.saldo.BAZAR > 0).sort((a, b) => {
          const la = db.lotes.find((l) => l.id === a.loteId)!, lb = db.lotes.find((l) => l.id === b.loteId)!;
          return la.recebidoEm.localeCompare(lb.recebidoEm) || la.numero - lb.numero || a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id);
        });
        if (!cand.length) {
          if (doProduto.some((x) => x.saldo.DOACOES > 0)) falha(409, 'Peça está no estoque de doações — transfira antes de vender', 'ITEM_EM_DOACOES', it.codigo);
          falha(409, 'Peça indisponível (já vendida ou baixada)', 'ITEM_INDISPONIVEL', it.codigo);
        }
        let resta = it.quantidade;
        for (const i of cand) {
          if (!resta) break; const q = Math.min(resta, i.saldo.BAZAR);
          mover(i, 'BAZAR', -q, 'VENDA', user.nome, 'Venda');
          // preço com o desconto vigente do produto (S3-10); o de tabela fica para o relatório (S3-11)
          const pu = efetivo(p!);
          alocacoes.push({ itemId: i.id, quantidade: q, precoUnit: pu, ...(pu < p!.preco ? { precoTabela: p!.preco } : {}) }); resta -= q;
          linhas.push({ descricao: p!.nome, quantidade: q, precoUnitario: fromCents(pu), total: fromCents(pu * q), loteNumero: db.lotes.find((l) => l.id === i.loteId)!.numero });
        }
        if (resta > 0) falha(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${p!.nome}: faltam ${resta}`);
      } else {
        let resta = it.quantidade; exigir(resta > 0, 'quantidade');
        // PEPS: lote mais antigo primeiro, desempate fixo (data do lote, número, criação do item, id).
        const cand = db.itens.filter((i) => i.categoriaId === it.categoriaId && i.controle === 'CATEGORIA' && i.status === 'APROVADO' && i.saldo.BAZAR > 0).sort((a, b) => {
          const la = db.lotes.find((l) => l.id === a.loteId)!, lb = db.lotes.find((l) => l.id === b.loteId)!;
          return la.recebidoEm.localeCompare(lb.recebidoEm) || la.numero - lb.numero || a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id);
        });
        for (const i of cand) {
          if (!resta) break; const q = Math.min(resta, i.saldo.BAZAR);
          mover(i, 'BAZAR', -q, 'VENDA', user.nome, 'Venda por categoria (PEPS)');
          alocacoes.push({ itemId: i.id, quantidade: q, precoUnit: i.preco }); resta -= q;
          linhas.push({ descricao: nomeCat(i.categoriaId), quantidade: q, precoUnitario: fromCents(i.preco), total: fromCents(i.preco * q), loteNumero: db.lotes.find((l) => l.id === i.loteId)!.numero });
        }
        if (resta > 0) falha(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${nomeCat(it.categoriaId)}: faltam ${resta}`);
      }
    }
    const subtotal = alocacoes.reduce((s, a) => s + a.precoUnit * a.quantidade, 0);
    const desconto = req.desconto ? toCents(req.desconto) : 0;
    const limite = toCents(perfilDe(user).limiteDesconto); // em % * 100
    if (desconto < 0 || desconto > subtotal) falha(400, 'Desconto inválido', 'DESCONTO_INVALIDO');
    if (subtotal && (desconto * 10000) / subtotal > limite) falha(409, 'Desconto acima do limite do perfil', 'DESCONTO_ACIMA_LIMITE');
    const total = subtotal - desconto;
    // CPF da compra: validado pelos dígitos; o Admin decide se é obrigatório e qual o limite mensal em reais
    const cfgCpf = cpfConfig();
    let cpf: string | undefined;
    if (req.cpf) { const d = soDigitos(req.cpf); if (!cpfValido(d)) falha(400, 'CPF inválido', 'CPF_INVALIDO'); cpf = d; }
    else if (cfgCpf.obrigatorio) falha(400, 'Informe o CPF: o Administrador marcou o CPF como obrigatório na venda', 'CPF_OBRIGATORIO');
    if (cpf && cfgCpf.limiteCents > 0 && compradoCpf(cpf) + total > cfgCpf.limiteCents) {
      falha(409, 'Limite de compras por CPF no mês excedido', 'LIMITE_CPF', `Limite de R$ ${fromCents(cfgCpf.limiteCents)} por CPF no mês: já comprou R$ ${fromCents(compradoCpf(cpf))}`);
    }
    const pagos = req.pagamentos.reduce((s, p) => s + toCents(p.valor), 0);
    if (pagos !== total) falha(409, 'Pagamentos não fecham com o total recalculado', 'PAGAMENTO_DIVERGENTE', `Total ${fromCents(total)}, pago ${fromCents(pagos)}`);
    // Valor recebido obrigatório em dinheiro, PIX e cartão; troco só em dinheiro; fiado não tem valor recebido.
    let troco = 0;
    for (const p of req.pagamentos) {
      if (p.forma === 'FIADO') { if (p.valorRecebido) falha(400, 'Fiado não tem valor recebido: o valor é o que fica na conta do cliente', 'FIADO_COM_RECEBIDO'); continue; }
      if (!p.valorRecebido) falha(400, 'Informe o valor recebido em cada forma de pagamento', 'RECEBIDO_OBRIGATORIO');
      const r = toCents(p.valorRecebido), v = toCents(p.valor);
      if (p.forma === 'DINHEIRO') { if (r < v) falha(400, 'Valor recebido menor que o valor em dinheiro', 'RECEBIDO_INSUFICIENTE'); troco += r - v; }
      else if (r !== v) falha(400, 'PIX e cartão não têm troco: o valor recebido deve ser igual ao valor da forma', 'TROCO_INVALIDO');
    }
    const fiado = req.pagamentos.find((p) => p.forma === 'FIADO');
    const cliente = db.clientes.find((c) => c.id === req.clienteId);
    if (fiado && (!cliente || !req.vencimentoFiado)) falha(400, 'Fiado exige cliente e vencimento', 'FIADO_SEM_CLIENTE');
    const v: VendaDb = {
      id, numero: ++db.seq.venda, ...(cpf ? { cpf } : {}), ocorridaEm: now(), status: 'CONCLUIDA',
      subtotal: fromCents(subtotal), desconto: fromCents(desconto), total: fromCents(total), troco: fromCents(troco), itens: linhas, pagamentos: req.pagamentos,
      operadorNome: user.nome, clienteNome: cliente?.nome, clienteId: cliente?.id, vencimentoFiado: req.vencimentoFiado,
      caixaId: req.caixaId, terminalId: req.terminalId, operadorId: user.id, alocacoes,
    };
    db.vendas.push(v);
    if (fiado) db.contasReceber.push({ id: uid(), clienteId: cliente!.id, clienteNome: cliente!.nome, vendaNumero: v.numero!, valor: fiado.valor, saldo: fiado.valor, vencimento: req.vencimentoFiado!, status: 'ABERTA' });
    return v;
  } catch (e) {
    snap.forEach(({ i, s }) => { i.saldo = s; }); db.movs.length = movLen; throw e;
  }
}
/** Opções do Administrador sobre o CPF (Parâmetros). */
function cpfConfig() {
  const num = (k: string) => Number(db.parametros.find((p) => p.chave === k)?.valor ?? 0) || 0;
  return { limiteCents: Math.round(num('cpf.limite_mensal') * 100), obrigatorio: num('cpf.obrigatorio') === 1 };
}
/** O que o CPF já comprou neste mês (venda cancelada devolve o saldo). */
const compradoCpf = (cpf: string) => db.vendas.filter((v) => v.cpf === cpf && v.status === 'CONCLUIDA' && v.ocorridaEm.slice(0, 7) === now().slice(0, 7)).reduce((s, v) => s + toCents(v.total), 0);
/** O CPF só sai no comprovante e na resposta da venda, nunca nas listas. */
const semCpf = ({ cpf: _cpf, ...v }: Venda): Venda => v;
const vendaDto = ({ caixaId: _c, terminalId: _t, operadorId: _o, alocacoes: _a, clienteId: _cl, ...v }: VendaDb): Venda => v;
rota('PUT', '/vendas/:id', ['caixa.operar'], ({ user, params, body }) => {
  exigir(body?.caixaId && body?.terminalId, 'caixaId/terminalId');
  const ja = db.vendas.some((v) => v.id === params.id);
  const v = processarVenda(params.id!, body, user);
  return ok(vendaDto(v), ja ? 200 : 201);
});
rota('POST', '/pdv/cpf/saldo', ['caixa.operar'], ({ body }) => {
  const d = soDigitos(String(body?.cpf ?? ''));
  if (!cpfValido(d)) return problem(400, 'CPF inválido', 'CPF_INVALIDO');
  const cfg = cpfConfig(); const comprado = compradoCpf(d);
  return ok({ cpf: d, limite: cfg.limiteCents > 0 ? fromCents(cfg.limiteCents) : null, comprado: fromCents(comprado), saldo: cfg.limiteCents > 0 ? fromCents(Math.max(0, cfg.limiteCents - comprado)) : null, obrigatorio: cfg.obrigatorio });
});
rota('GET', '/vendas', ['caixa.operar', 'venda.cancelar'], ({ user, query }) => {
  const admin = perfilDe(user).permissoes.includes('venda.cancelar');
  return ok(paginar(db.vendas.filter((v) => (admin || v.operadorId === user.id) && noPeriodo(v.ocorridaEm, query) && (!query.get('caixaId') || v.caixaId === query.get('caixaId')))
    .sort((a, b) => b.ocorridaEm.localeCompare(a.ocorridaEm)).map((v) => semCpf(vendaDto(v))), query));
});
rota('GET', '/vendas/:id/comprovante', ['caixa.operar'], ({ params }) => { const v = db.vendas.find((x) => x.id === params.id); return v ? ok(vendaDto(v)) : problem(404, 'Venda não encontrada'); });
rota('POST', '/vendas/:id/cancelar', ['venda.cancelar'], ({ user, params, body }) => {
  const v = db.vendas.find((x) => x.id === params.id); if (!v) return problem(404, 'Venda não encontrada');
  if (v.status === 'CANCELADA') return problem(409, 'Venda já cancelada', 'VENDA_CANCELADA');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  v.alocacoes.forEach((a) => mover(db.itens.find((i) => i.id === a.itemId)!, 'BAZAR', a.quantidade, 'ESTORNO_VENDA', user.nome, `Estorno da venda ${v.numero}`));
  v.status = 'CANCELADA';
  const dinheiro = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
  // Caixa já fechado: o reembolso em dinheiro vira uma saída paga no financeiro (o Administrador não opera caixa).
  if (dinheiro && db.caixas.find((c) => c.id === v.caixaId)?.status === 'FECHADO') {
    const cat = db.categoriasDespesa.find((c) => c.nome === 'Reembolso de venda')!;
    db.contasPagar.push({ id: uid(), descricao: `Reembolso da venda nº ${v.numero}`, categoriaDespesaId: cat.id, categoriaDespesaNome: cat.nome, valor: fromCents(dinheiro), vencimento: now().slice(0, 10), status: 'PAGA', pagaEm: now(), saiuDoCaixa: false, formaPagamento: 'DINHEIRO' });
  }
  db.contasReceber.filter((c) => c.vendaNumero === v.numero).forEach((c) => { c.status = 'CANCELADA'; c.saldo = '0.00'; });
  auditar(user, 'VENDA_CANCELADA', 'venda', v.id); return ok(vendaDto(v));
});
// ---------------- CXA ----------------
// GET /terminais também liberado para caixa.operar (escolha na abertura) — DIVERGÊNCIA a validar com o back-end.
rota('GET', '/terminais', ['terminais.gerenciar', 'caixa.operar'], ({ query }) => ok(db.terminais.filter((t) => query.get('ativo') === null || String(t.ativo) === query.get('ativo'))));
rota('POST', '/terminais', ['terminais.gerenciar'], ({ user, body }) => { exigir(body?.nome, 'nome'); const t = { id: body.id ?? uid(), nome: body.nome, ativo: true }; db.terminais.push(t); auditar(user, 'TERMINAL_CRIADO', 'terminal', t.id); return ok(t, 201); });
rota('PATCH', '/terminais/:id', ['terminais.gerenciar'], ({ user, params, body }) => { const t = db.terminais.find((x) => x.id === params.id); if (!t) return problem(404, 'Terminal não encontrado'); Object.assign(t, pick(body, ['nome', 'ativo'])); auditar(user, 'TERMINAL_ALTERADO', 'terminal', t.id); return ok(t); });
const caixaDto = ({ lancamentos: _l, ...c }: CaixaDb) => c;
rota('GET', '/caixas/atual', ['caixa.operar'], ({ user }) => { const c = db.caixas.find((x) => x.operadorId === user.id && x.status === 'ABERTO'); return c ? ok(caixaDto(c)) : problem(404, 'Nenhum caixa aberto', 'SEM_CAIXA_ABERTO'); });
rota('POST', '/caixas', ['caixa.operar'], ({ user, body }) => {
  const t = db.terminais.find((x) => x.id === body?.terminalId && x.ativo); exigir(t, 'terminalId'); exigir(toCents(body.fundoTroco ?? '-1') >= 0, 'fundoTroco');
  if (db.caixas.some((c) => c.status === 'ABERTO' && (c.terminalId === t!.id || c.operadorId === user.id))) return problem(409, 'Já existe caixa aberto neste terminal ou para este operador', 'CAIXA_JA_ABERTO');
  const c: CaixaDb = { id: body.id ?? uid(), terminalId: t!.id, terminalNome: t!.nome, operadorNome: user.nome, operadorId: user.id, abertoEm: now(), fundoTroco: fromCents(toCents(body.fundoTroco)), status: 'ABERTO', lancamentos: [] };
  db.caixas.push(c); auditar(user, 'CAIXA_ABERTO', 'caixa_sessao', c.id); return ok(caixaDto(c), 201);
});
function meuCaixa(user: UsuarioDb, id: string) {
  const c = db.caixas.find((x) => x.id === id); if (!c) falha(404, 'Caixa não encontrado');
  if (c!.operadorId !== user.id) falha(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  if (c!.status !== 'ABERTO') falha(409, 'Caixa fechado', 'CAIXA_FECHADO'); return c!;
}
rota('POST', '/caixas/:id/lancamentos', ['caixa.operar'], ({ user, params, body }) => {
  const c = meuCaixa(user, params.id!); exigir(['SANGRIA', 'SUPRIMENTO'].includes(body?.tipo), 'tipo'); exigir(toCents(body.valor) > 0, 'valor'); exigir(String(body.motivo ?? '').trim(), 'motivo');
  if (c.lancamentos.some((l) => l.id === body.id)) return { status: 204, headers: {}, body: null };
  if (body.tipo === 'SANGRIA' && toCents(body.valor) > toCents(previa(c).esperadoDinheiro)) return problem(409, 'Sangria maior que o dinheiro em caixa', 'SANGRIA_ACIMA_SALDO');
  c.lancamentos.push({ id: body.id ?? uid(), tipo: body.tipo, valor: toCents(body.valor), motivo: body.motivo, em: now() });
  auditar(user, body.tipo, 'caixa_sessao', c.id); return { status: 204, headers: {}, body: null };
});
function previa(c: CaixaDb) {
  const vendas = db.vendas.filter((v) => v.caixaId === c.id && v.status === 'CONCLUIDA');
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaPagamento, number>;
  vendas.forEach((v) => v.pagamentos.forEach((p) => { porForma[p.forma] += toCents(p.valor); }));
  // Só recebimento de fiado em DINHEIRO entra na gaveta (ticket 1)
  const receb = db.recebimentos.filter((r) => r.caixaId === c.id && !r.estornado && (r.forma ?? 'DINHEIRO') === 'DINHEIRO').reduce((s, r) => s + toCents(r.valor), 0);
  const sang = c.lancamentos.filter((l) => l.tipo === 'SANGRIA').reduce((s, l) => s + l.valor, 0);
  const sup = c.lancamentos.filter((l) => l.tipo === 'SUPRIMENTO').reduce((s, l) => s + l.valor, 0);
  const esperado = toCents(c.fundoTroco) + porForma.DINHEIRO + receb + sup - sang;
  return { fundoTroco: c.fundoTroco, suprimentos: fromCents(sup), sangrias: fromCents(sang), totaisPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(porForma[f])])) as Record<FormaPagamento, string>, esperadoDinheiro: fromCents(esperado), quantidadeVendas: vendas.length };
}
/** Caixa do próprio operador ou, para quem vê relatórios, qualquer caixa. */
function caixaVisivel(user: UsuarioDb, id: string) {
  const c = db.caixas.find((x) => x.id === id); if (!c) falha(404, 'Caixa não encontrado');
  if (c!.operadorId !== user.id && !perfilDe(user).permissoes.includes('relatorios.consultar')) falha(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  return c!;
}
/** Tudo o que aconteceu no caixa, em ordem, com o dinheiro da gaveta depois de cada evento. */
function linhaDoTempo(c: CaixaDb) {
  type Ev = { em: string; tipo: string; descricao: string; valor: string; cents: number };
  const ev: Ev[] = [{ em: c.abertoEm, tipo: 'ABERTURA', descricao: 'Abertura do caixa (fundo de troco)', valor: c.fundoTroco, cents: toCents(c.fundoTroco) }];
  for (const v of db.vendas.filter((x) => x.caixaId === c.id)) {
    const din = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
    const formas = v.pagamentos.map((p) => `${p.forma.toLowerCase()} ${p.valor}${p.forma === 'DINHEIRO' && p.valorRecebido ? ` (recebido ${p.valorRecebido}${toCents(v.troco) ? `, troco ${v.troco}` : ''})` : ''}`).join(' + ');
    ev.push({ em: v.ocorridaEm, tipo: 'VENDA', descricao: `Venda nº ${v.numero}${v.clienteNome ? ` · ${v.clienteNome}` : ''} · ${formas}`, valor: v.total, cents: din });
    if (v.status === 'CANCELADA') ev.push({ em: v.ocorridaEm, tipo: 'VENDA_CANCELADA', descricao: `Venda nº ${v.numero} cancelada`, valor: v.total, cents: -din });
  }
  for (const l of c.lancamentos) ev.push({ em: l.em, tipo: l.tipo, descricao: `${l.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}: ${l.motivo}`, valor: fromCents(l.valor), cents: l.tipo === 'SANGRIA' ? -l.valor : l.valor });
  ev.sort((a, b) => a.em.localeCompare(b.em));
  let gaveta = 0;
  const eventos = ev.map(({ em, cents, ...e }) => { gaveta += cents; return { quando: em, efeitoDinheiro: fromCents(cents), gavetaApos: fromCents(gaveta), ...e }; });
  if (c.status === 'FECHADO' && c.fechadoEm) eventos.push({ quando: c.fechadoEm, tipo: 'FECHAMENTO', descricao: `Fechamento do caixa (esperado ${c.esperado}, diferença ${c.diferenca})`, valor: c.contado ?? '0.00', efeitoDinheiro: '0.00', gavetaApos: c.contado ?? '0.00' });
  return { gavetaAgora: fromCents(gaveta), eventos };
}
rota('GET', '/caixas/:id/linha-do-tempo', ['caixa.operar', 'relatorios.consultar'], ({ user, params }) => ok(linhaDoTempo(caixaVisivel(user, params.id!))));
rota('GET', '/caixas/:id/fechamento.pdf', ['caixa.operar', 'relatorios.consultar'], ({ user, params }) => {
  caixaVisivel(user, params.id!);
  // Demonstração: um PDF mínimo. O sistema real gera o PDF completo no servidor.
  const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 20 60 Td (Demonstracao: o PDF real vem do servidor) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF';
  return { status: 200, headers: { 'content-type': 'application/pdf' }, body: new Blob([pdf], { type: 'application/pdf' }) };
});
rota('GET', '/caixas/:id/previa-fechamento', ['caixa.operar'], ({ user, params }) => ok(previa(meuCaixa(user, params.id!))));
rota('POST', '/caixas/:id/fechar', ['caixa.operar'], ({ user, params, body }) => {
  const c = meuCaixa(user, params.id!); const contado = toCents(body?.contado ?? '-1'); exigir(contado >= 0, 'contado');
  const esp = toCents(previa(c).esperadoDinheiro); const dif = contado - esp;
  if (dif !== 0 && String(body.observacao ?? '').trim().length < 5) return problem(400, 'Diferença de caixa exige observação', 'OBSERVACAO_OBRIGATORIA');
  Object.assign(c, { status: 'FECHADO', fechadoEm: now(), esperado: fromCents(esp), contado: fromCents(contado), diferenca: fromCents(dif), observacao: body.observacao });
  auditar(user, 'CAIXA_FECHADO', 'caixa_sessao', c.id); return ok(caixaDto(c));
});
rota('GET', '/caixas', ['relatorios.consultar'], ({ query }) => ok(paginar(db.caixas.filter((c) => noPeriodo(c.abertoEm, query)).sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).map(caixaDto), query)));

// ---------------- FIN ----------------
rota('GET', '/contas-pagar', ['contas_pagar.gerenciar'], ({ query }) => ok(paginar(db.contasPagar.filter((c) => !query.get('status') || c.status === query.get('status')).sort((a, b) => a.vencimento.localeCompare(b.vencimento)), query)));
rota('POST', '/contas-pagar', ['contas_pagar.gerenciar'], ({ user, body }) => {
  exigir(body?.descricao, 'descricao'); exigir(toCents(body.valor ?? '0') > 0, 'valor'); exigir(/^\d{4}-\d{2}-\d{2}$/.test(body.vencimento ?? ''), 'vencimento');
  const cd = db.categoriasDespesa.find((x) => x.id === body.categoriaDespesaId); exigir(cd, 'categoriaDespesaId');
  const c = { id: body.id ?? uid(), descricao: body.descricao, categoriaDespesaId: cd!.id, categoriaDespesaNome: cd!.nome, valor: fromCents(toCents(body.valor)), vencimento: body.vencimento, status: 'ABERTA' as const };
  db.contasPagar.push(c); auditar(user, 'CONTA_PAGAR_CRIADA', 'conta_pagar', c.id); return ok(c, 201);
});
rota('POST', '/contas-pagar/:id/pagar', ['contas_pagar.gerenciar'], ({ user, params, body }) => {
  const c = db.contasPagar.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  if (c.status !== 'ABERTA') return problem(409, 'Conta não está aberta', 'CONTA_NAO_ABERTA');
  if (body?.saiuDoCaixa) {
    const cx = db.caixas.find((x) => x.status === 'ABERTO' && x.operadorId === user.id);
    if (!cx) return problem(409, 'Você não tem caixa aberto para registrar a sangria', 'CAIXA_FECHADO');
    cx.lancamentos.push({ id: uid(), tipo: 'SANGRIA', valor: toCents(c.valor), motivo: `Pagamento: ${c.descricao}`, em: now() });
  }
  Object.assign(c, { status: 'PAGA', pagaEm: now(), saiuDoCaixa: !!body?.saiuDoCaixa, formaPagamento: body?.saiuDoCaixa ? 'DINHEIRO' : body?.formaPagamento ?? 'PIX' }); auditar(user, 'CONTA_PAGA', 'conta_pagar', c.id); return ok(c);
});
rota('POST', '/contas-pagar/:id/cancelar', ['contas_pagar.gerenciar'], ({ user, params, body }) => {
  const c = db.contasPagar.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo'); if (c.status !== 'ABERTA') return problem(409, 'Conta não está aberta', 'CONTA_NAO_ABERTA');
  c.status = 'CANCELADA'; auditar(user, 'CONTA_PAGAR_CANCELADA', 'conta_pagar', c.id); return ok(c);
});
function recalcular(c: ContaReceber) {
  const pago = db.recebimentos.filter((r) => r.contaReceberId === c.id && !r.estornado).reduce((s, r) => s + toCents(r.valor), 0);
  const saldo = toCents(c.valor) - pago; c.saldo = fromCents(saldo);
  if (c.status !== 'CANCELADA') c.status = saldo === 0 ? 'QUITADA' : pago > 0 ? 'PARCIAL' : 'ABERTA';
}
rota('GET', '/contas-receber', ['contas_receber.receber'], ({ query }) => ok(paginar(db.contasReceber.filter((c) => (!query.get('status') || c.status === query.get('status')) && (!query.get('clienteId') || c.clienteId === query.get('clienteId'))).sort((a, b) => a.vencimento.localeCompare(b.vencimento)), query)));
rota('POST', '/contas-receber', ['contas_receber.lancar'], ({ user, body }) => {
  const cl = db.clientes.find((x) => x.id === body?.clienteId); exigir(cl, 'clienteId'); exigir(toCents(body.valor ?? '0') > 0, 'valor');
  const c = { id: body.id ?? uid(), clienteId: cl!.id, clienteNome: cl!.nome, descricao: body.descricao, valor: fromCents(toCents(body.valor)), saldo: fromCents(toCents(body.valor)), vencimento: body.vencimento, status: 'ABERTA' as const };
  db.contasReceber.push(c); auditar(user, 'CONTA_RECEBER_LANCADA', 'conta_receber', c.id); return ok(c, 201);
});
rota('POST', '/contas-receber/:id/recebimentos', ['contas_receber.receber'], ({ user, params, body }) => {
  const c = db.contasReceber.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  if (db.recebimentos.some((r) => r.id === body?.id)) return ok(db.recebimentos.find((r) => r.id === body.id));
  const v = toCents(body?.valor ?? '0'); exigir(v > 0, 'valor');
  if (v > toCents(c.saldo)) return problem(409, 'Valor maior que o saldo da conta', 'RECEBIMENTO_ACIMA_SALDO');
  if (body.caixaId) meuCaixa(user, body.caixaId);
  const forma = body.forma ?? 'DINHEIRO'; exigir(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'].includes(forma), 'forma');
  const r = { id: body.id ?? uid(), contaReceberId: c.id, valor: fromCents(v), recebidoEm: now(), caixaId: body.caixaId, estornado: false, forma };
  db.recebimentos.push(r); recalcular(c); auditar(user, 'RECEBIMENTO', 'conta_receber', c.id); return ok(r, 201);
});
rota('POST', '/recebimentos/:id/estornar', ['recebimento.estornar'], ({ user, params, body }) => {
  const r = db.recebimentos.find((x) => x.id === params.id); if (!r) return problem(404, 'Recebimento não encontrado');
  if (r.estornado) return problem(409, 'Recebimento já estornado', 'ESTORNO_DUPLICADO'); exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  r.estornado = true; recalcular(db.contasReceber.find((c) => c.id === r.contaReceberId)!); auditar(user, 'RECEBIMENTO_ESTORNADO', 'recebimento', r.id);
  return { status: 204, headers: {}, body: null };
});
rota('GET', '/clientes/:id/extrato', ['contas_receber.receber'], ({ params }) => {
  const cl = db.clientes.find((x) => x.id === params.id); if (!cl) return problem(404, 'Cliente não encontrado');
  const contas = db.contasReceber.filter((c) => c.clienteId === cl.id);
  return ok({ cliente: { id: cl.id, nome: cl.nome }, contas, recebimentos: db.recebimentos.filter((r) => contas.some((c) => c.id === r.contaReceberId)), saldoDevedor: fromCents(contas.filter((c) => c.status !== 'CANCELADA').reduce((s, c) => s + toCents(c.saldo), 0)) });
});
rota('GET', '/financeiro/resumo', ['relatorios.consultar'], ({ query }) => {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaPagamento, number>;
  db.vendas.filter((v) => v.status === 'CONCLUIDA' && noPeriodo(v.ocorridaEm, query)).forEach((v) => v.pagamentos.forEach((p) => { porForma[p.forma] += toCents(p.valor); }));
  const receb = db.recebimentos.filter((r) => !r.estornado && noPeriodo(r.recebidoEm, query)).reduce((s, r) => s + toCents(r.valor), 0);
  const saidas = db.contasPagar.filter((c) => c.status === 'PAGA' && c.pagaEm && noPeriodo(c.pagaEm, query)).reduce((s, c) => s + toCents(c.valor), 0);
  const entradas = porForma.DINHEIRO + porForma.PIX + porForma.CARTAO_DEBITO + porForma.CARTAO_CREDITO + receb;
  return ok({ de: query.get('de'), ate: query.get('ate'), entradasPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(porForma[f])])), recebimentosFiado: fromCents(receb), saidas: fromCents(saidas), resultado: fromCents(entradas - saidas) });
});

// ---------------- FIS ----------------
rota('GET', '/regras-fiscais', ['fiscal.gerenciar'], () => ok(db.regrasFiscais));
rota('POST', '/regras-fiscais', ['fiscal.gerenciar'], ({ user, body }) => {
  exigir(['GERAL', 'CATEGORIA', 'ITEM'].includes(body?.alvo), 'alvo'); exigir(/^\d{4}-\d{2}-\d{2}$/.test(body.vigenciaInicio ?? ''), 'vigenciaInicio');
  const anterior = db.regrasFiscais.find((r) => r.alvo === body.alvo && (r.alvoId ?? null) === (body.alvoId ?? null) && !r.vigenciaFim);
  if (anterior) { if (anterior.vigenciaInicio >= body.vigenciaInicio) return problem(409, 'Vigência sobrepõe a regra atual', 'VIGENCIA_SOBREPOSTA'); anterior.vigenciaFim = body.vigenciaInicio; }
  const r = { ...pick(body, ['alvo', 'alvoId', 'situacao', 'aliquota', 'vigenciaInicio']), id: body.id ?? uid(), alvoNome: body.alvoId ? nomeCat(body.alvoId) : undefined };
  db.regrasFiscais.push(r); auditar(user, 'REGRA_FISCAL_CRIADA', 'regra_fiscal', r.id); return ok(r, 201);
});

// ---------------- REL ----------------
function relatorio(tipo: string, q: URLSearchParams): RelatorioResposta {
  switch (tipo) {
    case 'prestacao-contas': {
      const modo = q.get('modo') === 'campanha' ? 'campanha' : 'parceiro';
      const grupos = new Map<string, Record<string, number>>();
      for (const l of db.lotes) {
        const chave = (modo === 'parceiro' ? nomeParc(l.parceiroId) : nomeCamp(l.campanhaId)) ?? '(sem ' + modo + ')';
        const g = grupos.get(chave) ?? { recebidos: 0, descartados: 0, valorAtribuido: 0, vendidos: 0, receita: 0, emEstoque: 0 };
        const itens = db.itens.filter((i) => i.loteId === l.id && i.status === 'APROVADO'); // só o aprovado foi recebido (Sprint 2)
        if (noPeriodo(l.recebidoEm, q)) {
          g.recebidos! += itens.reduce((s, i) => s + i.quantidadeInicial, 0);
          g.descartados! += db.descartes.filter((d) => d.loteId === l.id && !d.revertido).length;
          g.valorAtribuido! += itens.reduce((s, i) => s + (i.valorAtribuido ?? i.preco) * i.quantidadeInicial, 0);
        }
        db.vendas.filter((v) => v.status === 'CONCLUIDA' && noPeriodo(v.ocorridaEm, q)).forEach((v) => v.alocacoes.filter((a) => itens.some((i) => i.id === a.itemId)).forEach((a) => { g.vendidos! += a.quantidade; g.receita! += a.precoUnit * a.quantidade; }));
        g.emEstoque! += itens.reduce((s, i) => s + i.saldo.BAZAR + i.saldo.DOACOES, 0);
        grupos.set(chave, g);
      }
      const linhas = [...grupos].map(([nome, g]) => ({ nome, recebidos: g.recebidos!, descartados: g.descartados!, valorAtribuido: fromCents(g.valorAtribuido!), vendidos: g.vendidos!, receita: fromCents(g.receita!), emEstoque: g.emEstoque! }));
      return { titulo: `Prestação de contas por ${modo}`, colunas: [
        { chave: 'nome', rotulo: modo === 'parceiro' ? 'Parceiro' : 'Campanha' }, { chave: 'recebidos', rotulo: 'Itens recebidos', tipo: 'number' }, { chave: 'descartados', rotulo: 'Descartados', tipo: 'number' },
        { chave: 'valorAtribuido', rotulo: 'Valor atribuído', tipo: 'money' }, { chave: 'vendidos', rotulo: 'Vendidos', tipo: 'number' }, { chave: 'receita', rotulo: 'Receita', tipo: 'money' }, { chave: 'emEstoque', rotulo: 'Saldo em estoque', tipo: 'number' },
      ], linhas };
    }
    case 'vendas': {
      const vs = db.vendas.filter((v) => noPeriodo(v.ocorridaEm, q));
      const conc = vs.filter((v) => v.status === 'CONCLUIDA'), canc = vs.filter((v) => v.status !== 'CONCLUIDA');
      const soma = (l: { total: string }[]) => fromCents(l.reduce((s, v) => s + toCents(v.total), 0));
      const blocos = [{ titulo: 'Vendas canceladas no período', colunas: [{ chave: 'numero', rotulo: 'Nº', tipo: 'number' as const }, { chave: 'data', rotulo: 'Data', tipo: 'date' as const }, { chave: 'operador', rotulo: 'Operador' }, { chave: 'total', rotulo: 'Total', tipo: 'money' as const }],
        linhas: canc.map((v) => ({ numero: v.numero, data: v.ocorridaEm, operador: v.operadorNome, total: v.total })), totais: { numero: canc.length, total: soma(canc) } }];
      const ag = q.get('agrupar');
      if (ag === 'dia' || ag === 'operador' || ag === 'forma' || ag === 'categoria') {
        const grupos = new Map<string, { vendas: Set<string>; cents: number }>();
        const add = (k: string, vid: string, cents: number) => { const g = grupos.get(k) ?? { vendas: new Set(), cents: 0 }; g.vendas.add(vid); g.cents += cents; grupos.set(k, g); };
        for (const v of conc) {
          if (ag === 'dia') add(v.ocorridaEm.slice(0, 10), v.id, toCents(v.total));
          else if (ag === 'operador') add(v.operadorNome, v.id, toCents(v.total));
          else if (ag === 'forma') v.pagamentos.forEach((p) => add(p.forma, v.id, toCents(p.valor)));
          else v.alocacoes.forEach((a) => add(nomeCat(db.itens.find((i) => i.id === a.itemId)?.categoriaId ?? '') ?? '—', v.id, a.precoUnit * a.quantidade));
        }
        const rot = { dia: 'Dia', operador: 'Operador', forma: 'Forma de pagamento', categoria: 'Categoria' }[ag];
        return { titulo: `Vendas concluídas por ${rot.toLowerCase()}`, colunas: [{ chave: 'grupo', rotulo: rot, tipo: ag === 'dia' ? 'date' : 'text' }, { chave: 'vendas', rotulo: 'Vendas', tipo: 'number' }, { chave: 'total', rotulo: 'Total', tipo: 'money' }],
          linhas: [...grupos].sort((a, b) => a[0].localeCompare(b[0])).map(([grupo, g]) => ({ grupo, vendas: g.vendas.size, total: fromCents(g.cents) })),
          totais: { total: fromCents([...grupos.values()].reduce((s, g) => s + g.cents, 0)) }, blocos };
      }
      // S3-11: o desconto do produto (promoção) à parte do desconto do PDV
      const descProd = (v: VendaDb) => v.alocacoes.reduce((s, a) => s + (a.precoTabela ? (a.precoTabela - a.precoUnit) * a.quantidade : 0), 0);
      return { titulo: 'Vendas concluídas no período', colunas: [{ chave: 'numero', rotulo: 'Nº', tipo: 'number' }, { chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'operador', rotulo: 'Operador' },
        { chave: 'descontoProduto', rotulo: 'Desconto do produto', tipo: 'money' }, { chave: 'descontoPdv', rotulo: 'Desconto no PDV', tipo: 'money' }, { chave: 'total', rotulo: 'Total', tipo: 'money' }],
        linhas: conc.map((v) => ({ numero: v.numero, data: v.ocorridaEm, operador: v.operadorNome, descontoProduto: fromCents(descProd(v)), descontoPdv: v.desconto, total: v.total })),
        totais: { numero: conc.length, descontoProduto: fromCents(conc.reduce((s, v) => s + descProd(v), 0)), descontoPdv: fromCents(conc.reduce((s, v) => s + toCents(v.desconto), 0)), total: soma(conc) }, blocos };
    }
    case 'estoque': return { titulo: 'Posição de estoque', colunas: [{ chave: 'categoria', rotulo: 'Categoria' }, { chave: 'bazar', rotulo: 'Bazar', tipo: 'number' }, { chave: 'doacoes', rotulo: 'Doações', tipo: 'number' }],
      linhas: db.categorias.map((c) => ({ categoria: c.nome, bazar: db.itens.filter((i) => i.categoriaId === c.id).reduce((s, i) => s + i.saldo.BAZAR, 0), doacoes: db.itens.filter((i) => i.categoriaId === c.id).reduce((s, i) => s + i.saldo.DOACOES, 0) })) };
    case 'descartes': {
      const ds = db.descartes.filter((d) => {
        const l = db.lotes.find((x) => x.id === d.loteId)!;
        return !d.revertido && noPeriodo(d.registradoEm, q) && (!q.get('parceiroId') || l.parceiroId === q.get('parceiroId')) && (!q.get('campanhaId') || l.campanhaId === q.get('campanhaId'));
      });
      const motivo = (id: string) => db.motivosDescarte.find((m) => m.id === id)!.nome;
      const porMotivo = new Map<string, number>(); ds.forEach((d) => porMotivo.set(motivo(d.motivoId), (porMotivo.get(motivo(d.motivoId)) ?? 0) + 1));
      const resumo = { titulo: 'Quantidade descartada por motivo', colunas: [{ chave: 'motivo', rotulo: 'Motivo' }, { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'number' as const }],
        linhas: [...porMotivo].map(([m, n]) => ({ motivo: m, quantidade: n })), totais: { quantidade: ds.length } };
      if (q.get('agrupar') === 'motivo') return resumo;
      return { titulo: 'Descartes no período', colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'lote', rotulo: 'Lote', tipo: 'number' }, { chave: 'categoria', rotulo: 'Categoria' }, { chave: 'motivo', rotulo: 'Motivo' }],
        linhas: ds.map((d) => ({ data: d.registradoEm, lote: db.lotes.find((l) => l.id === d.loteId)!.numero, categoria: nomeCat(d.categoriaId), motivo: motivo(d.motivoId) })),
        totais: { lote: ds.length }, blocos: [resumo] };
    }
    case 'transferencias': return { titulo: 'Transferências', colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'item', rotulo: 'Item' }, { chave: 'descricao', rotulo: 'Movimento' }, { chave: 'quantidade', rotulo: 'Qtd.', tipo: 'number' }, { chave: 'usuario', rotulo: 'Usuário' }],
      linhas: db.movs.filter((m) => m.tipo === 'TRANSFERENCIA' && m.quantidade > 0 && noPeriodo(m.ocorridoEm, q)).map((m) => ({ data: m.ocorridoEm, item: db.itens.find((i) => i.id === m.itemId)!.descricao, descricao: m.descricao, quantidade: m.quantidade, usuario: m.usuarioNome })) };
    case 'fiado': return { titulo: 'Fiado em aberto', colunas: [{ chave: 'cliente', rotulo: 'Cliente' }, { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'date' }, { chave: 'saldo', rotulo: 'Saldo', tipo: 'money' }, { chave: 'status', rotulo: 'Status' }],
      linhas: db.contasReceber.filter((c) => c.status === 'ABERTA' || c.status === 'PARCIAL').map((c) => ({ cliente: c.clienteNome, vencimento: c.vencimento, saldo: c.saldo, status: c.status })) };
    default: return falha(404, 'Relatório inexistente');
  }
}
rota('GET', '/relatorios/:tipo', ['relatorios.consultar', 'relatorios.estoque'], ({ user, params, query }) => {
  if (!['estoque', 'descartes', 'transferencias'].includes(params.tipo!) && !perfilDe(user).permissoes.includes('relatorios.consultar')) return problem(403, 'Você não tem permissão para esta ação', 'SEM_PERMISSAO');
  const bruto = relatorio(params.tipo!, query); const fmt = query.get('formato') ?? 'json';
  // sem "ver custo" (S3-05), a coluna de valor atribuído some
  const tira = <T extends { colunas: { chave: string }[]; linhas: Record<string, unknown>[] }>(x: T): T => ({ ...x, colunas: x.colunas.filter((c) => c.chave !== 'valorAtribuido'), linhas: x.linhas.map(({ valorAtribuido: _v, ...l }) => l) });
  const r = perfilDe(user).permissoes.includes('custo.consultar') ? bruto : { ...tira(bruto), ...(bruto.blocos ? { blocos: bruto.blocos.map(tira) } : {}) };
  if (fmt === 'json') return ok(r);
  const secao = (x: typeof r) => [x.colunas.map((c) => c.rotulo).join(';'), ...x.linhas.map((l) => x.colunas.map((c) => `"${String(l[c.chave] ?? '').replace(/"/g, '""')}"`).join(';'))];
  const csv = [...secao(r), ...(r.blocos ?? []).flatMap((b) => ['', b.titulo, ...secao(b)])].join('\n');
  const tipos: Record<string, string> = { csv: 'text/csv', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  // Mock: devolve CSV para qualquer formato (o servidor real gera PDF/XLSX de verdade).
  return { status: 200, headers: { 'content-type': tipos[fmt] ?? 'text/csv' }, body: new Blob(['﻿' + csv], { type: 'text/csv' }) };
});

// ---------------- PRV / ADM ----------------
rota('GET', '/titulares/:tipo/:id/exportar', ['privacidade.gerenciar'], ({ user, params }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c || params.tipo !== 'cliente') return problem(404, 'Titular não encontrado');
  auditar(user, 'TITULAR_EXPORTADO', 'cliente', c.id);
  const dados = { cliente: c, contasReceber: db.contasReceber.filter((x) => x.clienteId === c.id), compras: db.vendas.filter((v) => v.clienteId === c.id).map(vendaDto) };
  return { status: 200, headers: { 'content-type': 'application/json' }, body: new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }) };
});
rota('POST', '/titulares/:tipo/:id/anonimizar', ['privacidade.gerenciar'], ({ user, params, body }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c) return problem(404, 'Titular não encontrado');
  if (c.anonimizado) return problem(409, 'Titular já anonimizado', 'JA_ANONIMIZADO');
  const debito = db.contasReceber.some((x) => x.clienteId === c.id && (x.status === 'ABERTA' || x.status === 'PARCIAL'));
  if (debito && body?.confirmar !== true) return problem(409, 'Cliente possui débito em aberto. Confirme para anonimizar mesmo assim.', 'CLIENTE_COM_DEBITO');
  Object.assign(c, { nome: `Titular anonimizado ${c.id.slice(-4)}`, telefone: '', anonimizado: true, ativo: false });
  db.contasReceber.filter((x) => x.clienteId === c.id).forEach((x) => { x.clienteNome = c.nome; });
  auditar(user, 'TITULAR_ANONIMIZADO', 'cliente', c.id); return { status: 204, headers: {}, body: null };
});
rota('GET', '/parametros', ['parametros.gerenciar'], () => ok(db.parametros));
rota('PUT', '/parametros', ['parametros.gerenciar'], ({ user, body }) => {
  for (const v of body?.valores ?? []) { const p = db.parametros.find((x) => x.chave === v.chave); if (!p) return problem(400, `Parâmetro desconhecido: ${v.chave}`); if (p.tipo === 'number' && !/^\d+$/.test(v.valor)) return problem(400, `Valor inválido para ${p.descricao}`); p.valor = v.valor; }
  auditar(user, 'PARAMETROS_ALTERADOS', 'parametro', '*'); return ok(db.parametros);
});
rota('POST', '/importacoes/:tipo', ['cadastros.gerenciar'], ({ body }) => {
  const f = (body as FormData).get('arquivo'); if (!f) return problem(400, 'Arquivo obrigatório');
  return ok({ gravado: false, inseridos: 0, duplicados: [{ linha: 3, valor: 'Roupa adulto' }], erros: [] });
});

// ---------------- dispatcher ----------------
const LATENCIA_MS = 120;
export const mockTransport: Transport = async (req: TransportRequest) => {
  await new Promise((r) => setTimeout(r, LATENCIA_MS));
  const [pathname, qs = ''] = req.path.split('?');
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const r = rotas.find((x) => x.method === req.method && x.re.test(pathname!));
  if (!r) return problem(404, 'Rota inexistente');
  const m = pathname!.match(r.re)!;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
  let user: UsuarioDb | undefined;
  if (r.regra !== 'publica') {
    const tok = access.get(headers.authorization?.replace('Bearer ', '') ?? '');
    if (!tok || tok.exp < Date.now()) return problem(401, 'Não autenticado', 'NAO_AUTENTICADO');
    user = db.usuarios.find((u) => u.id === tok.userId && u.ativo);
    if (!user) return problem(401, 'Não autenticado', 'NAO_AUTENTICADO');
    // Fail secure: só passa se a rota declarou permissões e o perfil tem ao menos uma.
    if (Array.isArray(r.regra) && !r.regra.some((p) => perfilDe(user!).permissoes.includes(p))) return problem(403, 'Você não tem permissão para esta ação', 'SEM_PERMISSAO');
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  try {
    return await r.h({ user: user!, params, query: new URLSearchParams(qs), body, headers });
  } catch (e) {
    if (e instanceof Falha) return e.r;
    console.error('[mock] erro interno', e);
    return problem(500, 'Erro interno', 'ERRO_INTERNO'); // sem stack trace ao cliente
  }
};
// Utilitário de depuração no console do DEV (não expõe nada em produção — este módulo nem é empacotado).
export const _mockDb = db;
export const _nomeUser = nomeUser;
