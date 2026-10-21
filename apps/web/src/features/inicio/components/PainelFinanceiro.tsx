/**
 * Dashboard do Financeiro (S5-16): entradas e saídas do dia e do mês, resultado, contas vencidas e dos próximos 7 dias,
 * fiado a receber, caixas fechados com diferença e reembolsos. Filtros: período e forma de pagamento (nas entradas).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { painelApi } from '../painel.api';
import { FORMAS_PAGAMENTO, type FormaPagamento } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText } from '../../../shared/components/ui';
import { formatMoney } from '../../../shared/lib/money';
import { formatDate, formatDateTime } from '../../../shared/lib/format';
import { GraficoBarras, GraficoColunas, Indicador, formatarReais } from '../../../shared/components/Graficos';
import { FiltroPeriodo, diaCurto, diaLongo, reais, usePeriodo } from './FiltroPeriodo';

export function PainelFinanceiro() {
  const per = usePeriodo('30');
  const [forma, setForma] = useState<FormaPagamento | ''>('');
  const { data: d, erro, carregando } = useAsync(
    () => (per.valido ? painelApi.financeiro({ ...per.periodo, forma: forma || undefined }) : Promise.resolve(null)),
    [per.periodo.de, per.periodo.ate, forma],
  );
  const tomResultado = (m: string) => (reais(m) < 0 ? 'erro' as const : undefined);
  return (
    <section className="painel" aria-labelledby="painel-financeiro">
      <h2 id="painel-financeiro">Financeiro</h2>
      <FiltroPeriodo estado={per}>
        <Field label="Forma de pagamento (gráfico de entradas)">
          <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento | '')}>
            <option value="">Todas</option>
            {FORMAS_PAGAMENTO.filter((f) => f.value !== 'FIADO').map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      </FiltroPeriodo>
      <ErrorAlert erro={erro} />
      {per.valido && !erro && d && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="indicadores">
            <Indicador rotulo="Hoje: entradas" valor={formatMoney(d.hoje.entradas)} nota={<>saídas <MoneyText value={d.hoje.saidas} /></>} />
            <Indicador rotulo="Hoje: resultado" valor={formatMoney(d.hoje.resultado)} tom={tomResultado(d.hoje.resultado)} nota={reais(d.hoje.resultado) < 0 ? 'negativo' : undefined} />
            <Indicador rotulo="No mês: entradas" valor={formatMoney(d.mes.entradas)} nota={<>saídas <MoneyText value={d.mes.saidas} /></>} />
            <Indicador rotulo="No mês: resultado" valor={formatMoney(d.mes.resultado)} tom={tomResultado(d.mes.resultado)} nota={reais(d.mes.resultado) < 0 ? 'negativo' : undefined} />
            <Indicador rotulo="Contas vencidas" valor={formatMoney(d.contasPagar.vencidas.valor)} nota={`${d.contasPagar.vencidas.quantidade} conta(s)`}
              tom={d.contasPagar.vencidas.quantidade ? 'erro' : 'ok'} to="/financeiro/pagar" />
            <Indicador rotulo="A vencer em 7 dias" valor={formatMoney(d.contasPagar.proximos7Dias.valor)} nota={`${d.contasPagar.proximos7Dias.quantidade} conta(s)`} to="/financeiro/pagar" />
            <Indicador rotulo="Fiado a receber" valor={formatMoney(d.fiado.aberto)} nota={<>vencido <MoneyText value={d.fiado.vencido} /></>}
              tom={reais(d.fiado.vencido) > 0 ? 'alerta' : undefined} to="/financeiro/receber" />
            <Indicador rotulo="Caixas com diferença" valor={String(d.caixasComDiferenca.quantidade)} nota="no período" tom={d.caixasComDiferenca.quantidade ? 'alerta' : 'ok'} to="/caixas" />
            <Indicador rotulo="Reembolsos" valor={formatMoney(d.reembolsos.valor)} nota={`${d.reembolsos.quantidade} no período`} />
          </div>
          <div className="graficos">
            {/* com uma forma escolhida, só as entradas daquela forma (saídas não têm forma de venda) */}
            {forma ? (
              <GraficoColunas titulo={`Entradas em ${FORMAS_PAGAMENTO.find((f) => f.value === forma)?.label} por dia`} formato={formatarReais} series={[{ nome: 'Entradas' }]}
                descricao={`${diaLongo(d.de)} a ${diaLongo(d.ate)} · vendas e fiado recebido nesta forma`}
                pontos={d.porDia.map((p) => ({ rotulo: diaLongo(p.dia), curto: diaCurto(p.dia), valores: [reais(p.entradas)] }))} />
            ) : (
              <GraficoColunas titulo="Entradas e saídas por dia" formato={formatarReais} series={[{ nome: 'Entradas' }, { nome: 'Saídas' }]}
                descricao={`${diaLongo(d.de)} a ${diaLongo(d.ate)} · resultado ${formatMoney(d.periodo.resultado)}`}
                pontos={d.porDia.map((p) => ({ rotulo: diaLongo(p.dia), curto: diaCurto(p.dia), valores: [reais(p.entradas), reais(p.saidas)] }))} />
            )}
            <GraficoBarras titulo="Entradas por forma de pagamento" formato={formatarReais} series={[{ nome: 'Entradas' }]}
              descricao="Fiado entra quando é recebido."
              pontos={[...FORMAS_PAGAMENTO.filter((f) => f.value !== 'FIADO').map((f) => ({ rotulo: f.label, valores: [reais(d.periodo.entradasPorForma[f.value])] })),
                { rotulo: 'Fiado recebido', valores: [reais(d.periodo.recebimentosFiado)] }]} />
          </div>
          <div className="graficos">
            <section className="card painel-secao" aria-labelledby="pf-contas">
              <h3 id="pf-contas">Contas a pagar</h3>
              {!d.contasPagar.vencidas.itens.length && !d.contasPagar.proximos7Dias.itens.length ? <p className="muted">Nada vencido nem vencendo nos próximos 7 dias.</p> : (
                <ul className="lista-simples">
                  {d.contasPagar.vencidas.itens.map((c) => <li key={c.id}><span><strong className="txt-erro">Vencida</strong> {formatDate(c.vencimento)} · {c.descricao}</span><MoneyText value={c.valor} /></li>)}
                  {d.contasPagar.proximos7Dias.itens.map((c) => <li key={c.id}><span>{formatDate(c.vencimento)} · {c.descricao}</span><MoneyText value={c.valor} /></li>)}
                </ul>
              )}
              <p><Link to="/financeiro/fluxo">Ver o fluxo de caixa</Link></p>
            </section>
            <section className="card painel-secao" aria-labelledby="pf-dif">
              <h3 id="pf-dif">Caixas fechados com diferença</h3>
              {!d.caixasComDiferenca.itens.length ? <p className="muted">Nenhum no período.</p> : (
                <ul className="lista-simples">
                  {d.caixasComDiferenca.itens.map((c) => (
                    <li key={c.id}><span>{formatDateTime(c.fechadoEm)} · {c.terminalNome} · {c.operadorNome}</span>
                      <strong className={reais(c.diferenca) < 0 ? 'txt-erro' : undefined}>{reais(c.diferenca) < 0 ? 'Faltou ' : 'Sobrou '}<MoneyText value={c.diferenca.replace('-', '')} /></strong></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
