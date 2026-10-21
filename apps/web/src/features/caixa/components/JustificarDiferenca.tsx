/**
 * S6-19: justificativa da diferença do caixa, depois do fechamento (às cegas). Uma vez só, só de quem fechou.
 * `JustificarDiferenca` é o formulário; `PendenciasDeJustificativa` é o aviso do próximo acesso, até a pessoa responder.
 */
import { useState } from 'react';
import { caixaApi } from '../caixa.api';
import { errorMessage } from '../../../shared/api/http';
import type { CaixaSessao } from '../../../shared/api/types';
import { ErrorAlert, Field, MoneyText } from '../../../shared/components/ui';
import { useAsync } from '../../../shared/hooks/useAsync';
import { formatDateTime } from '../../../shared/lib/format';

export function JustificarDiferenca({ caixa, onOk }: { caixa: CaixaSessao; onOk: (c: CaixaSessao) => void }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const valido = texto.trim().length >= 5;
  async function enviar() {
    if (!valido) return;
    setEnviando(true); setErro(null);
    try { onOk(await caixaApi.justificar(caixa.id, texto.trim())); } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <Field label="Justificativa da diferença (obrigatória)" hint="Escreva o que aconteceu. Depois de enviar, não dá para mudar.">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={500} />
      </Field>
      <ErrorAlert erro={erro} />
      <button type="submit" className="btn btn-primary" disabled={!valido || enviando}>{enviando ? 'Enviando…' : 'Enviar justificativa'}</button>
    </form>
  );
}

/** Caixas que eu fechei com diferença e ainda não justifiquei. Não bloqueia nada: só avisa até a pessoa responder. */
export function PendenciasDeJustificativa() {
  const pend = useAsync(() => caixaApi.minhasPendencias().catch(() => [] as CaixaSessao[]), []);
  const [feitos, setFeitos] = useState<string[]>([]);
  const lista = (pend.data ?? []).filter((c) => !feitos.includes(c.id));
  if (!lista.length) return null;
  return (
    <section className="card alerta-pendencia" aria-label="Justificativa de caixa pendente">
      {lista.map((c) => (
        <div key={c.id}>
          <p><strong>Seu caixa ({c.terminalNome}) de {formatDateTime(c.fechadoEm)} fechou com diferença de <MoneyText value={c.diferenca} />. Justifique.</strong></p>
          <JustificarDiferenca caixa={c} onOk={() => setFeitos((f) => [...f, c.id])} />
        </div>
      ))}
    </section>
  );
}
