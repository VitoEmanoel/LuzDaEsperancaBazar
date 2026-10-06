/**
 * Relatórios: prestação de contas (parceiro OU campanha), vendas (por dia/forma/categoria/operador, canceladas
 * à parte), estoque, descartes (por parceiro/campanha e motivo), transferências, fiado. Exporta PDF/CSV/XLSX
 * com o MESMO filtro da tela (RF-REL-07).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { relatoriosApi, type AgrupamentoVendas, type FiltroRelatorio, type FormatoExportacao } from '../relatorios.api';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { errorMessage } from '../../../shared/api/http';
import type { RelatorioSecao, TipoRelatorio } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Empty, ErrorAlert, Field, MoneyText, PageHeader, Tabs } from '../../../shared/components/ui';
import { formatDate, todayLocal } from '../../../shared/lib/format';
import { downloadBlob } from '../../../shared/lib/download';
import { useToast } from '../../../shared/components/Toast';

const ABAS: { id: TipoRelatorio; rotulo: string }[] = [
  { id: 'prestacao-contas', rotulo: 'Prestação de contas' }, { id: 'vendas', rotulo: 'Vendas' }, { id: 'estoque', rotulo: 'Estoque' },
  { id: 'descartes', rotulo: 'Descartes' }, { id: 'transferencias', rotulo: 'Transferências' }, { id: 'fiado', rotulo: 'Fiado em aberto' },
];
const AGRUPAR_VENDAS: { value: AgrupamentoVendas | ''; label: string }[] = [
  { value: 'dia', label: 'Total por dia' }, { value: 'forma', label: 'Total por forma de pagamento' },
  { value: 'categoria', label: 'Total por categoria' }, { value: 'operador', label: 'Total por operador' },
  { value: '', label: 'Lista de vendas' },
];

export function RelatoriosPage() {
  const { tipo = 'prestacao-contas' } = useParams();
  const t = (ABAS.some((a) => a.id === tipo) ? tipo : 'prestacao-contas') as TipoRelatorio;
  const nav = useNavigate();
  const toast = useToast();
  const [de, setDe] = useState(todayLocal(-30));
  const [ate, setAte] = useState(todayLocal());
  const [modo, setModo] = useState<'parceiro' | 'campanha'>('parceiro');
  const [agruparVendas, setAgruparVendas] = useState<AgrupamentoVendas | ''>('dia');
  const [porMotivo, setPorMotivo] = useState(false);
  const [parceiroId, setParceiroId] = useState('');
  const [campanhaId, setCampanhaId] = useState('');

  const opcoes = useAsync(async () => (t === 'descartes'
    ? Promise.all([cadastrosApi.listar('parceiros'), cadastrosApi.listar('campanhas')])
    : null), [t]);

  const filtro: FiltroRelatorio = {
    de, ate,
    ...(t === 'prestacao-contas' ? { modo } : {}),
    ...(t === 'vendas' && agruparVendas ? { agrupar: agruparVendas } : {}),
    ...(t === 'descartes' ? { ...(porMotivo ? { agrupar: 'motivo' as const } : {}), ...(parceiroId ? { parceiroId } : {}), ...(campanhaId ? { campanhaId } : {}) } : {}),
  };
  const { data, erro, carregando } = useAsync(() => relatoriosApi.consultar(t, filtro), [t, de, ate, modo, agruparVendas, porMotivo, parceiroId, campanhaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportar(fmt: FormatoExportacao) {
    try { downloadBlob(await relatoriosApi.exportar(t, filtro, fmt), `${t}_${de}_${ate}.${fmt}`); }
    catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Relatórios">
        {(['pdf', 'csv', 'xlsx'] as const).map((f) => <button key={f} className="btn" onClick={() => exportar(f)}>Exportar {f.toUpperCase()}</button>)}
      </PageHeader>
      <Tabs abas={ABAS} atual={t} onChange={(id) => nav(`/relatorios/${id}`)} />
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
        {t === 'prestacao-contas' && (
          <Field label="Agrupar por"><select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}><option value="parceiro">Parceiro</option><option value="campanha">Campanha</option></select></Field>
        )}
        {t === 'vendas' && (
          <Field label="Mostrar"><select value={agruparVendas} onChange={(e) => setAgruparVendas(e.target.value as AgrupamentoVendas | '')}>
            {AGRUPAR_VENDAS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></Field>
        )}
        {t === 'descartes' && (<>
          <Field label="Parceiro"><select value={parceiroId} onChange={(e) => setParceiroId(e.target.value)}>
            <option value="">Todos</option>{opcoes.data?.[0].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select></Field>
          <Field label="Campanha"><select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}>
            <option value="">Todas</option>{opcoes.data?.[1].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></Field>
          <Field label="Mostrar"><select value={porMotivo ? 'motivo' : ''} onChange={(e) => setPorMotivo(e.target.value === 'motivo')}>
            <option value="">Lista + total por motivo</option><option value="motivo">Só total por motivo</option>
          </select></Field>
        </>)}
      </div>
      {t === 'prestacao-contas' && <p className="muted">Recebido e descartado consideram lotes do período; vendido e receita consideram vendas do período; saldo é a posição atual. Valor oficial pendente de definição (PA-09).</p>}
      {t === 'vendas' && <p className="muted">Os totais consideram só vendas concluídas. Vendas canceladas aparecem à parte, abaixo.</p>}
      <ErrorAlert erro={erro ?? opcoes.erro} />
      {carregando ? <p>Carregando…</p> : !data ? null : (<>
        {data.linhas.length ? <TabelaRelatorio secao={data} /> : <><h2>{data.titulo}</h2><Empty /></>}
        {data.blocos?.map((b) => <TabelaRelatorio key={b.titulo} secao={b} vazio="Nenhum registro." />)}
      </>)}
    </div>
  );
}

const numerica = (tipo?: string) => tipo === 'money' || tipo === 'number';

function TabelaRelatorio({ secao, vazio }: { secao: RelatorioSecao; vazio?: string }) {
  if (!secao.linhas.length && vazio) return <><h2>{secao.titulo}</h2><Empty>{vazio}</Empty></>;
  const celula = (tipo: string | undefined, v: unknown) =>
    tipo === 'money' ? <MoneyText value={v as string} /> : tipo === 'date' ? formatDate(v as string) : String(v ?? '—');
  return (
    <table className="table">
      <caption>{secao.titulo}</caption>
      <thead><tr>{secao.colunas.map((c) => <th key={c.chave} className={numerica(c.tipo) ? 'num' : ''}>{c.rotulo}</th>)}</tr></thead>
      <tbody>{secao.linhas.map((l, i) => (
        <tr key={i}>{secao.colunas.map((c) => <td key={c.chave} className={numerica(c.tipo) ? 'num' : ''}>{celula(c.tipo, l[c.chave])}</td>)}</tr>
      ))}</tbody>
      {secao.totais && (
        <tfoot><tr className="destaque">{secao.colunas.map((c, i) => {
          const v = secao.totais![c.chave];
          if (i === 0) return <td key={c.chave}>Total{v !== undefined ? ` (${v})` : ''}</td>;
          return <td key={c.chave} className="num">{v === undefined ? '' : c.tipo === 'money' ? <MoneyText value={String(v)} /> : v}</td>;
        })}</tr></tfoot>
      )}
    </table>
  );
}
