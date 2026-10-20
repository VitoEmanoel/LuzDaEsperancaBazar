/**
 * Esc com o campo vazio (S4-19, P-13 e P-18): pergunta antes de tirar uma unidade da última linha.
 * O foco nasce em Cancelar: o Enter que o leitor manda no fim de cada código nunca tira o item sem querer.
 * Tira com S ou com o clique em Tirar; S colado em outra tecla (leitor) não vale.
 */
import { useEffect, useRef } from 'react';
import { Modal } from '../../../shared/components/Modal';
import type { LinhaCarrinho } from '../carrinho';

export function ConfirmarRemoverUltimoModal({ linha, onConfirmar, onFechar }: { linha: LinhaCarrinho | null; onConfirmar: () => void; onFechar: () => void }) {
  // onConfirmar muda a cada render do PDV: guardado num ref, o atalho não recomeça (e a conta do "colado" não se perde)
  const confirmar = useRef(onConfirmar);
  confirmar.current = onConfirmar;
  useEffect(() => {
    if (!linha) return;
    let ultima = 0;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      // Shift, Ctrl e afins sozinhos não contam: o S maiúsculo (Shift + S) continua valendo.
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      // O leitor de código digita rápido: tecla com modificador, repetida ou colada na anterior (menos de 80 ms) não é atalho.
      const agora = performance.now(); const rapido = agora - ultima < 80; ultima = agora;
      clearTimeout(espera); // outra tecla logo depois do S: era o leitor, o S não vale
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || rapido) return;
      // o S só tira depois de 80 ms sem outra tecla (um código que comece com S não tira o item)
      if (e.key.toLowerCase() === 's') { e.preventDefault(); espera = setTimeout(() => confirmar.current(), 80); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(espera); window.removeEventListener('keydown', onKey); };
  }, [linha]);
  if (!linha) return null;
  const some = linha.quantidade <= 1;
  return (
    <Modal titulo="Tirar o último item?" aberto onFechar={onFechar} largura="sm"
      rodape={<>
        <button className="btn" onClick={onFechar} autoFocus>Cancelar (Esc)</button>
        <button className="btn btn-primary" onClick={onConfirmar}><span><u>S</u>im, tirar 1</span></button>
      </>}>
      <p>Tirar <strong>1 unidade</strong> de <strong>{linha.descricao}</strong>?</p>
      <p className="muted">{some ? 'É a única unidade: a linha sai do carrinho.' : `Ficam ${linha.quantidade - 1} no carrinho.`}</p>
    </Modal>
  );
}
