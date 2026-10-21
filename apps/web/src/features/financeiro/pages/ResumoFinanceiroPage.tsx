/** Resumo do período: entradas por forma, recebimentos de fiado, saídas e resultado; imprime e baixa em PDF (S5-10). */
import { useState } from 'react';
import { financeiroApi } from '../financeiro.api';
import { errorMessage } from '../../../shared/api/http';
import { FORMAS_PAGAMENTO } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText, PageHeader, TabelaRolavel } from '../../../shared/components/ui';
import { downloadBlob } from '../../../shared/lib/download';
import { formatDate, todayLocal } from '../../../shared/lib/format';
import { useToast } from '../../../shared/components/Toast';

export function ResumoFinanceiroPage() {
  const toast = useToast();
  const [de, setDe] = useState(todayLocal(-30));
  const [ate, setAte] = useState(todayLocal());
  const periodoOk = !!de && !!ate && de <= ate;
  const { data, erro, carregando } = useAsync(() => (periodoOk ? financeiroApi.resumo(de, ate) : Promise.resolve(null)), [de, ate]);
  async function baixarPdf() {
    try { downloadBlob(await financeiroApi.resumoPdf(de, ate), `resumo-financeiro-${de}-a-${ate}.pdf`); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <div className="page narrow">
      <PageHeader titulo="Resumo financeiro" />
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
      </div>
      {!periodoOk && <p className="field-error" role="alert">Informe as duas datas, com a inicial igual ou anterior à final.</p>}
      <ErrorAlert erro={erro} />
      {/* consulta que falhou não deixa na tela (nem no PDF) os números do período anterior */}
      {carregando ? <p>Carregando…</p> : !erro && data && (
        <div className="print-area">
          <h2>Resumo financeiro · {de === ate ? formatDate(de) : `${formatDate(de)} a ${formatDate(ate)}`}</h2>
          <TabelaRolavel><table className="table">
            <tbody>
              {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}{f.value === 'FIADO' && ' (a receber)'}</td><td className="num"><MoneyText value={data.entradasPorForma[f.value]} /></td></tr>)}
              <tr><td>Recebimentos de fiado</td><td className="num"><MoneyText value={data.recebimentosFiado} /></td></tr>
              <tr><td>Saídas (contas pagas)</td><td className="num">− <MoneyText value={data.saidas} /></td></tr>
              <tr><td>Reembolsos de venda <small className="muted">(já fora das vendas; não descontam de novo)</small></td><td className="num"><MoneyText value={data.reembolsos} /></td></tr>
              <tr className="destaque"><td>Resultado do período (caixa)</td><td className="num"><MoneyText value={data.resultado} /></td></tr>
            </tbody>
          </table></TabelaRolavel>
          <div className="row no-print">
            <button className="btn" onClick={baixarPdf}>Baixar PDF</button>
            <button className="btn" onClick={() => window.print()}>Imprimir</button>
          </div>
        </div>
      )}
    </div>
  );
}
