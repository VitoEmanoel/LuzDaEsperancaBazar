/** Atalho para a tela Imprimir etiquetas já com os produtos escolhidos (S4-04): `?produtos=id:quantidade,...`. */
export function caminhoEtiquetas(itens: { produtoId: string; quantidade: number }[]): string {
  const somado = new Map<string, number>();
  for (const i of itens) somado.set(i.produtoId, (somado.get(i.produtoId) ?? 0) + Math.max(1, i.quantidade));
  // até 999 por produto (o que a tela lê); acima de 500 no total a tela abre e avisa do teto
  return `/estoque/etiquetas?produtos=${[...somado].map(([id, q]) => `${id}:${Math.min(999, q)}`).join(',')}`;
}

/**
 * Lê o `?produtos=` da tela: ignora o que não for id:quantidade, soma o id repetido e fica nos 200 produtos que a API aceita.
 * O id não precisa ser UUID aqui (a demonstração usa outro formato): quem confere é a API.
 */
export function lerPedidoDaUrl(valor: string | null): { produtoId: string; quantidade: number }[] {
  if (!valor) return [];
  const somado = new Map<string, number>();
  for (const [id, q] of valor.split(',').map((par) => par.split(':'))) {
    if (!/^[\w-]{1,64}$/.test(id ?? '') || !/^\d{1,3}$/.test(q ?? '')) continue;
    somado.set(id!, (somado.get(id!) ?? 0) + Math.max(1, Number(q)));
  }
  return [...somado].slice(0, 200).map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
}

/** Módulo mínimo (barra mais fina) que um leitor 1D comum lê com segurança, em mm. */
export const MODULO_MINIMO_MM = 0.19;
