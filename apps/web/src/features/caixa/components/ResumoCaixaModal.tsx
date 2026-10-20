/** Total do caixa agora (fechamento parcial): dinheiro na gaveta, vendas por forma e tudo o que aconteceu, SEM fechar o caixa. */
import { caixaApi } from '../caixa.api';
import { errorMessage } from '../../../shared/api/http';
import { FORMAS_PAGAMENTO } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, MoneyText, TabelaRolavel } from '../../../shared/components/ui';
import { downloadBlob } from '../../../shared/lib/download';
import { useToast } from '../../../shared/components/Toast';
import { LinhaDoTempoCaixa } from './LinhaDoTempoCaixa';

export function ResumoCaixaModal({ aberto, caixaId, onFechar }: { aberto: boolean; caixaId: string; onFechar: () => void }) {
  const toast = useToast();
  const dados = useAsync(() => (aberto ? Promise.all([caixaApi.previaFechamento(caixaId), caixaApi.linhaDoTempo(caixaId)]) : Promise.resolve(null)), [aberto, caixaId]);
  const [previa, tempo] = dados.data ?? [null, null];
  async function baixarPdf() {
    try { downloadBlob(await caixaApi.pdfFechamento(caixaId), 'caixa-parcial.pdf'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <Modal titulo="Total do caixa agora" aberto={aberto} onFechar={onFechar} largura="lg"
      rodape={<><button className="btn" onClick={baixarPdf} disabled={!previa}>Baixar PDF</button><button className="btn btn-primary" onClick={onFechar}>Fechar</button></>}>
      <p className="muted">O caixa continua aberto: isto é só a conferência até este momento.</p>
      <ErrorAlert erro={dados.erro} />
      {dados.carregando && !previa ? <p>Carregando…</p> : previa && tempo && (<>
        <TabelaRolavel><table className="table">
          <tbody>
            <tr><td>Fundo de troco</td><td className="num"><MoneyText value={previa.fundoTroco} /></td></tr>
            {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}</td><td className="num"><MoneyText value={previa.totaisPorForma[f.value]} /></td></tr>)}
            <tr><td>Suprimentos</td><td className="num"><MoneyText value={previa.suprimentos} /></td></tr>
            <tr><td>Sangrias</td><td className="num">− <MoneyText value={previa.sangrias} /></td></tr>
            <tr className="destaque"><td>Dinheiro na gaveta agora</td><td className="num"><MoneyText value={previa.esperadoDinheiro} /></td></tr>
          </tbody>
        </table></TabelaRolavel>
        <p className="muted">{previa.quantidadeVendas} venda(s) neste caixa.</p>
        <h3>O que aconteceu desde a abertura</h3>
        <LinhaDoTempoCaixa eventos={tempo.eventos} />
      </>)}
    </Modal>
  );
}
