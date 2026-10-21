/**
 * Fluxo de caixa (S5-08): por dia, o que entrou e saiu até hoje (regime de caixa) e o previsto depois de hoje
 * (fiado e contas a pagar pelo vencimento), com o saldo acumulado. O que já venceu e não foi pago aparece à parte.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { painelApi } from '../../inicio/painel.api';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText, PageHeader, TabelaRolavel } from '../../../shared/components/ui';
import { formatMoney } from '../../../shared/lib/money';
import { todayLocal } from '../../../shared/lib/format';
import { GraficoColunas, Indicador, formatarReais } from '../../../shared/components/Graficos';
import { diaCurto, diaLongo, reais } from '../../inicio/components/FiltroPeriodo';

export function FluxoCaixaPage() {
  const [de, setDe] = useState(todayLocal(-15));
  const [ate, setAte] = useState(todayLocal(15));
  const periodoOk = !!de && !!ate && de <= ate;
  const { data: d, erro, carregando } = useAsync(() => (periodoOk ? painelApi.fluxoCaixa({ de, ate }) : Promise.resolve(null)), [de, ate]);
  return (
    <div className="page">
      <PageHeader titulo="Fluxo de caixa" />
      <p className="muted">Até hoje, o que de fato entrou e saiu. Depois de hoje, o previsto: fiado a receber e contas a pagar pelo vencimento.</p>
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
      </div>
      {!periodoOk && <p className="field-error" role="alert">Informe as duas datas, com a inicial igual ou anterior à final.</p>}
      <ErrorAlert erro={erro} />
      {periodoOk && !erro && d && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="indicadores">
            <Indicador rotulo="Entrou" valor={formatMoney(d.totais.entradas)} nota="realizado" />
            <Indicador rotulo="Saiu" valor={formatMoney(d.totais.saidas)} nota="realizado" />
            <Indicador rotulo="A receber" valor={formatMoney(d.totais.aReceber)} nota="previsto (fiado)" />
            <Indicador rotulo="A pagar" valor={formatMoney(d.totais.aPagar)} nota="previsto (contas)" />
            <Indicador rotulo="Saldo do período" valor={formatMoney(d.totais.saldo)} tom={reais(d.totais.saldo) < 0 ? 'erro' : undefined} nota={reais(d.totais.saldo) < 0 ? 'negativo' : undefined} />
            {/* vencido antes de hoje e ainda em aberto: não entra nos dias (não se sabe quando será pago) */}
            {reais(d.atrasados.aPagar) > 0 && <Indicador rotulo="Contas vencidas e em aberto" valor={formatMoney(d.atrasados.aPagar)} tom="erro" nota="fora dos dias" to="/financeiro/pagar" />}
            {reais(d.atrasados.aReceber) > 0 && <Indicador rotulo="Fiado vencido e em aberto" valor={formatMoney(d.atrasados.aReceber)} tom="alerta" nota="fora dos dias" to="/financeiro/receber" />}
          </div>
          <div className="graficos">
            <GraficoColunas titulo="Entradas e saídas por dia" formato={formatarReais} series={[{ nome: 'Entra' }, { nome: 'Sai' }]}
              descricao={`${diaLongo(d.de)} a ${diaLongo(d.ate)} · até ${diaLongo(d.hoje)} o realizado, depois o previsto`}
              pontos={d.dias.map((x) => ({ rotulo: `${diaLongo(x.dia)}${x.dia > d.hoje ? ' (previsto)' : ''}`, curto: diaCurto(x.dia),
                valores: [reais(x.entradas) + reais(x.aReceber), reais(x.saidas) + reais(x.aPagar)] }))} />
          </div>
          <section className="card">
            <h2>Dia a dia</h2>
            <TabelaRolavel><table className="table compact">
              <thead><tr><th>Dia</th><th className="num">Entrou</th><th className="num">Saiu</th><th className="num">A receber</th><th className="num">A pagar</th><th className="num">Saldo do dia</th><th className="num">Acumulado</th></tr></thead>
              <tbody>{d.dias.map((x) => (
                <tr key={x.dia} className={x.dia === d.hoje ? 'destaque' : undefined}>
                  <td>{diaLongo(x.dia)}{x.dia === d.hoje ? ' (hoje)' : x.dia > d.hoje ? ' (previsto)' : ''}</td>
                  <td className="num"><MoneyText value={x.entradas} /></td><td className="num"><MoneyText value={x.saidas} /></td>
                  <td className="num"><MoneyText value={x.aReceber} /></td><td className="num"><MoneyText value={x.aPagar} /></td>
                  <td className="num"><MoneyText value={x.saldoDoDia} /></td>
                  <td className={`num${reais(x.acumulado) < 0 ? ' txt-erro' : ''}`}><MoneyText value={x.acumulado} /></td>
                </tr>
              ))}</tbody>
            </table></TabelaRolavel>
            <p className="muted">Reembolsos de venda não entram: a venda cancelada já saiu das entradas. Veja também o <Link to="/financeiro/resumo">resumo financeiro</Link>.</p>
          </section>
        </div>
      )}
    </div>
  );
}
