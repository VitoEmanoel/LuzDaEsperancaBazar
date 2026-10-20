/**
 * Aprovação de produtos (S3-01): a fila de tudo o que foi cadastrado nos lotes e espera conferência, de todos os lotes.
 * Aprova o Administrador ou o Estoquista; quem cadastrou não confere o próprio item (S3-22, o servidor decide).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { lotesApi } from '../entradas.api';
import { errorMessage } from '../../../shared/api/http';
import type { ItemAprovacao } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorAlert, MoneyText, PageHeader, TabelaRolavel, Tabs } from '../../../shared/components/ui';
import { ConfirmMotivo } from '../../../shared/components/ConfirmMotivo';
import { useToast } from '../../../shared/components/Toast';
import { formatDateTime } from '../../../shared/lib/format';

type Aba = 'CADASTRADO' | 'DEVOLVIDO';

export function AprovacaoPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [aba, setAba] = useState<Aba>('CADASTRADO');
  const fila = useAsync(() => lotesApi.aprovacoes(aba), [aba]);
  const [devolver, setDevolver] = useState<ItemAprovacao | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const verCusto = can('custo.consultar');
  const itens = fila.data ?? [];
  const meus = itens.filter((i) => !i.podeConferir).length;
  const conferiveis = itens.filter((i) => i.podeConferir);

  async function aprovar(i: ItemAprovacao) {
    try { await lotesApi.aprovarItem(i.id); toast(`${i.descricao}: aprovado e no estoque.`); await fila.reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function aprovarTodos() {
    setAprovando(true);
    let n = 0;
    try { for (const i of conferiveis) { await lotesApi.aprovarItem(i.id); n++; } toast(`${n} item(ns) aprovado(s).`); }
    catch (e) { toast(`${n} aprovado(s); parou em um item: ${errorMessage(e)}`, 'erro'); }
    finally { setAprovando(false); await fila.reload(); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Aprovação de produtos">
        {aba === 'CADASTRADO' && conferiveis.length > 0 && <button className="btn btn-primary" disabled={aprovando} onClick={aprovarTodos}>Aprovar os {conferiveis.length} que posso conferir</button>}
      </PageHeader>
      <p className="hint">Conferir é ver se o cadastro bate com a peça (quantidade, preço, destino). Quem cadastrou não aprova o próprio item: outra pessoa confere.</p>
      <Tabs atual={aba} onChange={setAba} abas={[{ id: 'CADASTRADO', rotulo: 'Aguardando aprovação' }, { id: 'DEVOLVIDO', rotulo: 'Devolvidos ao estoquista' }]} />
      <ErrorAlert erro={fila.erro} />
      {aba === 'CADASTRADO' && meus > 0 && <div className="alert alert-info">{meus} item(ns) desta lista foi(ram) cadastrado(s) por você: outra pessoa precisa conferir.</div>}
      {fila.carregando && !fila.data ? <p>Carregando…</p> : !itens.length ? <Empty>{aba === 'CADASTRADO' ? 'Nada esperando aprovação.' : 'Nenhum item devolvido.'}</Empty> : (
        <TabelaRolavel><table className="table">
          <thead><tr>
            <th>Lote</th><th>Código</th><th>Descrição</th><th className="num">Qtd.</th><th className="num">Preço</th>
            {verCusto && <th className="num">Custo (unitário)</th>}<th>Destino</th><th>Cadastrado por</th>{aba === 'DEVOLVIDO' && <th>Motivo da devolução</th>}<th />
          </tr></thead>
          <tbody>{itens.map((i) => (
            <tr key={i.id}>
              <td><Link to={`/entradas/${i.loteId}/triagem`}>#{i.loteNumero}</Link>{(i.parceiroNome || i.campanhaNome) && <small className="muted"> · {[i.parceiroNome, i.campanhaNome].filter(Boolean).join(' · ')}</small>}</td>
              <td>{i.codigo ?? '—'}</td>
              <td>{i.produto ? <Link to={`/estoque/produtos/${i.produto.id}`}>{i.descricao}</Link> : i.descricao}{i.produto?.pecaUnica && <small> · peça única</small>}</td>
              <td className="num">{i.quantidade}</td>
              <td className="num"><MoneyText value={i.preco} /></td>
              {verCusto && <td className="num"><MoneyText value={i.valorAtribuido} /></td>}
              <td>{i.localDestino === 'BAZAR' ? 'Bazar' : 'Doações'}</td>
              <td>{i.criadoPorNome}<small className="muted"> · {formatDateTime(i.criadoEm)}</small></td>
              {aba === 'DEVOLVIDO' && <td>{i.motivoDevolucao}</td>}
              <td>{aba === 'CADASTRADO' && (i.podeConferir ? <div className="actions">
                <button className="btn btn-sm btn-primary" disabled={aprovando} onClick={() => aprovar(i)}>Aprovar</button>
                <button className="btn btn-sm" disabled={aprovando} onClick={() => setDevolver(i)}>Devolver</button>
              </div> : <small className="muted">Outra pessoa confere</small>)}</td>
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      )}
      <ConfirmMotivo aberto={!!devolver} titulo="Devolver ao estoquista" descricao={`${devolver?.descricao ?? ''}: diga o que precisa ser corrigido.`} rotuloConfirmar="Devolver"
        onFechar={() => setDevolver(null)} onConfirmar={async (m) => { await lotesApi.devolverItem(devolver!.id, m); toast('Item devolvido.'); await fila.reload(); }} />
    </div>
  );
}
