/** Painéis abertos fora da tela inicial (o Admin vê todos; cada perfil o seu). */
import { PageHeader } from '../../../shared/components/ui';
import { PainelEstoque } from '../components/PainelEstoque';
import { PainelFinanceiro } from '../components/PainelFinanceiro';

export const PainelEstoquePage = () => <div className="page"><PageHeader titulo="Painel do estoque" /><PainelEstoque /></div>;
export const PainelFinanceiroPage = () => <div className="page"><PageHeader titulo="Painel financeiro" /><PainelFinanceiro /></div>;
