-- Sprint 6, S6-20 (P-11, decisão do humano em 21/10/2026): recebimento do fiado em dinheiro informa o valor recebido e
-- mostra o troco, como na venda. Só o valor da dívida entra no caixa e na conta; o troco é informativo.
-- Mesmo desenho da venda (0001/0007): o recebido só existe em dinheiro e é o valor mais o troco.

ALTER TABLE "recebimento" ADD COLUMN "valor_recebido" DECIMAL(10,2);
ALTER TABLE "recebimento" ADD COLUMN "troco" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Troco só em dinheiro; o recebido só em dinheiro e sempre igual a valor + troco (logo, nunca menor que o valor).
-- Os recebimentos antigos ficam com o recebido nulo e troco 0, e continuam válidos.
ALTER TABLE recebimento ADD CONSTRAINT ck_receb_troco CHECK (troco >= 0 AND (troco = 0 OR forma = 'DINHEIRO'));
ALTER TABLE recebimento ADD CONSTRAINT ck_receb_dinheiro CHECK (
  valor_recebido IS NULL OR (forma = 'DINHEIRO' AND valor_recebido = valor + troco)
);

-- O recebido é obrigatório no recebimento NOVO em dinheiro (no INSERT, não num CHECK: o estorno de um recebimento antigo,
-- sem o recebido, é um UPDATE e não pode ser barrado). O recebido e o troco não mudam depois, como o resto (RN-27).
CREATE OR REPLACE FUNCTION fn_valida_recebimento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_conta conta_receber%ROWTYPE; v_pago numeric;
BEGIN
  SELECT * INTO v_conta FROM conta_receber WHERE id = NEW.conta_receber_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF v_conta.status IN ('CANCELADA', 'QUITADA') THEN PERFORM fn_falha('CONTA_NAO_ABERTA', 'Conta não aceita recebimento'); END IF;
    IF NEW.sessao_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM caixa_sessao WHERE id = NEW.sessao_id AND status = 'ABERTO') THEN
      PERFORM fn_falha('CAIXA_FECHADO', 'Recebimento no caixa exige caixa aberto');
    END IF;
    IF NEW.forma = 'DINHEIRO' AND NEW.valor_recebido IS NULL THEN
      PERFORM fn_falha('RECEBIDO_OBRIGATORIO', 'Recebimento em dinheiro exige o valor recebido');
    END IF;
    SELECT coalesce(sum(valor), 0) INTO v_pago FROM recebimento WHERE conta_receber_id = NEW.conta_receber_id AND estornado_em IS NULL;
    IF v_pago + NEW.valor > v_conta.valor THEN
      PERFORM fn_falha('RECEBIMENTO_ACIMA_SALDO', 'RN-27: recebimentos ativos não podem passar do valor da conta');
    END IF;
  ELSE
    IF OLD.estornado_em IS NOT NULL THEN PERFORM fn_falha('ESTORNO_DUPLICADO', 'RN-27: recebimento já estornado'); END IF;
    IF NEW.conta_receber_id <> OLD.conta_receber_id OR NEW.valor <> OLD.valor OR NEW.forma <> OLD.forma
       OR NEW.recebido_em <> OLD.recebido_em OR NEW.sessao_id IS DISTINCT FROM OLD.sessao_id OR NEW.usuario_id <> OLD.usuario_id
       OR NEW.valor_recebido IS DISTINCT FROM OLD.valor_recebido OR NEW.troco <> OLD.troco
       OR NEW.estornado_em IS NULL THEN
      PERFORM fn_falha('REGISTRO_IMUTAVEL', 'RN-27: recebimento só pode ser estornado');
    END IF;
  END IF;
  RETURN NEW;
END $$;
