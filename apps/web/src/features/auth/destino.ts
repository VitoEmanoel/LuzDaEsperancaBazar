import type { Me } from '../../shared/api/types';

/** Perfil só de caixa: vende e não cuida de estoque, entradas nem relatórios. Vai direto ao PDV, nunca ao Início. */
export const soCaixa = (u: Me) => u.permissoes.includes('caixa.operar') && !u.permissoes.some((p) => ['estoque.ajustar', 'entrada.registrar', 'relatorios.consultar'].includes(p));

/** Destino pós-login: troca de senha > rota pedida > PDV (perfil só de caixa) > início. Vale também depois da troca de senha (S6-21). */
export function destino(u: Me, from?: string) {
  if (u.trocarSenha) return '/trocar-senha';
  // Perfil só de caixa nunca cai no Início: vai direto ao PDV, mesmo que a rota pedida tenha sido a raiz.
  if (from && from !== '/login' && !(soCaixa(u) && from === '/')) return from;
  return soCaixa(u) ? '/pdv' : '/';
}
