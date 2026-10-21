-- =====================================================================================
-- Bateria de testes da 0014 (Sprint 6, achados da revisão do protótipo, S6-14 a S6-17): a impressão do pedido na
-- idempotência, o Vendedor sem gerenciar clientes e um lote de saldo inicial só. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/smoke.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/13_testes_0014.sql
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
-- executa o comando e diz se passou sem erro (um WITH que grava não cabe dentro de uma expressão)
CREATE FUNCTION pg_temp.executa(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION pg_temp.saldo_inicial() RETURNS void LANGUAGE sql AS $$
  INSERT INTO lote_entrada (id, tipo, recebido_em, recebido_por_id) VALUES (gen_random_uuid(), 'SALDO_INICIAL', now(), (SELECT id FROM usuario ORDER BY criado_em LIMIT 1));
$$;

-- A. idempotência: a impressão do pedido é um sha-256 em hexadecimal (ou nada, nas chaves antigas)
SELECT pg_temp.espera_erro('impressão fora do formato é recusada',
  $q$INSERT INTO idempotencia (chave, escopo, usuario_id, corpo_hash) VALUES (gen_random_uuid(), 'teste', (SELECT id FROM usuario LIMIT 1), 'nao-e-hash')$q$, 'ck_idempotencia_corpo_hash');
SELECT pg_temp.espera('impressão válida entra',
  pg_temp.executa($q$INSERT INTO idempotencia (chave, escopo, usuario_id, corpo_hash) VALUES (gen_random_uuid(), 'teste', (SELECT id FROM usuario LIMIT 1), repeat('a', 64))$q$));
SELECT pg_temp.espera('chave sem impressão (antiga) continua valendo',
  pg_temp.executa($q$INSERT INTO idempotencia (chave, escopo, usuario_id) VALUES (gen_random_uuid(), 'teste', (SELECT id FROM usuario LIMIT 1))$q$));

-- B. Vendedor sem gerenciar clientes; continua operando o caixa
SELECT pg_temp.espera('Vendedor não tem clientes.gerenciar',
  NOT EXISTS (SELECT 1 FROM perfil_permissao WHERE perfil_id = '00000000-0000-4000-8000-0000000000a2' AND permissao_codigo = 'clientes.gerenciar'));
SELECT pg_temp.espera('Vendedor continua com caixa.operar',
  EXISTS (SELECT 1 FROM perfil_permissao WHERE perfil_id = '00000000-0000-4000-8000-0000000000a2' AND permissao_codigo = 'caixa.operar'));

-- C. um lote de saldo inicial só (cria o primeiro se ainda não houver; o segundo é recusado)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM lote_entrada WHERE tipo = 'SALDO_INICIAL') THEN PERFORM pg_temp.saldo_inicial(); END IF; END $$;
SELECT pg_temp.espera_erro('segundo lote de saldo inicial é recusado', $q$SELECT pg_temp.saldo_inicial()$q$, 'uq_lote_saldo_inicial_unico');

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
