/**
 * Dashboard do Admin (S5-07), na tela inicial junto com os atalhos: vendas, caixas abertos agora, fila de entrada,
 * estoque, contas, fiado e os últimos eventos sensíveis. Filtros: período, operador e forma de pagamento.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { painelApi } from '../painel.api';
import { usuariosApi } from '../../auth/auth.api';
import { FORMAS_PAGAMENTO, type FormaPagamento } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText, TabelaRolavel } from '../../../shared/components/ui';
import { formatMoney } from '../../../shared/lib/money';
import { formatDateTime } from '../../../shared/lib/format';
import { GraficoBarras, GraficoColunas, Indicador, formatarReais } from '../../../shared/components/Graficos';
import { FiltroPeriodo, diaCurto, diaLongo, reais, usePeriodo } from './FiltroPeriodo';

export function PainelAdmin() {
  const per = usePeriodo('7');
  const [operadorId, setOperadorId] = useState('');
  const [forma, setForma] = useState<FormaPagamento | ''>('');
  const operadores = useAsync(() => usuariosApi.listar({ ativo: true, pageSize: 100 }).then((p) => p.items), []);
  const { data: d, erro, carregando } = useAsync(
    () => (per.valido ? painelApi.admin({ ...per.periodo, operadorId: operadorId || undefined, forma: forma || undefined }) : Promise.resolve(null)),
    [per.periodo.de, per.periodo.ate, operadorId, forma],
  );
  return (
    <section className="painel" aria-labelledby="painel-admin">
      <h2 id="painel-admin">Visão geral</h2>
      <FiltroPeriodo estado={per}>
        <Field label="Operador">
          <select value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
            <option value="">Todos</option>
            {operadores.data?.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Field>
        <Field label="Forma de pagamento">
          <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento | '')}>
            <option value="">Todas</option>
            {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      </FiltroPeriodo>
      <ErrorAlert erro={erro} />
      {/* consulta nova mantém o quadro anterior, mais apagado, até chegar (sem pular a tela) */}
      {per.valido && !erro && d && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="indicadores">
            <Indicador rotulo="Vendas no período" valor={formatMoney(d.vendas.total)} nota={`${d.vendas.quantidade} venda(s)`} />
            <Indicador rotulo="Ticket médio" valor={formatMoney(d.vendas.ticketMedio)} />
            <Indicador rotulo="Caixas abertos agora" valor={String(d.caixasAbertos.length)} to="/caixas" />
            <Indicador rotulo="Itens esperando aprovação" valor={String(d.entrada.itensAguardandoAprovacao)} nota={`${d.entrada.lotesEmCadastro} lote(s) em cadastro`}
              tom={d.entrada.itensAguardandoAprovacao ? 'alerta' : undefined} to="/aprovacoes" />
            <Indicador rotulo="Itens no estoque" valor={(d.estoque.itensBazar + d.estoque.itensDoacoes).toLocaleString('pt-BR')}
              nota={`Bazar ${d.estoque.itensBazar} · Doações ${d.estoque.itensDoacoes}`} to="/painel/estoque" />
            <Indicador rotulo="Valor de venda do estoque" valor={formatMoney(d.estoque.valorPotencial)} nota={d.estoque.valorAtribuido !== undefined ? <>custo atribuído <MoneyText value={d.estoque.valorAtribuido} /></> : undefined} />
            <Indicador rotulo="Contas vencidas" valor={formatMoney(d.contasPagar.vencidas.valor)} nota={`${d.contasPagar.vencidas.quantidade} conta(s)`}
              tom={d.contasPagar.vencidas.quantidade ? 'erro' : 'ok'} to="/financeiro/pagar" />
            <Indicador rotulo="A vencer em 7 dias" valor={formatMoney(d.contasPagar.proximos7Dias.valor)} nota={`${d.contasPagar.proximos7Dias.quantidade} conta(s)`} to="/financeiro/pagar" />
            <Indicador rotulo="Fiado em aberto" valor={formatMoney(d.fiado.aberto)} nota={<>vencido <MoneyText value={d.fiado.vencido} /></>}
              tom={reais(d.fiado.vencido) > 0 ? 'alerta' : undefined} to="/financeiro/receber" />
          </div>
          <div className="graficos">
            <GraficoColunas titulo="Vendas por dia" formato={formatarReais} series={[{ nome: 'Vendas' }]}
              descricao={`${diaLongo(d.de)} a ${diaLongo(d.ate)}${forma ? ` · só ${FORMAS_PAGAMENTO.find((f) => f.value === forma)?.label}` : ''}`}
              pontos={d.vendas.porDia.map((p) => ({ rotulo: diaLongo(p.dia), curto: diaCurto(p.dia), valores: [reais(p.total)] }))} />
            <GraficoBarras titulo="Vendas por forma de pagamento" formato={formatarReais} series={[{ nome: 'Vendas' }]}
              pontos={FORMAS_PAGAMENTO.map((f) => ({ rotulo: f.label, valores: [reais(d.vendas.porForma[f.value])] }))} />
          </div>
          <div className="graficos">
            <section className="card painel-secao" aria-labelledby="pa-caixas">
              <h3 id="pa-caixas">Caixas abertos agora</h3>
              {!d.caixasAbertos.length ? <p className="muted">Nenhum caixa aberto.</p> : (
                <TabelaRolavel><table className="table compact">
                  <thead><tr><th>Terminal</th><th>Operador</th><th>Desde</th><th className="num">Dinheiro esperado</th></tr></thead>
                  <tbody>{d.caixasAbertos.map((c) => <tr key={c.id}><td>{c.terminalNome}</td><td>{c.operadorNome}</td><td>{formatDateTime(c.abertoEm)}</td><td className="num"><MoneyText value={c.esperadoDinheiro} /></td></tr>)}</tbody>
                </table></TabelaRolavel>
              )}
            </section>
            <section className="card painel-secao" aria-labelledby="pa-eventos">
              <h3 id="pa-eventos">Últimos eventos sensíveis</h3>
              <p className="muted">Cancelamentos, estornos, reembolsos e diferenças de caixa no período.</p>
              {!d.eventos.length ? <p className="muted">Nenhum no período.</p> : (
                <ul className="lista-simples">
                  {d.eventos.map((e) => <li key={`${e.tipo}-${e.id}`}><span>{formatDateTime(e.quando)} · {e.descricao}</span><strong><MoneyText value={e.valor} /></strong></li>)}
                </ul>
              )}
              <p><Link to="/painel/financeiro">Abrir o painel financeiro</Link> · <Link to="/painel/estoque">Abrir o painel do estoque</Link></p>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
