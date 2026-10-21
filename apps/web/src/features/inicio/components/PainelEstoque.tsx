/**
 * Dashboard do Estoque (S5-15): itens no Bazar e em Doações por categoria, fila de entrada, entradas do dia e da semana,
 * descartes, produtos com pouco saldo (parâmetro do Admin) e as últimas movimentações. Sem custo.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { painelApi } from '../painel.api';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, TabelaRolavel } from '../../../shared/components/ui';
import { formatDateTime } from '../../../shared/lib/format';
import { GraficoBarras, GraficoColunas, Indicador } from '../../../shared/components/Graficos';
import { FiltroPeriodo, diaCurto, diaLongo, usePeriodo } from './FiltroPeriodo';

const TIPO_MOV: Record<string, string> = {
  ENTRADA: 'Entrada', TRANSFERENCIA: 'Transferência', VENDA: 'Venda', ESTORNO_VENDA: 'Estorno de venda', BAIXA: 'Baixa', AJUSTE_ENTRADA: 'Ajuste (entrada)', AJUSTE_SAIDA: 'Ajuste (saída)',
};

export function PainelEstoque() {
  const per = usePeriodo('7');
  const [categoriaId, setCategoriaId] = useState('');
  const [parceiroId, setParceiroId] = useState('');
  const opcoes = useAsync(() => Promise.all([cadastrosApi.listar('categorias', { ativo: true }), cadastrosApi.listar('parceiros', { ativo: true })]), []);
  const { data: d, erro, carregando } = useAsync(
    () => (per.valido ? painelApi.estoque({ ...per.periodo, categoriaId: categoriaId || undefined, parceiroId: parceiroId || undefined }) : Promise.resolve(null)),
    [per.periodo.de, per.periodo.ate, categoriaId, parceiroId],
  );
  return (
    <section className="painel" aria-labelledby="painel-estoque">
      <h2 id="painel-estoque">Estoque</h2>
      <FiltroPeriodo estado={per}>
        <Field label="Categoria">
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Todas</option>{opcoes.data?.[0].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        </Field>
        <Field label="Parceiro">
          <select value={parceiroId} onChange={(e) => setParceiroId(e.target.value)}><option value="">Todos</option>{opcoes.data?.[1].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        </Field>
      </FiltroPeriodo>
      {parceiroId && <p className="hint">O parceiro filtra as entradas, os descartes e as movimentações; o saldo por categoria e o pouco saldo são do estoque inteiro.</p>}
      <ErrorAlert erro={erro} />
      {per.valido && !erro && d && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="indicadores">
            <Indicador rotulo="Itens no Bazar" valor={d.itensBazar.toLocaleString('pt-BR')} to="/estoque" />
            <Indicador rotulo="Itens em Doações" valor={d.itensDoacoes.toLocaleString('pt-BR')} to="/estoque" />
            <Indicador rotulo="Itens esperando aprovação" valor={String(d.entrada.itensAguardandoAprovacao)} nota={`${d.entrada.lotesEmCadastro} lote(s) em cadastro`}
              tom={d.entrada.itensAguardandoAprovacao ? 'alerta' : undefined} to="/entradas" />
            <Indicador rotulo="Entradas hoje" valor={String(d.entradasHoje)} nota={`${d.entradas7Dias} nos últimos 7 dias`} />
            <Indicador rotulo="Descartes no período" valor={String(d.descartes)} />
            <Indicador rotulo="Produtos com pouco saldo" valor={String(d.poucoSaldo.itens.length)} nota={`${d.poucoSaldo.limite} unidade(s) ou menos`}
              tom={d.poucoSaldo.itens.length ? 'alerta' : 'ok'} />
          </div>
          <div className="graficos">
            <GraficoBarras titulo="Itens por categoria" series={[{ nome: 'Bazar' }, { nome: 'Doações' }]}
              pontos={d.categorias.map((c) => ({ rotulo: c.categoria, valores: [c.bazar, c.doacoes] }))} />
            <GraficoColunas titulo="Entradas aprovadas por dia" descricao={`${diaLongo(d.de)} a ${diaLongo(d.ate)}, em unidades`} series={[{ nome: 'Unidades' }]}
              pontos={d.entradasPorDia.map((p) => ({ rotulo: diaLongo(p.dia), curto: diaCurto(p.dia), valores: [p.quantidade] }))} />
          </div>
          <div className="graficos">
            <section className="card painel-secao" aria-labelledby="pe-pouco">
              <h3 id="pe-pouco">Pouco saldo ({d.poucoSaldo.limite} ou menos)</h3>
              <p className="muted">Bazar e Doações somados; peça única não entra. O limite muda em Parâmetros.</p>
              {!d.poucoSaldo.itens.length ? <p className="muted">Nenhum produto com pouco saldo.</p> : (
                <TabelaRolavel><table className="table compact">
                  <thead><tr><th>Código</th><th>Produto</th><th>Categoria</th><th className="num">Saldo</th></tr></thead>
                  <tbody>{d.poucoSaldo.itens.map((p) => <tr key={p.produtoId}><td>{p.codigo}</td><td><Link to={`/estoque/produtos/${p.produtoId}`}>{p.nome}</Link></td><td>{p.categoria}</td><td className="num">{p.saldo === 0 ? 'acabou' : p.saldo}</td></tr>)}</tbody>
                </table></TabelaRolavel>
              )}
            </section>
            <section className="card painel-secao" aria-labelledby="pe-mov">
              <h3 id="pe-mov">Últimas movimentações</h3>
              {!d.ultimasMovimentacoes.length ? <p className="muted">Nenhuma movimentação.</p> : (
                <TabelaRolavel><table className="table compact">
                  {/* 4 colunas: no celular continua tabela (com 5 ou mais vira cartões longos demais) */}
                  <thead><tr><th>Quando</th><th>Movimento</th><th>Item</th><th>Quem</th></tr></thead>
                  <tbody>{d.ultimasMovimentacoes.map((m) => (
                    <tr key={m.id}><td>{formatDateTime(m.quando)}</td>
                      <td>{TIPO_MOV[m.tipo] ?? m.tipo} · {m.quantidade} un.{(m.origem || m.destino) && <><br /><small className="muted">{[m.origem, m.destino].filter(Boolean).join(' → ')}</small></>}</td>
                      <td>{m.descricao}</td><td>{m.usuarioNome}</td></tr>
                  ))}</tbody>
                </table></TabelaRolavel>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
