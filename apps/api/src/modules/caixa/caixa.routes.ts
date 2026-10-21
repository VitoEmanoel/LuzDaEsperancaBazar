/** CXA — terminais e sessões de caixa (RF-CXA-01..05, RN-12, RN-13, RN-19). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Db } from '../../shared/prisma.js';
import { AppError, conflito, naoEncontrado, traduzirErroBanco } from '../../shared/errors.js';
import { page, parse, skipTake, zBoolQuery, zIdParam, zMoney, zPage, zPeriodo, zTexto, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { fromCents, money, toCents } from '../../shared/money.js';
import { periodo } from '../../shared/dates.js';
import { exigirUsuario, tem, type UsuarioCtx } from '../../plugins/auth.js';
import { caixaDto, calcularPrevia, linhaDoTempo, registrarSangria } from './caixa.service.js';
import { gerarPdfFechamento } from './fechamento.pdf.js';
import { reservarChave } from '../../shared/idempotencia.js';

const incTerminal = { terminal: { select: { nome: true } } } as const;

/** Só o primeiro nome de quem ocupa o terminal (S6-18, decisão do humano): basta para a equipe se achar. */
const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? '';

/** Terminal aberto com outra pessoa (S6-18): a mensagem diz qual e com quem; quem tem o terminal fixo não escolhe outro (S6-21). */
function terminalOcupado(terminal: string, ocupante: string, fixo: boolean): never {
  return conflito('TERMINAL_OCUPADO', fixo
    ? `O ${terminal} já está aberto com ${primeiroNome(ocupante)}. Peça para ${primeiroNome(ocupante)} fechar o caixa ou fale com o Administrador.`
    : `O ${terminal} já está aberto com ${primeiroNome(ocupante)}. Escolha outro terminal.`);
}

/** Caixa do próprio operador e aberto (anti-IDOR: caixaId da URL é conferido contra o usuário). */
async function meuCaixaAberto(db: Db, u: UsuarioCtx, id: string) {
  const c = await db.caixaSessao.findUnique({ where: { id }, include: incTerminal });
  if (!c) naoEncontrado('Caixa');
  if (c!.abertoPorId !== u.id) throw new AppError(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  if (c!.status !== 'ABERTO') conflito('CAIXA_FECHADO', 'Caixa fechado');
  return c!;
}

/** Caixa do próprio operador (aberto ou fechado) ou, para quem pode ver relatórios, qualquer caixa. */
async function caixaVisivel(db: Db, u: UsuarioCtx, id: string) {
  const c = await db.caixaSessao.findUnique({ where: { id }, include: incTerminal });
  if (!c) naoEncontrado('Caixa');
  if (c!.abertoPorId !== u.id && !tem(u, 'relatorios.consultar')) throw new AppError(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  return c!;
}

export async function rotasCaixa(app: FastifyInstance) {
  // ---------------- terminais ----------------
  // caixa.operar lê os ativos para escolher o terminal na abertura (divergência 1 do README do front)
  app.get('/terminais', { config: { acesso: ['terminais.gerenciar', 'caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(z.object({ ativo: zBoolQuery.optional() }), req.query);
    const ativo = tem(u, 'terminais.gerenciar') ? q.ativo : true;
    const ts = await prisma.terminal.findMany({ where: ativo !== undefined ? { ativo } : {}, orderBy: { nome: 'asc' } });
    // S6-18: quem está com o terminal aberto, só o primeiro nome e só de outra pessoa (sem id do caixa, fundo nem hora)
    const abertos = await prisma.caixaSessao.findMany({ where: { status: 'ABERTO', terminalId: { in: ts.map((t) => t.id) } }, select: { terminalId: true, abertoPorId: true, abertoPor: { select: { nome: true } } } });
    const ocupante = new Map(abertos.filter((c) => c.abertoPorId !== u.id).map((c) => [c.terminalId, primeiroNome(c.abertoPor.nome)]));
    return ts.map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo, ...(ocupante.has(t.id) ? { ocupadoPor: ocupante.get(t.id) } : {}) }));
  });

  app.post('/terminais', { config: { acesso: ['terminais.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(60) }), req.body);
    const { t, reenvio } = await prisma.$transaction(async (tx) => {
      if (b.id) {
        // S6-14: o mesmo id com o mesmo pedido é o reenvio; com outro nome, de outro usuário ou de outra operação, 409
        const nova = await reservarChave(tx, b.id, 'terminal', u.id, b);
        const ja = await tx.terminal.findUnique({ where: { id: b.id } });
        if (ja) {
          if (nova && ja.nome !== b.nome) conflito('ID_EM_USO', 'Este identificador já foi usado em outro terminal'); // chave já limpa: confere o nome
          return { t: ja, reenvio: true };
        }
        if (!nova) conflito('ID_EM_USO', 'Este identificador já foi usado em outra operação');
      }
      const n = await tx.terminal.create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TERMINAL_CRIADO', 'terminal', n.id);
      return { t: n, reenvio: false };
    });
    return reply.code(reenvio ? 200 : 201).send({ id: t.id, nome: t.nome, ativo: t.ativo });
  });

  app.patch('/terminais/:id', { config: { acesso: ['terminais.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(60).optional(), ativo: z.boolean().optional() }).strict(), req.body);
    const antes = await prisma.terminal.findUnique({ where: { id } });
    if (!antes) naoEncontrado('Terminal');
    const t = await prisma.$transaction(async (tx) => {
      const n = await tx.terminal.update({ where: { id }, data: b });
      if (b.ativo === false) {
        // RNF-19: sessões ligadas ao terminal são revogadas; o PDV apaga os dados locais ao receber TERMINAL_DESATIVADO
        await tx.sessaoUsuario.updateMany({ where: { terminalId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TERMINAL_ALTERADO', 'terminal', id, { ativo: antes!.ativo }, { ativo: n.ativo });
      return n;
    });
    return { id: t.id, nome: t.nome, ativo: t.ativo };
  });

  // ---------------- sessão de caixa ----------------
  app.get('/caixas/atual', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const c = await prisma.caixaSessao.findFirst({ where: { abertoPorId: u.id, status: 'ABERTO' }, include: { terminal: true } });
    if (!c) naoEncontrado('Caixa aberto');
    if (!c!.terminal.ativo) conflito('TERMINAL_DESATIVADO', 'Este terminal foi desativado pelo Administrador');
    return caixaDto(c!, u.nome);
  });

  app.post('/caixas', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid, terminalId: zUuid, fundoTroco: zMoney }), req.body);
    const fixo = (await prisma.usuario.findUnique({ where: { id: u.id }, select: { terminalId: true } }))?.terminalId ?? null;
    const { c, reenvio } = await prisma.$transaction(async (tx) => {
      // S6-14: a chave vem antes de qualquer conferência, senão o reenvio da própria abertura bateria no próprio caixa aberto
      const nova = await reservarChave(tx, b.id, 'abrir_caixa', u.id, b);
      const ja = await tx.caixaSessao.findUnique({ where: { id: b.id }, include: incTerminal });
      if (ja) {
        // chave já limpa: confere quem abriu, o terminal e o fundo
        if (nova && (ja.abertoPorId !== u.id || ja.terminalId !== b.terminalId || toCents(money(ja.valorAbertura)) !== toCents(b.fundoTroco))) conflito('ID_EM_USO', 'Identificador já usado');
        return { c: ja, reenvio: true };
      }
      if (!nova) conflito('ID_EM_USO', 'Identificador já usado');
      // S6-21: quem tem terminal definido só abre nele, também chamando a API direto (o banco confere de novo)
      if (fixo && fixo !== b.terminalId) {
        const meu = await tx.terminal.findUnique({ where: { id: fixo }, select: { nome: true } });
        throw new AppError(403, `Você só abre caixa no ${meu?.nome ?? 'terminal definido para você'}. Para trocar, fale com o Administrador.`, 'TERMINAL_DO_USUARIO');
      }
      const t = await tx.terminal.findFirst({ where: { id: b.terminalId, ativo: true } });
      if (!t) throw new AppError(400, 'Terminal inexistente ou desativado', 'VALIDACAO');
      // RN-13: um caixa aberto por terminal e por operador (índices únicos parciais garantem na corrida). Os dois casos
      // são diferentes para quem opera (S6-18): o próprio caixa aberto volta ao PDV; o terminal com outra pessoa diz com quem.
      if (await tx.caixaSessao.findFirst({ where: { status: 'ABERTO', abertoPorId: u.id }, select: { id: true } })) conflito('CAIXA_JA_ABERTO', 'Você já tem um caixa aberto');
      const ocupado = await tx.caixaSessao.findFirst({ where: { status: 'ABERTO', terminalId: t.id }, select: { abertoPor: { select: { nome: true } } } });
      if (ocupado) terminalOcupado(t.nome, ocupado.abertoPor.nome, !!fixo);
      const n = await tx.caixaSessao.create({ data: { id: b.id, terminalId: t.id, abertoPorId: u.id, valorAbertura: b.fundoTroco }, include: incTerminal });
      await tx.sessaoUsuario.update({ where: { id: u.sessaoId }, data: { terminalId: t.id } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CAIXA_ABERTO', 'caixa_sessao', n.id, undefined, { terminalId: t.id, fundoTroco: b.fundoTroco });
      return { c: n, reenvio: false };
    }).catch(async (e: unknown) => {
      // corrida (dois abrindo ao mesmo tempo): o índice recusa e a transação aborta; quem ocupa é lido FORA dela
      const t = traduzirErroBanco(e);
      if (t?.code !== 'TERMINAL_OCUPADO' && t?.code !== 'CAIXA_JA_ABERTO') throw e;
      const abertos = await prisma.caixaSessao.findMany({ where: { status: 'ABERTO', OR: [{ terminalId: b.terminalId }, { abertoPorId: u.id }] }, select: { abertoPorId: true, abertoPor: { select: { nome: true } }, terminal: { select: { nome: true } }, terminalId: true } });
      if (abertos.some((x) => x.abertoPorId === u.id)) conflito('CAIXA_JA_ABERTO', 'Você já tem um caixa aberto');
      const outro = abertos.find((x) => x.terminalId === b.terminalId);
      if (outro) terminalOcupado(outro.terminal.nome, outro.abertoPor.nome, !!fixo);
      throw e;
    });
    return reply.code(reenvio ? 200 : 201).send(caixaDto(c, u.nome));
  });

  app.post('/caixas/:id/lancamentos', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ id: zUuid, tipo: z.enum(['SANGRIA', 'SUPRIMENTO']), valor: zMoney.refine((v) => toCents(v) > 0, 'valor maior que zero'), motivo: zTexto(300) }).strict(), req.body);
    await prisma.$transaction(async (tx) => {
      // reenvio idempotente; o mesmo id em outro caixa, com outro tipo, valor ou motivo é outro lançamento: 409 (S6-14).
      // O caixa da URL entra na impressão do pedido.
      const nova = await reservarChave(tx, b.id, 'lancamento', u.id, { caixaId: id, ...b });
      const ja = await tx.caixaLancamento.findUnique({ where: { id: b.id } });
      if (ja) { if (nova && (ja.sessaoId !== id || ja.tipo !== b.tipo || toCents(money(ja.valor)) !== toCents(b.valor))) conflito('ID_EM_USO', 'Identificador já usado'); return; }
      if (!nova) conflito('ID_EM_USO', 'Identificador já usado');
      const c = await meuCaixaAberto(tx, u, id);
      // trava a sessão para duas sangrias simultâneas não passarem do saldo
      await tx.$queryRaw`SELECT id FROM caixa_sessao WHERE id = ${c.id}::uuid FOR UPDATE`;
      if (b.tipo === 'SANGRIA') await registrarSangria(tx, c.id, u.id, toCents(b.valor), b.motivo, b.id);
      else await tx.caixaLancamento.create({ data: { id: b.id, sessaoId: c.id, tipo: 'SUPRIMENTO', valor: b.valor, motivo: b.motivo, usuarioId: u.id } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, b.tipo, 'caixa_sessao', c.id, undefined, { valor: b.valor });
    });
    return reply.code(204).send();
  });

  app.get('/caixas/:id/previa-fechamento', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    await meuCaixaAberto(prisma, u, id);
    return (await calcularPrevia(prisma, id)).dto;
  });

  // Detalhe do caixa (S5-06): totais por forma, suprimentos, sangrias e o dinheiro esperado; o de outro operador só com relatórios
  app.get('/caixas/:id/resumo', { config: { acesso: ['caixa.operar', 'relatorios.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const c = await caixaVisivel(prisma, u, id);
    const operador = await prisma.usuario.findUnique({ where: { id: c.abertoPorId }, select: { nome: true } });
    return { caixa: caixaDto(c, operador?.nome ?? '—'), ...(await calcularPrevia(prisma, id)).dto };
  });

  // Tudo o que aconteceu no caixa, da abertura ao fechamento (ou até agora, se ainda estiver aberto)
  app.get('/caixas/:id/linha-do-tempo', { config: { acesso: ['caixa.operar', 'relatorios.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    await caixaVisivel(prisma, u, id);
    const r = await linhaDoTempo(prisma, id);
    return { gavetaAgora: r.gavetaAgora, eventos: r.eventos };
  });

  // PDF do fechamento (ou da parcial, se o caixa ainda estiver aberto)
  app.get('/caixas/:id/fechamento.pdf', { config: { acesso: ['caixa.operar', 'relatorios.consultar'], rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const c = await caixaVisivel(prisma, u, id);
    const [previa, tempo, inst, operador] = await Promise.all([
      calcularPrevia(prisma, id), linhaDoTempo(prisma, id), prisma.instituicao.findFirst(),
      prisma.usuario.findUnique({ where: { id: c.abertoPorId }, select: { nome: true } }),
    ]);
    const pdf = await gerarPdfFechamento({
      instituicao: { nome: inst?.nome ?? 'Bazar Luz da Esperança', cnpj: inst?.cnpj ?? null },
      terminal: c.terminal.nome, operador: operador?.nome ?? '-', abertoEm: c.abertoEm, fechadoEm: c.fechadoEm, status: c.status,
      fundoTroco: previa.dto.fundoTroco, totaisPorForma: previa.dto.totaisPorForma, suprimentos: previa.dto.suprimentos, sangrias: previa.dto.sangrias,
      esperado: c.status === 'FECHADO' ? money(c.valorEsperado ?? 0) : previa.dto.esperadoDinheiro,
      contado: c.valorContado === null ? null : money(c.valorContado), diferenca: c.diferenca === null ? null : money(c.diferenca),
      observacao: c.observacao, eventos: tempo.eventos, gavetaAgora: tempo.gavetaAgora,
    });
    await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'FECHAMENTO_PDF', 'caixa_sessao', id);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="fechamento-caixa-${id.slice(0, 8)}.pdf"`).send(pdf);
  });

  app.post('/caixas/:id/fechar', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ contado: zMoney, observacao: z.string().trim().max(500).optional() }), req.body);
    const c = await prisma.$transaction(async (tx) => {
      await meuCaixaAberto(tx, u, id);
      await tx.$queryRaw`SELECT id FROM caixa_sessao WHERE id = ${id}::uuid FOR UPDATE`;
      const { esperadoCents } = await calcularPrevia(tx, id);
      const contado = toCents(b.contado);
      const dif = contado - esperadoCents;
      if (dif !== 0 && (b.observacao ?? '').length < 5) {
        throw new AppError(400, 'Diferença de caixa exige observação', 'OBSERVACAO_OBRIGATORIA', `Esperado ${fromCents(esperadoCents)}, contado ${b.contado}`);
      }
      const n = await tx.caixaSessao.update({
        where: { id },
        data: { status: 'FECHADO', fechadoPorId: u.id, fechadoEm: new Date(), valorEsperado: fromCents(esperadoCents), valorContado: fromCents(contado), diferenca: fromCents(dif), observacao: b.observacao || null },
        include: incTerminal,
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CAIXA_FECHADO', 'caixa_sessao', id, undefined, { esperado: fromCents(esperadoCents), contado: b.contado, diferenca: fromCents(dif) });
      return n;
    });
    return caixaDto(c, u.nome);
  });

  // Caixas do dia e fechamentos (S5-06 e S5-09, uma tela só): por período, situação e diferença na conferência
  app.get('/caixas', { config: { acesso: ['relatorios.consultar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({
      operadorId: zUuid.optional(), terminalId: zUuid.optional(),
      status: z.enum(['ABERTO', 'FECHADO']).optional(), comDiferenca: zBoolQuery.optional(),
    }), req.query);
    const where = {
      ...(periodo(q.de, q.ate) ? { abertoEm: periodo(q.de, q.ate) } : {}),
      ...(q.operadorId ? { abertoPorId: q.operadorId } : {}), ...(q.terminalId ? { terminalId: q.terminalId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.comDiferenca ? { status: 'FECHADO' as const, diferenca: { not: 0 } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.caixaSessao.findMany({ where, include: incTerminal, orderBy: { abertoEm: 'desc' }, ...skipTake(q) }),
      prisma.caixaSessao.count({ where }),
    ]);
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.abertoPorId))] } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
    return page(rows.map((r) => caixaDto(r, nomes.get(r.abertoPorId) ?? '—')), q, total);
  });

}
