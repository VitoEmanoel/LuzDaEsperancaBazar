/** Modal acessível: role=dialog, foco preso no conteúdo, Esc fecha (quando permitido). */
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Janelas abertas, a de cima por último: só ela atende Esc e Tab (janela sobre janela fecha uma de cada vez, S6-05). */
const pilha: symbol[] = [];

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
  const tituloId = useId(); // id próprio: com janela sobre janela, cada uma aponta para o seu título
  const clicouFora = useRef(false);
  // `onFechar` costuma ser uma função nova a cada render do pai. O efeito NÃO pode reiniciar por causa dela: reiniciar levava
  // o foco de volta para o primeiro botão (o ✕) a cada tecla digitada num campo da janela.
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  // `fechavel` muda com a janela aberta (o pagamento trava ao gravar): lido por ref, não reinicia o efeito (que levaria o foco embora e
  // passaria esta janela para o topo da pilha)
  const fechavelRef = useRef(fechavel);
  fechavelRef.current = fechavel;
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
    const eu = Symbol('modal');
    pilha.push(eu);
    const onKey = (e: KeyboardEvent) => {
      if (pilha[pilha.length - 1] !== eu) return; // há outra janela por cima: ela decide
      if (e.key === 'Escape' && fechavelRef.current) { e.stopPropagation(); fecharRef.current(); }
      if (e.key === 'Tab' && el) {
        // só o que se vê e se pode usar: campo escondido (display:none, hidden) não entra no ciclo, senão o foco "some"
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter((x) => !x.hasAttribute('disabled') && x.getClientRects().length > 0);
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); pilha.splice(pilha.indexOf(eu), 1); anterior?.focus(); };
  }, [aberto]);

  if (!aberto) return null;
  return (
    // fecha só com o clique INTEIRO no fundo (apertar E soltar nele): arrastar de um campo para fora, ou do fundo para dentro, não fecha
    // (no arrasto, o click vai para o ancestral comum, o fundo; por isso o soltar é conferido no mouseup)
    <div className="modal-backdrop" onMouseDown={(e) => { clicouFora.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (e.target !== e.currentTarget) clicouFora.current = false; }}
      onClick={(e) => { if (clicouFora.current && e.target === e.currentTarget && fechavel) onFechar(); clicouFora.current = false; }}>
      <div ref={ref} className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}>
        <header className="modal-header">
          <h2 id={tituloId}>{titulo}</h2>
          {fechavel && <button type="button" className="btn btn-ghost" onClick={onFechar} aria-label="Fechar">✕</button>}
        </header>
        <div className="modal-body">{children}</div>
        {rodape && <footer className="modal-footer">{rodape}</footer>}
      </div>
    </div>
  );
}
