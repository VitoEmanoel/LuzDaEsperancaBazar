/** Gestão de usuários: criar (senha provisória exibida uma única vez), trocar perfil e terminal fixo (S6-21), desativar, redefinir senha. */
import { useState } from 'react';
import { perfisApi, usuariosApi } from '../../auth/auth.api';
import { terminaisApi } from '../../caixa/caixa.api';
import { errorMessage } from '../../../shared/api/http';
import type { Terminal, Usuario } from '../../../shared/api/types';
import { useAsync } from '../../../shared/hooks/useAsync';
import { Badge, Empty, ErrorAlert, Field, Pagination, TabelaRolavel } from '../../../shared/components/ui';
import { Modal } from '../../../shared/components/Modal';
import { uuid } from '../../../shared/lib/uuid';
import { useToast } from '../../../shared/components/Toast';

export function UsuariosTab() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  const [senha, setSenha] = useState<{ login: string; senha: string } | null>(null);
  const perfis = useAsync(() => perfisApi.listar(), []);
  const terminais = useAsync(() => terminaisApi.listar({ ativo: true }), []);
  const { data, erro, carregando, reload } = useAsync(() => usuariosApi.listar({ page }), [page]);

  async function alterar(u: Usuario, patch: Partial<Pick<Usuario, 'perfilId' | 'ativo' | 'terminalId'>>) {
    try { await usuariosApi.atualizar(u.id, patch); toast('Usuário atualizado.'); await reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function redefinir(u: Usuario) {
    try { const r = await usuariosApi.redefinirSenha(u.id); setSenha({ login: u.login, senha: r.senhaProvisoria }); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <section>
      <div className="row"><button className="btn btn-primary" onClick={() => setNovo(true)}>+ Novo usuário</button></div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <TabelaRolavel><table className="table">
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Terminal fixo</th><th>Situação</th><th /></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.nome}</td><td>{u.login}</td>
              <td><select value={u.perfilId} onChange={(e) => alterar(u, { perfilId: e.target.value })} aria-label={`Perfil de ${u.nome}`}>{perfis.data?.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></td>
              <td><SeletorTerminal valor={u.terminalId ?? ''} terminais={terminais.data ?? []} atual={u.terminalId ? { id: u.terminalId, nome: u.terminalNome ?? 'Terminal desativado' } : null}
                onChange={(t) => alterar(u, { terminalId: t || null })} rotulo={`Terminal fixo de ${u.nome}`} /></td>
              <td>{u.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
              <td className="actions"><button className="btn btn-sm" onClick={() => redefinir(u)}>Redefinir senha</button><button className="btn btn-sm" onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Reativar'}</button></td>
            </tr>
          ))}</tbody>
        </table></TabelaRolavel>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <NovoUsuario aberto={novo} perfis={perfis.data ?? []} terminais={terminais.data ?? []} onFechar={() => setNovo(false)} onOk={async (login, s) => { setSenha({ login, senha: s }); await reload(); }} />
      {/* Senha provisória: mostrada uma vez, nunca guardada no front nem logada. */}
      <Modal titulo="Senha provisória" aberto={!!senha} onFechar={() => setSenha(null)} largura="sm" rodape={<button className="btn btn-primary" onClick={() => setSenha(null)}>Já anotei</button>}>
        <p>Entregue pessoalmente ao usuário <strong>{senha?.login}</strong>. Ela será trocada no primeiro acesso e não será exibida novamente.</p>
        <p className="senha-provisoria"><code>{senha?.senha}</code></p>
      </Modal>
    </section>
  );
}

/** Terminal fixo, opcional: quem tem vai direto nele ao abrir o caixa e não abre outro (S6-21). Vários usuários podem ter o mesmo. */
function SeletorTerminal({ valor, terminais, atual, onChange, rotulo }: { valor: string; terminais: Terminal[]; atual?: { id: string; nome: string } | null; onChange: (id: string) => void; rotulo?: string }) {
  const lista = atual && !terminais.some((t) => t.id === atual.id) ? [...terminais, { id: atual.id, nome: atual.nome, ativo: false }] : terminais;
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value)} aria-label={rotulo}>
      <option value="">Nenhum</option>
      {lista.map((t) => <option key={t.id} value={t.id} disabled={!t.ativo}>{t.nome}</option>)}
    </select>
  );
}

function NovoUsuario({ aberto, perfis, terminais, onFechar, onOk }: { aberto: boolean; perfis: { id: string; nome: string }[]; terminais: Terminal[]; onFechar: () => void; onOk: (login: string, senha: string) => Promise<void> }) {
  const [nome, setNome] = useState(''); const [login, setLogin] = useState(''); const [perfilId, setPerfilId] = useState(''); const [terminalId, setTerminalId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const valido = nome.trim().length >= 3 && /^[a-z0-9._-]{3,30}$/.test(login) && perfilId;
  async function salvar() {
    if (!valido) return; setErro(null);
    try { const u = await usuariosApi.criar({ id: uuid(), nome: nome.trim(), login, perfilId, ...(terminalId ? { terminalId } : {}) }); setNome(''); setLogin(''); setTerminalId(''); onFechar(); await onOk(u.login, u.senhaProvisoria); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Novo usuário" aberto={aberto} onFechar={onFechar} largura="sm" rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Criar</button></>}>
      <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus /></Field>
      <Field label="Login" hint="Minúsculas, números, ponto, hífen ou sublinhado."><input value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} maxLength={30} autoComplete="off" /></Field>
      <Field label="Perfil"><select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
      <Field label="Terminal fixo (opcional)" hint="Quem tem um terminal vai direto nele ao abrir o caixa e não abre outro.">
        <SeletorTerminal valor={terminalId} terminais={terminais} onChange={setTerminalId} />
      </Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
