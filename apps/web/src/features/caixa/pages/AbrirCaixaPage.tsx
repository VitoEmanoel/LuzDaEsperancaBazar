/**
 * Abertura de caixa por terminal com fundo de troco.
 * Terminal fixo no usuário (S6-21): quem tem vai direto nele, sem lista, e só digita o troco; o terminal vai com a pessoa,
 * não com o aparelho. Quem não tem escolhe na lista, e o terminal aberto com outra pessoa aparece com o primeiro nome dela
 * e não dá para escolher (S6-18). A API confere tudo de novo (403 em outro terminal, 409 no ocupado).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi, terminaisApi } from '../caixa.api';
import { ApiError, errorMessage } from '../../../shared/api/http';
import type { Terminal } from '../../../shared/api/types';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { armazenamento, CHAVES } from '../../../shared/lib/armazenamento';
import { BrandMark } from '../../../shared/components/BrandMark';
import { PendenciasDeJustificativa } from '../components/JustificarDiferenca';
import { useAuth } from '../../auth/AuthContext';

export function AbrirCaixaPage() {
  const nav = useNavigate();
  const { me, recarregar } = useAuth();
  const fixo = me?.terminal ?? null; // terminal definido pelo Administrador para esta pessoa
  const [terminais, setTerminais] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [fundo, setFundo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [carregouTerminais, setCarregouTerminais] = useState(false);
  // Id da OPERAÇÃO: o mesmo nas novas tentativas do mesmo pedido (resposta perdida não abre dois caixas); muda quando o pedido muda
  const opId = useRef(uuid());

  const carregar = useCallback(async () => {
    try {
      const lista = await terminaisApi.listar({ ativo: true });
      setTerminais(lista); setCarregouTerminais(true);
      if (fixo) { setTerminalId(fixo.id); return; }
      // sem terminal definido: o último usado neste aparelho, se estiver livre; ou o único livre
      const livres = lista.filter((t) => !t.ocupadoPor);
      const salvo = armazenamento.ler<string>(CHAVES.terminalId);
      setTerminalId((atual) => (atual && livres.some((t) => t.id === atual) ? atual
        : salvo && livres.some((t) => t.id === salvo) ? salvo : livres.length === 1 ? livres[0]!.id : ''));
    } catch (e) { setErro(errorMessage(e)); }
  }, [fixo]);
  useEffect(() => { void carregar(); }, [carregar]);
  // o terminal fixo pode ter mudado depois do login (o Administrador trocou, tirou ou desativou): relê ao abrir a tela
  useEffect(() => { void recarregar().catch(() => {}); }, [recarregar]);

  // O saldo inicial (troco) é obrigatório: o operador digita o valor, e pode ser 0 se não houver troco. Campo vazio não abre o caixa.
  const fundoCents = fundo.trim() === '' ? null : tryCents(fundo);
  useEffect(() => { opId.current = uuid(); }, [terminalId, fundoCents]);
  const semTerminais = !erro && !fixo && terminais.length === 0 && carregouTerminais;
  const doFixo = fixo ? terminais.find((t) => t.id === fixo.id) : undefined;
  // terminal fixo desativado (some da lista de ativos) ou aberto com outra pessoa: não dá para abrir
  const fixoDesativado = !!fixo && (!fixo.ativo || (carregouTerminais && !doFixo));
  const fixoOcupado = doFixo?.ocupadoPor;
  const bloqueado = fixoDesativado || !!fixoOcupado;

  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (!terminalId || fundoCents === null || fundoCents < 0 || bloqueado || enviando) return;
    setEnviando(true); setErro(null);
    try {
      await caixaApi.abrir({ id: opId.current, terminalId, fundoTroco: fromCents(fundoCents) });
      if (!fixo) armazenamento.gravar(CHAVES.terminalId, terminalId);
      nav('/pdv', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CAIXA_JA_ABERTO') {
        // a própria pessoa já tem caixa aberto (outra aba ou outro aparelho): continua nele
        try { await caixaApi.atual(); nav('/pdv', { replace: true }); return; } catch { /* mostra o erro original */ }
      }
      if (err instanceof ApiError && (err.code === 'TERMINAL_OCUPADO' || err.code === 'TERMINAL_DO_USUARIO')) {
        // a mensagem já diz qual terminal e com quem (sem o código interno); a lista volta com quem ocupa agora
        setErro(err.problem.detail ?? err.problem.title);
        await recarregar().catch(() => null); // o terminal da pessoa pode ter mudado: a tela passa a mostrar o atual
        await carregar();
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDACAO') await recarregar().catch(() => null); // terminal desativado nesse meio-tempo
      setErro(errorMessage(err));
    } finally { setEnviando(false); }
  }

  return (
    <div className="center-page">
      <BrandMark />
      {/* S6-19: o caixa anterior fechou com diferença e não foi justificado: avisa aqui também, sem bloquear a abertura */}
      <PendenciasDeJustificativa />
      <form className="card login-card" onSubmit={abrir}>
        <h1>{fixo ? `Abrir caixa · ${fixo.nome}` : 'Abrir caixa'}</h1>
        {semTerminais && (
          <div className="alert alert-warn" role="alert">
            Nenhum terminal cadastrado. Peça ao administrador para criar um em <strong>Administração → Terminais</strong> (um por celular, tablet ou computador de caixa).
          </div>
        )}
        {fixoDesativado && (
          <div className="alert alert-error" role="alert">O {fixo!.nome}, o terminal definido para você, foi desativado. Fale com o Administrador.</div>
        )}
        {!fixoDesativado && fixoOcupado && (
          <div className="alert alert-warn" role="alert">O {fixo!.nome} já está aberto com {fixoOcupado}. Peça para {fixoOcupado} fechar o caixa ou fale com o Administrador.</div>
        )}
        {!fixo && (
          <Field label="Terminal">
            <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} required>
              <option value="">Selecione…</option>
              {terminais.map((t) => <option key={t.id} value={t.id} disabled={!!t.ocupadoPor}>{t.ocupadoPor ? `${t.nome} (aberto com ${t.ocupadoPor})` : t.nome}</option>)}
            </select>
          </Field>
        )}
        <Field label="Saldo inicial do caixa, o troco (R$)" hint="Conte o dinheiro da gaveta e digite. Se não houver troco, digite 0." erro={fundo && fundoCents === null ? 'Valor inválido' : null}>
          <input inputMode="decimal" value={fundo} onChange={(e) => setFundo(e.target.value)} placeholder="Digite o saldo inicial" autoFocus required disabled={bloqueado} />
        </Field>
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block btn-lg" disabled={enviando || !terminalId || fundoCents === null || bloqueado}>Abrir caixa</button>
        <Link to="/" className="btn btn-block">Voltar</Link>
      </form>
    </div>
  );
}
