/** Rotas (Especificação Técnica, seção 4). Cada rota checa a permissão só para UX; o servidor decide. */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { RequireAuth, RequirePermission } from '../features/auth/guards';
import { ToastProvider } from '../shared/components/Toast';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { TrocarSenhaPage } from '../features/auth/pages/TrocarSenhaPage';
import { HomePage } from '../features/inicio/pages/HomePage';
import { AbrirCaixaPage } from '../features/caixa/pages/AbrirCaixaPage';
import { PdvPage } from '../features/pdv/pages/PdvPage';
import { FecharCaixaPage } from '../features/caixa/pages/FecharCaixaPage';
import { VendasPage } from '../features/pdv/pages/VendasPage';
import { LotesPage } from '../features/entradas/pages/LotesPage';
import { NovoLotePage } from '../features/entradas/pages/NovoLotePage';
import { TriagemPage } from '../features/entradas/pages/TriagemPage';
import { EstoquePage } from '../features/estoque/pages/EstoquePage';
import { HistoricoItemPage } from '../features/estoque/pages/HistoricoItemPage';
import { TransferenciaPage } from '../features/estoque/pages/TransferenciaPage';
import { AjustesPage } from '../features/estoque/pages/AjustesPage';
import { ContasPagarPage } from '../features/financeiro/pages/ContasPagarPage';
import { ContasReceberPage } from '../features/financeiro/pages/ContasReceberPage';
import { ResumoFinanceiroPage } from '../features/financeiro/pages/ResumoFinanceiroPage';
import { RelatoriosPage } from '../features/relatorios/pages/RelatoriosPage';
import { CadastrosPage } from '../features/cadastros/pages/CadastrosPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import type { Permissao } from '../shared/api/types';
import type { ReactNode } from 'react';

const P = (perms: Permissao[], el: ReactNode) => <RequirePermission perms={perms}>{el}</RequirePermission>;

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/trocar-senha" element={<RequireAuth><TrocarSenhaPage /></RequireAuth>} />
            {/* PDV: tela cheia, fora do layout do Backoffice */}
            <Route path="/pdv" element={<RequireAuth>{P(['caixa.operar'], <PdvPage />)}</RequireAuth>} />
            <Route path="/pdv/abrir" element={<RequireAuth>{P(['caixa.operar'], <AbrirCaixaPage />)}</RequireAuth>} />
            <Route path="/pdv/fechar" element={<RequireAuth>{P(['caixa.operar'], <FecharCaixaPage />)}</RequireAuth>} />
            {/* Backoffice */}
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<HomePage />} />
              <Route path="vendas" element={P(['caixa.operar', 'venda.cancelar'], <VendasPage />)} />
              <Route path="entradas" element={P(['entrada.registrar'], <LotesPage />)} />
              <Route path="entradas/novo" element={P(['entrada.registrar'], <NovoLotePage />)} />
              <Route path="entradas/:id/triagem" element={P(['entrada.registrar'], <TriagemPage />)} />
              <Route path="estoque" element={P(['estoque.consultar'], <EstoquePage />)} />
              <Route path="estoque/itens/:id" element={P(['estoque.consultar'], <HistoricoItemPage />)} />
              <Route path="estoque/transferir" element={P(['estoque.transferir'], <TransferenciaPage />)} />
              <Route path="estoque/ajustes" element={P(['estoque.ajustar'], <AjustesPage />)} />
              <Route path="financeiro/pagar" element={P(['contas_pagar.gerenciar'], <ContasPagarPage />)} />
              <Route path="financeiro/receber" element={P(['contas_receber.receber'], <ContasReceberPage />)} />
              <Route path="financeiro/resumo" element={P(['relatorios.consultar'], <ResumoFinanceiroPage />)} />
              <Route path="relatorios/:tipo" element={P(['relatorios.consultar'], <RelatoriosPage />)} />
              <Route path="cadastros/:tipo" element={P(['cadastros.gerenciar', 'cadastros.consultar', 'clientes.gerenciar'], <CadastrosPage />)} />
              <Route path="admin/*" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
