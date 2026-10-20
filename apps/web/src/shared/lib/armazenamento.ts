/**
 * Conveniências locais do navegador, sem dado pessoal: terminal fixo do aparelho e carrinho em andamento.
 * Nunca guarde token, senha ou dados de cliente aqui. Se o navegador bloquear o armazenamento, o sistema
 * continua funcionando, só sem lembrar essas escolhas.
 */
const PREFIXO = 'bazar.';

export const CHAVES = { terminalId: 'terminalId', carrinho: 'carrinho' } as const;

export const armazenamento = {
  ler<T>(chave: string): T | undefined {
    try {
      const bruto = localStorage.getItem(PREFIXO + chave);
      return bruto === null ? undefined : (JSON.parse(bruto) as T);
    } catch { return undefined; }
  },
  gravar(chave: string, valor: unknown): void {
    try { localStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); } catch { /* sem armazenamento: segue sem lembrar */ }
  },
  apagar(chave: string): void {
    try { localStorage.removeItem(PREFIXO + chave); } catch { /* idem */ }
  },
  /**
   * Logout: apaga o que é de quem usava (carrinho). O terminal fixo é do APARELHO, não da pessoa: continua para o próximo turno.
   * Terminal desativado: `incluirTerminal` apaga também a escolha do terminal.
   */
  limparTudo(opts: { incluirTerminal?: boolean } = {}): void {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith(PREFIXO)) continue;
        if (k === PREFIXO + CHAVES.terminalId && !opts.incluirTerminal) continue;
        localStorage.removeItem(k);
      }
    } catch { /* idem */ }
  },
};
