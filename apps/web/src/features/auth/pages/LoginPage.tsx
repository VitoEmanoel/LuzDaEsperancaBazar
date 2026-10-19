/** Login — mensagem genérica de recusa (não revela se o login existe); bloqueio é do servidor. */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { ApiError, errorMessage } from '../../../shared/api/http';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import type { Me } from '../../../shared/api/types';
import { FlorMarca, PontosMarca } from '../../../shared/components/BrandMark';

/** Destino pós-login: troca de senha > rota pedida > PDV (perfil só de caixa) > início. */
function destino(u: Me, from?: string) {
  if (u.trocarSenha) return '/trocar-senha';
  const soCaixa = u.permissoes.includes('caixa.operar') && !u.permissoes.some((p) => ['estoque.ajustar', 'entrada.registrar', 'relatorios.consultar'].includes(p));
  // Perfil só de caixa nunca cai no Início: vai direto ao PDV, mesmo que a rota pedida tenha sido a raiz.
  if (from && from !== '/login' && !(soCaixa && from === '/')) return from;
  return soCaixa ? '/pdv' : '/';
}

export function LoginPage() {
  const { me, login, sessaoExpirada } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Único ponto de redirecionamento (evita corrida entre <Navigate> e navigate()).
  if (me) return <Navigate to={destino(me, loc.state?.from)} replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true); setErro(null);
    try {
      await login(usuario.trim(), senha); // o re-render com `me` faz o redirecionamento
      setSenha('');
    } catch (err) {
      setErro(err instanceof ApiError && err.status === 401 ? 'Login ou senha inválidos.' : errorMessage(err));
      setSenha('');
    } finally { setEnviando(false); }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero" aria-label="Luz da Esperança">
        <FlorMarca tamanho={72} />
        <PontosMarca />
        <h1>Luz da Esperança</h1>
        <p className="lema">Bazar beneficente</p>
        <p className="descricao">Cada doação recebida com carinho vira acolhimento para as famílias atendidas pela casa.</p>
        <p className="local">Centro Espírita e Obras Sociais · Parnaíba, PI</p>
      </section>
      <main className="auth-form">
      <form onSubmit={entrar} noValidate>
        <h2>Boas-vindas!</h2>
        <p className="muted">Entre com seu usuário e senha para começar.</p>
        {sessaoExpirada && <div className="alert alert-info">Sua sessão expirou. Entre novamente — o carrinho em andamento foi preservado neste aparelho.</div>}
        <Field label="Usuário">
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoFocus required maxLength={60} />
        </Field>
        <Field label="Senha">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required maxLength={128} />
        </Field>
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block btn-lg" disabled={enviando || !usuario || !senha}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      </main>
    </div>
  );
}
