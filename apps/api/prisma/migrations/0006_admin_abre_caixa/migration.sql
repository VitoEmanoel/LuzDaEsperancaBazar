-- O Administrador volta a poder abrir caixa (decisão do humano em 19/10/2026): para pagar contas e receber
-- fiado com o dinheiro da gaveta. O reembolso em dinheiro continua como saída no financeiro (migração 0005).
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'caixa.operar')
ON CONFLICT DO NOTHING;
