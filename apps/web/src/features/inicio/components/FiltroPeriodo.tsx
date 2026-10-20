/** Período dos dashboards: atalhos (hoje, 7 e 30 dias) antes do personalizado; os filtros ficam numa linha acima dos gráficos. */
import { useState, type ReactNode } from 'react';
import { Field } from '../../../shared/components/ui';
import { todayLocal } from '../../../shared/lib/format';
import { toCents } from '../../../shared/lib/money';
import type { Money } from '../../../shared/api/types';
import type { Periodo } from '../painel.api';

type Atalho = 'hoje' | '7' | '30' | 'outro';
const DO_ATALHO: Record<Exclude<Atalho, 'outro'>, () => Periodo> = {
  hoje: () => ({ de: todayLocal(), ate: todayLocal() }),
  '7': () => ({ de: todayLocal(-6), ate: todayLocal() }),
  '30': () => ({ de: todayLocal(-29), ate: todayLocal() }),
};

/** Estado do período; `valido` é falso enquanto o personalizado estiver incompleto ou invertido. */
export function usePeriodo(inicial: Exclude<Atalho, 'outro'> = '7') {
  const [atalho, setAtalho] = useState<Atalho>(inicial);
  const [periodo, setPeriodo] = useState<Periodo>(DO_ATALHO[inicial]());
  const dias = (Date.parse(periodo.ate) - Date.parse(periodo.de)) / 864e5 + 1;
  const valido = !!periodo.de && !!periodo.ate && periodo.de <= periodo.ate && dias <= 366; // o mesmo limite da API
  return { atalho, setAtalho, periodo, setPeriodo, valido };
}

export function FiltroPeriodo({ estado, children }: { estado: ReturnType<typeof usePeriodo>; children?: ReactNode }) {
  const { atalho, setAtalho, periodo, setPeriodo, valido } = estado;
  return (
    <>
      <div className="filters" role="group" aria-label="Filtros do painel">
        <Field label="Período">
          <select value={atalho} onChange={(e) => {
            const a = e.target.value as Atalho; setAtalho(a);
            if (a !== 'outro') setPeriodo(DO_ATALHO[a]());
          }}>
            <option value="hoje">Hoje</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="outro">Personalizado</option>
          </select>
        </Field>
        {atalho === 'outro' && <>
          <Field label="De"><input type="date" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} /></Field>
          <Field label="Até"><input type="date" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} /></Field>
        </>}
        {children}
      </div>
      {!valido && <p className="field-error" role="alert">Informe as duas datas, com a inicial igual ou anterior à final, num período de até 366 dias.</p>}
    </>
  );
}

/** Dinheiro da API (texto) em reais, para o gráfico. */
export const reais = (m: Money) => toCents(m) / 100;
/** "2026-10-20" -> "20/10" (eixo do gráfico). */
export const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "2026-10-20" -> "20/10/2026". */
export const diaLongo = (d: string) => d.split('-').reverse().join('/');
