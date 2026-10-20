/**
 * Reembolso em dinheiro: o Administrador não opera caixa, então devolver dinheiro de um caixa JÁ FECHADO
 * (cancelar venda, estornar recebimento de fiado) vira uma saída paga fora do caixa, na categoria
 * "Reembolso de venda". Aparece no financeiro e no fluxo de caixa; não mexe no fechamento de ninguém.
 */
import type { Db } from '../../shared/prisma.js';
import { fromCents } from '../../shared/money.js';
import { localDate, toDbDate } from '../../shared/dates.js';

export const CATEGORIA_REEMBOLSO_ID = '00000000-0000-4000-8000-0000000000c1';

export async function registrarReembolso(db: Db, usuarioId: string, cents: number, descricao: string) {
  const valor = fromCents(cents);
  return db.contaPagar.create({
    data: {
      descricao: descricao.slice(0, 200), categoriaDespesaId: CATEGORIA_REEMBOLSO_ID,
      valor, vencimento: toDbDate(localDate()), status: 'PAGA', pagoEm: new Date(), valorPago: valor,
      formaPagamento: 'DINHEIRO', criadaPorId: usuarioId,
    },
    select: { id: true },
  });
}
