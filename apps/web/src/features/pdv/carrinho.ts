/** Carrinho do PDV. Preços aqui são só para exibição — o servidor recalcula tudo (seção 5). */
import type { VendaItemRequest } from '../../shared/api/types';

export interface LinhaCarrinho {
  key: string;
  tipo: 'codigo' | 'categoria';
  codigo?: string;
  categoriaId?: string;
  descricao: string;
  precoCents: number;
  quantidade: number;
}

export const subtotalCents = (linhas: LinhaCarrinho[]) => linhas.reduce((s, l) => s + l.precoCents * l.quantidade, 0);

export function paraItensRequest(linhas: LinhaCarrinho[]): VendaItemRequest[] {
  return linhas.map((l) => (l.tipo === 'codigo'
    ? { codigo: l.codigo!, quantidade: l.quantidade }
    : { categoriaId: l.categoriaId!, quantidade: l.quantidade }));
}

/** Quantidade máxima no `n*código`: a mesma do campo Qtd. da venda por categoria. */
export const MAX_QTD_LEITURA = 999;

/**
 * O que veio do leitor ou do teclado (S4-09): `código` ou `n*código` (espaços em volta do * valem).
 * O leitor só manda o código; o `n*` o operador digita antes de bipar. Nada aqui consulta estoque: só lê o texto.
 */
export function lerEntrada(texto: string): { quantidade: number; codigo: string } | { erro: string } {
  const t = texto.trim().toUpperCase();
  const m = /^([^*]*)\*(.*)$/.exec(t);
  if (!m) return { quantidade: 1, codigo: t };
  const n = m[1]!.trim(), codigo = m[2]!.trim();
  if (!/^\d+$/.test(n)) return { erro: 'Antes do * vem a quantidade, por exemplo 3*BZ000123.' };
  if (!codigo || codigo.includes('*')) return { erro: 'Depois do * vem o código, por exemplo 3*BZ000123.' };
  const quantidade = Number(n);
  if (quantidade < 1 || quantidade > MAX_QTD_LEITURA) return { erro: `A quantidade vai de 1 a ${MAX_QTD_LEITURA}.` };
  return { quantidade, codigo };
}
