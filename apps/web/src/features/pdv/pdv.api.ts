/** PDV — catálogo, vendas e cancelamento. */
import { http } from '../../shared/api/http';
import type { CatalogoPdv, Page, Venda, VendaRequest } from '../../shared/api/types';

export const pdvApi = {
  catalogo: () => http.get<CatalogoPdv>('/pdv/catalogo'),
  /** Idempotente: reenviar o mesmo id devolve a venda já gravada. */
  registrarVenda: (id: string, v: VendaRequest) => http.put<Venda>(`/vendas/${id}`, v),
  listarVendas: (q: { de?: string; ate?: string; caixaId?: string; page?: number }) => http.get<Page<Venda>>('/vendas', { query: q }),
  comprovante: (id: string) => http.get<Venda>(`/vendas/${id}/comprovante`),
  cancelar: (id: string, motivo: string) => http.post<Venda>(`/vendas/${id}/cancelar`, { motivo }),
};
