/** FIS — regra fiscal versionada por vigência (RN-17): a mais específica vale (item > categoria > geral). */
import type { Db } from '../../shared/prisma.js';
import { fromDbDate, toDbDate } from '../../shared/dates.js';
import { money } from '../../shared/money.js';

const incluirAlvo = { categoria: { select: { nome: true } }, item: { select: { descricao: true, produto: { select: { codigo: true } } } } } as const;

type RegraRow = {
  id: string; escopo: 'GERAL' | 'CATEGORIA' | 'ITEM'; categoriaId: string | null; itemId: string | null;
  situacao: 'ISENTO' | 'TRIBUTADO'; aliquota: { toFixed(n: number): string }; vigenciaInicio: Date; vigenciaFim: Date | null;
  fundamentoLegal?: string | null;
  categoria?: { nome: string } | null; item?: { descricao: string | null; produto: { codigo: string } | null } | null;
};

export const regraDto = (r: RegraRow) => ({
  id: r.id, alvo: r.escopo, alvoId: r.categoriaId ?? r.itemId ?? undefined,
  alvoNome: r.categoria?.nome ?? (r.item ? r.item.produto?.codigo ?? r.item.descricao ?? undefined : undefined),
  situacao: r.situacao, aliquota: money(r.aliquota),
  vigenciaInicio: fromDbDate(r.vigenciaInicio), vigenciaFim: r.vigenciaFim ? fromDbDate(r.vigenciaFim) : undefined,
  fundamentoLegal: r.fundamentoLegal ?? undefined,
});

/** Regras vigentes numa data local "aaaa-mm-dd". */
export async function regrasVigentes(db: Db, dia: string) {
  const d = toDbDate(dia);
  return db.regraFiscal.findMany({
    where: { vigenciaInicio: { lte: d }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: d } }] },
    include: incluirAlvo,
  });
}
export const incluirAlvoRegra = incluirAlvo;

export interface Fiscal { situacao: 'ISENTO' | 'TRIBUTADO'; aliquotaPct: number; regraId: string | null }

export function resolverRegra(regras: RegraRow[], itemId: string, categoriaId: string): Fiscal {
  const r = regras.find((x) => x.escopo === 'ITEM' && x.itemId === itemId)
    ?? regras.find((x) => x.escopo === 'CATEGORIA' && x.categoriaId === categoriaId)
    ?? regras.find((x) => x.escopo === 'GERAL');
  if (!r) return { situacao: 'ISENTO', aliquotaPct: 0, regraId: null };
  return { situacao: r.situacao, aliquotaPct: Number(r.aliquota.toFixed(2)), regraId: r.id };
}
