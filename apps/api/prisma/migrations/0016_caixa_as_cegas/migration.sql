-- Sprint 6, S6-19 (decisões do humano em 21/10/2026): sangria e fechamento às cegas, como no mercado, sem senha de supervisor.
-- Fechamento definitivo: a pessoa informa o contado e o caixa fecha na hora; só depois ela vê o esperado e a diferença.
-- Com diferença, a justificativa vem em seguida, uma vez só, e só de quem fechou. A observação antiga fica para o histórico.

-- Justificativa da diferença, gravada depois do fechamento
ALTER TABLE "caixa_sessao" ADD COLUMN "justificativa_diferenca" TEXT;
ALTER TABLE "caixa_sessao" ADD COLUMN "justificada_em" TIMESTAMPTZ(3);
ALTER TABLE "caixa_sessao" ADD COLUMN "justificada_por_id" UUID;
ALTER TABLE "caixa_sessao" ADD CONSTRAINT "caixa_sessao_justificada_por_id_fkey" FOREIGN KEY ("justificada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O fechamento não exige mais a observação (a justificativa vem depois): o resto da regra do fechamento continua igual (0002)
ALTER TABLE caixa_sessao DROP CONSTRAINT ck_caixa_fechamento;
ALTER TABLE caixa_sessao ADD CONSTRAINT ck_caixa_fechamento CHECK (
  (status = 'ABERTO' AND fechado_em IS NULL)
  OR (status = 'FECHADO' AND fechado_em IS NOT NULL AND fechado_por_id IS NOT NULL
      AND valor_esperado IS NOT NULL AND valor_contado IS NOT NULL AND valor_contado >= 0
      AND diferenca = valor_contado - valor_esperado)
);

-- Justificativa só em caixa fechado com diferença, com texto de verdade e as três colunas juntas
ALTER TABLE caixa_sessao ADD CONSTRAINT ck_caixa_justificativa CHECK (
  (justificativa_diferenca IS NULL AND justificada_em IS NULL AND justificada_por_id IS NULL)
  OR (status = 'FECHADO' AND diferenca <> 0 AND length(trim(justificativa_diferenca)) >= 5
      AND justificada_em IS NOT NULL AND justificada_por_id IS NOT NULL)
);

-- Caixa fechado continua sem mudar nem reabrir (0002), com UMA exceção: gravar a justificativa uma vez, por quem fechou,
-- sem mexer em mais nada. Duas gravações ao mesmo tempo: a segunda já vê a primeira (OLD preenchido) e é recusada.
-- Caixa fechado antes desta migração com a observação obrigatória da 0002 já está justificado: não recebe outra.
CREATE OR REPLACE FUNCTION fn_valida_alteracao_caixa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_resto_igual boolean;
BEGIN
  IF OLD.status = 'FECHADO' THEN
    IF OLD.justificativa_diferenca IS NOT NULL OR OLD.observacao IS NOT NULL THEN
      PERFORM fn_falha('JUSTIFICATIVA_JA_REGISTRADA', 'A justificativa deste caixa já foi registrada');
    END IF;
    v_resto_igual := (to_jsonb(NEW) - 'justificativa_diferenca' - 'justificada_em' - 'justificada_por_id')
                   = (to_jsonb(OLD) - 'justificativa_diferenca' - 'justificada_em' - 'justificada_por_id');
    IF NEW.justificativa_diferenca IS NULL OR NOT v_resto_igual THEN
      PERFORM fn_falha('CAIXA_FECHADO', 'Caixa fechado não muda nem reabre');
    END IF;
    IF NEW.justificada_por_id IS DISTINCT FROM OLD.fechado_por_id THEN
      PERFORM fn_falha('JUSTIFICATIVA_DE_OUTRO', 'Só quem fechou o caixa justifica a diferença');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.terminal_id <> OLD.terminal_id OR NEW.aberto_por_id <> OLD.aberto_por_id OR NEW.aberto_em <> OLD.aberto_em
     OR NEW.valor_abertura <> OLD.valor_abertura THEN
    PERFORM fn_falha('REGISTRO_IMUTAVEL', 'Dados de abertura do caixa não mudam');
  END IF;
  RETURN NEW;
END $$;

-- Pendências de justificativa de quem fechou (aviso no próximo acesso). Caixas fechados antes desta migração já têm a
-- observação obrigatória da 0002, então nunca ficam pendentes.
CREATE INDEX "caixa_sessao_justificativa_pendente_idx" ON "caixa_sessao"("fechado_por_id")
  WHERE status = 'FECHADO' AND diferenca <> 0 AND justificativa_diferenca IS NULL AND observacao IS NULL;
