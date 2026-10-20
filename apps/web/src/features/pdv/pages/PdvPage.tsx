/**
 * PDV — tela cheia, operável só com teclado e leitor (RNF-01/02).
 * Atalhos: F2 categoria · F4 pagamento · Esc remove último item · F6 sangria/suprimento.
 * A venda é gravada direto no servidor (idempotente pelo id: reenviar não duplica).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePdvSessao } from '../hooks/usePdvSessao';
import { paraItensRequest, subtotalCents, type LinhaCarrinho } from '../carrinho';
import { PagamentoModal, type ResultadoPagamento } from '../components/PagamentoModal';
import { RemoverQuantidadeModal } from '../components/RemoverQuantidadeModal';
import { CpfModal, type DecisaoCpf } from '../components/CpfModal';
import { ResumoCaixaModal } from '../../caixa/components/ResumoCaixaModal';
import { ComprovanteModal } from '../components/ComprovanteModal';
import { LancamentoModal } from '../../caixa/components/LancamentoModal';
import { ApiError } from '../../../shared/api/http';
import { estoqueApi } from '../../estoque/estoque.api';
import { pdvApi } from '../pdv.api';
import type { Venda, VendaRequest } from '../../../shared/api/types';
import { formatMoney, fromCents, toCents } from '../../../shared/lib/money';
import { cpfOculto } from '../../../shared/lib/cpf';
import { uuid } from '../../../shared/lib/uuid';
import { beep } from '../../../shared/lib/feedback';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { BrandMark } from '../../../shared/components/BrandMark';
import { useToast } from '../../../shared/components/Toast';

/** O que fica guardado no aparelho: o carrinho, de quem o montou, e o id da venda em andamento. */
interface CarrinhoSalvo { usuarioId: string; vendaId?: string; linhas: LinhaCarrinho[] }

/** Lê o carrinho guardado no aparelho; só vale se foi montado por este mesmo operador (senão é apagado). */
function restaurarCarrinho(usuarioId?: string): CarrinhoSalvo {
  const salvo = armazenamento.ler<CarrinhoSalvo>(CHAVES.carrinho);
  if (salvo && usuarioId && salvo.usuarioId === usuarioId && Array.isArray(salvo.linhas) && salvo.linhas.length) return salvo;
  if (salvo) armazenamento.apagar(CHAVES.carrinho);
  return { usuarioId: usuarioId ?? '', linhas: [] };
}

export function PdvPage() {
  const { me, can } = useAuth();
  const sessao = usePdvSessao();
  const toast = useToast();
  const nav = useNavigate();

  // Carrinho preservado no aparelho (sessão expirada / recarga da página), de QUEM o montou: outro operador não herda o carrinho.
  // O id da venda em andamento também fica guardado: se a resposta se perder e a página recarregar, o reenvio não duplica a venda.
  // A restauração é síncrona (estado inicial), não por efeito: efeito rodaria com o carrinho vazio e sobrescreveria o que está salvo.
  const restaurado = useRef<CarrinhoSalvo | null>(null);
  if (restaurado.current === null) restaurado.current = restaurarCarrinho(me?.id);
  const [linhas, setLinhas] = useState<LinhaCarrinho[]>(restaurado.current.linhas);
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [msgLeitura, setMsgLeitura] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pagando, setPagando] = useState(false);
  // CPF da compra: null = ainda não perguntado; false = sem CPF; objeto = com CPF. Fica SÓ na memória (nunca vai para o aparelho).
  const [cpfSel, setCpfSel] = useState<null | false | { cpf: string; saldoCents: number | null }>(null);
  const cpfAtual = useRef<null | false | { cpf: string; saldoCents: number | null }>(null);
  const [cpfAberto, setCpfAberto] = useState(false);
  const acaoPendente = useRef<(() => void) | null>(null);
  /** Código bipado que está esperando a resposta do CPF: se a pergunta for cancelada, volta para a caixa de leitura. */
  const codigoPendente = useRef<string | null>(null);
  const [lancando, setLancando] = useState(false);
  const [resumindo, setResumindo] = useState(false);
  const [removendo, setRemovendo] = useState<LinhaCarrinho | null>(null);
  const [comprovante, setComprovante] = useState<Venda | null>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);
  /** Id da venda em andamento: mantido entre tentativas para o reenvio não duplicar a venda. */
  const vendaId = useRef<string | null>(restaurado.current.vendaId ?? null);
  const linhasGravadas = useRef(restaurado.current.linhas);

  // Carrinho vazio = venda nova: pergunta o CPF de novo no próximo bip. Carrinho restaurado depois do F5 (o CPF não fica no aparelho): pergunta já.
  useEffect(() => { if (linhas.length === 0) { cpfAtual.current = null; setCpfSel(null); } }, [linhas.length]);
  useEffect(() => { if ((restaurado.current?.linhas.length ?? 0) > 0) setCpfAberto(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const modalAberto = pagando || lancando || resumindo || !!removendo || !!comprovante || cpfAberto;
  const focarCodigo = useCallback(() => { setTimeout(() => codigoRef.current?.focus(), 0); }, []);

  useEffect(() => {
    if (!me) return;
    // Só uma troca de carrinho feita pelo operador (nova referência) zera o id da venda; remontar o efeito não zera.
    if (linhasGravadas.current !== linhas) { vendaId.current = null; linhasGravadas.current = linhas; }
    armazenamento.gravar(CHAVES.carrinho, { usuarioId: me.id, vendaId: vendaId.current ?? undefined, linhas } satisfies CarrinhoSalvo);
  }, [linhas, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Atalhos de teclado globais.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalAberto) return;
      if (e.key === 'F2') { e.preventDefault(); qtdRef.current?.focus(); qtdRef.current?.select(); }
      else if (e.key === 'F4') { e.preventDefault(); if (linhas.length) exigirCpf(() => setPagando(true)); }
      else if (e.key === 'F6') { e.preventDefault(); setLancando(true); }
      else if (e.key === 'Escape') {
        // Quem está digitando só quer limpar o campo: nunca apaga item do carrinho por engano.
        const el = document.activeElement;
        if (el instanceof HTMLInputElement && el.value !== '') {
          e.preventDefault();
          if (el === codigoRef.current) setCodigo(''); else if (el === qtdRef.current) setQtd('1'); else el.blur();
        } else { e.preventDefault(); removerUltimo(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (!modalAberto) focarCodigo(); }, [modalAberto, focarCodigo]);

  if (sessao.terminalDesativado) {
    return <div className="center-page"><div className="alert alert-error" role="alert">Este terminal foi desativado.</div><Link to="/" className="btn">Voltar</Link></div>;
  }
  if (sessao.semCaixa) return <Navigate to="/pdv/abrir" replace />;
  if (sessao.carregando) return <div className="center-page">Carregando PDV…</div>;
  if (sessao.erro || !sessao.caixa || !sessao.catalogo) {
    return <div className="center-page"><div className="alert alert-error" role="alert">{sessao.erro ?? 'Não foi possível carregar o PDV.'}</div><Link to="/" className="btn">Voltar</Link></div>;
  }
  const caixa = sessao.caixa;
  const catalogo = sessao.catalogo;
  const limiteDescontoPct = me ? toCents(me.limiteDesconto) / 100 : 0;
  const subtotal = subtotalCents(linhas);
  /** Quanto da categoria já está no carrinho (linhas da mesma categoria somadas). */
  const emCarrinho = (categoriaId: string) => linhas.filter((l) => l.categoriaId === categoriaId).reduce((s, l) => s + l.quantidade, 0);

  function feedback(tipo: 'ok' | 'erro', texto: string) { beep(tipo); setMsgLeitura({ tipo, texto }); }

  /** Pergunta o CPF antes de seguir quando ainda não foi decidido nesta venda (primeiro bip, primeira categoria ou pagamento). */
  function exigirCpf(acao: () => void, codigoLido?: string) {
    if (cpfAtual.current !== null) { acao(); return; }
    acaoPendente.current = acao; codigoPendente.current = codigoLido ?? null; setCpfAberto(true);
  }
  function aoDecidirCpf(d: DecisaoCpf) {
    const novo = d.tipo === 'sem' ? false : { cpf: d.cpf, saldoCents: d.saldoCents };
    cpfAtual.current = novo; setCpfSel(novo); setCpfAberto(false);
    const acao = acaoPendente.current; acaoPendente.current = null; codigoPendente.current = null;
    if (acao) setTimeout(acao, 0); else focarCodigo();
  }
  function cancelarCpf() {
    if (codigoPendente.current) setCodigo(codigoPendente.current); // o item bipado não se perde
    acaoPendente.current = null; codigoPendente.current = null; setCpfAberto(false); focarCodigo();
  }
  /** O CPF só pode comprar até o saldo do mês: bloqueia o que passar (o servidor confere de novo ao gravar). */
  function cabeNoSaldoCpf(valorNovoCents: number): boolean {
    const c = cpfAtual.current;
    if (!c || c.saldoCents === null) return true;
    if (subtotal + valorNovoCents <= c.saldoCents) return true;
    feedback('erro', `Este CPF só pode comprar mais ${formatMoney(Math.max(0, c.saldoCents - subtotal))} neste mês (saldo de ${formatMoney(c.saldoCents)}).`);
    return false;
  }

  function lerCodigo(e: FormEvent) {
    e.preventDefault();
    const c = codigo.trim().toUpperCase();
    setCodigo('');
    if (!c) return;
    exigirCpf(() => void lerCodigoAgora(c), c); // o primeiro bip da venda pergunta o CPF; o item lido espera a resposta
  }

  async function lerCodigoAgora(c: string) {
    if (linhas.some((l) => l.codigo === c)) { feedback('erro', `A peça ${c} já está no carrinho.`); return; }
    let item = catalogo.itensEtiquetados.find((i) => i.codigo === c);
    let foraDoBazar = false;
    if (!item) {
      // Peça fora do catálogo carregado (cadastrada depois): confirma no servidor.
      try {
        const r = await estoqueApi.porCodigo(c);
        if (r.controle === 'ETIQUETADO' && r.saldoBazar > 0) item = { itemId: r.id, codigo: r.codigo!, descricao: r.descricao, preco: r.preco };
        else if (r.saldoDoacoes > 0) foraDoBazar = true;
      } catch { /* trata abaixo como não encontrado */ }
    }
    if (!item) { feedback('erro', foraDoBazar ? `A peça ${c} está no estoque de Doações e não pode ser vendida.` : `Código ${c} não encontrado ou sem saldo no Bazar.`); return; }
    const it = item;
    if (!cabeNoSaldoCpf(toCents(it.preco))) return;
    setLinhas((ls) => [...ls, { key: uuid(), tipo: 'codigo', codigo: it.codigo, descricao: it.descricao, precoCents: toCents(it.preco), quantidade: 1 }]);
    feedback('ok', `${it.descricao} — ${formatMoney(it.preco)}`);
  }

  function adicionarCategoria(categoriaId: string) { exigirCpf(() => adicionarCategoriaAgora(categoriaId)); }

  function adicionarCategoriaAgora(categoriaId: string) {
    const cat = catalogo.categorias.find((c) => c.id === categoriaId)!;
    const q = Math.max(1, Math.min(999, Number.parseInt(qtd, 10) || 1));
    // O PDV não deixa vender mais do que há no estoque do Bazar: avisa a quantidade e bloqueia (o servidor confere de novo ao gravar).
    const jaNoCarrinho = emCarrinho(categoriaId);
    const restam = cat.saldoBazar - jaNoCarrinho;
    if (q > restam) {
      feedback('erro', restam <= 0
        ? `Sem estoque de ${cat.nome} no Bazar: há ${cat.saldoBazar}${jaNoCarrinho ? ` e ${jaNoCarrinho} já estão no carrinho` : ''}.`
        : `Só há ${cat.saldoBazar} de ${cat.nome} no Bazar${jaNoCarrinho ? ` (${jaNoCarrinho} já no carrinho)` : ''}: dá para adicionar no máximo ${restam}.`);
      void sessao.recarregarCatalogo().catch(() => {}); // o estoque pode ter mudado desde que o PDV abriu
      focarCodigo();
      return;
    }
    if (!cabeNoSaldoCpf(toCents(cat.precoPadrao) * q)) { focarCodigo(); return; }
    setLinhas((ls) => {
      const existente = ls.find((l) => l.categoriaId === categoriaId);
      if (existente) return ls.map((l) => (l === existente ? { ...l, quantidade: l.quantidade + q } : l));
      return [...ls, { key: uuid(), tipo: 'categoria', categoriaId, descricao: cat.nome, precoCents: toCents(cat.precoPadrao), quantidade: q }];
    });
    feedback('ok', `${q}× ${cat.nome}`);
    setQtd('1');
    focarCodigo();
  }

  /** Esc: tira UMA unidade da última linha (a linha some quando chega a zero). */
  function removerUltimo() {
    setLinhas((ls) => {
      const ultima = ls[ls.length - 1];
      if (!ultima) return ls;
      return ultima.quantidade > 1 ? [...ls.slice(0, -1), { ...ultima, quantidade: ultima.quantidade - 1 }] : ls.slice(0, -1);
    });
    focarCodigo();
  }
  /** ✕: peça única sai inteira; linha com várias unidades pergunta quantas tirar. */
  function iniciarRemocao(l: LinhaCarrinho) {
    if (l.tipo === 'codigo' || l.quantidade <= 1) { setLinhas((ls) => ls.filter((x) => x.key !== l.key)); focarCodigo(); }
    else setRemovendo(l);
  }
  function tirarQuantidade(l: LinhaCarrinho, n: number) {
    setLinhas((ls) => ls.flatMap((x) => (x.key !== l.key ? [x] : n >= x.quantidade ? [] : [{ ...x, quantidade: x.quantidade - n }])));
    setRemovendo(null); focarCodigo();
  }

  /** Finaliza: grava direto no servidor. O mesmo id é reaproveitado se a tentativa falhar e for repetida. */
  async function finalizar(pg: ResultadoPagamento) {
    if (!vendaId.current) {
      vendaId.current = uuid();
      if (me) armazenamento.gravar(CHAVES.carrinho, { usuarioId: me.id, vendaId: vendaId.current, linhas } satisfies CarrinhoSalvo);
    }
    let venda: Venda;
    try {
      venda = await pdvApi.registrarVenda(vendaId.current, {
        terminalId: caixa.terminalId, caixaId: caixa.id,
        itens: paraItensRequest(linhas), pagamentos: pg.pagamentos,
        ...(cpfAtual.current ? { cpf: cpfAtual.current.cpf } : {}),
        ...(pg.descontoCents ? { desconto: fromCents(pg.descontoCents) } : {}),
        ...(pg.clienteId ? { clienteId: pg.clienteId, vencimentoFiado: pg.vencimentoFiado } : {}),
      } satisfies VendaRequest);
    } catch (e) {
      // Outro caixa vendeu antes: o estoque mudou. Atualiza o catálogo, fecha o pagamento e deixa o operador ajustar o carrinho.
      if (e instanceof ApiError && ['SALDO_INSUFICIENTE', 'ITEM_INDISPONIVEL', 'ITEM_EM_DOACOES'].includes(e.code ?? '')) {
        void sessao.recarregarCatalogo().catch(() => {});
        setPagando(false);
        feedback('erro', `O estoque mudou e a venda não foi gravada: ${e.message}. Ajuste o carrinho (use o ✕) e tente de novo.`);
        return;
      }
      throw e;
    }
    // Atualiza o catálogo carregado: tira as peças vendidas (não vender a mesma peça duas vezes) e baixa o saldo das categorias.
    const vendidos = new Set(linhas.filter((l) => l.codigo).map((l) => l.codigo));
    const porCategoria = new Map<string, number>();
    for (const l of linhas) if (l.categoriaId) porCategoria.set(l.categoriaId, (porCategoria.get(l.categoriaId) ?? 0) + l.quantidade);
    sessao.atualizarCatalogo((c) => ({
      ...c, itensEtiquetados: c.itensEtiquetados.filter((i) => !vendidos.has(i.codigo)),
      categorias: c.categorias.map((cat) => ({ ...cat, saldoBazar: cat.saldoBazar - (porCategoria.get(cat.id) ?? 0) })),
    }));
    void sessao.recarregarCatalogo().catch(() => {}); // sincroniza com vendas de outros terminais
    setLinhas([]);
    cpfAtual.current = null; setCpfSel(null); // a próxima venda pergunta o CPF de novo
    setPagando(false);
    setComprovante(venda);
    setMsgLeitura(null);
  }

  return (
    <div className="pdv">
      <header className="pdv-header">
        <BrandMark subtitulo="PDV · Bazar" tamanho={34} />
        <span className="terminal"><strong>{caixa.terminalNome}</strong><small>{me?.nome}</small></span>
        {cpfSel && (
          <span className="badge badge-ok" title="CPF desta compra">
            CPF {cpfOculto(cpfSel.cpf)}{cpfSel.saldoCents !== null && ` · saldo ${formatMoney(Math.max(0, cpfSel.saldoCents - subtotal))}`}
          </span>
        )}
        {(cpfSel !== null || linhas.length > 0) && <button className="btn btn-ghost" onClick={() => { acaoPendente.current = null; codigoPendente.current = null; setCpfAberto(true); }}>{cpfSel ? 'Trocar CPF' : 'Informar CPF'}</button>}
        <div className="spacer" />
        <button className="btn" onClick={() => setResumindo(true)}>Total do caixa</button>
        <button className="btn" onClick={() => setLancando(true)}>Sangria/Suprimento (F6)</button>
        <button className="btn" onClick={() => nav('/pdv/fechar')}>Fechar caixa</button>
        {can('estoque.consultar', 'relatorios.consultar', 'entrada.registrar', 'contas_receber.receber') && <Link className="btn btn-ghost" to="/">Backoffice</Link>}
      </header>

      <div className="pdv-body">
        <section className="pdv-entrada" aria-label="Entrada de itens">
          <form onSubmit={lerCodigo}>
            <label className="field field-lg">
              <span>Código de barras</span>
              <input ref={codigoRef} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus autoComplete="off" inputMode="text" aria-describedby="msg-leitura" placeholder="Passe o leitor ou digite e tecle Enter" maxLength={40} />
            </label>
          </form>
          <div id="msg-leitura" className={`leitura ${msgLeitura?.tipo ?? ''}`} aria-live="assertive">{msgLeitura?.texto ?? ' '}</div>

          <div className="cat-header">
            <h2>Venda por categoria (F2)</h2>
            <label className="field field-inline"><span>Qtd.</span>
              <input ref={qtdRef} value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="qtd" />
            </label>
          </div>
          <div className="cat-grid">
            {catalogo.categorias.map((c) => {
              const restam = c.saldoBazar - emCarrinho(c.id);
              return (
                <button key={c.id} className="btn cat-btn" onClick={() => adicionarCategoria(c.id)} disabled={restam <= 0} title={restam <= 0 ? 'Sem estoque no Bazar' : undefined}>
                  <span>{c.nome}</span><strong>{formatMoney(c.precoPadrao)}</strong>
                  <small>{restam <= 0 ? 'sem estoque' : `${restam} em estoque`}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pdv-carrinho" aria-label="Carrinho">
          <h2>Carrinho</h2>
          {linhas.length === 0 ? <p className="empty">Nenhum item. Leia um código ou escolha uma categoria.</p> : (
            <ul className="carrinho">
              {linhas.map((l) => (
                <li key={l.key}>
                  <span className="qtd">{l.quantidade}×</span>
                  <span className="desc">{l.descricao}{l.codigo && <small> · {l.codigo}</small>}</span>
                  <span className="num">{formatMoney(l.precoCents * l.quantidade)}</span>
                  <button className="btn btn-ghost" onClick={() => iniciarRemocao(l)} aria-label={`Tirar ${l.descricao} do carrinho`}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="carrinho-total"><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>
          <small className="hint">Valores conferidos pelo servidor ao gravar.</small>
          <div className="row">
            <button className="btn" onClick={removerUltimo} disabled={!linhas.length}>Remover último (Esc)</button>
            <button className="btn btn-primary btn-lg grow" onClick={() => exigirCpf(() => setPagando(true))} disabled={!linhas.length}>Pagamento (F4)</button>
          </div>
        </section>
      </div>

      <PagamentoModal
        aberto={pagando} subtotalCents={subtotal} limiteDescontoPct={limiteDescontoPct}
        clientesLocais={catalogo.clientesFiado}
        onNovoClienteLocal={(c) => sessao.atualizarCatalogo((cat) => ({ ...cat, clientesFiado: [...cat.clientesFiado, c] }))}
        onConfirmar={finalizar}
        onFechar={() => setPagando(false)}
      />
      <CpfModal aberto={cpfAberto} obrigatorio={catalogo.cpfObrigatorio ?? false} carrinhoCents={subtotal} onDecidir={aoDecidirCpf} onCancelar={cancelarCpf} />
      <RemoverQuantidadeModal linha={removendo} onConfirmar={(n) => tirarQuantidade(removendo!, n)} onFechar={() => { setRemovendo(null); focarCodigo(); }} />
      <ResumoCaixaModal aberto={resumindo} caixaId={caixa.id} onFechar={() => setResumindo(false)} />
      <LancamentoModal aberto={lancando} caixaId={caixa.id} onFechar={() => setLancando(false)} onOk={(m) => toast(m)} />
      <ComprovanteModal venda={comprovante} instituicao={sessao.instituicao} onFechar={() => setComprovante(null)} />
    </div>
  );
}
