/** CPF: máscara enquanto digita e validação pelos dígitos verificadores (a mesma regra do servidor). */
export const soDigitos = (s: string) => s.replace(/\D/g, '');

export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

/** CPF parcialmente escondido para ficar na tela do caixa: "529.***.***-25". */
export function cpfOculto(s: string): string {
  const d = soDigitos(s);
  return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : '***';
}

/** "52998224725" -> "529.982.247-25" (mesmo parcial: "5299" -> "529.9"). */
export function maskCpf(s: string): string {
  const d = soDigitos(s).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
