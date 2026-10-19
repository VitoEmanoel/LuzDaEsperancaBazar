/** Tudo o que aconteceu no caixa, em ordem, com o dinheiro que deveria estar na gaveta depois de cada coisa. */
import type { EventoCaixa } from '../../../shared/api/types';
import { MoneyText } from '../../../shared/components/ui';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR');

export function LinhaDoTempoCaixa({ eventos }: { eventos: EventoCaixa[] }) {
  return (
    <div className="tabela-rolavel">
      <table className="table compact">
        <thead><tr><th>Hora</th><th>O que aconteceu</th><th className="num">Valor</th><th className="num">Gaveta depois</th></tr></thead>
        <tbody>
          {eventos.map((e, i) => (
            <tr key={i} className={e.aposFechamento ? 'riscado' : ''}>
              <td>{hora(e.quando)}</td>
              <td>{e.descricao}{e.aposFechamento && ' (depois do fechamento)'}</td>
              <td className="num"><MoneyText value={e.valor} /></td>
              <td className="num">{e.gavetaApos !== undefined ? <MoneyText value={e.gavetaApos} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
