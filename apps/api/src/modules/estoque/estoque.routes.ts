/**
 * EST — consulta de estoque (saldo só por vw_saldo_estoque), histórico do item, transferência
 * bazar ⇄ doações, baixa, ajuste, preço e carga inicial (RF-EST-01..08).
 * O banco recusa saldo negativo, peça única com mais de 1 unidade e movimento de item não aprovado (tg_valida_movimentacao).
 * Cada linha é uma entrada (item) de um lote; código e preço da peça vêm do produto (0009).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../../shared/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../shared/errors.js';
import { page, parse, zIdParam, zMoney, zMotivo, zPage, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { money, toCents } from '../../shared/money.js';
import { reservarChave } from '../../shared/idempotencia.js';
import { codigoErro, lerPlanilha } from '../../shared/planilha.js';
import { exigirUsuario, tem } from '../../plugins/auth.js';
import { mudarPrecoProduto } from './produtos.routes.js';
import { LOCAL_COD, LOCAL_ID, proximoCodigo } from '../entradas/lotes.routes.js';

/** Sem acento, sem espaços nas pontas, maiúsculas — para comparar valores digitados em planilha. */
const normalizar = (t?: string) => (t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

const zLocal = z.enum(['BAZAR', 'DOACOES']);

interface ItemSql {
  id: string; codigo_barras: string | null; descricao: string | null; categoria_id: string; categoria_nome: string;
  tipo_controle: 'ETIQUETADO' | 'CATEGORIA'; preco: string | null; preco_tabela: string | null; produto_id: string | null; peca_unica: boolean | null;
  valor_atribuido: string; lote_id: string; lote_numero: number;
  parceiro_nome: string | null; campanha_nome: string | null; saldo_bazar: number; saldo_doacoes: number; total?: bigint;
}
const dec = (v: string | null) => (v === null ? '0.00' : Number(v).toFixed(2));
/** O custo (valor atribuído) só sai para quem tem a permissão de vê-lo (S3-05): o PDV e perfis sem ela não recebem. */
const itemDto = (r: ItemSql, verCusto: boolean) => ({
  id: r.id, codigo: r.codigo_barras ?? undefined, descricao: r.descricao ?? r.categoria_nome,
  categoriaId: r.categoria_id, categoriaNome: r.categoria_nome, controle: r.tipo_controle,
  produtoId: r.produto_id ?? undefined, pecaUnica: r.peca_unica ?? undefined,
  // preço efetivo (com o desconto vigente do produto) e, se houver desconto, o preço sem ele (S3-10)
  preco: dec(r.preco), precoSemDesconto: r.preco_tabela !== null && dec(r.preco_tabela) !== dec(r.preco) ? dec(r.preco_tabela) : undefined,
  ...(verCusto ? { valorAtribuido: dec(r.valor_atribuido) } : {}),
  loteId: r.lote_id, loteNumero: r.lote_numero,
  parceiroNome: r.parceiro_nome ?? undefined, campanhaNome: r.campanha_nome ?? undefined,
  saldoBazar: Number(r.saldo_bazar), saldoDoacoes: Number(r.saldo_doacoes),
});

/** Preço vigente: produto = preço ATUAL do produto com o desconto vigente (fn_preco_efetivo); por categoria = preço padrão ATUAL da categoria (RN-08). */
export const SELECT_ITEM = Prisma.sql`
  SELECT i.id::text, coalesce(pr.codigo, i.codigo_barras) AS codigo_barras, coalesce(i.descricao, pr.nome) AS descricao,
         i.categoria_id::text, c.nome AS categoria_nome, i.tipo_controle::text AS tipo_controle,
         (CASE WHEN i.tipo_controle = 'ETIQUETADO' THEN fn_preco_efetivo(pr.preco_venda, pr.desconto_tipo, pr.desconto_valor, pr.desconto_ate)
               ELSE c.preco_padrao END)::text AS preco,
         pr.preco_venda::text AS preco_tabela, i.produto_id::text, pr.peca_unica, i.valor_atribuido::text,
         l.id::text AS lote_id, l.numero AS lote_numero, p.nome AS parceiro_nome, cp.nome AS campanha_nome,
         coalesce(s.b, 0)::int AS saldo_bazar, coalesce(s.d, 0)::int AS saldo_doacoes
  FROM item i
  JOIN categoria c ON c.id = i.categoria_id
  LEFT JOIN produto pr ON pr.id = i.produto_id
  JOIN lote_entrada l ON l.id = i.lote_id
  LEFT JOIN parceiro p ON p.id = l.parceiro_id
  LEFT JOIN campanha cp ON cp.id = l.campanha_id
  LEFT JOIN (SELECT item_id, sum(saldo) FILTER (WHERE local_id = 1) AS b, sum(saldo) FILTER (WHERE local_id = 2) AS d
             FROM vw_saldo_estoque GROUP BY item_id) s ON s.item_id = i.id`;

export async function itemPorId(db: Db, id: string, verCusto = false) {
  const [r] = await db.$queryRaw<ItemSql[]>`${SELECT_ITEM} WHERE i.id = ${id}::uuid`;
  return r ? itemDto(r, verCusto) : null;
}
/** Pelo código do produto: a entrada aprovada mais antiga que ainda tem saldo no Bazar (a próxima a ser vendida, PEPS). */
async function itemPorCodigo(db: Db, codigo: string, verCusto: boolean) {
  const [r] = await db.$queryRaw<ItemSql[]>`
    ${SELECT_ITEM} WHERE pr.codigo = ${codigo} AND i.status = 'APROVADO'
    ORDER BY (coalesce(s.b, 0) > 0) DESC, l.recebido_em, l.numero, i.criado_em, i.id LIMIT 1`;
  return r ? itemDto(r, verCusto) : null;
}

/**
 * Resolve o item por id ou código (RF-EST-02: transferência por código da peça ou por item).
 * Produto com várias entradas é ambíguo pelo código: escolha a entrada (lote) na lista do estoque.
 */
async function acharItemId(db: Db, b: { itemId?: string | undefined; codigo?: string | undefined }): Promise<string> {
  if (b.itemId) {
    const i = await db.item.findUnique({ where: { id: b.itemId }, select: { id: true } });
    if (!i) throw new AppError(404, 'Item não encontrado', 'ITEM_INEXISTENTE');
    return i.id;
  }
  const itens = b.codigo ? await db.item.findMany({ where: { produto: { codigo: b.codigo.toUpperCase() }, status: 'APROVADO' }, select: { id: true }, take: 2 }) : [];
  if (!itens.length) throw new AppError(404, 'Item não encontrado', 'ITEM_INEXISTENTE');
  if (itens.length > 1) conflito('CODIGO_COM_VARIAS_ENTRADAS', 'Este produto tem várias entradas: escolha a entrada (lote) na lista do estoque');
  return itens[0]!.id;
}

const zTransf = z.object({
  id: zUuid, itemId: zUuid.optional(), codigo: z.string().trim().max(40).optional(), quantidade: z.number().int().min(1).max(100_000),
  origem: zLocal, destino: zLocal, motivo: z.string().trim().max(300).optional(),
}).refine((b) => b.itemId || b.codigo, 'informe itemId ou codigo').refine((b) => b.origem !== b.destino, 'origem e destino devem ser diferentes');
const zBaixa = z.object({ id: zUuid, itemId: zUuid, quantidade: z.number().int().min(1).max(100_000), local: zLocal, motivoId: zUuid, observacao: z.string().trim().max(300).optional() });
// S3-03: o ajuste de inventário é só de saída (estoque só sobe por entrada aprovada; o banco também recusa, 0010)
const zAjuste = z.object({ id: zUuid, itemId: zUuid, local: zLocal, tipo: z.literal('AJUSTE_SAIDA').default('AJUSTE_SAIDA'), quantidade: z.number().int().min(1).max(100_000), motivo: zMotivo });
const zPreco = z.object({ preco: zMoney.refine((v) => toCents(v) > 0, 'preço deve ser maior que zero'), motivo: zMotivo });

export async function rotasEstoque(app: FastifyInstance) {
  app.get('/estoque', { config: { acesso: ['estoque.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(zPage.extend({
      local: zLocal.optional(), categoriaId: zUuid.optional(), parceiroId: zUuid.optional(), campanhaId: zUuid.optional(),
      loteId: zUuid.optional(), busca: z.string().trim().max(100).optional(),
    }), req.query);
    const conds: Prisma.Sql[] = [Prisma.sql`coalesce(s.b, 0) + coalesce(s.d, 0) > 0`];
    if (q.local === 'BAZAR') conds.push(Prisma.sql`coalesce(s.b, 0) > 0`);
    if (q.local === 'DOACOES') conds.push(Prisma.sql`coalesce(s.d, 0) > 0`);
    if (q.categoriaId) conds.push(Prisma.sql`i.categoria_id = ${q.categoriaId}::uuid`);
    if (q.parceiroId) conds.push(Prisma.sql`l.parceiro_id = ${q.parceiroId}::uuid`);
    if (q.campanhaId) conds.push(Prisma.sql`l.campanha_id = ${q.campanhaId}::uuid`);
    if (q.loteId) conds.push(Prisma.sql`l.id = ${q.loteId}::uuid`);
    if (q.busca) {
      const like = `%${q.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(Prisma.sql`(i.descricao ILIKE ${like} OR pr.nome ILIKE ${like} OR pr.codigo ILIKE ${like} OR c.nome ILIKE ${like})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const rows = await prisma.$queryRaw<ItemSql[]>`
      SELECT x.*, count(*) OVER () AS total FROM (${SELECT_ITEM} WHERE ${where}) x
      ORDER BY x.categoria_nome, x.descricao, x.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
    return page(rows.map((r) => itemDto(r, tem(u, 'custo.consultar'))), q, rows.length ? Number(rows[0]!.total) : 0);
  });

  app.get('/itens/codigo/:codigo', { config: { acesso: ['estoque.consultar', 'caixa.operar'] } }, async (req) => {
    const { codigo } = parse(z.object({ codigo: z.string().trim().min(1).max(40) }), req.params);
    const i = await itemPorCodigo(prisma, codigo.toUpperCase(), tem(exigirUsuario(req), 'custo.consultar'));
    if (!i) throw new AppError(404, 'Código não encontrado', 'CODIGO_INEXISTENTE');
    return i;
  });

  app.get('/itens/:id/historico', { config: { acesso: ['estoque.consultar'] } }, async (req) => {
    const { id } = parse(zIdParam, req.params);
    const item = await itemPorId(prisma, id, tem(exigirUsuario(req), 'custo.consultar'));
    if (!item) naoEncontrado('Item');
    const lote = await prisma.loteEntrada.findUniqueOrThrow({ where: { id: item!.loteId }, include: { parceiro: { select: { nome: true } }, campanha: { select: { nome: true } } } });
    const movs = await prisma.movimentacao.findMany({ where: { itemId: id }, orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }], include: { motivoBaixa: { select: { nome: true } } } });
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.usuarioId))] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    const origem = [lote.parceiro?.nome, lote.campanha?.nome].filter(Boolean).join(' / ') || (lote.tipo === 'SALDO_INICIAL' ? 'Saldo inicial' : '—');
    const eventos: Record<string, unknown>[] = [
      { ocorridoEm: lote.recebidoEm.toISOString(), tipo: 'TRIAGEM', descricao: `Lote ${lote.numero} recebido — ${origem}`, quantidade: 0 },
    ];
    for (const m of movs) {
      const base = { ocorridoEm: m.ocorridoEm.toISOString(), tipo: m.tipo, usuarioNome: nomes.get(m.usuarioId) };
      const o = m.localOrigemId ? LOCAL_COD[m.localOrigemId] : undefined;
      const d = m.localDestinoId ? LOCAL_COD[m.localDestinoId] : undefined;
      const extra = m.motivoBaixa ? `: ${m.motivoBaixa.nome}` : m.motivo ? ` (${m.motivo})` : '';
      if (m.tipo === 'TRANSFERENCIA') {
        eventos.push({ ...base, descricao: `Transferência ${o} → ${d}${extra}`, quantidade: -m.quantidade, local: o });
        eventos.push({ ...base, descricao: `Transferência ${o} → ${d}`, quantidade: m.quantidade, local: d });
      } else {
        const rotulo: Record<string, string> = { ENTRADA: 'Entrada (aprovação do lote)', VENDA: 'Venda', ESTORNO_VENDA: 'Estorno de venda', BAIXA: 'Baixa', AJUSTE_ENTRADA: 'Ajuste de inventário (+)', AJUSTE_SAIDA: 'Ajuste de inventário (−)' };
        eventos.push({ ...base, descricao: `${rotulo[m.tipo]}${extra}`, quantidade: o ? -m.quantidade : m.quantidade, local: o ?? d });
      }
    }
    return { item, eventos };
  });

  app.post('/transferencias', { config: { acesso: ['estoque.transferir'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zTransf, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'transferencia', u.id))) return; // reenvio: já feito
      const itemId = await acharItemId(tx, b);
      // RN-23: origem, destino, quantidade, usuário, data/hora e motivo opcional — numa única linha
      await tx.movimentacao.create({
        data: { itemId, tipo: 'TRANSFERENCIA', localOrigemId: LOCAL_ID[b.origem], localDestinoId: LOCAL_ID[b.destino], quantidade: b.quantidade, motivo: b.motivo || null, usuarioId: u.id },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TRANSFERENCIA', 'item', itemId, undefined, { origem: b.origem, destino: b.destino, quantidade: b.quantidade });
    });
    return reply.code(204).send();
  });

  app.post('/baixas', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zBaixa, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'baixa', u.id))) return;
      if (!(await tx.motivoBaixa.findFirst({ where: { id: b.motivoId, ativo: true } }))) throw new AppError(400, 'Motivo de baixa inexistente ou inativo', 'VALIDACAO');
      await tx.movimentacao.create({
        data: { itemId: await acharItemId(tx, b), tipo: 'BAIXA', localOrigemId: LOCAL_ID[b.local], quantidade: b.quantidade, motivoBaixaId: b.motivoId, motivo: b.observacao || null, usuarioId: u.id },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'BAIXA', 'item', b.itemId, undefined, { local: b.local, quantidade: b.quantidade, motivoId: b.motivoId });
    });
    return reply.code(204).send();
  });

  app.post('/ajustes', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zAjuste, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'ajuste', u.id))) return;
      const loc = LOCAL_ID[b.local];
      await tx.movimentacao.create({
        data: {
          itemId: await acharItemId(tx, b), tipo: b.tipo, quantidade: b.quantidade, motivo: b.motivo, usuarioId: u.id, localOrigemId: loc,
        },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, b.tipo, 'item', b.itemId, undefined, { local: b.local, quantidade: b.quantidade, motivo: b.motivo });
    });
    return reply.code(204).send();
  });

  // preço do produto pela linha do estoque: Admin e Estoquista (S3-08); a mesma regra de PATCH /produtos/:id/preco
  app.patch('/itens/:id/preco', { config: { acesso: ['produtos.preco'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zPreco, req.body);
    await prisma.$transaction(async (tx) => {
      const i = await tx.item.findUnique({ where: { id }, select: { tipoControle: true, produtoId: true } });
      if (!i) naoEncontrado('Item');
      if (i!.tipoControle !== 'ETIQUETADO') conflito('PRECO_DA_CATEGORIA', 'Item por categoria usa o preço padrão da categoria');
      await mudarPrecoProduto(tx, i!.produtoId!, b.preco, b.motivo, { usuarioId: u.id, ip: req.ip }, id);
    });
    return reply.code(204).send();
  });

  app.patch('/categorias/:id/preco', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zPreco, req.body);
    await prisma.$transaction(async (tx) => {
      const c = await tx.categoria.findUnique({ where: { id }, select: { precoPadrao: true } });
      if (!c) naoEncontrado('Categoria');
      await tx.categoria.update({ where: { id }, data: { precoPadrao: b.preco } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PRECO_CATEGORIA', 'categoria', id, { preco: money(c!.precoPadrao) }, { preco: b.preco, motivo: b.motivo });
    });
    return reply.code(204).send();
  });

  // ---------------- carga inicial (RF-EST-08): tudo ou nada ----------------
  app.post('/carga-inicial', { config: { acesso: ['estoque.ajustar'], rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const u = exigirUsuario(req);
    const arq = await req.file();
    if (!arq || arq.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const pl = await lerPlanilha(await arq.toBuffer());
    const faltando = ['categoria', 'quantidade', 'preco', 'estoque'].filter((c) => !pl.cabecalho.includes(c));
    if (faltando.length) throw new AppError(400, 'Planilha fora do modelo', 'PLANILHA_INVALIDA', `Colunas obrigatórias ausentes: ${faltando.join(', ')}`);

    const cats = await prisma.categoria.findMany({ where: { ativa: true } }); // categoria desativada não recebe saldo
    const porNome = new Map(cats.map((c) => [c.nome.trim().toLowerCase(), c]));
    // S5-05 (P-19): grava as linhas válidas e devolve as aceitas e as recusadas, como as outras importações
    const recusadas: { linha: number; nome: string; motivo: string }[] = [];
    const validas: { linha: number; cat: (typeof cats)[number]; descricao: string; quantidade: number; preco: string; valor: string; local: 'BAZAR' | 'DOACOES'; controle: 'ETIQUETADO' | 'CATEGORIA' }[] = [];
    for (const { numero, valores: v } of pl.linhas) {
      const cat = porNome.get((v.categoria ?? '').trim().toLowerCase());
      const qtd = Number(v.quantidade);
      const precoTxt = (v.preco ?? '').replace(',', '.');
      const valorTxt = (v.valor_atribuido || v.preco || '').replace(',', '.');
      // "Doações", "doacoes", " DOAÇÕES " → DOACOES (ticket 11: antes sobrava "DOAÇOES" e a linha era recusada)
      const local = normalizar(v.estoque);
      const controle = normalizar(v.controle) || (cat?.vendaPorCategoria ? 'CATEGORIA' : 'ETIQUETADO');
      const e: string[] = [];
      if (!cat) e.push(`Categoria "${(v.categoria ?? '').slice(0, 60)}" não cadastrada`);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 100_000) e.push('Quantidade inválida');
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(precoTxt) || Number(precoTxt) <= 0) e.push(`Preço inválido: "${(v.preco ?? '').slice(0, 20)}"`);
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(valorTxt)) e.push('Valor atribuído inválido');
      if (local !== 'BAZAR' && local !== 'DOACOES') e.push('Estoque deve ser BAZAR ou DOACOES');
      if (controle !== 'ETIQUETADO' && controle !== 'CATEGORIA') e.push('Controle deve ser ETIQUETADO ou CATEGORIA');
      if (controle === 'ETIQUETADO' && qtd !== 1) e.push('Peça etiquetada tem quantidade 1 (uma linha por peça)');
      if (e.length) recusadas.push({ linha: numero, nome: (v.descricao || v.categoria || '').slice(0, 120), motivo: e.join('; ') });
      else validas.push({ linha: numero, cat: cat!, descricao: (v.descricao ?? '').slice(0, 120), quantidade: qtd, preco: precoTxt, valor: valorTxt, local: local as 'BAZAR' | 'DOACOES', controle: controle as 'ETIQUETADO' | 'CATEGORIA' });
    }
    const aceitas: { linha: number; nome: string; quantidade: number }[] = [];
    if (validas.length) {
      // o lote de saldo inicial nasce uma vez; cada linha na sua transação (a falha de uma não desfaz as outras)
      const lote = await prisma.loteEntrada.create({ data: { tipo: 'SALDO_INICIAL', recebidoEm: new Date(), recebidoPorId: u.id, observacao: 'Carga inicial da implantação' } });
      const agora = new Date();
      for (const l of validas) {
        const descricao = l.descricao || `${l.cat.nome} (saldo inicial)`;
        try {
          await prisma.$transaction(async (tx) => {
            // cada linha etiquetada vira um produto de peça única (como antes: quantidade 1)
            const produto = l.controle === 'ETIQUETADO' ? await tx.produto.create({
              data: { codigo: await proximoCodigo(tx), tituloEtiqueta: descricao.slice(0, 40), nome: descricao, categoriaId: l.cat.id, precoVenda: l.preco, pecaUnica: true, criadoPorId: u.id },
            }) : null;
            // quem carrega é o Administrador (estoque.ajustar): os itens já entram aprovados
            const it = await tx.item.create({
              data: {
                loteId: lote.id, categoriaId: l.cat.id, tipoControle: l.controle, produtoId: produto?.id ?? null, descricao,
                valorAtribuido: l.valor, quantidadeInicial: l.quantidade, criadoPorId: u.id,
                localDestinoId: LOCAL_ID[l.local], status: 'APROVADO', aprovadoPorId: u.id, aprovadoEm: agora,
              },
            });
            await tx.movimentacao.create({ data: { itemId: it.id, tipo: 'ENTRADA', localDestinoId: LOCAL_ID[l.local], quantidade: l.quantidade, usuarioId: u.id, motivo: 'Saldo inicial' } });
          });
          aceitas.push({ linha: l.linha, nome: descricao, quantidade: l.quantidade });
        } catch (er) {
          req.log.error({ erro: codigoErro(er), linha: l.linha }, 'carga inicial'); // sem a mensagem: o Prisma repete os valores da linha
          recusadas.push({ linha: l.linha, nome: descricao, motivo: 'Erro ao gravar a linha' });
        }
      }
      await prisma.loteEntrada.update({ where: { id: lote.id }, data: { status: 'TRIADO' } }); // encerrado depois dos itens, como antes
      await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'CARGA_INICIAL', 'lote_entrada', lote.id, undefined, { linhas: pl.linhas.length, aceitas: aceitas.length, recusadas: recusadas.length });
    }
    return { total: pl.linhas.length, aceitas, recusadas: recusadas.sort((a, b) => a.linha - b.linha) };
  });
}
