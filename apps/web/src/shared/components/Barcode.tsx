import type { CSSProperties } from 'react';
import { code128Svg } from '../lib/barcode';

/** Código de barras Code 128 renderizado como SVG (gerado localmente, sem HTML externo); o tamanho vem de quem usa. */
export function Barcode({ value, style }: { value: string; style?: CSSProperties }) {
  let svg = '';
  try { svg = code128Svg(value); } catch { return <code>{value}</code>; }
  // svg vem exclusivamente do nosso gerador (só <rect> e atributos numéricos) — seguro para injetar.
  return <span className="barcode" style={style} dangerouslySetInnerHTML={{ __html: svg }} />;
}
