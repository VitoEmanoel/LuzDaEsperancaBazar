-- =====================================================================================
-- Bateria de testes da 0015 (Sprint 6, S6-21): terminal fixo no usuário. Quem tem terminal definido só abre caixa nele;
-- sem terminal, abre em qualquer um; o terminal de um usuário não se apaga. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/smoke.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/14_testes_0015.sql
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
-- executa o comando e diz se passou sem erro
CREATE FUNCTION pg_temp.executa(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;

-- dados de teste: dois terminais e dois usuários do Vendedor, um com o terminal fixo e outro sem
INSERT INTO terminal (id, nome) VALUES ('00000000-0000-4000-8000-0000000f0001', 'Teste 0015 A'), ('00000000-0000-4000-8000-0000000f0002', 'Teste 0015 B');
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, terminal_id, atualizado_em) VALUES
  ('00000000-0000-4000-8000-0000000f0011', 'Com terminal', 't0015.fixo', '!sem-login', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000f0001', now()),
  ('00000000-0000-4000-8000-0000000f0012', 'Sem terminal', 't0015.livre', '!sem-login', '00000000-0000-4000-8000-0000000000a2', NULL, now()),
  ('00000000-0000-4000-8000-0000000f0013', 'Outro sem terminal', 't0015.outro', '!sem-login', '00000000-0000-4000-8000-0000000000a2', NULL, now());

-- A. a coluna e a chave estrangeira
SELECT pg_temp.espera('usuario.terminal_id existe e aceita nulo',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuario' AND column_name = 'terminal_id' AND is_nullable = 'YES'));
SELECT pg_temp.espera_erro('terminal inexistente é recusado', $q$UPDATE usuario SET terminal_id = gen_random_uuid() WHERE login = 't0015.livre'$q$, 'usuario_terminal_id_fkey');
SELECT pg_temp.espera('índice na chave estrangeira', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'usuario_terminal_id_idx'));

-- B. quem tem terminal só abre caixa nele
SELECT pg_temp.espera_erro('com terminal fixo, abrir em outro é recusado',
  $q$INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000f0011', 0)$q$, 'TERMINAL_DO_USUARIO');
SELECT pg_temp.espera('com terminal fixo, abre no dele',
  pg_temp.executa($q$INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000f0011', 0)$q$));
SELECT pg_temp.espera('sem terminal fixo, abre em qualquer um',
  pg_temp.executa($q$INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000f0012', 0)$q$));
SELECT pg_temp.espera_erro('o terminal continua um por vez (outro usuário no terminal ocupado)',
  $q$INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000f0013', 0)$q$, 'ux_caixa_aberto_por_terminal');

-- C. o terminal de um usuário não se apaga (nada se apaga; e a FK é RESTRICT)
SELECT pg_temp.espera_erro('terminal com usuário não é apagado', $q$DELETE FROM terminal WHERE id = '00000000-0000-4000-8000-0000000f0001'$q$, '');

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
