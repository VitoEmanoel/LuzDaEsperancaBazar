-- Sprint 2: produto de código único (várias unidades), item como entrada do produto num lote e aprovação pelo Administrador.
-- Desenho em docs/arquitetura/produto-e-aprovacao.md. Decisões do humano (19/10/2026): código BZ + 6 dígitos na mesma sequência,
-- venda por categoria continua, item devolvido fica editável, nova entrada não muda o preço, doação exige parceiro (campanha opcional).
-- As migrações 0001 a 0003 não se editam: as funções e a view mudam aqui com CREATE OR REPLACE.

-- ------------------------------------------------------------------ tabela produto
CREATE TYPE "StatusItem" AS ENUM ('CADASTRADO', 'DEVOLVIDO', 'APROVADO');

CREATE TABLE "produto" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "titulo_etiqueta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria_id" UUID NOT NULL,
    "preco_venda" DECIMAL(10,2) NOT NULL,
    "peca_unica" BOOLEAN NOT NULL DEFAULT false,
    "modelo" TEXT,
    "marca" TEXT,
    "ano" INTEGER,
    "tipo" TEXT,
    "tamanho" TEXT,
    "cor" TEXT,
    "condicao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "produto_codigo_key" ON "produto"("codigo");
CREATE INDEX "produto_categoria_id_idx" ON "produto"("categoria_id");
CREATE INDEX "produto_nome_idx" ON "produto"("nome");
ALTER TABLE "produto" ADD CONSTRAINT "produto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto" ADD CONSTRAINT "produto_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "produto" ADD CONSTRAINT ck_produto_codigo CHECK (codigo ~ '^[A-Z0-9]{1,40}$');
ALTER TABLE "produto" ADD CONSTRAINT ck_produto_textos CHECK (length(trim(titulo_etiqueta)) > 0 AND length(trim(nome)) > 0);
ALTER TABLE "produto" ADD CONSTRAINT ck_produto_preco CHECK (preco_venda > 0);
ALTER TABLE "produto" ADD CONSTRAINT ck_produto_ano CHECK (ano IS NULL OR ano BETWEEN 1800 AND 2200);

-- ------------------------------------------------------------------ item vira a entrada do produto no lote
-- Itens que já existem entraram aprovados: o estado padrão das linhas antigas é APROVADO; o das novas, CADASTRADO.
ALTER TABLE "item" ADD COLUMN "produto_id" UUID,
ADD COLUMN "status" "StatusItem" NOT NULL DEFAULT 'APROVADO',
ADD COLUMN "local_destino_id" INTEGER,
ADD COLUMN "motivo_devolucao" TEXT,
ADD COLUMN "aprovado_por_id" UUID,
ADD COLUMN "aprovado_em" TIMESTAMPTZ(3);
ALTER TABLE "item" ALTER COLUMN "status" SET DEFAULT 'CADASTRADO';

-- Linhas antigas: o local é o da ENTRADA (todo item antigo tem exatamente uma) e a aprovação foi a própria triagem.
UPDATE "item" i SET "local_destino_id" = m."local_destino_id", "aprovado_por_id" = i."criado_por_id", "aprovado_em" = i."criado_em"
  FROM "movimentacao" m WHERE m."item_id" = i."id" AND m."tipo" = 'ENTRADA';
ALTER TABLE "item" ALTER COLUMN "local_destino_id" SET NOT NULL;

-- Cada peça etiquetada antiga vira um produto de peça única com o MESMO código e preço (as etiquetas impressas valem).
-- O produto antigo usa o mesmo id do item: a ligação é direta e reproduzível.
INSERT INTO "produto" ("id", "codigo", "titulo_etiqueta", "nome", "categoria_id", "preco_venda", "peca_unica", "criado_por_id", "criado_em", "atualizado_em")
SELECT i."id", i."codigo_barras", left(coalesce(nullif(trim(i."descricao"), ''), c."nome"), 40), coalesce(nullif(trim(i."descricao"), ''), c."nome"),
       i."categoria_id", i."preco_venda", true, i."criado_por_id", i."criado_em", now()
FROM "item" i JOIN "categoria" c ON c."id" = i."categoria_id"
WHERE i."tipo_controle" = 'ETIQUETADO';
UPDATE "item" SET "produto_id" = "id" WHERE "tipo_controle" = 'ETIQUETADO';

CREATE INDEX "item_produto_id_idx" ON "item"("produto_id");
CREATE INDEX "item_status_idx" ON "item"("status");
ALTER TABLE "item" ADD CONSTRAINT "item_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item" ADD CONSTRAINT "item_local_destino_id_fkey" FOREIGN KEY ("local_destino_id") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item" ADD CONSTRAINT "item_aprovado_por_id_fkey" FOREIGN KEY ("aprovado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Produto (ETIQUETADO) ou categoria. Código e preço próprios no item só nas linhas antigas.
ALTER TABLE "item" DROP CONSTRAINT ck_item_etiquetado;
ALTER TABLE "item" ADD CONSTRAINT ck_item_etiquetado CHECK (
  (tipo_controle = 'ETIQUETADO' AND produto_id IS NOT NULL)
  OR (tipo_controle = 'CATEGORIA' AND produto_id IS NULL AND codigo_barras IS NULL AND preco_venda IS NULL)
);
ALTER TABLE "item" ADD CONSTRAINT ck_item_aprovacao CHECK (
  (status = 'APROVADO' AND aprovado_por_id IS NOT NULL AND aprovado_em IS NOT NULL)
  OR (status <> 'APROVADO' AND aprovado_por_id IS NULL AND aprovado_em IS NULL)
);
ALTER TABLE "item" ADD CONSTRAINT ck_item_devolucao CHECK ((status = 'DEVOLVIDO') = (motivo_devolucao IS NOT NULL AND length(trim(motivo_devolucao)) > 0));

-- ------------------------------------------------------------------ regras no banco
-- Nada se apaga (D-09)
CREATE TRIGGER tg_produto_sem_exclusao BEFORE DELETE ON "produto" FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_exclusao();

-- Código não muda; peça única não vira produto de várias unidades (nem o contrário) depois de ter unidade aprovada.
CREATE OR REPLACE FUNCTION fn_produto_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo <> OLD.codigo OR NEW.criado_por_id <> OLD.criado_por_id OR NEW.criado_em <> OLD.criado_em THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'O código do produto não muda');
  END IF;
  IF NEW.peca_unica <> OLD.peca_unica AND EXISTS (SELECT 1 FROM item WHERE produto_id = OLD.id AND status = 'APROVADO') THEN
    PERFORM fn_falha('PECA_UNICA_IMUTAVEL', 'Produto com unidades aprovadas não muda entre peça única e várias unidades');
  END IF;
  IF NEW.peca_unica AND NOT OLD.peca_unica
     AND (SELECT count(*) > 1 OR coalesce(max(quantidade_inicial), 1) <> 1 FROM item WHERE produto_id = OLD.id) THEN
    PERFORM fn_falha('PECA_UNICA_QTD', 'Peça única tem uma entrada só, de quantidade 1');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_produto_imutavel BEFORE UPDATE ON "produto" FOR EACH ROW EXECUTE FUNCTION fn_produto_imutavel();

-- Entrada de produto: mesma categoria do produto; peça única tem uma entrada só, de 1 unidade.
-- Trava a linha do produto antes de contar: dois cadastros simultâneos da mesma peça única não passam juntos.
CREATE OR REPLACE FUNCTION fn_item_produto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prod produto%ROWTYPE;
BEGIN
  IF NEW.produto_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_prod FROM produto WHERE id = NEW.produto_id FOR UPDATE;
  IF NEW.categoria_id <> v_prod.categoria_id THEN
    PERFORM fn_falha('CATEGORIA_DO_PRODUTO', 'A entrada tem a categoria do produto');
  END IF;
  IF v_prod.peca_unica THEN
    IF NEW.quantidade_inicial <> 1 THEN PERFORM fn_falha('PECA_UNICA_QTD', 'Peça única tem quantidade 1'); END IF;
    IF EXISTS (SELECT 1 FROM item WHERE produto_id = NEW.produto_id AND id <> NEW.id) THEN
      PERFORM fn_falha('PECA_UNICA_ENTRADA', 'Peça única não recebe nova entrada');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_item_produto BEFORE INSERT OR UPDATE OF produto_id, categoria_id, quantidade_inicial ON "item"
  FOR EACH ROW EXECUTE FUNCTION fn_item_produto();

-- D-16 com estados: enquanto CADASTRADO ou DEVOLVIDO o estoquista corrige o item; aprovado, só a descrição (e o preço antigo) muda.
-- Caminhos: CADASTRADO -> DEVOLVIDO -> CADASTRADO -> APROVADO. Aprovado não volta.
CREATE OR REPLACE FUNCTION fn_item_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lote_id <> OLD.lote_id OR NEW.tipo_controle <> OLD.tipo_controle
     OR NEW.codigo_barras IS DISTINCT FROM OLD.codigo_barras OR NEW.descarte_origem_id IS DISTINCT FROM OLD.descarte_origem_id
     OR NEW.criado_por_id <> OLD.criado_por_id OR NEW.criado_em <> OLD.criado_em THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'D-16: o item não muda de lote, de tipo nem de autor');
  END IF;
  IF OLD.status = 'APROVADO' THEN
    IF NEW.status <> 'APROVADO' OR NEW.categoria_id <> OLD.categoria_id OR NEW.valor_atribuido <> OLD.valor_atribuido
       OR NEW.quantidade_inicial <> OLD.quantidade_inicial OR NEW.produto_id IS DISTINCT FROM OLD.produto_id
       OR NEW.local_destino_id <> OLD.local_destino_id OR NEW.aprovado_por_id IS DISTINCT FROM OLD.aprovado_por_id
       OR NEW.aprovado_em IS DISTINCT FROM OLD.aprovado_em OR NEW.motivo_devolucao IS NOT NULL THEN
      PERFORM fn_falha('ORIGEM_IMUTAVEL', 'D-16: depois da aprovação, só a descrição do item muda');
    END IF;
  ELSIF OLD.status = 'DEVOLVIDO' AND NEW.status = 'APROVADO' THEN
    PERFORM fn_falha('ITEM_DEVOLVIDO', 'Item devolvido precisa ser corrigido e reenviado antes da aprovação');
  END IF;
  RETURN NEW;
END $$;

-- No COMMIT: item aprovado tem a ENTRADA da quantidade inicial; item não aprovado não mexe no estoque.
CREATE OR REPLACE FUNCTION fn_item_exige_entrada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status "StatusItem"; v_qtd int;
BEGIN
  SELECT status, quantidade_inicial INTO v_status, v_qtd FROM item WHERE id = NEW.id; -- estado no fim da transação
  IF v_status = 'APROVADO' THEN
    IF NOT EXISTS (SELECT 1 FROM movimentacao WHERE item_id = NEW.id AND tipo = 'ENTRADA' AND quantidade = v_qtd) THEN
      PERFORM fn_falha('ITEM_SEM_ENTRADA', 'Item aprovado precisa da movimentação de ENTRADA com a quantidade inicial');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM movimentacao WHERE item_id = NEW.id) THEN
    PERFORM fn_falha('ITEM_NAO_APROVADO', 'O item só movimenta o estoque depois de aprovado');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER tg_item_exige_entrada ON "item";
CREATE CONSTRAINT TRIGGER tg_item_exige_entrada AFTER INSERT OR UPDATE ON "item" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_item_exige_entrada();

-- Trigger de estoque (versão da 0003) com duas mudanças: item não aprovado não movimenta,
-- e o limite de 1 unidade vale só para peça única (o estorno de produto com várias unidades devolve tudo).
CREATE OR REPLACE FUNCTION fn_valida_movimentacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item item%ROWTYPE;
  v_saldo int;
  v_total int;
  v_vi venda_item%ROWTYPE;
  v_ocorrida timestamptz;
  v_permite boolean;
BEGIN
  -- trava o item: duas baixas simultâneas do mesmo item esperam uma pela outra
  SELECT * INTO v_item FROM item WHERE id = NEW.item_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM fn_falha('ITEM_INEXISTENTE', 'Item não encontrado'); END IF;
  IF v_item.status <> 'APROVADO' THEN
    PERFORM fn_falha('ITEM_NAO_APROVADO', 'O item só movimenta o estoque depois de aprovado');
  END IF;

  IF NEW.local_origem_id IS NOT NULL THEN
    v_saldo := fn_saldo(NEW.item_id, NEW.local_origem_id);
    IF v_saldo < NEW.quantidade THEN
      PERFORM fn_falha('SALDO_INSUFICIENTE', format('RN-10: saldo insuficiente (%s disponível, %s pedido)', v_saldo, NEW.quantidade));
    END IF;
  END IF;

  IF NEW.tipo IN ('VENDA', 'ESTORNO_VENDA') THEN
    SELECT * INTO v_vi FROM venda_item WHERE id = NEW.venda_item_id;
    IF NOT FOUND OR v_vi.item_id <> NEW.item_id THEN
      PERFORM fn_falha('MOVIMENTACAO_INVALIDA', 'Movimentação de venda não corresponde ao item vendido');
    END IF;
    IF NEW.tipo = 'VENDA' THEN
      SELECT permite_venda INTO v_permite FROM local_estoque WHERE id = NEW.local_origem_id;
      IF NOT v_permite THEN PERFORM fn_falha('LOCAL_NAO_VENDE', 'RN-07: só é possível vender do estoque do bazar'); END IF;
      IF NEW.quantidade <> v_vi.quantidade THEN PERFORM fn_falha('MOVIMENTACAO_INVALIDA', 'Quantidade da baixa difere do item de venda'); END IF;
      -- RN-31: a baixa usa a hora da venda no terminal
      SELECT ocorrida_em INTO v_ocorrida FROM venda WHERE id = v_vi.venda_id;
      NEW.ocorrido_em := v_ocorrida;
    END IF;
  END IF;

  -- RN-08: peça única nunca tem mais de 1 unidade em estoque
  IF v_item.tipo_controle = 'ETIQUETADO' AND NEW.local_origem_id IS NULL
     AND coalesce((SELECT peca_unica FROM produto WHERE id = v_item.produto_id), true) THEN
    SELECT coalesce(sum(saldo), 0) INTO v_total FROM saldo_estoque WHERE item_id = NEW.item_id;
    IF v_total + NEW.quantidade > 1 THEN
      PERFORM fn_falha('ETIQUETADO_QTD', 'RN-08: peça única tem no máximo 1 unidade em estoque');
    END IF;
  END IF;

  -- aplica o saldo (item já travado acima: sem corrida entre caixas)
  IF NEW.local_origem_id IS NOT NULL THEN
    UPDATE saldo_estoque SET saldo = saldo - NEW.quantidade, atualizado_em = now()
     WHERE item_id = NEW.item_id AND local_id = NEW.local_origem_id;
  END IF;
  IF NEW.local_destino_id IS NOT NULL THEN
    INSERT INTO saldo_estoque (item_id, local_id, saldo) VALUES (NEW.item_id, NEW.local_destino_id, NEW.quantidade)
    ON CONFLICT (item_id, local_id) DO UPDATE SET saldo = saldo_estoque.saldo + EXCLUDED.saldo, atualizado_em = now();
  END IF;
  RETURN NEW;
END $$;

-- Doação exige parceiro (campanha opcional). Gatilho só na criação: lotes antigos com só campanha continuam valendo
-- (um CHECK NOT VALID seria conferido de novo em qualquer UPDATE do lote antigo, como ao encerrar a triagem).
CREATE OR REPLACE FUNCTION fn_lote_doacao_exige_parceiro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'DOACAO' AND NEW.parceiro_id IS NULL THEN
    PERFORM fn_falha('PARCEIRO_OBRIGATORIO', 'Lote de doação exige o parceiro (use "Doador não identificado" se não souber)');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_lote_doacao_exige_parceiro BEFORE INSERT ON "lote_entrada" FOR EACH ROW EXECUTE FUNCTION fn_lote_doacao_exige_parceiro();

-- ------------------------------------------------------------------ prestação de contas: só itens aprovados
-- Mesmas colunas da 0003; itens cadastrados ou devolvidos ainda não foram recebidos no estoque.
CREATE OR REPLACE VIEW vw_prestacao_contas_lote AS
SELECT l.id AS lote_id, l.numero, l.tipo AS tipo_entrada, l.parceiro_id, l.campanha_id, l.recebido_em,
  coalesce(it.aprovados, 0)::int                AS itens_aprovados,
  coalesce(de.descartados, 0)::int              AS itens_descartados,
  coalesce(it.valor, 0)::numeric(12,2)          AS valor_atribuido,
  coalesce(mv.vendidos, 0)::int                 AS itens_vendidos,
  coalesce(mv.receita, 0)::numeric(12,2)        AS receita,
  coalesce(sa.bazar, 0)::int                    AS em_estoque_bazar,
  coalesce(sa.doacoes, 0)::int                  AS em_estoque_doacoes,
  coalesce(mv.baixados, 0)::int                 AS itens_baixados,
  coalesce(mv.ajustes, 0)::int                  AS ajustes_liquidos,
  coalesce(mv.transf_doacoes, 0)::int           AS transferidos_para_doacoes
FROM lote_entrada l
LEFT JOIN LATERAL (SELECT sum(i.quantidade_inicial) AS aprovados, sum(i.quantidade_inicial * i.valor_atribuido) AS valor
                   FROM item i WHERE i.lote_id = l.id AND i.status = 'APROVADO') it ON true
LEFT JOIN LATERAL (SELECT count(*) AS descartados FROM descarte d WHERE d.lote_id = l.id AND d.revertido_em IS NULL) de ON true
LEFT JOIN LATERAL (
  SELECT sum(CASE m.tipo WHEN 'VENDA' THEN m.quantidade WHEN 'ESTORNO_VENDA' THEN -m.quantidade ELSE 0 END) AS vendidos,
         sum(CASE m.tipo WHEN 'VENDA' THEN r.receita WHEN 'ESTORNO_VENDA' THEN -r.receita ELSE 0 END)   AS receita,
         sum(m.quantidade) FILTER (WHERE m.tipo = 'BAIXA')                                                AS baixados,
         sum(CASE m.tipo WHEN 'AJUSTE_ENTRADA' THEN m.quantidade WHEN 'AJUSTE_SAIDA' THEN -m.quantidade ELSE 0 END) AS ajustes,
         sum(m.quantidade) FILTER (WHERE m.tipo = 'TRANSFERENCIA' AND m.local_destino_id = 2)             AS transf_doacoes
  FROM item i JOIN movimentacao m ON m.item_id = i.id
  LEFT JOIN vw_venda_item_receita r ON r.venda_item_id = m.venda_item_id
  WHERE i.lote_id = l.id) mv ON true
LEFT JOIN LATERAL (SELECT sum(s.saldo) FILTER (WHERE s.local_id = 1) AS bazar, sum(s.saldo) FILTER (WHERE s.local_id = 2) AS doacoes
                   FROM item i JOIN saldo_estoque s ON s.item_id = i.id WHERE i.lote_id = l.id) sa ON true;

-- ------------------------------------------------------------------ permissões
-- Aprovar produtos: só o Administrador. Criar parceiro (sem editar nem desativar): Estoquista, no cadastro do lote.
INSERT INTO "permissao" ("codigo", "modulo", "descricao") VALUES
  ('produtos.aprovar', 'ENT', 'Aprovar ou devolver os produtos cadastrados nos lotes'),
  ('parceiros.criar', 'CAD', 'Criar parceiro (doador) ao registrar o lote')
ON CONFLICT ("codigo") DO NOTHING;
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'produtos.aprovar'),
  ('00000000-0000-4000-8000-0000000000a1', 'parceiros.criar'),
  ('00000000-0000-4000-8000-0000000000a3', 'parceiros.criar')
ON CONFLICT DO NOTHING;

-- Papel da API (sem DELETE) e de relatórios: a tabela nova entra como as outras (o 03_seguranca_papeis.sql também cobre).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazar_api') THEN
    GRANT SELECT, INSERT, UPDATE ON "produto" TO bazar_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazar_relatorio') THEN
    GRANT SELECT ON "produto" TO bazar_relatorio;
  END IF;
END $$;
