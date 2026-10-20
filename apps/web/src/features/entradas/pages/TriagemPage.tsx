/**
 * Cadastrar produtos do lote (S2-13, substitui a triagem):
 *  Cadastrar: produto novo (código BZ gerado), nova entrada de um produto que já existe, ou item por categoria.
 *  O item fica "aguardando aprovação" e só entra no estoque quando o Administrador aprova (item a item ou o lote).
 *  O Administrador pode devolver com motivo; o estoquista corrige e o item volta para a aprovação.
 *  Descartar: item a item com motivo (nunca entra no estoque — RN-01). Etiquetas, encerrar/reabrir lote, reverter descarte.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { lotesApi } from '../entradas.api';
import { errorMessage } from '../../../shared/api/http';
import { PERFIL_ADMIN_ID, type CamposProduto, type Etiqueta, type ItemLote, type LocalEstoque, type ProdutoBusca, type StatusItem, type TipoEntrada } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, ErrorAlert, Field, MoneyText, PageHeader, TabelaRolavel } from '../../../shared/components/ui';
import { ConfirmMotivo } from '../../../shared/components/ConfirmMotivo';
import { Modal } from '../../../shared/components/Modal';
import { Barcode } from '../../../shared/components/Barcode';
import { Can } from '../../auth/guards';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../../shared/lib/format';
import { formatMoney, fromCents, toCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

type Categoria = { id: string; nome: string; precoPadrao: string };
const SITUACAO: Record<StatusItem, { rotulo: string; tom: 'ok' | 'alerta' | 'erro' }> = {
  CADASTRADO: { rotulo: 'Aguardando aprovação', tom: 'alerta' },
  DEVOLVIDO: { rotulo: 'Devolvido', tom: 'erro' },
  APROVADO: { rotulo: 'Aprovado', tom: 'ok' },
};

export function TriagemPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { can, me } = useAuth();
  const lote = useAsync(() => lotesApi.obter(id), [id]);
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('categorias', { ativo: true }), cadastrosApi.listar('motivos-descarte', { ativo: true })]), []);
  const [reabrir, setReabrir] = useState(false);
  const [reverter, setReverter] = useState<string | null>(null);
  const [devolver, setDevolver] = useState<ItemLote | null>(null);
  const [corrigir, setCorrigir] = useState<ItemLote | null>(null);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);
  const [aprovando, setAprovando] = useState(false);

  const l = lote.data;
  const categorias = ops.data?.[0] ?? [];
  const motivos = ops.data?.[1] ?? [];
  const aberto = l?.status === 'ABERTO';
  const aprovador = can('produtos.aprovar');
  const registra = can('entrada.registrar'); // o Financeiro só lê o lote (S3-12)
  const verCusto = can('custo.consultar'); // S3-05
  // quem cadastrou não confere o próprio item; o Administrador pode (S3-22)
  const podeConferir = (i: ItemLote) => aprovador && (me?.perfil.id === PERFIL_ADMIN_ID || i.criadoPorId !== me?.id);
  const etiquetaveis = useMemo(() => l?.itens.filter((i) => i.codigo).map((i) => i.id) ?? [], [l]);
  const pendentes = l?.itens.filter((i) => i.status === 'CADASTRADO').length ?? 0;
  const conferiveis = l?.itens.filter((i) => i.status === 'CADASTRADO' && podeConferir(i)).length ?? 0;

  async function encerrar() {
    try { await lotesApi.encerrar(id); toast('Lote encerrado.'); await lote.reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function imprimirEtiquetas(ids: string[]) {
    try { setEtiquetas(await lotesApi.etiquetas(ids)); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function aprovarItem(i: ItemLote) {
    try { await lotesApi.aprovarItem(i.id); toast(`${i.descricao}: aprovado e no estoque.`); await lote.reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function aprovarLote() {
    setAprovando(true);
    try {
      const r = await lotesApi.aprovarLote(id);
      toast(`${r.aprovadosAgora} item(ns) aprovado(s).${r.deixadosParaOutraPessoa ? ` ${r.deixadosParaOutraPessoa} cadastrado(s) por você fica(m) para outra pessoa conferir.` : ''}`);
      await lote.reload();
    }
    catch (e) { toast(errorMessage(e), 'erro'); } finally { setAprovando(false); }
  }

  if (lote.carregando && !l) return <div className="page">Carregando…</div>;
  if (!l) return <div className="page"><ErrorAlert erro={lote.erro} /></div>;

  return (
    <div className="page">
      <PageHeader titulo={`Lote #${l.numero} — cadastro de produtos`}>
        {registra && etiquetaveis.length > 0 && <button className="btn" onClick={() => imprimirEtiquetas(etiquetaveis)}>Imprimir etiquetas ({etiquetaveis.length})</button>}
        {conferiveis > 0 && <button className="btn btn-primary" disabled={aprovando} onClick={aprovarLote}>Aprovar lote ({conferiveis})</button>}
        {aberto ? registra && <button className="btn" onClick={encerrar}>Encerrar lote</button>
          : <Can perm="triagem.reabrir"><button className="btn" onClick={() => setReabrir(true)}>Reabrir lote</button></Can>}
      </PageHeader>
      <p className="muted">
        {[l.parceiroNome, l.campanhaNome].filter(Boolean).join(' · ')} · recebido em {formatDateTime(l.recebidoEm)} {l.documento && `· ${l.documento}`}{' '}
        {aberto ? <Badge tom="alerta">Recebendo cadastro</Badge> : <Badge tom="ok">Encerrado</Badge>}
      </p>
      <p className="hint">Os itens cadastrados só entram no estoque depois que outra pessoa confere e aprova (o Administrador ou outro Estoquista).</p>
      <div className="contadores" aria-live="polite">
        <div className="card"><span>No estoque (unidades)</span><strong>{l.aprovados}</strong></div>
        <div className="card"><span>Aguardando aprovação</span><strong>{l.pendentes ?? pendentes}</strong></div>
        <div className="card"><span>Devolvidos</span><strong>{l.devolvidos ?? 0}</strong></div>
        <div className="card"><span>Descartados</span><strong>{l.descartados}</strong></div>
        {l.valorAtribuido !== undefined && <div className="card"><span>Valor atribuído (aprovado)</span><strong><MoneyText value={l.valorAtribuido} /></strong></div>}
      </div>
      <ErrorAlert erro={ops.erro} />

      {aberto && registra && (
        <div className="grid-2 triagem">
          <FormCadastrar loteId={id} tipoLote={l.tipo} categorias={categorias} onOk={() => lote.reload()} />
          <FormDescartar loteId={id} categorias={categorias} motivos={motivos} onOk={() => lote.reload()} />
        </div>
      )}

      <section>
        <h2>Itens do lote</h2>
        <TabelaRolavel><table className="table compact">
          <thead><tr><th>Código</th><th>Descrição</th><th className="num">Qtd.</th><th className="num">Preço</th>{verCusto && <th className="num">Custo (unitário)</th>}<th>Destino</th><th>Situação</th><th /></tr></thead>
          <tbody>{l.itens.map((i) => (
            <tr key={i.id}>
              <td>{i.codigo ?? '—'}</td>
              {/* o produto já existe antes da aprovação (quem confere vê os dados); o item por categoria só tem histórico depois de aprovado */}
              <td>{i.produto ? <Link to={`/estoque/produtos/${i.produto.id}`}>{i.descricao}</Link> : i.status === 'APROVADO' ? <Link to={`/estoque/itens/${i.id}`}>{i.descricao}</Link> : i.descricao}{i.produto?.pecaUnica && <small> · peça única</small>}</td>
              <td className="num">{i.quantidade}</td>
              <td className="num"><MoneyText value={i.preco} /></td>
              {verCusto && <td className="num"><MoneyText value={i.valorAtribuido} /></td>}
              <td>{i.localDestino === 'BAZAR' ? 'Bazar' : 'Doações'}</td>
              <td><Badge tom={SITUACAO[i.status].tom}>{SITUACAO[i.status].rotulo}</Badge>{i.motivoDevolucao && <small className="motivo-devolucao">{i.motivoDevolucao}</small>}</td>
              <td className="row">
                {i.status === 'CADASTRADO' && podeConferir(i) && <>
                  <button className="btn btn-sm btn-primary" disabled={aprovando} onClick={() => aprovarItem(i)}>Aprovar</button>
                  <button className="btn btn-sm" disabled={aprovando} onClick={() => setDevolver(i)}>Devolver</button>
                </>}
                {i.status === 'CADASTRADO' && aprovador && !podeConferir(i) && <small className="muted">Outra pessoa confere</small>}
                {i.status !== 'APROVADO' && <Can perm="entrada.registrar"><button className="btn btn-sm" onClick={() => setCorrigir(i)}>{i.status === 'DEVOLVIDO' ? 'Corrigir e reenviar' : 'Corrigir'}</button></Can>}
              </td>
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      </section>
      <section>
        <h2>Descartes</h2>
        <TabelaRolavel><table className="table compact">
          <thead><tr><th>Quando</th><th>Categoria</th><th>Motivo</th><th /></tr></thead>
          <tbody>{l.descartes.map((d) => (
            <tr key={d.id} className={d.revertido ? 'riscado' : ''}>
              <td>{formatDateTime(d.registradoEm)}</td><td>{d.categoriaNome}</td><td>{d.motivoNome}{d.revertido && ' (revertido)'}</td>
              <td><Can perm="triagem.reabrir">{!d.revertido && <button className="btn btn-sm" onClick={() => setReverter(d.id)}>Reverter</button>}</Can></td>
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      </section>

      <ConfirmMotivo aberto={reabrir} titulo="Reabrir lote" descricao="O lote voltará a aceitar cadastros e descartes." onFechar={() => setReabrir(false)}
        onConfirmar={async (m) => { await lotesApi.reabrir(id, m); toast('Lote reaberto.'); await lote.reload(); }} />
      <ConfirmMotivo aberto={!!reverter} titulo="Reverter descarte" descricao="O item precisará ser cadastrado de novo (o lote será reaberto)." onFechar={() => setReverter(null)}
        onConfirmar={async (m) => { await lotesApi.reverterDescarte(reverter!, m); toast('Descarte revertido.'); await lote.reload(); }} />
      <ConfirmMotivo aberto={!!devolver} titulo="Devolver ao estoquista" descricao={`${devolver?.descricao ?? ''}: diga o que precisa ser corrigido.`} rotuloConfirmar="Devolver"
        onFechar={() => setDevolver(null)} onConfirmar={async (m) => { await lotesApi.devolverItem(devolver!.id, m); toast('Item devolvido.'); await lote.reload(); }} />
      {corrigir && <CorrigirModal loteId={id} compra={l.tipo === 'COMPRA'} item={corrigir} onFechar={() => setCorrigir(null)} onOk={async () => { setCorrigir(null); toast('Item corrigido e enviado para aprovação.'); await lote.reload(); }} />}
      <Modal titulo="Etiquetas" aberto={!!etiquetas} onFechar={() => setEtiquetas(null)} largura="lg"
        rodape={<><button className="btn" onClick={() => setEtiquetas(null)}>Fechar</button><button className="btn btn-primary" onClick={() => window.print()}>Imprimir</button></>}>
        <div className="print-area etiquetas">
          {etiquetas?.map((e) => (
            <div key={e.itemId} className="etiqueta">
              <div className="etq-desc">{e.descricao}</div>
              <Barcode value={e.codigo} />
              <div className="etq-rodape"><code>{e.codigo}</code><strong>{formatMoney(e.preco)}</strong></div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

type Modo = 'NOVO' | 'EXISTENTE' | 'CATEGORIA';

/** Campos opcionais do produto (P-06): ficam recolhidos para o cadastro no balcão ser rápido. */
function MaisDetalhes({ p, set }: { p: Partial<CamposProduto>; set: (c: Partial<CamposProduto>) => void }) {
  const campo = (k: 'modelo' | 'marca' | 'tipo' | 'tamanho' | 'cor' | 'condicao', rotulo: string, max = 60) => (
    <Field label={rotulo}><input value={p[k] ?? ''} maxLength={max} onChange={(e) => set({ [k]: e.target.value })} /></Field>
  );
  return (
    <details className="mais-detalhes">
      <summary>Mais detalhes (opcional)</summary>
      <div className="grid-2">
        {campo('marca', 'Marca')}{campo('modelo', 'Modelo')}
        {campo('tipo', 'Tipo')}{campo('tamanho', 'Tamanho', 30)}
        {campo('cor', 'Cor', 30)}{campo('condicao', 'Condição (novo, seminovo, usado…)', 30)}
        <Field label="Ano"><input inputMode="numeric" value={p.ano ?? ''} onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); set({ ano: d ? Number(d) : undefined }); }} /></Field>
      </div>
    </details>
  );
}

function FormCadastrar({ loteId, tipoLote, categorias, onOk }: { loteId: string; tipoLote: TipoEntrada; categorias: Categoria[]; onOk: () => Promise<void> }) {
  const compra = tipoLote === 'COMPRA';
  const [modo, setModo] = useState<Modo>('NOVO');
  const [categoriaId, setCategoriaId] = useState('');
  const [qtd, setQtd] = useState('1');
  const [destino, setDestino] = useState<LocalEstoque>('BAZAR');
  /** Valor atribuído UNITÁRIO (RN-33): obrigatório no produto; por categoria, em branco = o preço (exceto compra). */
  const [valorAtribuido, setValorAtribuido] = useState('');
  const [prod, setProd] = useState<Partial<CamposProduto>>({});
  const [preco, setPreco] = useState('');
  const [escolhido, setEscolhido] = useState<ProdutoBusca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [id, setId] = useState(uuid); // o mesmo id até dar certo: reenvio não duplica

  const cat = categorias.find((c) => c.id === (modo === 'EXISTENTE' ? escolhido?.categoriaId : categoriaId));
  const pecaUnica = modo === 'NOVO' && !!prod.pecaUnica;
  const q = pecaUnica ? 1 : Number.parseInt(qtd, 10);
  const precoCents = modo === 'CATEGORIA' ? (tryCents(preco) ?? (cat ? toCents(cat.precoPadrao) : null)) : modo === 'NOVO' ? tryCents(preco) : escolhido ? toCents(escolhido.preco) : null;
  const atribuidoDigitado = valorAtribuido.trim() ? tryCents(valorAtribuido) : null;
  const atribuidoInvalido = valorAtribuido.trim() !== '' && (atribuidoDigitado === null || atribuidoDigitado < 0);
  const atribuidoCents = atribuidoDigitado ?? (modo === 'CATEGORIA' && !compra ? precoCents : null);
  const valido = !!cat && Number.isInteger(q) && q > 0 && !atribuidoInvalido && atribuidoCents !== null && (!compra || atribuidoCents > 0)
    && (modo === 'CATEGORIA' ? precoCents !== null && precoCents > 0
      : modo === 'NOVO' ? !!prod.tituloEtiqueta?.trim() && !!prod.nome?.trim() && precoCents !== null && precoCents > 0
        : !!escolhido && !escolhido.pecaUnica);

  function limpar() { setQtd('1'); setValorAtribuido(''); setProd({}); setPreco(''); setEscolhido(null); setId(uuid()); }

  async function cadastrar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      const base = { id, categoriaId: cat!.id, quantidade: q, valorAtribuido: fromCents(atribuidoCents!), localDestino: destino };
      if (modo === 'CATEGORIA') await lotesApi.cadastrarItem(loteId, { ...base, controle: 'CATEGORIA', preco: fromCents(precoCents!) });
      else if (modo === 'EXISTENTE') await lotesApi.cadastrarItem(loteId, { ...base, controle: 'ETIQUETADO', produtoId: escolhido!.id });
      else {
        const p = { ...prod, tituloEtiqueta: prod.tituloEtiqueta!.trim(), nome: prod.nome!.trim(), preco: fromCents(precoCents!), pecaUnica } as CamposProduto;
        await lotesApi.cadastrarItem(loteId, { ...base, controle: 'ETIQUETADO', produto: p });
      }
      limpar();
      await onOk();
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <form className="card col-aprovar" onSubmit={cadastrar}>
      <h2>Cadastrar</h2>
      <div className="modo-cadastro" role="radiogroup" aria-label="O que cadastrar">
        <label className="check"><input type="radio" checked={modo === 'NOVO'} onChange={() => { setModo('NOVO'); setErro(null); }} /> Produto novo</label>
        <label className="check"><input type="radio" checked={modo === 'EXISTENTE'} onChange={() => { setModo('EXISTENTE'); setErro(null); }} /> Produto que já existe</label>
        <label className="check"><input type="radio" checked={modo === 'CATEGORIA'} onChange={() => { setModo('CATEGORIA'); setErro(null); }} /> Por categoria</label>
      </div>

      {modo === 'EXISTENTE'
        ? <BuscaProduto escolhido={escolhido} onEscolher={setEscolhido} />
        : <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Selecione…</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>}

      {modo === 'NOVO' && <>
        <Field label="Título da etiqueta (curto)" hint="Vai impresso na etiqueta, até 40 letras."><input value={prod.tituloEtiqueta ?? ''} maxLength={40} onChange={(e) => setProd({ ...prod, tituloEtiqueta: e.target.value })} /></Field>
        <Field label="Nome do produto"><input value={prod.nome ?? ''} maxLength={120} onChange={(e) => setProd({ ...prod, nome: e.target.value })} /></Field>
        <Field label="Preço de venda (R$)"><input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={!!prod.pecaUnica} onChange={(e) => setProd({ ...prod, pecaUnica: e.target.checked })} /> Peça única (só 1 unidade, não recebe nova entrada)</label>
        <MaisDetalhes p={prod} set={(c) => setProd({ ...prod, ...c })} />
      </>}
      {modo === 'CATEGORIA' && (
        <Field label="Preço (R$)" hint={cat ? `Sugerido pela categoria: ${formatMoney(cat.precoPadrao)}` : undefined}>
          <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder={cat ? cat.precoPadrao.replace('.', ',') : ''} />
        </Field>
      )}
      {!pecaUnica && <Field label="Quantidade"><input inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>}
      <Field label="Valor atribuído (unitário, R$)" erro={atribuidoInvalido ? 'Valor inválido' : null}
        hint={compra ? 'Lote de compra: informe o custo unitário pago (obrigatório).' : modo === 'CATEGORIA' ? 'Usado na prestação de contas. Em branco = mesmo valor do preço.' : 'Usado na prestação de contas (obrigatório).'}>
        <input inputMode="decimal" value={valorAtribuido} onChange={(e) => setValorAtribuido(e.target.value)} placeholder={compra ? 'Custo unitário' : ''} />
      </Field>
      <Field label="Estoque de destino (na aprovação)"><select value={destino} onChange={(e) => setDestino(e.target.value as LocalEstoque)}><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
      {cat && atribuidoCents !== null && Number.isInteger(q) && <p className="muted">Valor atribuído total: {formatMoney(atribuidoCents * q)}</p>}
      <ErrorAlert erro={erro} />
      <button className="btn btn-primary btn-lg btn-block" disabled={!valido || enviando}>Cadastrar (aguarda aprovação)</button>
    </form>
  );
}

/** Busca o produto pelo código ou pelo nome para a nova entrada (S2-08). Peça única não recebe nova entrada. */
function BuscaProduto({ escolhido, onEscolher }: { escolhido: ProdutoBusca | null; onEscolher: (p: ProdutoBusca | null) => void }) {
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<ProdutoBusca[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) { setAchados([]); return; }
    let vivo = true;
    const t = setTimeout(() => { lotesApi.buscarProdutos(termo).then((r) => { if (vivo) { setAchados(r.items); setErro(null); } }).catch((e) => { if (vivo) setErro(errorMessage(e)); }); }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca]);
  if (escolhido) return (
    <div className="card">
      <strong>{escolhido.codigo} — {escolhido.nome}</strong>
      <p className="muted">{escolhido.categoriaNome} · {formatMoney(escolhido.preco)} · {escolhido.saldoBazar} no Bazar, {escolhido.saldoDoacoes} em Doações</p>
      {escolhido.pecaUnica && <ErrorAlert erro="Peça única não recebe nova entrada: cadastre um produto novo." />}
      <button type="button" className="btn btn-sm" onClick={() => onEscolher(null)}>Trocar produto</button>
    </div>
  );
  return (
    <>
      <Field label="Buscar produto (código ou nome)"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="BZ000123 ou caneca" /></Field>
      <ErrorAlert erro={erro} />
      {achados.length > 0 && (
        <ul className="lista-escolha">
          {achados.map((p) => <li key={p.id}><button type="button" className="btn btn-block" onClick={() => onEscolher(p)}>{p.codigo} — {p.nome} · {formatMoney(p.preco)}{p.pecaUnica ? ' · peça única' : ''}</button></li>)}
        </ul>
      )}
      {busca.trim().length >= 2 && !achados.length && !erro && <small className="hint">Nenhum produto encontrado.</small>}
    </>
  );
}

/** Correção do estoquista (item cadastrado ou devolvido). Os dados do produto só mudam aqui se ele nasceu nesta entrada. */
function CorrigirModal({ loteId, compra, item, onFechar, onOk }: { loteId: string; compra: boolean; item: ItemLote; onFechar: () => void; onOk: () => Promise<void> }) {
  const [qtd, setQtd] = useState(String(item.quantidade));
  const [valor, setValor] = useState((item.valorAtribuido ?? '').replace('.', ','));
  const [destino, setDestino] = useState<LocalEstoque>(item.localDestino);
  const [titulo, setTitulo] = useState(item.produto?.tituloEtiqueta ?? '');
  const [nome, setNome] = useState(item.produto?.nome ?? '');
  const [preco, setPreco] = useState(item.produto?.preco.replace('.', ',') ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pecaUnica = !!item.produto?.pecaUnica;
  const q = Number.parseInt(qtd, 10);
  const valorCents = tryCents(valor);
  const precoCents = item.produto ? tryCents(preco) : null;
  const valido = Number.isInteger(q) && q > 0 && (!pecaUnica || q === 1) && valorCents !== null && (compra ? valorCents > 0 : valorCents >= 0)
    && (!item.produto || (titulo.trim() && nome.trim() && precoCents !== null && precoCents > 0));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      const p = item.produto;
      const mudouProduto = p && (titulo.trim() !== p.tituloEtiqueta || nome.trim() !== p.nome || fromCents(precoCents!) !== p.preco);
      await lotesApi.corrigirItem(loteId, item.id, {
        quantidade: q, valorAtribuido: fromCents(valorCents!), localDestino: destino,
        ...(mudouProduto ? { produto: { tituloEtiqueta: titulo.trim(), nome: nome.trim(), preco: fromCents(precoCents!) } } : {}),
      });
      await onOk();
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Corrigir — ${item.descricao}`} aberto onFechar={onFechar}
      rodape={<><button type="button" className="btn" onClick={onFechar}>Cancelar</button><button type="submit" form="form-corrigir" className="btn btn-primary" disabled={!valido || enviando}>{item.status === 'DEVOLVIDO' ? 'Corrigir e reenviar' : 'Salvar'}</button></>}>
      <form id="form-corrigir" onSubmit={salvar}>
        {item.motivoDevolucao && <p className="alert alert-info">Motivo da devolução: {item.motivoDevolucao}</p>}
        {item.produto && <>
          <Field label="Título da etiqueta"><input value={titulo} maxLength={40} onChange={(e) => setTitulo(e.target.value)} /></Field>
          <Field label="Nome do produto"><input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field label="Preço de venda (R$)" hint="Se o produto já tiver outras entradas, o preço muda pela tela do produto."><input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></Field>
        </>}
        <Field label="Quantidade" hint={pecaUnica ? 'Peça única: 1 unidade.' : undefined}><input inputMode="numeric" value={qtd} disabled={pecaUnica} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
        <Field label="Valor atribuído (unitário, R$)" hint={compra ? 'Lote de compra: o custo unitário pago (maior que zero).' : undefined}><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        <Field label="Estoque de destino"><select value={destino} onChange={(e) => setDestino(e.target.value as LocalEstoque)}><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
        <ErrorAlert erro={erro} />
      </form>
    </Modal>
  );
}

function FormDescartar({ loteId, categorias, motivos, onOk }: { loteId: string; categorias: { id: string; nome: string }[]; motivos: { id: string; nome: string }[]; onOk: () => Promise<void> }) {
  const [categoriaId, setCategoriaId] = useState('');
  const [motivoId, setMotivoId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function descartar(e: FormEvent) {
    e.preventDefault();
    if (!categoriaId || !motivoId) return;
    setEnviando(true); setErro(null);
    try { await lotesApi.descartar(loteId, { id: uuid(), categoriaId, motivoId }); await onOk(); }
    catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }
  return (
    <form className="card col-descartar" onSubmit={descartar}>
      <h2>Descartar</h2>
      <p className="muted">Um registro por item. Itens descartados nunca entram no estoque.</p>
      <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Selecione…</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
      <Field label="Motivo"><select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}><option value="">Selecione…</option>{motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Field>
      <ErrorAlert erro={erro} />
      <button className="btn btn-danger btn-lg btn-block" disabled={!categoriaId || !motivoId || enviando}>Descartar 1 item</button>
    </form>
  );
}
