/** Detalhe de um caixa (S5-06): totais por forma, gaveta, conferência e tudo o que aconteceu, com o PDF do fechamento. */
import { caixaApi } from '../caixa.api';
import { errorMessage } from '../../../shared/api/http';
import { FORMAS_PAGAMENTO, type CaixaSessao } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, MoneyText, TabelaRolavel } from '../../../shared/components/ui';
import { downloadBlob } from '../../../shared/lib/download';
import { formatDateTime } from '../../../shared/lib/format';
import { useToast } from '../../../shared/components/Toast';
import { LinhaDoTempoCaixa } from './LinhaDoTempoCaixa';

export function CaixaDetalheModal({ caixa, onFechar }: { caixa: CaixaSessao; onFechar: () => void }) {
  const toast = useToast();
  const dados = useAsync(() => Promise.all([caixaApi.resumo(caixa.id), caixaApi.linhaDoTempo(caixa.id)]), [caixa.id]);
  const [resumo, tempo] = dados.data ?? [null, null];
  // o caixa pode ter fechado depois de a lista carregar: vale o que o servidor acabou de devolver
  const cx = resumo?.caixa ?? caixa;
  const aberto = cx.status === 'ABERTO';
  async function baixarPdf() {
    try { downloadBlob(await caixaApi.pdfFechamento(caixa.id), aberto ? 'caixa-parcial.pdf' : 'fechamento-de-caixa.pdf'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <Modal titulo={`Caixa ${caixa.terminalNome} · ${caixa.operadorNome}`} aberto onFechar={onFechar} largura="lg"
      rodape={<><button className="btn" onClick={baixarPdf} disabled={!resumo}>Baixar PDF</button><button className="btn btn-primary" onClick={onFechar}>Fechar</button></>}>
      <p className="muted">
        Aberto em {formatDateTime(cx.abertoEm)}{aberto ? ' e ainda aberto: os valores são até agora.' : `, fechado em ${formatDateTime(cx.fechadoEm)}.`}
      </p>
      <ErrorAlert erro={dados.erro} />
      {dados.carregando && !resumo ? <p>Carregando…</p> : resumo && tempo && (<>
        <TabelaRolavel><table className="table">
          <tbody>
            <tr><td>Fundo de troco</td><td className="num"><MoneyText value={resumo.fundoTroco} /></td></tr>
            {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}</td><td className="num"><MoneyText value={resumo.totaisPorForma[f.value]} /></td></tr>)}
            <tr><td>Suprimentos</td><td className="num"><MoneyText value={resumo.suprimentos} /></td></tr>
            <tr><td>Sangrias</td><td className="num">− <MoneyText value={resumo.sangrias} /></td></tr>
            <tr className="destaque"><td>{aberto ? 'Dinheiro na gaveta agora' : 'Dinheiro esperado na gaveta'}</td><td className="num"><MoneyText value={aberto ? resumo.esperadoDinheiro : cx.esperado ?? resumo.esperadoDinheiro} /></td></tr>
            {!aberto && <>
              <tr><td>Contado no fechamento</td><td className="num">{cx.contado ? <MoneyText value={cx.contado} /> : '—'}</td></tr>
              <tr className="destaque"><td>Diferença</td><td className="num">{cx.diferenca ? <MoneyText value={cx.diferenca} /> : '—'}</td></tr>
            </>}
          </tbody>
        </table></TabelaRolavel>
        <p className="muted">{resumo.quantidadeVendas} venda(s) neste caixa.{cx.observacao && <> Observação do fechamento: {cx.observacao}</>}</p>
        <h3>O que aconteceu</h3>
        <LinhaDoTempoCaixa eventos={tempo.eventos} />
      </>)}
    </Modal>
  );
}
