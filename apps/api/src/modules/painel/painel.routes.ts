/**
 * Dashboards (S5-07, S5-15, S5-16) e fluxo de caixa (S5-08): só leitura, sempre por período (no máximo um ano).
 * Cada perfil vê o seu painel: Admin (visão geral), Estoque (sem custo) e Financeiro. Dias no fuso de Fortaleza.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/prisma.js';
import { dataExiste, parse, zData, zUuid } from '../../shared/http.js';
import { fromCents, money, toCents } from '../../shared/money.js';
import { addDias, fimDoDiaExclusivo, inicioDoDia, localDate, TZ } from '../../shared/dates.js';
import { paramNum } from '../../shared/parametros.js';
import { exigirUsuario, tem } from '../../plugins/auth.js';
import { FORMAS, calcularPrevia, type Forma } from '../caixa/caixa.service.js';
import { CATEGORIA_REEMBOLSO_ID } from '../financeiro/reembolso.service.js';
import { resumoFinanceiro } from '../financeiro/financeiro.routes.js';

const MAX_DIAS = 366;
const zPeriodo = z.object({ de: zData, ate: zData })
  .refine((x) => x.de <= x.ate, 'período inválido')
  // no Zod 4 esta regra roda mesmo com uma data já reprovada: só faz a conta com as duas datas válidas
  .refine((x) => !dataExiste(x.de) || !dataExiste(x.ate) || x.de >= addDias(x.ate, -(MAX_DIAS - 1)), `período de no máximo ${MAX_DIAS} dias`);
const zForma = z.enum(FORMAS);

/** Todos os dias do período, para o gráfico não pular dia sem movimento. */
function diasDoPeriodo(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = addDias(d, 1)) dias.push(d);
  return dias;
}
const total = (v: { toString(): string } | null | undefined) => toCents(v === null || v === undefined ? null : Number(v.toString()).toFixed(2));

/** Saldo em aberto do fiado (valor menos o recebido não estornado), total e vencido. */
async function fiadoEmAberto(hoje: string) {
  const contas = await prisma.contaReceber.findMany({
    where: { status: { in: ['ABERTA', 'PARCIAL'] } },
    select: { valor: true, vencimento: true, recebimentos: { where: { estornadoEm: null }, select: { valor: true } } },
  });
  let aberto = 0, vencido = 0;
  for (const c of contas) {
    const saldo = toCents(c.valor) - c.recebimentos.reduce((s, r) => s + toCents(r.valor), 0);
    aberto += saldo;
    if (c.vencimento.toISOString().slice(0, 10) < hoje) vencido += saldo;
  }
  return { aberto: fromCents(aberto), vencido: fromCents(vencido) };
}

/** Contas a pagar em aberto: vencidas e as que vencem nos próximos 7 dias. */
async function contasAPagar(hoje: string) {
  const abertas = await prisma.contaPagar.findMany({ where: { status: 'ABERTA' }, select: { id: true, descricao: true, valor: true, vencimento: true }, orderBy: { vencimento: 'asc' } });
  const comDia = abertas.map((c) => ({ ...c, dia: c.vencimento.toISOString().slice(0, 10) }));
  const vencidas = comDia.filter((c) => c.dia < hoje), proximas = comDia.filter((c) => c.dia >= hoje && c.dia <= addDias(hoje, 7));
  const soma = (l: typeof comDia) => fromCents(l.reduce((s, c) => s + toCents(c.valor), 0));
  const dto = (c: (typeof comDia)[number]) => ({ id: c.id, descricao: c.descricao, valor: money(c.valor), vencimento: c.dia });
  return {
    vencidas: { quantidade: vencidas.length, valor: soma(vencidas), itens: vencidas.slice(0, 5).map(dto) },
    proximos7Dias: { quantidade: proximas.length, valor: soma(proximas), itens: proximas.slice(0, 5).map(dto) },
  };
}

/** Saldo por categoria nos dois estoques (sem custo: o painel do Estoque não mostra valor atribuído). */
async function estoquePorCategoria(categoriaId?: string) {
  const rows = await prisma.$queryRaw<{ categoria_id: string; categoria: string; local_id: number; qtd: bigint; potencial: string }[]>`
    SELECT c.id::text AS categoria_id, c.nome AS categoria, s.local_id, sum(s.saldo) AS qtd,
      sum(s.saldo * CASE WHEN i.tipo_controle = 'ETIQUETADO' THEN pr.preco_venda ELSE coalesce(c.preco_padrao, 0) END)::text AS potencial
    FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id JOIN categoria c ON c.id = i.categoria_id LEFT JOIN produto pr ON pr.id = i.produto_id
    WHERE s.saldo > 0 AND (${categoriaId ?? null}::uuid IS NULL OR c.id = ${categoriaId ?? null}::uuid)
    GROUP BY c.id, c.nome, s.local_id ORDER BY c.nome`;
  const porCat = new Map<string, { categoriaId: string; categoria: string; bazar: number; doacoes: number }>();
  let potencial = 0;
  for (const r of rows) {
    const x = porCat.get(r.categoria_id) ?? { categoriaId: r.categoria_id, categoria: r.categoria, bazar: 0, doacoes: 0 };
    if (r.local_id === 1) x.bazar += Number(r.qtd); else x.doacoes += Number(r.qtd);
    porCat.set(r.categoria_id, x);
    potencial += toCents(Number(r.potencial).toFixed(2));
  }
  const categorias = [...porCat.values()].sort((a, b) => (b.bazar + b.doacoes) - (a.bazar + a.doacoes));
  return {
    categorias,
    itensBazar: categorias.reduce((s, c) => s + c.bazar, 0), itensDoacoes: categorias.reduce((s, c) => s + c.doacoes, 0),
    valorPotencial: fromCents(potencial),
  };
}

/** Lotes ainda recebendo cadastro e itens esperando a aprovação. */
async function filaDeEntrada() {
  const [lotes, itens] = await Promise.all([
    prisma.loteEntrada.count({ where: { status: { not: 'TRIADO' } } }),
    prisma.item.count({ where: { status: 'CADASTRADO' } }),
  ]);
  return { lotesEmCadastro: lotes, itensAguardandoAprovacao: itens };
}

export async function rotasPainel(app: FastifyInstance) {
  // ================= Dashboard do Admin (S5-07) =================
  app.get('/painel/admin', { config: { acesso: ['auditoria.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(zPeriodo.and(z.object({ operadorId: zUuid.optional(), forma: zForma.optional() })), req.query);
    const ini = inicioDoDia(q.de), fim = fimDoDiaExclusivo(q.ate), hoje = localDate();
    const operador = q.operadorId ?? null, forma = q.forma ?? null;
    // a venda conta pelo valor pago na forma escolhida (sem forma: o total da venda)
    const porDia = await prisma.$queryRaw<{ dia: string; qtd: bigint; total: string }[]>`
      SELECT to_char((v.ocorrida_em AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS dia, count(DISTINCT v.id) AS qtd,
        coalesce(sum(p.valor), 0)::text AS total
      FROM venda v JOIN venda_pagamento p ON p.venda_id = v.id
      WHERE v.status = 'FINALIZADA' AND v.ocorrida_em >= ${ini} AND v.ocorrida_em < ${fim}
        AND (${operador}::uuid IS NULL OR v.registrada_por_id = ${operador}::uuid)
        AND (${forma}::text IS NULL OR p.forma::text = ${forma}::text)
      GROUP BY 1 ORDER BY 1`;
    const porForma = await prisma.$queryRaw<{ forma: Forma; total: string }[]>`
      SELECT p.forma::text AS forma, sum(p.valor)::text AS total FROM venda v JOIN venda_pagamento p ON p.venda_id = v.id
      WHERE v.status = 'FINALIZADA' AND v.ocorrida_em >= ${ini} AND v.ocorrida_em < ${fim}
        AND (${operador}::uuid IS NULL OR v.registrada_por_id = ${operador}::uuid)
        AND (${forma}::text IS NULL OR p.forma::text = ${forma}::text)
      GROUP BY 1`;
    const mapaDia = new Map(porDia.map((r) => [r.dia, r]));
    const totalCents = porDia.reduce((s, r) => s + toCents(Number(r.total).toFixed(2)), 0);
    const quantidade = porDia.reduce((s, r) => s + Number(r.qtd), 0);

    // S6-19: o caixa aberto de quem consulta não entra (o dono não vê o esperado do próprio caixa enquanto ele está aberto)
    const abertos = await prisma.caixaSessao.findMany({ where: { status: 'ABERTO', abertoPorId: { not: u.id } }, include: { terminal: { select: { nome: true } } }, orderBy: { abertoEm: 'asc' } });
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: abertos.map((c) => c.abertoPorId) } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    const caixasAbertos = await Promise.all(abertos.map(async (c) => ({
      id: c.id, terminalNome: c.terminal.nome, operadorNome: nomes.get(c.abertoPorId) ?? '—', abertoEm: c.abertoEm.toISOString(),
      esperadoDinheiro: (await calcularPrevia(prisma, c.id)).dto.esperadoDinheiro,
    })));

    const estoque = await estoquePorCategoria();
    // o custo (valor atribuído) só vai para quem pode ver custo, como no estoque e nos relatórios
    const custo = tem(u, 'custo.consultar') ? await prisma.$queryRaw<{ atribuido: string | null }[]>`
      SELECT sum(s.saldo * i.valor_atribuido)::text AS atribuido FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id WHERE s.saldo > 0` : null;

    return {
      de: q.de, ate: q.ate,
      vendas: {
        total: fromCents(totalCents), quantidade, ticketMedio: fromCents(quantidade ? Math.round(totalCents / quantidade) : 0),
        porForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(toCents(Number(porForma.find((r) => r.forma === f)?.total ?? 0).toFixed(2)))])) as Record<Forma, string>,
        porDia: diasDoPeriodo(q.de, q.ate).map((dia) => ({ dia, total: fromCents(toCents(Number(mapaDia.get(dia)?.total ?? 0).toFixed(2))), quantidade: Number(mapaDia.get(dia)?.qtd ?? 0) })),
      },
      caixasAbertos,
      entrada: await filaDeEntrada(),
      estoque: { itensBazar: estoque.itensBazar, itensDoacoes: estoque.itensDoacoes, valorPotencial: estoque.valorPotencial, ...(custo ? { valorAtribuido: fromCents(total(custo[0]?.atribuido)) } : {}) },
      contasPagar: await contasAPagar(hoje),
      fiado: await fiadoEmAberto(hoje),
      eventos: await eventosSensiveis(ini, fim),
    };
  });

  // ================= Dashboard do Estoque (S5-15) =================
  app.get('/painel/estoque', { config: { acesso: ['estoque.consultar'] } }, async (req) => {
    const q = parse(zPeriodo.and(z.object({ categoriaId: zUuid.optional(), parceiroId: zUuid.optional() })), req.query);
    const ini = inicioDoDia(q.de), fim = fimDoDiaExclusivo(q.ate), hoje = localDate();
    const cat = q.categoriaId ?? null, parc = q.parceiroId ?? null;
    // o período do gráfico e os últimos 7 dias (os indicadores de hoje e da semana não dependem do filtro de data)
    const semana = addDias(hoje, -6);
    const desde = semana < q.de ? semana : q.de, apos = q.ate > hoje ? q.ate : hoje;
    const entradas = await prisma.$queryRaw<{ dia: string; qtd: bigint }[]>`
      SELECT to_char((m.ocorrido_em AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS dia, sum(m.quantidade) AS qtd
      FROM movimentacao m JOIN item i ON i.id = m.item_id JOIN lote_entrada l ON l.id = i.lote_id
      WHERE m.tipo = 'ENTRADA' AND m.ocorrido_em >= ${inicioDoDia(desde)} AND m.ocorrido_em < ${fimDoDiaExclusivo(apos)}
        AND (${cat}::uuid IS NULL OR i.categoria_id = ${cat}::uuid) AND (${parc}::uuid IS NULL OR l.parceiro_id = ${parc}::uuid)
      GROUP BY 1`;
    const porDia = new Map(entradas.map((r) => [r.dia, Number(r.qtd)]));
    const somaDias = (de: string, ate: string) => [...porDia].filter(([d]) => d >= de && d <= ate).reduce((s, [, n]) => s + n, 0);
    const descartes = await prisma.descarte.count({
      where: { revertidoEm: null, registradoEm: { gte: ini, lt: fim }, ...(cat ? { categoriaId: cat } : {}), ...(parc ? { lote: { parceiroId: parc } } : {}) },
    });
    const limite = await paramNum(prisma, 'estoque.pouco_saldo', 5);
    // pouco saldo: produto ativo de várias unidades (a peça única tem 1 por natureza), Bazar + Doações
    const pouco = await prisma.$queryRaw<{ id: string; codigo: string; nome: string; categoria: string; saldo: bigint }[]>`
      SELECT p.id::text, p.codigo, p.nome, c.nome AS categoria, coalesce(sum(s.saldo), 0) AS saldo
      FROM produto p JOIN categoria c ON c.id = p.categoria_id
      LEFT JOIN item i ON i.produto_id = p.id AND i.status = 'APROVADO' LEFT JOIN vw_saldo_estoque s ON s.item_id = i.id
      WHERE p.ativo AND NOT p.peca_unica AND (${cat}::uuid IS NULL OR p.categoria_id = ${cat}::uuid)
        AND EXISTS (SELECT 1 FROM item i2 WHERE i2.produto_id = p.id AND i2.status = 'APROVADO')
      GROUP BY p.id, p.codigo, p.nome, c.nome HAVING coalesce(sum(s.saldo), 0) <= ${limite}
      ORDER BY 5, p.nome LIMIT 20`;
    const ultimas = await prisma.movimentacao.findMany({
      where: { item: { ...(cat ? { categoriaId: cat } : {}), ...(parc ? { lote: { parceiroId: parc } } : {}) } },
      orderBy: { ocorridoEm: 'desc' }, take: 10,
      select: { id: true, tipo: true, quantidade: true, ocorridoEm: true, localOrigemId: true, localDestinoId: true,
        item: { select: { produto: { select: { nome: true, codigo: true } }, categoria: { select: { nome: true } } } }, usuario: { select: { nome: true } } },
    });
    const estoque = await estoquePorCategoria(q.categoriaId);
    const local = (id: number | null) => (id === 1 ? 'Bazar' : id === 2 ? 'Doações' : undefined);
    return {
      de: q.de, ate: q.ate,
      categorias: estoque.categorias, itensBazar: estoque.itensBazar, itensDoacoes: estoque.itensDoacoes,
      entrada: await filaDeEntrada(),
      entradasHoje: somaDias(hoje, hoje), entradas7Dias: somaDias(semana, hoje),
      entradasPorDia: diasDoPeriodo(q.de, q.ate).map((dia) => ({ dia, quantidade: porDia.get(dia) ?? 0 })),
      descartes,
      poucoSaldo: { limite, itens: pouco.map((p) => ({ produtoId: p.id, codigo: p.codigo, nome: p.nome, categoria: p.categoria, saldo: Number(p.saldo) })) },
      ultimasMovimentacoes: ultimas.map((m) => ({
        id: String(m.id), tipo: m.tipo, quantidade: m.quantidade, quando: m.ocorridoEm.toISOString(),
        descricao: m.item.produto ? `${m.item.produto.codigo} ${m.item.produto.nome}` : m.item.categoria.nome,
        origem: local(m.localOrigemId), destino: local(m.localDestinoId), usuarioNome: m.usuario.nome,
      })),
    };
  });

  // ================= Dashboard do Financeiro (S5-16) =================
  app.get('/painel/financeiro', { config: { acesso: ['relatorios.consultar'] } }, async (req) => {
    const q = parse(zPeriodo.and(z.object({ forma: zForma.optional() })), req.query);
    const ini = inicioDoDia(q.de), fim = fimDoDiaExclusivo(q.ate), hoje = localDate();
    const [dia, mes, periodo] = await Promise.all([
      resumoFinanceiro({ de: hoje, ate: hoje }), resumoFinanceiro({ de: `${hoje.slice(0, 8)}01`, ate: hoje }), resumoFinanceiro({ de: q.de, ate: q.ate }),
    ]);
    const fluxo = await fluxoPorDia(q.de, q.ate, q.forma);
    const comDiferenca = await prisma.caixaSessao.findMany({
      where: { status: 'FECHADO', diferenca: { not: 0 }, fechadoEm: { gte: ini, lt: fim } },
      include: { terminal: { select: { nome: true } } }, orderBy: { fechadoEm: 'desc' },
    });
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: comDiferenca.map((c) => c.abertoPorId) } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    const reemb = await prisma.contaPagar.aggregate({ where: { status: 'PAGA', categoriaDespesaId: CATEGORIA_REEMBOLSO_ID, pagoEm: { gte: ini, lt: fim } }, _sum: { valorPago: true }, _count: true });
    const resumo = (r: Awaited<ReturnType<typeof resumoFinanceiro>>) => {
      const entradas = toCents(r.resultado) + toCents(r.saidas);
      return { entradas: fromCents(entradas), saidas: r.saidas, resultado: r.resultado };
    };
    return {
      de: q.de, ate: q.ate,
      hoje: resumo(dia), mes: resumo(mes), periodo: { ...resumo(periodo), entradasPorForma: periodo.entradasPorForma, recebimentosFiado: periodo.recebimentosFiado },
      porDia: fluxo.map(({ dia: d, entradas, saidas }) => ({ dia: d, entradas, saidas })),
      contasPagar: await contasAPagar(hoje),
      fiado: await fiadoEmAberto(hoje),
      caixasComDiferenca: {
        quantidade: comDiferenca.length,
        itens: comDiferenca.slice(0, 8).map((c) => ({ id: c.id, terminalNome: c.terminal.nome, operadorNome: nomes.get(c.abertoPorId) ?? '—', fechadoEm: c.fechadoEm!.toISOString(), diferenca: money(c.diferenca!) })),
      },
      reembolsos: { quantidade: reemb._count, valor: fromCents(toCents(reemb._sum.valorPago ?? null)) },
    };
  });

  // ================= Fluxo de caixa (S5-08) =================
  // Realizado até hoje (vendas sem fiado + fiado recebido; contas pagas, sem reembolso) e previsto depois de hoje
  // (fiado e contas a pagar pelo vencimento). Contas e fiado já vencidos e em aberto aparecem à parte, como atrasados.
  app.get('/financeiro/fluxo-caixa', { config: { acesso: ['relatorios.consultar'] } }, async (req) => {
    const q = parse(zPeriodo, req.query);
    const hoje = localDate();
    const dias = await fluxoPorDia(q.de, q.ate);
    const abertasPagar = await prisma.contaPagar.findMany({ where: { status: 'ABERTA' }, select: { valor: true, vencimento: true } });
    const abertasReceber = await prisma.contaReceber.findMany({
      where: { status: { in: ['ABERTA', 'PARCIAL'] } },
      select: { valor: true, vencimento: true, recebimentos: { where: { estornadoEm: null }, select: { valor: true } } },
    });
    const prevPagar = new Map<string, number>(), prevReceber = new Map<string, number>();
    let atrasadoPagar = 0, atrasadoReceber = 0;
    for (const c of abertasPagar) {
      const d = c.vencimento.toISOString().slice(0, 10);
      if (d < hoje) atrasadoPagar += toCents(c.valor); else prevPagar.set(d, (prevPagar.get(d) ?? 0) + toCents(c.valor));
    }
    for (const c of abertasReceber) {
      const d = c.vencimento.toISOString().slice(0, 10);
      const saldo = toCents(c.valor) - c.recebimentos.reduce((s, r) => s + toCents(r.valor), 0);
      if (d < hoje) atrasadoReceber += saldo; else prevReceber.set(d, (prevReceber.get(d) ?? 0) + saldo);
    }
    let acumulado = 0;
    const linhas = dias.map((x) => {
      const futuro = x.dia > hoje;
      const entradas = futuro ? 0 : toCents(x.entradas), saidas = futuro ? 0 : toCents(x.saidas);
      // hoje: o que já aconteceu e o que ainda vence hoje; depois de hoje: só o previsto
      const aReceber = x.dia >= hoje ? (prevReceber.get(x.dia) ?? 0) : 0, aPagar = x.dia >= hoje ? (prevPagar.get(x.dia) ?? 0) : 0;
      acumulado += entradas - saidas + aReceber - aPagar;
      return { dia: x.dia, entradas: fromCents(entradas), saidas: fromCents(saidas), aReceber: fromCents(aReceber), aPagar: fromCents(aPagar), saldoDoDia: fromCents(entradas - saidas + aReceber - aPagar), acumulado: fromCents(acumulado) };
    });
    const soma = (k: 'entradas' | 'saidas' | 'aReceber' | 'aPagar') => fromCents(linhas.reduce((s, l) => s + toCents(l[k]), 0));
    return {
      de: q.de, ate: q.ate, hoje,
      dias: linhas,
      totais: { entradas: soma('entradas'), saidas: soma('saidas'), aReceber: soma('aReceber'), aPagar: soma('aPagar'), saldo: fromCents(acumulado) },
      atrasados: { aPagar: fromCents(atrasadoPagar), aReceber: fromCents(atrasadoReceber) },
    };
  });
}

/** Entradas e saídas realizadas por dia, pelo regime de caixa (as mesmas regras do resumo financeiro). */
async function fluxoPorDia(de: string, ate: string, forma?: Forma) {
  const ini = inicioDoDia(de), fim = fimDoDiaExclusivo(ate), f = forma ?? null;
  const dia = (col: Prisma.Sql) => Prisma.sql`to_char((${col} AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD')`;
  // fiado não é entrada de caixa: entra quando é recebido
  const vendas = await prisma.$queryRaw<{ dia: string; total: string }[]>`
    SELECT ${dia(Prisma.sql`v.ocorrida_em`)} AS dia, sum(p.valor)::text AS total FROM venda v JOIN venda_pagamento p ON p.venda_id = v.id
    WHERE v.status = 'FINALIZADA' AND p.forma <> 'FIADO' AND v.ocorrida_em >= ${ini} AND v.ocorrida_em < ${fim}
      AND (${f}::text IS NULL OR p.forma::text = ${f}::text)
    GROUP BY 1`;
  const receb = await prisma.$queryRaw<{ dia: string; total: string }[]>`
    SELECT ${dia(Prisma.sql`r.recebido_em`)} AS dia, sum(r.valor)::text AS total FROM recebimento r
    WHERE r.estornado_em IS NULL AND r.recebido_em >= ${ini} AND r.recebido_em < ${fim}
      AND (${f}::text IS NULL OR r.forma::text = ${f}::text)
    GROUP BY 1`;
  // reembolso não entra: a venda cancelada já saiu das entradas (não desconta duas vezes)
  const pagas = await prisma.$queryRaw<{ dia: string; total: string }[]>`
    SELECT ${dia(Prisma.sql`c.pago_em`)} AS dia, sum(c.valor_pago)::text AS total FROM conta_pagar c
    WHERE c.status = 'PAGA' AND c.pago_em >= ${ini} AND c.pago_em < ${fim}
      AND (c.categoria_despesa_id IS NULL OR c.categoria_despesa_id <> ${CATEGORIA_REEMBOLSO_ID}::uuid)
    GROUP BY 1`;
  const mapa = (rows: { dia: string; total: string }[]) => new Map(rows.map((r) => [r.dia, toCents(Number(r.total).toFixed(2))]));
  const mv = mapa(vendas), mr = mapa(receb), mp = mapa(pagas);
  return diasDoPeriodo(de, ate).map((d) => ({ dia: d, entradas: fromCents((mv.get(d) ?? 0) + (mr.get(d) ?? 0)), saidas: fromCents(mp.get(d) ?? 0) }));
}

/** Os últimos eventos sensíveis do período: cancelamentos, estornos, reembolsos e diferenças de caixa (sem motivo nem cliente). */
async function eventosSensiveis(ini: Date, fim: Date) {
  const [canceladas, estornos, reembolsos, diferencas] = await Promise.all([
    prisma.venda.findMany({ where: { status: 'CANCELADA', canceladaEm: { gte: ini, lt: fim } }, orderBy: { canceladaEm: 'desc' }, take: 10,
      select: { id: true, numero: true, total: true, canceladaEm: true, canceladaPor: { select: { nome: true } } } }),
    prisma.recebimento.findMany({ where: { estornadoEm: { gte: ini, lt: fim } }, orderBy: { estornadoEm: 'desc' }, take: 10, select: { id: true, valor: true, estornadoEm: true } }),
    prisma.contaPagar.findMany({ where: { status: 'PAGA', categoriaDespesaId: CATEGORIA_REEMBOLSO_ID, pagoEm: { gte: ini, lt: fim } }, orderBy: { pagoEm: 'desc' }, take: 10, select: { id: true, valorPago: true, pagoEm: true } }),
    prisma.caixaSessao.findMany({ where: { status: 'FECHADO', diferenca: { not: 0 }, fechadoEm: { gte: ini, lt: fim } }, orderBy: { fechadoEm: 'desc' }, take: 10,
      select: { id: true, diferenca: true, fechadoEm: true, terminal: { select: { nome: true } } } }),
  ]);
  return [
    ...canceladas.map((v) => ({ id: v.id, tipo: 'VENDA_CANCELADA' as const, quando: v.canceladaEm!.toISOString(), descricao: `Venda nº ${v.numero} cancelada${v.canceladaPor ? ` por ${v.canceladaPor.nome}` : ''}`, valor: money(v.total) })),
    ...estornos.map((r) => ({ id: r.id, tipo: 'RECEBIMENTO_ESTORNADO' as const, quando: r.estornadoEm!.toISOString(), descricao: 'Recebimento de fiado estornado', valor: money(r.valor) })),
    ...reembolsos.map((c) => ({ id: c.id, tipo: 'REEMBOLSO' as const, quando: c.pagoEm!.toISOString(), descricao: 'Reembolso em dinheiro de caixa fechado', valor: money(c.valorPago!) })),
    ...diferencas.map((c) => ({ id: c.id, tipo: 'DIFERENCA_CAIXA' as const, quando: c.fechadoEm!.toISOString(), descricao: `Caixa ${c.terminal.nome} fechado com diferença`, valor: money(c.diferenca!) })),
  ].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 10);
}
