/**
 * Dados da instituição para o comprovante (RF-CAD-07, RF-PDV-08). Busca `GET /instituicao`.
 * Sem permissão ou com erro, devolve null: o comprovante cai no nome padrão e nunca bloqueia a venda.
 */
import { instituicaoApi } from '../cadastros/cadastros.api';
import type { Instituicao } from '../../shared/api/types';

export async function carregarInstituicao(): Promise<Instituicao | null> {
  try {
    const i = await instituicaoApi.obter();
    return i.nome ? i : null;
  } catch {
    return null;
  }
}
