/** Peças pequenas de UI reutilizadas em todas as telas. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { formatMoney, type Money } from '../lib/money';

export function Field({ label, children, hint, erro }: { label: string; children: ReactNode; hint?: string; erro?: string | null }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
      {erro && <small className="field-error" role="alert">{erro}</small>}
    </label>
  );
}

/**
 * Campo de senha com rótulo e botão para mostrar o que foi digitado (conferir a senha, principalmente no celular).
 * O rótulo é ligado ao campo pelo id e o botão fica FORA dele: o leitor de tela lê só "Senha" (S4-20),
 * e não "Senha Mostrar a senha" como quando o botão ficava dentro do <label> do Field.
 */
export function CampoSenha({ label, hint, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { label: string; hint?: string }) {
  const [ver, setVer] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label className="field-rotulo" htmlFor={id}>{label}</label>
      <span className="campo-senha">
        <input {...props} id={id} type={ver ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          aria-describedby={[props['aria-describedby'], hint && `${id}-dica`].filter(Boolean).join(' ') || undefined} />
        {/* o nome muda (Mostrar/Esconder) e já diz o estado: sem aria-pressed, que pede nome fixo */}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVer(!ver)} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'}>
          {ver ? 'Esconder' : 'Mostrar'}
        </button>
      </span>
      {hint && <small className="hint" id={`${id}-dica`}>{hint}</small>}
    </div>
  );
}

export function ErrorAlert({ erro }: { erro: string | null | undefined }) {
  return erro ? <div className="alert alert-error" role="alert">{erro}</div> : null;
}

export function PageHeader({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{titulo}</h1><div className="actions">{children}</div></div>;
}

type ModoTabela = 'tabela' | 'sem-sec' | 'cartoes';
const CLASSE_MODO: Record<ModoTabela, string> = { tabela: 'tabela-rolavel', 'sem-sec': 'tabela-rolavel tabela-sem-sec', cartoes: 'tabela-rolavel tabela-cartoes' };

/**
 * Tabela larga, sem empurrar a página para além do cabeçalho. A caixa escolhe o formato pelo espaço que tem (S6-12):
 * cabe inteira → tabela; não cabe → some as colunas secundárias (`col-sec` no th e no td); ainda não cabe e a tela
 * tem até 1100 px → fichas; acima disso, rola para o lado. No celular, a de 5 colunas ou mais é sempre ficha.
 * Na ficha, cada célula leva o título da sua coluna (data-rotulo), e os papéis (role) mantêm a tabela para o leitor de tela.
 */
export function TabelaRolavel({ children }: { children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const colunas = useRef(0);
  const [modo, setModo] = useState<ModoTabela>('tabela');
  /** Mede do zero (cada formato é testado na própria caixa, antes da pintura), então o resultado não depende do formato atual. */
  const medir = () => {
    const box = caixa.current, tabela = box?.querySelector('table');
    if (!box || !tabela) return;
    const cabe = (m: ModoTabela) => { box.className = CLASSE_MODO[m]; return tabela.offsetWidth <= box.clientWidth + 1; };
    const muitas = colunas.current >= 5;
    const novo: ModoTabela = muitas && window.matchMedia('(max-width: 600px)').matches ? 'cartoes'
      : cabe('tabela') ? 'tabela'
      : cabe('sem-sec') || !muitas || !window.matchMedia('(max-width: 1100px)').matches ? 'sem-sec'
      : 'cartoes';
    box.className = CLASSE_MODO[novo];
    setModo(novo);
  };
  useLayoutEffect(() => {
    // roda a cada render: linhas novas também recebem os rótulos
    const tabela = caixa.current?.querySelector('table');
    if (!tabela) return;
    const rotulos: string[] = [];
    for (const th of tabela.querySelectorAll('thead tr:first-child th')) {
      for (let k = 0; k < (th as HTMLTableCellElement).colSpan; k++) rotulos.push(th.textContent?.trim() ?? '');
    }
    tabela.setAttribute('role', 'table');
    for (const g of tabela.querySelectorAll('thead, tbody, tfoot')) g.setAttribute('role', 'rowgroup');
    for (const tr of tabela.querySelectorAll('tr')) {
      tr.setAttribute('role', 'row');
      let col = 0;
      for (const cel of tr.children) {
        if (cel.tagName === 'TH') cel.setAttribute('role', 'columnheader');
        else {
          cel.setAttribute('role', 'cell');
          // a 1ª célula do rodapé é o "Total": sem o título da coluna
          cel.setAttribute('data-rotulo', tr.parentElement?.tagName === 'TFOOT' && col === 0 ? '' : rotulos[col] ?? '');
        }
        col += (cel as HTMLTableCellElement).colSpan;
      }
    }
    colunas.current = rotulos.length;
    medir();
  });
  // a largura da caixa muda com a janela, o menu lateral e o giro do celular
  useEffect(() => {
    const box = caixa.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let largura = box.clientWidth;
    const ro = new ResizeObserver(() => { if (box.clientWidth !== largura) { largura = box.clientWidth; medir(); } });
    ro.observe(box);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={caixa} className={CLASSE_MODO[modo]}>{children}</div>;
}

export function MoneyText({ value }: { value: Money | number | undefined | null }) {
  return <span className="num">{value === undefined || value === null ? '—' : formatMoney(value)}</span>;
}

/** Preço com o desconto do produto: o preço cheio riscado ao lado do preço que vale (S3-10). */
export function PrecoText({ value, semDesconto }: { value: Money; semDesconto?: Money | undefined }) {
  if (!semDesconto) return <MoneyText value={value} />;
  return <span className="num preco-desconto"><s className="muted">{formatMoney(semDesconto)}</s> <strong>{formatMoney(value)}</strong></span>;
}

export function Badge({ children, tom = 'neutro' }: { children: ReactNode; tom?: 'neutro' | 'ok' | 'alerta' | 'erro' | 'info' }) {
  return <span className={`badge badge-${tom}`}>{children}</span>;
}

export function Empty({ children = 'Nenhum registro encontrado.' }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button className="btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
      <span aria-live="polite">Página {page} de {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
    </nav>
  );
}

/** Abas no padrão do leitor de tela (S6-05): só a aba ativa entra no Tab; setas, Home e End trocam de aba. */
export function Tabs<T extends string>({ abas, atual, onChange }: { abas: { id: T; rotulo: string }[]; atual: T; onChange: (t: T) => void }) {
  const lista = useRef<HTMLDivElement>(null);
  const mover = (e: React.KeyboardEvent, i: number) => {
    const n = abas.length;
    const alvo = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (alvo < 0) return;
    e.preventDefault();
    onChange(abas[alvo]!.id);
    lista.current?.querySelectorAll<HTMLElement>('[role=tab]')[alvo]?.focus();
  };
  return (
    <div className="tabs" role="tablist" ref={lista}>
      {abas.map((a, i) => (
        // nenhuma aba casa com a atual (rota inválida): a primeira fica no Tab, para o grupo não sumir do teclado
        <button key={a.id} type="button" role="tab" aria-selected={a.id === atual} tabIndex={a.id === atual || (i === 0 && !abas.some((x) => x.id === atual)) ? 0 : -1}
          className={`tab ${a.id === atual ? 'active' : ''}`} onClick={() => onChange(a.id)} onKeyDown={(e) => mover(e, i)}>{a.rotulo}</button>
      ))}
    </div>
  );
}
