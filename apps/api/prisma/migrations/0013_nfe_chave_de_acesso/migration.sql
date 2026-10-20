-- Sprint 5: importação da NF-e (S5-04). A nota vira lote de COMPRA com a conta a pagar; a chave de acesso não se repete,
-- para a mesma nota não entrar duas vezes (nem com dois envios ao mesmo tempo). Decisões em P-19 e P-20 do plano.

-- ------------------------------------------------------------------ chave de acesso da NF-e
-- 44 caracteres: com o CNPJ alfanumérico (NT 2025.001) as posições 7 a 20 (o CNPJ do emitente) podem ter letras.
ALTER TABLE lote_entrada ADD COLUMN nfe_chave char(44);
ALTER TABLE lote_entrada ADD CONSTRAINT ck_lote_nfe_chave CHECK (nfe_chave IS NULL OR nfe_chave ~ '^[0-9]{6}[0-9A-Z]{14}[0-9]{24}$');
-- só lote de compra tem nota importada
ALTER TABLE lote_entrada ADD CONSTRAINT ck_lote_nfe_compra CHECK (nfe_chave IS NULL OR tipo = 'COMPRA');
CREATE UNIQUE INDEX uq_lote_nfe_chave ON lote_entrada (nfe_chave) WHERE nfe_chave IS NOT NULL;
