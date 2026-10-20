-- Sprint 4: etiquetas (S4-01 a S4-05). Decisões do humano (20/10/2026): P-01, P-02 e P-18.
-- Permissão própria para imprimir (a S1-11 previa) e o tamanho do rolo nos parâmetros do Admin.

-- ------------------------------------------------------------------ permissão (Admin e Estoquista)
INSERT INTO "permissao" ("codigo", "modulo", "descricao") VALUES
  ('etiquetas.imprimir', 'EST', 'Imprimir etiquetas dos produtos (título, preço e código de barras)')
ON CONFLICT ("codigo") DO NOTHING;
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'etiquetas.imprimir'),
  ('00000000-0000-4000-8000-0000000000a3', 'etiquetas.imprimir')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------ tamanho do rolo (S4-01)
-- Ainda não há impressora (P-02): 50 x 30 mm até a compra; o Admin muda em Parâmetros.
INSERT INTO "parametro" ("chave", "valor", "descricao") VALUES
  ('etiqueta.largura_mm', '50', 'Largura da etiqueta do rolo, em milímetros'),
  ('etiqueta.altura_mm', '30', 'Altura da etiqueta do rolo, em milímetros')
ON CONFLICT ("chave") DO NOTHING;
