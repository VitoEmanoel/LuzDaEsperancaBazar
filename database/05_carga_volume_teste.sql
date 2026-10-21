-- =====================================================================================
-- Carga de VOLUME para teste de desempenho (RNF-04) — SOMENTE banco de TESTE.
-- Dados 100% fictícios (nenhum dado real/PII). Simula ~5 anos de operação do bazar.
-- Passa por todos os triggers/invariantes (não desliga nada), então o resultado é consistente.
-- Modelo do produto (0009 em diante): cada peça etiquetada é um PRODUTO; a entrada no lote é um ITEM que só movimenta o
-- estoque depois de APROVADO por outra pessoa (0010). Há produtos de peça única, produtos de várias unidades com mais de
-- uma entrada (PEPS na venda) e itens ainda à espera da aprovação (fila de aprovação).
-- Uso: psql -v ON_ERROR_STOP=1 -v escala=1 -f database/05_carga_volume_teste.sql   (escala 1 ≈ 130 mil movimentações)
-- =====================================================================================
\if :{?escala}
\else
  \set escala 1
\endif

DO $$
BEGIN
  IF current_database() !~ '(teste|test|perf|base|dba)' THEN
    RAISE EXCEPTION 'Recusado: carga de volume só roda em banco de teste (nome do banco precisa conter teste/test/perf)';
  END IF;
END $$;

BEGIN;
SELECT set_config('carga.escala', :'escala', true);

-- operadores fictícios só da carga, desativados (senha_hash inválido: não conseguem logar):
-- quem cadastra (Estoquista), quem aprova (outra pessoa, Administrador) e quem vende (Vendedor)
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, ativo, atualizado_em) VALUES
  ('00000000-0000-4000-8000-0000000c4a6a', 'Estoquista carga', 'carga.estoque', '!sem-login', '00000000-0000-4000-8000-0000000000a3', false, now()),
  ('00000000-0000-4000-8000-0000000c4a6b', 'Aprovador carga', 'carga.aprova', '!sem-login', '00000000-0000-4000-8000-0000000000a1', false, now()),
  ('00000000-0000-4000-8000-0000000c4a6c', 'Vendedor carga', 'carga.venda', '!sem-login', '00000000-0000-4000-8000-0000000000a2', false, now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE _cfg ON COMMIT DROP AS
SELECT current_setting('carga.escala')::int AS e,
       '00000000-0000-4000-8000-0000000c4a6a'::uuid AS u,   -- cadastra
       '00000000-0000-4000-8000-0000000c4a6b'::uuid AS a,   -- aprova
       '00000000-0000-4000-8000-0000000c4a6c'::uuid AS v,   -- vende
       now() - interval '5 years' AS inicio;

-- terminal e caixa aberto (venda só em caixa aberto)
INSERT INTO terminal (id, nome) VALUES ('00000000-0000-4000-8000-00000000c0de', 'Caixa carga') ON CONFLICT DO NOTHING;
INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura, aberto_em)
SELECT '00000000-0000-4000-8000-00000000cafe', '00000000-0000-4000-8000-00000000c0de', v, 100, inicio FROM _cfg;

-- 30 categorias (metade vendida por categoria)
INSERT INTO categoria (id, nome, preco_padrao, venda_por_categoria, atualizado_em)
SELECT gen_random_uuid(), 'Categoria carga ' || g, (5 + g)::numeric, g % 2 = 0, now() FROM generate_series(1, 30) g;

-- 50 parceiros fictícios
INSERT INTO parceiro (id, nome, tipo, atualizado_em)
SELECT gen_random_uuid(), 'Parceiro fictício ' || g, 'EMPRESA', now() FROM generate_series(1, 50) g;

-- lotes de doação ao longo de 5 anos (parceiro obrigatório, 0009)
INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
SELECT gen_random_uuid(), 'DOACAO', p.id, c.inicio + (g * interval '10 minutes'), c.u
FROM _cfg c, generate_series(1, 3000 * c.e) g
JOIN LATERAL (SELECT id FROM parceiro WHERE nome LIKE 'Parceiro fictício%' ORDER BY id OFFSET (g % 50) LIMIT 1) p ON true;

CREATE TEMP TABLE _lotes ON COMMIT DROP AS SELECT id, recebido_em, row_number() OVER (ORDER BY numero) rn FROM lote_entrada WHERE tipo = 'DOACAO' AND status = 'AGUARDANDO_TRIAGEM' AND parceiro_id IN (SELECT id FROM parceiro WHERE nome LIKE 'Parceiro fictício%');
CREATE TEMP TABLE _cats ON COMMIT DROP AS SELECT id, venda_por_categoria vpc, row_number() OVER (ORDER BY nome) rn FROM categoria WHERE nome LIKE 'Categoria carga%';

-- peças únicas: um produto por peça (código próprio, 1 unidade), uma entrada aprovada no Bazar
CREATE TEMP TABLE _etq ON COMMIT DROP AS
SELECT gen_random_uuid() id, gen_random_uuid() prod_id, l.id lote_id, l.recebido_em, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 60000 * c.e) g
JOIN _lotes l ON l.rn = 1 + (g % (3000 * (SELECT e FROM _cfg)))
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, peca_unica, criado_por_id, criado_em, atualizado_em)
SELECT e.prod_id, 'TX' || lpad(e.n::text, 7, '0'), 'Peça ' || e.n, 'Peça fictícia ' || e.n, e.cat_id, 10 + (e.n % 40), true, c.u, e.recebido_em, now()
FROM _etq e, _cfg c;
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, descricao, valor_atribuido, quantidade_inicial, local_destino_id,
                  status, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
SELECT e.id, e.lote_id, e.cat_id, 'ETIQUETADO', e.prod_id, 'Peça fictícia ' || e.n, 5, 1, 1, 'APROVADO', c.a, e.recebido_em + interval '1 hour', c.u, e.recebido_em
FROM _etq e, _cfg c;
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id, ocorrido_em)
SELECT e.id, 'ENTRADA', 1, 1, c.a, e.recebido_em + interval '1 hour' FROM _etq e, _cfg c;

-- produtos de várias unidades: 2 entradas de 10 unidades em lotes diferentes (a venda consome pelo PEPS)
CREATE TEMP TABLE _multi ON COMMIT DROP AS
SELECT gen_random_uuid() prod_id, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 2000 * c.e) g
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, peca_unica, criado_por_id, criado_em, atualizado_em)
SELECT m.prod_id, 'TM' || lpad(m.n::text, 7, '0'), 'Produto ' || m.n, 'Produto fictício ' || m.n, m.cat_id, 8 + (m.n % 20), false, c.u, c.inicio, now()
FROM _multi m, _cfg c;
CREATE TEMP TABLE _ment ON COMMIT DROP AS
SELECT gen_random_uuid() id, m.prod_id, m.cat_id, m.n, k, l.id lote_id, l.recebido_em
FROM _multi m CROSS JOIN generate_series(1, 2) k
JOIN _lotes l ON l.rn = 1 + ((m.n * 2 + k) % (3000 * (SELECT e FROM _cfg)));
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, descricao, valor_atribuido, quantidade_inicial, local_destino_id,
                  status, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
SELECT me.id, me.lote_id, me.cat_id, 'ETIQUETADO', me.prod_id, 'Produto fictício ' || me.n, 3, 10, 1, 'APROVADO', c.a, me.recebido_em + interval '1 hour', c.u, me.recebido_em
FROM _ment me, _cfg c;
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id, ocorrido_em)
SELECT me.id, 'ENTRADA', 1, 10, c.a, me.recebido_em + interval '1 hour' FROM _ment me, _cfg c;

-- itens por categoria (20 unidades), aprovados, + ENTRADA
CREATE TEMP TABLE _cat_it ON COMMIT DROP AS
SELECT gen_random_uuid() id, l.id lote_id, l.recebido_em, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 4000 * c.e) g
JOIN _lotes l ON l.rn = 1 + (g % (3000 * (SELECT e FROM _cfg)))
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, local_destino_id,
                  status, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
SELECT ci.id, ci.lote_id, ci.cat_id, 'CATEGORIA', 2, 20, 1, 'APROVADO', c.a, ci.recebido_em + interval '1 hour', c.u, ci.recebido_em
FROM _cat_it ci, _cfg c;
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id, ocorrido_em)
SELECT ci.id, 'ENTRADA', 1, 20, c.a, ci.recebido_em + interval '1 hour' FROM _cat_it ci, _cfg c;

-- fila de aprovação: produtos cadastrados nos lotes mais recentes, ainda sem aprovar (não mexem no estoque)
CREATE TEMP TABLE _fila ON COMMIT DROP AS
SELECT gen_random_uuid() id, gen_random_uuid() prod_id, l.id lote_id, l.recebido_em, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 2000 * c.e) g
JOIN _lotes l ON l.rn = (3000 * (SELECT e FROM _cfg)) - (g % 100)
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO produto (id, codigo, titulo_etiqueta, nome, categoria_id, preco_venda, peca_unica, criado_por_id, criado_em, atualizado_em)
SELECT f.prod_id, 'TF' || lpad(f.n::text, 7, '0'), 'Na fila ' || f.n, 'Produto na fila ' || f.n, f.cat_id, 15, true, c.u, f.recebido_em, now()
FROM _fila f, _cfg c;
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, produto_id, descricao, valor_atribuido, quantidade_inicial, local_destino_id, criado_por_id, criado_em)
SELECT f.id, f.lote_id, f.cat_id, 'ETIQUETADO', f.prod_id, 'Produto na fila ' || f.n, 4, 1, 1, c.u, f.recebido_em
FROM _fila f, _cfg c;

UPDATE lote_entrada SET status = 'TRIADO' WHERE id IN (SELECT id FROM _lotes) AND id NOT IN (SELECT lote_id FROM _fila);

-- 5 mil transferências bazar → doações
INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id, ocorrido_em)
SELECT e.id, 'TRANSFERENCIA', 1, 2, 1, c.u, e.recebido_em + interval '2 hours' FROM _etq e, _cfg c WHERE e.n % 12 = 0;

-- vendas de peças únicas (1 peça por venda); dinheiro sempre com o valor recebido (0007), aqui sem troco
CREATE TEMP TABLE _v ON COMMIT DROP AS
SELECT gen_random_uuid() vid, gen_random_uuid() viid, e.id item_id, (10 + (e.n % 40))::numeric preco,
       greatest(e.recebido_em + interval '1 day', (SELECT inicio FROM _cfg) + (e.n * interval '40 minutes')) quando,
       CASE WHEN e.n % 2 = 0 THEN 'DINHEIRO' ELSE 'PIX' END::"FormaPagamento" forma
FROM _etq e WHERE e.n % 12 <> 0 AND e.n % 3 <> 0;
INSERT INTO venda (id, terminal_id, sessao_id, subtotal, total, registrada_por_id, ocorrida_em)
SELECT vid, '00000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000cafe', preco, preco, c.v, quando FROM _v, _cfg c;
INSERT INTO venda_item (id, venda_id, item_id, forma_selecao, quantidade, preco_unitario, valor_total, situacao_fiscal)
SELECT viid, vid, item_id, 'CODIGO', 1, preco, preco, 'ISENTO' FROM _v;
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, venda_item_id, usuario_id)
SELECT item_id, 'VENDA', 1, 1, viid, c.v FROM _v, _cfg c;
INSERT INTO venda_pagamento (id, venda_id, forma, valor, valor_recebido)
SELECT gen_random_uuid(), vid, forma, preco, CASE WHEN forma = 'DINHEIRO' THEN preco END FROM _v;

-- vendas de produtos de várias unidades: 12 unidades em 3 vendas de 4; a terceira atravessa as duas entradas (PEPS: 2 linhas)
CREATE TEMP TABLE _vm ON COMMIT DROP AS
SELECT gen_random_uuid() vid, m.prod_id, (8 + (m.n % 20))::numeric preco, k,
       greatest((SELECT max(recebido_em) FROM _ment me WHERE me.prod_id = m.prod_id) + interval '1 day',
                (SELECT inicio FROM _cfg) + interval '3 years') + ((m.n * 3 + k) * interval '7 minutes') quando
FROM _multi m, generate_series(1, 3) k;
INSERT INTO venda (id, terminal_id, sessao_id, subtotal, total, registrada_por_id, ocorrida_em)
SELECT vid, '00000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000cafe', preco * 4, preco * 4, c.v, quando FROM _vm, _cfg c;
CREATE TEMP TABLE _vmi ON COMMIT DROP AS
SELECT gen_random_uuid() viid, vm.vid, vm.preco, x.item_id, x.q
FROM _vm vm
JOIN LATERAL (
  -- entrada mais antiga primeiro (PEPS): vendas 1 e 2 tiram 4 cada da 1ª entrada; a 3ª tira as 2 que sobram e 2 da 2ª
  SELECT me.id item_id, CASE WHEN vm.k < 3 THEN 4 ELSE 2 END q
  FROM _ment me JOIN lote_entrada l ON l.id = me.lote_id
  WHERE me.prod_id = vm.prod_id ORDER BY l.recebido_em, l.numero, me.id LIMIT CASE WHEN vm.k < 3 THEN 1 ELSE 2 END
) x ON true;
INSERT INTO venda_item (id, venda_id, item_id, forma_selecao, quantidade, preco_unitario, valor_total, situacao_fiscal)
SELECT viid, vid, item_id, 'CODIGO', q, preco, preco * q, 'ISENTO' FROM _vmi;
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, venda_item_id, usuario_id)
SELECT item_id, 'VENDA', 1, q, viid, c.v FROM _vmi, _cfg c;
INSERT INTO venda_pagamento (id, venda_id, forma, valor) SELECT gen_random_uuid(), vid, 'PIX', preco * 4 FROM _vm;

-- vendas por categoria (2 unidades de cada item por categoria, 5 vezes)
CREATE TEMP TABLE _vc ON COMMIT DROP AS
SELECT gen_random_uuid() vid, gen_random_uuid() viid, ci.id item_id, 12::numeric preco,
       greatest(ci.recebido_em + interval '1 day', (SELECT inicio FROM _cfg) + ((ci.n * 5 + k) * interval '13 minutes')) quando
FROM _cat_it ci, generate_series(1, 5) k;
INSERT INTO venda (id, terminal_id, sessao_id, subtotal, total, registrada_por_id, ocorrida_em)
SELECT vid, '00000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000cafe', preco * 2, preco * 2, c.v, quando FROM _vc, _cfg c;
INSERT INTO venda_item (id, venda_id, item_id, forma_selecao, quantidade, preco_unitario, valor_total, situacao_fiscal)
SELECT viid, vid, item_id, 'CATEGORIA', 2, preco, preco * 2, 'ISENTO' FROM _vc;
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, venda_item_id, usuario_id)
SELECT item_id, 'VENDA', 1, 2, viid, c.v FROM _vc, _cfg c;
INSERT INTO venda_pagamento (id, venda_id, forma, valor, valor_recebido) SELECT gen_random_uuid(), vid, 'DINHEIRO', preco * 2, preco * 2 FROM _vc;

COMMIT;
ANALYZE produto; ANALYZE item; ANALYZE movimentacao; ANALYZE venda; ANALYZE venda_item; ANALYZE lote_entrada;
DO $$ BEGIN IF to_regclass($q$saldo_estoque$q$) IS NOT NULL THEN EXECUTE $q$ANALYZE saldo_estoque$q$; END IF; END $$;
SELECT (SELECT count(*) FROM produto) produtos, (SELECT count(*) FROM item) itens, (SELECT count(*) FROM item WHERE status = 'CADASTRADO') na_fila,
       (SELECT count(*) FROM movimentacao) movimentacoes, (SELECT count(*) FROM venda) vendas;
