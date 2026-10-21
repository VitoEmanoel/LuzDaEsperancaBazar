/**
 * Modal de pagamento: formas (pode dividir), valor recebido e troco, fiado com cliente e vencimento,
 * cadastro rápido de cliente e desconto dentro do limite do perfil (PA-08 pendente).
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, Field } from '../../../shared/components/ui';
import { FORMAS_PAGAMENTO, type CatalogoPdv, type FormaPagamento, type PagamentoRequest } from '../../../shared/api/types';
import { formatMoney, fromCents, tryCents } from '../../../shared/lib/money';
import { clientesApi } from '../../cadastros/cadastros.api';
import { errorMessage } from '../../../shared/api/http';
import { uuid } from '../../../shared/lib/uuid';
import { maskPhone, todayLocal } from '../../../shared/lib/format';
import { clientesComMesmoTelefone, type ClienteResumo } from '../../cadastros/telefoneDuplicado';
import { AvisoTelefoneDuplicado } from '../../cadastros/components/AvisoTelefoneDuplicado';

/** Prazo padrão do fiado — PA-07 pendente; o valor oficial virá do parâmetro `fiado.prazo_dias`. */
const PRAZO_FIADO_DIAS = 30;

export interface ResultadoPagamento {
  pagamentos: PagamentoRequest[];
  descontoCents: number;
  clienteId?: string;
  clienteNome?: string;
  vencimentoFiado?: string;
  trocoCents: number;
}

interface Props {
  aberto: boolean;
  subtotalCents: number;
  limiteDescontoPct: number;
  clientesLocais: CatalogoPdv['clientesFiado'];
  onNovoClienteLocal: (c: { id: string; nome: string; telefone: string }) => void;
  onConfirmar: (r: ResultadoPagamento) => Promise<void>;
  onFechar: () => void;
}

/** O operador digita o que RECEBEU em cada forma; o valor aplicado à conta e o troco o sistema calcula. */
interface LinhaPg { forma: FormaPagamento; recebido: string }

export function PagamentoModal(p: Props) {
  const [desconto, setDesconto] = useState('');
  // A primeira linha já existe quando a janela abre: o campo do valor recebido nasce com o foco (sem um instante vazio em que o foco
  // pararia em outro botão e o primeiro número digitado se perderia).
  const [linhas, setLinhas] = useState<LinhaPg[]>([{ forma: 'DINHEIRO', recebido: '' }]);
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null);
  const [vencimento, setVencimento] = useState(todayLocal(PRAZO_FIADO_DIAS));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const descontoCents = tryCents(desconto) ?? 0;
  const totalCents = Math.max(0, p.subtotalCents - descontoCents);
  const descontoPct = p.subtotalCents ? (descontoCents * 100) / p.subtotalCents : 0;
  const descontoInvalido = descontoCents < 0 || descontoCents > p.subtotalCents || descontoPct > p.limiteDescontoPct;

  // Ao abrir: uma linha em dinheiro, SEM valor preenchido: o operador precisa digitar o que recebeu.
  useEffect(() => {
    if (p.aberto) { setLinhas([{ forma: 'DINHEIRO', recebido: '' }]); setDesconto(''); setCliente(null); setErro(null); }
  }, [p.aberto]);

  // A conta, linha por linha: quanto cada forma aplica ao que falta, o que sobra de troco (só dinheiro) e erros.
  const calc = useMemo(() => {
    const itens = linhas.map((l) => {
      const rec = tryCents(l.recebido);
      const recebido = rec !== null && rec > 0 ? rec : 0;
      return { recebido, aplicado: 0, trocoLinha: 0, erro: null as string | null, vazio: recebido <= 0 };
    });
    let restante = totalCents;
    // 1º as formas sem troco (PIX, cartão, fiado), na ordem em que aparecem; 2º o dinheiro, que fecha o que sobrou e gera o troco.
    // Assim a ordem das linhas não muda a conta: R$ 70 no PIX e nota de R$ 50 para pagar R$ 30 dão troco de R$ 20.
    linhas.forEach((l, i) => {
      if (l.forma === 'DINHEIRO') return;
      const c = itens[i]!;
      c.aplicado = c.recebido;
      if (c.recebido > restante) c.erro = restante <= 0 ? 'A conta já está paga' : `Passa do que falta (${formatMoney(restante)})`;
      restante -= c.aplicado;
    });
    let troco = 0;
    linhas.forEach((l, i) => {
      if (l.forma !== 'DINHEIRO') return;
      const c = itens[i]!;
      c.aplicado = Math.min(c.recebido, Math.max(0, restante));
      if (c.recebido > 0 && c.aplicado <= 0) c.erro = 'A conta já está paga'; // sem troco: não há o que devolver de uma linha recusada
      else c.trocoLinha = c.recebido - c.aplicado;
      restante -= c.aplicado; troco += c.trocoLinha;
    });
    return { itens, falta: Math.max(0, restante), troco };
  }, [linhas, totalCents]);

  const temFiado = linhas.some((l) => l.forma === 'FIADO');
  const linhasOk = calc.itens.every((i) => !i.vazio && !i.erro);
  const podeConfirmar = !descontoInvalido && totalCents > 0 && calc.falta === 0 && linhasOk && (!temFiado || (!!cliente && !!vencimento));
  const podeDividir = calc.falta > 0 && linhasOk && linhas.length < FORMAS_PAGAMENTO.length;

  function atualizar(i: number, patch: Partial<LinhaPg>) { setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }
  function adicionarForma() {
    const usadas = new Set(linhas.map((l) => l.forma));
    const forma = FORMAS_PAGAMENTO.find((f) => !usadas.has(f.value))?.value; if (!forma) return;
    setLinhas((ls) => [...ls, { forma, recebido: '' }]);
  }

  async function confirmar() {
    if (!podeConfirmar) return;
    setEnviando(true); setErro(null);
    try {
      await p.onConfirmar({
        descontoCents, trocoCents: calc.troco,
        // valor = o que a forma aplica à conta; valorRecebido = o que o cliente entregou (fiado não tem: o valor fica na conta dele)
        pagamentos: linhas.map((l, i) => ({
          forma: l.forma, valor: fromCents(calc.itens[i]!.aplicado),
          ...(l.forma !== 'FIADO' ? { valorRecebido: fromCents(calc.itens[i]!.recebido) } : {}),
        })),
        ...(temFiado && cliente ? { clienteId: cliente.id, clienteNome: cliente.nome, vencimentoFiado: vencimento } : {}),
      });
    } catch (e) { setErro(errorMessage(e)); }
    finally { setEnviando(false); }
  }

  /** Enter: se ainda falta e dá para dividir, abre a próxima forma; se a conta fechou, finaliza. */
  function aoEnviar() { if (podeConfirmar) void confirmar(); else if (podeDividir) adicionarForma(); }

  return (
    <Modal titulo="Pagamento" aberto={p.aberto} onFechar={p.onFechar} fechavel={!enviando} largura="lg"
      rodape={<>
        <button className="btn" onClick={p.onFechar} disabled={enviando}>Voltar (Esc)</button>
        <button className="btn btn-primary btn-lg" onClick={confirmar} disabled={!podeConfirmar || enviando}>{enviando ? 'Gravando…' : 'Finalizar venda (Enter)'}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); aoEnviar(); }}>
        <div className="pg-resumo">
          <div><span>Subtotal</span><strong>{formatMoney(p.subtotalCents)}</strong></div>
          <div><span>Desconto</span><strong>{formatMoney(descontoCents)}</strong></div>
          <div className="pg-total"><span>Total</span><strong>{formatMoney(totalCents)}</strong></div>
        </div>
        {p.limiteDescontoPct > 0 && (
          <Field label={`Desconto em R$ (limite do perfil: ${p.limiteDescontoPct}%)`} erro={descontoInvalido ? 'Desconto acima do limite do seu perfil — peça autorização a um administrador.' : null}>
            <input inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
          </Field>
        )}
        {linhas.map((l, i) => {
          const c = calc.itens[i]!;
          const dica = c.erro ? undefined
            : l.forma === 'FIADO' ? 'Fica na conta do cliente'
            : l.forma === 'DINHEIRO' && c.recebido > 0 ? `Vale ${formatMoney(c.aplicado)} da conta${c.trocoLinha ? ` · troco ${formatMoney(c.trocoLinha)}` : ''}`
            : undefined;
          return (
            <div key={i} className="pg-linha">
              <Field label="Forma">
                <select value={l.forma} onChange={(e) => atualizar(i, { forma: e.target.value as FormaPagamento })}>
                  {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value} disabled={linhas.some((o, j) => j !== i && o.forma === f.value)}>{f.label}</option>)}
                </select>
              </Field>
              <Field label={l.forma === 'FIADO' ? 'Valor no fiado (R$)' : 'Valor recebido (R$)'} erro={c.erro} hint={dica}>
                <input inputMode="decimal" value={l.recebido} onChange={(e) => atualizar(i, { recebido: e.target.value })} placeholder="Digite quanto recebeu" autoFocus required />
              </Field>
              {linhas.length > 1 && <button type="button" className="btn btn-ghost" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} aria-label="Remover forma">✕</button>}
            </div>
          );
        })}
        <div className="row" aria-live="polite">
          {podeDividir && <button type="button" className="btn" onClick={adicionarForma}>+ Dividir pagamento</button>}
          {calc.falta > 0 && <span className="badge badge-alerta">Falta {formatMoney(calc.falta)}</span>}
          {calc.falta === 0 && linhasOk && totalCents > 0 && <span className="badge badge-ok">Conta coberta</span>}
        </div>
        {calc.troco > 0 && <div className="troco" aria-live="polite">Troco a devolver: <strong>{formatMoney(calc.troco)}</strong></div>}
        {temFiado && (
          <fieldset className="fiado">
            <legend>Fiado</legend>
            <SeletorCliente clientesLocais={p.clientesLocais} cliente={cliente} onSelecionar={setCliente} onNovoClienteLocal={p.onNovoClienteLocal} />
            <Field label="Vencimento"><input type="date" value={vencimento} min={todayLocal()} onChange={(e) => setVencimento(e.target.value)} /></Field>
          </fieldset>
        )}
        <ErrorAlert erro={erro} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Busca de cliente via POST /clientes/busca (sem PII na URL). */
function SeletorCliente({ clientesLocais, cliente, onSelecionar, onNovoClienteLocal }: {
  clientesLocais: CatalogoPdv['clientesFiado']; cliente: { id: string; nome: string } | null;
  onSelecionar: (c: { id: string; nome: string } | null) => void; onNovoClienteLocal: Props['onNovoClienteLocal'];
}) {
  const [termo, setTermo] = useState('');
  const [remotos, setRemotos] = useState<{ id: string; nome: string; telefone: string }[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState(''); const [tel, setTel] = useState(''); const [ciencia, setCiencia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** null = ainda não conferido; [] = conferido e livre; [...] = mostrar aviso (ticket 12) */
  const [duplicados, setDuplicados] = useState<ClienteResumo[] | null>(null);
  /** Enter dentro do seletor de cliente não pode enviar o formulário do pagamento (nem abrir outra forma). */
  const enter = (acao?: () => void) => (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter') { e.preventDefault(); acao?.(); } };

  const locais = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return t.length < 2 ? [] : clientesLocais.filter((c) => c.nome.toLowerCase().includes(t) || c.telefone.replace(/\D/g, '').endsWith(t.replace(/\D/g, '') || '§')).slice(0, 8);
  }, [termo, clientesLocais]);

  useEffect(() => {
    if (termo.trim().length < 3) { setRemotos(null); return; } // a API só busca a partir de 3 para quem opera o PDV (S6-15)
    const t = setTimeout(() => { clientesApi.buscar(termo.trim(), true).then(setRemotos).catch(() => setRemotos(null)); }, 300);
    return () => clearTimeout(t);
  }, [termo]);

  async function cadastrar(mesmoAssim = false) {
    setErro(null);
    const digitos = tel.replace(/\D/g, '');
    if (nome.trim().length < 3 || digitos.length < 10 || !ciencia) { setErro('Informe nome, telefone com DDD e a ciência do aviso de privacidade.'); return; }
    if (!mesmoAssim) {
      const achados = await clientesComMesmoTelefone(digitos, { online: true, locais: clientesLocais });
      if (achados.length) { setDuplicados(achados); return; }
    }
    setDuplicados(null);
    const c = { id: uuid(), nome: nome.trim(), telefone: tel.trim(), cienciaAviso: true };
    try { await clientesApi.criar(c); } catch (e) { setErro(errorMessage(e)); return; }
    onNovoClienteLocal(c); onSelecionar({ id: c.id, nome: c.nome }); setNovo(false); setNome(''); setTel(''); setCiencia(false);
  }
  function usarExistente(c: ClienteResumo) {
    onSelecionar({ id: c.id, nome: c.nome }); setDuplicados(null); setNovo(false); setNome(''); setTel(''); setCiencia(false);
  }

  if (cliente) return <div className="row"><span>Cliente: <strong>{cliente.nome}</strong></span><button type="button" className="btn btn-ghost" onClick={() => onSelecionar(null)}>Trocar</button></div>;
  const lista = remotos ?? locais;
  return (
    <div>
      {!novo ? (<>
        <Field label="Buscar cliente (nome ou final do telefone)"><input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={enter()} autoComplete="off" /></Field>
        <ul className="lista-clientes">
          {lista.map((c) => <li key={c.id}><button type="button" className="btn btn-block" onClick={() => onSelecionar(c)}>{c.nome} <small>{maskPhone(c.telefone)}</small></button></li>)}
        </ul>
        <button type="button" className="btn" onClick={() => setNovo(true)}>+ Cadastro rápido</button>
      </>) : (
        <div className="card-inset">
          <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={enter()} maxLength={120} autoFocus /></Field>
          <Field label="Telefone com DDD"><input value={tel} onChange={(e) => { setTel(e.target.value); setDuplicados(null); }} onKeyDown={enter(() => void cadastrar())} inputMode="tel" maxLength={20} /></Field>
          <label className="check"><input type="checkbox" checked={ciencia} onChange={(e) => setCiencia(e.target.checked)} /> Cliente ciente do aviso de privacidade: nome e telefone usados só para controle do fiado (LGPD).</label>
          {duplicados && duplicados.length > 0 && (
            <AvisoTelefoneDuplicado encontrados={duplicados} onUsarExistente={usarExistente} onCadastrarMesmoAssim={() => void cadastrar(true)} />
          )}
          <ErrorAlert erro={erro} />
          <div className="row"><button type="button" className="btn" onClick={() => { setNovo(false); setDuplicados(null); }}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void cadastrar()}>Cadastrar</button></div>
        </div>
      )}
    </div>
  );
}
