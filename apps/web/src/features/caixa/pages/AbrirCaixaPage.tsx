/** Abertura de caixa por terminal com fundo de troco. Exige conexão (RNF-05). */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi, terminaisApi } from '../caixa.api';
import { ApiError, errorMessage } from '../../../shared/api/http';
import type { Terminal } from '../../../shared/api/types';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { idb, KV } from '../../../shared/offline/idb';
import { useOnline } from '../../../shared/offline/hooks';
import { BrandMark } from '../../../shared/components/BrandMark';

export function AbrirCaixaPage() {
  const nav = useNavigate();
  const online = useOnline();
  const [terminais, setTerminais] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [fixo, setFixo] = useState(false);
  const [fundo, setFundo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [carregouTerminais, setCarregouTerminais] = useState(false);

  useEffect(() => {
    if (!online) return;
    (async () => {
      try {
        const [lista, salvo] = await Promise.all([terminaisApi.listar({ ativo: true }), idb.get<string>('kv', KV.terminalId)]);
        setTerminais(lista); setCarregouTerminais(true);
        // Terminal fixo do dispositivo (escolhido na primeira abertura).
        if (salvo && lista.some((t) => t.id === salvo)) { setTerminalId(salvo); setFixo(true); }
        else if (lista.length === 1) setTerminalId(lista[0]!.id);
      } catch (e) { setErro(errorMessage(e)); }
    })();
  }, [online]);

  // Campo vazio = R$ 0,00 (fundo de troco pode ser zero)
  const fundoCents = fundo.trim() === '' ? 0 : tryCents(fundo);
  const semTerminais = online && !erro && terminais.length === 0 && carregouTerminais;
  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (!terminalId || fundoCents === null || fundoCents < 0) return;
    setEnviando(true); setErro(null);
    try {
      const cx = await caixaApi.abrir({ id: uuid(), terminalId, fundoTroco: fromCents(fundoCents) });
      await idb.put('kv', terminalId, KV.terminalId);
      await idb.put('kv', cx, KV.caixaAtual);
      nav('/pdv', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CAIXA_JA_ABERTO') {
        // Já há caixa deste operador: retoma.
        try { const cx = await caixaApi.atual(); await idb.put('kv', cx, KV.caixaAtual); nav('/pdv', { replace: true }); return; } catch { /* mostra o erro original */ }
      }
      setErro(errorMessage(err));
    } finally { setEnviando(false); }
  }

  return (
    <div className="center-page">
      <BrandMark />
      <form className="card login-card" onSubmit={abrir}>
        <h1>Abrir caixa</h1>
        {!online && <div className="alert alert-warn" role="alert">A abertura de caixa exige conexão com a internet.</div>}
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
        <Field label="Fundo de troco (R$)" erro={fundo && fundoCents === null ? 'Valor inválido' : null}>
          <input inputMode="decimal" value={fundo} onChange={(e) => setFundo(e.target.value)} placeholder="0,00" autoFocus />
        </Field>
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block btn-lg" disabled={!online || enviando || !terminalId || fundoCents === null}>Abrir caixa</button>
        <Link to="/" className="btn btn-block">Voltar</Link>
      </form>
    </div>
  );
}
