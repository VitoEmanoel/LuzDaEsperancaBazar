/** Sangria / suprimento do caixa aberto. */
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { caixaApi } from '../caixa.api';
import { errorMessage } from '../../../shared/api/http';
import { formatMoney, fromCents, toCents, tryCents } from '../../../shared/lib/money';
import { useAsync } from '../../../shared/hooks/useAsync';
import { uuid } from '../../../shared/lib/uuid';

export function LancamentoModal({ aberto, caixaId, onFechar, onOk }: { aberto: boolean; caixaId: string; onFechar: () => void; onOk: (msg: string) => void }) {
  const [tipo, setTipo] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Mesmo id enquanto a pessoa repete a MESMA tentativa (resposta perdida): reenviar não duplica a sangria. Mudou algo, é outra.
  const idRef = useRef<string | null>(null);
  useEffect(() => { idRef.current = null; }, [tipo, valor, motivo]);
  const cents = tryCents(valor);
  // Dinheiro que de fato está na gaveta agora: a sangria não pode passar disso (o servidor confere de novo).
  const gaveta = useAsync(() => (aberto ? caixaApi.previaFechamento(caixaId) : Promise.resolve(null)), [aberto, caixaId, enviando]);
  const gavetaCents = gaveta.data ? toCents(gaveta.data.esperadoDinheiro) : null;
  const acimaDaGaveta = tipo === 'SANGRIA' && cents !== null && gavetaCents !== null && cents > gavetaCents;
  const valido = cents !== null && cents > 0 && motivo.trim().length >= 3 && !acimaDaGaveta && (tipo !== 'SANGRIA' || gavetaCents !== null);

  async function salvar() {
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      idRef.current ??= uuid();
      await caixaApi.lancar(caixaId, { id: idRef.current, tipo, valor: fromCents(cents!), motivo: motivo.trim() });
      onOk(`${tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} registrado.`);
      idRef.current = null; setValor(''); setMotivo(''); onFechar();
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Sangria / suprimento" aberto={aberto} onFechar={onFechar} largura="sm" fechavel={!enviando}
      rodape={<><button className="btn" onClick={onFechar}>Voltar</button><button className="btn btn-primary" disabled={!valido || enviando} onClick={salvar}>Registrar</button></>}>
      <div className="row" role="radiogroup" aria-label="Tipo">
        {(['SANGRIA', 'SUPRIMENTO'] as const).map((t) => (
          <label key={t} className="check"><input type="radio" checked={tipo === t} onChange={() => setTipo(t)} /> {t === 'SANGRIA' ? 'Sangria (retirada)' : 'Suprimento (reforço)'}</label>
        ))}
      </div>
      {gavetaCents !== null && <p className="gaveta">Dinheiro na gaveta agora: <strong>{formatMoney(gavetaCents)}</strong></p>}
      <Field label="Valor (R$)" erro={acimaDaGaveta ? `Só há ${formatMoney(gavetaCents!)} em dinheiro na gaveta` : null}><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus /></Field>
      <Field label="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
