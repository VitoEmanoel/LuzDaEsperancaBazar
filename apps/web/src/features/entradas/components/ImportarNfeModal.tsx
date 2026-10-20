/**
 * Importar NF-e (S5-04, P-20): o XML da nota vira um lote de compra com a conta a pagar; o emitente vira fornecedor quando
 * ainda não existe. A nota entra inteira ou é recusada inteira, com o motivo. Os produtos aparecem só para conferência:
 * o estoque os cadastra depois, no lote (a NF-e não traz categoria nem preço de venda).
 */
import { useState, type FormEvent } from 'react';
import { lotesApi } from '../entradas.api';
import { errorMessage } from '../../../shared/api/http';
import type { ResultadoNfe } from '../../../shared/api/types';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, Field, TabelaRolavel } from '../../../shared/components/ui';
import { useToast } from '../../../shared/components/Toast';
import { downloadBlob } from '../../../shared/lib/download';
import { formatDate } from '../../../shared/lib/format';
import { formatMoney } from '../../../shared/lib/money';

const MAX_MB = 2;
/** Quantidade e preço unitário da NF-e têm até 4 e 10 casas: mostra sem arredondar o que importa. */
const numero = (v: string, min: number, max: number) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });

export function ImportarNfeModal({ onFechar }: { onFechar: (r: ResultadoNfe | null) => void }) {
  const toast = useToast();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<ResultadoNfe | null>(null);
  const erroArquivo = arquivo && (arquivo.size > MAX_MB * 1024 * 1024 ? `Arquivo maior que ${MAX_MB} MB.` : !/\.xml$/i.test(arquivo.name) ? 'Envie o arquivo XML da nota (não o PDF da DANFE).' : null);

  async function importar(e: FormEvent) {
    e.preventDefault();
    if (!arquivo || erroArquivo || enviando) return;
    setEnviando(true); setErro(null);
    try { setR(await lotesApi.importarNfe(arquivo)); } catch (er) { setErro(errorMessage(er)); } finally { setEnviando(false); }
  }
  async function baixarModelo() {
    try { downloadBlob(await lotesApi.baixarModeloNfe(), 'modelo-nfe.xml'); } catch (er) { toast(errorMessage(er), 'erro'); }
  }

  return (
    <Modal titulo="Importar NF-e (XML)" aberto largura="lg" fechavel={!enviando} onFechar={() => { if (!enviando) onFechar(r); }}
      rodape={r
        ? <button className="btn btn-primary" onClick={() => onFechar(r)}>Fechar</button>
        : <><button className="btn" onClick={() => onFechar(null)} disabled={enviando}>Cancelar</button><button type="submit" form="form-nfe" className="btn btn-primary" disabled={!arquivo || !!erroArquivo || enviando}>{enviando ? 'Importando…' : 'Importar'}</button></>}>
      {!r ? (
        <form id="form-nfe" onSubmit={importar}>
          <p>Envie o <strong>XML</strong> da nota que o fornecedor mandou (o arquivo que termina em <code>.xml</code>). A nota vira um lote de compra com a conta a pagar no valor dela e vencimento na primeira parcela; se o fornecedor ainda não estiver cadastrado, ele é cadastrado pelo CNPJ da nota.</p>
          <p className="hint">A mesma nota não entra duas vezes. Nota cancelada, sem autorização, de teste ou emitida para outro CNPJ é recusada com o motivo.</p>
          <p className="row modelo-baixar"><span className="muted">Para testar:</span><button type="button" className="btn btn-sm" onClick={baixarModelo}>Baixar NF-e de exemplo (XML)</button></p>
          <Field label={`XML da NF-e (até ${MAX_MB} MB)`} erro={erroArquivo}>
            <input type="file" accept=".xml,application/xml,text/xml" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} autoFocus />
          </Field>
          <ErrorAlert erro={erro} />
        </form>
      ) : (
        <div className="importacao-resultado">
          <section className="importacao-bloco" data-tipo="aceitas" aria-label="Nota importada">
            <h3 role="status">✓ NF-e {r.numero} (série {r.serie}) importada no lote #{r.lote.numero}</h3>
            <ul>
              <li>Fornecedor: <strong>{r.fornecedor.nome}</strong>{r.fornecedor.novo && ' (cadastrado agora)'}</li>
              <li>Conta a pagar: <strong>{formatMoney(r.valor)}</strong>, vence em <strong>{formatDate(r.vencimento)}</strong>{r.parcelas > 1 && ` (a nota tem ${r.parcelas} parcelas: a conta usa a primeira data e o valor total)`}</li>
              <li>Emissão: {formatDate(r.emissao)}</li>
            </ul>
          </section>
          <h3>Produtos da nota ({r.produtos.length}): o estoque os cadastra no lote</h3>
          <TabelaRolavel><table className="table compact">
            <thead><tr><th className="num">Item</th><th>Produto</th><th className="num">Qtd.</th><th>Un.</th><th className="num">Valor unit.</th><th className="num">Total</th></tr></thead>
            <tbody>{r.produtos.map((p) => <tr key={p.item}><td className="num">{p.item}</td><td>{p.nome}</td><td className="num">{numero(p.quantidade, 0, 4)}</td><td>{p.unidade}</td><td className="num">R$ {numero(p.valorUnitario, 2, 4)}</td><td className="num">R$ {numero(p.valorTotal, 2, 2)}</td></tr>)}</tbody>
          </table></TabelaRolavel>
        </div>
      )}
    </Modal>
  );
}
