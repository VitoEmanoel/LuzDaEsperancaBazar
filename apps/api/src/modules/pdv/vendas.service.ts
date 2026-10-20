/**
 * PDV — registro da venda (fluxos 8.2 e 8.3 do doc 04) numa ÚNICA transação (RNF-06):
 *  - o servidor recalcula preços, subtotal, desconto, total e troco (o front só exibe);
 *  - caixaId/terminalId conferidos contra a sessão de caixa do operador (anti-IDOR);
 *  - peça etiquetada só pelo código (RN-30); por categoria, PEPS com desempate fixo (RN-09);
 *  - travas em ordem fixa (etiquetadas por item_id, depois categorias por PEPS) — sem deadlock;
 *  - regra fiscal vigente copiada em cada item (RN-17); fiado gera conta a receber (RN-03);
 *  - no COMMIT o banco confere a venda inteira (tg_valida_venda_completa).
 */
import { configCpf, compradoNoMes, limparCpfsVencidos, normalizarCpf } from './cpf.service.js';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db, type Tx } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { zData, zMoney, zUuid } from '../../shared/http.js';
import { fromCents, money, toCents } from '../../shared/money.js';
import { addDias, fromDbDate, localDate, toDbDate } from '../../shared/dates.js';
import { paramNum } from '../../shared/parametros.js';
import { obterClienteAtivo } from '../cadastros/clientes.routes.js';
import { regrasVigentes, resolverRegra } from '../fiscal/fiscal.service.js';
import type { Permissao } from '../../shared/permissoes.js';

// ---------------- contrato ----------------
const zItemVenda = z.union([
  z.object({ codigo: z.string().trim().min(1).max(40), quantidade: z.literal(1), desconto: zMoney.optional() }).strict(),
  z.object({ categoriaId: zUuid, quantidade: z.number().int().min(1).max(10_000), desconto: zMoney.optional() }).strict(),
]);
export const zVendaRequest = z.object({
  terminalId: zUuid,
  caixaId: zUuid,
  clienteId: zUuid.optional(),
  /** CPF da compra (opcional, salvo se o Administrador marcar como obrigatório); validado pelos dígitos no servidor */
  cpf: z.string().trim().max(20).nullish(),
  itens: z.array(zItemVenda).min(1, 'venda sem itens').max(200),
  desconto: zMoney.optional(),
  pagamentos: z.array(z.object({
    forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO']),
    valor: zMoney, valorRecebido: zMoney.optional(),
  })).max(5),
  vencimentoFiado: zData.optional(),
});
export type VendaRequest = z.infer<typeof zVendaRequest>;

export interface Operador { id: string; nome: string; permissoes: Set<Permissao>; limiteDescontoPct: number }

// ---------------- DTO ----------------
const vendaInclude = {
  itens: { include: { item: { select: { descricao: true, tipoControle: true, categoria: { select: { nome: true } }, lote: { select: { numero: true } } } } }, orderBy: { id: 'asc' as const } },
  pagamentos: true,
  cliente: { select: { nome: true } },
  cpf: true,
  contaReceber: { select: { vencimento: true } },
} satisfies Prisma.VendaInclude;
type VendaFull = Prisma.VendaGetPayload<{ include: typeof vendaInclude }>;

/** `comCpf`: o CPF só sai no comprovante e na resposta da venda — nunca nas listas. */
export function vendaDto(v: VendaFull, operadorNome: string, comCpf = false) {
  return {
    id: v.id, numero: v.numero,
    ...(comCpf && v.cpf ? { cpf: v.cpf.cpf } : {}),
    ocorridaEm: v.ocorridaEm.toISOString(),
    status: v.status === 'FINALIZADA' ? 'CONCLUIDA' : 'CANCELADA',
    subtotal: money(v.subtotal), desconto: money(v.desconto), total: money(v.total),
    troco: fromCents(v.pagamentos.reduce((s, p) => s + toCents(p.troco), 0)),
    itens: v.itens.map((i) => ({
      descricao: i.item.tipoControle === 'ETIQUETADO' ? (i.item.descricao ?? i.item.categoria.nome) : i.item.categoria.nome,
      quantidade: i.quantidade, precoUnitario: money(i.precoUnitario), total: money(i.valorTotal), loteNumero: i.item.lote.numero,
    })),
    pagamentos: v.pagamentos.map((p) => ({ forma: p.forma, valor: money(p.valor), ...(p.valorRecebido ? { valorRecebido: money(p.valorRecebido) } : {}) })),
    operadorNome,
    clienteNome: v.cliente?.nome,
    vencimentoFiado: v.contaReceber ? fromDbDate(v.contaReceber.vencimento) : undefined,
  };
}

export async function carregarVenda(db: Db, id: string, comCpf = false) {
  const v = await db.venda.findUnique({ where: { id }, include: vendaInclude });
  if (!v) return null;
  const op = await db.usuario.findUnique({ where: { id: v.registradaPorId }, select: { nome: true } });
  return { venda: v, dto: vendaDto(v, op?.nome ?? '—', comCpf) };
}

// ---------------- alocação ----------------
interface Linha { itemId: string; forma: 'CODIGO' | 'CATEGORIA'; categoriaId: string; quantidade: number; precoCents: number; descontoCents: number }

/** Distribui um desconto em centavos proporcionalmente aos valores (sobra no último). */
function ratear(totalCents: number, bases: number[]): number[] {
  const soma = bases.reduce((a, b) => a + b, 0);
  if (!totalCents || !soma) return bases.map(() => 0);
  const r = bases.map((b) => Math.floor((totalCents * b) / soma));
  r[r.length - 1]! += totalCents - r.reduce((a, b) => a + b, 0);
  return r;
}

async function alocarEtiquetadas(tx: Tx, itens: { codigo: string; descontoCents: number }[]): Promise<Linha[]> {
  if (!itens.length) return [];
  const codigos = itens.map((i) => i.codigo);
  if (new Set(codigos).size !== codigos.length) throw new AppError(409, 'A mesma peça aparece duas vezes na venda', 'CODIGO_DUPLICADO');
  const rows = await tx.$queryRaw<{ id: string; codigo_barras: string; categoria_id: string; preco_venda: string }[]>`
    SELECT i.id::text, i.codigo_barras, i.categoria_id::text, i.preco_venda::text
    FROM item i WHERE i.codigo_barras = ANY(${codigos}::text[]) AND i.tipo_controle = 'ETIQUETADO'
    ORDER BY i.id FOR UPDATE OF i`;
  const porCodigo = new Map(rows.map((r) => [r.codigo_barras, r]));
  const linhas: Linha[] = [];
  for (const it of itens) {
    const r = porCodigo.get(it.codigo);
    if (!r) throw new AppError(409, 'Código não encontrado', 'CODIGO_INEXISTENTE', it.codigo);
    const saldos = await tx.$queryRaw<{ local_id: number; saldo: number }[]>`SELECT local_id, saldo FROM vw_saldo_estoque WHERE item_id = ${r.id}::uuid`;
    const bazar = saldos.find((s) => s.local_id === 1)?.saldo ?? 0;
    if (bazar < 1) {
      const doacoes = saldos.find((s) => s.local_id === 2)?.saldo ?? 0;
      if (doacoes > 0) throw new AppError(409, 'Peça está no estoque de doações — transfira antes de vender', 'ITEM_EM_DOACOES', it.codigo); // RN-07
      throw new AppError(409, 'Peça indisponível (já vendida ou baixada)', 'ITEM_INDISPONIVEL', it.codigo);
    }
    linhas.push({ itemId: r.id, forma: 'CODIGO', categoriaId: r.categoria_id, quantidade: 1, precoCents: toCents(Number(r.preco_venda).toFixed(2)), descontoCents: it.descontoCents });
  }
  return linhas;
}

async function alocarCategoria(tx: Tx, categoriaId: string, quantidade: number, descontoCents: number): Promise<Linha[]> {
  const cat = await tx.categoria.findUnique({ where: { id: categoriaId }, select: { nome: true, precoPadrao: true } });
  if (!cat) throw new AppError(409, 'Categoria não encontrada', 'CATEGORIA_INEXISTENTE');
  const preco = toCents(cat.precoPadrao);
  if (preco <= 0) throw new AppError(409, `Categoria "${cat.nome}" sem preço padrão`, 'CATEGORIA_SEM_PRECO');

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    // PEPS (RN-09): lote mais antigo; desempate por número do lote, criação do item e id. Trava antes de ler o saldo.
    const cand = await tx.$queryRaw<{ id: string }[]>`
      SELECT i.id::text FROM item i JOIN lote_entrada l ON l.id = i.lote_id
      WHERE i.categoria_id = ${categoriaId}::uuid AND i.tipo_controle = 'CATEGORIA'
        AND EXISTS (SELECT 1 FROM vw_saldo_estoque s WHERE s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0)
      ORDER BY l.recebido_em, l.numero, i.criado_em, i.id
      FOR UPDATE OF i`;
    if (cand.length) {
      const ids = cand.map((c) => c.id);
      const saldos = await tx.$queryRaw<{ item_id: string; saldo: number }[]>`
        SELECT item_id::text, saldo FROM vw_saldo_estoque WHERE local_id = 1 AND item_id = ANY(${ids}::uuid[])`;
      const saldo = new Map(saldos.map((s) => [s.item_id, s.saldo]));
      const linhas: Linha[] = [];
      let resta = quantidade;
      for (const id of ids) {
        if (!resta) break;
        const q = Math.min(resta, saldo.get(id) ?? 0);
        if (q > 0) { linhas.push({ itemId: id, forma: 'CATEGORIA', categoriaId, quantidade: q, precoCents: preco, descontoCents: 0 }); resta -= q; }
      }
      if (resta === 0) {
        const d = ratear(descontoCents, linhas.map((l) => l.quantidade * l.precoCents));
        linhas.forEach((l, i) => { l.descontoCents = d[i]!; });
        return linhas;
      }
      if (tentativa === 1) throw new AppError(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${cat.nome}: faltam ${resta}`);
    } else if (tentativa === 1) {
      throw new AppError(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${cat.nome}: sem saldo no bazar`);
    }
  }
  throw new AppError(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', cat.nome);
}

// ---------------- processamento ----------------
export interface ResultadoVenda { id: string; numero: number; jaExistia: boolean }

/**
 * Grava a venda dentro de `tx`. Lança AppError (regra de negócio) ou erro do banco.
 * A hora da venda é sempre a do servidor.
 */
export async function processarVenda(tx: Tx, id: string, req: VendaRequest, op: Operador): Promise<ResultadoVenda> {
  const existente = await tx.venda.findUnique({ where: { id }, select: { numero: true, registradaPorId: true } });
  if (existente) {
    if (existente.registradaPorId !== op.id) throw new AppError(409, 'Identificador de venda já usado', 'ID_EM_USO');
    return { id, numero: existente.numero, jaExistia: true };
  }

  // ----- caixa e terminal (anti-IDOR: nunca confia no caixaId/terminalId do corpo sem conferir) -----
  const caixa = await tx.caixaSessao.findUnique({ where: { id: req.caixaId }, include: { terminal: true } });
  if (!caixa) throw new AppError(409, 'Caixa não encontrado', 'CAIXA_INEXISTENTE');
  if (caixa.terminalId !== req.terminalId) throw new AppError(403, 'Caixa não pertence a este terminal', 'CAIXA_DE_OUTRO_TERMINAL');
  if (caixa.abertoPorId !== op.id) throw new AppError(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  if (!caixa.terminal.ativo) throw new AppError(409, 'Terminal desativado', 'TERMINAL_DESATIVADO');
  if (caixa.status !== 'ABERTO') throw new AppError(409, 'Caixa fechado', 'CAIXA_FECHADO'); // RN-12

  // ----- hora: sempre a do servidor -----
  const ocorrida = new Date();
  const diaVenda = localDate(ocorrida);

  // ----- itens -----
  const etiquetadas: { codigo: string; descontoCents: number }[] = [];
  const porCategoria = new Map<string, { qtd: number; desc: number }>();
  for (const it of req.itens) {
    const d = it.desconto ? toCents(it.desconto) : 0;
    if ('codigo' in it) etiquetadas.push({ codigo: it.codigo.toUpperCase(), descontoCents: d });
    else {
      const a = porCategoria.get(it.categoriaId) ?? { qtd: 0, desc: 0 };
      porCategoria.set(it.categoriaId, { qtd: a.qtd + it.quantidade, desc: a.desc + d });
    }
  }
  const linhas: Linha[] = [...(await alocarEtiquetadas(tx, etiquetadas))];
  for (const catId of [...porCategoria.keys()].sort()) {
    const c = porCategoria.get(catId)!;
    linhas.push(...(await alocarCategoria(tx, catId, c.qtd, c.desc)));
  }

  // ----- totais e desconto (servidor recalcula tudo) -----
  for (const l of linhas) if (l.descontoCents > l.quantidade * l.precoCents) throw new AppError(409, 'Desconto do item maior que o valor do item', 'DESCONTO_INVALIDO');
  const bruto = linhas.reduce((s, l) => s + l.quantidade * l.precoCents, 0);
  const subtotal = linhas.reduce((s, l) => s + l.quantidade * l.precoCents - l.descontoCents, 0);
  const descVenda = req.desconto ? toCents(req.desconto) : 0;
  if (descVenda > subtotal) throw new AppError(409, 'Desconto maior que o subtotal', 'DESCONTO_INVALIDO');
  const descTotal = bruto - subtotal + descVenda;
  if (descTotal > 0 && !op.permissoes.has('venda.desconto_autorizar')) {
    // limite do perfil em % (PA-08); comparação exata em inteiros
    if (descTotal * 10_000 > Math.round(op.limiteDescontoPct * 100) * bruto) {
      throw new AppError(409, 'Desconto acima do limite do perfil', 'DESCONTO_ACIMA_LIMITE', `Limite: ${op.limiteDescontoPct}%`);
    }
  }
  const total = subtotal - descVenda;
  if (total <= 0) throw new AppError(400, 'Venda sem valor a pagar', 'VENDA_SEM_VALOR');

  // ----- CPF da compra: validado pelos dígitos; o limite mensal (em reais) é conferido DENTRO da transação, com trava por CPF -----
  const cfgCpf = await configCpf(tx);
  let cpf: string | null = null;
  if (req.cpf) {
    cpf = normalizarCpf(req.cpf);
    if (!cpf) throw new AppError(400, 'CPF inválido', 'CPF_INVALIDO');
  } else if (cfgCpf.obrigatorio) {
    throw new AppError(400, 'Informe o CPF: o Administrador marcou o CPF como obrigatório na venda', 'CPF_OBRIGATORIO');
  }
  if (cpf) {
    await limparCpfsVencidos(tx);
    // duas vendas do mesmo CPF ao mesmo tempo não podem passar juntas do limite
    // (a função devolve void, que o Prisma não lê: por isso o SELECT 1 em volta)
    await tx.$queryRaw`SELECT 1 AS travado FROM (SELECT pg_advisory_xact_lock(hashtext(${`cpf:${cpf}`}))) t`;
    if (cfgCpf.limiteCents > 0) {
      const comprado = await compradoNoMes(tx, cpf);
      if (comprado + total > cfgCpf.limiteCents) {
        throw new AppError(409, 'Limite de compras por CPF no mês excedido', 'LIMITE_CPF',
          `Limite de R$ ${fromCents(cfgCpf.limiteCents)} por CPF no mês: já comprou R$ ${fromCents(comprado)}, saldo de R$ ${fromCents(Math.max(0, cfgCpf.limiteCents - comprado))}`);
      }
    }
  }

  // ----- pagamentos (RN-15) -----
  const pags = req.pagamentos.map((p) => ({ forma: p.forma, valor: toCents(p.valor), recebido: p.valorRecebido ? toCents(p.valorRecebido) : null }));
  if (pags.some((p) => p.valor <= 0)) throw new AppError(400, 'Pagamento com valor zero', 'VALIDACAO');
  const pago = pags.reduce((s, p) => s + p.valor, 0);
  if (pago !== total) throw new AppError(409, 'Pagamentos não fecham com o total recalculado', 'PAGAMENTO_DIVERGENTE', `Total ${fromCents(total)}, pago ${fromCents(pago)}`);
  // Valor recebido OBRIGATÓRIO em dinheiro, PIX e cartão (decisão do humano, 19/10/2026): o operador informa o que recebeu em cada forma.
  //  - dinheiro: recebido >= valor devido nessa forma; a diferença é o troco;
  //  - PIX e cartão: recebido = valor (não há troco);
  //  - fiado: o valor é o que fica na conta do cliente e não tem valor recebido.
  for (const p of pags) {
    if (p.forma === 'FIADO') {
      if (p.recebido !== null) throw new AppError(400, 'Fiado não tem valor recebido: o valor é o que fica na conta do cliente', 'FIADO_COM_RECEBIDO');
      continue;
    }
    if (p.recebido === null) throw new AppError(400, 'Informe o valor recebido em cada forma de pagamento', 'RECEBIDO_OBRIGATORIO');
    if (p.forma === 'DINHEIRO') {
      if (p.recebido < p.valor) throw new AppError(400, 'Valor recebido menor que o valor em dinheiro', 'RECEBIDO_INSUFICIENTE');
    } else if (p.recebido !== p.valor) {
      throw new AppError(400, 'PIX e cartão não têm troco: o valor recebido deve ser igual ao valor da forma', 'TROCO_INVALIDO');
    }
  }
  const fiados = pags.filter((p) => p.forma === 'FIADO');
  if (fiados.length > 1) throw new AppError(400, 'Apenas uma parcela de fiado por venda', 'VALIDACAO');
  let clienteId: string | null = null;
  let vencimento: string | null = null;
  if (req.clienteId) {
    const c = await obterClienteAtivo(tx, req.clienteId);
    if (!c) throw new AppError(409, 'Cliente inexistente ou inativo', 'CLIENTE_INVALIDO');
    clienteId = c.id;
  }
  if (fiados.length) {
    if (!clienteId) throw new AppError(409, 'Fiado exige cliente cadastrado', 'FIADO_SEM_CLIENTE'); // RN-03
    const prazo = await paramNum(tx, 'fiado.prazo_dias', 0);
    vencimento = req.vencimentoFiado ?? (prazo > 0 ? addDias(diaVenda, prazo) : null);
    if (!vencimento) throw new AppError(400, 'Informe o vencimento do fiado', 'FIADO_SEM_VENCIMENTO');
    if (vencimento < diaVenda) throw new AppError(400, 'Vencimento do fiado antes da data da venda', 'VALIDACAO');
  }

  // ----- fiscal (RN-17) -----
  const regras = await regrasVigentes(tx, diaVenda);

  // ----- gravação -----
  const venda = await tx.venda.create({
    data: {
      id, terminalId: caixa.terminalId, sessaoId: caixa.id, clienteId,
      subtotal: fromCents(subtotal), desconto: fromCents(descVenda), total: fromCents(total),
      registradaPorId: op.id, ocorridaEm: ocorrida,
    },
    select: { id: true, numero: true },
  });
  if (cpf) await tx.vendaCpf.create({ data: { vendaId: venda.id, cpf } });
  // baixas em ordem de item_id (evita deadlock entre caixas)
  for (const l of [...linhas].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const fiscal = resolverRegra(regras, l.itemId, l.categoriaId);
    const valorTotal = l.quantidade * l.precoCents - l.descontoCents;
    const imposto = fiscal.situacao === 'TRIBUTADO' ? Math.round((valorTotal * Math.round(fiscal.aliquotaPct * 100)) / 10_000) : 0;
    const vi = await tx.vendaItem.create({
      data: {
        vendaId: venda.id, itemId: l.itemId, formaSelecao: l.forma, quantidade: l.quantidade,
        precoUnitario: fromCents(l.precoCents), desconto: fromCents(l.descontoCents), valorTotal: fromCents(valorTotal),
        situacaoFiscal: fiscal.situacao, aliquota: fiscal.aliquotaPct.toFixed(2), valorImposto: fromCents(imposto), regraFiscalId: fiscal.regraId,
      },
      select: { id: true },
    });
    await tx.movimentacao.create({
      data: { itemId: l.itemId, tipo: 'VENDA', localOrigemId: 1, quantidade: l.quantidade, vendaItemId: vi.id, usuarioId: op.id, ocorridoEm: ocorrida },
    });
  }
  for (const p of pags) {
    await tx.vendaPagamento.create({
      data: {
        vendaId: venda.id, forma: p.forma, valor: fromCents(p.valor),
        // o banco só aceita valor recebido guardado para dinheiro (ck_pagamento_dinheiro); em PIX e cartão ele é igual ao valor
        valorRecebido: p.forma === 'DINHEIRO' && p.recebido !== null ? fromCents(p.recebido) : null,
        troco: p.forma === 'DINHEIRO' && p.recebido !== null ? fromCents(p.recebido - p.valor) : '0.00',
      },
    });
  }
  if (fiados.length) {
    await tx.contaReceber.create({
      data: { clienteId: clienteId!, vendaId: venda.id, descricao: `Venda nº ${venda.numero}`, valor: fromCents(fiados[0]!.valor), vencimento: toDbDate(vencimento!), criadaPorId: op.id },
    });
  }
  return { id: venda.id, numero: venda.numero, jaExistia: false };
}

/** Executa processarVenda numa transação própria (READ COMMITTED + travas explícitas). */
export function emTransacao<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
}

export const _interno = { ratear };
export { Prisma };
