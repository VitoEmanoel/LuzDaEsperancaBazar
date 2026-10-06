/** Aviso não bloqueante de telefone já cadastrado (RF-CAD-04 cenário 3). Telefone mascarado (minimização de PII). */
import { maskPhone } from '../../../shared/lib/format';
import type { ClienteResumo } from '../telefoneDuplicado';

export function AvisoTelefoneDuplicado({ encontrados, onUsarExistente, onCadastrarMesmoAssim, rotuloUsar = 'Usar existente' }: {
  encontrados: ClienteResumo[];
  onUsarExistente: (c: ClienteResumo) => void;
  onCadastrarMesmoAssim: () => void;
  rotuloUsar?: string;
}) {
  return (
    <div className="alert alert-warn" role="alertdialog" aria-labelledby="dup-titulo">
      <strong id="dup-titulo">Este telefone já está cadastrado. É a mesma pessoa?</strong>
      <ul className="lista-escolha">
        {encontrados.map((c) => (
          <li key={c.id} className="row">
            <span className="grow">{c.nome} <small className="muted">{maskPhone(c.telefone)}</small></span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onUsarExistente(c)}>{rotuloUsar}</button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" onClick={onCadastrarMesmoAssim}>Cadastrar mesmo assim</button>
    </div>
  );
}
