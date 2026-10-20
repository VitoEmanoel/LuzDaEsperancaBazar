/** Troca de senha (obrigatória no 1º acesso / senha provisória). Mín. 8 caracteres (RNF-07). */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../auth.api';
import { errorMessage } from '../../../shared/api/http';
import { useAuth } from '../AuthContext';
import { CampoSenha, ErrorAlert } from '../../../shared/components/ui';
import { useToast } from '../../../shared/components/Toast';
import { BrandMark } from '../../../shared/components/BrandMark';

export function TrocarSenhaPage() {
  const { me, recarregar } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const problemas = [
    nova.length > 0 && nova.length < 8 && 'A nova senha precisa ter pelo menos 8 caracteres.',
    conf.length > 0 && conf !== nova && 'A confirmação não confere.',
    nova.length > 0 && nova === atual && 'A nova senha deve ser diferente da atual.',
  ].filter(Boolean) as string[];

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (problemas.length || !atual || !nova) return;
    setEnviando(true); setErro(null);
    try {
      await authApi.trocarSenha(atual, nova);
      setAtual(''); setNova(''); setConf('');
      await recarregar();
      toast('Senha alterada. As outras sessões foram encerradas.');
      nav('/', { replace: true });
    } catch (err) { setErro(errorMessage(err)); }
    finally { setEnviando(false); }
  }

  return (
    <div className="center-page">
      <BrandMark />
      <form className="card login-card" onSubmit={salvar} noValidate>
        <h1>Trocar senha</h1>
        {me?.trocarSenha && <div className="alert alert-info">Você está usando uma senha provisória. Defina uma nova senha para continuar.</div>}
        <CampoSenha label="Senha atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" autoFocus />
        <CampoSenha label="Nova senha" hint="Mínimo de 8 caracteres." value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
        <CampoSenha label="Confirmar nova senha" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" />
        {problemas.map((p) => <small key={p} className="field-error">{p}</small>)}
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block" disabled={enviando || problemas.length > 0 || !atual || !nova || !conf}>Salvar</button>
        {!me?.trocarSenha && <button type="button" className="btn btn-block" onClick={() => nav(-1)}>Voltar</button>}
      </form>
    </div>
  );
}
