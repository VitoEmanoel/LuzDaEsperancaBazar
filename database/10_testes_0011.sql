-- =====================================================================================
-- Bateria de testes da 0011 (Sprint 4: etiquetas): permissão de imprimir só no Admin e no Estoquista,
-- tamanho padrão do rolo nos parâmetros e o histórico da impressão sem dado pessoal. Tudo em ROLLBACK.
-- Banco de TESTE com dados (ex.: depois do tests/sprint4.ts).
-- Uso (superusuário):  psql -v ON_ERROR_STOP=1 -f database/10_testes_0011.sql
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

-- A. permissão (S1-11 previa; P-18): Administrador e Estoquista, mais ninguém dos perfis padrão
SELECT pg_temp.espera('permissão etiquetas.imprimir existe', EXISTS (SELECT 1 FROM permissao WHERE codigo = 'etiquetas.imprimir'));
SELECT pg_temp.espera('Administrador e Estoquista imprimem', (SELECT count(*) FROM perfil_permissao WHERE permissao_codigo = 'etiquetas.imprimir'
  AND perfil_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3')) = 2);
SELECT pg_temp.espera('Vendedor e Financeiro não imprimem', NOT EXISTS (SELECT 1 FROM perfil_permissao WHERE permissao_codigo = 'etiquetas.imprimir'
  AND perfil_id IN (SELECT id FROM perfil WHERE padrao AND id NOT IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3'))));

-- B. tamanho do rolo (S4-01, P-02): existe, é número e começa em 50 x 30 mm (o tests/sprint4.ts volta ao padrão)
SELECT pg_temp.espera('largura e altura do rolo nos parâmetros', (SELECT count(*) FROM parametro WHERE chave IN ('etiqueta.largura_mm', 'etiqueta.altura_mm') AND valor ~ '^\d+$') = 2);
SELECT pg_temp.espera('padrão 50 x 30 mm', (SELECT valor FROM parametro WHERE chave = 'etiqueta.largura_mm') = '50' AND (SELECT valor FROM parametro WHERE chave = 'etiqueta.altura_mm') = '30');

-- C. histórico da impressão (S4-05): na auditoria do produto, só quantidade, preço e rolo (sem dado pessoal)
SELECT pg_temp.espera('impressão auditada no produto', EXISTS (SELECT 1 FROM auditoria WHERE acao = 'ETIQUETAS_IMPRESSAS' AND entidade = 'produto'));
SELECT pg_temp.espera('auditoria da impressão sem dado pessoal', NOT EXISTS (
  SELECT 1 FROM auditoria WHERE acao = 'ETIQUETAS_IMPRESSAS' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(depois) k) <> ARRAY['preco', 'quantidade', 'rolo']));
SELECT pg_temp.espera('quem imprimiu fica registrado', NOT EXISTS (SELECT 1 FROM auditoria WHERE acao = 'ETIQUETAS_IMPRESSAS' AND usuario_id IS NULL));

-- D. a migração roda de novo sem duplicar (ON CONFLICT)
INSERT INTO permissao (codigo, modulo, descricao) VALUES ('etiquetas.imprimir', 'EST', 'x') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO parametro (chave, valor, descricao) VALUES ('etiqueta.largura_mm', '99', 'x') ON CONFLICT (chave) DO NOTHING;
SELECT pg_temp.espera('reaplicar não muda o que o Admin configurou', (SELECT valor FROM parametro WHERE chave = 'etiqueta.largura_mm') = '50');

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
