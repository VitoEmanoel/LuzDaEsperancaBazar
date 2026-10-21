-- =====================================================================================
-- Bateria de testes da 0017 (Sprint 6, S6-20): troco no recebimento do fiado. Em dinheiro, o recebido é obrigatório no
-- recebimento novo e é sempre valor + troco; PIX e cartão sem recebido nem troco; os recebimentos antigos (sem o
-- recebido) continuam válidos e estornáveis; o recebido e o troco não mudam depois. Tudo em ROLLBACK.
-- Banco de TESTE (ex.: depois do tests/smoke.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/16_testes_0017.sql
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

-- dados de teste: uma pessoa que recebe, um cliente e uma conta de R$ 100,00
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, atualizado_em) VALUES
  ('00000000-0000-4000-8000-0000000f1711', 'Recebe fiado', 't0017.receb', '!sem-login', '00000000-0000-4000-8000-0000000000a4', now());
INSERT INTO cliente (id, nome, telefone, atualizado_em) VALUES
  ('00000000-0000-4000-8000-0000000f1721', 'Cliente 0017', '86900000017', now());
INSERT INTO conta_receber (id, cliente_id, descricao, valor, vencimento, criada_por_id) VALUES
  ('00000000-0000-4000-8000-0000000f1731', '00000000-0000-4000-8000-0000000f1721', 'Fiado 0017', 100, current_date + 30, '00000000-0000-4000-8000-0000000f1711');

-- A. recebimento novo
SELECT pg_temp.espera('dinheiro com recebido = valor + troco é aceito',
  pg_temp.executa($q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id, valor_recebido, troco) VALUES ('00000000-0000-4000-8000-0000000f1741', '00000000-0000-4000-8000-0000000f1731', 8, 'DINHEIRO', '00000000-0000-4000-8000-0000000f1711', 10, 2)$q$));
SELECT pg_temp.espera_erro('dinheiro novo sem o recebido é recusado',
  $q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f1731', 5, 'DINHEIRO', '00000000-0000-4000-8000-0000000f1711')$q$, 'RECEBIDO_OBRIGATORIO');
SELECT pg_temp.espera_erro('recebido menor que o valor (troco negativo) é recusado',
  $q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id, valor_recebido, troco) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f1731', 5, 'DINHEIRO', '00000000-0000-4000-8000-0000000f1711', 4, -1)$q$, 'ck_receb_troco');
SELECT pg_temp.espera_erro('troco que não fecha a conta (recebido ≠ valor + troco) é recusado',
  $q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id, valor_recebido, troco) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f1731', 5, 'DINHEIRO', '00000000-0000-4000-8000-0000000f1711', 10, 1)$q$, 'ck_receb_dinheiro');
SELECT pg_temp.espera_erro('PIX com recebido é recusado',
  $q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id, valor_recebido, troco) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f1731', 5, 'PIX', '00000000-0000-4000-8000-0000000f1711', 5, 0)$q$, 'ck_receb_dinheiro');
SELECT pg_temp.espera_erro('cartão com troco é recusado',
  $q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id, troco) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000f1731', 5, 'CARTAO_DEBITO', '00000000-0000-4000-8000-0000000f1711', 1)$q$, 'ck_receb_troco');
SELECT pg_temp.espera('PIX sem recebido nem troco é aceito',
  pg_temp.executa($q$INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id) VALUES ('00000000-0000-4000-8000-0000000f1742', '00000000-0000-4000-8000-0000000f1731', 5, 'PIX', '00000000-0000-4000-8000-0000000f1711')$q$));
SELECT pg_temp.espera('a conta abate só o valor (R$ 13,00 de R$ 8,00 + R$ 5,00, não o recebido)',
  (SELECT sum(valor) FROM recebimento WHERE conta_receber_id = '00000000-0000-4000-8000-0000000f1731' AND estornado_em IS NULL) = 13
  AND (SELECT status FROM conta_receber WHERE id = '00000000-0000-4000-8000-0000000f1731') = 'PARCIAL');

-- B. o recebido e o troco não mudam depois; o estorno continua valendo
SELECT pg_temp.espera_erro('o recebido não muda depois',
  $q$UPDATE recebimento SET valor_recebido = 20, troco = 12 WHERE id = '00000000-0000-4000-8000-0000000f1741'$q$, 'REGISTRO_IMUTAVEL');
SELECT pg_temp.espera_erro('nem junto com o estorno',
  $q$UPDATE recebimento SET estornado_em = now(), estornado_por_id = usuario_id, motivo_estorno = 'teste', valor_recebido = 8, troco = 0 WHERE id = '00000000-0000-4000-8000-0000000f1741'$q$, 'REGISTRO_IMUTAVEL');
SELECT pg_temp.espera('o estorno do recebimento com troco passa',
  pg_temp.executa($q$UPDATE recebimento SET estornado_em = now(), estornado_por_id = usuario_id, motivo_estorno = 'Lançado em duplicidade' WHERE id = '00000000-0000-4000-8000-0000000f1741'$q$));

-- C. recebimento antigo em dinheiro (de antes da 0017, sem o recebido): continua válido e estornável
ALTER TABLE recebimento DISABLE TRIGGER tg_valida_recebimento;
INSERT INTO recebimento (id, conta_receber_id, valor, forma, usuario_id) VALUES
  ('00000000-0000-4000-8000-0000000f1743', '00000000-0000-4000-8000-0000000f1731', 7, 'DINHEIRO', '00000000-0000-4000-8000-0000000f1711');
ALTER TABLE recebimento ENABLE TRIGGER tg_valida_recebimento;
SELECT pg_temp.espera('o antigo fica com o recebido nulo e troco 0 (os CHECKs aceitam)',
  EXISTS (SELECT 1 FROM recebimento WHERE id = '00000000-0000-4000-8000-0000000f1743' AND valor_recebido IS NULL AND troco = 0));
SELECT pg_temp.espera('o estorno do antigo, sem o recebido, passa',
  pg_temp.executa($q$UPDATE recebimento SET estornado_em = now(), estornado_por_id = usuario_id, motivo_estorno = 'Estorno de antigo' WHERE id = '00000000-0000-4000-8000-0000000f1743'$q$));

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
