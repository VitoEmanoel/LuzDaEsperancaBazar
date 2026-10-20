/** Modal acessível: role=dialog, foco preso no conteúdo, Esc fecha (quando permitido). */
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: 'sm' | 'md' | 'lg';
  /** false impede fechar com Esc/clique fora (ex.: durante gravação). */
  fechavel?: boolean;
}

export function Modal({ titulo, aberto, onFechar, children, rodape, largura = 'md', fechavel = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // `onFechar` costuma ser uma função nova a cada render do pai. O efeito NÃO pode reiniciar por causa dela: reiniciar levava
  // o foco de volta para o primeiro botão (o ✕) a cada tecla digitada num campo da janela.
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Respeita o autoFocus do React (ele já focou o campo certo na montagem): só leva o foco para dentro se ainda não estiver na janela,
    // e então para o primeiro campo ou botão do CORPO, nunca para o ✕ do cabeçalho.
    if (el && !el.contains(document.activeElement)) {
      const ativo = ':not(:disabled)'; // controle desligado não recebe foco (ex.: "Baixar PDF" enquanto carrega)
      (el.querySelector<HTMLElement>(`.modal-body input${ativo}, .modal-body select${ativo}, .modal-body textarea${ativo}, .modal-body button${ativo}`)
        ?? el.querySelector<HTMLElement>(`.modal-footer button${ativo}`) ?? el.querySelector<HTMLElement>(`button${ativo}`) ?? el)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fechavel) { e.stopPropagation(); fecharRef.current(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); anterior?.focus(); };
  }, [aberto, fechavel]);

  if (!aberto) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && fechavel) onFechar(); }}>
      <div ref={ref} className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-labelledby="modal-titulo" tabIndex={-1}>
        <header className="modal-header">
          <h2 id="modal-titulo">{titulo}</h2>
          {fechavel && <button type="button" className="btn btn-ghost" onClick={onFechar} aria-label="Fechar">✕</button>}
        </header>
        <div className="modal-body">{children}</div>
        {rodape && <footer className="modal-footer">{rodape}</footer>}
      </div>
    </div>
  );
}
