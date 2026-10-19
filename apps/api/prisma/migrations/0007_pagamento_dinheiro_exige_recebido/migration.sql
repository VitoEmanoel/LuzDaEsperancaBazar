-- Defesa em profundidade: pagamento em dinheiro SEMPRE tem valor recebido (o servidor já exige; agora o banco também).
-- NOT VALID: só vale para pagamentos novos; vendas antigas (sem valor recebido) não são reescritas nem recusadas.
ALTER TABLE "venda_pagamento" ADD CONSTRAINT "ck_pagamento_dinheiro_recebido"
  CHECK ("forma" <> 'DINHEIRO' OR "valor_recebido" IS NOT NULL) NOT VALID;
