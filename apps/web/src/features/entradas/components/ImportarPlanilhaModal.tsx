/**
 * Importar planilha no lote (S5-03, P-19): CSV ou XLSX, uma linha por produto. As linhas válidas viram itens cadastrados
 * (aguardando aprovação); o resultado (ResultadoImportacaoView) é o mesmo de todas as importações.
 */
import { useState, type FormEvent } from 'react';
import { lotesApi } from '../entradas.api';
import { errorMessage } from '../../../shared/api/http';
import type { ResultadoImportacao } from '../../../shared/api/types';
import { BaixarModelo, ResultadoImportacaoView } from '../../../shared/components/Importacao';
import { Modal } from '../../../shared/components/Modal';
import { ErrorAlert, Field } from '../../../shared/components/ui';

const MAX_MB = 5;

export function ImportarPlanilhaModal({ loteId, compra, onFechar }: { loteId: string; compra: boolean; onFechar: (importou: boolean) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<ResultadoImportacao | null>(null);
  const erroArquivo = arquivo && (arquivo.size > MAX_MB * 1024 * 1024 ? `Arquivo maior que ${MAX_MB} MB.` : !/\.(csv|xlsx)$/i.test(arquivo.name) ? 'Envie a planilha em CSV ou XLSX.' : null);

  async function importar(e: FormEvent) {
    e.preventDefault();
    if (!arquivo || erroArquivo || enviando) return;
    setEnviando(true); setErro(null);
    try { setR(await lotesApi.importar(loteId, arquivo)); } catch (er) { setErro(errorMessage(er)); } finally { setEnviando(false); }
  }

  return (
    // durante o envio a janela não fecha: o resultado (e as recusadas) não pode se perder
    <Modal titulo="Importar planilha no lote" aberto largura="lg" fechavel={!enviando} onFechar={() => { if (!enviando) onFechar(!!r?.aceitas.length); }}
      rodape={r
        ? <button className="btn btn-primary" onClick={() => onFechar(r.aceitas.length > 0)}>Fechar</button>
        : <><button className="btn" onClick={() => onFechar(false)} disabled={enviando}>Cancelar</button><button type="submit" form="form-importar" className="btn btn-primary" disabled={!arquivo || !!erroArquivo || enviando}>{enviando ? 'Importando…' : 'Importar'}</button></>}>
      {!r ? (
        <form id="form-importar" onSubmit={importar}>
          <p>Uma linha por produto, até 1.000 linhas por arquivo. Colunas: <code>titulo_etiqueta</code>, <code>nome</code>, <code>categoria</code>, <code>preco</code>, <code>quantidade</code>,{' '}
            <code>valor_atribuido</code>{compra && ' (o custo unitário, obrigatório na compra)'} e, se quiser, <code>estoque</code> (Bazar ou Doações), <code>peca_unica</code> (sim/não),{' '}
            <code>modelo</code>, <code>marca</code>, <code>ano</code>, <code>tipo</code>, <code>tamanho</code>, <code>cor</code> e <code>condicao</code>.
            Para uma nova entrada de um produto que já existe, informe o <code>codigo</code> (BZ…), a <code>quantidade</code> e o <code>valor_atribuido</code>.</p>
          <BaixarModelo tipo="lote" />
          <p className="hint">As linhas certas entram como "aguardando aprovação"; as erradas voltam com o motivo, para corrigir e importar só elas de novo. Importar o mesmo arquivo duas vezes cadastra tudo de novo.</p>
          <Field label={`Planilha (CSV ou XLSX, até ${MAX_MB} MB)`} erro={erroArquivo}>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} autoFocus />
          </Field>
          <ErrorAlert erro={erro} />
        </form>
      ) : (
        <ResultadoImportacaoView r={r} aceitasTexto="cadastradas, aguardando aprovação" />
      )}
    </Modal>
  );
}
