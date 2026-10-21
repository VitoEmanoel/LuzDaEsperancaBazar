import { createHash } from 'node:crypto';
import type { Tx } from './prisma.js';
import { conflito } from './errors.js';

/** Impressão do pedido: JSON com as chaves em ordem (o mesmo conteúdo dá sempre a mesma impressão). */
export function impressao(corpo: unknown): string {
  const ordenar = (v: unknown): unknown => (Array.isArray(v) ? v.map(ordenar)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(ordenar(corpo) ?? null)).digest('hex');
}

/**
 * Reserva a chave de idempotência dentro da transação. Retorna false se ela já foi usada para ESTA operação
 * (o reenvio: o chamador responde sucesso sem repetir). O mesmo id com outro conteúdo, de outro escopo ou de outro
 * usuário é recusado com 409 ID_EM_USO (S6-14): antes respondia sucesso sem fazer nada, e quem enviou achava que fez.
 */
export async function reservarChave(tx: Tx, chave: string, escopo: string, usuarioId: string, corpo: unknown): Promise<boolean> {
  const hash = impressao(corpo);
  const r = await tx.$executeRaw`INSERT INTO idempotencia (chave, escopo, usuario_id, corpo_hash) VALUES (${chave}::uuid, ${escopo}, ${usuarioId}::uuid, ${hash}) ON CONFLICT (chave) DO NOTHING`;
  if (r === 1) return true;
  const ja = await tx.idempotencia.findUnique({ where: { chave }, select: { escopo: true, usuarioId: true, corpoHash: true } });
  if (ja && (ja.escopo !== escopo || ja.usuarioId !== usuarioId || (ja.corpoHash !== null && ja.corpoHash !== hash))) {
    conflito('ID_EM_USO', 'Este identificador já foi usado em outra operação');
  }
  return false;
}
