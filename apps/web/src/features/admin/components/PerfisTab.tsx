/**
 * Perfis configuráveis sobre a lista fixa de permissões. As permissões aparecem em português, agrupadas por área (S3-18);
 * um perfil pode nascer como cópia de outro (S3-19); o criado por engano é desativado, nunca excluído (S3-20).
 */
import { useMemo, useState } from 'react';
import { perfisApi } from '../../auth/auth.api';
import { errorMessage } from '../../../shared/api/http';
import { PERFIL_ADMIN_ID, type Perfil, type Permissao, type PermissaoInfo } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, ErrorAlert, Field } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { fromCents, toCents, tryCents } from '../../../shared/lib/money';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

/** O Administrador nunca perde estas duas (o servidor também recusa): ninguém fica trancado para fora. */
const ESSENCIAIS_ADMIN: Permissao[] = ['usuarios.gerenciar', 'perfis.gerenciar'];
const ORDEM_GRUPOS = ['Vendas e caixa', 'Entradas e estoque', 'Financeiro', 'Relatórios', 'Administração'];

export function PerfisTab() {
  const toast = useToast();
  const perfis = useAsync(() => perfisApi.listar(), []);
  const perms = useAsync(() => perfisApi.permissoes(), []);
  const [sel, setSel] = useState<Perfil | null>(null);
  const [nome, setNome] = useState(''); const [lista, setLista] = useState<Permissao[]>([]); const [limite, setLimite] = useState('0');
  const [copiaDe, setCopiaDe] = useState<string | null>(null);
  const [desativar, setDesativar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const m = new Map<string, PermissaoInfo[]>();
    for (const p of perms.data ?? []) m.set(p.grupo, [...(m.get(p.grupo) ?? []), p]);
    const pos = (g: string) => (ORDEM_GRUPOS.includes(g) ? ORDEM_GRUPOS.indexOf(g) : ORDEM_GRUPOS.length);
    return [...m.entries()].sort(([a], [b]) => pos(a) - pos(b));
  }, [perms.data]);
  const travada = (c: Permissao) => sel?.id === PERFIL_ADMIN_ID && ESSENCIAIS_ADMIN.includes(c);

  function editar(p: Perfil | null) {
    setSel(p); setErro(null); setCopiaDe(null);
    setNome(p?.nome ?? ''); setLista(p?.permissoes ?? []); setLimite(p ? String(toCents(p.limiteDesconto) / 100) : '0');
  }
  /** Novo perfil com as permissões e o limite de outro (o nome fica para quem cria escolher). */
  function copiar(p: Perfil) {
    setSel(null); setErro(null); setCopiaDe(p.nome);
    setNome(`${p.nome} (cópia)`); setLista([...p.permissoes]); setLimite(String(toCents(p.limiteDesconto) / 100));
  }
  function marcarGrupo(itens: PermissaoInfo[], marcar: boolean) {
    const codigos = itens.map((i) => i.codigo);
    setLista(marcar ? [...new Set([...lista, ...codigos])] : lista.filter((x) => !codigos.includes(x) || travada(x)));
  }
  const limiteCents = tryCents(limite);
  const limiteValido = limiteCents !== null && limiteCents >= 0 && limiteCents <= 10000;
  async function salvar() {
    if (nome.trim().length < 3 || limiteCents === null || limiteCents < 0 || limiteCents > 10000) return;
    setErro(null);
    try {
      const dados = { nome: nome.trim(), permissoes: lista, limiteDesconto: fromCents(limiteCents) };
      if (sel) await perfisApi.atualizar(sel.id, dados); else await perfisApi.criar({ id: uuid(), ...dados });
      toast('Perfil salvo. As novas permissões valem no próximo login/refresh do usuário.'); await perfis.reload(); editar(null);
    } catch (e) { setErro(errorMessage(e)); }
  }

  async function confirmarDesativar() {
    setDesativar(false);
    try { await perfisApi.desativar(sel!.id); toast('Perfil desativado.'); editar(null); await perfis.reload(); }
    catch (e) { setErro(errorMessage(e)); }
  }

  return (
    <div className="grid-2">
      <section>
        <div className="row"><button className="btn btn-primary" onClick={() => editar(null)}>+ Novo perfil</button></div>
        <ul className="lista-escolha">{perfis.data?.map((p) => (
          <li key={p.id} className="perfil-item">
            <button className={`btn btn-block ${sel?.id === p.id ? 'active' : ''}`} onClick={() => editar(p)}>{p.nome} {p.padrao && <Badge tom="info">Padrão</Badge>} <small>{p.permissoes.length} permissões</small></button>
            <button className="btn btn-sm btn-ghost" onClick={() => copiar(p)} aria-label={`Copiar o perfil ${p.nome}`}>Copiar</button>
          </li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>{sel ? `Editar: ${sel.nome}` : copiaDe ? `Novo perfil (cópia de ${copiaDe})` : 'Novo perfil'}</h2>
        <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} disabled={!!sel?.padrao} /></Field>
        <Field label="Limite de desconto no PDV (%)" erro={limiteValido ? undefined : 'Informe de 0 a 100'} hint="Desconto manual que este perfil pode dar na venda. O desconto do produto é à parte."><input inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} /></Field>
        {grupos.map(([grupo, itens]) => {
          const todas = itens.every((i) => lista.includes(i.codigo));
          return (
            <fieldset key={grupo} className="perms">
              <legend>{grupo}</legend>
              <label className="check marcar-todas"><input type="checkbox" checked={todas} onChange={(e) => marcarGrupo(itens, e.target.checked)} /> <strong>Marcar todas</strong></label>
              {itens.map((p) => (
                <label key={p.codigo} className="check" title={p.codigo}>
                  <input type="checkbox" checked={lista.includes(p.codigo)} disabled={travada(p.codigo)}
                    onChange={(e) => setLista(e.target.checked ? [...lista, p.codigo] : lista.filter((x) => x !== p.codigo))} />
                  {p.descricao}{travada(p.codigo) && <small className="muted"> (o Administrador sempre tem)</small>}
                </label>
              ))}
            </fieldset>
          );
        })}
        <ErrorAlert erro={erro ?? perms.erro} />
        <div className="row">
          <button className="btn btn-primary" onClick={salvar} disabled={nome.trim().length < 3 || !limiteValido}>Salvar perfil</button>
          {sel && !sel.padrao && <button className="btn" onClick={() => setDesativar(true)}>Desativar perfil</button>}
        </div>
      </section>
      <Modal titulo="Desativar perfil" aberto={desativar} onFechar={() => setDesativar(false)}
        rodape={<><button className="btn" onClick={() => setDesativar(false)}>Cancelar</button><button className="btn btn-primary" onClick={confirmarDesativar}>Desativar</button></>}>
        <p>O perfil <strong>{sel?.nome}</strong> sai da lista e o nome fica livre para outro perfil. Nada é apagado.</p>
        <p className="hint">Só funciona se nenhum usuário ativo estiver com este perfil: troque o perfil deles antes.</p>
      </Modal>
    </div>
  );
}
