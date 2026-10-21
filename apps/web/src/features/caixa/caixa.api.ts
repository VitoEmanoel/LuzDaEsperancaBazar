/** CXA — terminais e sessões de caixa. */
import { http } from '../../shared/api/http';
import type { CaixaLancamentoRequest, CaixaSessao, LinhaDoTempo, Money, Page, PreviaFechamento, Terminal } from '../../shared/api/types';

export const terminaisApi = {
  listar: (q: { ativo?: boolean } = {}) => http.get<Terminal[]>('/terminais', { query: q }),
  criar: (t: { id: string; nome: string }) => http.post<Terminal>('/terminais', t),
  atualizar: (id: string, patch: Partial<Pick<Terminal, 'nome' | 'ativo'>>) => http.patch<Terminal>(`/terminais/${id}`, patch),
};

export const caixaApi = {
  /** 404 = nenhum caixa aberto para este operador/terminal. */
  atual: () => http.get<CaixaSessao>('/caixas/atual'),
  abrir: (c: { id: string; terminalId: string; fundoTroco: Money }) => http.post<CaixaSessao>('/caixas', c),
  lancar: (caixaId: string, l: CaixaLancamentoRequest) => http.post<void>(`/caixas/${caixaId}/lancamentos`, l),
  previaFechamento: (caixaId: string) => http.get<PreviaFechamento>(`/caixas/${caixaId}/previa-fechamento`),
  fechar: (caixaId: string, contado: Money, observacao?: string) => http.post<CaixaSessao>(`/caixas/${caixaId}/fechar`, { contado, observacao }),
  /** Tudo o que aconteceu no caixa, da abertura ao fechamento (ou até agora). */
  linhaDoTempo: (caixaId: string) => http.get<LinhaDoTempo>(`/caixas/${caixaId}/linha-do-tempo`),
  /** PDF do fechamento (ou da parcial, se o caixa ainda estiver aberto). */
  pdfFechamento: (caixaId: string) => http.blob(`/caixas/${caixaId}/fechamento.pdf`),
  /** Caixas do dia e fechamentos (Admin e Financeiro, S5-06): por período, situação e diferença. */
  historico: (q: { de?: string; ate?: string; page?: number; status?: 'ABERTO' | 'FECHADO'; comDiferenca?: boolean }) => http.get<Page<CaixaSessao>>('/caixas', { query: q }),
  /** Detalhe de um caixa: totais por forma e o dinheiro esperado (o de outro operador só com relatórios). */
  resumo: (caixaId: string) => http.get<PreviaFechamento & { caixa: CaixaSessao }>(`/caixas/${caixaId}/resumo`),
};
