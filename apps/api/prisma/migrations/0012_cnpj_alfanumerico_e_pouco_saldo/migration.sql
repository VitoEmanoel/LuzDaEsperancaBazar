-- Sprint 5: CNPJ alfanumérico (S5-01, ticket 13), o parâmetro de pouco saldo (S5-17, P-08) e o Financeiro cadastrando o
-- fornecedor da compra (S5-11). Decisões do humano (20/10/2026).

-- ------------------------------------------------------------------ CNPJ alfanumérico (IN RFB 2.229/2024)
-- Desde julho de 2026 a Receita emite CNPJ com letras: 12 caracteres de 0-9 ou A-Z e 2 dígitos verificadores.
-- O CPF continua só com dígitos. A API guarda sem pontuação e em maiúsculas; o dígito verificador é conferido por ela.
ALTER TABLE parceiro DROP CONSTRAINT ck_parceiro_documento;
ALTER TABLE parceiro ADD CONSTRAINT ck_parceiro_documento CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');
ALTER TABLE instituicao DROP CONSTRAINT ck_instituicao_cnpj;
ALTER TABLE instituicao ADD CONSTRAINT ck_instituicao_cnpj CHECK (cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

-- ------------------------------------------------------------------ pouco saldo (S5-17)
-- P-08: um valor único para todos os produtos; o dashboard do Estoque avisa quem tiver este saldo ou menos.
INSERT INTO "parametro" ("chave", "valor", "descricao") VALUES
  ('estoque.pouco_saldo', '5', 'Pouco saldo: o dashboard do Estoque avisa o produto com esta quantidade ou menos')
ON CONFLICT ("chave") DO NOTHING;

-- ------------------------------------------------------------------ Financeiro cadastra fornecedor (S5-11)
-- Quem lança a compra cria o fornecedor na hora, como o Estoquista cria o doador; editar continua só com o Admin.
UPDATE "permissao" SET "descricao" = 'Criar parceiro (doador ou fornecedor) ao registrar o lote ou a compra' WHERE "codigo" = 'parceiros.criar';
INSERT INTO "perfil_permissao" ("perfil_id", "permissao_codigo") VALUES
  ('00000000-0000-4000-8000-0000000000a4', 'parceiros.criar')
ON CONFLICT DO NOTHING;
