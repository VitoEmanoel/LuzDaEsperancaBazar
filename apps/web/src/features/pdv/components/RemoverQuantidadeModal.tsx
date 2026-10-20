/** Tirar do carrinho por quantidade: "bipei 5 e eram 4" -> tira só 1, sem refazer a venda. */
import { useEffect, useState } from 'react';
import { Modal } from '../../../shared/components/Modal';
import { Field } from '../../../shared/components/ui';
import type { LinhaCarrinho } from '../carrinho';

export function RemoverQuantidadeModal({ linha, onConfirmar, onFechar }: { linha: LinhaCarrinho | null; onConfirmar: (qtd: number) => void; onFechar: () => void }) {
  const [qtd, setQtd] = useState('1');
  useEffect(() => { if (linha) setQtd('1'); }, [linha]);
  if (!linha) return null;
  const n = Number.parseInt(qtd, 10);
  const valido = Number.isInteger(n) && n >= 1 && n <= linha.quantidade;
  return (
    <Modal titulo="Tirar do carrinho" aberto onFechar={onFechar} largura="sm"
      rodape={<>
        <button className="btn" onClick={onFechar}>Cancelar (Esc)</button>
        <button className="btn" onClick={() => onConfirmar(linha.quantidade)}>Tirar tudo ({linha.quantidade})</button>
        <button className="btn btn-primary" onClick={() => valido && onConfirmar(n)} disabled={!valido}>Tirar {valido ? n : ''}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (valido) onConfirmar(n); }}>
        <p><strong>{linha.descricao}</strong>: há {linha.quantidade} no carrinho. Quantas unidades tirar?</p>
        <Field label="Quantidade a tirar" erro={qtd !== '' && !valido ? `Digite de 1 a ${linha.quantidade}` : null}>
          <input inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 4))} onFocus={(e) => e.target.select()} autoFocus />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
