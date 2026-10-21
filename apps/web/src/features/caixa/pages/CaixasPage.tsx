/**
 * Caixas do dia e fechamentos (S5-06 e S5-09, uma tela só por decisão do humano): Admin e Financeiro veem todos os caixas,
 * filtram por período e situação e abrem o detalhe de cada um (totais, linha do tempo e PDF).
 */
import { useState } from 'react';
import { caixaApi } from '../caixa.api';
import type { CaixaSessao } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination, TabelaRolavel } from '../../../shared/components/ui';
import { formatDateTime, todayLocal } from '../../../shared/lib/format';
import { toCents } from '../../../shared/lib/money';
import { CaixaDetalheModal } from '../components/CaixaDetalheModal';

type Situacao = '' | 'ABERTO' | 'FECHADO' | 'DIFERENCA';

export function CaixasPage() {
  const [de, setDe] = useState(todayLocal());
  const [ate, setAte] = useState(todayLocal());
  const [situacao, setSituacao] = useState<Situacao>('');
  const [page, setPage] = useState(1);
  const [detalhe, setDetalhe] = useState<CaixaSessao | null>(null);
  // "abertos agora" ignora o período: o caixa esquecido aberto de ontem também aparece
  const abertosAgora = situacao === 'ABERTO';
  const periodoOk = abertosAgora || (!!de && !!ate && de <= ate);
  const { data, erro, carregando } = useAsync(() => (!periodoOk ? Promise.resolve(null) : caixaApi.historico({
    ...(abertosAgora ? {} : { de, ate }), page,
    ...(situacao === 'ABERTO' || situacao === 'FECHADO' ? { status: situacao } : {}),
    ...(situacao === 'DIFERENCA' ? { comDiferenca: true } : {}),
  })), [de, ate, situacao, page]);

  const filtrar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="page">
      <PageHeader titulo="Caixas do dia" />
      <div className="filters">
        <Field label="Situação">
          <select value={situacao} onChange={(e) => filtrar(setSituacao)(e.target.value as Situacao)}>
            <option value="">Todos</option>
            <option value="ABERTO">Abertos agora</option>
            <option value="FECHADO">Fechados</option>
            <option value="DIFERENCA">Fechados com diferença</option>
          </select>
        </Field>
        <Field label="De"><input type="date" value={de} disabled={abertosAgora} onChange={(e) => filtrar(setDe)(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} disabled={abertosAgora} onChange={(e) => filtrar(setAte)(e.target.value)} /></Field>
      </div>
      {abertosAgora && <p className="muted">Todos os caixas abertos, de qualquer dia.</p>}
      {!periodoOk && <p className="field-error" role="alert">Informe as duas datas, com a inicial igual ou anterior à final.</p>}
      <ErrorAlert erro={erro} />
      {!periodoOk || erro ? null : carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty>Nenhum caixa neste filtro.</Empty> : (
        <TabelaRolavel><table className="table">
          <thead><tr><th>Terminal</th><th>Operador</th><th>Aberto em</th><th>Situação</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferença</th><th /></tr></thead>
          <tbody>
            {data.items.map((c) => {
              const dif = c.diferenca ? toCents(c.diferenca) : 0;
              return (
                <tr key={c.id}>
                  <td>{c.terminalNome}</td>
                  <td>{c.operadorNome}</td>
                  <td>{formatDateTime(c.abertoEm)}</td>
                  <td>{c.status === 'ABERTO' ? <Badge tom="info">Aberto</Badge> : <Badge tom="ok">Fechado {formatDateTime(c.fechadoEm)}</Badge>}</td>
                  <td className="num">{c.esperado ? <MoneyText value={c.esperado} /> : '—'}</td>
                  <td className="num">{c.contado ? <MoneyText value={c.contado} /> : '—'}</td>
                  <td className="num">{c.status === 'ABERTO' ? '—' : dif === 0 ? <Badge tom="ok">Sem diferença</Badge>
                    : <Badge tom={dif < 0 ? 'erro' : 'alerta'}>{dif < 0 ? 'Faltou ' : 'Sobrou '}<MoneyText value={c.diferenca!.replace('-', '')} /></Badge>}</td>
                  <td className="actions"><button className="btn btn-sm" onClick={() => setDetalhe(c)} aria-label={`Detalhe do caixa de ${c.operadorNome} em ${formatDateTime(c.abertoEm)}`}>Detalhe</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></TabelaRolavel>
      )}
      {periodoOk && !erro && data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      {detalhe && <CaixaDetalheModal caixa={detalhe} onFechar={() => setDetalhe(null)} />}
    </div>
  );
}
