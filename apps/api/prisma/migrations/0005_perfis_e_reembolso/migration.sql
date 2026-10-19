-- Sprint 1: quatro perfis padrão (Administrador, Estoquista, Vendedor, Financeiro), cada um vendo só o que é seu,
-- e reembolso em dinheiro como saída no financeiro (o Administrador deixa de operar caixa).
-- Perfis criados pelo Administrador (padrao = false) não são tocados.

-- Caixa vira Vendedor e Triagem vira Estoquista (mesmos ids, usuários e histórico preservados).
UPDATE "perfil" SET "nome" = 'Vendedor', "descricao" = 'Opera o PDV: vende e abre e fecha o próprio caixa'
 WHERE "id" = '00000000-0000-4000-8000-0000000000a2';
UPDATE "perfil" SET "nome" = 'Estoquista', "descricao" = 'Entradas, cadastro de produtos e estoque (tudo que não é venda nem financeiro)'
 WHERE "id" = '00000000-0000-4000-8000-0000000000a3';
INSERT INTO "perfil" ("id", "nome", "descricao", "padrao", "limite_desconto_pct") VALUES
  ('00000000-0000-4000-8000-0000000000a4', 'Financeiro', 'Contas a pagar e a receber, fluxo de caixa e relatórios', true, 0)
ON CONFLICT ("id") DO NOTHING;

-- Relatórios de estoque ficam separados dos de receita: o Estoquista vê só os de estoque.
INSERT INTO "permissao" ("codigo", "modulo", "descricao") VALUES
  ('relatorios.estoque', 'REL', 'Relatórios de estoque, descartes e transferências')
ON CONFLICT ("codigo") DO NOTHING;

-- Permissões dos perfis padrão
DELETE FROM "perfil_permissao" WHERE "perfil_id" IN (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4');

-- Administrador: tudo, menos operar o PDV (não vende)
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo")
SELECT '00000000-0000-4000-8000-0000000000a1', "codigo" FROM "permissao" WHERE "codigo" <> 'caixa.operar';

-- Vendedor: só o PDV (e cadastro rápido de cliente para o fiado)
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a2', 'caixa.operar'),
  ('00000000-0000-4000-8000-0000000000a2', 'clientes.gerenciar');

-- Estoquista: entradas, estoque e relatórios de estoque
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a3', 'entrada.registrar'),
  ('00000000-0000-4000-8000-0000000000a3', 'estoque.consultar'),
  ('00000000-0000-4000-8000-0000000000a3', 'estoque.transferir'),
  ('00000000-0000-4000-8000-0000000000a3', 'cadastros.consultar'),
  ('00000000-0000-4000-8000-0000000000a3', 'relatorios.estoque');

-- Financeiro: contas, relatórios e consulta de estoque
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a4', 'contas_pagar.gerenciar'),
  ('00000000-0000-4000-8000-0000000000a4', 'contas_receber.receber'),
  ('00000000-0000-4000-8000-0000000000a4', 'contas_receber.lancar'),
  ('00000000-0000-4000-8000-0000000000a4', 'relatorios.consultar'),
  ('00000000-0000-4000-8000-0000000000a4', 'relatorios.estoque'),
  ('00000000-0000-4000-8000-0000000000a4', 'estoque.consultar'),
  ('00000000-0000-4000-8000-0000000000a4', 'cadastros.consultar');

-- Reembolso em dinheiro (cancelar venda de caixa fechado, estornar recebimento) vira uma saída paga no financeiro.
INSERT INTO "categoria_despesa" ("id", "nome") VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'Reembolso de venda')
ON CONFLICT DO NOTHING;
