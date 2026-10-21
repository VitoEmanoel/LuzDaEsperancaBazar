/** Carrinho do PDV. Preços aqui são só para exibição — o servidor recalcula tudo (seção 5). */
import type { CatalogoPdv, VendaItemRequest } from '../../shared/api/types';
import { toCents } from '../../shared/lib/money';

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

/** Quantidade máxima no `n*código`: a mesma do campo Qtd. ao lado do código (S6-10). */
export const MAX_QTD_LEITURA = 999;

/** Campo Qtd. ao lado do código (S6-10): vazio, 0 ou texto viram 1; nunca passa do máximo do `n*`. */
export const quantidadeDoCampo = (texto: string) => Math.max(1, Math.min(MAX_QTD_LEITURA, Number.parseInt(texto, 10) || 1));

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

/**
 * Outro caixa vendeu antes e o servidor recusou a venda por saldo (S6-13): leva o carrinho ao que há no catálogo de agora.
 * Linha de código: o catálogo lista TODO produto com saldo no Bazar, então ausente = esgotou (sai); peça única fica com 1.
 * Linha de categoria (carrinho de antes da S6-09): categoria ausente = "não sei", fica como está e o servidor decide.
 * Linhas repetidas do mesmo produto ou categoria dividem o mesmo saldo (o servidor soma antes de conferir).
 * O preço passa ao de agora, como no PAGAMENTO_DIVERGENTE. `mudancas` vem pronta para o aviso; vazia = nada mudou.
 */
export function ajustarAoEstoque(linhas: LinhaCarrinho[], c: CatalogoPdv): { linhas: LinhaCarrinho[]; mudancas: string[]; precoMudou: boolean } {
  const usado = new Map<string, number>();
  const mudancas: string[] = [];
  let precoMudou = false;
  const novas: LinhaCarrinho[] = [];
  for (const l of linhas) {
    let disponivel: number, preco: string | undefined, chave: string;
    if (l.tipo === 'codigo' && l.codigo) {
      chave = 'p:' + l.codigo.toUpperCase();
      const p = c.itensEtiquetados.find((i) => i.codigo.toUpperCase() === l.codigo!.toUpperCase());
      disponivel = !p ? 0 : p.pecaUnica !== false ? 1 : (p.saldoBazar ?? 1);
      preco = p?.preco;
    } else {
      chave = 'c:' + l.categoriaId;
      const cat = c.categorias.find((x) => x.id === l.categoriaId);
      if (!cat) { novas.push(l); continue; }
      disponivel = cat.saldoBazar;
      preco = cat.precoPadrao;
    }
    const resta = Math.max(0, disponivel - (usado.get(chave) ?? 0));
    const qtd = Math.min(l.quantidade, resta);
    usado.set(chave, (usado.get(chave) ?? 0) + qtd);
    if (qtd === 0) { mudancas.push(`${l.descricao} saiu`); continue; }
    if (qtd < l.quantidade) mudancas.push(`${l.descricao} ${l.quantidade} → ${qtd}`);
    const precoCents = preco ? toCents(preco) : l.precoCents;
    if (precoCents !== l.precoCents) precoMudou = true;
    novas.push(qtd === l.quantidade && precoCents === l.precoCents ? l : { ...l, quantidade: qtd, precoCents });
  }
  return { linhas: novas, mudancas, precoMudou };
}
