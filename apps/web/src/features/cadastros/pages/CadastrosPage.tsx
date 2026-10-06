/**
 * Cadastros genéricos (categorias, parceiros, campanhas, motivos, categorias de despesa, clientes).
 * Nada é excluído: só desativa (RN-24). Busca de clientes vai no corpo de POST (sem PII na URL).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cadastrosApi, clientesApi, type TipoCadastro } from '../cadastros.api';
import { errorMessage, errosPorCampo } from '../../../shared/api/http';
import { TIPOS_PARCEIRO } from '../../../shared/api/types';
import { clientesComMesmoTelefone, type ClienteResumo } from '../telefoneDuplicado';
import { AvisoTelefoneDuplicado } from '../components/AvisoTelefoneDuplicado';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Tabs } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { useAuth } from '../../auth/AuthContext';
import { fromCents, toCents, tryCents } from '../../../shared/lib/money';
import { formatDate, maskPhone } from '../../../shared/lib/format';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

type Tipo = TipoCadastro | 'clientes';
interface Campo {
  chave: string; rotulo: string; tipo: 'text' | 'money' | 'bool' | 'date' | 'tel' | 'select' | 'doc';
  /** Campo opcional (vazio não vai na requisição). */
  opcional?: boolean;
  /** money: obrigatório (> 0) só quando este campo booleano estiver marcado (RF-CAD-01 cenário 2). */
  obrigatorioSe?: string;
  opcoes?: { value: string; label: string }[];
  /** Na lista, mostra outra chave do registro (ex.: documento mascarado devolvido pelo servidor). */
  chaveExibicao?: string;
  hint?: string;
}
const CONFIG: Record<Tipo, { titulo: string; campos: Campo[] }> = {
  categorias: { titulo: 'Categorias', campos: [
    { chave: 'nome', rotulo: 'Nome', tipo: 'text' },
    { chave: 'precoPadrao', rotulo: 'Preço padrão', tipo: 'money', obrigatorioSe: 'vendaPorCategoria', hint: 'Obrigatório quando a categoria é vendida por categoria no PDV.' },
    { chave: 'vendaPorCategoria', rotulo: 'Vende por categoria no PDV', tipo: 'bool' },
  ] },
  parceiros: { titulo: 'Parceiros', campos: [
    { chave: 'nome', rotulo: 'Nome', tipo: 'text' },
    { chave: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_PARCEIRO },
    { chave: 'documento', rotulo: 'CPF ou CNPJ', tipo: 'doc', opcional: true, chaveExibicao: 'documentoExibicao', hint: 'Opcional. Só números (11 ou 14 dígitos).' },
  ] },
  campanhas: { titulo: 'Campanhas', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }, { chave: 'inicio', rotulo: 'Início', tipo: 'date' }, { chave: 'fim', rotulo: 'Fim', tipo: 'date' }] },
  'motivos-descarte': { titulo: 'Motivos de descarte', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  'motivos-baixa': { titulo: 'Motivos de baixa', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  'categorias-despesa': { titulo: 'Categorias de despesa', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  clientes: { titulo: 'Clientes', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }, { chave: 'telefone', rotulo: 'Telefone', tipo: 'tel' }] },
};
type Registro = Record<string, unknown> & { id: string; nome: string; ativo: boolean; especial?: boolean };

export function CadastrosPage() {
  const { tipo: tipoParam = 'categorias' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const permitido = (t: Tipo) => (t === 'clientes' ? can('clientes.gerenciar') : can('cadastros.gerenciar', 'cadastros.consultar'));
  const pedido = (tipoParam in CONFIG ? tipoParam : 'categorias') as Tipo;
  // Aba sem permissão (ex.: link direto) cai na primeira permitida, em vez de mostrar erro 403 do servidor
  const tipo = permitido(pedido) ? pedido : ((Object.keys(CONFIG) as Tipo[]).find(permitido) ?? pedido);
  const cfg = CONFIG[tipo];
  const podeEditar = tipo === 'clientes' ? can('clientes.gerenciar') : can('cadastros.gerenciar');
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [ativo, setAtivo] = useState<'true' | 'false' | ''>('true');
  const [editando, setEditando] = useState<Registro | 'novo' | null>(null);

  const abas = (Object.keys(CONFIG) as Tipo[])
    .filter(permitido)
    .map((t) => ({ id: t, rotulo: CONFIG[t].titulo }));

  const lista = useAsync<Registro[]>(async () => {
    const a = ativo === '' ? undefined : ativo === 'true';
    if (tipo === 'clientes') return (await clientesApi.buscar(termo, a)) as unknown as Registro[];
    return (await cadastrosApi.listar(tipo, { busca: termo || undefined, ativo: a })) as unknown as Registro[];
  }, [tipo, termo, ativo]);

  async function alternarAtivo(r: Registro) {
    try {
      if (tipo === 'clientes') await clientesApi.atualizar(r.id, { ativo: !r.ativo });
      else await cadastrosApi.atualizar(tipo, r.id, { ativo: !r.ativo } as never);
      toast(r.ativo ? 'Desativado.' : 'Reativado.'); await lista.reload();
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Cadastros">{podeEditar && <button className="btn btn-primary" onClick={() => setEditando('novo')}>+ Novo</button>}</PageHeader>
      <Tabs abas={abas} atual={tipo} onChange={(t) => nav(`/cadastros/${t}`)} />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setTermo(busca.trim()); }}>
        <Field label="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" /></Field>
        <Field label="Situação"><select value={ativo} onChange={(e) => setAtivo(e.target.value as typeof ativo)}><option value="true">Ativos</option><option value="false">Inativos</option><option value="">Todos</option></select></Field>
        <button className="btn">Buscar</button>
      </form>
      <ErrorAlert erro={lista.erro} />
      {lista.carregando ? <p>Carregando…</p> : !lista.data?.length ? <Empty /> : (
        <table className="table">
          <thead><tr>{cfg.campos.map((c) => <th key={c.chave}>{c.rotulo}</th>)}<th>Situação</th><th /></tr></thead>
          <tbody>{lista.data.map((r) => (
            <tr key={r.id}>
              {cfg.campos.map((c) => <td key={c.chave}>{exibir(c, r[c.chaveExibicao ?? c.chave])}</td>)}
              <td>{r.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}{r.especial && <Badge tom="info">Especial</Badge>}</td>
              <td className="actions">{podeEditar && <>
                <button className="btn btn-sm" onClick={() => setEditando(r)}>Editar</button>
                {!r.especial && <button className="btn btn-sm" onClick={() => alternarAtivo(r)}>{r.ativo ? 'Desativar' : 'Reativar'}</button>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editando && <EditarModal tipo={tipo} campos={cfg.campos} registro={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} onOk={async () => { toast('Salvo.'); await lista.reload(); }} />}
    </div>
  );
}

function exibir(c: Campo, v: unknown) {
  if (c.tipo === 'select') return c.opcoes?.find((o) => o.value === v)?.label ?? String(v ?? '—');
  if (c.tipo === 'money') return <MoneyText value={v as string} />;
  if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (c.tipo === 'date') return formatDate(v as string);
  if (c.tipo === 'tel') return maskPhone(v as string); // minimização de PII em listas
  return String(v ?? '—');
}

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function EditarModal({ tipo, campos, registro, onFechar, onOk }: { tipo: Tipo; campos: Campo[]; registro: Registro | null; onFechar: () => void; onOk: () => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => Object.fromEntries(campos.map((c) => {
    const v = registro?.[c.chave];
    if (c.tipo === 'bool') return [c.chave, Boolean(v ?? true)];
    if (c.tipo === 'money') return [c.chave, v ? String(v).replace('.', ',') : ''];
    if (c.tipo === 'select') return [c.chave, String(v ?? c.opcoes?.[c.opcoes.length - 1]?.value ?? '')];
    return [c.chave, String(v ?? '')];
  })));
  const [ciencia, setCiencia] = useState(!!registro);
  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [duplicados, setDuplicados] = useState<ClienteResumo[] | null>(null);
  const toast = useToast();

  /** Erro local por campo (o servidor valida de novo; isto é só conforto). */
  const erroLocal = (c: Campo): string | null => {
    const v = vals[c.chave];
    if (c.tipo === 'text' && String(v).trim().length < 2) return 'Mínimo de 2 caracteres';
    if (c.tipo === 'tel' && digitos(v).length < 10) return 'Telefone com DDD';
    if (c.tipo === 'doc' && digitos(v) && ![11, 14].includes(digitos(v).length)) return 'CPF tem 11 dígitos; CNPJ, 14';
    if (c.tipo === 'money') {
      const cents = String(v).trim() ? tryCents(String(v)) : null;
      if (String(v).trim() && (cents === null || cents < 0)) return 'Valor inválido';
      const exige = c.obrigatorioSe ? !!vals[c.obrigatorioSe] : !c.opcional;
      if (exige && !(cents && cents > 0)) return 'Informe um valor maior que zero';
    }
    return null;
  };
  const invalido = campos.some((c) => erroLocal(c)) || (tipo === 'clientes' && !registro && !ciencia);

  function montarDados(): Record<string, unknown> {
    const dados: Record<string, unknown> = {};
    campos.forEach((c) => {
      const v = vals[c.chave];
      if (c.tipo === 'money') { if (String(v).trim()) dados[c.chave] = fromCents(toCents(String(v))); return; }
      if (c.tipo === 'bool') { dados[c.chave] = v; return; }
      if (c.tipo === 'date') { dados[c.chave] = v || undefined; return; }
      if (c.tipo === 'doc') { if (digitos(v)) dados[c.chave] = digitos(v); return; } // vazio = mantém o atual
      dados[c.chave] = String(v).trim();
    });
    return dados;
  }

  async function salvar(mesmoAssim = false) {
    if (invalido) return;
    setEnviando(true); setErro(null); setErrosCampo({});
    const dados = montarDados();
    try {
      if (tipo === 'clientes') {
        if (!registro && !mesmoAssim) {
          // RF-CAD-04 cenário 3 (ticket 12): avisa, mas não bloqueia
          const achados = await clientesComMesmoTelefone(String(dados.telefone), { online: true });
          if (achados.length) { setDuplicados(achados); return; }
        }
        if (registro) await clientesApi.atualizar(registro.id, dados);
        else await clientesApi.criar({ id: uuid(), nome: String(dados.nome), telefone: String(dados.telefone), cienciaAviso: true });
      } else if (registro) await cadastrosApi.atualizar(tipo, registro.id, dados as never);
      else await cadastrosApi.criar(tipo, { ...dados, id: uuid() } as never);
      onFechar(); await onOk();
    } catch (e) {
      const porCampo = errosPorCampo(e);
      setErrosCampo(porCampo);
      setErro(Object.keys(porCampo).length ? 'Confira os campos destacados.' : errorMessage(e));
    } finally { setEnviando(false); }
  }

  function usarExistente(c: ClienteResumo) {
    toast(`Cliente já cadastrado: ${c.nome}. Nenhum novo cadastro foi criado.`, 'info');
    onFechar();
  }

  return (
    <Modal titulo={registro ? 'Editar' : 'Novo cadastro'} aberto onFechar={onFechar} largura="sm" fechavel={!enviando}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={invalido || enviando} onClick={() => void salvar()}>Salvar</button></>}>
      {campos.map((c) => {
        const set = (v: string | boolean) => { setVals({ ...vals, [c.chave]: v }); if (c.tipo === 'tel') setDuplicados(null); };
        if (c.tipo === 'bool') return <label key={c.chave} className="check"><input type="checkbox" checked={!!vals[c.chave]} onChange={(e) => set(e.target.checked)} /> {c.rotulo}</label>;
        const mostrarErroLocal = String(vals[c.chave]).length > 0 || c.tipo === 'money';
        const erroCampo = errosCampo[c.chave] ?? (mostrarErroLocal ? erroLocal(c) : null);
        const atual = c.tipo === 'doc' && registro?.[c.chaveExibicao ?? ''] ? `Atual: ${String(registro[c.chaveExibicao!])}. Deixe em branco para manter.` : c.hint;
        return (
          <Field key={c.chave} label={c.rotulo} hint={atual} erro={erroCampo}>
            {c.tipo === 'select'
              ? <select value={String(vals[c.chave])} onChange={(e) => set(e.target.value)}>{c.opcoes!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input type={c.tipo === 'date' ? 'date' : c.tipo === 'tel' ? 'tel' : 'text'} inputMode={c.tipo === 'money' ? 'decimal' : c.tipo === 'doc' ? 'numeric' : undefined}
                  value={String(vals[c.chave])} onChange={(e) => set(c.tipo === 'doc' ? e.target.value.replace(/\D/g, '').slice(0, 14) : e.target.value)}
                  maxLength={c.tipo === 'doc' ? 14 : 120} autoComplete="off" aria-invalid={!!erroCampo} />}
          </Field>
        );
      })}
      {tipo === 'clientes' && !registro && (
        <label className="check"><input type="checkbox" checked={ciencia} onChange={(e) => setCiencia(e.target.checked)} /> Cliente ciente do aviso de privacidade (finalidade: controle de fiado e contato sobre débitos).</label>
      )}
      {duplicados && duplicados.length > 0 && (
        <AvisoTelefoneDuplicado encontrados={duplicados} rotuloUsar="É a mesma pessoa" onUsarExistente={usarExistente} onCadastrarMesmoAssim={() => void salvar(true)} />
      )}
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
