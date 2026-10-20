/**
 * CPF na venda (decisão do humano, 19/10/2026):
 *  - o CPF aparece só no comprovante e fica guardado na tabela `venda_cpf` até o fim do mês; depois é apagado;
 *  - o Administrador define, em Parâmetros, o limite de compras por CPF no mês (em reais; 0 = sem limite)
 *    e se o CPF é obrigatório na venda;
 *  - o saldo do CPF = limite − o que ele comprou no mês (venda cancelada devolve o saldo).
 * O CPF nunca vai na URL (rotas POST), nunca entra na auditoria e é validado pelos dígitos.
 */
import type { Db } from '../../shared/prisma.js';
import { cpfValido } from '../../shared/documento.js';
import { localDate, inicioDoDia } from '../../shared/dates.js';
import { fromCents, toCents } from '../../shared/money.js';
import { paramNum } from '../../shared/parametros.js';

/** Só dígitos, e só se for um CPF válido (dígitos verificadores). */
export function normalizarCpf(bruto: string): string | null {
  const d = bruto.replace(/\D/g, '');
  return d.length === 11 && cpfValido(d) ? d : null;
}

/** Primeiro instante do mês corrente em America/Fortaleza. */
export const inicioDoMes = () => inicioDoDia(`${localDate().slice(0, 7)}-01`);

/** Apaga os CPFs de meses anteriores. Roda no primeiro uso do mês, sem depender de agendador (e também no script de manutenção). */
export async function limparCpfsVencidos(db: Db) {
  await db.vendaCpf.deleteMany({ where: { criadoEm: { lt: inicioDoMes() } } });
}

export async function configCpf(db: Db) {
  const [limite, obrigatorio] = await Promise.all([paramNum(db, 'cpf.limite_mensal', 0), paramNum(db, 'cpf.obrigatorio', 0)]);
  return { limiteCents: limite > 0 ? Math.round(limite * 100) : 0, obrigatorio: obrigatorio === 1 };
}

/** Quanto o CPF já comprou neste mês (só venda finalizada: a cancelada devolve o saldo). */
export async function compradoNoMes(db: Db, cpf: string): Promise<number> {
  const r = await db.$queryRaw<{ total: string }[]>`
    SELECT coalesce(sum(v.total), 0)::text AS total
    FROM venda v JOIN venda_cpf c ON c.venda_id = v.id
    WHERE c.cpf = ${cpf} AND v.status = 'FINALIZADA' AND c.criado_em >= ${inicioDoMes()}`;
  return toCents(Number(r[0]?.total ?? 0).toFixed(2));
}

export async function saldoDoCpf(db: Db, cpf: string) {
  const [cfg, compradoCents] = await Promise.all([configCpf(db), compradoNoMes(db, cpf)]);
  const limitado = cfg.limiteCents > 0;
  return {
    limite: limitado ? fromCents(cfg.limiteCents) : null,
    comprado: fromCents(compradoCents),
    saldo: limitado ? fromCents(Math.max(0, cfg.limiteCents - compradoCents)) : null,
    obrigatorio: cfg.obrigatorio,
  };
}
