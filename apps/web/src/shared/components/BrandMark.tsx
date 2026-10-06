/**
 * Marca do sistema: flor de cinco pétalas nas cores de acento do brandbook (slide 09)
 * — cada pétala é uma frente de atuação — + nome em Lora. Forma simples e orgânica, como pede
 * a direção de arte (slide 11). Não substitui o logotipo oficial da instituição.
 * Cores via CSS (styles/components.css): o miolo herda `--flor-miolo` do contexto.
 */
export function FlorMarca({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <svg className="flor" width={tamanho} height={tamanho} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse key={i} className={`petala-${i + 1}`} cx="24" cy="13" rx="7" ry="10" transform={`rotate(${i * 72} 24 24)`} />
      ))}
      <circle className="miolo" cx="24" cy="24" r="6.5" />
    </svg>
  );
}

export function BrandMark({ subtitulo = 'Bazar beneficente', tamanho = 40 }: { subtitulo?: string; tamanho?: number }) {
  return (
    <span className="brandmark">
      <FlorMarca tamanho={tamanho} />
      <span className="brandmark-texto">
        <span className="brandmark-nome">Luz da Esperança</span>
        {subtitulo && <span className="brandmark-sub">{subtitulo}</span>}
      </span>
    </span>
  );
}

/** Os cinco pontos coloridos da capa do brandbook (slide 01). Decorativo. */
export function PontosMarca() {
  return <span className="pontos-marca" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i key={i} />)}</span>;
}
