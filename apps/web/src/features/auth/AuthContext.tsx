/**
 * Contexto de autenticação.
 * - Ao carregar, tenta restaurar a sessão via cookie de refresh (POST /auth/refresh) + GET /me.
 * - `can(perm)` só controla o que a UI MOSTRA; a autorização real é do servidor (403).
 * - Logout: revoga a sessão no servidor, limpa token em memória, IndexedDB e caches do SW.
 * - Sem rede no carregamento (F5/queda de energia): `modoOfflinePdv` libera SÓ o PDV com o resumo do
 *   operador salvo no último login online (ver operadorOffline.ts — ticket 9). Ao reconectar, exige
 *   refresh válido; se falhar, vai para o login sem apagar carrinho nem fila.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from './auth.api';
import { NetworkError, refreshAccessToken, tokenStore } from '../../shared/api/http';
import type { Me, Permissao } from '../../shared/api/types';
import { clearLocalData } from '../../shared/offline/idb';
import { tamanhoFila } from '../../shared/offline/queue';
import { subscribeConnectivity } from '../../shared/lib/connectivity';
import { apagarOperadorOffline, restaurarOperadorOffline, salvarOperadorOffline } from './operadorOffline';

interface AuthState {
  me: Me | null;
  carregando: boolean;
  sessaoExpirada: boolean;
  /** true após logout explícito: o próximo login não volta para a rota do usuário anterior. */
  saiu: boolean;
  /** true = sem internet, sessão local restrita ao PDV (nenhuma chamada autenticada até reconectar). */
  modoOfflinePdv: boolean;
  login: (login: string, senha: string) => Promise<Me>;
  logout: () => Promise<void>;
  recarregar: () => Promise<void>;
  can: (...perms: Permissao[]) => boolean;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [saiu, setSaiu] = useState(false);
  const [modoOfflinePdv, setModoOfflinePdv] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (await refreshAccessToken()) {
          const u = await authApi.me();
          if (vivo) setMe(u);
          await salvarOperadorOffline(u);
        }
      } catch (e) {
        // Sem rede: tenta o modo PDV offline. Qualquer outra falha = sem sessão → /login (fail secure).
        if (e instanceof NetworkError) {
          const local = await restaurarOperadorOffline();
          if (vivo && local) { setMe(local); setModoOfflinePdv(true); }
        }
      } finally { if (vivo) setCarregando(false); }
    })();
    // Sessão expirou no meio do uso: volta ao login SEM apagar o carrinho/fila local; o resumo offline sai.
    const off = tokenStore.onSessionExpired(() => {
      void apagarOperadorOffline();
      setMe(null); setModoOfflinePdv(false); setSessaoExpirada(true);
    });
    return () => { vivo = false; off(); };
  }, []);

  // Reconectou em modo offline: confirma a sessão no servidor ANTES de qualquer sincronização.
  useEffect(() => {
    if (!modoOfflinePdv) return;
    let tentando = false;
    const confirmar = async () => {
      if (tentando) return;
      tentando = true;
      try {
        if (await refreshAccessToken()) {
          const u = await authApi.me();
          await salvarOperadorOffline(u);
          setMe(u); setModoOfflinePdv(false);
        } else {
          await apagarOperadorOffline();
          setMe(null); setModoOfflinePdv(false); setSessaoExpirada(true); // novo login; carrinho e fila ficam
        }
      } catch { /* ainda sem rede: continua offline */ } finally { tentando = false; }
    };
    return subscribeConnectivity((on) => { if (on) void confirmar(); });
  }, [modoOfflinePdv]);

  const login = useCallback(async (l: string, s: string) => {
    const u = await authApi.login(l, s);
    setMe(u); setSessaoExpirada(false); setSaiu(false); setModoOfflinePdv(false);
    await salvarOperadorOffline(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    if (modoOfflinePdv) throw new Error('Sem internet: não é possível sair agora. Conecte-se para sincronizar as vendas e encerrar a sessão.');
    const pendentes = await tamanhoFila();
    if (pendentes > 0) {
      throw new Error(`Existem ${pendentes} registro(s) offline não sincronizados. Conecte-se e sincronize antes de sair.`);
    }
    try { await authApi.logout(); } catch { /* mesmo se a rede falhar, limpa o local */ }
    tokenStore.clear();
    await clearLocalData();
    setSaiu(true);
    setMe(null);
  }, [modoOfflinePdv]);

  const recarregar = useCallback(async () => { const u = await authApi.me(); setMe(u); await salvarOperadorOffline(u); }, []);

  const can = useCallback((...perms: Permissao[]) => !!me && perms.some((p) => me.permissoes.includes(p)), [me]);

  const value = useMemo(() => ({ me, carregando, sessaoExpirada, saiu, modoOfflinePdv, login, logout, recarregar, can }),
    [me, carregando, sessaoExpirada, saiu, modoOfflinePdv, login, logout, recarregar, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
