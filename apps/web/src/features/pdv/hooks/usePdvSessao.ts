/** Estado da sessão do PDV: caixa aberto, terminal do dispositivo e catálogo, sempre buscados da API. */
import { useCallback, useEffect, useState } from 'react';
import { caixaApi } from '../../caixa/caixa.api';
import { pdvApi } from '../pdv.api';
import { ApiError, errorMessage } from '../../../shared/api/http';
import type { CaixaSessao, CatalogoPdv, Instituicao } from '../../../shared/api/types';
import { carregarInstituicao } from '../instituicao';
import { armazenamento } from '../../../shared/lib/armazenamento';

export interface PdvSessao {
  caixa: CaixaSessao | null;
  catalogo: CatalogoPdv | null;
  /** Nome e CNPJ para o comprovante. */
  instituicao: Instituicao | null;
  carregando: boolean;
  erro: string | null;
  semCaixa: boolean;
  terminalDesativado: boolean;
  recarregarCatalogo: () => Promise<void>;
  atualizarCatalogo: (fn: (c: CatalogoPdv) => CatalogoPdv) => void;
}

export function usePdvSessao(): PdvSessao {
  const [caixa, setCaixa] = useState<CaixaSessao | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoPdv | null>(null);
  const [instituicao, setInstituicao] = useState<Instituicao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semCaixa, setSemCaixa] = useState(false);
  const [terminalDesativado, setTerminalDesativado] = useState(false);

  const recarregarCatalogo = useCallback(async () => { setCatalogo(await pdvApi.catalogo()); }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        let cx: CaixaSessao;
        try { cx = await caixaApi.atual(); }
        catch (e) {
          if (e instanceof ApiError && e.status === 404) { if (vivo) setSemCaixa(true); return; }
          if (e instanceof ApiError && e.code === 'TERMINAL_DESATIVADO') { armazenamento.limparTudo(); if (vivo) setTerminalDesativado(true); return; }
          throw e;
        }
        if (vivo) setCaixa(cx);
        await recarregarCatalogo();
        void carregarInstituicao().then((i) => { if (vivo) setInstituicao(i); });
      } catch (e) { if (vivo) setErro(errorMessage(e)); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [recarregarCatalogo]);

  const atualizarCatalogo = useCallback((fn: (c: CatalogoPdv) => CatalogoPdv) => {
    setCatalogo((atual) => (atual ? fn(atual) : atual));
  }, []);

  return { caixa, catalogo, instituicao, carregando, erro, semCaixa, terminalDesativado, recarregarCatalogo, atualizarCatalogo };
}
