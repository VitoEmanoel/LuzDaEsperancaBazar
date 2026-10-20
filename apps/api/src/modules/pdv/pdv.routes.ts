/**
 * PDV — catálogo do terminal (ETag), venda idempotente, listagem/comprovante e cancelamento
 * (RF-PDV-01..09, RN-14). Contrato: front-end features/pdv/pdv.api.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma } from '../../shared/prisma.js';
import { AppError, conflito, naoEncontrado, traduzirErroBanco } from '../../shared/errors.js';
import { page, parse, skipTake, zIdParam, zMotivo, zPage, zPeriodo, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { fromCents, toCents } from '../../shared/money.js';
import { localDate, periodo } from '../../shared/dates.js';
import { paramNum } from '../../shared/parametros.js';
import { exigirUsuario, tem, type UsuarioCtx } from '../../plugins/auth.js';
import { regraDto, regrasVigentes } from '../fiscal/fiscal.service.js';
import { configCpf, limparCpfsVencidos, normalizarCpf, saldoDoCpf } from './cpf.service.js';
import { registrarReembolso } from '../financeiro/reembolso.service.js';
import { carregarVenda, emTransacao, processarVenda, zVendaRequest, type Operador } from './vendas.service.js';

const opDe = (u: UsuarioCtx): Operador => ({ id: u.id, nome: u.nome, permissoes: u.permissoes, limiteDescontoPct: u.limiteDescontoPct });

/** Venda alheia só para quem administra vendas ou relatórios (anti-IDOR). */
function podeVerTodas(u: UsuarioCtx) { return tem(u, 'venda.cancelar') || tem(u, 'relatorios.consultar'); }

export async function rotasPdv(app: FastifyInstance) {
  // ---------------- catálogo do terminal (RF-PDV-10, RNF-19: só o necessário) ----------------
  app.get('/pdv/catalogo', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const DIA = 86_400_000;
    const [categorias, etiquetadas, clientes, regras, prazo, cfgCpf] = await Promise.all([
      // RN-30: categoria inativa continua vendável enquanto tiver saldo por categoria no bazar
      prisma.$queryRaw<{ id: string; nome: string; preco_padrao: string | null; venda_por_categoria: boolean; ativa: boolean; saldo_bazar: number }[]>`
        SELECT c.id::text, c.nome, c.preco_padrao::text, c.venda_por_categoria, c.ativa,
          -- quanto há para vender por categoria no Bazar (o PDV avisa e bloqueia acima disso; o servidor confere de novo ao gravar)
          coalesce((SELECT sum(s.saldo) FROM item i JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1
            WHERE i.categoria_id = c.id AND i.tipo_controle = 'CATEGORIA'), 0)::int AS saldo_bazar
        FROM categoria c
        WHERE (c.ativa AND c.venda_por_categoria) OR EXISTS (
          SELECT 1 FROM item i JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
          WHERE i.categoria_id = c.id AND i.tipo_controle = 'CATEGORIA')
        ORDER BY c.nome`,
      // um por produto com saldo no Bazar (somando as entradas aprovadas); o preço é o atual do produto
      prisma.$queryRaw<{ id: string; codigo: string; nome: string; preco_venda: string; peca_unica: boolean; saldo_bazar: number }[]>`
        SELECT pr.id::text, pr.codigo, pr.nome, pr.preco_venda::text, pr.peca_unica, sum(s.saldo)::int AS saldo_bazar
        FROM produto pr JOIN item i ON i.produto_id = pr.id AND i.status = 'APROVADO'
        JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
        GROUP BY pr.id ORDER BY pr.codigo`,
      // LGPD (minimização, recomendação do QA): só vai para o terminal quem tem fiado em aberto, fiado nos
      // últimos 180 dias ou cadastro recente (90 dias) — não a base inteira de clientes.
      prisma.cliente.findMany({
        where: {
          ativo: true, anonimizadoEm: null,
          OR: [
            { contasReceber: { some: { status: { in: ['ABERTA', 'PARCIAL'] } } } },
            { contasReceber: { some: { criadaEm: { gte: new Date(Date.now() - 180 * DIA) } } } },
            { criadoEm: { gte: new Date(Date.now() - 90 * DIA) } },
          ],
        },
        select: { id: true, nome: true, telefone: true }, orderBy: { nome: 'asc' },
      }),
      regrasVigentes(prisma, localDate()),
      paramNum(prisma, 'fiado.prazo_dias', 0),
      configCpf(prisma),
    ]);
    const corpo = {
      categorias: categorias.map((c) => ({ id: c.id, nome: c.nome, precoPadrao: c.preco_padrao ? Number(c.preco_padrao).toFixed(2) : '0.00', vendaPorCategoria: c.venda_por_categoria, ativo: c.ativa, saldoBazar: c.saldo_bazar })),
      // `itemId` é o id do produto (o PDV vende pelo código); `saldoBazar` e `pecaUnica` para o "restam N" (S4-08)
      itensEtiquetados: etiquetadas.map((p) => ({ itemId: p.id, codigo: p.codigo, descricao: p.nome, preco: Number(p.preco_venda).toFixed(2), saldoBazar: p.saldo_bazar, pecaUnica: p.peca_unica })),
      clientesFiado: clientes,
      regrasFiscais: regras.map(regraDto),
      fiadoPrazoDias: prazo || undefined,
      // regras do CPF na venda (o PDV mostra o saldo e esconde o "Não" quando é obrigatório)
      cpfObrigatorio: cfgCpf.obrigatorio,
      cpfLimiteMensal: cfgCpf.limiteCents / 100,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(corpo)).digest('base64url').slice(0, 27)}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return { versao: etag, ...corpo };
  });

  // ---------------- CPF: valida e devolve o saldo do mês (POST: o CPF nunca vai na URL) ----------------
  app.post('/pdv/cpf/saldo', { config: { acesso: ['caixa.operar'], rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { cpf: bruto } = parse(z.object({ cpf: z.string().trim().max(20) }), req.body);
    const cpf = normalizarCpf(bruto);
    if (!cpf) throw new AppError(400, 'CPF inválido', 'CPF_INVALIDO');
    await limparCpfsVencidos(prisma); // CPFs de meses anteriores somem no primeiro uso do mês
    return { cpf, ...(await saldoDoCpf(prisma, cpf)) };
  });

  // ---------------- venda online, idempotente (RF-PDV-03, RN-26) ----------------
  app.put('/vendas/:id', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const body = parse(zVendaRequest, req.body);
    let r;
    try {
      r = await emTransacao((tx) => processarVenda(tx, id, body, opDe(u)));
    } catch (e) {
      // corrida: o mesmo id gravado por outra requisição simultânea => devolve a venda já gravada
      const t = traduzirErroBanco(e);
      if (t?.code === 'DUPLICADO' && (await prisma.venda.findUnique({ where: { id }, select: { registradaPorId: true } }))?.registradaPorId === u.id) {
        r = { id, numero: 0, jaExistia: true };
      } else throw e;
    }
    const v = await carregarVenda(prisma, id, true);
    return reply.code(r.jaExistia ? 200 : 201).send(v!.dto);
  });

  // ---------------- listagem e comprovante (RF-PDV-08/09) ----------------
  app.get('/vendas', { config: { acesso: ['caixa.operar', 'venda.cancelar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(zPage.merge(zPeriodo).extend({ caixaId: zUuid.optional() }), req.query);
    const where = {
      ...(podeVerTodas(u) ? {} : { registradaPorId: u.id }),
      ...(q.caixaId ? { sessaoId: q.caixaId } : {}),
      ...(periodo(q.de, q.ate) ? { ocorridaEm: periodo(q.de, q.ate) } : {}),
    };
    const [ids, total] = await Promise.all([
      prisma.venda.findMany({ where, select: { id: true }, orderBy: [{ ocorridaEm: 'desc' }, { numero: 'desc' }], ...skipTake(q) }),
      prisma.venda.count({ where }),
    ]);
    const itens = [];
    for (const { id } of ids) itens.push((await carregarVenda(prisma, id))!.dto);
    return page(itens, q, total);
  });

  app.get('/vendas/:id/comprovante', { config: { acesso: ['caixa.operar', 'venda.cancelar', 'relatorios.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const v = await carregarVenda(prisma, id, true); // o CPF só sai no comprovante
    if (!v || (!podeVerTodas(u) && v.venda.registradaPorId !== u.id)) naoEncontrado('Venda'); // 404 em vez de 403: não revela existência
    return v!.dto;
  });

  // ---------------- cancelamento (RF-PDV-07, RN-14) ----------------
  app.post('/vendas/:id/cancelar', { config: { acesso: ['venda.cancelar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const v = await tx.venda.findUnique({ where: { id }, include: { sessao: { select: { status: true } }, pagamentos: true } });
      if (!v) naoEncontrado('Venda');
      if (v!.status === 'CANCELADA') conflito('VENDA_CANCELADA', 'Venda já cancelada');
      const dinheiro = v!.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
      let reembolsoId: string | undefined;
      // Caixa da venda fechado não reabre: o reembolso em dinheiro vira uma saída paga no financeiro (RN-14).
      // Caixa ainda aberto: a venda cancelada já sai do valor esperado, sem reembolso à parte.
      if (dinheiro > 0 && v!.sessao.status === 'FECHADO') {
        reembolsoId = (await registrarReembolso(tx, u.id, dinheiro, `Reembolso da venda nº ${v!.numero}`)).id;
      }
      // O banco devolve os itens ao estoque de origem e cancela a conta a receber (tg_estorna_venda_cancelada);
      // recusa se houver recebimento de fiado ativo (FIADO_COM_RECEBIMENTO).
      await tx.venda.update({ where: { id }, data: { status: 'CANCELADA', canceladaPorId: u.id, canceladaEm: new Date(), motivoCancelamento: motivo } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'VENDA_CANCELADA', 'venda', id, { status: 'FINALIZADA' },
        { status: 'CANCELADA', motivo, reembolsoDinheiro: fromCents(dinheiro), reembolsoId });
    });
    return (await carregarVenda(prisma, id))!.dto;
  });
}
