/** REL — relatórios (JSON para tela; PDF/CSV/XLSX para download) e FIS — regras fiscais. */
import { http } from '../../shared/api/http';
import type { RegraFiscal, RelatorioResposta, TipoRelatorio } from '../../shared/api/types';

export type FormatoExportacao = 'pdf' | 'csv' | 'xlsx';
export type AgrupamentoVendas = 'dia' | 'forma' | 'categoria' | 'operador';
export type FiltroRelatorio = {
  de: string; ate: string; modo?: 'parceiro' | 'campanha'; local?: string;
  /** Vendas: dia|forma|categoria|operador (RF-REL-02). Descartes: motivo (RF-REL-04). Vazio = lista detalhada. */
  agrupar?: AgrupamentoVendas | 'motivo';
  /** Descartes: filtra pelo parceiro e/ou campanha do lote (RF-REL-04 cenário 1). */
  parceiroId?: string; campanhaId?: string;
};

export const relatoriosApi = {
  consultar: (tipo: TipoRelatorio, f: FiltroRelatorio) =>
    http.get<RelatorioResposta>(`/relatorios/${tipo}`, { query: { ...f, formato: 'json' } }),
  exportar: (tipo: TipoRelatorio, f: FiltroRelatorio, formato: FormatoExportacao) =>
    http.blob(`/relatorios/${tipo}`, { query: { ...f, formato } }),
};

export const regrasFiscaisApi = {
  listar: () => http.get<RegraFiscal[]>('/regras-fiscais'),
  /** Nova regra encerra a anterior do mesmo alvo (servidor). */
  criar: (r: Omit<RegraFiscal, 'vigenciaFim' | 'alvoNome'>) => http.post<RegraFiscal>('/regras-fiscais', r),
};
