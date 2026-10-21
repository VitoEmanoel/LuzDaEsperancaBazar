/**
 * Leitura do código de barras pela câmera (S5-12), no PDV e no Estoque.
 * A biblioteca (@zxing/browser) só é carregada quando a janela abre. Lê Code 128 (etiquetas novas) e Code 39 (as antigas, S4).
 * O navegador só libera a câmera em página segura (HTTPS ou localhost): fora disso o botão nem aparece (`cameraDisponivel`).
 * A câmera desliga ao fechar, também quando a janela fecha antes de ela terminar de abrir (a luz não fica acesa).
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export const cameraDisponivel = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function mensagemErro(e: unknown): string {
  const nome = (e as { name?: string } | null)?.name;
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'O navegador não deu permissão para usar a câmera. Libere a câmera para este site nas configurações do navegador e tente de novo.';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Nenhuma câmera foi encontrada neste aparelho.';
  if (nome === 'NotReadableError' || nome === 'AbortError') return 'A câmera está sendo usada por outro programa. Feche o outro programa e tente de novo.';
  return 'Não foi possível abrir a câmera.';
}

export function LeitorCameraModal({ aberto, onLer, onFechar }: { aberto: boolean; onLer: (codigo: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pronta, setPronta] = useState(false);
  // as funções do pai mudam a cada render: guardadas num ref, a câmera não reabre a cada tecla
  const ler = useRef(onLer);
  ler.current = onLer;
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    let lido = false;
    let stream: MediaStream | null = null;
    let controles: { stop: () => void } | null = null;
    const desligar = () => { controles?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
    setErro(null); setPronta(false);
    void (async () => {
      try {
        const [{ BrowserMultiFormatOneDReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        // a câmera de trás no celular; no computador, a webcam que houver ("ideal" não falha quando não existe)
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelado || !video.current) { desligar(); return; }
        const leitor = new BrowserMultiFormatOneDReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]]]));
        controles = await leitor.decodeFromStream(stream, video.current, (r) => {
          const codigo = r?.getText().trim().toUpperCase();
          if (!codigo || lido || cancelado) return;
          // a câmera lê o mesmo quadro várias vezes: vale só a primeira leitura; a janela fecha antes de o código seguir
          lido = true; desligar();
          fechar.current(); ler.current(codigo);
        });
        if (cancelado) { desligar(); return; }
        setPronta(true);
      } catch (e) {
        desligar();
        if (!cancelado) setErro(mensagemErro(e));
      }
    })();
    return () => { cancelado = true; desligar(); };
  }, [aberto]);

  return (
    <Modal titulo="Ler pela câmera" aberto={aberto} onFechar={onFechar} largura="sm"
      rodape={<button className="btn" onClick={onFechar} autoFocus>Cancelar (Esc)</button>}>
      {erro ? <div className="alert alert-error" role="alert">{erro}</div> : <>
        <video ref={video} className="camera-video" muted playsInline aria-label="Imagem da câmera" />
        <p className="muted" aria-live="polite">{pronta ? 'Aponte a câmera para o código de barras da etiqueta.' : 'Abrindo a câmera…'}</p>
      </>}
    </Modal>
  );
}
