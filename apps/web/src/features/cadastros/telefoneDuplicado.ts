/**
 * RF-CAD-04 cenário 3 (ticket 12): antes de cadastrar um cliente, procura outro com o MESMO telefone.
 * Online: `POST /clientes/busca` (telefone no corpo, nunca na URL). Offline ou sem rede: lista local do PDV.
 * Não bloqueia: quem decide é o operador ("Usar existente" ou "Cadastrar mesmo assim").
 */
import { clientesApi } from './cadastros.api';
import { NetworkError } from '../../shared/api/http';

export interface ClienteResumo { id: string; nome: string; telefone: string }

const digitos = (t: string) => t.replace(/\D/g, '');

export async function clientesComMesmoTelefone(telefone: string, opts: { online: boolean; locais?: ClienteResumo[] }): Promise<ClienteResumo[]> {
  const alvo = digitos(telefone);
  if (alvo.length < 10) return [];
  const doLocal = () => (opts.locais ?? []).filter((c) => digitos(c.telefone) === alvo);
  if (!opts.online) return doLocal();
  try {
    const r = await clientesApi.buscar(alvo);
    return r.filter((c) => digitos(c.telefone) === alvo).map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone }));
  } catch (e) {
    if (e instanceof NetworkError) return doLocal();
    return []; // falha na checagem não impede o cadastro (o aviso é só conforto)
  }
}
