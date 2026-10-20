/**
 * "A compra é com CPF?" — aparece no primeiro bip de cada venda para ninguém esquecer.
 *  - Sim: a pessoa digita o CPF (máscara, validado pelos dígitos; sem validar não segue) e o sistema mostra o saldo do mês.
 *  - Não: a venda segue sem CPF (esta opção some quando o Administrador marcou o CPF como obrigatório).
 * O CPF fica só na memória da tela: não vai para o aparelho nem para o carrinho guardado.
 */
import { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { errorMessage } from '../../../shared/api/http';
import { cpfValido, maskCpf, soDigitos } from '../../../shared/lib/cpf';
import { formatMoney, toCents } from '../../../shared/lib/money';
import { pdvApi } from '../pdv.api';

export type DecisaoCpf = { tipo: 'sem' } | { tipo: 'com'; cpf: string; saldoCents: number | null };

interface Props {
  aberto: boolean;
  obrigatorio: boolean;
  /** valor que já está no carrinho: o CPF escolhido precisa ter saldo para ele */
  carrinhoCents: number;
  onDecidir: (d: DecisaoCpf) => void;
  onCancelar: () => void;
}

export function CpfModal({ aberto, obrigatorio, carrinhoCents, onDecidir, onCancelar }: Props) {
  const [etapa, setEtapa] = useState<'pergunta' | 'digitar'>('pergunta');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  useEffect(() => { if (aberto) { setEtapa('pergunta'); setTexto(''); setErro(null); setConsultando(false); } }, [aberto]);

  // Atalhos na pergunta: S = sim, N = não (se for permitido)
  useEffect(() => {
    if (!aberto || etapa !== 'pergunta') return;
    let ultima = 0;
    const onKey = (e: KeyboardEvent) => {
      // O leitor de código digita rápido: tecla com modificador, repetida ou colada na anterior (menos de 80 ms) não é atalho.
      const agora = performance.now(); const rapido = agora - ultima < 80; ultima = agora;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || rapido) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); setEtapa('digitar'); }
      else if (k === 'n' && !obrigatorio) { e.preventDefault(); onDecidir({ tipo: 'sem' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, etapa, obrigatorio, onDecidir]);

  const digitos = soDigitos(texto);
  const valido = cpfValido(digitos);

  async function confirmar() {
    if (!valido || consultando) return;
    setConsultando(true); setErro(null);
    try {
      const r = await pdvApi.saldoCpf(digitos);
      const saldoCents = r.saldo === null ? null : toCents(r.saldo);
      if (saldoCents !== null && saldoCents <= 0) { setErro(`Este CPF já usou todo o limite do mês (${formatMoney(toCents(r.limite!))}).`); return; }
      if (saldoCents !== null && saldoCents < carrinhoCents) { setErro(`O carrinho (${formatMoney(carrinhoCents)}) passa do saldo deste CPF (${formatMoney(saldoCents)}). Tire itens ou use outro CPF.`); return; }
      onDecidir({ tipo: 'com', cpf: r.cpf, saldoCents });
    } catch (e) { setErro(errorMessage(e)); }
    finally { setConsultando(false); }
  }

  return (
    <Modal titulo="CPF na compra" aberto={aberto} onFechar={() => { if (etapa === 'digitar') { setEtapa('pergunta'); setErro(null); } else onCancelar(); }} largura="sm" fechavel={!consultando}
      rodape={etapa === 'pergunta' ? (<>
        <button className="btn" onClick={onCancelar}>Cancelar (Esc)</button>
        {!obrigatorio && <button className="btn" onClick={() => onDecidir({ tipo: 'sem' })}><u>N</u>ão</button>}
        <button className="btn btn-primary btn-lg" onClick={() => setEtapa('digitar')} autoFocus><u>S</u>im, informar o CPF</button>
      </>) : (<>
        <button className="btn" onClick={() => { setEtapa('pergunta'); setErro(null); }}>Voltar</button>
        <button className="btn btn-primary btn-lg" onClick={confirmar} disabled={!valido || consultando}>{consultando ? 'Conferindo…' : 'Confirmar CPF (Enter)'}</button>
      </>)}>
      {etapa === 'pergunta' ? (
        <>
          <p className="cpf-pergunta">A compra é <strong>com CPF</strong>?</p>
          {obrigatorio && <p className="muted">O CPF é obrigatório nesta venda (regra definida pelo Administrador).</p>}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }}>
          <Field label="CPF do cliente" erro={texto && digitos.length === 11 && !valido ? 'CPF inválido: confira os números' : null} hint={valido ? 'CPF válido' : undefined}>
            <input inputMode="numeric" value={texto} onChange={(e) => { setTexto(maskCpf(e.target.value)); setErro(null); }} maxLength={14}
              placeholder="000.000.000-00" autoFocus autoComplete="off" aria-invalid={digitos.length === 11 && !valido} aria-describedby="cpf-aviso" />
          </Field>
          <p id="cpf-aviso" className="muted">O CPF fica registrado nesta compra até o fim do mês, para o comprovante e o controle do limite, e depois é apagado.</p>
          <div aria-live="polite"><ErrorAlert erro={erro} /></div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
