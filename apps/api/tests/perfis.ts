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

/** [método, rota, corpo, quem PODE (os demais devem receber 403), status esperado para quem pode (padrão 200)] */
const ACESSOS: [string, string, unknown, Perfil[], number[]?][] = [
  ['GET', '/usuarios', undefined, ['admin']],
  ['GET', '/perfis', undefined, ['admin']],
  ['GET', '/auditoria', undefined, ['admin']],
  ['GET', '/parametros', undefined, ['admin']],
  ['GET', '/regras-fiscais', undefined, ['admin']],
  ['POST', '/categorias', {}, ['admin'], [400]],
  // Sprint 3: o Financeiro lê os lotes (só leitura, P-07); o Estoquista também aprova e devolve (P-16)
  ['GET', '/lotes', undefined, ['admin', 'estoquista', 'financeiro']],
  ['POST', '/lotes', {}, ['admin', 'estoquista'], [400]],
  ['GET', '/aprovacoes', undefined, ['admin', 'estoquista']],
  ['POST', `/lotes/${uuid()}/aprovar`, {}, ['admin', 'estoquista'], [404]],
  ['POST', `/itens/${uuid()}/aprovar`, {}, ['admin', 'estoquista'], [404]],
  ['POST', `/itens/${uuid()}/devolver`, { motivo: 'Faltou a foto' }, ['admin', 'estoquista'], [404]],
  // Produto (S3-04): todos que consultam o estoque leem; quem cadastra edita; preço: Admin e Estoquista; desconto: Admin e Financeiro
  ['GET', `/produtos/${uuid()}`, undefined, ['admin', 'estoquista', 'financeiro'], [404]],
  ['PATCH', `/produtos/${uuid()}`, { nome: 'Outro nome' }, ['admin', 'estoquista'], [404]],
  ['PATCH', `/produtos/${uuid()}/preco`, { preco: '10.00', motivo: 'Reajuste de teste' }, ['admin', 'estoquista'], [404]],
  ['PATCH', `/itens/${uuid()}/preco`, { preco: '10.00', motivo: 'Reajuste de teste' }, ['admin', 'estoquista'], [404]],
  ['PUT', `/produtos/${uuid()}/desconto`, { tipo: 'PERCENTUAL', valor: '10.00', motivo: 'Promoção de teste' }, ['admin', 'financeiro'], [404]],
  ['POST', `/produtos/${uuid()}/desconto/encerrar`, { motivo: 'Fim da promoção' }, ['admin', 'financeiro'], [404]],
  // baixa, ajuste (só de saída) e carga inicial continuam só com o Administrador
  ['POST', '/baixas', {}, ['admin'], [400]],
  ['POST', '/ajustes', {}, ['admin'], [400]],
  ['POST', `/perfis/${uuid()}/desativar`, {}, ['admin'], [404]],
  ['POST', '/parceiros', {}, ['admin', 'estoquista'], [400]],
  ['PATCH', `/parceiros/${uuid()}`, {}, ['admin'], [404]],
  ['GET', '/produtos', undefined, ['admin', 'estoquista', 'financeiro']],
  // etiquetas (S4-01 a S4-05): Admin e Estoquista; pedido vazio é recusado (400) por quem pode
  ['GET', '/etiquetas/config', undefined, ['admin', 'estoquista']],
  ['POST', '/etiquetas/preparar', { produtos: [] }, ['admin', 'estoquista'], [400]],
  ['POST', '/etiquetas/impressoes', { produtos: [] }, ['admin', 'estoquista'], [400]],
  ['GET', '/estoque', undefined, ['admin', 'estoquista', 'financeiro']],
  ['GET', '/itens/codigo/BZ999999', undefined, TODOS, [404]], // leitura de código: PDV (vendedor) e estoque
  ['GET', '/contas-pagar', undefined, ['admin', 'financeiro']],
  ['GET', '/contas-receber', undefined, ['admin', 'financeiro']],
  ['GET', '/financeiro/resumo?de=2026-01-01&ate=2026-12-31', undefined, ['admin', 'financeiro']],
  ['GET', '/caixas', undefined, ['admin', 'financeiro']],
  // Caixa: só o Vendedor e o Administrador (o corpo vazio dá 400; o caixa pode ou não estar aberto)
  ['GET', '/caixas/atual', undefined, ['vendedor', 'admin'], [200, 404]],
  ['POST', '/caixas', {}, ['vendedor', 'admin'], [400]],
  ['PUT', `/vendas/${uuid()}`, {}, ['vendedor', 'admin'], [400]],
  ['POST', `/caixas/${uuid()}/lancamentos`, {}, ['vendedor', 'admin'], [400]],
  ['POST', `/caixas/${uuid()}/fechar`, {}, ['vendedor', 'admin'], [400]],
  ['GET', '/pdv/catalogo', undefined, ['vendedor', 'admin']],
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
  admin: [], // calculado: todas as permissões (inclusive abrir caixa)
  vendedor: ['caixa.operar', 'clientes.gerenciar'],
  // parceiros.criar: 0009; custo, preço e aprovação: 0010; etiquetas: 0011
  estoquista: ['cadastros.consultar', 'custo.consultar', 'entrada.registrar', 'estoque.consultar', 'estoque.transferir', 'etiquetas.imprimir', 'parceiros.criar', 'produtos.aprovar', 'produtos.preco', 'relatorios.estoque'],
  financeiro: ['contas_pagar.gerenciar', 'contas_receber.lancar', 'contas_receber.receber', 'custo.consultar', 'estoque.consultar', 'produtos.desconto', 'relatorios.consultar', 'relatorios.estoque'],
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
  PERMISSOES_ESPERADAS.admin = [...todasPerms].sort(); // o Administrador tem tudo, inclusive abrir caixa (migração 0006)
  for (const k of TODOS) {
    const reais = [...(porNome({ admin: 'Administrador', estoquista: 'Estoquista', vendedor: 'Vendedor', financeiro: 'Financeiro' }[k])?.permissoes ?? [])].sort();
    check(JSON.stringify(reais) === JSON.stringify([...PERMISSOES_ESPERADAS[k]].sort()), `permissões do perfil ${k} conferem com a matriz`, { reais, esperadas: PERMISSOES_ESPERADAS[k] });
  }
  check(!todasPerms.includes('sincronizacao.resolver'), 'permissão de sincronização não existe mais');
  check(['caixa.operar', 'usuarios.gerenciar', 'perfis.gerenciar', 'venda.cancelar', 'fiscal.gerenciar', 'privacidade.gerenciar'].every((p) => porNome('Administrador').permissoes.includes(p)), 'Administrador tem as permissões essenciais, inclusive abrir caixa');

  console.log('Acesso por perfil (o servidor decide)');
  const clientes: Record<Perfil, Cliente> = { admin, estoquista: null as any, vendedor: null as any, financeiro: null as any };
  const sufixo = uuid().slice(0, 6);
  for (const k of ['estoquista', 'vendedor', 'financeiro'] as const) clientes[k] = (await novoUsuario(admin, `p_${k}_${sufixo}`, ids[k])).cliente;
  for (const [metodo, rota, corpo, podem, esperado = [200]] of ACESSOS) {
    for (const k of TODOS) {
      const r = await clientes[k].req(metodo, rota, corpo);
      const deveria = podem.includes(k);
      const ok = deveria ? esperado.includes(r.status) : r.status === 403;
      check(ok, `${k} ${deveria ? 'acessa' : 'NÃO acessa'} ${metodo} ${rota.split('?')[0].replace(/[0-9a-f-]{36}/, ':id')}`, { status: r.status, esperado: deveria ? esperado : [403], code: r.data?.code });
    }
  }
  // Relatório fora do grupo de estoque: a recusa vem do servidor mesmo com a permissão de estoque
  check((await clientes.estoquista.get('/relatorios/prestacao-contas?de=2026-01-01&ate=2026-12-31')).status === 403, 'estoquista não vê prestação de contas (receita)');

  console.log('Cada um vê só o seu');
  const vAdm = (await admin.get('/vendas')).data, vVend = (await clientes.vendedor.get('/vendas')).data;
  check(vAdm.total > 0 && vVend.total === 0, 'vendedor que nunca vendeu não enxerga as vendas dos outros; o Administrador vê todas (o isolamento entre dois operadores que já venderam é provado no smoke)', { admin: vAdm.total, vendedor: vVend.total });
  const mes = (await clientes.vendedor.get('/caixas/atual'));
  check(mes.status === 404, 'vendedor sem caixa aberto não recebe caixa de outro operador', mes.status);

  console.log('Perfil personalizado criado pelo Admin e proteção dos padrão');
  const novo = (await admin.post('/perfis', { nome: `Conferente ${sufixo}`, permissoes: ['estoque.consultar'] })).data;
  check(novo?.id && novo.padrao === false, 'Admin cria um perfil personalizado', novo);
  const conf = (await novoUsuario(admin, `p_conf_${sufixo}`, novo.id)).cliente;
  check((await conf.get('/estoque')).status !== 403, 'perfil personalizado acessa só o que recebeu (estoque)');
  check((await conf.get('/aprovacoes')).status === 403 && (await conf.get('/contas-pagar')).status === 403, 'perfil personalizado não acessa o que não recebeu');
  const estConf = (await conf.get('/estoque')).data?.items ?? [];
  const estAdm = (await admin.get('/estoque')).data?.items ?? [];
  check(estConf.length > 0 && estConf.every((i: Record<string, unknown>) => !('valorAtribuido' in i)) && estAdm.some((i: Record<string, unknown>) => 'valorAtribuido' in i),
    'sem a permissão "ver custo", o estoque não traz o valor atribuído; com ela, traz (S3-05)', { conf: estConf[0], admin: estAdm[0] });
  const relConf = (await admin.post('/perfis', { nome: `Rel estoque ${sufixo}`, permissoes: ['relatorios.estoque'] })).data;
  const rc = (await novoUsuario(admin, `p_rel_${sufixo}`, relConf.id)).cliente;
  const rel = (await rc.get('/relatorios/estoque?de=2026-01-01&ate=2026-12-31')).data;
  check(rel?.colunas && !rel.colunas.some((c: { chave: string }) => c.chave === 'valorAtribuido'), 'relatório de estoque sem a coluna de custo para quem não pode ver custo', rel?.colunas);
  check((await admin.patch(`/perfis/${ids.vendedor}`, { nome: 'Outro nome' })).data?.code === 'PERFIL_PADRAO', 'perfil padrão não pode ser renomeado');
  check((await admin.patch(`/perfis/${novo.id}`, { permissoes: ['estoque.consultar', 'lotes.inexistente'] })).status === 400, 'permissão desconhecida é recusada');

  console.log('Nome único, grupos e desativação de perfil (S3-18 a S3-20)');
  const perms = (await admin.get('/permissoes')).data as { codigo: string; descricao: string; grupo: string }[];
  check(perms.every((p) => p.descricao && p.grupo), 'cada permissão vem com descrição em português e grupo', perms.filter((p) => !p.descricao || !p.grupo));
  check((await admin.post('/perfis', { nome: `conferente ${sufixo}`.toUpperCase(), permissoes: [] })).data?.code === 'NOME_DUPLICADO', 'nome de perfil repetido (sem diferença de maiúsculas) é recusado');
  check((await admin.post(`/perfis/${ids.vendedor}/desativar`, {})).data?.code === 'PERFIL_PADRAO', 'perfil padrão não se desativa');
  check((await admin.post(`/perfis/${novo.id}/desativar`, {})).data?.code === 'PERFIL_EM_USO', 'perfil com usuário ativo não se desativa');
  const uConf = ((await admin.get(`/usuarios?busca=p_conf_${sufixo}`)).data.items as { id: string; login: string }[]).find((x) => x.login === `p_conf_${sufixo}`)!;
  check((await admin.patch(`/usuarios/${uConf.id}`, { ativo: false })).status === 200, 'usuário do perfil desativado primeiro');
  const desat = await admin.post(`/perfis/${novo.id}/desativar`, {});
  check(desat.status === 200 && desat.data?.ativo === false, 'perfil sem usuário ativo é desativado', desat.data);
  check(!((await admin.get('/perfis')).data as { id: string }[]).some((p) => p.id === novo.id), 'perfil desativado sai da lista');
  check((await admin.post('/usuarios', { id: uuid(), nome: 'Teste inativo', login: `p_in_${sufixo}`, perfilId: novo.id })).status >= 400, 'usuário não entra em perfil desativado');
  const denovo = await admin.post('/perfis', { nome: `Conferente ${sufixo}`, permissoes: ['estoque.consultar'] });
  check(denovo.status === 201, 'o nome do perfil desativado fica livre para um perfil novo', denovo.data);
  const aud = (await admin.get(`/auditoria?entidade=perfil&acao=PERFIL_DESATIVADO`)).data;
  check(aud?.items?.some((a: { entidadeId: string }) => a.entidadeId === novo.id), 'a desativação vai para a auditoria');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
