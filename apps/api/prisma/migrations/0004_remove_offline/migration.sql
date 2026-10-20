-- Sprint 1: o sistema passa a ser só web e online. Remove o que existia apenas para o PDV offline.
-- As colunas venda.numero_local e venda.origem_registro ficam (histórico); toda venda nova é ONLINE.

DROP TABLE "pendencia_sincronizacao";
DROP TYPE "StatusPendencia";

DELETE FROM "perfil_permissao" WHERE "permissao_codigo" = 'sincronizacao.resolver';

-- permissao tem trigger que bloqueia DELETE (fn_bloqueia_exclusao); desligado só neste comando.
ALTER TABLE "permissao" DISABLE TRIGGER "tg_permissao_sem_exclusao";
DELETE FROM "permissao" WHERE "codigo" = 'sincronizacao.resolver';
ALTER TABLE "permissao" ENABLE TRIGGER "tg_permissao_sem_exclusao";

DELETE FROM "parametro" WHERE "chave" = 'pdv.max_horas_sem_sync';
