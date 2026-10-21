/** FIN — contas a pagar/receber, recebimentos, extrato e resumo. */
import { http } from '../../shared/api/http';
import type { ContaPagar, ContaReceber, ExtratoCliente, FormaQuitacao, Money, Page, Recebimento, ResumoFinanceiro } from '../../shared/api/types';

export const contasPagarApi = {
  listar: (q: { status?: string; de?: string; ate?: string; page?: number }) => http.get<Page<ContaPagar>>('/contas-pagar', { query: q }),
  criar: (c: { id: string; descricao: string; categoriaDespesaId: string; valor: Money; vencimento: string }) => http.post<ContaPagar>('/contas-pagar', c),
  atualizar: (id: string, patch: Partial<Pick<ContaPagar, 'descricao' | 'valor' | 'vencimento'>>) => http.patch<ContaPagar>(`/contas-pagar/${id}`, patch),
  /**
   * saiuDoCaixa=true gera sangria ligada no caixa aberto do operador e a forma é sempre DINHEIRO (o servidor também força).
   * Fora do caixa, a forma informada é gravada (antes ia sempre como PIX — ticket 1).
   */
  pagar: (id: string, p: { saiuDoCaixa: boolean; formaPagamento: FormaQuitacao }) =>
    http.post<ContaPagar>(`/contas-pagar/${id}/pagar`, p.saiuDoCaixa ? { saiuDoCaixa: true, formaPagamento: 'DINHEIRO' } : p),
  cancelar: (id: string, motivo: string) => http.post<ContaPagar>(`/contas-pagar/${id}/cancelar`, { motivo }),
};

export const contasReceberApi = {
  listar: (q: { status?: string; clienteId?: string; page?: number }) => http.get<Page<ContaReceber>>('/contas-receber', { query: q }),
  lancar: (c: { id: string; clienteId: string; descricao: string; valor: Money; vencimento: string }) => http.post<ContaReceber>('/contas-receber', c),
  /**
   * Sem caixaId = recebimento fora do caixa. `forma` é obrigatória: só DINHEIRO entra no dinheiro esperado do
   * fechamento (ticket 1 — antes o servidor assumia DINHEIRO e o caixa mostrava sobra inexistente).
   */
  receber: (contaId: string, r: { id: string; valor: Money; forma: FormaQuitacao; caixaId?: string }) => http.post<Recebimento>(`/contas-receber/${contaId}/recebimentos`, r),
  estornar: (recebimentoId: string, motivo: string) => http.post<void>(`/recebimentos/${recebimentoId}/estornar`, { motivo }),
  extrato: (clienteId: string) => http.get<ExtratoCliente>(`/clientes/${clienteId}/extrato`),
};

export const financeiroApi = {
  resumo: (de: string, ate: string) => http.get<ResumoFinanceiro>('/financeiro/resumo', { query: { de, ate } }),
  /** O mesmo resumo em PDF (S5-10). */
  resumoPdf: (de: string, ate: string) => http.blob('/financeiro/resumo.pdf', { query: { de, ate } }),
};
