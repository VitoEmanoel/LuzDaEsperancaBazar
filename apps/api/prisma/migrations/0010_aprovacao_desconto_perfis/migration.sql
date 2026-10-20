-- Sprint 3: o Estoquista também aprova (não o que ele mesmo cadastrou), desconto no produto, custo e preço com permissão
-- própria, fim do ajuste de entrada e desativação de perfil. Decisões do humano (20/10/2026): P-05, P-07, P-16.
-- As migrações 0001 a 0003 não se editam: as funções mudam aqui com CREATE OR REPLACE.

-- ------------------------------------------------------------------ permissões novas
INSERT INTO "permissao" ("codigo", "modulo", "descricao") VALUES
  ('custo.consultar', 'EST', 'Ver o custo (valor atribuído) dos produtos, das entradas e dos relatórios de estoque'),
  ('produtos.preco', 'EST', 'Alterar o preço de venda do produto, com motivo'),
  ('produtos.desconto', 'EST', 'Dar e encerrar desconto no produto (percentual ou preço promocional), com motivo')
ON CONFLICT ("codigo") DO NOTHING;
-- Administrador: tudo. Estoquista: vê o custo, muda o preço e aprova (P-16). Financeiro: vê o custo e dá desconto.
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'custo.consultar'),
  ('00000000-0000-4000-8000-0000000000a1', 'produtos.preco'),
  ('00000000-0000-4000-8000-0000000000a1', 'produtos.desconto'),
  ('00000000-0000-4000-8000-0000000000a3', 'custo.consultar'),
  ('00000000-0000-4000-8000-0000000000a3', 'produtos.preco'),
  ('00000000-0000-4000-8000-0000000000a3', 'produtos.aprovar'),
  ('00000000-0000-4000-8000-0000000000a4', 'custo.consultar'),
  ('00000000-0000-4000-8000-0000000000a4', 'produtos.desconto')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------ desconto no produto (S3-09)
-- Um desconto vigente por produto: percentual (0 a 100, sem os extremos) ou preço promocional (abaixo do preço de venda).
-- A validade é opcional (P-05): sem data de fim, vale até alguém encerrar; com data, vale até o fim daquele dia (America/Fortaleza).
-- O histórico (quem deu, quem encerrou, por quê) fica na auditoria.
ALTER TABLE "produto" ADD COLUMN "desconto_tipo" VARCHAR(20),
ADD COLUMN "desconto_valor" DECIMAL(10,2),
ADD COLUMN "desconto_ate" DATE,
ADD COLUMN "desconto_motivo" TEXT,
ADD COLUMN "desconto_por_id" UUID,
ADD COLUMN "desconto_em" TIMESTAMPTZ(3);
ALTER TABLE "produto" ADD CONSTRAINT "produto_desconto_por_id_fkey" FOREIGN KEY ("desconto_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produto" ADD CONSTRAINT ck_produto_desconto CHECK (
  (desconto_tipo IS NULL AND desconto_valor IS NULL AND desconto_ate IS NULL AND desconto_motivo IS NULL AND desconto_por_id IS NULL AND desconto_em IS NULL)
  OR (desconto_tipo IN ('PERCENTUAL', 'PRECO') AND desconto_valor > 0
      AND (desconto_tipo <> 'PERCENTUAL' OR desconto_valor < 100)
      AND (desconto_tipo <> 'PRECO' OR desconto_valor < preco_venda)
      AND desconto_motivo IS NOT NULL AND length(trim(desconto_motivo)) >= 5
      AND desconto_por_id IS NOT NULL AND desconto_em IS NOT NULL)
);

-- Preço efetivo de um produto agora (com o desconto vigente). Única fonte da conta: PDV, venda, estoque e consultas usam esta função.
CREATE OR REPLACE FUNCTION fn_preco_efetivo(p_preco numeric, p_tipo text, p_valor numeric, p_ate date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_tipo IS NULL OR (p_ate IS NOT NULL AND p_ate < (now() AT TIME ZONE 'America/Fortaleza')::date) THEN p_preco
    WHEN p_tipo = 'PERCENTUAL' THEN greatest(round(p_preco * (100 - p_valor) / 100, 2), 0.01)
    ELSE least(p_valor, p_preco)
  END
$$;

-- ------------------------------------------------------------------ venda: preço de tabela e desconto do produto (S3-10, S3-11)
-- preco_unitario continua sendo o preço cobrado (já com o desconto do produto) e `desconto` o desconto manual do PDV:
-- as regras da 0002 (valor_total = quantidade * preco_unitario - desconto) e a receita não mudam.
-- preco_tabela só existe quando houve desconto do produto (vendas antigas e sem promoção ficam com NULL e 0).
ALTER TABLE "venda_item" ADD COLUMN "preco_tabela" DECIMAL(10,2),
ADD COLUMN "desconto_produto" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "venda_item" ADD CONSTRAINT ck_venda_item_desconto_produto CHECK (
  (preco_tabela IS NULL AND desconto_produto = 0)
  OR (preco_tabela > preco_unitario AND desconto_produto = quantidade * (preco_tabela - preco_unitario))
);

-- ------------------------------------------------------------------ fim do ajuste de entrada (S3-03)
-- Estoque só sobe por entrada aprovada (e estorno de venda). O tipo continua no enum para o histórico antigo.
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
  IF NEW.tipo = 'AJUSTE_ENTRADA' THEN
    PERFORM fn_falha('AJUSTE_ENTRADA_PROIBIDO', 'O estoque só sobe por entrada aprovada: o ajuste de inventário é só de saída');
  END IF;

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

  -- a ENTRADA lê o produto com trava compartilhada: uma mudança simultânea de "peça única" espera a aprovação terminar
  IF NEW.tipo = 'ENTRADA' AND v_item.produto_id IS NOT NULL THEN
    PERFORM 1 FROM produto WHERE id = v_item.produto_id FOR SHARE;
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

-- ------------------------------------------------------------------ quem aprova e quem devolve (S3-22, P-16)
-- Quem cadastrou o item não aprova nem devolve o próprio cadastro: outra pessoa confere.
-- Só o perfil Administrador pode (a carga inicial e o bazar com uma pessoa só).
ALTER TABLE "item" ADD COLUMN "devolvido_por_id" UUID;
ALTER TABLE "item" ADD CONSTRAINT "item_devolvido_por_id_fkey" FOREIGN KEY ("devolvido_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION fn_item_confere_outra_pessoa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_quem uuid;
BEGIN
  -- quem devolveu só se grava na própria devolução (não se troca depois, nem no item aprovado)
  IF TG_OP = 'UPDATE' AND NEW.devolvido_por_id IS DISTINCT FROM OLD.devolvido_por_id
     AND NOT (NEW.status = 'DEVOLVIDO' AND OLD.status <> 'DEVOLVIDO') THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'Quem devolveu o item só se registra na devolução');
  END IF;
  IF NEW.status = 'APROVADO' AND (TG_OP = 'INSERT' OR OLD.status <> 'APROVADO') THEN
    v_quem := NEW.aprovado_por_id;
  ELSIF NEW.status = 'DEVOLVIDO' AND (TG_OP = 'INSERT' OR OLD.status <> 'DEVOLVIDO') THEN
    IF NEW.devolvido_por_id IS NULL THEN PERFORM fn_falha('DEVOLUCAO_SEM_AUTOR', 'A devolução registra quem devolveu'); END IF;
    v_quem := NEW.devolvido_por_id;
  ELSE
    RETURN NEW;
  END IF;
  IF v_quem = NEW.criado_por_id
     AND (SELECT perfil_id FROM usuario WHERE id = v_quem) <> '00000000-0000-4000-8000-0000000000a1'::uuid THEN
    PERFORM fn_falha('AUTO_APROVACAO', 'Quem cadastrou o item não aprova nem devolve o próprio cadastro: outra pessoa confere');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_item_confere_outra_pessoa BEFORE INSERT OR UPDATE OF status, devolvido_por_id ON "item"
  FOR EACH ROW EXECUTE FUNCTION fn_item_confere_outra_pessoa();

-- ------------------------------------------------------------------ perfis: desativar o criado por engano (S3-20)
-- Perfil padrão não se desativa nem deixa de ser padrão; perfil com usuário ativo não se desativa;
-- usuário só fica (ou entra) num perfil ativo. Nada se apaga (tg_perfil_sem_exclusao, 0002).
CREATE OR REPLACE FUNCTION fn_perfil_regras() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.padrao <> OLD.padrao THEN PERFORM fn_falha('PERFIL_PADRAO', 'Um perfil não deixa de ser (nem passa a ser) padrão'); END IF;
  IF OLD.ativo AND NOT NEW.ativo THEN
    IF OLD.padrao THEN PERFORM fn_falha('PERFIL_PADRAO', 'Perfis padrão não são desativados'); END IF;
    IF EXISTS (SELECT 1 FROM usuario WHERE perfil_id = OLD.id AND ativo) THEN
      PERFORM fn_falha('PERFIL_EM_USO', 'Há usuário ativo com este perfil: troque o perfil dele antes de desativar');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_perfil_regras BEFORE UPDATE ON "perfil" FOR EACH ROW EXECUTE FUNCTION fn_perfil_regras();

-- Trava o perfil (FOR SHARE): criar usuário num perfil e desativar o mesmo perfil ao mesmo tempo não passam juntos.
CREATE OR REPLACE FUNCTION fn_usuario_perfil_ativo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ativo AND NOT coalesce((SELECT ativo FROM perfil WHERE id = NEW.perfil_id FOR SHARE), false) THEN
    PERFORM fn_falha('PERFIL_INATIVO', 'Usuário ativo precisa de um perfil ativo');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_usuario_perfil_ativo BEFORE INSERT OR UPDATE OF perfil_id, ativo ON "usuario"
  FOR EACH ROW EXECUTE FUNCTION fn_usuario_perfil_ativo();

-- O nome do perfil desativado fica livre para um perfil novo (o criado por engano não prende o nome certo).
DROP INDEX "perfil_nome_key";
CREATE UNIQUE INDEX "perfil_nome_ativo_key" ON "perfil" (lower("nome")) WHERE "ativo";
