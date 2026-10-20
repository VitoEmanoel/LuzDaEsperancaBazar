/**
 * Ações da lista de Estoque (S3-02): baixa, ajuste de saída (S3-03), preço do produto (S3-08) e preço da categoria.
 * Cada janela confere o básico na tela; quem decide é o servidor (saldo, permissão, motivo). Tudo auditado.
 */
import { useState } from 'react';
import { cadastrosApi } from '../../cadastros/cadastros.api';
import { estoqueApi } from '../estoque.api';
import { errorMessage } from '../../../shared/api/http';
import type { ItemEstoque, LocalEstoque } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { ErrorAlert, Field, MoneyText } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

interface PropsItem { item: ItemEstoque; onFechar: () => void; onOk: () => Promise<void> }

/** Baixa (com motivo cadastrado) ou ajuste de inventário de saída (com motivo escrito): sempre tira do estoque escolhido. */
export function BaixaAjusteModal({ item, modo, onFechar, onOk }: PropsItem & { modo: 'baixa' | 'ajuste' }) {
  const toast = useToast();
  const motivos = useAsync(() => cadastrosApi.listar('motivos-baixa', { ativo: true }), []);
  const [local, setLocal] = useState<LocalEstoque>(item.saldoBazar > 0 ? 'BAZAR' : 'DOACOES');
  const [qtd, setQtd] = useState('1');
  const [motivoId, setMotivoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [id] = useState(uuid); // o mesmo id entre tentativas: reenvio não registra duas vezes
  const q = Number.parseInt(qtd, 10);
  const saldo = local === 'BAZAR' ? item.saldoBazar : item.saldoDoacoes;
  const valido = q > 0 && q <= saldo && (modo === 'baixa' ? !!motivoId : motivo.trim().length >= 5);

  async function salvar() {
    if (!valido || enviando) return;
    setErro(null); setEnviando(true);
    try {
      if (modo === 'baixa') await estoqueApi.baixa({ id, itemId: item.id, quantidade: q, local, motivoId });
      else await estoqueApi.ajuste({ id, itemId: item.id, local, tipo: 'AJUSTE_SAIDA', quantidade: q, motivo: motivo.trim() });
      toast(modo === 'baixa' ? 'Baixa registrada.' : 'Ajuste registrado.');
      await onOk();
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo={modo === 'baixa' ? 'Dar baixa' : 'Ajuste de inventário (saída)'} aberto onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido || enviando} onClick={salvar}>Registrar</button></>}>
      <p><strong>{item.descricao}</strong>{item.codigo && <> · {item.codigo}</>} · Lote #{item.loteNumero}</p>
      <p className="muted">No Bazar: {item.saldoBazar} · Em Doações: {item.saldoDoacoes}</p>
      {modo === 'ajuste' && <p className="hint">Use quando faltou peça na contagem. O estoque só sobe por uma entrada aprovada.</p>}
      <div className="grid-2">
        <Field label="Estoque"><select value={local} onChange={(e) => setLocal(e.target.value as LocalEstoque)}><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
        <Field label="Quantidade" erro={q > saldo ? `Há ${saldo} neste estoque` : null}><input inputMode="numeric" value={qtd} onFocus={(e) => e.target.select()} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} autoFocus /></Field>
      </div>
      {modo === 'baixa'
        ? <Field label="Motivo da baixa"><select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}><option value="">Selecione…</option>{motivos.data?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Field>
        : <Field label="Motivo do ajuste (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>}
      <ErrorAlert erro={erro ?? motivos.erro} />
    </Modal>
  );
}

/** Preço do produto: vale para todas as unidades, de todas as entradas. Se ficar abaixo de um preço promocional, a promoção acaba. */
export function PrecoProdutoModal({ produtoId, descricao, precoAtual, onFechar, onOk }: { produtoId: string; descricao: string; precoAtual: string; onFechar: () => void; onOk: () => Promise<void> }) {
  const toast = useToast();
  const [preco, setPreco] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cents = tryCents(preco);
  const valido = cents !== null && cents > 0 && motivo.trim().length >= 5;
  async function salvar() {
    if (!valido || enviando) return;
    setErro(null); setEnviando(true);
    try {
      await estoqueApi.precoProduto(produtoId, fromCents(cents!), motivo.trim());
      toast('Preço alterado. Vendas já registradas não mudam.');
      await onOk();
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Alterar preço do produto" aberto onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido || enviando} onClick={salvar}>Salvar preço</button></>}>
      <p><strong>{descricao}</strong> · preço atual <MoneyText value={precoAtual} /></p>
      <Field label="Novo preço (R$)"><input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} autoFocus /></Field>
      <Field label="Motivo (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}

/** Preço padrão da categoria (venda por categoria): Administrador. Aberto da linha do Estoque, já vem com a categoria daquela linha. */
export function PrecoCategoriaModal({ categoriaInicial, onFechar, onOk }: { categoriaInicial?: string; onFechar: () => void; onOk: () => Promise<void> }) {
  const toast = useToast();
  const cats = useAsync(() => cadastrosApi.listar('categorias', { ativo: true }), []);
  const [categoriaId, setCategoriaId] = useState(categoriaInicial ?? '');
  const [preco, setPreco] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cents = tryCents(preco);
  const valido = !!categoriaId && cents !== null && cents > 0 && motivo.trim().length >= 5;
  async function salvar() {
    if (!valido || enviando) return;
    setEnviando(true); setErro(null);
    try {
      await estoqueApi.precoCategoria(categoriaId, fromCents(cents!), motivo.trim());
      toast('Preço padrão da categoria alterado.');
      await onOk();
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Preço padrão da categoria" aberto onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido || enviando} onClick={salvar}>Salvar preço</button></>}>
      <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} autoFocus={!categoriaInicial}><option value="">Selecione…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.nome} (atual {c.precoPadrao.replace('.', ',')})</option>)}</select></Field>
      <Field label="Novo preço (R$)"><input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} autoFocus={!!categoriaInicial} /></Field>
      <Field label="Motivo (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
      <ErrorAlert erro={erro ?? cats.erro} />
    </Modal>
  );
}
