/**
 * ENT/TRI — lotes de entrada, anexo do documento, cadastro dos produtos do lote e descartes,
 * aprovação pelo Administrador, encerramento/reabertura, reversão de descarte e etiquetas
 * (RF-ENT-01..03, RF-TRI-01..05; Sprint 2: docs/arquitetura/produto-e-aprovacao.md).
 * O item nasce CADASTRADO e não mexe no estoque: a ENTRADA só é gravada na aprovação.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db, type Tx } from '../../shared/prisma.js';
import { AppError, conflito, invalido, naoEncontrado, proibido } from '../../shared/errors.js';
import { page, parse, skipTake, zData, zIdParam, zMoney, zMotivo, zPage, zPeriodo, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { money, moneyOpt, toCents, fromCents } from '../../shared/money.js';
import { localDate, periodo, toDbDate } from '../../shared/dates.js';
import { paramNum } from '../../shared/parametros.js';
import { env } from '../../config/env.js';
import { exigirUsuario, tem, type UsuarioCtx } from '../../plugins/auth.js';
import { PERFIL_ADMIN_ID } from '../../shared/permissoes.js';
import { mudarPrecoProduto } from '../estoque/produtos.routes.js';

export const LOCAL_ID = { BAZAR: 1, DOACOES: 2 } as const;
export const LOCAL_COD: Record<number, 'BAZAR' | 'DOACOES'> = { 1: 'BAZAR', 2: 'DOACOES' };

const TIPOS_ANEXO: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const MIME_POR_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };
const RE_CHAVE_ARQUIVO = /^lotes\/[0-9a-f-]{36}\.(pdf|png|jpg)$/;

// ---------------- DTO ----------------
const loteInclude = { parceiro: { select: { nome: true } }, campanha: { select: { nome: true } }, contaPagar: { select: { status: true } } } as const;
type LoteRow = Awaited<ReturnType<typeof prisma.loteEntrada.findFirstOrThrow<{ include: typeof loteInclude }>>>;
interface Resumo { aprovados: number; pendentes: number; devolvidos: number; descartados: number; valor: number }

/** Só itens aprovados entram no recebido e no valor atribuído (cadastrados e devolvidos ainda não chegaram ao estoque). */
async function resumos(db: Db, ids: string[]): Promise<Map<string, Resumo>> {
  const m = new Map<string, Resumo>(ids.map((id) => [id, { aprovados: 0, pendentes: 0, devolvidos: 0, descartados: 0, valor: 0 }]));
  if (!ids.length) return m;
  const itens = await db.item.groupBy({ by: ['loteId', 'status'], where: { loteId: { in: ids } }, _sum: { quantidadeInicial: true }, _count: { _all: true } });
  const valores = await db.$queryRaw<{ lote_id: string; v: string }[]>`
    SELECT lote_id::text, coalesce(sum(quantidade_inicial * valor_atribuido), 0)::text AS v FROM item
    WHERE lote_id = ANY(${ids}::uuid[]) AND status = 'APROVADO' GROUP BY lote_id`;
  const desc = await db.descarte.groupBy({ by: ['loteId'], where: { loteId: { in: ids }, revertidoEm: null }, _count: { _all: true } });
  for (const i of itens) {
    const r = m.get(i.loteId)!;
    if (i.status === 'APROVADO') r.aprovados = i._sum.quantidadeInicial ?? 0;
    else if (i.status === 'CADASTRADO') r.pendentes = i._count._all;
    else r.devolvidos = i._count._all;
  }
  for (const v of valores) m.get(v.lote_id)!.valor = toCents(Number(v.v).toFixed(2));
  for (const d of desc) m.get(d.loteId)!.descartados = d._count._all;
  return m;
}

function loteDto(l: LoteRow, r: Resumo) {
  return {
    id: l.id, numero: l.numero, tipo: l.tipo,
    parceiroId: l.parceiroId ?? undefined, parceiroNome: l.parceiro?.nome,
    campanhaId: l.campanhaId ?? undefined, campanhaNome: l.campanha?.nome,
    documento: l.documentoNumero ?? undefined, temAnexo: !!l.documentoArquivo,
    recebidoEm: l.recebidoEm.toISOString(),
    status: l.status === 'TRIADO' ? 'TRIADO' : 'ABERTO',
    aprovados: r.aprovados, pendentes: r.pendentes, devolvidos: r.devolvidos, descartados: r.descartados, valorAtribuido: fromCents(r.valor),
    valorCompra: moneyOpt(l.valorCompra),
    pago: l.contaPagar ? l.contaPagar.status === 'PAGA' : undefined,
  };
}

export async function obterLoteDto(db: Db, id: string) {
  const l = await db.loteEntrada.findUnique({ where: { id }, include: loteInclude });
  if (!l) naoEncontrado('Lote');
  return loteDto(l!, (await resumos(db, [id])).get(id)!);
}

const itemTriagemInclude = { categoria: { select: { nome: true } }, produto: true } as const;
type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemTriagemInclude }>;
const produtoDto = (p: NonNullable<ItemRow['produto']>) => ({
  id: p.id, codigo: p.codigo, tituloEtiqueta: p.tituloEtiqueta, nome: p.nome, categoriaId: p.categoriaId, preco: money(p.precoVenda),
  pecaUnica: p.pecaUnica, modelo: p.modelo ?? undefined, marca: p.marca ?? undefined, ano: p.ano ?? undefined, tipo: p.tipo ?? undefined,
  tamanho: p.tamanho ?? undefined, cor: p.cor ?? undefined, condicao: p.condicao ?? undefined,
});
const itemTriagemDto = (i: ItemRow) => ({
  id: i.id, controle: i.tipoControle, codigo: i.produto?.codigo ?? i.codigoBarras ?? undefined,
  descricao: i.descricao ?? i.produto?.nome ?? i.categoria.nome, categoriaId: i.categoriaId, categoriaNome: i.categoria.nome,
  quantidade: i.quantidadeInicial, preco: money(i.produto?.precoVenda ?? i.precoVenda ?? i.valorAtribuido), valorAtribuido: money(i.valorAtribuido),
  localDestino: LOCAL_COD[i.localDestinoId] ?? 'BAZAR',
  status: i.status, motivoDevolucao: i.motivoDevolucao ?? undefined, criadoPorId: i.criadoPorId,
  produto: i.produto ? produtoDto(i.produto) : undefined,
});

/** Sem a permissão de ver custo (S3-05), o valor atribuído e o valor da compra não saem da API. */
export function semCusto<T extends Record<string, unknown>>(u: UsuarioCtx, o: T): T {
  if (tem(u, 'custo.consultar')) return o;
  const { valorAtribuido: _v, valorCompra: _c, ...resto } = o;
  return resto as T;
}

/** Quem cadastrou não aprova nem devolve o próprio item; só o perfil Administrador pode (S3-22, P-16; o banco confere de novo). */
function confereOutraPessoa(u: UsuarioCtx, criadoPorId: string) {
  if (criadoPorId === u.id && u.perfilId !== PERFIL_ADMIN_ID) conflito('AUTO_APROVACAO', 'Quem cadastrou o item não aprova nem devolve o próprio cadastro: outra pessoa confere');
}

type DescRow = { id: string; registradoEm: Date; revertidoEm: Date | null; categoria: { nome: string }; motivo: { nome: string } };
const descarteDto = (d: DescRow) => ({ id: d.id, categoriaNome: d.categoria.nome, motivoNome: d.motivo.nome, registradoEm: d.registradoEm.toISOString(), revertido: !!d.revertidoEm });
const descInclude = { categoria: { select: { nome: true } }, motivo: { select: { nome: true } } } as const;

/** Gera o próximo código do produto (BZ + 6 dígitos, a mesma sequência das peças antigas: P-06). */
export async function proximoCodigo(tx: Tx): Promise<string> {
  const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_codigo_barras') AS n`;
  return `BZ${String(r!.n).padStart(6, '0')}`;
}

/**
 * Trava os itens SEMPRE na ordem do id — a mesma da venda e do estorno (fn_estorna_venda_cancelada),
 * para duas transações nunca esperarem uma pela outra em ordem cruzada. Devolve o estado lido depois da trava.
 */
export async function travarItens(tx: Tx, ids: string[]): Promise<{ id: string; status: string }[]> {
  if (!ids.length) return [];
  return tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id::text, status::text FROM item WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/** Aprova um item já travado e CADASTRADO: o estoque recebe a quantidade no local escolhido no cadastro. */
async function aprovarItem(tx: Tx, id: string, usuarioId: string, ip: string) {
  const i = await tx.item.update({
    where: { id }, data: { status: 'APROVADO', aprovadoPorId: usuarioId, aprovadoEm: new Date() },
    select: { localDestinoId: true, quantidadeInicial: true, lote: { select: { numero: true } } },
  });
  await tx.movimentacao.create({
    data: { itemId: id, tipo: 'ENTRADA', localDestinoId: i.localDestinoId, quantidade: i.quantidadeInicial, usuarioId, motivo: `Aprovação do lote ${i.lote.numero}` },
  });
  await auditar(tx, { usuarioId, ip }, 'ITEM_APROVADO', 'item', id, { status: 'CADASTRADO' }, { status: 'APROVADO', local: LOCAL_COD[i.localDestinoId], quantidade: i.quantidadeInicial });
}

// ---------------- esquemas ----------------
const zNovoLote = z.object({
  id: zUuid,
  tipo: z.enum(['DOACAO', 'COMPRA', 'SALDO_INICIAL']),
  parceiroId: zUuid.optional().or(z.literal('').transform(() => undefined)),
  campanhaId: zUuid.optional().or(z.literal('').transform(() => undefined)),
  documento: z.string().trim().max(60).optional(),
  documentoTipo: z.enum(['NOTA_FISCAL', 'TERMO_DOACAO', 'RECIBO', 'OUTRO']).optional(),
  observacao: z.string().trim().max(500).optional(),
  valorCompra: zMoney.optional(),
  pago: z.boolean().optional(),
  formaPagamento: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']).optional(),
  vencimento: zData.optional(),
});
const zPrecoPositivo = zMoney.refine((v) => toCents(v) > 0, 'preço deve ser maior que zero');
const zOpcional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
/** Campos do produto (P-06): título da etiqueta, nome e preço obrigatórios; o resto é opcional. */
const zCamposProduto = z.object({
  tituloEtiqueta: z.string().trim().min(1, 'obrigatório').max(40),
  nome: z.string().trim().min(1, 'obrigatório').max(120),
  preco: zPrecoPositivo,
  pecaUnica: z.boolean().default(false),
  modelo: zOpcional(60), marca: zOpcional(60), tipo: zOpcional(60), tamanho: zOpcional(30), cor: zOpcional(30), condicao: zOpcional(30),
  ano: z.number().int().min(1800).max(2200).optional(),
});
/**
 * Item do lote. `CATEGORIA`: como antes (o preço é o da categoria; `preco` só sugere o valor atribuído).
 * `ETIQUETADO`: produto novo (`produto`) ou nova entrada de um produto que já existe (`produtoId`); valor atribuído obrigatório.
 */
const zItem = z.object({
  id: zUuid,
  categoriaId: zUuid,
  controle: z.enum(['ETIQUETADO', 'CATEGORIA']),
  quantidade: z.number().int().min(1).max(10_000),
  preco: zPrecoPositivo.optional(),
  valorAtribuido: zMoney.optional(),
  descricao: z.string().trim().max(120).optional(),
  localDestino: z.enum(['BAZAR', 'DOACOES']),
  descarteOrigemId: zUuid.optional(),
  produtoId: zUuid.optional(),
  produto: zCamposProduto.optional(),
}).superRefine((b, ctx) => {
  const erro = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (b.controle === 'CATEGORIA') {
    if (b.produtoId || b.produto) erro('controle', 'item por categoria não tem produto');
    if (!b.preco && !b.valorAtribuido) erro('valorAtribuido', 'obrigatório');
    return;
  }
  if (!b.produtoId === !b.produto) erro('produto', 'informe o produto novo ou o produto que já existe (produtoId), um dos dois');
  if (!b.valorAtribuido) erro('valorAtribuido', 'obrigatório');
});
/** Correção de item cadastrado ou devolvido: só os campos enviados mudam. */
const zCorrecao = z.object({
  quantidade: z.number().int().min(1).max(10_000).optional(),
  valorAtribuido: zMoney.optional(),
  descricao: z.string().trim().max(120).optional(),
  localDestino: z.enum(['BAZAR', 'DOACOES']).optional(),
  categoriaId: zUuid.optional(),
  produto: zCamposProduto.partial().optional(),
});
const zDescarte = z.object({ id: zUuid, categoriaId: zUuid, motivoId: zUuid, observacao: z.string().trim().max(500).optional(), descricao: z.string().trim().max(120).optional() });

export async function rotasLotes(app: FastifyInstance) {
  // leitura dos lotes: quem registra, quem aprova e quem consulta o estoque (Financeiro, só leitura: S3-12, P-07)
  app.get('/lotes', { config: { acesso: ['entrada.registrar', 'produtos.aprovar', 'estoque.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(zPage.merge(zPeriodo).extend({ parceiroId: zUuid.optional(), campanhaId: zUuid.optional(), status: z.enum(['ABERTO', 'TRIADO']).optional() }), req.query);
    const where = {
      ...(q.parceiroId ? { parceiroId: q.parceiroId } : {}),
      ...(q.campanhaId ? { campanhaId: q.campanhaId } : {}),
      ...(q.status === 'TRIADO' ? { status: 'TRIADO' as const } : q.status === 'ABERTO' ? { status: { in: ['AGUARDANDO_TRIAGEM' as const, 'EM_TRIAGEM' as const] } } : {}),
      ...(periodo(q.de, q.ate) ? { recebidoEm: periodo(q.de, q.ate) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.loteEntrada.findMany({ where, include: loteInclude, orderBy: { numero: 'desc' }, ...skipTake(q) }),
      prisma.loteEntrada.count({ where }),
    ]);
    const rs = await resumos(prisma, rows.map((l) => l.id));
    return page(rows.map((l) => semCusto(u, loteDto(l, rs.get(l.id)!))), q, total);
  });

  app.get('/lotes/:id', { config: { acesso: ['entrada.registrar', 'produtos.aprovar', 'estoque.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const base = await obterLoteDto(prisma, id);
    const [itens, descartes] = await Promise.all([
      prisma.item.findMany({ where: { loteId: id }, include: itemTriagemInclude, orderBy: { criadoEm: 'asc' } }),
      prisma.descarte.findMany({ where: { loteId: id }, include: descInclude, orderBy: { registradoEm: 'asc' } }),
    ]);
    return { ...semCusto(u, base), itens: itens.map((i) => semCusto(u, itemTriagemDto(i))), descartes: descartes.map(descarteDto) };
  });

  app.post('/lotes', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zNovoLote, req.body);
    const existente = await prisma.loteEntrada.findUnique({ where: { id: b.id }, select: { id: true } });
    if (existente) return reply.code(200).send(semCusto(u, await obterLoteDto(prisma, b.id))); // reenvio idempotente

    if (b.tipo === 'SALDO_INICIAL' && !tem(u, 'estoque.ajustar')) proibido('Lote de saldo inicial é criado pela carga inicial');
    // RN-04 (S2-06): doação exige o parceiro; a campanha é opcional. Sem saber quem doou: "Doador não identificado".
    if (b.tipo === 'DOACAO' && !b.parceiroId) throw new AppError(400, 'Informe o parceiro (doador) do lote', 'PARCEIRO_OBRIGATORIO');
    if (b.tipo === 'COMPRA') {
      if (!tem(u, 'contas_pagar.gerenciar')) proibido('Registrar compra exige permissão de contas a pagar');
      if (!b.parceiroId) throw new AppError(400, 'Compra exige fornecedor', 'FORNECEDOR_OBRIGATORIO'); // RN-05
      if (!b.valorCompra || toCents(b.valorCompra) <= 0) throw new AppError(400, 'Compra exige valor pago', 'VALOR_OBRIGATORIO');
    }
    if (b.parceiroId && !(await prisma.parceiro.findFirst({ where: { id: b.parceiroId, ativo: true } }))) throw new AppError(400, 'Parceiro inexistente ou inativo', 'VALIDACAO');
    if (b.campanhaId && !(await prisma.campanha.findFirst({ where: { id: b.campanhaId, ativa: true } }))) throw new AppError(400, 'Campanha inexistente ou inativa', 'VALIDACAO');

    await prisma.$transaction(async (tx) => {
      const agora = new Date();
      const lote = await tx.loteEntrada.create({
        data: {
          id: b.id, tipo: b.tipo, parceiroId: b.parceiroId ?? null, campanhaId: b.campanhaId ?? null,
          recebidoEm: agora, recebidoPorId: u.id, documentoNumero: b.documento || null, documentoTipo: b.documentoTipo ?? null,
          observacao: b.observacao ?? null, valorCompra: b.tipo === 'COMPRA' ? b.valorCompra! : null,
        },
      });
      if (b.tipo === 'COMPRA') {
        // RN-05: a conta a pagar do fornecedor nasce na mesma transação, ligada ao lote
        await tx.contaPagar.create({
          data: {
            descricao: `Compra — lote ${lote.numero}`, valor: b.valorCompra!, loteId: lote.id, criadaPorId: u.id,
            vencimento: toDbDate(b.vencimento ?? localDate()),
            ...(b.pago ? { status: 'PAGA' as const, pagoEm: agora, valorPago: b.valorCompra!, formaPagamento: b.formaPagamento ?? 'PIX' } : {}),
          },
        });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_CRIADO', 'lote_entrada', lote.id, undefined, { tipo: b.tipo, parceiroId: b.parceiroId, campanhaId: b.campanhaId });
    });
    return reply.code(201).send(semCusto(u, await obterLoteDto(prisma, b.id)));
  });

  // ---------------- anexo (RF-ENT-02, RNF-18) ----------------
  app.post('/lotes/:id/documento', { config: { acesso: ['entrada.registrar'], rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const lote = await prisma.loteEntrada.findUnique({ where: { id }, select: { id: true } });
    if (!lote) naoEncontrado('Lote');
    const maxMb = await paramNum(prisma, 'anexo.tamanho_max_mb', 5);
    const arquivo = await req.file();
    if (!arquivo || arquivo.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const buf = await arquivo.toBuffer();
    if (buf.length === 0) throw new AppError(400, 'Arquivo vazio', 'ARQUIVO_OBRIGATORIO');
    if (buf.length > maxMb * 1024 * 1024) throw new AppError(413, `Arquivo maior que ${maxMb} MB`, 'ANEXO_GRANDE');
    // Tipo REAL pelos magic bytes — ignora extensão e Content-Type enviados
    const tipo = await fileTypeFromBuffer(buf);
    const ext = tipo ? TIPOS_ANEXO[tipo.mime] : undefined;
    if (!ext) throw new AppError(415, 'Tipo de arquivo não aceito (PDF, PNG ou JPEG)', 'TIPO_INVALIDO');
    const chave = `lotes/${randomUUID()}.${ext}`; // nome único, nunca o nome do usuário
    const destino = path.resolve(env.UPLOAD_DIR, chave);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, buf, { mode: 0o600, flag: 'wx' });
    await prisma.$transaction(async (tx) => {
      await tx.loteEntrada.update({ where: { id }, data: { documentoArquivo: chave } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_DOCUMENTO_ANEXADO', 'lote_entrada', id, undefined, { tipo: tipo!.mime, bytes: buf.length });
    });
    return reply.code(204).send();
  });

  app.get('/lotes/:id/documento', { config: { acesso: ['entrada.registrar', 'produtos.aprovar', 'estoque.consultar'] } }, async (req, reply) => {
    const { id } = parse(zIdParam, req.params);
    const l = await prisma.loteEntrada.findUnique({ where: { id }, select: { numero: true, documentoArquivo: true } });
    if (!l || !l.documentoArquivo) naoEncontrado('Documento');
    const chave = l!.documentoArquivo!;
    if (!RE_CHAVE_ARQUIVO.test(chave)) naoEncontrado('Documento'); // defesa contra path traversal
    const ext = chave.split('.').pop()!;
    const buf = await readFile(path.resolve(env.UPLOAD_DIR, chave)).catch(() => null);
    if (!buf) naoEncontrado('Documento');
    return reply
      .header('Content-Type', MIME_POR_EXT[ext]!)
      .header('Content-Disposition', `attachment; filename="lote-${l!.numero}.${ext}"`)
      .send(buf);
  });

  // ---------------- cadastro dos produtos do lote (S2-07, S2-08) ----------------
  app.post('/lotes/:id/itens', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id: loteId } = parse(zIdParam, req.params);
    const b = parse(zItem, req.body);
    const ja = await prisma.item.findUnique({ where: { id: b.id }, include: itemTriagemInclude });
    if (ja) {
      if (ja.loteId !== loteId) conflito('ID_EM_USO', 'Identificador já usado em outro lote');
      return reply.code(200).send(semCusto(u, itemTriagemDto(ja))); // reenvio idempotente
    }
    const lote = await prisma.loteEntrada.findUnique({ where: { id: loteId }, select: { numero: true, status: true, tipo: true } });
    if (!lote) naoEncontrado('Lote');
    if (lote!.status === 'TRIADO' && !b.descarteOrigemId) conflito('LOTE_TRIADO', 'Lote já triado não aceita registros');
    // RF-TRI-01 cenário 5: em compra, o valor atribuído é o CUSTO unitário — não pode cair no preço de venda
    if (lote!.tipo === 'COMPRA' && !(b.valorAtribuido && toCents(b.valorAtribuido) > 0)) invalido('valorAtribuido', 'obrigatório em lote de compra (custo unitário maior que zero)');
    const cat = await prisma.categoria.findFirst({ where: { id: b.categoriaId, ativa: true } });
    if (!cat) throw new AppError(400, 'Categoria inexistente ou inativa', 'VALIDACAO');

    let existente: { id: string; nome: string; categoriaId: string; pecaUnica: boolean } | null = null;
    if (b.produtoId) {
      // nova entrada de um produto que já existe: o preço do produto não muda (P-14)
      existente = await prisma.produto.findFirst({ where: { id: b.produtoId, ativo: true }, select: { id: true, nome: true, categoriaId: true, pecaUnica: true } });
      if (!existente) throw new AppError(400, 'Produto inexistente ou inativo', 'VALIDACAO');
      if (existente.categoriaId !== b.categoriaId) conflito('CATEGORIA_DO_PRODUTO', 'A entrada tem a categoria do produto');
      if (existente.pecaUnica) conflito('PECA_UNICA_ENTRADA', 'Peça única não recebe nova entrada: cadastre um produto novo');
    }
    if (b.produto?.pecaUnica && b.quantidade !== 1) throw new AppError(400, 'Peça única tem quantidade 1', 'PECA_UNICA_QTD'); // RN-08

    const item = await prisma.$transaction(async (tx) => {
      let produtoId = existente?.id ?? null;
      let nome = existente?.nome;
      if (b.produto) {
        const p = b.produto;
        const novo = await tx.produto.create({
          data: {
            codigo: await proximoCodigo(tx), tituloEtiqueta: p.tituloEtiqueta, nome: p.nome, categoriaId: b.categoriaId, precoVenda: p.preco,
            pecaUnica: p.pecaUnica, modelo: p.modelo ?? null, marca: p.marca ?? null, ano: p.ano ?? null, tipo: p.tipo ?? null,
            tamanho: p.tamanho ?? null, cor: p.cor ?? null, condicao: p.condicao ?? null, criadoPorId: u.id,
          },
        });
        produtoId = novo.id;
        nome = novo.nome;
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PRODUTO_CRIADO', 'produto', novo.id, undefined, { codigo: novo.codigo, preco: p.preco, pecaUnica: p.pecaUnica });
      }
      await tx.item.create({
        data: {
          id: b.id, loteId, categoriaId: b.categoriaId, tipoControle: b.controle, produtoId,
          descricao: b.descricao || nome || `${cat!.nome} (lote ${lote!.numero})`,
          valorAtribuido: b.valorAtribuido ?? b.preco!, // RN-33 (por categoria): sugerido pelo preço, editável
          quantidadeInicial: b.quantidade, descarteOrigemId: b.descarteOrigemId ?? null, criadoPorId: u.id,
          localDestinoId: LOCAL_ID[b.localDestino], // o estoque só recebe na aprovação
        },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'ITEM_CADASTRADO', 'item', b.id, undefined, { loteId, produtoId, quantidade: b.quantidade, local: b.localDestino });
      return tx.item.findUniqueOrThrow({ where: { id: b.id }, include: itemTriagemInclude });
    });
    return reply.code(201).send(semCusto(u, itemTriagemDto(item)));
  });

  // Correção pelo estoquista enquanto o item não foi aprovado. Item devolvido volta a CADASTRADO (reenvio, P-14).
  app.patch('/lotes/:id/itens/:itemId', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id: loteId, itemId } = parse(z.object({ id: zUuid, itemId: zUuid }), req.params);
    const b = parse(zCorrecao, req.body);
    const item = await prisma.$transaction(async (tx) => {
      await travarItens(tx, [itemId]);
      const i = await tx.item.findUnique({ where: { id: itemId }, include: { produto: true } });
      if (!i || i.loteId !== loteId) naoEncontrado('Item');
      if (i!.status === 'APROVADO') conflito('ITEM_APROVADO', 'Item já aprovado: a correção agora é pelo estoque');
      if (b.valorAtribuido !== undefined && toCents(b.valorAtribuido) <= 0 && (await tx.loteEntrada.findUnique({ where: { id: loteId }, select: { tipo: true } }))?.tipo === 'COMPRA') {
        invalido('valorAtribuido', 'em lote de compra o custo unitário é maior que zero');
      }
      if (b.categoriaId && !(await tx.categoria.findFirst({ where: { id: b.categoriaId, ativa: true } }))) throw new AppError(400, 'Categoria inexistente ou inativa', 'VALIDACAO');
      if (i!.produto && (b.produto || b.categoriaId)) {
        // os dados do produto só se corrigem aqui se ele nasceu nesta entrada e ainda não tem outra
        // (trava o produto: uma nova entrada simultânea do mesmo produto espera esta correção)
        await tx.$queryRaw`SELECT 1 AS travado FROM produto WHERE id = ${i!.produtoId!}::uuid FOR UPDATE`;
        const outras = await tx.item.count({ where: { produtoId: i!.produtoId!, id: { not: itemId } } });
        if (outras) conflito('PRODUTO_EM_USO', 'Este produto tem outras entradas: corrija o produto na tela do produto');
        const p = b.produto ?? {};
        const quantidadeFinal = b.quantidade ?? i!.quantidadeInicial;
        if ((p.pecaUnica ?? i!.produto!.pecaUnica) && quantidadeFinal !== 1) throw new AppError(400, 'Peça única tem quantidade 1', 'PECA_UNICA_QTD');
        // a categoria do produto muda antes do item (o gatilho exige a mesma categoria nos dois)
        await tx.produto.update({
          where: { id: i!.produtoId! },
          data: {
            ...(p.tituloEtiqueta !== undefined ? { tituloEtiqueta: p.tituloEtiqueta } : {}), ...(p.nome !== undefined ? { nome: p.nome } : {}),
            ...(p.modelo !== undefined ? { modelo: p.modelo ?? null } : {}), ...(p.marca !== undefined ? { marca: p.marca ?? null } : {}),
            ...(p.ano !== undefined ? { ano: p.ano } : {}), ...(p.tipo !== undefined ? { tipo: p.tipo ?? null } : {}),
            ...(p.tamanho !== undefined ? { tamanho: p.tamanho ?? null } : {}), ...(p.cor !== undefined ? { cor: p.cor ?? null } : {}),
            ...(p.condicao !== undefined ? { condicao: p.condicao ?? null } : {}), ...(b.categoriaId ? { categoriaId: b.categoriaId } : {}),
            // deixar de ser peça única vai antes do item (a quantidade nova já pode passar de 1)
            ...(p.pecaUnica === false ? { pecaUnica: false } : {}),
          },
        });
        // o preço passa pela mesma regra da tela do produto: desconto promocional que não fica abaixo do preço novo acaba junto
        if (p.preco !== undefined && toCents(p.preco) !== toCents(i!.produto!.precoVenda)) {
          await mudarPrecoProduto(tx, i!.produtoId!, p.preco, 'Correção do cadastro na triagem', { usuarioId: u.id, ip: req.ip }, itemId);
        }
      } else if (b.produto) {
        throw new AppError(400, 'Item por categoria não tem produto', 'VALIDACAO');
      }
      const reenvio = i!.status === 'DEVOLVIDO';
      await tx.item.update({
        where: { id: itemId },
        data: {
          ...(b.quantidade !== undefined ? { quantidadeInicial: b.quantidade } : {}), ...(b.valorAtribuido !== undefined ? { valorAtribuido: b.valorAtribuido } : {}),
          ...(b.descricao !== undefined ? { descricao: b.descricao || null } : {}), ...(b.localDestino ? { localDestinoId: LOCAL_ID[b.localDestino] } : {}),
          ...(b.categoriaId ? { categoriaId: b.categoriaId } : {}),
          ...(reenvio ? { status: 'CADASTRADO' as const, motivoDevolucao: null } : {}),
        },
      });
      // virar peça única vai por último: o banco confere com a quantidade já corrigida
      if (b.produto?.pecaUnica === true && i!.produto && !i!.produto.pecaUnica) {
        await tx.produto.update({ where: { id: i!.produtoId! }, data: { pecaUnica: true } });
      }
      const antes = {
        status: i!.status, quantidade: i!.quantidadeInicial, valorAtribuido: money(i!.valorAtribuido), local: LOCAL_COD[i!.localDestinoId], categoriaId: i!.categoriaId,
        ...((b.produto || b.categoriaId) && i!.produto ? { produto: produtoDto(i!.produto) } : {}),
      };
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, reenvio ? 'ITEM_REENVIADO' : 'ITEM_CORRIGIDO', 'item', itemId, antes, { ...b, status: 'CADASTRADO' });
      return tx.item.findUniqueOrThrow({ where: { id: itemId }, include: itemTriagemInclude });
    });
    return semCusto(u, itemTriagemDto(item));
  });

  // ---------------- aprovação pelo Administrador (S2-09) ----------------
  app.post('/itens/:id/aprovar', { config: { acesso: ['produtos.aprovar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const item = await prisma.$transaction(async (tx) => {
      await travarItens(tx, [id]);
      const i = await tx.item.findUnique({ where: { id }, select: { status: true, criadoPorId: true } });
      if (!i) naoEncontrado('Item');
      if (i!.status === 'DEVOLVIDO') conflito('ITEM_DEVOLVIDO', 'Item devolvido: o estoquista corrige e reenvia antes da aprovação');
      if (i!.status === 'CADASTRADO') confereOutraPessoa(u, i!.criadoPorId);
      if (i!.status === 'CADASTRADO') await aprovarItem(tx, id, u.id, req.ip); // aprovado de novo: nada a fazer (reenvio)
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemTriagemInclude });
    });
    return semCusto(u, itemTriagemDto(item));
  });

  app.post('/lotes/:id/aprovar', { config: { acesso: ['produtos.aprovar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const n = await prisma.$transaction(async (tx) => {
      if (!(await tx.loteEntrada.findUnique({ where: { id }, select: { id: true } }))) naoEncontrado('Lote');
      const pendentes = await tx.item.findMany({ where: { loteId: id, status: 'CADASTRADO' }, select: { id: true, criadoPorId: true } });
      // fora do Administrador, os itens que a própria pessoa cadastrou ficam para outra conferir (S3-22)
      const proprios = u.perfilId === PERFIL_ADMIN_ID ? 0 : pendentes.filter((i) => i.criadoPorId === u.id).length;
      const ids = pendentes.filter((i) => u.perfilId === PERFIL_ADMIN_ID || i.criadoPorId !== u.id).map((i) => i.id);
      // trava na ordem do id (a mesma da venda e do estorno) e confere de novo o estado depois da trava
      let aprovados = 0;
      for (const r of await travarItens(tx, ids)) if (r.status === 'CADASTRADO') { await aprovarItem(tx, r.id, u.id, req.ip); aprovados++; }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_APROVADO', 'lote_entrada', id, undefined, { itens: aprovados, deixadosParaOutraPessoa: proprios });
      return { aprovados, proprios };
    }, { timeout: 60_000 });
    return { ...semCusto(u, await obterLoteDto(prisma, id)), aprovadosAgora: n.aprovados, deixadosParaOutraPessoa: n.proprios };
  });

  app.post('/itens/:id/devolver', { config: { acesso: ['produtos.aprovar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    const item = await prisma.$transaction(async (tx) => {
      await travarItens(tx, [id]);
      const i = await tx.item.findUnique({ where: { id }, select: { status: true, criadoPorId: true } });
      if (!i) naoEncontrado('Item');
      if (i!.status === 'APROVADO') conflito('ITEM_APROVADO', 'Item já aprovado não é devolvido');
      if (i!.status === 'CADASTRADO') {
        confereOutraPessoa(u, i!.criadoPorId);
        await tx.item.update({ where: { id }, data: { status: 'DEVOLVIDO', motivoDevolucao: motivo, devolvidoPorId: u.id } });
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'ITEM_DEVOLVIDO', 'item', id, { status: 'CADASTRADO' }, { status: 'DEVOLVIDO', motivo });
      }
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemTriagemInclude });
    });
    return semCusto(u, itemTriagemDto(item));
  });

  // ---------------- fila de aprovação (S3-01): o que espera conferência, de todos os lotes ----------------
  app.get('/aprovacoes', { config: { acesso: ['produtos.aprovar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(z.object({ status: z.enum(['CADASTRADO', 'DEVOLVIDO']).default('CADASTRADO') }), req.query);
    const itens = await prisma.item.findMany({
      where: { status: q.status }, take: 500,
      include: { ...itemTriagemInclude, lote: { select: { id: true, numero: true, tipo: true, parceiro: { select: { nome: true } }, campanha: { select: { nome: true } } } }, criadoPor: { select: { nome: true } } },
      orderBy: [{ lote: { numero: 'asc' } }, { criadoEm: 'asc' }],
    });
    return itens.map((i) => ({
      ...semCusto(u, itemTriagemDto(i)), criadoPorNome: i.criadoPor.nome, criadoEm: i.criadoEm.toISOString(),
      loteId: i.lote.id, loteNumero: i.lote.numero, loteTipo: i.lote.tipo, parceiroNome: i.lote.parceiro?.nome, campanhaNome: i.lote.campanha?.nome,
      // o próprio cadastro só o Administrador aprova (S3-22): a tela mostra quem precisa conferir
      podeConferir: u.perfilId === PERFIL_ADMIN_ID || i.criadoPorId !== u.id,
    }));
  });

  // ---------------- produtos: busca para a nova entrada ----------------
  app.get('/produtos', { config: { acesso: ['entrada.registrar', 'estoque.consultar', 'produtos.aprovar'] } }, async (req) => {
    const q = parse(zPage.extend({ busca: z.string().trim().max(100).optional(), categoriaId: zUuid.optional() }), req.query);
    const where: Prisma.ProdutoWhereInput = {
      ativo: true,
      ...(q.categoriaId ? { categoriaId: q.categoriaId } : {}),
      ...(q.busca ? { OR: [{ codigo: { equals: q.busca!.toUpperCase() } }, { nome: { contains: q.busca!, mode: 'insensitive' } }, { tituloEtiqueta: { contains: q.busca!, mode: 'insensitive' } }, { marca: { contains: q.busca!, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.produto.findMany({ where, orderBy: [{ nome: 'asc' }, { codigo: 'asc' }], include: { categoria: { select: { nome: true } } }, ...skipTake(q) }),
      prisma.produto.count({ where }),
    ]);
    const saldos = rows.length ? await prisma.$queryRaw<{ produto_id: string; b: number; d: number }[]>`
      SELECT i.produto_id::text, coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 1), 0)::int AS b, coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 2), 0)::int AS d
      FROM item i JOIN vw_saldo_estoque s ON s.item_id = i.id WHERE i.produto_id = ANY(${rows.map((p) => p.id)}::uuid[]) GROUP BY 1` : [];
    const porProduto = new Map(saldos.map((s) => [s.produto_id, s]));
    return page(rows.map((p) => ({ ...produtoDto(p), categoriaNome: p.categoria.nome, saldoBazar: porProduto.get(p.id)?.b ?? 0, saldoDoacoes: porProduto.get(p.id)?.d ?? 0 })), q, total);
  });

  app.post('/lotes/:id/descartes', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id: loteId } = parse(zIdParam, req.params);
    const b = parse(zDescarte, req.body);
    const ja = await prisma.descarte.findUnique({ where: { id: b.id }, include: descInclude });
    if (ja) return reply.code(200).send(descarteDto(ja));
    const lote = await prisma.loteEntrada.findUnique({ where: { id: loteId }, select: { status: true } });
    if (!lote) naoEncontrado('Lote');
    if (lote!.status === 'TRIADO') conflito('LOTE_TRIADO', 'Lote já triado não aceita registros');
    if (!(await prisma.categoria.findUnique({ where: { id: b.categoriaId } }))) throw new AppError(400, 'Categoria inexistente', 'VALIDACAO');
    if (!(await prisma.motivoDescarte.findFirst({ where: { id: b.motivoId, ativo: true } }))) throw new AppError(400, 'Motivo inexistente ou inativo', 'VALIDACAO');
    // RN-01: descarte NUNCA gera movimentação de estoque
    const d = await prisma.descarte.create({
      data: { id: b.id, loteId, categoriaId: b.categoriaId, motivoId: b.motivoId, observacao: b.observacao ?? null, descricao: b.descricao ?? null, registradoPorId: u.id },
      include: descInclude,
    });
    return reply.code(201).send(descarteDto(d));
  });

  app.post('/lotes/:id/encerrar', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    await prisma.$transaction(async (tx) => {
      const l = await tx.loteEntrada.findUnique({ where: { id }, select: { status: true } });
      if (!l) naoEncontrado('Lote');
      if (l!.status === 'TRIADO') conflito('LOTE_TRIADO', 'Lote já está triado');
      await tx.loteEntrada.update({ where: { id }, data: { status: 'TRIADO' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_ENCERRADO', 'lote_entrada', id, { status: l!.status }, { status: 'TRIADO' });
    });
    return semCusto(u, await obterLoteDto(prisma, id));
  });

  app.post('/lotes/:id/reabrir', { config: { acesso: ['triagem.reabrir'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const l = await tx.loteEntrada.findUnique({ where: { id }, select: { status: true } });
      if (!l) naoEncontrado('Lote');
      if (l!.status !== 'TRIADO') conflito('LOTE_ABERTO', 'Lote não está triado');
      await tx.loteEntrada.update({ where: { id }, data: { status: 'EM_TRIAGEM' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_REABERTO', 'lote_entrada', id, { status: 'TRIADO' }, { status: 'EM_TRIAGEM', motivo });
    });
    return semCusto(u, await obterLoteDto(prisma, id));
  });

  app.post('/descartes/:id/reverter', { config: { acesso: ['triagem.reabrir'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const d = await tx.descarte.findUnique({ where: { id } });
      if (!d) naoEncontrado('Descarte');
      if (d!.revertidoEm) conflito('DESCARTE_REVERTIDO', 'Descarte já revertido');
      await tx.descarte.update({ where: { id }, data: { revertidoEm: new Date(), revertidoPorId: u.id } });
      // RN-20: o item só volta por nova triagem — o lote fica aberto para registrá-la
      await tx.loteEntrada.updateMany({ where: { id: d!.loteId, status: 'TRIADO' }, data: { status: 'EM_TRIAGEM' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'DESCARTE_REVERTIDO', 'descarte', id, undefined, { loteId: d!.loteId, motivo });
    });
    return reply.code(204).send();
  });

  app.get('/etiquetas', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const q = parse(z.object({ itens: z.string().max(200 * 37) }), req.query);
    const ids = q.itens.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 200 || !ids.every((x) => zUuid.safeParse(x).success)) throw new AppError(400, 'Lista de itens inválida (até 200 ids)', 'VALIDACAO');
    // a etiqueta é do produto: título curto, preço atual e código (P-06)
    const itens = await prisma.item.findMany({ where: { id: { in: ids }, tipoControle: 'ETIQUETADO' }, include: { produto: true } });
    return itens.map((i) => ({ itemId: i.id, codigo: i.produto!.codigo, descricao: i.produto!.tituloEtiqueta, preco: money(i.produto!.precoVenda) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  });
}

