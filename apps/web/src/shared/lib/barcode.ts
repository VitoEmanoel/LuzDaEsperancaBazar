/**
 * Gerador de código de barras Code 128 em SVG (sem dependência externa), lido por qualquer leitor 1D (P-01).
 * Usa o conjunto B (letras e números) e troca para o C (pares de dígitos) em sequências de 4 dígitos ou mais:
 * "BZ000123" fica com 101 módulos (o B puro daria 123). As etiquetas antigas em Code 39 têm o mesmo texto e
 * continuam sendo lidas.
 * Cada símbolo tem 3 barras e 3 espaços (largura em módulos); a parada tem uma barra a mais.
 */
const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const PARADA = '2331112';
const CODIGO_C = 99, CODIGO_B = 100, INICIO_B = 104, INICIO_C = 105;
/** Zona de silêncio de cada lado, em módulos (o leitor precisa de margem branca). */
export const ZONA_SILENCIO = 10;

const digitosAPartir = (s: string, i: number) => { let j = i; while (j < s.length && s[j]! >= '0' && s[j]! <= '9') j++; return j - i; };

/** Valores dos símbolos (início, dados e verificador), sem a parada. */
export function code128Valores(texto: string): number[] {
  if (!texto) throw new Error('Código vazio');
  const v: number[] = [];
  let conjunto: 'B' | 'C';
  const inicial = digitosAPartir(texto, 0);
  if (inicial >= 4 && inicial % 2 === 0) { conjunto = 'C'; v.push(INICIO_C); } else { conjunto = 'B'; v.push(INICIO_B); }
  let i = 0;
  while (i < texto.length) {
    if (conjunto === 'C') {
      if (digitosAPartir(texto, i) >= 2) { v.push(Number(texto.slice(i, i + 2))); i += 2; continue; }
      v.push(CODIGO_B); conjunto = 'B';
    }
    const n = digitosAPartir(texto, i);
    if (n >= 4) {
      if (n % 2 === 1) { v.push(texto.charCodeAt(i) - 32); i++; } // o dígito que sobra vai no B; o resto, em pares
      v.push(CODIGO_C); conjunto = 'C'; continue;
    }
    const c = texto.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error(`Caractere não suportado no Code 128: ${texto[i]}`);
    v.push(c - 32); i++;
  }
  v.push(v.reduce((s, x, k) => s + (k === 0 ? x : x * k), 0) % 103);
  return v;
}

/** Largura do código em módulos, com as zonas de silêncio. */
export const modulosCode128 = (texto: string) => code128Valores(texto).length * 11 + 13 + 2 * ZONA_SILENCIO;

/** SVG em módulos (viewBox): quem usa escolhe o tamanho em mm, e as barras esticam sem perder a proporção. */
export function code128Svg(texto: string): string {
  const larguras = [...code128Valores(texto).map((x) => PADROES[x]!), PARADA].join('');
  let x = ZONA_SILENCIO;
  const rects: string[] = [];
  [...larguras].forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="1"/>`);
    x += Number(w);
  });
  const total = x + ZONA_SILENCIO;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${texto.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}">${rects.join('')}</svg>`;
}
