-- Sprint 6: achados da revisão do protótipo (S6-06), decisões do humano em 21/10/2026.

-- ------------------------------------------------------------------ S6-14: id de operação repetido com outro conteúdo
-- A chave de idempotência passa a guardar a impressão do pedido (sha-256 do corpo): o mesmo id com outro conteúdo
-- (ou de outro escopo ou usuário) é recusado com 409 ID_EM_USO, em vez de responder sucesso sem fazer nada.
-- Chaves antigas ficam sem impressão (NULL) e continuam valendo como antes até a limpeza de rotina.
ALTER TABLE idempotencia ADD COLUMN corpo_hash char(64);
ALTER TABLE idempotencia ADD CONSTRAINT ck_idempotencia_corpo_hash CHECK (corpo_hash IS NULL OR corpo_hash ~ '^[0-9a-f]{64}$');

-- ------------------------------------------------------------------ S6-15: Vendedor sem gerenciar clientes
-- No PDV ele continua cadastrando e buscando o cliente do fiado (POST /clientes e /clientes/busca aceitam caixa.operar),
-- mas não lista nem edita a base de clientes (nome e telefone de todos).
DELETE FROM perfil_permissao
 WHERE perfil_id = '00000000-0000-4000-8000-0000000000a2' AND permissao_codigo = 'clientes.gerenciar';

-- ------------------------------------------------------------------ S6-17: carga inicial só uma vez
-- A carga inicial entra no estoque sem passar pela aprovação: só vale na implantação. Um lote de saldo inicial, no máximo.
CREATE UNIQUE INDEX uq_lote_saldo_inicial_unico ON lote_entrada ((tipo)) WHERE tipo = 'SALDO_INICIAL';
