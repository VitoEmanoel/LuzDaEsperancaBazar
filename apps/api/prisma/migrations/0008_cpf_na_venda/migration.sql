-- CPF na venda (decisão do humano, 19/10/2026): aparece só no comprovante, fica guardado até o fim do mês e depois é apagado.
-- A venda NÃO guarda o CPF: ele fica numa tabela própria, que pode ser limpa sem mexer na venda.
CREATE TABLE "venda_cpf" (
    "venda_id" UUID NOT NULL,
    "cpf" CHAR(11) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "venda_cpf_pkey" PRIMARY KEY ("venda_id"),
    CONSTRAINT "venda_cpf_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ck_venda_cpf_formato" CHECK ("cpf" ~ '^[0-9]{11}$')
);
CREATE INDEX "venda_cpf_cpf_criado_em_idx" ON "venda_cpf"("cpf", "criado_em");

-- Opções do Administrador (Parâmetros)
INSERT INTO "parametro" ("chave", "valor", "descricao") VALUES
  ('cpf.limite_mensal', '0', 'Limite de compras por CPF no mês, em reais (0 = sem limite)'),
  ('cpf.obrigatorio', '0', 'CPF obrigatório na venda (1 = sim, 0 = não)')
ON CONFLICT ("chave") DO NOTHING;
