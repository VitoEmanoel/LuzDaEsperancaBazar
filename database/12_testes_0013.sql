-- =====================================================================================
-- Bateria de testes da 0013 (Sprint 5): a chave de acesso da NF-e importada (S5-04, P-20). A API confere o dígito e o
-- emitente; o banco garante o formato, que a nota é de compra e que a mesma chave não entra duas vezes. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/sprint5.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/12_testes_0013.sql
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

-- chave fictícia: 44 caracteres; com CNPJ alfanumérico, as posições 7 a 20 podem ter letras
CREATE FUNCTION pg_temp.lote(tipo text, chave text) RETURNS void LANGUAGE sql AS $$
  -- com fornecedor e valor (ck_lote_origem): o que muda entre os testes é só o tipo e a chave
  INSERT INTO lote_entrada (id, tipo, recebido_em, recebido_por_id, parceiro_id, valor_compra, nfe_chave)
  VALUES (gen_random_uuid(), tipo::"TipoEntrada", now(), (SELECT id FROM usuario ORDER BY criado_em LIMIT 1), (SELECT id FROM parceiro ORDER BY nome LIMIT 1), 10, chave);
$$;

-- A. formato da chave
SELECT pg_temp.lote('COMPRA', '22261012ABC34501DE3555001000000001100000001' || '7');
SELECT pg_temp.espera('chave com o CNPJ alfanumérico é aceita', EXISTS (SELECT 1 FROM lote_entrada WHERE nfe_chave = '22261012ABC34501DE35550010000000011000000017'));
SELECT pg_temp.lote('COMPRA', '22261011222333000181550010000000021000000025');
SELECT pg_temp.espera('chave só com números é aceita', EXISTS (SELECT 1 FROM lote_entrada WHERE nfe_chave = '22261011222333000181550010000000021000000025'));
SELECT pg_temp.espera('lote sem nota continua aceito (chave vazia)', (SELECT pg_temp.lote('COMPRA', NULL) IS NULL));
SELECT pg_temp.espera_erro('chave curta é recusada', $q$SELECT pg_temp.lote('COMPRA', '2226101122233300018155001000000003100000003')$q$, 'ck_lote_nfe_chave');
SELECT pg_temp.espera_erro('letra fora do CNPJ da chave é recusada', $q$SELECT pg_temp.lote('COMPRA', '2226A011222333000181550010000000041000000041')$q$, 'ck_lote_nfe_chave');
SELECT pg_temp.espera_erro('letra minúscula é recusada (a API guarda em maiúsculas)', $q$SELECT pg_temp.lote('COMPRA', '22261012abc34501de35550010000000051000000050')$q$, 'ck_lote_nfe_chave');

-- B. a mesma nota não entra duas vezes; só compra tem nota
SELECT pg_temp.espera_erro('a mesma chave de novo é recusada', $q$SELECT pg_temp.lote('COMPRA', '22261011222333000181550010000000021000000025')$q$, 'uq_lote_nfe_chave');
SELECT pg_temp.espera_erro('lote de doação com chave de NF-e é recusado', $q$SELECT pg_temp.lote('DOACAO', '22261011222333000181550010000000061000000068')$q$, 'ck_lote_nfe_compra');
SELECT pg_temp.espera('vários lotes sem nota convivem (o índice ignora a chave vazia)', (SELECT pg_temp.lote('COMPRA', NULL) IS NULL) AND (SELECT count(*) FROM lote_entrada WHERE nfe_chave IS NULL) >= 2);

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
