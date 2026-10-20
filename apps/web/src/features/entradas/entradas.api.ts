/** ENT/TRI — lotes de entrada, cadastro dos produtos do lote e aprovação. */
import { http } from '../../shared/api/http';
import type { CorrecaoItemRequest, ItemAprovacao, ItemLote, LoteDetalhe, LoteEntrada, NovoLoteRequest, Page, ProdutoBusca, TriagemDescarteRequest, TriagemItemRequest } from '../../shared/api/types';

export const lotesApi = {
  listar: (q: { parceiroId?: string; campanhaId?: string; status?: string; de?: string; ate?: string; page?: number }) =>
    http.get<Page<LoteEntrada>>('/lotes', { query: q }),
  obter: (id: string) => http.get<LoteDetalhe>(`/lotes/${id}`),
  criar: (l: NovoLoteRequest) => http.post<LoteEntrada>('/lotes', l),
  enviarDocumento: (id: string, arquivo: File) => {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    return http.upload<void>(`/lotes/${id}/documento`, fd);
  },
  baixarDocumento: (id: string) => http.blob(`/lotes/${id}/documento`),
  /** Cadastra o item no lote: fica "cadastrado", sem estoque, até o Administrador aprovar (Sprint 2). */
  cadastrarItem: (loteId: string, item: TriagemItemRequest) => http.post<ItemLote>(`/lotes/${loteId}/itens`, item),
  corrigirItem: (loteId: string, itemId: string, c: CorrecaoItemRequest) => http.patch<ItemLote>(`/lotes/${loteId}/itens/${itemId}`, c),
  aprovarItem: (itemId: string) => http.post<ItemLote>(`/itens/${itemId}/aprovar`),
  devolverItem: (itemId: string, motivo: string) => http.post<ItemLote>(`/itens/${itemId}/devolver`, { motivo }),
  /** Aprova o que falta no lote; fora do Administrador, os itens da própria pessoa ficam para outra conferir (S3-22). */
  aprovarLote: (id: string) => http.post<LoteEntrada & { aprovadosAgora: number; deixadosParaOutraPessoa?: number }>(`/lotes/${id}/aprovar`),
  /** Fila de aprovação (S3-01): o que espera conferência (ou foi devolvido), de todos os lotes. */
  aprovacoes: (status: 'CADASTRADO' | 'DEVOLVIDO' = 'CADASTRADO') => http.get<ItemAprovacao[]>('/aprovacoes', { query: { status } }),
  buscarProdutos: (busca: string) => http.get<Page<ProdutoBusca>>('/produtos', { query: { busca, pageSize: 10 } }),
  descartar: (loteId: string, d: TriagemDescarteRequest) => http.post<LoteDetalhe['descartes'][number]>(`/lotes/${loteId}/descartes`, d),
  encerrar: (id: string) => http.post<LoteEntrada>(`/lotes/${id}/encerrar`),
  reabrir: (id: string, motivo: string) => http.post<LoteEntrada>(`/lotes/${id}/reabrir`, { motivo }),
  reverterDescarte: (descarteId: string, motivo: string) => http.post<void>(`/descartes/${descarteId}/reverter`, { motivo }),
};
