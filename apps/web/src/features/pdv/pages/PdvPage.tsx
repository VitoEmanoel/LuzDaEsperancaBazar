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
import { ComprovanteModal } from '../components/ComprovanteModal';
import { LancamentoModal } from '../../caixa/components/LancamentoModal';
import { estoqueApi } from '../../estoque/estoque.api';
import { pdvApi } from '../pdv.api';
import type { Venda, VendaRequest } from '../../../shared/api/types';
import { formatMoney, fromCents, toCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { beep } from '../../../shared/lib/feedback';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { BrandMark } from '../../../shared/components/BrandMark';
import { useToast } from '../../../shared/components/Toast';

export function PdvPage() {
  const { me, can } = useAuth();
  const sessao = usePdvSessao();
  const toast = useToast();
  const nav = useNavigate();

  const [linhas, setLinhas] = useState<LinhaCarrinho[]>([]);
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [msgLeitura, setMsgLeitura] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pagando, setPagando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [comprovante, setComprovante] = useState<Venda | null>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);
  const carregouCarrinho = useRef(false);
  /** Id da venda em andamento: mantido entre tentativas para o reenvio não duplicar a venda. */
  const vendaId = useRef<string | null>(null);

  const modalAberto = pagando || lancando || !!comprovante;
  const focarCodigo = useCallback(() => { setTimeout(() => codigoRef.current?.focus(), 0); }, []);

  // Carrinho preservado no aparelho (sessão expirada / recarga da página). Sem dado pessoal.
  useEffect(() => {
    const salvo = armazenamento.ler<LinhaCarrinho[]>(CHAVES.carrinho);
    if (salvo?.length) setLinhas(salvo);
    carregouCarrinho.current = true;
  }, []);
  useEffect(() => {
    if (!carregouCarrinho.current) return;
    armazenamento.gravar(CHAVES.carrinho, linhas);
    vendaId.current = null; // carrinho mudou: próxima tentativa é uma venda nova
  }, [linhas]);

  // Atalhos de teclado globais.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalAberto) return;
      if (e.key === 'F2') { e.preventDefault(); qtdRef.current?.focus(); qtdRef.current?.select(); }
      else if (e.key === 'F4') { e.preventDefault(); if (linhas.length) setPagando(true); }
      else if (e.key === 'F6') { e.preventDefault(); setLancando(true); }
      else if (e.key === 'Escape') { e.preventDefault(); removerUltimo(); }
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

  function feedback(tipo: 'ok' | 'erro', texto: string) { beep(tipo); setMsgLeitura({ tipo, texto }); }

  async function lerCodigo(e: FormEvent) {
    e.preventDefault();
    const c = codigo.trim().toUpperCase();
    setCodigo('');
    if (!c) return;
    if (linhas.some((l) => l.codigo === c)) { feedback('erro', `A peça ${c} já está no carrinho.`); return; }
    let item = catalogo.itensEtiquetados.find((i) => i.codigo === c);
    if (!item) {
      // Peça fora do catálogo carregado (cadastrada depois): confirma no servidor.
      try {
        const r = await estoqueApi.porCodigo(c);
        if (r.controle === 'ETIQUETADO' && r.saldoBazar > 0) item = { itemId: r.id, codigo: r.codigo!, descricao: r.descricao, preco: r.preco };
      } catch { /* trata abaixo como não encontrado */ }
    }
    if (!item) { feedback('erro', `Código ${c} não encontrado ou sem saldo no Bazar.`); return; }
    const it = item;
    setLinhas((ls) => [...ls, { key: uuid(), tipo: 'codigo', codigo: it.codigo, descricao: it.descricao, precoCents: toCents(it.preco), quantidade: 1 }]);
    feedback('ok', `${it.descricao} — ${formatMoney(it.preco)}`);
  }

  function adicionarCategoria(categoriaId: string) {
    const cat = catalogo.categorias.find((c) => c.id === categoriaId)!;
    const q = Math.max(1, Math.min(999, Number.parseInt(qtd, 10) || 1));
    setLinhas((ls) => {
      const existente = ls.find((l) => l.categoriaId === categoriaId);
      if (existente) return ls.map((l) => (l === existente ? { ...l, quantidade: l.quantidade + q } : l));
      return [...ls, { key: uuid(), tipo: 'categoria', categoriaId, descricao: cat.nome, precoCents: toCents(cat.precoPadrao), quantidade: q }];
    });
    feedback('ok', `${q}× ${cat.nome}`);
    setQtd('1');
    focarCodigo();
  }

  function removerUltimo() { setLinhas((ls) => ls.slice(0, -1)); focarCodigo(); }
  function remover(key: string) { setLinhas((ls) => ls.filter((l) => l.key !== key)); focarCodigo(); }

  /** Finaliza: grava direto no servidor. O mesmo id é reaproveitado se a tentativa falhar e for repetida. */
  async function finalizar(pg: ResultadoPagamento) {
    vendaId.current ??= uuid();
    const venda: Venda = await pdvApi.registrarVenda(vendaId.current, {
      terminalId: caixa.terminalId, caixaId: caixa.id,
      itens: paraItensRequest(linhas), pagamentos: pg.pagamentos,
      ...(pg.descontoCents ? { desconto: fromCents(pg.descontoCents) } : {}),
      ...(pg.clienteId ? { clienteId: pg.clienteId, vencimentoFiado: pg.vencimentoFiado } : {}),
    } satisfies VendaRequest);
    // Tira do catálogo carregado as peças vendidas para não vender a mesma peça duas vezes neste terminal.
    const vendidos = new Set(linhas.filter((l) => l.codigo).map((l) => l.codigo));
    sessao.atualizarCatalogo((c) => ({ ...c, itensEtiquetados: c.itensEtiquetados.filter((i) => !vendidos.has(i.codigo)) }));
    setLinhas([]);
    setPagando(false);
    setComprovante(venda);
    setMsgLeitura(null);
  }

  return (
    <div className="pdv">
      <header className="pdv-header">
        <BrandMark subtitulo="PDV · Bazar" tamanho={34} />
        <span className="terminal"><strong>{caixa.terminalNome}</strong><small>{me?.nome}</small></span>
        <div className="spacer" />
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
            {catalogo.categorias.map((c) => (
              <button key={c.id} className="btn cat-btn" onClick={() => adicionarCategoria(c.id)}>
                <span>{c.nome}</span><strong>{formatMoney(c.precoPadrao)}</strong>
              </button>
            ))}
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
                  <button className="btn btn-ghost" onClick={() => remover(l.key)} aria-label={`Remover ${l.descricao}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="carrinho-total"><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>
          <small className="hint">Valores conferidos pelo servidor ao gravar.</small>
          <div className="row">
            <button className="btn" onClick={removerUltimo} disabled={!linhas.length}>Remover último (Esc)</button>
            <button className="btn btn-primary btn-lg grow" onClick={() => setPagando(true)} disabled={!linhas.length}>Pagamento (F4)</button>
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
      <LancamentoModal aberto={lancando} caixaId={caixa.id} onFechar={() => setLancando(false)} onOk={(m) => toast(m)} />
      <ComprovanteModal venda={comprovante} instituicao={sessao.instituicao} onFechar={() => setComprovante(null)} />
    </div>
  );
}
