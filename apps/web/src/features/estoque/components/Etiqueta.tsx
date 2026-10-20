/** Uma etiqueta no tamanho do rolo (S4-02): título curto, código de barras Code 128, código legível e preço normal (P-18). */
import type { CSSProperties } from 'react';
import { Barcode } from '../../../shared/components/Barcode';
import { modulosCode128 } from '../../../shared/lib/barcode';
import { formatMoney, toCents } from '../../../shared/lib/money';
import type { EtiquetaProduto, TamanhoRolo } from '../../../shared/api/types';

/** Margem branca de cada lado, em mm (o código já leva a zona de silêncio dele). */
const MARGEM_MM = 2;
/** Barra mais fina que vale a pena: acima disso o código só fica mais largo, sem ler melhor. */
const MODULO_MAXIMO_MM = 0.5;

/** Largura do módulo (barra mais fina) que cabe na etiqueta, em mm. */
export const moduloNaEtiqueta = (codigo: string, larguraMm: number) =>
  Math.min(MODULO_MAXIMO_MM, (larguraMm - 2 * MARGEM_MM) / modulosCode128(codigo));

/** Escala das letras: 1 no rolo padrão (50 x 30 mm), menor no rolo pequeno e maior no grande, sem o texto sair da etiqueta. */
const escala = (r: TamanhoRolo) => Math.min(1.8, Math.max(0.6, Math.min(r.larguraMm / 50, r.alturaMm / 30)));

export function Etiqueta({ e, rolo }: { e: Pick<EtiquetaProduto, 'codigo' | 'titulo' | 'preco'>; rolo: TamanhoRolo }) {
  const larguraCodigo = moduloNaEtiqueta(e.codigo, rolo.larguraMm) * modulosCode128(e.codigo);
  const estilo = {
    width: `${rolo.larguraMm}mm`, height: `${rolo.alturaMm}mm`, padding: `1.2mm ${MARGEM_MM}mm`,
    '--etq-k': escala(rolo), '--etq-linhas': rolo.alturaMm < 25 ? 1 : 2, // rolo baixo: o título fica numa linha só
  } as CSSProperties;
  return (
    <div className="etiqueta" style={estilo}>
      <div className="etq-titulo">{e.titulo}</div>
      <Barcode value={e.codigo} style={{ width: `${larguraCodigo}mm` }} />
      <div className="etq-rodape"><span className="etq-codigo">{e.codigo}</span><strong className="etq-preco">{formatMoney(toCents(e.preco))}</strong></div>
    </div>
  );
}
