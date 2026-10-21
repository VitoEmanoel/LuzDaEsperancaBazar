-- =====================================================================================
-- Bateria de testes da 0016 (Sprint 6, S6-19): fechamento às cegas e definitivo. O caixa fecha com diferença sem a
-- observação; a justificativa vem depois, uma vez só, só de quem fechou, só em caixa fechado com diferença; o resto do
-- caixa fechado continua sem mudar. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/smoke.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/15_testes_0016.sql
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

-- dados de teste: um terminal, quatro usuários do Vendedor e três caixas (com diferença, sem diferença e aberto)
INSERT INTO terminal (id, nome) VALUES ('00000000-0000-4000-8000-0000000f1601', 'Teste 0016');
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, atualizado_em) VALUES
  ('00000000-0000-4000-8000-0000000f1611', 'Fecha com diferença', 't0016.dif', '!sem-login', '00000000-0000-4000-8000-0000000000a2', now()),
  ('00000000-0000-4000-8000-0000000f1612', 'Outra pessoa', 't0016.outro', '!sem-login', '00000000-0000-4000-8000-0000000000a2', now()),
  ('00000000-0000-4000-8000-0000000f1613', 'Fecha sem diferença', 't0016.zero', '!sem-login', '00000000-0000-4000-8000-0000000000a2', now()),
  ('00000000-0000-4000-8000-0000000f1614', 'Caixa aberto', 't0016.aberto', '!sem-login', '00000000-0000-4000-8000-0000000000a2', now());
INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES
  ('00000000-0000-4000-8000-0000000f1621', '00000000-0000-4000-8000-0000000f1601', '00000000-0000-4000-8000-0000000f1611', 50);

-- A. fechar com diferença sem a observação (antes da 0016 o CHECK exigia a observação no fechamento)
SELECT pg_temp.espera('fecha com diferença sem observação (a justificativa vem depois)',
  pg_temp.executa($q$UPDATE caixa_sessao SET status = 'FECHADO', fechado_por_id = aberto_por_id, fechado_em = now(), valor_esperado = 50, valor_contado = 30, diferenca = -20 WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$));
SELECT pg_temp.espera_erro('a conta da diferença continua conferida no fechamento',
  $q$UPDATE caixa_sessao SET valor_contado = 31 WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'CAIXA_FECHADO');

-- os outros dois caixas no mesmo terminal (um aberto por vez)
INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES
  ('00000000-0000-4000-8000-0000000f1622', '00000000-0000-4000-8000-0000000f1601', '00000000-0000-4000-8000-0000000f1613', 10);
UPDATE caixa_sessao SET status = 'FECHADO', fechado_por_id = aberto_por_id, fechado_em = now(), valor_esperado = 10, valor_contado = 10, diferenca = 0 WHERE id = '00000000-0000-4000-8000-0000000f1622';
INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura) VALUES
  ('00000000-0000-4000-8000-0000000f1623', '00000000-0000-4000-8000-0000000f1601', '00000000-0000-4000-8000-0000000f1614', 10);

-- B. a justificativa: só de quem fechou, com texto de verdade, só em caixa fechado com diferença
SELECT pg_temp.espera('o caixa com diferença aparece como pendente (índice parcial)',
  EXISTS (SELECT 1 FROM caixa_sessao WHERE id = '00000000-0000-4000-8000-0000000f1621' AND status = 'FECHADO' AND diferenca <> 0 AND justificativa_diferenca IS NULL AND observacao IS NULL)
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'caixa_sessao_justificativa_pendente_idx'));
SELECT pg_temp.espera_erro('outra pessoa não justifica',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Faltou troco', justificada_em = now(), justificada_por_id = '00000000-0000-4000-8000-0000000f1612' WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'JUSTIFICATIVA_DE_OUTRO');
SELECT pg_temp.espera_erro('justificativa curta é recusada',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'ok', justificada_em = now(), justificada_por_id = fechado_por_id WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'ck_caixa_justificativa');
SELECT pg_temp.espera_erro('justificativa sem quem justificou é recusada (o gatilho barra antes do CHECK)',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Faltou troco no fim do dia' WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'JUSTIFICATIVA_DE_OUTRO');
SELECT pg_temp.espera_erro('justificativa sem a data é recusada',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Faltou troco no fim do dia', justificada_por_id = fechado_por_id WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'ck_caixa_justificativa');
SELECT pg_temp.espera_erro('justificar e mudar outra coisa junto é recusado',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Faltou troco no fim do dia', justificada_em = now(), justificada_por_id = fechado_por_id, valor_contado = 50, diferenca = 0 WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'CAIXA_FECHADO');
SELECT pg_temp.espera('quem fechou justifica',
  pg_temp.executa($q$UPDATE caixa_sessao SET justificativa_diferenca = 'Faltou troco no fim do dia', justificada_em = now(), justificada_por_id = fechado_por_id WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$));
SELECT pg_temp.espera_erro('segunda justificativa é recusada (uma vez só)',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Outro motivo qualquer', justificada_em = now() WHERE id = '00000000-0000-4000-8000-0000000f1621'$q$, 'JUSTIFICATIVA_JA_REGISTRADA');
SELECT pg_temp.espera_erro('caixa sem diferença não recebe justificativa',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Nada a justificar aqui', justificada_em = now(), justificada_por_id = fechado_por_id WHERE id = '00000000-0000-4000-8000-0000000f1622'$q$, 'ck_caixa_justificativa');
SELECT pg_temp.espera_erro('caixa aberto não recebe justificativa',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Antes de fechar não vale', justificada_em = now(), justificada_por_id = aberto_por_id WHERE id = '00000000-0000-4000-8000-0000000f1623'$q$, 'ck_caixa_justificativa');

-- C. o caixa fechado continua sem reabrir e a abertura continua imutável
SELECT pg_temp.espera_erro('caixa fechado não reabre',
  $q$UPDATE caixa_sessao SET status = 'ABERTO', fechado_em = NULL WHERE id = '00000000-0000-4000-8000-0000000f1622'$q$, 'CAIXA_FECHADO');
SELECT pg_temp.espera_erro('dados de abertura do caixa aberto não mudam',
  $q$UPDATE caixa_sessao SET valor_abertura = 99 WHERE id = '00000000-0000-4000-8000-0000000f1623'$q$, 'REGISTRO_IMUTAVEL');

-- D. caixa fechado com a observação antiga (como antes da 0016) já está justificado: não recebe outra
UPDATE caixa_sessao SET status = 'FECHADO', fechado_por_id = aberto_por_id, fechado_em = now(), valor_esperado = 10, valor_contado = 8, diferenca = -2, observacao = 'Faltou troco (observação antiga)' WHERE id = '00000000-0000-4000-8000-0000000f1623';
SELECT pg_temp.espera_erro('caixa com a observação antiga não recebe justificativa',
  $q$UPDATE caixa_sessao SET justificativa_diferenca = 'Outra explicação depois', justificada_em = now(), justificada_por_id = fechado_por_id WHERE id = '00000000-0000-4000-8000-0000000f1623'$q$, 'JUSTIFICATIVA_JA_REGISTRADA');

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
