/** EST — estoque (saldo sempre vem de vw_saldo_estoque no servidor). */
import { http } from '../../shared/api/http';
import type { AjusteRequest, BaixaRequest, CamposProduto, CargaInicialResultado, HistoricoEvento, ItemEstoque, LocalEstoque, LocalDate, Money, Page, ProdutoDetalhe, TipoDesconto, TransferenciaRequest } from '../../shared/api/types';

export const estoqueApi = {
  listar: (q: { local?: LocalEstoque; categoriaId?: string; parceiroId?: string; campanhaId?: string; loteId?: string; busca?: string; page?: number }) =>
    http.get<Page<ItemEstoque>>('/estoque', { query: q }),
  historico: (itemId: string) => http.get<{ item: ItemEstoque; eventos: HistoricoEvento[] }>(`/itens/${itemId}/historico`),
  porCodigo: (codigo: string) => http.get<ItemEstoque>(`/itens/codigo/${encodeURIComponent(codigo)}`),
  transferir: (t: TransferenciaRequest) => http.post<void>('/transferencias', t),
  baixa: (b: BaixaRequest) => http.post<void>('/baixas', b),
  ajuste: (a: AjusteRequest) => http.post<void>('/ajustes', a),
  precoItem: (itemId: string, preco: Money, motivo: string) => http.patch<void>(`/itens/${itemId}/preco`, { preco, motivo }),
  precoCategoria: (categoriaId: string, preco: Money, motivo: string) => http.patch<void>(`/categorias/${categoriaId}/preco`, { preco, motivo }),
  // ---------- produto (S3-04, S3-08, S3-09) ----------
  produto: (id: string) => http.get<ProdutoDetalhe>(`/produtos/${id}`),
  editarProduto: (id: string, campos: Partial<Omit<CamposProduto, 'preco' | 'pecaUnica'>>) => http.patch<void>(`/produtos/${id}`, campos),
  precoProduto: (id: string, preco: Money, motivo: string) => http.patch<void>(`/produtos/${id}/preco`, { preco, motivo }),
  darDesconto: (id: string, d: { tipo: TipoDesconto; valor: Money; ate?: LocalDate; motivo: string }) => http.put<{ ok: true }>(`/produtos/${id}/desconto`, d),
  encerrarDesconto: (id: string, motivo: string) => http.post<void>(`/produtos/${id}/desconto/encerrar`, { motivo }),
  cargaInicial: (arquivo: File) => {
    const fd = new FormData(); fd.append('arquivo', arquivo);
    return http.upload<CargaInicialResultado>('/carga-inicial', fd);
  },
};
