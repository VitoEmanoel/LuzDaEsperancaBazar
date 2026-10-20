/** ACS — usuários, perfis, permissões e auditoria (RF-ACS-03, 04, 06, 07). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../shared/errors.js';
import { page, parse, skipTake, zIdParam, zMoney, zPage, zPeriodo, zTexto, zUuid, zBoolQuery } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { money } from '../../shared/money.js';
import { periodo } from '../../shared/dates.js';
import { PERFIL_ADMIN_ID, PERMISSOES, type Permissao } from '../../shared/permissoes.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { hashSenha, senhaProvisoria } from './senhas.service.js';

const ESSENCIAIS_ADMIN: Permissao[] = ['usuarios.gerenciar', 'perfis.gerenciar'];

const DESCRICOES: Record<Permissao, string> = {
  'usuarios.gerenciar': 'Usuários e redefinição de senha', 'perfis.gerenciar': 'Perfis, permissões e limite de desconto',
  'auditoria.consultar': 'Trilha de auditoria', 'cadastros.gerenciar': 'Categorias, parceiros, campanhas, motivos, importação',
  'cadastros.consultar': 'Consultar cadastros', 'clientes.gerenciar': 'Clientes', 'parametros.gerenciar': 'Parâmetros e dados da instituição',
  'entrada.registrar': 'Lotes, cadastro dos produtos do lote, descartes, encerrar o lote', 'triagem.reabrir': 'Reabrir lote, reverter descarte',
  'produtos.aprovar': 'Aprovar ou devolver os produtos cadastrados nos lotes', 'parceiros.criar': 'Criar parceiro (doador) ao registrar o lote',
  'estoque.consultar': 'Estoque, produtos e lotes (só leitura)', 'estoque.transferir': 'Transferir entre bazar e doações',
  'estoque.ajustar': 'Baixa, ajuste de saída, preço da categoria, carga inicial',
  'custo.consultar': 'Ver o custo (valor atribuído) dos produtos e do estoque', 'produtos.preco': 'Alterar o preço de venda do produto',
  'produtos.desconto': 'Dar e encerrar desconto no produto', 'etiquetas.imprimir': 'Imprimir etiquetas dos produtos',
  'caixa.operar': 'Abrir/fechar caixa, vender, sangria, suprimento',
  'venda.cancelar': 'Cancelar venda', 'venda.desconto_autorizar': 'Desconto acima do limite do perfil',
  'terminais.gerenciar': 'Pontos de caixa',
  'contas_pagar.gerenciar': 'Contas a pagar e lote de compra', 'contas_receber.receber': 'Receber fiado, extrato do cliente',
  'contas_receber.lancar': 'Conta a receber manual', 'recebimento.estornar': 'Estornar recebimento',
  'relatorios.consultar': 'Relatórios, prestação de contas, histórico de caixas', 'relatorios.estoque': 'Relatórios de estoque, descartes e transferências', 'fiscal.gerenciar': 'Regra de imposto',
  'privacidade.gerenciar': 'Exportar e anonimizar titulares',
};

/** Área de cada permissão, para a tela de perfis agrupar (S3-18). */
const GRUPOS: Record<Permissao, string> = {
  'caixa.operar': 'Vendas e caixa', 'venda.cancelar': 'Vendas e caixa', 'venda.desconto_autorizar': 'Vendas e caixa', 'clientes.gerenciar': 'Vendas e caixa',
  'entrada.registrar': 'Entradas e estoque', 'triagem.reabrir': 'Entradas e estoque', 'produtos.aprovar': 'Entradas e estoque', 'parceiros.criar': 'Entradas e estoque',
  'estoque.consultar': 'Entradas e estoque', 'estoque.transferir': 'Entradas e estoque', 'estoque.ajustar': 'Entradas e estoque', 'custo.consultar': 'Entradas e estoque',
  'produtos.preco': 'Entradas e estoque', 'produtos.desconto': 'Entradas e estoque', 'etiquetas.imprimir': 'Entradas e estoque', 'cadastros.consultar': 'Entradas e estoque',
  'contas_pagar.gerenciar': 'Financeiro', 'contas_receber.receber': 'Financeiro', 'contas_receber.lancar': 'Financeiro', 'recebimento.estornar': 'Financeiro',
  'relatorios.consultar': 'Relatórios', 'relatorios.estoque': 'Relatórios',
  'usuarios.gerenciar': 'Administração', 'perfis.gerenciar': 'Administração', 'auditoria.consultar': 'Administração', 'cadastros.gerenciar': 'Administração',
  'parametros.gerenciar': 'Administração', 'terminais.gerenciar': 'Administração', 'fiscal.gerenciar': 'Administração', 'privacidade.gerenciar': 'Administração',
};

const usuarioSelect = { id: true, nome: true, login: true, perfilId: true, ativo: true, perfil: { select: { nome: true } } } as const;
type UsuarioRow = { id: string; nome: string; login: string; perfilId: string; ativo: boolean; perfil: { nome: string } };
const usuarioDto = (u: UsuarioRow) => ({ id: u.id, nome: u.nome, login: u.login, perfilId: u.perfilId, perfilNome: u.perfil.nome, ativo: u.ativo });

const perfilInclude = { permissoes: { select: { permissaoCodigo: true } } } as const;
type PerfilRow = { id: string; nome: string; padrao: boolean; ativo: boolean; limiteDescontoPct: { toFixed(n: number): string } | null; permissoes: { permissaoCodigo: string }[] };
const perfilDto = (p: PerfilRow) => ({
  id: p.id, nome: p.nome, padrao: p.padrao, ativo: p.ativo, limiteDesconto: money(p.limiteDescontoPct),
  permissoes: p.permissoes.map((x) => x.permissaoCodigo).sort(),
});

const zLogin = z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/, 'use letras, números, ponto, hífen ou sublinhado');
const zPermissoes = z.array(z.enum(PERMISSOES)).max(PERMISSOES.length).transform((a) => [...new Set(a)]);
const zPct = zMoney.refine((v) => Number(v) <= 100, 'limite em % de 0 a 100');

/** Nome de perfil é único entre os ativos, sem diferença de maiúsculas (o desativado libera o nome). */
async function nomePerfilLivre(nome: string, ignorar?: string) {
  const ja = await prisma.perfil.findFirst({ where: { ativo: true, nome: { equals: nome, mode: 'insensitive' }, ...(ignorar ? { NOT: { id: ignorar } } : {}) }, select: { id: true } });
  if (ja) conflito('NOME_DUPLICADO', 'Já existe um perfil com este nome');
}

export async function rotasUsuarios(app: FastifyInstance) {
  // ---------------- usuários ----------------
  app.get('/usuarios', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const q = parse(zPage.extend({ busca: z.string().trim().max(100).optional(), ativo: zBoolQuery.optional() }), req.query);
    const where = {
      ...(q.ativo !== undefined ? { ativo: q.ativo } : {}),
      ...(q.busca ? { OR: [{ nome: { contains: q.busca, mode: 'insensitive' as const } }, { login: { contains: q.busca.toLowerCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.usuario.findMany({ where, select: usuarioSelect, orderBy: { nome: 'asc' }, ...skipTake(q) }),
      prisma.usuario.count({ where }),
    ]);
    return page(rows.map(usuarioDto), q, total);
  });

  app.post('/usuarios', { config: { acesso: ['usuarios.gerenciar'] } }, async (req, reply) => {
    const ator = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(120), login: zLogin, perfilId: zUuid }), req.body);
    const perfil = await prisma.perfil.findFirst({ where: { id: b.perfilId, ativo: true } });
    if (!perfil) throw new AppError(400, 'Dados inválidos', 'VALIDACAO', 'perfilId: perfil inexistente ou inativo');
    const senha = senhaProvisoria();
    const u = await prisma.$transaction(async (tx) => {
      const novo = await tx.usuario.create({
        data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, login: b.login, perfilId: b.perfilId, senhaHash: await hashSenha(senha), trocarSenha: true },
        select: usuarioSelect,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'USUARIO_CRIADO', 'usuario', novo.id, undefined, { perfilId: novo.perfilId, ativo: true });
      return novo;
    });
    // Senha provisória devolvida UMA vez; nunca é logada nem armazenada em claro.
    return reply.code(201).send({ ...usuarioDto(u), senhaProvisoria: senha });
  });

  app.patch('/usuarios/:id', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(120).optional(), perfilId: zUuid.optional(), ativo: z.boolean().optional() }).strict(), req.body);
    if (id === ator.id && b.ativo === false) conflito('AUTO_DESATIVACAO', 'Você não pode desativar o próprio usuário');
    if (id === ator.id && b.perfilId && b.perfilId !== ator.perfilId) conflito('AUTO_PERFIL', 'Você não pode alterar o próprio perfil');
    const antes = await prisma.usuario.findUnique({ where: { id }, select: usuarioSelect });
    if (!antes) naoEncontrado('Usuário');
    if (b.perfilId && !(await prisma.perfil.findFirst({ where: { id: b.perfilId, ativo: true } }))) {
      throw new AppError(400, 'Dados inválidos', 'VALIDACAO', 'perfilId: perfil inexistente ou inativo');
    }
    return prisma.$transaction(async (tx) => {
      const u = await tx.usuario.update({ where: { id }, data: b, select: usuarioSelect });
      if (b.ativo === false || (b.perfilId && b.perfilId !== antes!.perfilId)) {
        await tx.sessaoUsuario.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      }
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'USUARIO_ALTERADO', 'usuario', id,
        { perfilId: antes!.perfilId, ativo: antes!.ativo }, { perfilId: u.perfilId, ativo: u.ativo, nomeAlterado: b.nome !== undefined });
      return usuarioDto(u);
    });
  });

  app.post('/usuarios/:id/redefinir-senha', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    if (!(await prisma.usuario.findUnique({ where: { id }, select: { id: true } }))) naoEncontrado('Usuário');
    const senha = senhaProvisoria();
    const hash = await hashSenha(senha);
    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: { senhaHash: hash, trocarSenha: true } });
      await tx.sessaoUsuario.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'SENHA_REDEFINIDA', 'usuario', id);
    });
    return { senhaProvisoria: senha };
  });

  // ---------------- perfis e permissões ----------------
  app.get('/perfis', { config: { acesso: ['perfis.gerenciar', 'usuarios.gerenciar'] } }, async () => {
    const ps = await prisma.perfil.findMany({ where: { ativo: true }, include: perfilInclude, orderBy: { nome: 'asc' } });
    return ps.map(perfilDto);
  });

  app.get('/permissoes', { config: { acesso: ['perfis.gerenciar'] } }, async () =>
    PERMISSOES.map((codigo) => ({ codigo, descricao: DESCRICOES[codigo], grupo: GRUPOS[codigo] })));

  app.post('/perfis', { config: { acesso: ['perfis.gerenciar'] } }, async (req, reply) => {
    const ator = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(60), permissoes: zPermissoes, limiteDesconto: zPct.default('0.00') }), req.body);
    await nomePerfilLivre(b.nome);
    const p = await prisma.$transaction(async (tx) => {
      const novo = await tx.perfil.create({
        data: {
          ...(b.id ? { id: b.id } : {}), nome: b.nome, padrao: false, limiteDescontoPct: b.limiteDesconto,
          permissoes: { create: b.permissoes.map((c) => ({ permissaoCodigo: c })) },
        },
        include: perfilInclude,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'PERFIL_CRIADO', 'perfil', novo.id, undefined, { permissoes: b.permissoes, limiteDesconto: b.limiteDesconto });
      return novo;
    });
    return reply.code(201).send(perfilDto(p));
  });

  app.patch('/perfis/:id', { config: { acesso: ['perfis.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(60).optional(), permissoes: zPermissoes.optional(), limiteDesconto: zPct.optional() }).strict(), req.body);
    const antes = await prisma.perfil.findUnique({ where: { id }, include: perfilInclude });
    if (!antes) naoEncontrado('Perfil');
    if (!antes!.ativo) conflito('PERFIL_INATIVO', 'O perfil está desativado e não se edita');
    if (antes!.padrao && b.nome && b.nome !== antes!.nome) conflito('PERFIL_PADRAO', 'Perfis padrão não podem ser renomeados');
    if (b.nome && b.nome.toLowerCase() !== antes!.nome.toLowerCase()) await nomePerfilLivre(b.nome, id);
    if (id === PERFIL_ADMIN_ID && b.permissoes && !ESSENCIAIS_ADMIN.every((p) => b.permissoes!.includes(p))) {
      conflito('PERFIL_ADMIN_PROTEGIDO', 'O perfil Administrador precisa manter usuarios.gerenciar e perfis.gerenciar');
    }
    const p = await prisma.$transaction(async (tx) => {
      if (b.permissoes) {
        await tx.perfilPermissao.deleteMany({ where: { perfilId: id } });
        await tx.perfilPermissao.createMany({ data: b.permissoes.map((c) => ({ perfilId: id, permissaoCodigo: c })) });
      }
      const novo = await tx.perfil.update({
        where: { id },
        data: { ...(b.nome ? { nome: b.nome } : {}), ...(b.limiteDesconto ? { limiteDescontoPct: b.limiteDesconto } : {}) },
        include: perfilInclude,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'PERFIL_ALTERADO', 'perfil', id,
        { permissoes: antes!.permissoes.map((x) => x.permissaoCodigo), limiteDesconto: money(antes!.limiteDescontoPct) },
        { permissoes: novo.permissoes.map((x) => x.permissaoCodigo), limiteDesconto: money(novo.limiteDescontoPct) });
      return novo;
    });
    return perfilDto(p);
  });

  // Desativar o perfil criado por engano (S3-20): padrão não; com usuário ativo não (o banco confere de novo, 0010).
  app.post('/perfis/:id/desativar', { config: { acesso: ['perfis.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const p = await prisma.$transaction(async (tx) => {
      const [antes] = await tx.$queryRaw<{ padrao: boolean; ativo: boolean }[]>`SELECT padrao, ativo FROM perfil WHERE id = ${id}::uuid FOR UPDATE`;
      if (!antes) naoEncontrado('Perfil');
      if (antes!.padrao) conflito('PERFIL_PADRAO', 'Perfis padrão não são desativados');
      if (!antes!.ativo) conflito('PERFIL_INATIVO', 'O perfil já está desativado');
      if (await tx.usuario.count({ where: { perfilId: id, ativo: true } })) conflito('PERFIL_EM_USO', 'Há usuário ativo com este perfil: troque o perfil dele antes de desativar');
      const novo = await tx.perfil.update({ where: { id }, data: { ativo: false }, include: perfilInclude });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'PERFIL_DESATIVADO', 'perfil', id, { ativo: true }, { ativo: false });
      return novo;
    });
    return perfilDto(p);
  });

  // ---------------- auditoria ----------------
  app.get('/auditoria', { config: { acesso: ['auditoria.consultar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({
      acao: z.string().trim().max(60).optional(), entidade: z.string().trim().max(60).optional(),
    }), req.query);
    const where = {
      ...(q.acao ? { acao: { contains: q.acao.toUpperCase() } } : {}),
      ...(q.entidade ? { entidade: q.entidade } : {}),
      ...(periodo(q.de, q.ate) ? { criadoEm: periodo(q.de, q.ate) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditoria.findMany({ where, orderBy: { id: 'desc' }, ...skipTake(q) }),
      prisma.auditoria.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.usuarioId).filter((x): x is string => !!x))];
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    return page(rows.map((r) => ({
      id: r.id.toString(), ocorridoEm: r.criadoEm.toISOString(), usuarioNome: r.usuarioId ? nomes.get(r.usuarioId) ?? '—' : 'Sistema',
      acao: r.acao, entidade: r.entidade, entidadeId: r.entidadeId,
    })), q, total);
  });
}
