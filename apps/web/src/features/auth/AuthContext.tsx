/**
 * Contexto de autenticação.
 * - Ao carregar, tenta restaurar a sessão via cookie de refresh (POST /auth/refresh) + GET /me.
 * - `can(perm)` só controla o que a UI MOSTRA; a autorização real é do servidor (403).
 * - Logout: revoga a sessão no servidor, limpa o token em memória e o que o sistema guardou no aparelho.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from './auth.api';
import { refreshAccessToken, tokenStore } from '../../shared/api/http';
import type { Me, Permissao } from '../../shared/api/types';
import { armazenamento } from '../../shared/lib/armazenamento';

interface AuthState {
  me: Me | null;
  carregando: boolean;
  sessaoExpirada: boolean;
  /** true após logout explícito: o próximo login não volta para a rota do usuário anterior. */
  saiu: boolean;
  login: (login: string, senha: string) => Promise<Me>;
  logout: () => Promise<void>;
  recarregar: () => Promise<Me>;
  can: (...perms: Permissao[]) => boolean;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [saiu, setSaiu] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (await refreshAccessToken()) {
          const u = await authApi.me();
          if (vivo) setMe(u);
        }
      } catch { /* sem sessão ou sem rede: vai para o login (fail secure) */ }
      finally { if (vivo) setCarregando(false); }
    })();
    // Sessão expirou no meio do uso: volta ao login (o carrinho em andamento fica no aparelho).
    const off = tokenStore.onSessionExpired(() => { setMe(null); setSessaoExpirada(true); });
    return () => { vivo = false; off(); };
  }, []);

  const login = useCallback(async (l: string, s: string) => {
    const u = await authApi.login(l, s);
    setMe(u); setSessaoExpirada(false); setSaiu(false);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* mesmo se a rede falhar, limpa o local */ }
    tokenStore.clear();
    armazenamento.limparTudo();
    setSaiu(true);
    setMe(null);
  }, []);

  const recarregar = useCallback(async () => { const m = await authApi.me(); setMe(m); return m; }, []);

  const can = useCallback((...perms: Permissao[]) => !!me && perms.some((p) => me.permissoes.includes(p)), [me]);

  const value = useMemo(() => ({ me, carregando, sessaoExpirada, saiu, login, logout, recarregar, can }),
    [me, carregando, sessaoExpirada, saiu, login, logout, recarregar, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
