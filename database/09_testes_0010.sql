-- =====================================================================================
-- Bateria de testes das regras da 0010 (Sprint 3): ajuste só de saída, quem aprova e quem devolve,
-- desconto no produto e preço efetivo, desativação de perfil e auditoria do parceiro sem dado pessoal.
-- Tenta violar cada regra. Banco de TESTE com dados (ex.: depois do tests/smoke.ts e do tests/sprint3.ts). Tudo em ROLLBACK.
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/09_testes_0010.sql
-- =====================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE _res (n serial, teste text, ok boolean, detalhe text);

-- espera erro contendo `esperado` (código fn_falha, SQLSTATE ou trecho da mensagem)
CREATE FUNCTION pg_temp.espera_erro(teste text, sql text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    INSERT INTO _res (teste, ok, detalhe) VALUES (teste, false, 'executou sem erro');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res (teste, ok, detalhe) VALUES (teste, SQLERRM ILIKE '%' || esperado || '%' OR SQLSTATE = esperado, SQLSTATE || ' ' || left(SQLERRM, 120));
  END;
END $$;
CREATE FUNCTION pg_temp.espera(teste text, cond boolean, detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _res (teste, ok, detalhe) VALUES (teste, coalesce(cond, false), detalhe);
$$;

-- massa fictícia: o Administrador (u), um Estoquista novo (e), um lote e um produto de várias unidades
SELECT id AS u FROM usuario WHERE perfil_id = '00000000-0000-4000-8000-0000000000a1' AND ativo ORDER BY criado_em LIMIT 1 \gset
SELECT id AS cat FROM categoria ORDER BY criado_em LIMIT 1 \gset
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, atualizado_em)
VALUES ('30000000-0000-4000-8000-0000000000e1', 'Estoquista de teste', 'est_teste_0010', 'x', '00000000-0000-4000-8000-0000000000a3', now());
INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
VALUES ('30000000-0000-4000-8000-000000000001', 'DOACAO', '00000000-0000-4000-8000-0000000000b1', now(), '30000000-0000-4000-8000-0000000000e1');
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, criado_por_id, atualizado_em) VALUES
  ('30000000-0000-4000-8000-0000000000b1', 'TST0010', 'Travessa', 'Travessa de vidro', :'cat', 20, '30000000-0000-4000-8000-0000000000e1', now());
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id) VALUES
  ('30000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001', :'cat', 'ETIQUETADO', '30000000-0000-4000-8000-0000000000b1', 3, 4, '30000000-0000-4000-8000-0000000000e1', 1),
  ('30000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-000000000001', :'cat', 'ETIQUETADO', '30000000-0000-4000-8000-0000000000b1', 3, 2, :'u', 1);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- A. quem aprova e quem devolve (S3-22, P-16)
SELECT pg_temp.espera_erro('Estoquista não aprova o que ele mesmo cadastrou',
  $$UPDATE item SET status = 'APROVADO', aprovado_por_id = '30000000-0000-4000-8000-0000000000e1', aprovado_em = now() WHERE id = '30000000-0000-4000-8000-0000000000a1'$$, 'AUTO_APROVACAO');
SELECT pg_temp.espera_erro('Estoquista não devolve o que ele mesmo cadastrou',
  $$UPDATE item SET status = 'DEVOLVIDO', motivo_devolucao = 'Confira', devolvido_por_id = '30000000-0000-4000-8000-0000000000e1' WHERE id = '30000000-0000-4000-8000-0000000000a1'$$, 'AUTO_APROVACAO');
SELECT pg_temp.espera_erro('a devolução registra quem devolveu',
  $$UPDATE item SET status = 'DEVOLVIDO', motivo_devolucao = 'Confira' WHERE id = '30000000-0000-4000-8000-0000000000a1'$$, 'DEVOLUCAO_SEM_AUTOR');
UPDATE item SET status = 'DEVOLVIDO', motivo_devolucao = 'Confira o preço', devolvido_por_id = :'u' WHERE id = '30000000-0000-4000-8000-0000000000a1';
SELECT pg_temp.espera('outra pessoa devolve', (SELECT status = 'DEVOLVIDO' AND devolvido_por_id = :'u' FROM item WHERE id = '30000000-0000-4000-8000-0000000000a1'));
UPDATE item SET status = 'CADASTRADO', motivo_devolucao = NULL WHERE id = '30000000-0000-4000-8000-0000000000a1';
UPDATE item SET status = 'APROVADO', aprovado_por_id = :'u', aprovado_em = now() WHERE id = '30000000-0000-4000-8000-0000000000a1';
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('30000000-0000-4000-8000-0000000000a1', 'ENTRADA', 1, 4, :'u');
UPDATE item SET status = 'APROVADO', aprovado_por_id = :'u', aprovado_em = now() WHERE id = '30000000-0000-4000-8000-0000000000a2';
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('30000000-0000-4000-8000-0000000000a2', 'ENTRADA', 1, 2, :'u');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.espera('outra pessoa aprova; o Administrador aprova o próprio cadastro', fn_saldo('30000000-0000-4000-8000-0000000000a1', 1) = 4 AND fn_saldo('30000000-0000-4000-8000-0000000000a2', 1) = 2);
SELECT pg_temp.espera_erro('item já devolvido no INSERT também registra quem devolveu',
  format($$INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id, status, motivo_devolucao)
    VALUES ('30000000-0000-4000-8000-0000000000a3', '30000000-0000-4000-8000-000000000001', %L, 'CATEGORIA', 3, 1, %L, 1, 'DEVOLVIDO', 'Confira')$$, :'cat', :'u'), 'DEVOLUCAO_SEM_AUTOR');
SELECT pg_temp.espera_erro('item já aprovado no INSERT também confere outra pessoa',
  format($$INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id, status, aprovado_por_id, aprovado_em)
    VALUES ('30000000-0000-4000-8000-0000000000a4', '30000000-0000-4000-8000-000000000001', %L, 'CATEGORIA', 3, 1, '30000000-0000-4000-8000-0000000000e1', 1, 'APROVADO', '30000000-0000-4000-8000-0000000000e1', now())$$, :'cat'), 'AUTO_APROVACAO');
SELECT pg_temp.espera_erro('quem devolveu não se troca depois',
  format($$UPDATE item SET devolvido_por_id = %L WHERE id = '30000000-0000-4000-8000-0000000000a1'$$, '30000000-0000-4000-8000-0000000000e1'), 'ORIGEM_IMUTAVEL');

-- B. ajuste só de saída (S3-03)
SELECT pg_temp.espera_erro('ajuste de entrada é recusado no banco',
  format($$INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id, motivo) VALUES ('30000000-0000-4000-8000-0000000000a1', 'AJUSTE_ENTRADA', 1, 1, %L, 'Sobrou na contagem')$$, :'u'),
  'AJUSTE_ENTRADA_PROIBIDO');
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, usuario_id, motivo) VALUES ('30000000-0000-4000-8000-0000000000a1', 'AJUSTE_SAIDA', 1, 1, :'u', 'Faltou na contagem');
SELECT pg_temp.espera('ajuste de saída continua valendo', fn_saldo('30000000-0000-4000-8000-0000000000a1', 1) = 3);

-- C. desconto no produto e preço efetivo (S3-09, S3-10)
SELECT pg_temp.espera_erro('desconto de 100% é recusado',
  format($$UPDATE produto SET desconto_tipo = 'PERCENTUAL', desconto_valor = 100, desconto_motivo = 'Promoção', desconto_por_id = %L, desconto_em = now() WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, :'u'), 'ck_produto_desconto');
SELECT pg_temp.espera_erro('preço promocional não chega ao preço de venda',
  format($$UPDATE produto SET desconto_tipo = 'PRECO', desconto_valor = 20, desconto_motivo = 'Promoção', desconto_por_id = %L, desconto_em = now() WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, :'u'), 'ck_produto_desconto');
SELECT pg_temp.espera_erro('desconto exige motivo de 5+ caracteres',
  format($$UPDATE produto SET desconto_tipo = 'PERCENTUAL', desconto_valor = 10, desconto_motivo = 'ok', desconto_por_id = %L, desconto_em = now() WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, :'u'), 'ck_produto_desconto');
SELECT pg_temp.espera_erro('desconto exige quem deu e quando',
  $$UPDATE produto SET desconto_tipo = 'PERCENTUAL', desconto_valor = 10, desconto_motivo = 'Promoção' WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, 'ck_produto_desconto');
SELECT pg_temp.espera_erro('tipo de desconto desconhecido é recusado',
  format($$UPDATE produto SET desconto_tipo = 'BRINDE', desconto_valor = 10, desconto_motivo = 'Promoção', desconto_por_id = %L, desconto_em = now() WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, :'u'), 'ck_produto_desconto');
UPDATE produto SET desconto_tipo = 'PERCENTUAL', desconto_valor = 12.5, desconto_motivo = 'Promoção de teste', desconto_por_id = :'u', desconto_em = now() WHERE id = '30000000-0000-4000-8000-0000000000b1';
SELECT pg_temp.espera('12,5% de R$ 20,00 = R$ 17,50', (SELECT fn_preco_efetivo(preco_venda, desconto_tipo, desconto_valor, desconto_ate) FROM produto WHERE id = '30000000-0000-4000-8000-0000000000b1') = 17.50);
UPDATE produto SET desconto_ate = (now() AT TIME ZONE 'America/Fortaleza')::date - 1 WHERE id = '30000000-0000-4000-8000-0000000000b1';
SELECT pg_temp.espera('desconto vencido volta ao preço cheio', (SELECT fn_preco_efetivo(preco_venda, desconto_tipo, desconto_valor, desconto_ate) FROM produto WHERE id = '30000000-0000-4000-8000-0000000000b1') = 20);
UPDATE produto SET desconto_ate = (now() AT TIME ZONE 'America/Fortaleza')::date WHERE id = '30000000-0000-4000-8000-0000000000b1';
SELECT pg_temp.espera('desconto válido até hoje vale hoje', (SELECT fn_preco_efetivo(preco_venda, desconto_tipo, desconto_valor, desconto_ate) FROM produto WHERE id = '30000000-0000-4000-8000-0000000000b1') = 17.50);
SELECT pg_temp.espera('percentual nunca deixa o preço abaixo de R$ 0,01', fn_preco_efetivo(0.01, 'PERCENTUAL', 60, NULL) = 0.01);
SELECT pg_temp.espera_erro('preço não desce até o promocional com o desconto vigente',
  $$UPDATE produto SET desconto_tipo = 'PRECO', desconto_valor = 15, desconto_ate = NULL, preco_venda = 15 WHERE id = '30000000-0000-4000-8000-0000000000b1'$$, 'ck_produto_desconto');
SELECT pg_temp.espera('venda guarda o preço de tabela e o desconto do produto (coerentes)', EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'ck_venda_item_desconto_produto'));
SELECT pg_temp.espera('nenhuma venda com desconto do produto incoerente', NOT EXISTS (
  SELECT 1 FROM venda_item WHERE desconto_produto <> coalesce(quantidade * (preco_tabela - preco_unitario), 0)));

-- D. perfis (S3-20)
SELECT pg_temp.espera_erro('perfil padrão não se desativa',
  $$UPDATE perfil SET ativo = false WHERE id = '00000000-0000-4000-8000-0000000000a2'$$, 'PERFIL_PADRAO');
SELECT pg_temp.espera_erro('perfil não deixa de ser padrão',
  $$UPDATE perfil SET padrao = false WHERE id = '00000000-0000-4000-8000-0000000000a2'$$, 'PERFIL_PADRAO');
INSERT INTO perfil (id, nome, padrao) VALUES ('30000000-0000-4000-8000-0000000000f1', 'Perfil de teste 0010', false);
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, atualizado_em)
VALUES ('30000000-0000-4000-8000-0000000000e2', 'Usuário de teste', 'perfil_teste_0010', 'x', '30000000-0000-4000-8000-0000000000f1', now());
SELECT pg_temp.espera_erro('perfil com usuário ativo não se desativa',
  $$UPDATE perfil SET ativo = false WHERE id = '30000000-0000-4000-8000-0000000000f1'$$, 'PERFIL_EM_USO');
UPDATE usuario SET ativo = false WHERE id = '30000000-0000-4000-8000-0000000000e2';
UPDATE perfil SET ativo = false WHERE id = '30000000-0000-4000-8000-0000000000f1';
SELECT pg_temp.espera('sem usuário ativo, o perfil se desativa', (SELECT NOT ativo FROM perfil WHERE id = '30000000-0000-4000-8000-0000000000f1'));
SELECT pg_temp.espera_erro('usuário não volta a ficar ativo num perfil desativado',
  $$UPDATE usuario SET ativo = true WHERE id = '30000000-0000-4000-8000-0000000000e2'$$, 'PERFIL_INATIVO');
SELECT pg_temp.espera_erro('usuário novo não entra em perfil desativado',
  $$INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, atualizado_em) VALUES (gen_random_uuid(), 'Outro', 'perfil_teste_0010b', 'x', '30000000-0000-4000-8000-0000000000f1', now())$$, 'PERFIL_INATIVO');
INSERT INTO perfil (id, nome, padrao) VALUES ('30000000-0000-4000-8000-0000000000f2', 'PERFIL DE TESTE 0010', false);
SELECT pg_temp.espera('o nome do perfil desativado fica livre', EXISTS (SELECT 1 FROM perfil WHERE id = '30000000-0000-4000-8000-0000000000f2'));
SELECT pg_temp.espera_erro('nome repetido entre perfis ativos é recusado (sem diferença de maiúsculas)',
  $$INSERT INTO perfil (id, nome, padrao) VALUES (gen_random_uuid(), 'perfil de teste 0010', false)$$, 'perfil_nome_ativo_key');
SELECT pg_temp.espera_erro('perfil não se exclui', $$DELETE FROM perfil WHERE id = '30000000-0000-4000-8000-0000000000f1'$$, 'EXCLUSAO_PROIBIDA');

-- E. auditoria do parceiro sem dado pessoal (S3-16): vale para as alterações feitas depois da 0010
SELECT pg_temp.espera('auditoria de parceiro alterado não guarda nome, documento, cidade, telefone nem e-mail', NOT EXISTS (
  SELECT 1 FROM auditoria a
   WHERE a.entidade = 'parceiro' AND a.acao = 'CADASTRO_ALTERADO'
     AND a.criado_em > (SELECT finished_at FROM _prisma_migrations WHERE migration_name LIKE '0010%')
     AND (coalesce(a.antes, '{}') ?| ARRAY['nome', 'documento', 'documentoExibicao', 'cidade', 'telefone', 'email']
       OR coalesce(a.depois, '{}') ?| ARRAY['nome', 'documento', 'documentoExibicao', 'cidade', 'telefone', 'email'])));
SELECT pg_temp.espera('a alteração do parceiro registra quais campos mudaram', NOT EXISTS (
  SELECT 1 FROM auditoria a
   WHERE a.entidade = 'parceiro' AND a.acao = 'CADASTRO_ALTERADO'
     AND a.criado_em > (SELECT finished_at FROM _prisma_migrations WHERE migration_name LIKE '0010%')
     AND NOT (a.depois ? 'camposAlterados')));

-- F. as regras de antes continuam fechando
SELECT pg_temp.espera('equação da prestação de contas fecha em todos os lotes', NOT EXISTS (
  SELECT 1 FROM vw_prestacao_contas_lote
   WHERE itens_aprovados <> itens_vendidos + em_estoque_bazar + em_estoque_doacoes + itens_baixados - ajustes_liquidos));
SET CONSTRAINTS ALL IMMEDIATE;

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
