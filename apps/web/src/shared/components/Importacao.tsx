/**
 * Peças comuns das importações de planilha (S5-02, S5-05): baixar o modelo (CSV ou XLSX) e o resultado no mesmo formato
 * em todas as telas, com as aceitas e as recusadas separadas por cor, ícone e texto, cada recusada com a linha e o motivo.
 */
import { useState } from 'react';
import { modelosApi } from '../../features/admin/admin.api';
import { errorMessage } from '../api/http';
import type { ResultadoImportacao, TipoModelo } from '../api/types';
import { downloadBlob } from '../lib/download';
import { useToast } from './Toast';
import { TabelaRolavel } from './ui';

export function BaixarModelo({ tipo }: { tipo: TipoModelo }) {
  const toast = useToast();
  const [baixando, setBaixando] = useState(false);
  async function baixar(formato: 'csv' | 'xlsx') {
    setBaixando(true);
    try { downloadBlob(await modelosApi.baixar(tipo, formato), `modelo-${tipo}.${formato}`); } catch (e) { toast(errorMessage(e), 'erro'); } finally { setBaixando(false); }
  }
  return (
    <p className="row modelo-baixar">
      <span className="muted">Modelo com as colunas e exemplos:</span>
      <button type="button" className="btn btn-sm" disabled={baixando} onClick={() => baixar('xlsx')}>Baixar modelo (XLSX)</button>
      <button type="button" className="btn btn-sm" disabled={baixando} onClick={() => baixar('csv')}>Baixar modelo (CSV)</button>
    </p>
  );
}

export function ResultadoImportacaoView({ r, aceitasTexto = 'gravadas' }: { r: ResultadoImportacao; aceitasTexto?: string }) {
  const comCodigo = r.aceitas.some((x) => x.codigo), comQtd = r.aceitas.some((x) => x.quantidade !== undefined);
  return (
    <div className="importacao-resultado">
      <p role="status"><strong>{r.total} linha(s) lida(s):</strong> <span className="txt-ok">✓ {r.aceitas.length} aceita(s)</span> · <span className="txt-erro">✕ {r.recusadas.length} recusada(s)</span></p>
      {r.recusadas.length > 0 && (
        <section className="importacao-bloco" data-tipo="recusadas" aria-label="Linhas recusadas">
          <h3>✕ Recusadas: corrija na planilha e importe só estas linhas</h3>
          <TabelaRolavel><table className="table compact">
            <thead><tr><th className="num">Linha</th><th>Registro</th><th>Motivo</th></tr></thead>
            <tbody>{r.recusadas.map((x) => <tr key={x.linha}><td className="num">{x.linha}</td><td>{x.nome || '—'}</td><td>{x.motivo}</td></tr>)}</tbody>
          </table></TabelaRolavel>
        </section>
      )}
      {r.aceitas.length > 0 && (
        <section className="importacao-bloco" data-tipo="aceitas" aria-label="Linhas aceitas">
          <h3>✓ Aceitas: {aceitasTexto}</h3>
          <TabelaRolavel><table className="table compact">
            <thead><tr><th className="num">Linha</th>{comCodigo && <th>Código</th>}<th>Registro</th>{comQtd && <th className="num">Qtd.</th>}</tr></thead>
            <tbody>{r.aceitas.map((x) => <tr key={x.linha}><td className="num">{x.linha}</td>{comCodigo && <td>{x.codigo ?? '—'}</td>}<td>{x.nome}</td>{comQtd && <td className="num">{x.quantidade}</td>}</tr>)}</tbody>
          </table></TabelaRolavel>
        </section>
      )}
    </div>
  );
}
