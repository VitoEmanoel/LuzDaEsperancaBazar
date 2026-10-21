/**
 * Gráficos dos dashboards (S5-18), feitos no projeto, sem biblioteca: indicador, colunas e barras horizontais.
 * Cores da marca validadas para daltonismo e contraste nos dois temas (tokens --serie-1 a --serie-4 em tokens.css).
 * Regras: um eixo só; legenda a partir de 2 séries; texto nunca na cor da série; dica no mouse e no foco do teclado;
 * a mesma informação sempre numa tabela ("Ver em tabela"), para quem usa leitor de tela ou não distingue as cores.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Serie { nome: string }
export interface Ponto { rotulo: string; /** rótulo curto no eixo (ex.: o dia sem o mês) */ curto?: string; valores: number[] }
type Formato = (n: number) => string;

const COR = (i: number) => `var(--serie-${(i % 4) + 1})`;
export const formatarReais: Formato = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatarNumero: Formato = (n) => n.toLocaleString('pt-BR');
/** Eixo: números redondos e curtos (1 mil, 2,5 mil). */
const compacto = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : n.toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }));

/** Largura disponível do gráfico (acompanha o tamanho da tela). */
function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, largura] as const;
}

/** Topo do eixo: o primeiro número redondo acima do maior valor, com 4 divisões. */
function escala(max: number) {
  if (max <= 0) return { topo: 4, passos: [0, 1, 2, 3, 4] };
  const bruto = max / 4, mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto)!;
  return { topo: passo * 4, passos: [0, 1, 2, 3, 4].map((i) => i * passo) };
}

/** Indicador (número em destaque): rótulo, valor e uma nota opcional; o tom marca estado (com texto, nunca só a cor). */
export function Indicador({ rotulo, valor, nota, tom, to }: { rotulo: string; valor: string; nota?: ReactNode; tom?: 'ok' | 'alerta' | 'erro'; to?: string }) {
  const corpo = <><span className="indicador-rotulo">{rotulo}</span><strong className="indicador-valor">{valor}</strong>{nota && <span className="indicador-nota">{nota}</span>}</>;
  return to ? <Link to={to} className="card indicador" data-tom={tom}>{corpo}</Link> : <div className="card indicador" data-tom={tom}>{corpo}</div>;
}

/** Moldura comum: título, legenda, gráfico e a tabela equivalente. */
function Figura({ titulo, descricao, series, pontos, formato, children, vazio }: {
  titulo: string; descricao?: string; series: Serie[]; pontos: Ponto[]; formato: Formato; children: ReactNode; vazio: boolean;
}) {
  const id = useId();
  return (
    <figure className="card grafico" aria-labelledby={`${id}-t`}>
      <figcaption>
        <h3 id={`${id}-t`}>{titulo}</h3>
        {descricao && <p className="muted">{descricao}</p>}
        {series.length > 1 && (
          <ul className="grafico-legenda">
            {series.map((s, i) => <li key={s.nome}><span className="grafico-chave" style={{ background: COR(i) }} aria-hidden="true" />{s.nome}</li>)}
          </ul>
        )}
      </figcaption>
      {vazio ? <p className="muted grafico-vazio">Nada no período.</p> : children}
      <details className="grafico-tabela">
        <summary>Ver em tabela</summary>
        <div className="tabela-rolavel"><table className="table compact">
          <thead><tr><th scope="col">{titulo}</th>{series.map((s) => <th key={s.nome} scope="col" className="num">{s.nome}</th>)}</tr></thead>
          <tbody>{pontos.map((p) => <tr key={p.rotulo}><th scope="row">{p.rotulo}</th>{p.valores.map((v, i) => <td key={i} className="num">{formato(v)}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </figure>
  );
}

/** Dica que segue o ponto em foco (mouse ou teclado): o valor em destaque, a série depois. */
function Dica({ ponto, series, formato, x, y }: { ponto: Ponto; series: Serie[]; formato: Formato; x: number; y: number }) {
  return (
    <div className="grafico-dica" style={{ left: x, top: y }} role="status">
      <span className="grafico-dica-titulo">{ponto.rotulo}</span>
      {ponto.valores.map((v, i) => (
        <span key={i} className="grafico-dica-linha"><span className="grafico-traco" style={{ background: COR(i) }} aria-hidden="true" /><strong>{formato(v)}</strong> {series[i]?.nome}</span>
      ))}
    </div>
  );
}

const ALTURA = 220, ESQ = 56, DIR = 8, TOPO = 12, BASE = 28;

/** Colunas verticais (ex.: por dia), uma ou mais séries lado a lado, todas sobre o mesmo eixo. */
export function GraficoColunas({ titulo, descricao, series, pontos, formato = formatarNumero }: {
  titulo: string; descricao?: string; series: Serie[]; pontos: Ponto[]; formato?: Formato;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const max = Math.max(0, ...pontos.flatMap((p) => p.valores));
  const { topo, passos } = escala(max);
  const w = Math.max(0, largura - ESQ - DIR), h = ALTURA - TOPO - BASE;
  const banda = pontos.length ? w / pontos.length : 0;
  const larguraBarra = Math.max(2, Math.min(24, (banda * 0.7 - 2 * (series.length - 1)) / series.length));
  const y = (v: number) => TOPO + h - (v / topo) * h;
  // rótulos do eixo X sem encavalar: no máximo um a cada ~48 px
  const cada = Math.max(1, Math.ceil(48 / Math.max(banda, 1)));
  return (
    <Figura titulo={titulo} descricao={descricao} series={series} pontos={pontos} formato={formato} vazio={max === 0}>
      <div ref={ref} className="grafico-area" onPointerLeave={() => setAtivo(null)}>
        {largura > 0 && (
          <svg width={largura} height={ALTURA} role="img" aria-label={`${titulo}: gráfico de colunas; os valores estão em "Ver em tabela"`}>
            {passos.map((p) => (
              <g key={p}>
                <line x1={ESQ} x2={ESQ + w} y1={y(p)} y2={y(p)} className="grafico-grade" />
                <text x={ESQ - 6} y={y(p)} className="grafico-eixo" textAnchor="end" dominantBaseline="middle">{compacto(p)}</text>
              </g>
            ))}
            {pontos.map((p, i) => {
              const x0 = ESQ + i * banda + (banda - (larguraBarra * series.length + 2 * (series.length - 1))) / 2;
              return (
                <g key={p.rotulo} tabIndex={0} aria-label={`${p.rotulo}: ${p.valores.map((v, k) => `${series[k]?.nome} ${formato(v)}`).join(', ')}`}
                  onPointerEnter={() => setAtivo(i)} onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)} className="grafico-grupo" data-ativo={ativo === i || undefined}>
                  <rect x={ESQ + i * banda} y={TOPO} width={banda} height={h} className="grafico-alvo" />
                  {p.valores.map((v, k) => {
                    const alt = Math.max(0, (v / topo) * h), x = x0 + k * (larguraBarra + 2), r = Math.min(4, larguraBarra / 2, alt);
                    // ponta arredondada em cima, reta na base
                    return alt > 0 && <path key={k} fill={COR(k)} d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + larguraBarra - r} Q${x + larguraBarra},${y(v)} ${x + larguraBarra},${y(v) + r} V${y(0)} Z`} />;
                  })}
                  {i % cada === 0 && <text x={ESQ + i * banda + banda / 2} y={ALTURA - 8} className="grafico-eixo" textAnchor="middle">{p.curto ?? p.rotulo}</text>}
                </g>
              );
            })}
            <line x1={ESQ} x2={ESQ + w} y1={y(0)} y2={y(0)} className="grafico-base" />
          </svg>
        )}
        {ativo !== null && pontos[ativo] && (
          <Dica ponto={pontos[ativo]} series={series} formato={formato} x={Math.min(Math.max(ESQ + ativo * banda + banda / 2, 80), Math.max(80, largura - 80))} y={TOPO} />
        )}
      </div>
    </Figura>
  );
}

/** Barras horizontais empilhadas (ex.: por categoria), boas para nomes longos; o total vai na ponta. */
export function GraficoBarras({ titulo, descricao, series, pontos, formato = formatarNumero, limite = 10 }: {
  titulo: string; descricao?: string; series: Serie[]; pontos: Ponto[]; formato?: Formato; limite?: number;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  // as maiores primeiro; o resto vira "Outras" (nunca uma cor nova)
  const ordenados = [...pontos].sort((a, b) => sum(b.valores) - sum(a.valores));
  const mostrados = ordenados.length > limite
    ? [...ordenados.slice(0, limite - 1), { rotulo: `Outras (${ordenados.length - limite + 1})`, valores: series.map((_, k) => ordenados.slice(limite - 1).reduce((s, p) => s + (p.valores[k] ?? 0), 0)) }]
    : ordenados;
  const max = Math.max(0, ...mostrados.map((p) => sum(p.valores)));
  return (
    <Figura titulo={titulo} descricao={descricao} series={series} pontos={pontos} formato={formato} vazio={max === 0}>
      <ul className="grafico-barras" onPointerLeave={() => setAtivo(null)}>
        {mostrados.map((p, i) => (
          <li key={p.rotulo} tabIndex={0} className="grafico-grupo" data-ativo={ativo === i || undefined}
            aria-label={`${p.rotulo}: ${p.valores.map((v, k) => `${series[k]?.nome} ${formato(v)}`).join(', ')}`}
            onPointerEnter={() => setAtivo(i)} onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)}>
            <span className="grafico-barras-rotulo">{p.rotulo}</span>
            <span className="grafico-barras-trilho" aria-hidden="true">
              {p.valores.map((v, k) => v > 0 && <span key={k} className="grafico-barras-seg" style={{ width: `${(v / max) * 100}%`, background: COR(k) }} />)}
            </span>
            <span className="grafico-barras-valor">{formato(sum(p.valores))}</span>
            {ativo === i && series.length > 1 && <Dica ponto={p} series={series} formato={formato} x={0} y={0} />}
          </li>
        ))}
      </ul>
    </Figura>
  );
}

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);
