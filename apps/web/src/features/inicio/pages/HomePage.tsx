/** Início: atalhos por perfil e alertas (contas vencidas/a vencer, pendências de sync, lotes aguardando triagem). */
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useAsync } from '../../../shared/hooks/useAsync';
import { contasPagarApi } from '../../financeiro/financeiro.api';
import { lotesApi } from '../../entradas/entradas.api';
import { pendenciasApi } from '../../pdv/pdv.api';
import { useTamanhoFila } from '../../../shared/offline/hooks';
import { todayLocal } from '../../../shared/lib/format';
import { PageHeader } from '../../../shared/components/ui';

export function HomePage() {
  const { me, can } = useAuth();
  const filaLocal = useTamanhoFila();
  const alertas = useAsync(async () => {
    const [contas, pend, lotes] = await Promise.all([
      can('contas_pagar.gerenciar') ? contasPagarApi.listar({ status: 'ABERTA' }).then((p) => p.items) : Promise.resolve([]),
      can('sincronizacao.resolver') ? pendenciasApi.listar({ status: 'ABERTA' }).then((p) => p.total) : Promise.resolve(0),
      can('entrada.registrar') ? lotesApi.listar({ status: 'ABERTO' }).then((p) => p.total) : Promise.resolve(0),
    ]);
    const hoje = todayLocal(), limite = todayLocal(3);
    return {
      vencidas: contas.filter((c) => c.vencimento < hoje).length,
      aVencer: contas.filter((c) => c.vencimento >= hoje && c.vencimento <= limite).length,
      pendencias: pend, lotesAbertos: lotes,
    };
  }, [can]);

  const a = alertas.data;
  const atalhos = [
    can('caixa.operar') && { to: '/pdv', titulo: 'Vender', desc: 'Abrir o PDV', cor: 'coral' },
    can('entrada.registrar') && { to: '/entradas/novo', titulo: 'Nova entrada', desc: 'Registrar lote de doação', cor: 'laranja' },
    can('estoque.consultar') && { to: '/estoque', titulo: 'Estoque', desc: 'Consultar posição', cor: 'laranja' },
    can('contas_receber.receber') && { to: '/financeiro/receber', titulo: 'Fiado', desc: 'Receber de clientes', cor: 'sol' },
    can('relatorios.consultar') && { to: '/relatorios/prestacao-contas', titulo: 'Prestação de contas', desc: 'Por parceiro ou campanha', cor: 'ceu' },
  ].filter(Boolean) as { to: string; titulo: string; desc: string; cor: string }[];

  return (
    <div className="page">
      <PageHeader titulo={`Olá, ${me?.nome.split(' ')[0] ?? ''}!`} />
      <p className="saudacao">Que bom ter você aqui. Veja o que precisa de atenção hoje.</p>
      <section className="alerts-grid" aria-label="Alertas">
        {a && a.vencidas > 0 && <Link to="/financeiro/pagar" className="alert alert-error">{a.vencidas} conta(s) a pagar vencida(s)</Link>}
        {a && a.aVencer > 0 && <Link to="/financeiro/pagar" className="alert alert-warn">{a.aVencer} conta(s) vencem nos próximos 3 dias</Link>}
        {a && a.pendencias > 0 && <Link to="/sincronizacao" className="alert alert-warn">{a.pendencias} pendência(s) de sincronização</Link>}
        {a && a.lotesAbertos > 0 && <Link to="/entradas" className="alert alert-info">{a.lotesAbertos} lote(s) aguardando triagem</Link>}
        {filaLocal > 0 && <div className="alert alert-warn">Este dispositivo tem {filaLocal} registro(s) offline aguardando sincronização.</div>}
      </section>
      <section className="shortcut-grid" aria-label="Atalhos">
        {atalhos.map((x) => <Link key={x.to} to={x.to} className="card shortcut" data-cor={x.cor}><strong>{x.titulo}</strong><span>{x.desc}</span></Link>)}
      </section>
    </div>
  );
}
