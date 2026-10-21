/**
 * Fechamento às cegas e definitivo (S6-19, como no mercado): a pessoa conta a gaveta e informa o valor SEM ver o esperado;
 * confirma; o caixa fecha na hora e só então aparecem o esperado e a diferença. Com diferença, a justificativa vem em seguida.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi } from '../caixa.api';
import { ApiError, errorMessage } from '../../../shared/api/http';
import type { CaixaSessao } from '../../../shared/api/types';
import { ErrorAlert, Field, MoneyText } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { useAsync } from '../../../shared/hooks/useAsync';
import { downloadBlob } from '../../../shared/lib/download';
import { LinhaDoTempoCaixa } from '../components/LinhaDoTempoCaixa';
import { JustificarDiferenca } from '../components/JustificarDiferenca';
import { formatMoney, fromCents, tryCents } from '../../../shared/lib/money';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { formatDateTime } from '../../../shared/lib/format';
import { uuid } from '../../../shared/lib/uuid';
import { BrandMark } from '../../../shared/components/BrandMark';

export function FecharCaixaPage() {
  const nav = useNavigate();
  const [caixa, setCaixa] = useState<CaixaSessao | null>(null);
  const [contado, setContado] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fechado, setFechado] = useState<CaixaSessao | null>(null);
  // Mesmo id enquanto a pessoa repete a MESMA contagem (resposta perdida): o reenvio devolve o fechamento já feito.
  const idRef = useRef<string | null>(null);
  useEffect(() => { idRef.current = null; }, [contado]);
  // A linha do tempo só depois de fechado: com o caixa aberto, quem opera não vê a gaveta
  const tempo = useAsync(() => (fechado ? caixaApi.linhaDoTempo(fechado.id) : Promise.resolve(null)), [fechado?.id]);
  async function baixarPdf(id: string) {
    try { downloadBlob(await caixaApi.pdfFechamento(id), 'fechamento-de-caixa.pdf'); } catch (e) { setErro(errorMessage(e)); }
  }

  useEffect(() => { caixaApi.atual().then(setCaixa).catch((e) => setErro(errorMessage(e))); }, []);

  const contadoCents = tryCents(contado);
  const pode = caixa && contadoCents !== null && contadoCents >= 0;

  async function fechar() {
    if (!pode || !caixa) return;
    setEnviando(true); setErro(null);
    try {
      idRef.current ??= uuid();
      const r = await caixaApi.fechar(caixa.id, { id: idRef.current, contado: fromCents(contadoCents!) });
      armazenamento.apagar(CHAVES.carrinho);
      setFechado(r);
    } catch (e) {
      // o caixa já tinha fechado (resposta perdida e contagem mudada depois): o resultado e a justificativa ficam no Início
      if (e instanceof ApiError && (e.code === 'CAIXA_FECHADO' || e.code === 'ID_EM_USO')) setErro('Este caixa já foi fechado. Veja o resultado e a justificativa, se houver diferença, no Início.');
      else setErro(errorMessage(e));
    } finally { setEnviando(false); setConfirmando(false); }
  }

  if (fechado) {
    const dif = fechado.diferenca ?? '0.00';
    const comDiferenca = dif !== '0.00';
    return (
      <div className="center-page">
      <BrandMark />
      {/* S3-17: só o resumo vai para o papel (a impressão mostra apenas a .print-area) */}
      <div className="card fechamento print-area">
        <h1>Caixa fechado</h1>
        <p>{fechado.terminalNome} · aberto em {formatDateTime(fechado.abertoEm)} · fechado em {formatDateTime(fechado.fechadoEm)}</p>
        <p>Esperado: <MoneyText value={fechado.esperado} /> · Contado: <MoneyText value={fechado.contado} /></p>
        <p>Diferença: <strong className={comDiferenca ? 'txt-erro' : 'txt-ok'}><MoneyText value={dif} /></strong> {Number(dif) > 0 ? '(sobra)' : Number(dif) < 0 ? '(falta)' : ''}</p>
        {comDiferenca && (fechado.observacao
          ? <p>Justificativa: {fechado.observacao}</p>
          : <div className="no-print"><JustificarDiferenca caixa={fechado} onOk={setFechado} /></div>)}
        <h2>O que aconteceu, da abertura ao fechamento</h2>
        <div className="no-print"><ErrorAlert erro={tempo.erro ?? erro} /></div>
        {tempo.data ? <LinhaDoTempoCaixa eventos={tempo.data.eventos} /> : <p>Carregando…</p>}
        <div className="row no-print">
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
        <form onSubmit={(e) => { e.preventDefault(); if (pode) setConfirmando(true); }}>
          {caixa && <p className="muted">{caixa.terminalNome} · aberto em {formatDateTime(caixa.abertoEm)}</p>}
          <Field label="Dinheiro contado na gaveta (R$)" hint="Conte todo o dinheiro da gaveta, com o troco do início. O esperado e a diferença aparecem depois de fechar.">
            <input inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} autoFocus />
          </Field>
          <ErrorAlert erro={erro} />
          <div className="row">
            <Link to="/pdv" className="btn">Voltar ao PDV</Link>
            <button type="submit" className="btn btn-primary btn-lg grow" disabled={!pode || enviando}>Fechar caixa</button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => nav('/')}>Ir ao Backoffice sem fechar</button>
        </form>
      </div>
      <Modal titulo="Confirmar o fechamento" aberto={confirmando} onFechar={() => setConfirmando(false)} largura="sm" fechavel={!enviando}
        rodape={<><button className="btn" onClick={() => setConfirmando(false)} disabled={enviando}>Voltar e contar de novo</button>
          <button className="btn btn-primary" onClick={() => void fechar()} disabled={enviando}>{enviando ? 'Fechando…' : 'Confirmar e fechar'}</button></>}>
        <p>Você contou <strong>{contadoCents !== null ? formatMoney(contadoCents) : '—'}</strong>.</p>
        <p>Depois de confirmar, o caixa fecha e não dá para mudar.</p>
      </Modal>
    </div>
  );
}
