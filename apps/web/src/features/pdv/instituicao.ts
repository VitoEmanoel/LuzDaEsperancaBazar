/**
 * Dados da instituição para o comprovante (RF-CAD-07, RF-PDV-08 — ticket 2).
 * Online: busca `GET /instituicao` e guarda cópia no IndexedDB (dado institucional, sem PII — RNF-19).
 * Offline ou sem permissão: usa a cópia guardada. Nunca bloqueia a venda.
 */
import { instituicaoApi } from '../cadastros/cadastros.api';
import type { Instituicao } from '../../shared/api/types';
import { idb, KV } from '../../shared/offline/idb';
import { isOnline } from '../../shared/lib/connectivity';

export async function carregarInstituicao(): Promise<Instituicao | null> {
  const local = (await idb.get<Instituicao>('kv', KV.instituicao).catch(() => undefined)) ?? null;
  if (!isOnline()) return local;
  try {
    const i = await instituicaoApi.obter();
    if (i.nome) { await idb.put('kv', i, KV.instituicao); return i; }
    return local;
  } catch {
    return local; // sem rede ou sem permissão (403): segue com a cópia local
  }
}
