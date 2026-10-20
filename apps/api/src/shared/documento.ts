/**
 * CPF/CNPJ — validação de dígito verificador (módulo 11), RF-CAD-02 cenário 2.
 * Recebe o documento normalizado (sem pontuação, em maiúsculas). Sequências repetidas (11111111111, 00000000000000…)
 * são recusadas: passam no cálculo, mas não existem.
 * CNPJ alfanumérico (IN RFB 2.229/2024, ticket 13): 12 caracteres de 0-9 ou A-Z e 2 dígitos verificadores;
 * cada caractere vale o código ASCII menos 48 (o dígito vale ele mesmo, A vale 17) e os pesos não mudam.
 */
const repetido = (d: string) => /^(.)\1+$/.test(d);

/** Tira pontos, barras, traços e espaços e passa para maiúsculas (o CNPJ de 2026 tem letras). */
export const normalizarDocumento = (doc: string) => doc.toUpperCase().replace(/[^0-9A-Z]/g, '');

function digito(base: string, pesos: number[]): number {
  const soma = pesos.reduce((s, p, i) => s + (base.charCodeAt(i) - 48) * p, 0);
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
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || repetido(cnpj)) return false;
  const d1 = digito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** CPF (11 dígitos) ou CNPJ (14 caracteres, com ou sem letras) válido. */
export const documentoValido = (doc: string): boolean => (doc.length === 11 ? cpfValido(doc) : doc.length === 14 ? cnpjValido(doc) : false);
