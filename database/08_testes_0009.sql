-- =====================================================================================
-- Bateria de testes das regras da 0009 (produto, entrada por lote e aprovação): tenta violar
-- cada uma. Banco de TESTE com dados (ex.: depois do tests/smoke.ts). Tudo em ROLLBACK.
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/08_testes_0009.sql
-- Para os testes do papel da API, rode também com:  -v papel_api=bazar_api
-- =====================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE _res (n serial, teste text, ok boolean, detalhe text);
GRANT ALL ON _res TO PUBLIC; GRANT ALL ON SEQUENCE _res_n_seq TO PUBLIC;

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

-- massa mínima fictícia: um lote, um produto de várias unidades (TST0002) e uma peça única (TST0001)
-- o Administrador: desde a 0010 só ele aprova o que ele mesmo cadastrou (S3-22)
SELECT id AS u FROM usuario WHERE ativo AND perfil_id = '00000000-0000-4000-8000-0000000000a1' ORDER BY criado_em LIMIT 1 \gset
SELECT id AS cat FROM categoria ORDER BY criado_em LIMIT 1 \gset
SELECT id AS cat2 FROM categoria WHERE id <> :'cat' ORDER BY criado_em LIMIT 1 \gset
INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
VALUES ('20000000-0000-4000-8000-000000000001', 'DOACAO', '00000000-0000-4000-8000-0000000000b1', now(), :'u');
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, peca_unica, criado_por_id, atualizado_em) VALUES
  ('20000000-0000-4000-8000-0000000000b1', 'TST0001', 'Vestido', 'Vestido de festa', :'cat', 50, true, :'u', now()),
  ('20000000-0000-4000-8000-0000000000b2', 'TST0002', 'Caneca', 'Caneca branca', :'cat', 8, false, :'u', now());
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id) VALUES
  ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', :'cat', 'ETIQUETADO', '20000000-0000-4000-8000-0000000000b2', 2, 3, :'u', 1),
  ('20000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001', :'cat', 'ETIQUETADO', '20000000-0000-4000-8000-0000000000b1', 10, 1, :'u', 1);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- A. item cadastrado não mexe no estoque
SELECT pg_temp.espera('item nasce cadastrado', (SELECT status FROM item WHERE id = '20000000-0000-4000-8000-0000000000a1') = 'CADASTRADO');
SELECT pg_temp.espera_erro('item cadastrado não recebe ENTRADA',
  format($$INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('20000000-0000-4000-8000-0000000000a1', 'ENTRADA', 1, 3, %L)$$, :'u'),
  'ITEM_NAO_APROVADO');
SELECT pg_temp.espera('prestação de contas não conta item cadastrado',
  (SELECT itens_aprovados FROM vw_prestacao_contas_lote WHERE lote_id = '20000000-0000-4000-8000-000000000001') = 0);

-- B. aprovação
SELECT pg_temp.espera_erro('aprovar sem a ENTRADA é recusado no commit',
  format($$UPDATE item SET status = 'APROVADO', aprovado_por_id = %L, aprovado_em = now() WHERE id = '20000000-0000-4000-8000-0000000000a1';
           SET CONSTRAINTS ALL IMMEDIATE$$, :'u'), 'ITEM_SEM_ENTRADA');
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.espera_erro('aprovado exige quem aprovou e quando',
  $$UPDATE item SET status = 'APROVADO' WHERE id = '20000000-0000-4000-8000-0000000000a1'$$, 'ck_item_aprovacao');
UPDATE item SET status = 'APROVADO', aprovado_por_id = :'u', aprovado_em = now() WHERE id = '20000000-0000-4000-8000-0000000000a1';
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('20000000-0000-4000-8000-0000000000a1', 'ENTRADA', 1, 3, :'u');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.espera('aprovado com ENTRADA: saldo de 3 unidades', fn_saldo('20000000-0000-4000-8000-0000000000a1', 1) = 3);
SELECT pg_temp.espera('prestação de contas conta o aprovado',
  (SELECT itens_aprovados FROM vw_prestacao_contas_lote WHERE lote_id = '20000000-0000-4000-8000-000000000001') = 3);
SELECT pg_temp.espera_erro('aprovado não volta a cadastrado',
  $$UPDATE item SET status = 'CADASTRADO', aprovado_por_id = NULL, aprovado_em = NULL WHERE id = '20000000-0000-4000-8000-0000000000a1'$$, 'ORIGEM_IMUTAVEL');
SELECT pg_temp.espera_erro('aprovado não muda a quantidade',
  $$UPDATE item SET quantidade_inicial = 5 WHERE id = '20000000-0000-4000-8000-0000000000a1'$$, 'ORIGEM_IMUTAVEL');
UPDATE item SET descricao = 'Caneca (lote de teste)' WHERE id = '20000000-0000-4000-8000-0000000000a1';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.espera('aprovado ainda muda a descrição', (SELECT descricao FROM item WHERE id = '20000000-0000-4000-8000-0000000000a1') = 'Caneca (lote de teste)');
-- (desde a 0010 não há ajuste de entrada: as 3 unidades aprovadas já provam que o produto de várias unidades passa de 1)
SELECT pg_temp.espera('produto de várias unidades passa de 1 unidade (sem ETIQUETADO_QTD)', fn_saldo('20000000-0000-4000-8000-0000000000a1', 1) = 3);

-- C. devolução
SELECT pg_temp.espera_erro('devolver exige motivo',
  format($$UPDATE item SET status = 'DEVOLVIDO', devolvido_por_id = %L WHERE id = '20000000-0000-4000-8000-0000000000a2'$$, :'u'), 'ck_item_devolucao');
-- desde a 0010 a devolução registra quem devolveu (devolvido_por_id)
UPDATE item SET status = 'DEVOLVIDO', motivo_devolucao = 'Foto e tamanho faltando', devolvido_por_id = :'u' WHERE id = '20000000-0000-4000-8000-0000000000a2';
SELECT pg_temp.espera_erro('devolvido não é aprovado sem ser reenviado',
  format($$UPDATE item SET status = 'APROVADO', motivo_devolucao = NULL, aprovado_por_id = %L, aprovado_em = now() WHERE id = '20000000-0000-4000-8000-0000000000a2'$$, :'u'),
  'ITEM_DEVOLVIDO');
UPDATE item SET status = 'CADASTRADO', motivo_devolucao = NULL, valor_atribuido = 12 WHERE id = '20000000-0000-4000-8000-0000000000a2';
SELECT pg_temp.espera('devolvido é corrigido e reenviado', (SELECT status = 'CADASTRADO' AND valor_atribuido = 12 FROM item WHERE id = '20000000-0000-4000-8000-0000000000a2'));

-- D. peça única e produto
SELECT pg_temp.espera_erro('peça única tem quantidade 1',
  $$UPDATE item SET quantidade_inicial = 2 WHERE id = '20000000-0000-4000-8000-0000000000a2'$$, 'PECA_UNICA_QTD');
SELECT pg_temp.espera_erro('peça única não recebe nova entrada',
  format($$INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id)
           VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000000001', %L, 'ETIQUETADO', '20000000-0000-4000-8000-0000000000b1', 1, 1, %L, 1)$$, :'cat', :'u'),
  'PECA_UNICA_ENTRADA');
SELECT pg_temp.espera_erro('a entrada tem a categoria do produto',
  format($$INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id)
           VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000000001', %L, 'ETIQUETADO', '20000000-0000-4000-8000-0000000000b2', 1, 1, %L, 1)$$, :'cat2', :'u'),
  'CATEGORIA_DO_PRODUTO');
SELECT pg_temp.espera_erro('entrada de produto exige o produto',
  format($$INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id)
           VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000000001', %L, 'ETIQUETADO', 1, 1, %L, 1)$$, :'cat', :'u'),
  'ck_item_etiquetado');
UPDATE item SET status = 'APROVADO', aprovado_por_id = :'u', aprovado_em = now() WHERE id = '20000000-0000-4000-8000-0000000000a2';
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('20000000-0000-4000-8000-0000000000a2', 'ENTRADA', 1, 1, :'u');
SELECT pg_temp.espera_erro('peça única aprovada não passa de 1 unidade',
  format($$INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id, motivo) VALUES ('20000000-0000-4000-8000-0000000000a2', 'ENTRADA', 1, 1, %L, 'teste')$$, :'u'),
  'ETIQUETADO_QTD');
SELECT pg_temp.espera_erro('código do produto não muda',
  $$UPDATE produto SET codigo = 'TST9999' WHERE id = '20000000-0000-4000-8000-0000000000b2'$$, 'ORIGEM_IMUTAVEL');
SELECT pg_temp.espera_erro('peça única com unidade aprovada não vira várias unidades',
  $$UPDATE produto SET peca_unica = false WHERE id = '20000000-0000-4000-8000-0000000000b1'$$, 'PECA_UNICA_IMUTAVEL');
UPDATE produto SET preco_venda = 9.50 WHERE id = '20000000-0000-4000-8000-0000000000b2';
SELECT pg_temp.espera('o preço do produto muda', (SELECT preco_venda FROM produto WHERE id = '20000000-0000-4000-8000-0000000000b2') = 9.50);
SELECT pg_temp.espera_erro('produto não se exclui', $$DELETE FROM produto WHERE id = '20000000-0000-4000-8000-0000000000b2'$$, 'EXCLUSAO_PROIBIDA');
SELECT pg_temp.espera_erro('preço do produto maior que zero', $$UPDATE produto SET preco_venda = 0 WHERE id = '20000000-0000-4000-8000-0000000000b2'$$, 'ck_produto_preco');

SELECT pg_temp.espera_erro('código do produto só com letras maiúsculas e números',
  format($$INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, criado_por_id, atualizado_em) VALUES (gen_random_uuid(), 'tst 1', 'X', 'X', %L, 1, %L, now())$$, :'cat', :'u'),
  'ck_produto_codigo');
SELECT pg_temp.espera_erro('produto com unidade aprovada não muda de categoria',
  format($$UPDATE produto SET categoria_id = %L WHERE id = '20000000-0000-4000-8000-0000000000b2'$$, :'cat2'), 'CATEGORIA_DO_PRODUTO');
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, peca_unica, criado_por_id, atualizado_em)
VALUES ('20000000-0000-4000-8000-0000000000b3', 'TST0003', 'Copo', 'Copo de vidro', :'cat', 3, false, :'u', now());
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, valor_atribuido, quantidade_inicial, criado_por_id, local_destino_id) VALUES
  ('20000000-0000-4000-8000-0000000000a3', '20000000-0000-4000-8000-000000000001', :'cat', 'ETIQUETADO', '20000000-0000-4000-8000-0000000000b3', 1, 2, :'u', 2);
SELECT pg_temp.espera_erro('produto com entrada de 2 unidades não vira peça única',
  $$UPDATE produto SET peca_unica = true WHERE id = '20000000-0000-4000-8000-0000000000b3'$$, 'PECA_UNICA_QTD');
SELECT pg_temp.espera_erro('a ENTRADA da aprovação vai para o local escolhido no cadastro',
  format($$UPDATE item SET status = 'APROVADO', aprovado_por_id = %L, aprovado_em = now() WHERE id = '20000000-0000-4000-8000-0000000000a3';
           INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id) VALUES ('20000000-0000-4000-8000-0000000000a3', 'ENTRADA', 1, 2, %L);
           SET CONSTRAINTS ALL IMMEDIATE$$, :'u', :'u'), 'ITEM_SEM_ENTRADA');
SET CONSTRAINTS ALL DEFERRED;

-- E. lote
SELECT pg_temp.espera_erro('doação exige parceiro',
  format($$INSERT INTO lote_entrada (tipo, campanha_id, recebido_em, recebido_por_id) SELECT 'DOACAO', id, now(), %L FROM campanha LIMIT 1$$, :'u'),
  'PARCEIRO_OBRIGATORIO');
SELECT pg_temp.espera_erro('lote não vira doação sem parceiro depois de criado',
  $$UPDATE lote_entrada SET parceiro_id = NULL, campanha_id = (SELECT id FROM campanha LIMIT 1) WHERE id = '20000000-0000-4000-8000-000000000001'$$, 'PARCEIRO_OBRIGATORIO');
SELECT pg_temp.espera('equação da prestação de contas fecha em todos os lotes', NOT EXISTS (
  SELECT 1 FROM vw_prestacao_contas_lote
   WHERE itens_aprovados <> itens_vendidos + em_estoque_bazar + em_estoque_doacoes + itens_baixados - ajustes_liquidos));
SELECT pg_temp.espera('nenhum item não aprovado tem movimentação', NOT EXISTS (
  SELECT 1 FROM item i WHERE i.status <> 'APROVADO' AND EXISTS (SELECT 1 FROM movimentacao m WHERE m.item_id = i.id)));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- papel da API (opcional)
\if :{?papel_api}
SET LOCAL ROLE :papel_api;
SELECT pg_temp.espera_erro('API não exclui produto', $$DELETE FROM produto WHERE id = '20000000-0000-4000-8000-0000000000b2'$$, '42501');
SELECT pg_temp.espera('API lê produto', (SELECT count(*) FROM produto) > 0);
UPDATE produto SET nome = 'Caneca branca grande' WHERE id = '20000000-0000-4000-8000-0000000000b2';
SELECT pg_temp.espera('API edita produto', (SELECT nome FROM produto WHERE id = '20000000-0000-4000-8000-0000000000b2') = 'Caneca branca grande');
RESET ROLE;
\endif

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
