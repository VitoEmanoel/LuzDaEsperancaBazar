/** CXA — cálculo do fechamento (RN-19) e utilitários de caixa. */
import type { Db } from '../../shared/prisma.js';
import { fromCents, money, moneyOpt, toCents } from '../../shared/money.js';
import { AppError } from '../../shared/errors.js';

export const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO'] as const;
export type Forma = (typeof FORMAS)[number];

/**
 * RN-19: dinheiro esperado = fundo de troco + vendas em dinheiro (já líquidas de troco)
 *  + recebimentos de fiado em dinheiro feitos neste caixa e não estornados + suprimentos − sangrias.
 */
export async function calcularPrevia(db: Db, caixaId: string) {
  const cx = await db.caixaSessao.findUniqueOrThrow({ where: { id: caixaId }, select: { valorAbertura: true, fechadoEm: true } });
  // Caixa já fechado: cancelamento e estorno feitos DEPOIS do fechamento não mudam o que estava na gaveta quando ele fechou
  // (o reembolso sai pelo financeiro), então a venda cancelada e o recebimento estornado depois ainda contam aqui.
  const fech = cx.fechadoEm;
  const porForma = await db.$queryRaw<{ forma: Forma; total: string }[]>`
    SELECT p.forma::text AS forma, sum(p.valor)::text AS total
    FROM venda_pagamento p JOIN venda v ON v.id = p.venda_id
    WHERE v.sessao_id = ${caixaId}::uuid
      AND (v.status = 'FINALIZADA' OR (v.status = 'CANCELADA' AND ${fech}::timestamptz IS NOT NULL AND v.cancelada_em > ${fech}::timestamptz))
    GROUP BY p.forma`;
  const qtdVendas = await db.venda.count({ where: { sessaoId: caixaId, OR: [{ status: 'FINALIZADA' }, ...(fech ? [{ status: 'CANCELADA' as const, canceladaEm: { gt: fech } }] : [])] } });
  const receb = await db.recebimento.aggregate({ where: { sessaoId: caixaId, forma: 'DINHEIRO', OR: [{ estornadoEm: null }, ...(fech ? [{ estornadoEm: { gt: fech } }] : [])] }, _sum: { valor: true } });
  const lanc = await db.caixaLancamento.groupBy({ by: ['tipo'], where: { sessaoId: caixaId }, _sum: { valor: true } });

  const totais = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
  for (const r of porForma) totais[r.forma] = toCents(Number(r.total).toFixed(2));
  const sup = toCents(lanc.find((l) => l.tipo === 'SUPRIMENTO')?._sum.valor ?? null);
  const sang = toCents(lanc.find((l) => l.tipo === 'SANGRIA')?._sum.valor ?? null);
  const esperado = toCents(cx.valorAbertura) + totais.DINHEIRO + toCents(receb._sum.valor ?? null) + sup - sang;
  return {
    esperadoCents: esperado,
    dto: {
      fundoTroco: money(cx.valorAbertura), suprimentos: fromCents(sup), sangrias: fromCents(sang),
      totaisPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(totais[f])])) as Record<Forma, string>,
      esperadoDinheiro: fromCents(esperado), quantidadeVendas: qtdVendas,
    },
  };
}

/** Caixa aberto do operador (para sangria automática de reembolso/pagamento). */
export async function caixaAbertoDoOperador(db: Db, usuarioId: string) {
  return db.caixaSessao.findFirst({ where: { abertoPorId: usuarioId, status: 'ABERTO' } });
}

/** Registra sangria conferindo que há dinheiro suficiente no caixa. */
export async function registrarSangria(db: Db, caixaId: string, usuarioId: string, valorCents: number, motivo: string, id?: string) {
  const { esperadoCents } = await calcularPrevia(db, caixaId);
  if (valorCents > esperadoCents) {
    throw new AppError(409, 'Sangria maior que o dinheiro em caixa', 'SANGRIA_ACIMA_SALDO', `Disponível: ${fromCents(Math.max(0, esperadoCents))}`);
  }
  return db.caixaLancamento.create({
    data: { ...(id ? { id } : {}), sessaoId: caixaId, tipo: 'SANGRIA', valor: fromCents(valorCents), motivo: motivo.slice(0, 300), usuarioId },
  });
}

type CaixaRow = {
  id: string; terminalId: string; abertoPorId: string; status: 'ABERTO' | 'FECHADO'; abertoEm: Date; valorAbertura: { toFixed(n: number): string };
  fechadoEm: Date | null; valorEsperado: { toFixed(n: number): string } | null; valorContado: { toFixed(n: number): string } | null;
  diferenca: { toFixed(n: number): string } | null; observacao: string | null; terminal: { nome: string };
};
export const caixaDto = (c: CaixaRow, operadorNome: string) => ({
  id: c.id, terminalId: c.terminalId, terminalNome: c.terminal.nome, operadorId: c.abertoPorId, operadorNome,
  abertoEm: c.abertoEm.toISOString(), fundoTroco: money(c.valorAbertura), status: c.status,
  fechadoEm: c.fechadoEm?.toISOString(), esperado: moneyOpt(c.valorEsperado), contado: moneyOpt(c.valorContado),
  diferenca: moneyOpt(c.diferenca), observacao: c.observacao ?? undefined,
});

// ---------------- linha do tempo do caixa (da abertura ao fechamento) ----------------
export type TipoEventoCaixa = 'ABERTURA' | 'VENDA' | 'VENDA_CANCELADA' | 'SANGRIA' | 'SUPRIMENTO' | 'RECEBIMENTO_FIADO' | 'RECEBIMENTO_ESTORNADO' | 'FECHAMENTO';
export interface EventoCaixa {
  quando: string; tipo: TipoEventoCaixa; descricao: string;
  /** valor do evento (venda: total; sangria: o que saiu; fechamento: o contado) */
  valor: string;
  /** dinheiro que o evento põe (+) ou tira (-) da gaveta; "0.00" quando não mexe nela (PIX, cartão, fiado) */
  efeitoDinheiro: string;
  /** dinheiro na gaveta depois do evento; ausente em evento posterior ao fechamento (a gaveta já tinha sido conferida) */
  gavetaApos?: string;
  aposFechamento?: boolean;
}
const NOME_FORMA: Record<string, string> = { DINHEIRO: 'dinheiro', PIX: 'PIX', CARTAO_DEBITO: 'cartão de débito', CARTAO_CREDITO: 'cartão de crédito', FIADO: 'fiado' };

/** Tudo o que aconteceu no caixa, em ordem, com o dinheiro que deveria estar na gaveta depois de cada evento. */
export async function linhaDoTempo(db: Db, caixaId: string) {
  const cx = await db.caixaSessao.findUniqueOrThrow({ where: { id: caixaId }, include: { terminal: { select: { nome: true } } } });
  const [vendas, lancs, receb] = await Promise.all([
    db.venda.findMany({ where: { sessaoId: caixaId }, include: { pagamentos: true, cliente: { select: { nome: true } } }, orderBy: { ocorridaEm: 'asc' } }),
    db.caixaLancamento.findMany({ where: { sessaoId: caixaId }, orderBy: { criadoEm: 'asc' } }),
    db.recebimento.findMany({ where: { sessaoId: caixaId }, orderBy: { recebidoEm: 'asc' } }),
  ]);
  type Bruto = Omit<EventoCaixa, 'quando' | 'gavetaApos' | 'aposFechamento'> & { em: Date; cents: number };
  const ev: Bruto[] = [{ em: cx.abertoEm, tipo: 'ABERTURA', descricao: 'Abertura do caixa (fundo de troco)', valor: money(cx.valorAbertura), efeitoDinheiro: money(cx.valorAbertura), cents: toCents(cx.valorAbertura) }];
  for (const v of vendas) {
    const din = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
    const formas = v.pagamentos.map((p) => {
      const troco = toCents(p.troco);
      return `${NOME_FORMA[p.forma] ?? p.forma} ${money(p.valor)}${p.forma === 'DINHEIRO' && p.valorRecebido ? ` (recebido ${money(p.valorRecebido)}${troco ? `, troco ${fromCents(troco)}` : ''})` : ''}`;
    }).join(' + ');
    ev.push({ em: v.ocorridaEm, tipo: 'VENDA', descricao: `Venda nº ${v.numero}${v.cliente ? ` · ${v.cliente.nome}` : ''} · ${formas}`, valor: money(v.total), efeitoDinheiro: fromCents(din), cents: din });
    if (v.status === 'CANCELADA' && v.canceladaEm) ev.push({ em: v.canceladaEm, tipo: 'VENDA_CANCELADA', descricao: `Venda nº ${v.numero} cancelada`, valor: money(v.total), efeitoDinheiro: fromCents(-din), cents: -din });
  }
  for (const l of lancs) {
    const c = l.tipo === 'SANGRIA' ? -toCents(l.valor) : toCents(l.valor);
    ev.push({ em: l.criadoEm, tipo: l.tipo, descricao: `${l.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}: ${l.motivo}`, valor: money(l.valor), efeitoDinheiro: fromCents(c), cents: c });
  }
  for (const r of receb) {
    const din = r.forma === 'DINHEIRO' ? toCents(r.valor) : 0;
    ev.push({ em: r.recebidoEm, tipo: 'RECEBIMENTO_FIADO', descricao: `Recebimento de fiado em ${NOME_FORMA[r.forma] ?? r.forma}`, valor: money(r.valor), efeitoDinheiro: fromCents(din), cents: din });
    if (r.estornadoEm) ev.push({ em: r.estornadoEm, tipo: 'RECEBIMENTO_ESTORNADO', descricao: 'Estorno de recebimento de fiado', valor: money(r.valor), efeitoDinheiro: fromCents(-din), cents: -din });
  }
  ev.sort((a, b) => a.em.getTime() - b.em.getTime());
  let gaveta = 0;
  const eventos: EventoCaixa[] = ev.map(({ em, cents, ...e }) => {
    const apos = cx.fechadoEm !== null && em.getTime() > cx.fechadoEm.getTime();
    if (!apos) gaveta += cents;
    // Depois do fechamento a gaveta já foi conferida: o evento aparece, mas não mexe nela (o reembolso saiu pelo financeiro)
    return apos
      ? { ...e, efeitoDinheiro: '0.00', descricao: e.tipo === 'VENDA_CANCELADA' ? `${e.descricao} · o reembolso saiu pelo financeiro` : e.descricao, quando: em.toISOString(), aposFechamento: true }
      : { ...e, quando: em.toISOString(), gavetaApos: fromCents(gaveta) };
  });
  if (cx.fechadoEm) {
    // o fechamento entra na ordem do tempo, depois do último evento anterior a ele
    const i = eventos.findIndex((e) => new Date(e.quando).getTime() > cx.fechadoEm!.getTime());
    const fech: EventoCaixa = { quando: cx.fechadoEm.toISOString(), tipo: 'FECHAMENTO', descricao: `Fechamento do caixa (esperado ${money(cx.valorEsperado)}, diferença ${money(cx.diferenca)})`, valor: money(cx.valorContado), efeitoDinheiro: '0.00', gavetaApos: money(cx.valorContado) };
    if (i === -1) eventos.push(fech); else eventos.splice(i, 0, fech);
  }
  return { caixa: cx, eventos, gavetaAgora: fromCents(gaveta) };
}
