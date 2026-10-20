/** Abas de configuração: terminais, parâmetros, instituição, regra fiscal versionada e importação de cadastros. */
import { useEffect, useState } from 'react';
import { cadastrosApi, instituicaoApi } from '../../cadastros/cadastros.api';
import { importacoesApi, parametrosApi } from '../admin.api';
import { regrasFiscaisApi } from '../../relatorios/relatorios.api';
import { terminaisApi } from '../../caixa/caixa.api';
import { errorMessage } from '../../../shared/api/http';
import type { Instituicao, RegraFiscal, ResultadoImportacao } from '../../../shared/api/types';
import { BaixarModelo, ResultadoImportacaoView } from '../../../shared/components/Importacao';
import { estoqueApi } from '../../estoque/estoque.api';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, ErrorAlert, Field, TabelaRolavel } from '../../../shared/components/ui';
import { formatDate, todayLocal } from '../../../shared/lib/format';
import { fromCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

export function TerminaisTab() {
  const toast = useToast();
  const { data, erro, reload } = useAsync(() => terminaisApi.listar(), []);
  const [nome, setNome] = useState('');
  async function criar() {
    if (nome.trim().length < 3) return;
    try { await terminaisApi.criar({ id: uuid(), nome: nome.trim() }); setNome(''); toast('Terminal criado.'); await reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function alternar(id: string, ativo: boolean) {
    // Desativar revoga as sessões do terminal; na próxima conexão ele apaga os dados locais (RNF-09).
    if (ativo && !window.confirm('Desativar o terminal encerra as sessões dele e apaga os dados locais na próxima conexão. Continuar?')) return;
    try { await terminaisApi.atualizar(id, { ativo: !ativo }); await reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <section className="narrow">
      <div className="row"><Field label="Novo terminal"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} /></Field><button className="btn btn-primary" onClick={criar}>Adicionar</button></div>
      <ErrorAlert erro={erro} />
      <TabelaRolavel><table className="table"><tbody>{data?.map((t) => (
        <tr key={t.id}><td>{t.nome}</td><td>{t.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}</td><td><button className="btn btn-sm" onClick={() => alternar(t.id, t.ativo)}>{t.ativo ? 'Desativar' : 'Reativar'}</button></td></tr>
      ))}</tbody></table></TabelaRolavel>
    </section>
  );
}

export function ParametrosTab() {
  const toast = useToast();
  const { data, erro } = useAsync(() => parametrosApi.listar(), []);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setVals(Object.fromEntries(data.map((p) => [p.chave, p.valor]))); }, [data]);
  async function salvar() {
    try { await parametrosApi.salvar(Object.entries(vals).map(([chave, valor]) => ({ chave, valor }))); toast('Parâmetros salvos.'); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <section className="narrow card">
      <ErrorAlert erro={erro} />
      {data?.map((p) => (
        p.tipo === 'bool'
          ? <label key={p.chave} className="check"><input type="checkbox" checked={vals[p.chave] === '1'} onChange={(e) => setVals({ ...vals, [p.chave]: e.target.checked ? '1' : '0' })} /> {p.descricao}</label>
          : <Field key={p.chave} label={p.descricao} hint={p.chave}>
            <input inputMode={p.tipo === 'number' ? 'numeric' : undefined} value={vals[p.chave] ?? ''} onChange={(e) => setVals({ ...vals, [p.chave]: p.tipo === 'number' ? e.target.value.replace(/\D/g, '') : e.target.value })} />
          </Field>
      ))}
      <button className="btn btn-primary" onClick={salvar}>Salvar</button>
    </section>
  );
}

export function InstituicaoTab() {
  const toast = useToast();
  const { data, erro } = useAsync(() => instituicaoApi.obter(), []);
  const [i, setI] = useState<Instituicao | null>(null);
  useEffect(() => { if (data) setI(data); }, [data]);
  if (!i) return <ErrorAlert erro={erro} />;
  const campo = (k: keyof Instituicao, rotulo: string) => <Field label={rotulo}><input value={i[k]} onChange={(e) => setI({ ...i, [k]: e.target.value })} maxLength={150} /></Field>;
  return (
    <section className="narrow card">
      {campo('nome', 'Nome')}{campo('cnpj', 'CNPJ')}{campo('endereco', 'Endereço')}{campo('telefone', 'Telefone')}
      <button className="btn btn-primary" onClick={() => instituicaoApi.salvar(i).then(() => toast('Dados salvos.')).catch((e) => toast(errorMessage(e), 'erro'))}>Salvar</button>
    </section>
  );
}

export function RegrasFiscaisTab() {
  const toast = useToast();
  const regras = useAsync(() => regrasFiscaisApi.listar(), []);
  const cats = useAsync(() => cadastrosApi.listar('categorias'), []);
  const [alvo, setAlvo] = useState<RegraFiscal['alvo']>('GERAL'); const [alvoId, setAlvoId] = useState('');
  const [situacao, setSituacao] = useState<RegraFiscal['situacao']>('ISENTO'); const [aliquota, setAliquota] = useState('0');
  const [inicio, setInicio] = useState(todayLocal(1));
  const aliqCents = tryCents(aliquota);
  async function criar() {
    if (aliqCents === null || (alvo === 'CATEGORIA' && !alvoId)) return;
    try {
      await regrasFiscaisApi.criar({ id: uuid(), alvo, alvoId: alvo === 'GERAL' ? undefined : alvoId, situacao, aliquota: situacao === 'ISENTO' ? '0.00' : fromCents(aliqCents), vigenciaInicio: inicio });
      toast('Nova regra criada; a anterior do mesmo alvo foi encerrada. Vendas passadas não mudam.'); await regras.reload();
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  return (
    <section>
      <div className="card">
        <h2>Nova regra (versionada por vigência)</h2>
        <div className="grid-2">
          <Field label="Alvo"><select value={alvo} onChange={(e) => setAlvo(e.target.value as RegraFiscal['alvo'])}><option value="GERAL">Geral</option><option value="CATEGORIA">Categoria</option></select></Field>
          {alvo === 'CATEGORIA' && <Field label="Categoria"><select value={alvoId} onChange={(e) => setAlvoId(e.target.value)}><option value="">Selecione…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>}
          <Field label="Situação"><select value={situacao} onChange={(e) => setSituacao(e.target.value as RegraFiscal['situacao'])}><option value="ISENTO">Isento</option><option value="TRIBUTADO">Tributado</option></select></Field>
          {situacao === 'TRIBUTADO' && <Field label="Alíquota (%)"><input inputMode="decimal" value={aliquota} onChange={(e) => setAliquota(e.target.value)} /></Field>}
          <Field label="Vigência a partir de"><input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Field>
        </div>
        <button className="btn btn-primary" onClick={criar}>Criar regra</button>
      </div>
      <ErrorAlert erro={regras.erro} />
      <TabelaRolavel><table className="table"><thead><tr><th>Alvo</th><th>Situação</th><th className="num">Alíquota</th><th>Vigência</th></tr></thead>
        <tbody>{regras.data?.map((r) => <tr key={r.id}><td>{r.alvo}{r.alvoNome && ` — ${r.alvoNome}`}</td><td>{r.situacao}</td><td className="num">{r.aliquota.replace('.', ',')}%</td><td>{formatDate(r.vigenciaInicio)} → {r.vigenciaFim ? formatDate(r.vigenciaFim) : <Badge tom="ok">vigente</Badge>}</td></tr>)}</tbody></table></TabelaRolavel>
    </section>
  );
}

export function ImportacaoTab() {
  const [tipo, setTipo] = useState<'categorias' | 'parceiros' | 'campanhas' | 'clientes'>('parceiros');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [res, setRes] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!arquivo || enviando) return;
    setEnviando(true); setErro(null); setRes(null);
    try { setRes(await importacoesApi.importar(tipo, arquivo)); } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <section className="narrow card">
      <p>Importação de cadastros por planilha. As linhas certas são gravadas; as erradas e as que já existem voltam com o motivo.</p>
      <Field label="Tipo"><select value={tipo} onChange={(e) => { setTipo(e.target.value as typeof tipo); setRes(null); }}><option value="parceiros">Parceiros</option><option value="campanhas">Campanhas</option><option value="categorias">Categorias</option><option value="clientes">Clientes</option></select></Field>
      <BaixarModelo tipo={tipo} />
      <Field label="Planilha (XLSX/CSV)"><input type="file" accept=".xlsx,.csv" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></Field>
      <button className="btn btn-primary" disabled={!arquivo || enviando} onClick={enviar}>{enviando ? 'Importando…' : 'Importar'}</button>
      <ErrorAlert erro={erro} />
      {res && <ResultadoImportacaoView r={res} />}
    </section>
  );
}

/** Carga inicial do estoque por planilha (S3-07: área do Administrador). Como todas as importações (S5-05), grava as linhas certas. */
export function CargaInicialTab() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [res, setRes] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!arquivo || enviando) return;
    setEnviando(true); setErro(null); setRes(null);
    try { setRes(await estoqueApi.cargaInicial(arquivo)); } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <section className="narrow card">
      <p>Envie a planilha (XLSX ou CSV) com o saldo inicial do estoque. Os itens já entram aprovados. As linhas certas são gravadas; as erradas voltam com o motivo, para corrigir e enviar só elas de novo.</p>
      <BaixarModelo tipo="carga-inicial" />
      <Field label="Planilha"><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></Field>
      <button className="btn btn-primary" disabled={!arquivo || enviando} onClick={enviar}>{enviando ? 'Importando…' : 'Enviar'}</button>
      <ErrorAlert erro={erro} />
      {res && <ResultadoImportacaoView r={res} aceitasTexto="no estoque (já aprovadas)" />}
    </section>
  );
}
