/**
 * Reabrir o PDV sem internet depois de F5 / queda de energia (RF-PDV-10, RNF-05 — ticket 9).
 *
 * Threat model (o que pode dar errado?):
 *  - Alguém usa o terminal sem login → só vale com caixa ABERTO deste operador neste dispositivo, dentro do
 *    prazo `pdv.max_horas_sem_sync`, e libera SÓ o PDV (nenhuma outra rota, nenhuma permissão além de caixa.operar).
 *  - Roubo de credencial → o resumo NÃO tem token, cookie nem senha. Sem token, nada chega ao servidor:
 *    ao reconectar, o app exige refresh válido (ou novo login) antes de sincronizar.
 *  - Usuário desativado/sessão revogada → no primeiro contato com o servidor o refresh falha e o resumo é apagado.
 *  - Logout → `clearLocalData()` apaga o IndexedDB inteiro, inclusive este resumo.
 */
import type { CaixaSessao, CatalogoPdv, Me, Permissao } from '../../shared/api/types';
import { idb, KV } from '../../shared/offline/idb';

export interface OperadorOffline {
  id: string; nome: string; login: string; perfil: Me['perfil'];
  permissoes: Permissao[]; limiteDesconto: Me['limiteDesconto'];
  /** epoch ms da última confirmação online */
  salvoEm: number;
}

const PRAZO_PADRAO_HORAS = 8; // padrão do parâmetro pdv.max_horas_sem_sync (PA-17)

/** Grava o resumo após login/refresh ONLINE bem-sucedido. Só para quem opera caixa e já trocou a senha. */
export async function salvarOperadorOffline(me: Me): Promise<void> {
  try {
    if (me.trocarSenha || !me.permissoes.includes('caixa.operar')) { await idb.del('kv', KV.operadorOffline); return; }
    const resumo: OperadorOffline = {
      id: me.id, nome: me.nome, login: me.login, perfil: me.perfil,
      permissoes: me.permissoes, limiteDesconto: me.limiteDesconto, salvoEm: Date.now(),
    };
    await idb.put('kv', resumo, KV.operadorOffline);
  } catch { /* IndexedDB indisponível: só perde o modo offline */ }
}

export async function apagarOperadorOffline(): Promise<void> {
  try { await idb.del('kv', KV.operadorOffline); } catch { /* idem */ }
}

/**
 * Sem rede no carregamento: devolve um `Me` RESTRITO ao PDV, ou null (fail secure → tela de login).
 * Exige: resumo dentro do prazo + caixa aberto salvo no dispositivo + caixa aberto pelo MESMO operador.
 */
export async function restaurarOperadorOffline(agora = Date.now()): Promise<Me | null> {
  try {
    const [op, caixa, catalogo] = await Promise.all([
      idb.get<OperadorOffline>('kv', KV.operadorOffline),
      idb.get<CaixaSessao>('kv', KV.caixaAtual),
      idb.get<CatalogoPdv>('kv', KV.catalogo),
    ]);
    if (!op || !caixa || caixa.status !== 'ABERTO') return null;
    if (!caixa.operadorId || caixa.operadorId !== op.id) return null;
    const horas = catalogo?.pdvMaxHorasSemSync && catalogo.pdvMaxHorasSemSync > 0 ? catalogo.pdvMaxHorasSemSync : PRAZO_PADRAO_HORAS;
    const idade = agora - op.salvoEm;
    if (!(idade >= 0 && idade <= horas * 3_600_000)) return null; // relógio voltou ou prazo vencido
    if (!op.permissoes.includes('caixa.operar')) return null;
    return {
      id: op.id, nome: op.nome, login: op.login, perfil: op.perfil,
      permissoes: ['caixa.operar'], // menor privilégio: só o PDV
      limiteDesconto: op.limiteDesconto, trocarSenha: false,
    };
  } catch {
    return null;
  }
}
