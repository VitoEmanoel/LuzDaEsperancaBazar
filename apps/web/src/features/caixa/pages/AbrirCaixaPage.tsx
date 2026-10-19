/** Abertura de caixa por terminal com fundo de troco. */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi, terminaisApi } from '../caixa.api';
import { ApiError, errorMessage } from '../../../shared/api/http';
import type { Terminal } from '../../../shared/api/types';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { BrandMark } from '../../../shared/components/BrandMark';

export function AbrirCaixaPage() {
  const nav = useNavigate();
  const [terminais, setTerminais] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [fixo, setFixo] = useState(false);
  const [fundo, setFundo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [carregouTerminais, setCarregouTerminais] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const lista = await terminaisApi.listar({ ativo: true });
        const salvo = armazenamento.ler<string>(CHAVES.terminalId);
        setTerminais(lista); setCarregouTerminais(true);
        // Terminal fixo do dispositivo (escolhido na primeira abertura).
        if (salvo && lista.some((t) => t.id === salvo)) { setTerminalId(salvo); setFixo(true); }
        else if (lista.length === 1) setTerminalId(lista[0]!.id);
      } catch (e) { setErro(errorMessage(e)); }
    })();
  }, []);

  // O saldo inicial (troco) é obrigatório: o operador digita o valor, e pode ser 0 se não houver troco. Campo vazio não abre o caixa.
  const fundoCents = fundo.trim() === '' ? null : tryCents(fundo);
  const semTerminais = !erro && terminais.length === 0 && carregouTerminais;
  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (!terminalId || fundoCents === null || fundoCents < 0) return;
    setEnviando(true); setErro(null);
    try {
      await caixaApi.abrir({ id: uuid(), terminalId, fundoTroco: fromCents(fundoCents) });
      armazenamento.gravar(CHAVES.terminalId, terminalId);
      nav('/pdv', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CAIXA_JA_ABERTO') {
        // Já há caixa deste operador: retoma.
        try { await caixaApi.atual(); nav('/pdv', { replace: true }); return; } catch { /* mostra o erro original */ }
      }
      setErro(errorMessage(err));
    } finally { setEnviando(false); }
  }

  return (
    <div className="center-page">
      <BrandMark />
      <form className="card login-card" onSubmit={abrir}>
        <h1>Abrir caixa</h1>
        {semTerminais && (
          <div className="alert alert-warn" role="alert">
            Nenhum terminal cadastrado. Peça ao administrador para criar um em <strong>Administração → Terminais</strong> (um por celular, tablet ou computador de caixa).
          </div>
        )}
        <Field label="Terminal" hint={fixo ? 'Terminal fixo deste dispositivo.' : undefined}>
          <select value={terminalId} onChange={(e) => { setTerminalId(e.target.value); setFixo(false); }} required>
            <option value="">Selecione…</option>
            {terminais.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Field>
        <Field label="Saldo inicial do caixa, o troco (R$)" hint="Conte o dinheiro da gaveta e digite. Se não houver troco, digite 0." erro={fundo && fundoCents === null ? 'Valor inválido' : null}>
          <input inputMode="decimal" value={fundo} onChange={(e) => setFundo(e.target.value)} placeholder="Digite o saldo inicial" autoFocus required />
        </Field>
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block btn-lg" disabled={enviando || !terminalId || fundoCents === null}>Abrir caixa</button>
        <Link to="/" className="btn btn-block">Voltar</Link>
      </form>
    </div>
  );
}
