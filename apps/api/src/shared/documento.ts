/**
 * CPF/CNPJ — validação de dígito verificador (módulo 11), RF-CAD-02 cenário 2.
 * Recebe só dígitos. Sequências repetidas (11111111111, 00000000000000…) são recusadas:
 * passam no cálculo, mas não existem.
 */
const repetido = (d: string) => /^(\d)\1+$/.test(d);

function digito(base: string, pesos: number[]): number {
  const soma = pesos.reduce((s, p, i) => s + Number(base[i]) * p, 0);
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || repetido(cpf)) return false;
  const d1 = digito(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || repetido(cnpj)) return false;
  const d1 = digito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** CPF (11 dígitos) ou CNPJ (14 dígitos) válido. */
export const documentoValido = (doc: string): boolean => (doc.length === 11 ? cpfValido(doc) : doc.length === 14 ? cnpjValido(doc) : false);
