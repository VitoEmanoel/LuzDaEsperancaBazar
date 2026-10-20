/**
 * Produto (S3-04): dados (editáveis por quem cadastra), preço (Admin e Estoquista, S3-08), desconto (Financeiro e Admin, S3-09),
 * as entradas com o saldo de cada uma e o histórico de tudo o que aconteceu com ele. O servidor decide cada ação.
 */
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { estoqueApi } from '../estoque.api';
import { errorMessage } from '../../../shared/api/http';
import type { ProdutoDetalhe, ProdutoEvento, TipoDesconto } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { Badge, ErrorAlert, Field, MoneyText, PageHeader, PrecoText, TabelaRolavel } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { useToast } from '../../../shared/components/Toast';
import { PrecoProdutoModal } from '../components/AcoesEstoque';
import { formatDate, formatDateTime, todayLocal } from '../../../shared/lib/format';
import { formatMoney, fromCents, tryCents } from '../../../shared/lib/money';

const SITUACAO = { CADASTRADO: { rotulo: 'Aguardando aprovação', tom: 'alerta' }, DEVOLVIDO: { rotulo: 'Devolvido', tom: 'erro' }, APROVADO: { rotulo: 'Aprovado', tom: 'ok' } } as const;
const LOCAL = { BAZAR: 'Bazar', DOACOES: 'Doações' } as const;
const MOV: Record<string, string> = {
  ENTRADA: 'Entrada (aprovação)', TRANSFERENCIA: 'Transferência', VENDA: 'Venda', ESTORNO_VENDA: 'Estorno de venda', BAIXA: 'Baixa',
  AJUSTE_ENTRADA: 'Ajuste de inventário (+)', AJUSTE_SAIDA: 'Ajuste de inventário (−)',
  PRODUTO_CRIADO: 'Produto cadastrado', PRECO_PRODUTO: 'Preço alterado', DESCONTO_PRODUTO: 'Desconto', DESCONTO_PRODUTO_ENCERRADO: 'Desconto encerrado', PRODUTO_ALTERADO: 'Dados alterados',
};
const CAMPOS: [keyof ProdutoDetalhe & string, string][] = [
  ['tituloEtiqueta', 'Título da etiqueta'], ['nome', 'Nome'], ['marca', 'Marca'], ['modelo', 'Modelo'], ['ano', 'Ano'],
  ['tipo', 'Tipo'], ['tamanho', 'Tamanho'], ['cor', 'Cor'], ['condicao', 'Condição'],
];

/** Texto curto do que o evento mudou (preço, desconto, campos) ou movimentou. */
function detalheEvento(e: ProdutoEvento): string {
  if (e.quantidade !== undefined) {
    const onde = e.origem && e.destino ? `${LOCAL[e.origem]} → ${LOCAL[e.destino]}` : e.origem ? `de ${LOCAL[e.origem]}` : e.destino ? `em ${LOCAL[e.destino]}` : '';
    return [`${e.quantidade} un. ${onde}`, `lote #${e.loteNumero}`, e.detalhe].filter(Boolean).join(' · ');
  }
  const d = e.depois ?? {};
  if (e.tipo === 'PRECO_PRODUTO') return `${formatMoney(String(e.antes?.preco ?? '0'))} → ${formatMoney(String(d.preco ?? '0'))}${d.motivo ? ` · ${d.motivo}` : ''}`;
  if (e.tipo === 'DESCONTO_PRODUTO') return `${d.tipo === 'PERCENTUAL' ? `${String(d.valor).replace('.', ',')}%` : `preço promocional ${formatMoney(String(d.valor))}`}${d.ate ? ` até ${formatDate(String(d.ate))}` : ''} · ${d.motivo ?? ''}`;
  if (e.tipo === 'DESCONTO_PRODUTO_ENCERRADO') return String(d.motivo ?? '');
  if (e.tipo === 'PRODUTO_ALTERADO') return Object.keys(d).map((k) => CAMPOS.find(([c]) => c === k)?.[1] ?? k).join(', ');
  return '';
}

export function ProdutoPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const p = useAsync(() => estoqueApi.produto(id), [id]);
  const [janela, setJanela] = useState<'preco' | 'desconto' | 'encerrar' | null>(null);
  if (p.carregando && !p.data) return <div className="page">Carregando…</div>;
  if (!p.data) return <div className="page"><ErrorAlert erro={p.erro} /></div>;
  const d = p.data;
  const verCusto = can('custo.consultar');
  async function feito() { setJanela(null); await p.reload(); }

  return (
    <div className="page">
      <PageHeader titulo={d.nome}>
        {can('produtos.preco') && <button className="btn" onClick={() => setJanela('preco')}>Alterar preço</button>}
        {can('produtos.desconto') && <button className="btn" onClick={() => setJanela('desconto')}>{d.desconto ? 'Trocar desconto' : 'Dar desconto'}</button>}
        {can('produtos.desconto') && d.desconto && <button className="btn" onClick={() => setJanela('encerrar')}>Encerrar desconto</button>}
      </PageHeader>
      <p className="muted">Código <strong>{d.codigo}</strong> · {d.categoriaNome}{d.pecaUnica && <> · <Badge tom="info">Peça única</Badge></>}</p>

      <div className="contadores">
        <div className="card"><span>Preço</span><strong><PrecoText value={d.precoEfetivo} semDesconto={d.precoEfetivo !== d.preco ? d.preco : undefined} /></strong></div>
        <div className="card"><span>No Bazar</span><strong>{d.saldoBazar}</strong></div>
        <div className="card"><span>Em Doações</span><strong>{d.saldoDoacoes}</strong></div>
        <div className="card"><span>Total</span><strong>{d.saldoBazar + d.saldoDoacoes}</strong></div>
      </div>
      {d.desconto && (
        <div className={`alert ${d.desconto.vigente ? 'alert-info' : ''}`}>
          Desconto {d.desconto.tipo === 'PERCENTUAL' ? `de ${d.desconto.valor.replace('.', ',')}%` : <>com preço promocional de <MoneyText value={d.desconto.valor} /></>}
          {d.desconto.ate ? ` até ${formatDate(d.desconto.ate)}` : ', sem data de fim'}{!d.desconto.vigente && ' (vencido: o preço cheio já vale)'}
          {d.desconto.porNome && ` · dado por ${d.desconto.porNome}`}{d.desconto.motivo && ` · ${d.desconto.motivo}`}
        </div>
      )}

      <section>
        <h2>Dados do produto</h2>
        {can('entrada.registrar') ? <EditarDados produto={d} onOk={p.reload} /> : (
          <dl className="dados">{CAMPOS.map(([k, rotulo]) => d[k] !== undefined && d[k] !== null && d[k] !== '' ? <div key={k}><dt>{rotulo}</dt><dd>{String(d[k])}</dd></div> : null)}</dl>
        )}
      </section>

      <section>
        <h2>Entradas</h2>
        <TabelaRolavel><table className="table">
          <thead><tr><th>Lote</th><th>Recebido</th><th>Origem</th><th>Situação</th><th className="num">Quantidade recebida</th>
            {verCusto && <th className="num">Custo (unitário)</th>}<th className="num">No Bazar</th><th className="num">Em Doações</th></tr></thead>
          <tbody>{d.entradas.map((e) => (
            <tr key={e.itemId}>
              <td><Link to={`/entradas/${e.loteId}/triagem`}>#{e.loteNumero}</Link></td><td>{formatDate(e.recebidoEm)}</td><td>{e.origem ?? '—'}</td>
              <td><Badge tom={SITUACAO[e.status].tom}>{SITUACAO[e.status].rotulo}</Badge></td><td className="num">{e.quantidade}</td>
              {verCusto && <td className="num"><MoneyText value={e.valorAtribuido} /></td>}
              <td className="num">{e.saldoBazar}</td><td className="num">{e.saldoDoacoes}</td>
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      </section>

      <section>
        <h2>Histórico</h2>
        <ol className="timeline">
          {d.eventos.map((e, i) => (
            <li key={i}>
              <time>{formatDateTime(e.ocorridoEm)}</time>
              <strong>{MOV[e.tipo] ?? e.tipo}</strong>
              <span>{detalheEvento(e)}</span>
              {e.usuarioNome && <small>{e.usuarioNome}</small>}
            </li>
          ))}
        </ol>
      </section>

      {janela === 'preco' && <PrecoProdutoModal produtoId={d.id} descricao={d.nome} precoAtual={d.preco} onFechar={() => setJanela(null)} onOk={feito} />}
      {janela === 'desconto' && <DescontoModal produto={d} onFechar={() => setJanela(null)} onOk={feito} />}
      {janela === 'encerrar' && <EncerrarDescontoModal produtoId={d.id} onFechar={() => setJanela(null)} onOk={feito} />}
    </div>
  );
}

/** Os campos descritivos (o código, a categoria, a peça única e o preço têm regra própria e não mudam aqui). */
function EditarDados({ produto, onOk }: { produto: ProdutoDetalhe; onOk: () => Promise<void> }) {
  const toast = useToast();
  const inicial = Object.fromEntries(CAMPOS.map(([k]) => [k, produto[k] === undefined || produto[k] === null ? '' : String(produto[k])])) as Record<string, string>;
  const [v, setV] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  // compara sem os espaços das pontas (o servidor grava assim): depois de salvar, o botão volta a ficar desligado
  const mudou = CAMPOS.filter(([k]) => v[k]!.trim() !== inicial[k]).map(([k]) => k);
  const anoOk = !v.ano!.trim() || (/^\d{4}$/.test(v.ano!.trim()) && Number(v.ano) >= 1800 && Number(v.ano) <= 2200);
  const valido = v.tituloEtiqueta!.trim() && v.nome!.trim() && anoOk;
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!mudou.length || !valido) return;
    setErro(null);
    try {
      const campos = Object.fromEntries(mudou.map((k) => [k, k === 'ano' ? (v.ano!.trim() ? Number(v.ano) : null) : (v[k]!.trim() || (k === 'tituloEtiqueta' || k === 'nome' ? v[k]!.trim() : null))]));
      await estoqueApi.editarProduto(produto.id, campos);
      toast('Dados do produto salvos.');
      await onOk();
    } catch (er) { setErro(errorMessage(er)); }
  }
  return (
    <form className="card" onSubmit={salvar}>
      <div className="grid-2">
        {CAMPOS.map(([k, rotulo]) => (
          <Field key={k} label={rotulo} erro={k === 'ano' && !anoOk ? 'Ano com 4 dígitos, de 1800 a 2200' : null}><input value={v[k]} inputMode={k === 'ano' ? 'numeric' : undefined} maxLength={k === 'tituloEtiqueta' ? 40 : k === 'nome' ? 120 : 80}
            onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <ErrorAlert erro={erro} />
      <button className="btn btn-primary" disabled={!mudou.length || !valido}>Salvar dados</button>
    </form>
  );
}

function DescontoModal({ produto, onFechar, onOk }: { produto: ProdutoDetalhe; onFechar: () => void; onOk: () => Promise<void> }) {
  const toast = useToast();
  const [tipo, setTipo] = useState<TipoDesconto>('PERCENTUAL');
  const [valor, setValor] = useState('');
  const [ate, setAte] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const cents = tryCents(valor);
  const precoCents = tryCents(produto.preco) ?? 0;
  const ok = cents !== null && cents > 0 && (tipo === 'PERCENTUAL' ? cents < 10_000 : cents < precoCents);
  // prévia do preço com desconto (o servidor faz a mesma conta e decide)
  const previa = ok ? (tipo === 'PERCENTUAL' ? Math.max(1, Math.round((precoCents * (10_000 - cents!)) / 10_000)) : cents!) : null;
  const hoje = todayLocal();
  const ateOk = !ate || ate >= hoje;
  const valido = ok && ateOk && motivo.trim().length >= 5;
  async function salvar() {
    if (!valido) return;
    setErro(null);
    try {
      await estoqueApi.darDesconto(produto.id, { tipo, valor: fromCents(cents!), ...(ate ? { ate } : {}), motivo: motivo.trim() });
      toast('Desconto salvo. O PDV já usa o preço novo.');
      await onOk();
    } catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Desconto no produto" aberto onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Salvar desconto</button></>}>
      <p><strong>{produto.nome}</strong> · preço <MoneyText value={produto.preco} />{produto.desconto && ' · o desconto atual será trocado por este'}</p>
      <div className="row" role="radiogroup" aria-label="Tipo de desconto">
        <label className="check"><input type="radio" checked={tipo === 'PERCENTUAL'} onChange={() => setTipo('PERCENTUAL')} /> Percentual (%)</label>
        <label className="check"><input type="radio" checked={tipo === 'PRECO'} onChange={() => setTipo('PRECO')} /> Preço promocional (R$)</label>
      </div>
      <Field label={tipo === 'PERCENTUAL' ? 'Desconto (%)' : 'Preço promocional (R$)'} erro={valor && !ok ? (tipo === 'PERCENTUAL' ? 'Entre 0 e 100' : 'Abaixo do preço de venda') : null}
        hint={previa !== null ? `O produto passa a custar ${formatMoney(previa)}.` : undefined}>
        <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      </Field>
      <Field label="Válido até (opcional)" hint="Sem data, o desconto vale até alguém encerrar." erro={ateOk ? null : 'A data não pode ser no passado'}><input type="date" value={ate} min={hoje} onChange={(e) => setAte(e.target.value)} /></Field>
      <Field label="Motivo (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}

function EncerrarDescontoModal({ produtoId, onFechar, onOk }: { produtoId: string; onFechar: () => void; onOk: () => Promise<void> }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    if (motivo.trim().length < 5) return;
    setErro(null);
    try { await estoqueApi.encerrarDesconto(produtoId, motivo.trim()); toast('Desconto encerrado: o preço cheio volta a valer.'); await onOk(); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Encerrar desconto" aberto onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={motivo.trim().length < 5} onClick={salvar}>Encerrar</button></>}>
      <Field label="Motivo (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} autoFocus /></Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
