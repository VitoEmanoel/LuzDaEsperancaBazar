/** Resumo do período: entradas por forma, recebimentos de fiado, saídas e resultado. */
import { useState } from 'react';
import { financeiroApi } from '../financeiro.api';
import { FORMAS_PAGAMENTO } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText, PageHeader, TabelaRolavel } from '../../../shared/components/ui';
import { todayLocal } from '../../../shared/lib/format';

export function ResumoFinanceiroPage() {
  const [de, setDe] = useState(todayLocal(-30));
  const [ate, setAte] = useState(todayLocal());
  const { data, erro, carregando } = useAsync(() => financeiroApi.resumo(de, ate), [de, ate]);
  return (
    <div className="page narrow">
      <PageHeader titulo="Resumo financeiro" />
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : data && (
        <TabelaRolavel><table className="table">
          <tbody>
            {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}{f.value === 'FIADO' && ' (a receber)'}</td><td className="num"><MoneyText value={data.entradasPorForma[f.value]} /></td></tr>)}
            <tr><td>Recebimentos de fiado</td><td className="num"><MoneyText value={data.recebimentosFiado} /></td></tr>
            <tr><td>Saídas (contas pagas)</td><td className="num">− <MoneyText value={data.saidas} /></td></tr>
            <tr className="destaque"><td>Resultado do período (caixa)</td><td className="num"><MoneyText value={data.resultado} /></td></tr>
          </tbody>
        </table></TabelaRolavel>
      )}
    </div>
  );
}
