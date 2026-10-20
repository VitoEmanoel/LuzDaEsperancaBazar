/**
 * Novo lote (S2-12): tipo, parceiro OBRIGATÓRIO (RN-04; campanha opcional), documento e anexo.
 * O estoquista cria o parceiro na hora, sem sair da tela (parceiros.criar).
 * Compra pede valor e se foi pago (cria conta a pagar no servidor, exige contas_pagar.gerenciar).
 * Anexo: checagem de tamanho/tipo aqui é só UX — o servidor valida magic bytes (RNF-18).
 */
import { useState, type FormEvent } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { useNavigate } from 'react-router-dom';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { lotesApi } from '../entradas.api';
import { errorMessage } from '../../../shared/api/http';
import { TIPOS_PARCEIRO, type Parceiro, type TipoEntrada, type TipoParceiro } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, PageHeader } from '../../../shared/components/ui';
import { useAuth } from '../../auth/AuthContext';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { todayLocal } from '../../../shared/lib/format';
import { useToast } from '../../../shared/components/Toast';

const MAX_MB = 5; // proposto; parâmetro anexo.tamanho_max_mb
const TIPOS_ACEITOS = ['application/pdf', 'image/png', 'image/jpeg'];

export function NovoLotePage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('parceiros', { ativo: true }), cadastrosApi.listar('campanhas', { ativo: true })]), []);
  const [tipo, setTipo] = useState<TipoEntrada>('DOACAO');
  const [parceiroId, setParceiroId] = useState('');
  const [campanhaId, setCampanhaId] = useState('');
  const [documento, setDocumento] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [valor, setValor] = useState('');
  const [pago, setPago] = useState(false);
  const [vencimento, setVencimento] = useState(todayLocal(30));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [novoParceiro, setNovoParceiro] = useState(false);
  const [criados, setCriados] = useState<Parceiro[]>([]);
  const parceiros = [...criados, ...(ops.data?.[0] ?? []).filter((p) => !criados.some((c) => c.id === p.id))];

  const erroArquivo = arquivo && (arquivo.size > MAX_MB * 1024 * 1024 ? `Arquivo maior que ${MAX_MB} MB.` : !TIPOS_ACEITOS.includes(arquivo.type) ? 'Envie PDF, PNG ou JPEG.' : null);
  const valorCents = tryCents(valor);
  const valido = parceiroId && !erroArquivo && (tipo !== 'COMPRA' || (valorCents !== null && valorCents > 0));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true); setErro(null);
    const id = uuid();
    try {
      const lote = await lotesApi.criar({
        id, tipo, parceiroId: parceiroId || undefined, campanhaId: campanhaId || undefined, documento: documento.trim() || undefined,
        ...(tipo === 'COMPRA' ? { valorCompra: fromCents(valorCents!), pago, vencimento: pago ? undefined : vencimento } : {}),
      });
      if (arquivo) {
        try { await lotesApi.enviarDocumento(lote.id, arquivo); }
        catch (err) { toast(`Lote criado, mas o anexo falhou: ${errorMessage(err)}`, 'erro'); }
      }
      toast(`Lote #${lote.numero} criado.`);
      nav(`/entradas/${lote.id}/triagem`);
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <div className="page narrow">
      <PageHeader titulo="Novo lote de entrada" />
      <form className="card" onSubmit={salvar}>
        <Field label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoEntrada)}>
            <option value="DOACAO">Doação</option>
            {can('contas_pagar.gerenciar') && <option value="COMPRA">Compra</option>}
          </select>
        </Field>
        <div className="grid-2">
          <Field label={tipo === 'COMPRA' ? 'Fornecedor (obrigatório)' : 'Parceiro / doador (obrigatório)'}>
            <select value={parceiroId} onChange={(e) => setParceiroId(e.target.value)} required><option value="">Selecione…</option>{parceiros.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          </Field>
          <Field label="Campanha (opcional)"><select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}><option value="">—</option>{ops.data?.[1].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        </div>
        <div className="row">
          {!parceiroId && <small className="hint">Sem doador conhecido, use “Doador não identificado”.</small>}
          {can('cadastros.gerenciar', 'parceiros.criar') && <button type="button" className="btn btn-sm" onClick={() => setNovoParceiro(true)}>+ Novo parceiro</button>}
        </div>
        <Field label="Documento de origem (nº do termo, nota…)"><input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={80} /></Field>
        <Field label={`Anexo (PDF/PNG/JPEG, até ${MAX_MB} MB)`} erro={erroArquivo}>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Field>
        {tipo === 'COMPRA' && (
          <fieldset>
            <legend>Compra</legend>
            <Field label="Valor da compra (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
            <label className="check"><input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} /> Já foi paga</label>
            {!pago && <Field label="Vencimento da conta a pagar"><input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field>}
          </fieldset>
        )}
        <ErrorAlert erro={erro ?? ops.erro} />
        <div className="row"><button type="button" className="btn" onClick={() => nav(-1)}>Cancelar</button><button className="btn btn-primary" disabled={!valido || enviando}>Criar lote e cadastrar produtos</button></div>
      </form>
      {novoParceiro && <NovoParceiroModal onFechar={() => setNovoParceiro(false)} onCriado={(p) => { setCriados((cs) => [p, ...cs]); setParceiroId(p.id); setNovoParceiro(false); toast(`Parceiro “${p.nome}” criado.`); }} />}
    </div>
  );
}

/** Cadastro rápido do parceiro (S2-06): nome e tipo; documento e contatos ficam para Cadastros (Admin). */
function NovoParceiroModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: (p: Parceiro) => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoParceiro>('PESSOA_FISICA');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [id] = useState(uuid); // o mesmo id em cada tentativa: reenvio não duplica
  async function criar(e: FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return;
    setEnviando(true); setErro(null);
    try { onCriado(await cadastrosApi.criar('parceiros', { id, nome: nome.trim(), tipo })); }
    catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Novo parceiro" aberto onFechar={onFechar}
      rodape={<><button type="button" className="btn" onClick={onFechar}>Cancelar</button><button type="submit" form="form-novo-parceiro" className="btn btn-primary" disabled={nome.trim().length < 2 || enviando}>Criar parceiro</button></>}>
      <form id="form-novo-parceiro" onSubmit={criar}>
        <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus /></Field>
        <Field label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoParceiro)}>{TIPOS_PARCEIRO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <ErrorAlert erro={erro} />
      </form>
    </Modal>
  );
}
