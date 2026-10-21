/**
 * Estoque numa tela só (S3-02): posição por estoque, categoria, parceiro, campanha e lote, com as ações na própria linha
 * (baixa, ajuste de saída, preço). Saldo vem da view do servidor; o custo só aparece para quem pode vê-lo (S3-05).
 * A busca também lê o código pela câmera (S5-12).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { estoqueApi } from '../estoque.api';
import type { ItemEstoque, LocalEstoque } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination, PrecoText, TabelaRolavel } from '../../../shared/components/ui';
import { BaixaAjusteModal, PrecoCategoriaModal, PrecoProdutoModal } from '../components/AcoesEstoque';
import { caminhoEtiquetas } from '../etiquetas';
import { cameraDisponivel, LeitorCameraModal } from '../../../shared/components/LeitorCamera';

type Acao = { tipo: 'baixa' | 'ajuste' | 'preco'; item: ItemEstoque } | { tipo: 'precoCategoria'; categoriaId?: string } | null;

export function EstoquePage() {
  const { can } = useAuth();
  const [f, setF] = useState({ local: '' as LocalEstoque | '', categoriaId: '', parceiroId: '', campanhaId: '', busca: '' });
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const [acao, setAcao] = useState<Acao>(null);
  const [lendoCamera, setLendoCamera] = useState(false);
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('categorias'), cadastrosApi.listar('parceiros'), cadastrosApi.listar('campanhas')]), []);
  const lista = useAsync(() => estoqueApi.listar({ ...f, local: f.local || undefined, page }), [f, page]);
  const { data, erro, carregando } = lista;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const verCusto = can('custo.consultar');
  const ajusta = can('estoque.ajustar');
  const imprime = can('etiquetas.imprimir');
  const temAcoes = ajusta || can('produtos.preco') || imprime;
  // etiqueta é do produto: uma por unidade em estoque (S4-04)
  const etiquetaDe = (i: ItemEstoque) => ({ produtoId: i.produtoId!, quantidade: i.saldoBazar + i.saldoDoacoes });
  async function feito() { setAcao(null); await lista.reload(); }

  return (
    <div className="page">
      <PageHeader titulo="Estoque">
        {ajusta && <button className="btn" onClick={() => setAcao({ tipo: 'precoCategoria' })}>Preço da categoria</button>}
      </PageHeader>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setF({ ...f, busca }); setPage(1); }}>
        <Field label="Buscar (descrição ou código)"><input value={busca} onChange={(e) => setBusca(e.target.value)} /></Field>
        {cameraDisponivel() && <button type="button" className="btn" onClick={() => setLendoCamera(true)}>Ler pela câmera</button>}
        <Field label="Estoque"><select value={f.local} onChange={set('local')}><option value="">Ambos</option><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
        <Field label="Categoria"><select value={f.categoriaId} onChange={set('categoriaId')}><option value="">Todas</option>{ops.data?.[0].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Parceiro"><select value={f.parceiroId} onChange={set('parceiroId')}><option value="">Todos</option>{ops.data?.[1].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Campanha"><select value={f.campanhaId} onChange={set('campanhaId')}><option value="">Todas</option>{ops.data?.[2].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <button className="btn">Filtrar</button>
      </form>
      {/* o código lido já filtra a lista */}
      <LeitorCameraModal aberto={lendoCamera} onLer={(c) => { setBusca(c); setF({ ...f, busca: c }); setPage(1); }} onFechar={() => setLendoCamera(false)} />
      <ErrorAlert erro={erro} />
      {imprime && !!data?.items.some((i) => i.produtoId) && (
        <p><Link className="btn" to={caminhoEtiquetas(data.items.filter((i) => i.produtoId).map(etiquetaDe))}>Etiquetas dos produtos desta lista</Link></p>
      )}
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <TabelaRolavel><table className="table">
          <thead><tr>
            <th>Código</th><th>Descrição</th><th>Categoria</th><th>Lote</th><th>Origem</th><th className="num">Preço</th>
            {verCusto && <th className="num">Custo (unitário)</th>}
            <th className="num">Quantidade no Bazar</th><th className="num">Quantidade em Doações</th><th className="num">Total</th>
            {temAcoes && <th />}
          </tr></thead>
          <tbody>{data.items.map((i) => (
            <tr key={i.id}>
              <td>{i.codigo ?? '—'}</td>
              {/* produto: a tela do produto (todas as entradas); por categoria: o histórico da entrada */}
              <td><Link to={i.produtoId ? `/estoque/produtos/${i.produtoId}` : `/estoque/itens/${i.id}`}>{i.descricao}</Link></td>
              <td>{i.categoriaNome}</td>
              <td>#{i.loteNumero}</td><td>{[i.parceiroNome, i.campanhaNome].filter(Boolean).join(' · ')}</td>
              <td className="num"><PrecoText value={i.preco} semDesconto={i.precoSemDesconto} /></td>
              {verCusto && <td className="num"><MoneyText value={i.valorAtribuido} /></td>}
              <td className="num">{i.saldoBazar}</td><td className="num">{i.saldoDoacoes}</td><td className="num"><strong>{i.saldoBazar + i.saldoDoacoes}</strong></td>
              {/* sem botão nesta linha, a célula fica vazia (no celular ela some do cartão) */}
              {/* por categoria não tem código nem preço próprio: o preço é o da categoria (o botão já abre com ela) e não há etiqueta */}
              {temAcoes && <td>{(ajusta || !i.produtoId || can('produtos.preco') || imprime) && <div className="actions">
                {ajusta && <button className="btn btn-sm" onClick={() => setAcao({ tipo: 'baixa', item: i })}>Baixa</button>}
                {ajusta && <button className="btn btn-sm" onClick={() => setAcao({ tipo: 'ajuste', item: i })}>Ajuste</button>}
                {can('produtos.preco') && i.produtoId && <button className="btn btn-sm" onClick={() => setAcao({ tipo: 'preco', item: i })}>Preço</button>}
                {imprime && i.produtoId && <Link className="btn btn-sm" to={caminhoEtiquetas([etiquetaDe(i)])}>Etiqueta</Link>}
                {!i.produtoId && (ajusta
                  ? <button className="btn btn-sm" onClick={() => setAcao({ tipo: 'precoCategoria', categoriaId: i.categoriaId })} aria-label={`Preço da categoria ${i.categoriaNome}`}>Preço da categoria</button>
                  : <small className="muted">Preço da categoria, sem etiqueta</small>)}
              </div>}</td>}
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}

      {(acao?.tipo === 'baixa' || acao?.tipo === 'ajuste') && <BaixaAjusteModal item={acao.item} modo={acao.tipo} onFechar={() => setAcao(null)} onOk={feito} />}
      {acao?.tipo === 'preco' && acao.item.produtoId && (
        <PrecoProdutoModal produtoId={acao.item.produtoId} descricao={acao.item.descricao} precoAtual={acao.item.precoSemDesconto ?? acao.item.preco} onFechar={() => setAcao(null)} onOk={feito} />
      )}
      {acao?.tipo === 'precoCategoria' && <PrecoCategoriaModal categoriaInicial={acao.categoriaId} onFechar={() => setAcao(null)} onOk={feito} />}
    </div>
  );
}
