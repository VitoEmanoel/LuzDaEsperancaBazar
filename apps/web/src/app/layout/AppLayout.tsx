/**
 * Layout do Backoffice: navegação lateral filtrada pelas permissões do perfil.
 * Esconder item de menu é só conforto — a API recusa com 403 de qualquer forma.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../features/auth/AuthContext';
import type { Permissao } from '../../shared/api/types';
import { useToast } from '../../shared/components/Toast';
import { BrandMark } from '../../shared/components/BrandMark';

/** `escondeSe`: o item some quando o usuário tem essa permissão (evita dois links para a mesma área). */
interface ItemMenu { to: string; rotulo: string; perms: Permissao[]; escondeSe?: Permissao }
/** `cor`: acento do brandbook que identifica a área (slide 09 — uma cor por frente). */
const MENU: { grupo: string; cor: 'coral' | 'laranja' | 'sol' | 'ceu' | 'roxo'; itens: ItemMenu[] }[] = [
  { grupo: 'Operação', cor: 'coral', itens: [
    { to: '/pdv', rotulo: 'PDV — Vender', perms: ['caixa.operar'] },
    { to: '/vendas', rotulo: 'Vendas', perms: ['venda.cancelar'] },
  ] },
  { grupo: 'Entradas e estoque', cor: 'laranja', itens: [
    { to: '/entradas', rotulo: 'Lotes de entrada', perms: ['entrada.registrar', 'produtos.aprovar', 'estoque.consultar'] },
    { to: '/aprovacoes', rotulo: 'Aprovação de produtos', perms: ['produtos.aprovar'] },
    // baixa, ajuste e preço viraram ações na lista do Estoque (S3-02)
    { to: '/estoque', rotulo: 'Estoque', perms: ['estoque.consultar'] },
    { to: '/estoque/transferir', rotulo: 'Transferência', perms: ['estoque.transferir'] },
    { to: '/estoque/etiquetas', rotulo: 'Imprimir etiquetas', perms: ['etiquetas.imprimir'] },
  ] },
  { grupo: 'Financeiro', cor: 'sol', itens: [
    { to: '/financeiro/pagar', rotulo: 'Contas a pagar', perms: ['contas_pagar.gerenciar'] },
    { to: '/financeiro/compra', rotulo: 'Nova compra', perms: ['contas_pagar.gerenciar'] },
    { to: '/financeiro/receber', rotulo: 'Contas a receber / fiado', perms: ['contas_receber.receber'] },
    { to: '/financeiro/resumo', rotulo: 'Resumo financeiro', perms: ['relatorios.consultar'] },
    { to: '/caixas', rotulo: 'Caixas do dia', perms: ['relatorios.consultar'] },
    { to: '/financeiro/fluxo', rotulo: 'Fluxo de caixa', perms: ['relatorios.consultar'] },
  ] },
  { grupo: 'Gestão', cor: 'ceu', itens: [
    { to: '/relatorios/prestacao-contas', rotulo: 'Relatórios', perms: ['relatorios.consultar'] },
    { to: '/relatorios/estoque', rotulo: 'Relatórios de estoque', perms: ['relatorios.estoque'], escondeSe: 'relatorios.consultar' },
    { to: '/cadastros/categorias', rotulo: 'Cadastros', perms: ['cadastros.gerenciar', 'cadastros.consultar'] },
    { to: '/admin', rotulo: 'Administração', perms: ['usuarios.gerenciar', 'perfis.gerenciar', 'parametros.gerenciar', 'auditoria.consultar', 'terminais.gerenciar', 'privacidade.gerenciar', 'fiscal.gerenciar', 'cadastros.gerenciar', 'estoque.ajustar'] },
  ] },
];

function iniciais(nome?: string) {
  if (!nome) return '';
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]?.[0] ?? '' : '')).toUpperCase();
}

export function AppLayout() {
  const { me, can, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);

  async function sair() {
    try { await logout(); nav('/login', { replace: true }); }
    catch (e) { toast((e as Error).message, 'erro'); }
  }

  return (
    <div className="shell">
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <aside className={`sidebar ${menuAberto ? 'open' : ''}`}>
        <BrandMark subtitulo="Bazar beneficente" />
        <nav aria-label="Menu principal" onClick={() => setMenuAberto(false)}>
          <NavLink to="/" end className="nav-item">Início</NavLink>
          {MENU.map((g) => {
            const itens = g.itens.filter((i) => can(...i.perms) && !(i.escondeSe && can(i.escondeSe)));
            if (!itens.length) return null;
            return (
              <div key={g.grupo} className="nav-group" data-cor={g.cor}>
                <div className="nav-group-title">{g.grupo}</div>
                {itens.map((i) => <NavLink key={i.to} to={i.to} className="nav-item">{i.rotulo}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-rodape">Centro Espírita e Obras Sociais · Parnaíba, PI</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-toggle" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">☰</button>
          <div className="spacer" />
          <span className="user">{me?.nome}<small>{me?.perfil.nome}</small></span>
          <span className="avatar" aria-hidden="true">{iniciais(me?.nome)}</span>
          <NavLink to="/trocar-senha" className="btn btn-ghost">Senha</NavLink>
          <button className="btn" onClick={sair}>Sair</button>
        </header>
        <main id="conteudo" className="content"><Outlet /></main>
      </div>
    </div>
  );
}
