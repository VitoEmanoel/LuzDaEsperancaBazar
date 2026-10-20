/**
 * Fechamento: esperado × contado × diferença, totais por forma. Observação obrigatória se houver diferença.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi } from '../caixa.api';
import { errorMessage } from '../../../shared/api/http';
import { FORMAS_PAGAMENTO, type CaixaSessao, type PreviaFechamento } from '../../../shared/api/types';
import { ErrorAlert, Field, MoneyText, TabelaRolavel } from '../../../shared/components/ui';
import { useAsync } from '../../../shared/hooks/useAsync';
import { downloadBlob } from '../../../shared/lib/download';
import { LinhaDoTempoCaixa } from '../components/LinhaDoTempoCaixa';
import { formatMoney, fromCents, toCents, tryCents } from '../../../shared/lib/money';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { formatDateTime } from '../../../shared/lib/format';
import { BrandMark } from '../../../shared/components/BrandMark';

export function FecharCaixaPage() {
  const nav = useNavigate();
  const [caixa, setCaixa] = useState<CaixaSessao | null>(null);
  const [previa, setPrevia] = useState<PreviaFechamento | null>(null);
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fechado, setFechado] = useState<CaixaSessao | null>(null);
  // Tudo o que aconteceu no caixa: para conferir antes de fechar e para mostrar depois de fechado
  const tempo = useAsync(() => (fechado ?? caixa ? caixaApi.linhaDoTempo((fechado ?? caixa)!.id) : Promise.resolve(null)), [fechado?.id, caixa?.id]);
  async function baixarPdf(id: string) {
    try { downloadBlob(await caixaApi.pdfFechamento(id), 'fechamento-de-caixa.pdf'); } catch (e) { setErro(errorMessage(e)); }
  }

  async function carregar() {
    setErro(null);
    try {
      const cx = await caixaApi.atual(); setCaixa(cx);
      setPrevia(await caixaApi.previaFechamento(cx.id));
    } catch (e) { setErro(errorMessage(e)); }
  }
  useEffect(() => { void carregar(); }, []);

  const contadoCents = tryCents(contado);
  const difCents = previa && contadoCents !== null ? contadoCents - toCents(previa.esperadoDinheiro) : null;
  const precisaObs = difCents !== null && difCents !== 0;
  const pode = caixa && contadoCents !== null && contadoCents >= 0 && (!precisaObs || obs.trim().length >= 5);

  async function fechar() {
    if (!pode || !caixa) return;
    setEnviando(true); setErro(null);
    try {
      const r = await caixaApi.fechar(caixa.id, fromCents(contadoCents!), obs.trim() || undefined);
      armazenamento.apagar(CHAVES.carrinho);
      setFechado(r);
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  if (fechado) {
    return (
      <div className="center-page">
      <BrandMark />
      <div className="card fechamento">
        <h1>Caixa fechado</h1>
        <p>{fechado.terminalNome} · aberto em {formatDateTime(fechado.abertoEm)} · fechado em {formatDateTime(fechado.fechadoEm)}</p>
        <p>Esperado: <MoneyText value={fechado.esperado} /> · Contado: <MoneyText value={fechado.contado} /></p>
        <p>Diferença: <strong className={fechado.diferenca !== '0.00' ? 'txt-erro' : 'txt-ok'}><MoneyText value={fechado.diferenca} /></strong></p>
        <h2>O que aconteceu, da abertura ao fechamento</h2>
        <ErrorAlert erro={tempo.erro ?? erro} />
        {tempo.data ? <LinhaDoTempoCaixa eventos={tempo.data.eventos} /> : <p>Carregando…</p>}
        <div className="row">
          <button className="btn" onClick={() => baixarPdf(fechado.id)}>Baixar PDF</button>
          <button className="btn" onClick={() => window.print()}>Imprimir</button>
          <Link to="/" className="btn btn-primary grow">Ir para o início</Link>
        </div>
      </div></div>
    );
  }

  return (
    <div className="center-page">
      <BrandMark />
      <div className="card fechamento">
        <h1>Fechamento de caixa</h1>
        <form onSubmit={(e) => { e.preventDefault(); void fechar(); }}>
        {previa && (
          <>
            <TabelaRolavel><table className="table">
              <tbody>
                <tr><td>Fundo de troco</td><td className="num"><MoneyText value={previa.fundoTroco} /></td></tr>
                {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}</td><td className="num"><MoneyText value={previa.totaisPorForma[f.value]} /></td></tr>)}
                <tr><td>Suprimentos</td><td className="num"><MoneyText value={previa.suprimentos} /></td></tr>
                <tr><td>Sangrias</td><td className="num">− <MoneyText value={previa.sangrias} /></td></tr>
                <tr className="destaque"><td>Dinheiro esperado na gaveta</td><td className="num"><MoneyText value={previa.esperadoDinheiro} /></td></tr>
              </tbody>
            </table></TabelaRolavel>
            <p className="muted">{previa.quantidadeVendas} venda(s) neste caixa.</p>
            <details>
              <summary>Ver tudo o que aconteceu neste caixa</summary>
              {tempo.data ? <LinhaDoTempoCaixa eventos={tempo.data.eventos} /> : <p>Carregando…</p>}
            </details>
            <Field label="Dinheiro contado (R$)"><input inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} autoFocus /></Field>
            {difCents !== null && <p>Diferença: <strong className={difCents ? 'txt-erro' : 'txt-ok'}>{formatMoney(difCents)}</strong> {difCents > 0 ? '(sobra)' : difCents < 0 ? '(falta)' : ''}</p>}
            {precisaObs && <Field label="Justificativa da diferença (obrigatória)"><textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={500} /></Field>}
          </>
        )}
        <ErrorAlert erro={erro} />
        <div className="row">
          <Link to="/pdv" className="btn">Voltar ao PDV</Link>
          <button type="submit" className="btn btn-primary btn-lg grow" disabled={!pode || enviando}>{enviando ? 'Fechando…' : 'Fechar caixa'}</button>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => nav('/')}>Ir ao Backoffice sem fechar</button>
        </form>
      </div>
    </div>
  );
}
