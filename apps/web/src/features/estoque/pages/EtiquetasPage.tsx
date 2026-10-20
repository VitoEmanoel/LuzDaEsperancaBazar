/**
 * Imprimir etiquetas (S4-03, S4-04): busca, seleção, quantidade livre por produto e pré-visualização no tamanho do rolo.
 * Qualquer produto ativo, mesmo sem saldo no Bazar (P-18). A impressão fica no histórico do produto (S4-05).
 * O papel vai num portal direto no <body>: na impressão só ele aparece, uma etiqueta por página do rolo (print.css).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { estoqueApi } from '../estoque.api';
import { lotesApi } from '../../entradas/entradas.api';
import { errorMessage } from '../../../shared/api/http';
import type { EtiquetaProduto, EtiquetasPreparadas, ProdutoBusca, TamanhoRolo } from '../../../shared/api/types';
import { ErrorAlert, Field, MoneyText, PageHeader, TabelaRolavel } from '../../../shared/components/ui';
import { useToast } from '../../../shared/components/Toast';
import { useAuth } from '../../auth/AuthContext';
import { Etiqueta, moduloNaEtiqueta } from '../components/Etiqueta';
import { lerPedidoDaUrl, MODULO_MINIMO_MM } from '../etiquetas';

const MAX_ETIQUETAS = 500; // o mesmo teto da API
type Escolhido = Omit<EtiquetaProduto, 'quantidade'> & { quantidade: string };

export function EtiquetasPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [rolo, setRolo] = useState<TamanhoRolo | null>(null);
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<ProdutoBusca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [papel, setPapel] = useState<EtiquetasPreparadas | null>(null);

  // vindo do Estoque, do produto ou do lote, a tela já abre com os produtos e as quantidades
  useEffect(() => {
    const pedido = lerPedidoDaUrl(params.get('produtos'));
    // os dados vêm com 1 de cada (o teto de 500 não derruba a tela); as quantidades pedidas entram depois, para conferir
    const qtd = new Map(pedido.map((p) => [p.produtoId, p.quantidade]));
    const carregar = pedido.length
      ? estoqueApi.prepararEtiquetas({ produtos: pedido.map((p) => ({ produtoId: p.produtoId, quantidade: 1 })) }).then((r) => {
        setEscolhidos(r.itens.map((i) => ({ ...i, quantidade: String(qtd.get(i.produtoId) ?? 1) })));
        return r;
      })
      : estoqueApi.tamanhoRolo();
    carregar.then((r) => setRolo({ larguraMm: r.larguraMm, alturaMm: r.alturaMm })).catch((e) => setErro(errorMessage(e)));
  }, [params]);

  // o papel montado vai para a impressora e só some quando a impressão termina (há navegador em que print() não espera)
  useEffect(() => {
    if (!papel) return;
    const fim = () => setPapel(null);
    window.addEventListener('afterprint', fim);
    const t = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(t); window.removeEventListener('afterprint', fim); };
  }, [papel]);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    if (!busca.trim()) return;
    setErro(null);
    try { setAchados((await lotesApi.buscarProdutos(busca.trim())).items); } catch (er) { setErro(errorMessage(er)); }
  }
  function adicionar(p: ProdutoBusca) {
    if (escolhidos.some((x) => x.produtoId === p.id)) return;
    // uma etiqueta por unidade em estoque; sem saldo, uma
    const q = Math.max(1, p.saldoBazar + p.saldoDoacoes);
    setEscolhidos([...escolhidos, { produtoId: p.id, codigo: p.codigo, titulo: p.tituloEtiqueta, nome: p.nome, preco: p.preco, quantidade: String(q) }]);
  }
  const mudarQtd = (id: string, q: string) => setEscolhidos(escolhidos.map((x) => (x.produtoId === id ? { ...x, quantidade: q.replace(/\D/g, '').slice(0, 3) } : x)));
  const tirar = (id: string) => setEscolhidos(escolhidos.filter((x) => x.produtoId !== id));

  const qtdOk = (q: string) => /^\d+$/.test(q) && Number(q) >= 1;
  const total = escolhidos.reduce((s, x) => s + (qtdOk(x.quantidade) ? Number(x.quantidade) : 0), 0);
  const valido = escolhidos.length > 0 && escolhidos.every((x) => qtdOk(x.quantidade)) && total <= MAX_ETIQUETAS;
  // o código precisa caber com barras que o leitor consiga ler
  const estreita = rolo && escolhidos.some((x) => moduloNaEtiqueta(x.codigo, rolo.larguraMm) < MODULO_MINIMO_MM);

  async function imprimir() {
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      const r = await estoqueApi.imprimirEtiquetas({ produtos: escolhidos.map((x) => ({ produtoId: x.produtoId, quantidade: Number(x.quantidade) })) });
      setRolo({ larguraMm: r.larguraMm, alturaMm: r.alturaMm });
      setPapel(r);
      toast(`Impressão de ${total} etiqueta(s) registrada no histórico de cada produto.`);
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Imprimir etiquetas" />
      <p className="muted">
        A etiqueta leva o título, o código de barras e o <strong>preço normal</strong> (o desconto aparece no caixa).
        {rolo && <> Rolo de <strong>{rolo.larguraMm} × {rolo.alturaMm} mm</strong>{can('parametros.gerenciar') && <> (muda em <Link to="/admin/parametros">Parâmetros</Link>)</>}.</>}
      </p>

      <form className="card row" onSubmit={buscar} role="search">
        <Field label="Buscar produto (código, nome, título ou marca)"><input value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={100} /></Field>
        <button className="btn" type="submit">Buscar</button>
      </form>
      {achados && (
        <section className="card">
          <h2>Resultado</h2>
          {achados.length === 0 ? <p className="muted">Nenhum produto ativo encontrado.</p> : (
            <TabelaRolavel><table className="table compact">
              <thead><tr><th>Código</th><th>Produto</th><th className="num">Preço</th><th className="num">Em estoque</th><th /></tr></thead>
              <tbody>{achados.map((p) => (
                <tr key={p.id}>
                  <td>{p.codigo}</td><td>{p.nome}</td><td className="num"><MoneyText value={p.preco} /></td>
                  <td className="num">{p.saldoBazar + p.saldoDoacoes}</td>
                  <td>{escolhidos.some((x) => x.produtoId === p.id) ? <small className="muted">Escolhido</small> : <button className="btn btn-sm" onClick={() => adicionar(p)} aria-label={`Adicionar ${p.nome}`}>Adicionar</button>}</td>
                </tr>
              ))}</tbody>
            </table></TabelaRolavel>
          )}
        </section>
      )}

      <section className="card">
        <h2>Etiquetas a imprimir</h2>
        {escolhidos.length === 0 ? <p className="muted">Busque e adicione os produtos. Do Estoque, do produto ou do lote a tela já abre com eles.</p> : (
          <TabelaRolavel><table className="table compact">
            <thead><tr><th>Código</th><th>Produto</th><th className="num">Preço</th><th className="num">Etiquetas</th><th /></tr></thead>
            <tbody>{escolhidos.map((x) => (
              <tr key={x.produtoId}>
                <td>{x.codigo}</td><td>{x.nome}</td><td className="num"><MoneyText value={x.preco} /></td>
                <td className="num"><input className="qtd" inputMode="numeric" value={x.quantidade} onChange={(e) => mudarQtd(x.produtoId, e.target.value)}
                  aria-label={`Etiquetas de ${x.nome}`} aria-invalid={!qtdOk(x.quantidade)} aria-describedby={qtdOk(x.quantidade) ? undefined : 'etq-qtd-erro'} /></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => tirar(x.produtoId)} aria-label={`Tirar ${x.nome}`}>✕</button></td>
              </tr>
            ))}</tbody>
          </table></TabelaRolavel>
        )}
        {escolhidos.some((x) => !qtdOk(x.quantidade)) && <p className="field-error" role="alert" id="etq-qtd-erro">Cada produto precisa de pelo menos 1 etiqueta.</p>}
        {total > MAX_ETIQUETAS && <p className="field-error" role="alert">No máximo {MAX_ETIQUETAS} etiquetas por vez ({total} escolhidas).</p>}
        {estreita && <p className="field-error" role="alert">A etiqueta é estreita demais: as barras ficariam finas e o leitor pode não ler. A impressão fica bloqueada até o Administrador aumentar a largura do rolo em Parâmetros.</p>}
        <ErrorAlert erro={erro} />
        <div className="row">
          <button className="btn btn-primary" onClick={imprimir} disabled={!valido || enviando || !rolo || !!estreita}>{enviando ? 'Preparando…' : `Imprimir ${total} etiqueta(s)`}</button>
        </div>
      </section>

      {rolo && escolhidos.length > 0 && (
        <section className="card">
          <h2>Pré-visualização</h2>
          <p className="muted">Tamanho real do rolo. Uma de cada produto; na impressão sai a quantidade escolhida, uma por página.</p>
          <div className="etiquetas-previa">
            {escolhidos.map((x) => (
              <figure key={x.produtoId}><Etiqueta e={x} rolo={rolo} /><figcaption>{qtdOk(x.quantidade) ? `${x.quantidade} etiqueta(s)` : 'quantidade a corrigir'}</figcaption></figure>
            ))}
          </div>
        </section>
      )}

      {papel && createPortal(
        <div className="etiquetas-papel" aria-hidden="true">
          <style>{`@page { size: ${papel.larguraMm}mm ${papel.alturaMm}mm; margin: 0; }`}</style>
          {papel.itens.flatMap((i) => Array.from({ length: i.quantidade }, (_, k) => <Etiqueta key={`${i.produtoId}-${k}`} e={i} rolo={papel} />))}
        </div>,
        document.body,
      )}
    </div>
  );
}
