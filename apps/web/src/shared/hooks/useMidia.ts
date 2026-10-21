/** Diz se a media query vale agora e acompanha a mudança (girar o celular, redimensionar a janela). Só para texto e conforto: o layout fica no CSS. */
import { useEffect, useState } from 'react';

export function useMidia(consulta: string): boolean {
  const ler = () => typeof window !== 'undefined' && !!window.matchMedia?.(consulta).matches;
  const [vale, setVale] = useState(ler);
  useEffect(() => {
    const mq = window.matchMedia?.(consulta);
    if (!mq) return;
    const mudou = () => setVale(mq.matches);
    mudou();
    mq.addEventListener('change', mudou);
    return () => mq.removeEventListener('change', mudou);
  }, [consulta]);
  return vale;
}
