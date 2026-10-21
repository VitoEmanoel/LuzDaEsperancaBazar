/**
 * PDV — tela cheia, operável só com teclado e leitor (RNF-01/02).
 * Atalhos: F2 quantidade · F4 pagamento · Esc tira 1 do último item (pergunta antes) · F6 sangria/suprimento.
 * Quantidade: o campo Qtd. ao lado do código vale para o próximo bip e volta a 1 depois dele (S6-10); `3*BZ000123` no campo
 * do código também lança 3 de uma vez e manda mais que o Qtd. (S4-09). A câmera lê um código por vez, como o leitor (S5-12).
 * A venda por categoria saiu da tela (S6-09); a API continua aceitando a linha, e um carrinho restaurado ainda pode trazê-la.
 * A venda é gravada direto no servidor (idempotente pelo id: reenviar não duplica).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePdvSessao } from '../hooks/usePdvSessao';
import { ajustarAoEstoque, lerEntrada, paraItensRequest, quantidadeDoCampo, subtotalCents, type LinhaCarrinho } from '../carrinho';
import { PagamentoModal, type ResultadoPagamento } from '../components/PagamentoModal';
import { RemoverQuantidadeModal } from '../components/RemoverQuantidadeModal';
import { ConfirmarRemoverUltimoModal } from '../components/ConfirmarRemoverUltimoModal';
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
import { cameraDisponivel, LeitorCameraModal } from '../../../shared/components/LeitorCamera';
import { useMidia } from '../../../shared/hooks/useMidia';

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
  const celular = useMidia('(max-width: 600px)'); // só o texto de ajuda do código muda (S6-12)

  // Carrinho preservado no aparelho (sessão expirada / recarga da página), de QUEM o montou: outro operador não herda o carrinho.
  // O id da venda em andamento também fica guardado: se a resposta se perder e a página recarregar, o reenvio não duplica a venda.
  // A restauração é síncrona (estado inicial), não por efeito: efeito rodaria com o carrinho vazio e sobrescreveria o que está salvo.
  const restaurado = useRef<CarrinhoSalvo | null>(null);
  if (restaurado.current === null) restaurado.current = restaurarCarrinho(me?.id);
  const [linhas, setLinhas] = useState<LinhaCarrinho[]>(restaurado.current.linhas);
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  /** O Qtd. de agora, para quem termina depois (a leitura que espera o servidor não zera o que o operador já digitou). */
  const qtdAtual = useRef(qtd);
  qtdAtual.current = qtd;
  const [msgLeitura, setMsgLeitura] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null);
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
  const [confirmandoUltimo, setConfirmandoUltimo] = useState(false);
  const [comprovante, setComprovante] = useState<Venda | null>(null);
  const [lendoCamera, setLendoCamera] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);
  /** Id da venda em andamento: mantido entre tentativas para o reenvio não duplicar a venda. */
  const vendaId = useRef<string | null>(restaurado.current.vendaId ?? null);
  const linhasGravadas = useRef(restaurado.current.linhas);

  // Carrinho vazio = venda nova: pergunta o CPF de novo no próximo bip. Carrinho restaurado depois do F5 (o CPF não fica no aparelho): pergunta já.
  useEffect(() => { if (linhas.length === 0) { cpfAtual.current = null; setCpfSel(null); } }, [linhas.length]);
  useEffect(() => { if ((restaurado.current?.linhas.length ?? 0) > 0) setCpfAberto(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const modalAberto = pagando || lancando || resumindo || !!removendo || !!comprovante || cpfAberto || lendoCamera || (confirmandoUltimo && linhas.length > 0);
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
        // No Qtd., Esc sempre volta a 1 e leva ao código, mesmo com o campo vazio (não tira item).
        if (el === qtdRef.current) { e.preventDefault(); setQtd('1'); focarCodigo(); }
        else if (el instanceof HTMLInputElement && el.value !== '') {
          e.preventDefault();
          if (el === codigoRef.current) setCodigo(''); else el.blur();
        } else { e.preventDefault(); pedirRemoverUltimo(); }
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

  /** 'aviso' = lançou, mas não o que foi pedido (S6-11): bipe de erro para chamar a atenção, e o texto começa com "Atenção:" (não só a cor). */
  function feedback(tipo: 'ok' | 'erro' | 'aviso', texto: string) { beep(tipo === 'ok' ? 'ok' : 'erro'); setMsgLeitura({ tipo, texto }); }

  /** Pergunta o CPF antes de seguir quando ainda não foi decidido nesta venda (primeiro bip ou pagamento). */
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
    const bruto = codigo.trim().toUpperCase();
    setCodigo('');
    lerTexto(bruto);
  }

  /** O que veio do leitor, do teclado ou da câmera segue o mesmo caminho (inclusive a pergunta do CPF no primeiro bip). */
  function lerTexto(bruto: string) {
    if (!bruto) return;
    const lido = lerEntrada(bruto); // `código` ou `n*código` (S4-09)
    if ('erro' in lido) { feedback('erro', lido.erro); setCodigo(bruto); return; }
    // `n*código` manda; sem ele vale o Qtd. (S6-10). A quantidade é fixada aqui, porque a pergunta do CPF adia a leitura.
    const doCampo = qtd;
    const n = bruto.includes('*') ? lido.quantidade : quantidadeDoCampo(doCampo);
    // o primeiro bip da venda pergunta o CPF; o que foi lido espera a resposta. Lançou: o Qtd. volta a 1 (se ninguém mexeu nele no meio)
    exigirCpf(() => void lerCodigoAgora(lido.codigo, n).then((ok) => { if (ok && qtdAtual.current === doCampo) setQtd('1'); }), bruto);
  }

  /** Lança o código no carrinho; devolve se lançou (erro: avisa e devolve false). */
  async function lerCodigoAgora(c: string, n = 1): Promise<boolean> {
    let item = catalogo.itensEtiquetados.find((i) => i.codigo === c);
    const noCarrinho = linhas.find((l) => l.codigo === c);
    let foraDoBazar = false;
    if (!item) {
      // Peça fora do catálogo carregado (cadastrada depois): confirma no servidor, também no 2º bip antes do catálogo voltar.
      try {
        const r = await estoqueApi.porCodigo(c);
        if (r.controle === 'ETIQUETADO' && r.saldoBazar > 0) {
          item = { itemId: r.id, codigo: r.codigo!, descricao: r.descricao, preco: r.preco, saldoBazar: r.saldoBazar, pecaUnica: !!r.pecaUnica,
            ...(r.precoSemDesconto ? { precoSemDesconto: r.precoSemDesconto } : {}) };
          void sessao.recarregarCatalogo().catch(() => {}); // traz o produto novo (com o saldo e a peça única) para o próximo bip
        }
        else if ((r.saldoDoacoes ?? 0) > 0 || r.estaEmDoacoes) foraDoBazar = true; // o Vendedor recebe só o aviso, não o saldo de Doações (S6-16)
      } catch { /* trata abaixo como não encontrado */ }
    }
    if (!item) {
      feedback('erro', noCarrinho ? `A peça ${c} já está no carrinho.` : foraDoBazar ? `A peça ${c} está no estoque de Doações e não pode ser vendida.` : `Código ${c} não encontrado ou sem saldo no Bazar.`);
      return false;
    }
    const it = item;
    const unica = it.pecaUnica !== false;
    if (unica && noCarrinho) { feedback('erro', `A peça ${c} já está no carrinho (peça única).`); return false; }
    // nunca mais do que há no Bazar: pedido acima do saldo lança o que há e avisa (S6-11, muda a P-18); peça única lança 1.
    // O saldo é o do catálogo carregado: o servidor confere de novo ao gravar.
    const saldo = it.saldoBazar ?? 1;
    const ja = noCarrinho?.quantidade ?? 0;
    const pedido = n;
    if (ja >= saldo) {
      feedback('erro', `Não resta ${it.descricao} no Bazar: ${ja ? `os ${ja} que havia já estão no carrinho` : 'o saldo acabou'}.`);
      return false;
    }
    n = unica ? 1 : Math.min(n, saldo - ja);
    // o saldo do mês do CPF é limite de dinheiro: continua recusando (com a quantidade já ajustada)
    if (!cabeNoSaldoCpf(toCents(it.preco) * n)) return false;
    if (noCarrinho) setLinhas((ls) => ls.map((l) => (l.key === noCarrinho.key ? { ...l, quantidade: l.quantidade + n } : l)));
    else setLinhas((ls) => [...ls, { key: uuid(), tipo: 'codigo', codigo: it.codigo, descricao: it.descricao, precoCents: toCents(it.preco), quantidade: n }]);
    if (n < pedido) {
      feedback('aviso', unica
        ? `Atenção: ${it.descricao} é peça única. Lancei 1 de ${pedido} — ${formatMoney(it.preco)}.`
        : ja
          ? `Atenção: só restavam ${n} de ${it.descricao} no Bazar (há ${saldo}, ${ja} já no carrinho). Lancei ${n} de ${pedido} — ${formatMoney(it.preco)} cada.`
          : `Atenção: só havia ${n} de ${it.descricao} no Bazar. Lancei ${n} de ${pedido}, e o Bazar ficou sem — ${formatMoney(it.preco)} cada.`);
      return true;
    }
    // S4-08: produto, preço de agora (com desconto, S3-10) e quanto sobra no Bazar depois deste carrinho
    const restam = saldo - ja - n;
    feedback('ok', `${ja + n > 1 ? `${ja + n}× ` : ''}${it.descricao} — ${it.precoSemDesconto ? `de ${formatMoney(it.precoSemDesconto)} por ` : ''}${formatMoney(it.preco)}`
      + ` · ${unica ? 'peça única' : restam === 0 ? 'última unidade do Bazar' : `restam ${restam} no Bazar`}`);
    return true;
  }

  /** Esc com o campo vazio e o botão "Remover último" perguntam antes (S4-19). */
  function pedirRemoverUltimo() { if (linhas.length) setConfirmandoUltimo(true); }
  /** Tira UMA unidade da última linha (a linha some quando chega a zero). */
  function removerUltimo() {
    setConfirmandoUltimo(false);
    setLinhas((ls) => {
      const ultima = ls[ls.length - 1];
      if (!ultima) return ls;
      return ultima.quantidade > 1 ? [...ls.slice(0, -1), { ...ultima, quantidade: ultima.quantidade - 1 }] : ls.slice(0, -1);
    });
    focarCodigo();
  }
  /** ✕: peça única sai inteira; linha com várias unidades pergunta quantas tirar. */
  function iniciarRemocao(l: LinhaCarrinho) {
    if (l.quantidade <= 1) { setLinhas((ls) => ls.filter((x) => x.key !== l.key)); focarCodigo(); }
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
      // Outro caixa vendeu antes: o estoque mudou e nada foi gravado. O carrinho vai sozinho ao que há agora e o operador
      // confere o total e recebe de novo (S6-13). Sem reenvio automático: cada tentativa é do operador. Nada mudou no
      // catálogo (corrida entre a consulta e a venda) ou o catálogo não veio: a mensagem de antes, para ajustar no ✕.
      if (e instanceof ApiError && ['SALDO_INSUFICIENTE', 'ITEM_INDISPONIVEL', 'ITEM_EM_DOACOES'].includes(e.code ?? '')) {
        const c = await sessao.recarregarCatalogo().catch(() => null);
        setPagando(false);
        const aj = c ? ajustarAoEstoque(linhas, c) : null;
        if (!aj || (!aj.mudancas.length && !aj.precoMudou)) {
          feedback('erro', `O estoque mudou e a venda não foi gravada: ${e.message}. Ajuste o carrinho (use o ✕) e tente de novo.`);
          return;
        }
        setLinhas(aj.linhas); // linhas novas = venda nova: o id da venda recusada (não gravada) é trocado
        const lista = aj.mudancas.slice(0, 3).join('; ') + (aj.mudancas.length > 3 ? `; e mais ${aj.mudancas.length - 3}` : '');
        feedback('aviso', !aj.linhas.length
          ? `Atenção: o estoque mudou e a venda não foi gravada. Nada do carrinho resta no Bazar (${lista}).`
          : `Atenção: o estoque mudou e a venda não foi gravada. Ajustei o carrinho ao que há agora${lista ? `: ${lista}` : ''}${aj.precoMudou ? '; o preço de algum produto também mudou' : ''}. Confira o total e receba de novo (F4).`);
        return;
      }
      // O preço ou o desconto de um produto mudou com a venda aberta (S3-08, S3-09): o carrinho passa ao preço atual.
      if (e instanceof ApiError && e.code === 'PAGAMENTO_DIVERGENTE') {
        const c = await sessao.recarregarCatalogo().catch(() => null);
        if (c) setLinhas((ls) => ls.map((l) => {
          const p = l.codigo ? c.itensEtiquetados.find((i) => i.codigo === l.codigo)?.preco : c.categorias.find((x) => x.id === l.categoriaId)?.precoPadrao;
          return p ? { ...l, precoCents: toCents(p) } : l;
        }));
        setPagando(false);
        feedback('erro', 'O preço de algum produto mudou (preço novo ou desconto) e a venda não foi gravada. O carrinho já está com o preço de agora: confira o total e receba de novo.');
        return;
      }
      throw e;
    }
    // Atualiza o catálogo carregado: baixa o saldo dos produtos vendidos (peça única sai) e o das categorias.
    const vendidos = new Map(linhas.filter((l) => l.codigo).map((l) => [l.codigo!, l.quantidade]));
    const porCategoria = new Map<string, number>();
    for (const l of linhas) if (l.categoriaId) porCategoria.set(l.categoriaId, (porCategoria.get(l.categoriaId) ?? 0) + l.quantidade);
    sessao.atualizarCatalogo((c) => ({
      ...c, itensEtiquetados: c.itensEtiquetados
        .map((i) => (vendidos.has(i.codigo) ? { ...i, saldoBazar: (i.saldoBazar ?? 1) - vendidos.get(i.codigo)! } : i))
        .filter((i) => (i.saldoBazar ?? 1) > 0 && !(vendidos.has(i.codigo) && i.saldoBazar === undefined)),
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
        {/* no celular e no tablet os botões ganham uma linha só deles, todos da mesma largura (S6-12) */}
        <div className="pdv-acoes">
          <button className="btn" onClick={() => setResumindo(true)}>Total do caixa</button>
          <button className="btn" onClick={() => setLancando(true)} aria-label="Sangria/Suprimento" aria-keyshortcuts="F6">Sangria/<wbr />Suprimento<span className="atalho"> (F6)</span></button>
          <button className="btn" onClick={() => nav('/pdv/fechar')}>Fechar caixa</button>
          {can('estoque.consultar', 'relatorios.consultar', 'entrada.registrar', 'contas_receber.receber') && <Link className="btn btn-ghost" to="/">Backoffice</Link>}
        </div>
      </header>

      <div className="pdv-body">
        <section className="pdv-entrada" aria-label="Entrada de itens">
          <div className="leitura-linha">
            {/* Qtd. fora do form: Enter nele só leva ao código, não lê um código vazio (S6-10) */}
            <label className="field field-lg campo-qtd">
              <span>Qtd. (F2)</span>
              <input ref={qtdRef} value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focarCodigo(); } }}
                onFocus={(e) => e.target.select()} inputMode="numeric" autoComplete="off" className="qtd" aria-describedby="dica-qtd" />
            </label>
            <form onSubmit={lerCodigo}>
              <label className="field field-lg">
                <span>Código de barras</span>
                <input ref={codigoRef} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus autoComplete="off" inputMode="text" aria-describedby="msg-leitura" placeholder={celular ? 'Bipe ou digite o código' : 'Passe o leitor ou digite e tecle Enter'} maxLength={40} />
              </label>
            </form>
          </div>
          <small id="dica-qtd" className="hint">Mais de uma unidade: escreva a quantidade em Qtd. e bipe. Depois do bip, volta a 1.</small>
          {cameraDisponivel() && <button type="button" className="btn" onClick={() => setLendoCamera(true)}>Ler pela câmera</button>}
          <div id="msg-leitura" className={`leitura ${msgLeitura?.tipo ?? ''}`} aria-live="assertive">{msgLeitura?.texto ?? ' '}</div>
        </section>

        <section className="pdv-carrinho" aria-label="Carrinho">
          <h2>Carrinho</h2>
          {linhas.length === 0 ? <p className="empty">Nenhum item. Leia o código da etiqueta.</p> : (
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
            <button className="btn" onClick={pedirRemoverUltimo} disabled={!linhas.length}>Remover último (Esc)</button>
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
      <ConfirmarRemoverUltimoModal linha={confirmandoUltimo ? linhas[linhas.length - 1] ?? null : null} onConfirmar={removerUltimo}
        onFechar={() => { setConfirmandoUltimo(false); focarCodigo(); }} />
      <RemoverQuantidadeModal linha={removendo} onConfirmar={(n) => tirarQuantidade(removendo!, n)} onFechar={() => { setRemovendo(null); focarCodigo(); }} />
      <ResumoCaixaModal aberto={resumindo} caixaId={caixa.id} onFechar={() => setResumindo(false)} />
      <LancamentoModal aberto={lancando} caixaId={caixa.id} onFechar={() => setLancando(false)} onOk={(m) => toast(m)} />
      <LeitorCameraModal aberto={lendoCamera} onLer={(c) => lerTexto(c)} onFechar={() => setLendoCamera(false)} />
      <ComprovanteModal venda={comprovante} instituicao={sessao.instituicao} onFechar={() => setComprovante(null)} />
    </div>
  );
}
