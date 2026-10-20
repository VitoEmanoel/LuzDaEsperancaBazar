/** Dashboards (S5-07, S5-15, S5-16) e fluxo de caixa (S5-08): sempre por período. */
import { http } from '../../shared/api/http';
import type { FluxoCaixa, FormaPagamento, PainelAdmin, PainelEstoque, PainelFinanceiro } from '../../shared/api/types';

export interface Periodo { de: string; ate: string }

export const painelApi = {
  admin: (p: Periodo & { operadorId?: string; forma?: FormaPagamento }) => http.get<PainelAdmin>('/painel/admin', { query: { ...p } }),
  estoque: (p: Periodo & { categoriaId?: string; parceiroId?: string }) => http.get<PainelEstoque>('/painel/estoque', { query: { ...p } }),
  financeiro: (p: Periodo & { forma?: FormaPagamento }) => http.get<PainelFinanceiro>('/painel/financeiro', { query: { ...p } }),
  fluxoCaixa: (p: Periodo) => http.get<FluxoCaixa>('/financeiro/fluxo-caixa', { query: { ...p } }),
};
