/** Peças pequenas de UI reutilizadas em todas as telas. */
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
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

/** Campo de senha com botão para mostrar o que foi digitado (conferir a senha, principalmente no celular). */
export function CampoSenha(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [ver, setVer] = useState(false);
  return (
    <span className="campo-senha">
      <input {...props} type={ver ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVer(!ver)} aria-pressed={ver} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'}>
        {ver ? 'Esconder' : 'Mostrar'}
      </button>
    </span>
  );
}

export function ErrorAlert({ erro }: { erro: string | null | undefined }) {
  return erro ? <div className="alert alert-error" role="alert">{erro}</div> : null;
}

export function PageHeader({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{titulo}</h1><div className="actions">{children}</div></div>;
}

/**
 * Tabela larga rola para o lado dentro desta caixa, sem empurrar a página para além do cabeçalho.
 * No celular, a tabela de 5 colunas ou mais vira cartões: cada célula leva o título da sua coluna (data-rotulo),
 * e os papéis (role) mantêm a tabela para o leitor de tela quando o CSS a desmonta.
 */
export function TabelaRolavel({ children }: { children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [cartoes, setCartoes] = useState(false);
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
    setCartoes(rotulos.length >= 5);
  });
  return <div ref={caixa} className={cartoes ? 'tabela-rolavel tabela-cartoes' : 'tabela-rolavel'}>{children}</div>;
}

export function MoneyText({ value }: { value: Money | number | undefined | null }) {
  return <span className="num">{value === undefined || value === null ? '—' : formatMoney(value)}</span>;
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
      <span>Página {page} de {pages}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
    </nav>
  );
}

export function Tabs<T extends string>({ abas, atual, onChange }: { abas: { id: T; rotulo: string }[]; atual: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === atual} className={`tab ${a.id === atual ? 'active' : ''}`} onClick={() => onChange(a.id)}>{a.rotulo}</button>
      ))}
    </div>
  );
}
