/**
 * Produto (S3-04): dados, edição dos campos, entradas com saldo e histórico; preço (S3-08) e desconto (S3-09).
 * O preço e o desconto são do produto: valem para todas as unidades, de todas as entradas (P-14).
 * O preço efetivo vem de fn_preco_efetivo (0010), a mesma conta do PDV e da venda.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Tx } from '../../shared/prisma.js';
import { conflito, invalido, naoEncontrado } from '../../shared/errors.js';
import { parse, zData, zIdParam, zMoney, zMotivo } from '../../shared/http.js';
import { auditar, type AuditCtx } from '../../shared/audit.js';
import { money, toCents } from '../../shared/money.js';
import { fromDbDate, localDate, toDbDate } from '../../shared/dates.js';
import { exigirUsuario, tem } from '../../plugins/auth.js';

const LOCAL: Record<number, 'BAZAR' | 'DOACOES'> = { 1: 'BAZAR', 2: 'DOACOES' };
/** Valor lido em SQL cru (texto) no formato da API. */
const txt = (v: string | null | undefined) => (v === null || v === undefined ? undefined : Number(v).toFixed(2));

/** Desconto vigente hoje? (validade opcional, até o fim do dia local: P-05) */
const vigente = (ate: Date | null) => !ate || fromDbDate(ate) >= localDate();

/**
 * Muda o preço do produto com motivo e auditoria. Se o preço novo não ficar acima do preço promocional vigente,
 * o desconto acaba junto (o promocional precisa ser menor que o preço) e isso também vai para a auditoria.
 */
export async function mudarPrecoProduto(tx: Tx, produtoId: string, preco: string, motivo: string, ctx: AuditCtx, itemId?: string) {
  const [p] = await tx.$queryRaw<{ preco_venda: string; desconto_tipo: string | null; desconto_valor: string | null }[]>`
    SELECT preco_venda::text, desconto_tipo, desconto_valor::text FROM produto WHERE id = ${produtoId}::uuid FOR UPDATE`;
  if (!p) naoEncontrado('Produto');
  const encerra = p!.desconto_tipo === 'PRECO' && toCents(p!.desconto_valor) >= toCents(preco);
  await tx.produto.update({
    where: { id: produtoId },
    data: { precoVenda: preco, ...(encerra ? { descontoTipo: null, descontoValor: null, descontoAte: null, descontoMotivo: null, descontoPorId: null, descontoEm: null } : {}) },
  });
  // RF-EST-07: histórico do preço na auditoria
  await auditar(tx, ctx, 'PRECO_PRODUTO', 'produto', produtoId, { preco: txt(p!.preco_venda) }, { preco, motivo, ...(itemId ? { itemId } : {}) });
  if (encerra) {
    await auditar(tx, ctx, 'DESCONTO_PRODUTO_ENCERRADO', 'produto', produtoId, { tipo: 'PRECO', valor: txt(p!.desconto_valor) },
      { motivo: 'O preço novo ficou igual ou abaixo do preço promocional' });
  }
}

const zPreco = z.object({ preco: zMoney.refine((v) => toCents(v) > 0, 'preço deve ser maior que zero'), motivo: zMotivo });
const zTextoOpc = z.string().trim().max(80).nullable().optional();
const zEdicao = z.object({
  tituloEtiqueta: z.string().trim().min(1).max(40).optional(), nome: z.string().trim().min(1).max(120).optional(),
  modelo: zTextoOpc, marca: zTextoOpc, ano: z.number().int().min(1800).max(2200).nullable().optional(),
  tipo: zTextoOpc, tamanho: zTextoOpc, cor: zTextoOpc, condicao: zTextoOpc,
}).strict();
const zDesconto = z.object({
  tipo: z.enum(['PERCENTUAL', 'PRECO']), valor: zMoney, ate: zData.optional(), motivo: zMotivo,
}).strict();

export async function rotasProdutos(app: FastifyInstance) {
  app.get('/produtos/:id', { config: { acesso: ['estoque.consultar', 'entrada.registrar', 'produtos.aprovar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const p = await prisma.produto.findUnique({ where: { id }, include: { categoria: { select: { nome: true } }, descontoPor: { select: { nome: true } } } });
    if (!p) naoEncontrado('Produto');
    const [ef] = await prisma.$queryRaw<{ preco: string }[]>`
      SELECT fn_preco_efetivo(preco_venda, desconto_tipo, desconto_valor, desconto_ate)::text AS preco FROM produto WHERE id = ${id}::uuid`;
    const verCusto = tem(u, 'custo.consultar');

    const itens = await prisma.item.findMany({
      where: { produtoId: id }, orderBy: [{ criadoEm: 'asc' }],
      include: { lote: { select: { id: true, numero: true, recebidoEm: true, parceiro: { select: { nome: true } }, campanha: { select: { nome: true } } } }, saldos: true },
    });
    const entradas = itens.map((i) => {
      const b = i.saldos.find((s) => s.localId === 1)?.saldo ?? 0;
      const d = i.saldos.find((s) => s.localId === 2)?.saldo ?? 0;
      return {
        itemId: i.id, loteId: i.lote.id, loteNumero: i.lote.numero, recebidoEm: i.lote.recebidoEm.toISOString(),
        origem: [i.lote.parceiro?.nome, i.lote.campanha?.nome].filter(Boolean).join(' · ') || undefined,
        status: i.status, quantidade: i.quantidadeInicial, saldoBazar: b, saldoDoacoes: d,
        ...(verCusto ? { valorAtribuido: money(i.valorAtribuido) } : {}),
      };
    });

    // histórico: as movimentações de todas as entradas e as mudanças do próprio produto (preço, desconto, dados)
    const movs = await prisma.movimentacao.findMany({
      where: { itemId: { in: itens.map((i) => i.id) } }, orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }],
      include: { motivoBaixa: { select: { nome: true } }, item: { select: { lote: { select: { numero: true } } } } },
    });
    const auds = await prisma.auditoria.findMany({ where: { entidade: 'produto', entidadeId: id }, orderBy: { criadoEm: 'asc' } });
    const ids = [...new Set([...movs.map((m) => m.usuarioId), ...auds.map((a) => a.usuarioId).filter((x): x is string => !!x)])];
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
    const eventos = [
      ...movs.map((m) => ({
        ocorridoEm: m.ocorridoEm.toISOString(), tipo: m.tipo, loteNumero: m.item.lote.numero, quantidade: m.quantidade,
        origem: m.localOrigemId ? LOCAL[m.localOrigemId] : undefined, destino: m.localDestinoId ? LOCAL[m.localDestinoId] : undefined,
        detalhe: m.motivoBaixa?.nome ?? m.motivo ?? undefined, usuarioNome: nomes.get(m.usuarioId),
      })),
      ...auds.map((a) => ({
        ocorridoEm: a.criadoEm.toISOString(), tipo: a.acao, antes: a.antes ?? undefined, depois: a.depois ?? undefined,
        usuarioNome: a.usuarioId ? nomes.get(a.usuarioId) : undefined,
      })),
    ].sort((x, y) => x.ocorridoEm.localeCompare(y.ocorridoEm));

    const desconto = p!.descontoTipo ? {
      tipo: p!.descontoTipo, valor: money(p!.descontoValor), ate: p!.descontoAte ? fromDbDate(p!.descontoAte) : undefined,
      motivo: p!.descontoMotivo ?? undefined, porNome: p!.descontoPor?.nome, em: p!.descontoEm?.toISOString(), vigente: vigente(p!.descontoAte),
    } : undefined;
    return {
      id: p!.id, codigo: p!.codigo, tituloEtiqueta: p!.tituloEtiqueta, nome: p!.nome, categoriaId: p!.categoriaId, categoriaNome: p!.categoria.nome,
      preco: money(p!.precoVenda), precoEfetivo: txt(ef!.preco), desconto, pecaUnica: p!.pecaUnica, ativo: p!.ativo,
      modelo: p!.modelo ?? undefined, marca: p!.marca ?? undefined, ano: p!.ano ?? undefined, tipo: p!.tipo ?? undefined,
      tamanho: p!.tamanho ?? undefined, cor: p!.cor ?? undefined, condicao: p!.condicao ?? undefined, criadoEm: p!.criadoEm.toISOString(),
      saldoBazar: entradas.reduce((s, e) => s + e.saldoBazar, 0), saldoDoacoes: entradas.reduce((s, e) => s + e.saldoDoacoes, 0),
      entradas, eventos,
    };
  });

  // Dados descritivos (não o código, a categoria, a peça única nem o preço, que têm regra própria): quem cadastra produtos
  app.patch('/produtos/:id', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zEdicao, req.body);
    if (!Object.keys(b).length) invalido('corpo', 'nada para alterar');
    await prisma.$transaction(async (tx) => {
      const antes = await tx.produto.findUnique({ where: { id } });
      if (!antes) naoEncontrado('Produto');
      await tx.produto.update({ where: { id }, data: b });
      const campos = Object.keys(b) as (keyof typeof b)[];
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PRODUTO_ALTERADO', 'produto', id,
        Object.fromEntries(campos.map((k) => [k, antes![k] ?? null])), Object.fromEntries(campos.map((k) => [k, b[k] ?? null])));
    });
    return reply.code(204).send();
  });

  app.patch('/produtos/:id/preco', { config: { acesso: ['produtos.preco'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zPreco, req.body);
    await prisma.$transaction((tx) => mudarPrecoProduto(tx, id, b.preco, b.motivo, { usuarioId: u.id, ip: req.ip }));
    return reply.code(204).send();
  });

  // Desconto (S3-09): Financeiro e Admin. Um vigente por produto: dar um novo substitui o anterior (fica na auditoria).
  app.put('/produtos/:id/desconto', { config: { acesso: ['produtos.desconto'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zDesconto, req.body);
    const v = toCents(b.valor);
    if (b.tipo === 'PERCENTUAL' && (v <= 0 || v >= 10_000)) invalido('valor', 'percentual entre 0 e 100, sem os extremos');
    if (b.ate && b.ate < localDate()) invalido('ate', 'a validade não pode estar no passado');
    await prisma.$transaction(async (tx) => {
      const [p] = await tx.$queryRaw<{ preco_venda: string; desconto_tipo: string | null; desconto_valor: string | null; desconto_ate: Date | null }[]>`
        SELECT preco_venda::text, desconto_tipo, desconto_valor::text, desconto_ate FROM produto WHERE id = ${id}::uuid FOR UPDATE`;
      if (!p) naoEncontrado('Produto');
      if (b.tipo === 'PRECO' && (v <= 0 || v >= toCents(p!.preco_venda))) invalido('valor', 'o preço promocional fica abaixo do preço de venda');
      await tx.produto.update({
        where: { id },
        data: { descontoTipo: b.tipo, descontoValor: b.valor, descontoAte: b.ate ? toDbDate(b.ate) : null, descontoMotivo: b.motivo, descontoPorId: u.id, descontoEm: new Date() },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'DESCONTO_PRODUTO', 'produto', id,
        p!.desconto_tipo ? { tipo: p!.desconto_tipo, valor: txt(p!.desconto_valor), ate: p!.desconto_ate ? fromDbDate(p!.desconto_ate) : null } : undefined,
        { tipo: b.tipo, valor: b.valor, ate: b.ate ?? null, motivo: b.motivo, preco: txt(p!.preco_venda) });
    });
    return { ok: true };
  });

  app.post('/produtos/:id/desconto/encerrar', { config: { acesso: ['produtos.desconto'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }).strict(), req.body);
    await prisma.$transaction(async (tx) => {
      const [p] = await tx.$queryRaw<{ desconto_tipo: string | null; desconto_valor: string | null }[]>`
        SELECT desconto_tipo, desconto_valor::text FROM produto WHERE id = ${id}::uuid FOR UPDATE`;
      if (!p) naoEncontrado('Produto');
      if (!p!.desconto_tipo) conflito('SEM_DESCONTO', 'O produto não tem desconto');
      await tx.produto.update({ where: { id }, data: { descontoTipo: null, descontoValor: null, descontoAte: null, descontoMotivo: null, descontoPorId: null, descontoEm: null } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'DESCONTO_PRODUTO_ENCERRADO', 'produto', id, { tipo: p!.desconto_tipo, valor: txt(p!.desconto_valor) }, { motivo });
    });
    return reply.code(204).send();
  });
}
