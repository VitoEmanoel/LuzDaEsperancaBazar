-- =====================================================================================
-- Bateria de testes da 0012 (Sprint 5): CNPJ alfanumérico no parceiro e na instituição (S5-01) e o parâmetro de
-- pouco saldo (S5-17, P-08). O dígito verificador é conferido pela API; o banco garante o formato. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/sprint5.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/11_testes_0012.sql
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

-- A. parceiro: CPF de 11 dígitos, CNPJ de 14 com letras nos 12 primeiros e dígitos nos 2 últimos
INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 loja nova', 'LOJA', '12ABC34501DE35');
SELECT pg_temp.espera('CNPJ com letras é aceito no parceiro', EXISTS (SELECT 1 FROM parceiro WHERE documento = '12ABC34501DE35'));
INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 loja antiga', 'LOJA', '11222333000181');
SELECT pg_temp.espera('CNPJ só com números continua aceito', EXISTS (SELECT 1 FROM parceiro WHERE documento = '11222333000181'));
SELECT pg_temp.espera_erro('letra minúscula é recusada (a API guarda em maiúsculas)', $q$INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 x', 'LOJA', '12abc34501de35')$q$, 'ck_parceiro_documento');
SELECT pg_temp.espera_erro('letra nos dígitos verificadores é recusada', $q$INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 x', 'LOJA', '12ABC34501DEA5')$q$, 'ck_parceiro_documento');
SELECT pg_temp.espera_erro('pontuação é recusada (a API tira antes de gravar)', $q$INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 x', 'LOJA', '12.ABC.345/01DE-35')$q$, 'ck_parceiro_documento');
SELECT pg_temp.espera_erro('CPF com letra é recusado', $q$INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 x', 'PESSOA_FISICA', '5299822472A')$q$, 'ck_parceiro_documento');
SELECT pg_temp.espera_erro('tamanho errado é recusado', $q$INSERT INTO parceiro (id, atualizado_em, nome, tipo, documento) VALUES (gen_random_uuid(), now(), 'T0012 x', 'LOJA', '12ABC34501DE3')$q$, 'ck_parceiro_documento');

-- B. instituição: só CNPJ, com ou sem letras
UPDATE instituicao SET cnpj = '12ABC34501DE35';
SELECT pg_temp.espera('CNPJ com letras é aceito na instituição', (SELECT count(*) FROM instituicao WHERE cnpj <> '12ABC34501DE35') = 0);
SELECT pg_temp.espera_erro('CPF na instituição é recusado', $q$UPDATE instituicao SET cnpj = '52998224725'$q$, 'ck_instituicao_cnpj');
SELECT pg_temp.espera_erro('letra nos dígitos verificadores da instituição é recusada', $q$UPDATE instituicao SET cnpj = '12ABC34501DEXX'$q$, 'ck_instituicao_cnpj');

-- C. Financeiro cria o fornecedor da compra (S5-11); o Vendedor continua sem criar parceiro
SELECT pg_temp.espera('Financeiro tem parceiros.criar', EXISTS (SELECT 1 FROM perfil_permissao WHERE perfil_id = '00000000-0000-4000-8000-0000000000a4' AND permissao_codigo = 'parceiros.criar'));
SELECT pg_temp.espera('Vendedor não cria parceiro', NOT EXISTS (SELECT 1 FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id WHERE p.nome = 'Vendedor' AND p.padrao AND pp.permissao_codigo = 'parceiros.criar'));

-- D. pouco saldo (S5-17, P-08): um valor único, número, começa em 5 (o tests/sprint5.ts volta ao padrão)
SELECT pg_temp.espera('parâmetro de pouco saldo existe e vale 5', (SELECT valor FROM parametro WHERE chave = 'estoque.pouco_saldo') = '5');
INSERT INTO parametro (chave, valor, descricao) VALUES ('estoque.pouco_saldo', '99', 'x') ON CONFLICT (chave) DO NOTHING;
SELECT pg_temp.espera('reaplicar não muda o que o Admin configurou', (SELECT valor FROM parametro WHERE chave = 'estoque.pouco_saldo') = '5');

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
