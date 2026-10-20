/** Comprovante NÃO FISCAL (aviso explícito). */
import { Modal } from '../../../shared/components/Modal';
import type { Instituicao, Venda } from '../../../shared/api/types';
import { FORMAS_PAGAMENTO } from '../../../shared/api/types';
import { formatMoney } from '../../../shared/lib/money';
import { formatDate, formatDateTime, formatDocumento } from '../../../shared/lib/format';

/** `instituicao` vem do servidor; sem ela, cai no nome padrão e sem CNPJ. */
export function ComprovanteModal({ venda, instituicao, onFechar }: { venda: Venda | null; instituicao?: Instituicao | null; onFechar: () => void }) {
  if (!venda) return null;
  return (
    <Modal titulo="Venda concluída" aberto onFechar={onFechar} largura="sm"
      rodape={<><button className="btn" onClick={() => window.print()}>Imprimir</button><button className="btn btn-primary" onClick={onFechar} autoFocus>Nova venda (Enter)</button></>}>
      <div className="print-area comprovante">
        <h3>{instituicao?.nome || 'Bazar Luz da Esperança'}</h3>
        {(instituicao?.cnpj || instituicao?.endereco) && (
          <p className="comprovante-instituicao">
            {instituicao.cnpj && <>CNPJ {formatDocumento(instituicao.cnpj)}</>}
            {instituicao.cnpj && instituicao.endereco && <br />}
            {instituicao.endereco}
          </p>
        )}
        <p className="aviso-nao-fiscal">DOCUMENTO NÃO FISCAL — SEM VALOR FISCAL</p>
        <p>
          Venda nº <strong>{venda.numero}</strong>
          <br />{formatDateTime(venda.ocorridaEm)} · {venda.operadorNome}
        </p>
        {venda.cpf && <p>CPF: <strong>{formatDocumento(venda.cpf)}</strong></p>}
        <table>
          <tbody>
            {venda.itens.map((i, k) => <tr key={k}><td>{i.quantidade}× {i.descricao}</td><td className="num">{formatMoney(i.total)}</td></tr>)}
          </tbody>
        </table>
        {venda.desconto !== '0.00' && <p className="linha">Desconto <span>{formatMoney(venda.desconto)}</span></p>}
        <p className="linha total">Total <span>{formatMoney(venda.total)}</span></p>
        {venda.pagamentos.map((p, k) => <p key={k} className="linha">{FORMAS_PAGAMENTO.find((f) => f.value === p.forma)?.label} <span>{formatMoney(p.valorRecebido ?? p.valor)}</span></p>)}
        {venda.troco !== '0.00' && <p className="linha troco">Troco <span>{formatMoney(venda.troco)}</span></p>}
        {venda.clienteNome && <p>Fiado: {venda.clienteNome} · vence {formatDate(venda.vencimentoFiado)}</p>}
        <p className="muted">Obrigado por apoiar a Luz da Esperança!</p>
      </div>
    </Modal>
  );
}
