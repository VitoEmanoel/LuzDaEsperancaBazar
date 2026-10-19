# Memória do projeto

Anotações de quem trabalha no código (Claude Code ou pessoa). Atualize ao terminar cada tarefa e quando descobrir algo importante. **Sem senhas, tokens nem dados pessoais.** Veja as regras no `CLAUDE.md`.

## Estado atual
- Fase: protótipo, em alinhamento. Sprint 0 concluída (19/10/2026). Sprint 1 em andamento (o humano mandou começar).
- Plano e tarefas: `docs/PLANO-DE-SPRINTS.md`.
- Branch: `sprint-1-sem-offline-e-perfis` (a partir de `main`; o `main` local está 1 commit à frente do `origin`, com o plano e estes arquivos).
- Última tarefa feita: S1-09 (sem offline/PWA, migração `0004_remove_offline`, testes ajustados, READMEs e scripts SQL atualizados).
- Próxima: S1-10 (migração de perfis).

## Repositório e pastas
- Repositório oficial: `VitoEmanoel/LuzDaEsperancaBazar` (remoto `origin`, via SSH).
- Pasta de trabalho oficial: `/home/victor/Documentos/LuzDaEsperancaBazar/`.
- Origem: projeto do grupo, criado por outra pessoa do grupo. O histórico inicial foi preservado.
- Existe um clone antigo em `/home/victor/Documentos/Luz-da-Esperan-a---Bazar/` (remoto do colega). **Não trabalhe nele.** Tem `node_modules` e `.env` de teste, e foi onde rodamos os testes da linha de base.

## Linha de base (19/10/2026, antes de qualquer mudança)
Rodado a partir do clone antigo, com o mesmo código:
- `npm run typecheck`, `npm run build` e `npm run audit`: sem erros e 0 vulnerabilidades.
- `test:smoke`: 114 ok. `test:reteste`: 37 ok. `test:concorrencia`: OK.
- `database/04_testes_0003.sql`: 23 de 23. `database/07_manutencao_rotina.sql`: zero divergência.
- Ambiente: Node 26.11.1 (o projeto pede 20.19 ou mais) e PostgreSQL 18.6 (a documentação diz 16; funcionou).
- Depois da remoção do offline (S1-09): `test:smoke` 109 ok, `test:reteste` 36 ok, `test:concorrencia` OK, SQL 04 23/23, SQL 07 zero divergência, 23 permissões. Sem sincronização, esses são os números de referência.

## Armadilhas já encontradas
- `#` no valor de uma variável do `.env` vira comentário e trunca a senha. Evite o caractere ou use aspas.
- `ADMIN_INITIAL_PASSWORD` precisa de pelo menos 12 caracteres. O seed é idempotente: se o admin já existe, não altera nada.
- A suíte de testes troca a senha do admin (a troca é obrigatória no primeiro acesso) e estoura o limite de tentativas de login (HTTP 429). Reiniciar a API em desenvolvimento zera o limite; para voltar a entrar, redefina a senha do admin no banco de teste.
- `CORS_ORIGINS` aceita só `http://localhost:5173`. Abra o front por `localhost`, não por `127.0.0.1`.
- Front com API real: `VITE_USE_MOCK=false` em `apps/web/.env.local` e, se a API não estiver na porta 3000, `VITE_API_PROXY=http://127.0.0.1:<porta>` ao subir o `vite`.
- As portas 3000 e 5433 desta máquina são de outro projeto do humano (em Docker). Use outra porta para a API (por exemplo `PORT=3100`) e para um PostgreSQL de teste (por exemplo 5544, por TCP).
- Socket Unix do PostgreSQL falha se o caminho do diretório for muito longo. Use TCP em `127.0.0.1`.
- Não use `pkill -f` com um nome que aparece no próprio comando do shell: pode encerrar a sessão. Prefira matar pelo PID da porta (`ss -ltnp`).
- `npm install` avisa que os scripts de instalação de argon2, esbuild e prisma não foram aprovados; mesmo assim tudo funcionou.
- Os testes (`smoke`, `concorrencia`, `reteste`) leem `API_URL` e `ADMIN_INITIAL_PASSWORD` do ambiente; o padrão aponta para a porta 3999.

## Decisões técnicas
- Migração `0004_remove_offline`: apaga a tabela `pendencia_sincronizacao`, o enum `StatusPendencia`, a permissão `sincronizacao.resolver` e o parâmetro `pdv.max_horas_sem_sync`. O trigger `tg_permissao_sem_exclusao` é desligado só dentro dessa migração para permitir o `DELETE`. As colunas `venda.numero_local` e `venda.origem_registro` e o valor `OFFLINE` do enum ficam, pelo histórico; toda venda nova é `ONLINE`.
- A hora da venda é sempre a do servidor. `VendaRequest` não aceita mais `ocorridaEm`, `origem` nem `numeroLocal`.
- `database/01_ddl_completo.sql` agora é a concatenação das migrações 0001 a 0004. `02_dml` e `03_seguranca_papeis` e `07_manutencao_rotina` foram ajustados e validados num banco criado do zero.
- O aparelho guarda só o terminal fixo e o carrinho em `localStorage`, pela camada `shared/lib/armazenamento.ts` (chaves com prefixo `bazar.`). O logout e o terminal desativado apagam tudo.
- O PDV reaproveita o mesmo id de venda entre tentativas (`vendaId` em `PdvPage`) e o zera quando o carrinho muda; assim reenviar não duplica.

## Comandos úteis
- Banco de teste limpo antes de cada rodada das baterias (a suíte troca a senha do admin): derrubar a API da porta 3100, `DROP/CREATE DATABASE bazar_proto OWNER bazar_owner`, `npm run db:deploy`, `psql -f database/03_seguranca_papeis.sql -v senha_api=...`, `npm run db:seed`, subir a API de novo.
- Rodar as baterias: `API_URL=http://127.0.0.1:3100/api/v1 ADMIN_INITIAL_PASSWORD=<senha do .env> npm run test:smoke` (e `test:concorrencia`, `test:reteste`).
- SQL de integridade: `psql -U postgres -d <banco> -f database/04_testes_0003.sql` e, como dono, `database/07_manutencao_rotina.sql`.
- Captura de tela sem navegador aberto: `firefox --headless --screenshot arquivo.png --window-size=1200,800 <url>`.
- Instalar do zero sem Prisma (conferido): `01_ddl_completo.sql` (dono, banco vazio), `02_dml_dados_iniciais.sql`, `03_seguranca_papeis.sql`.

## Ambiente local
- O PostgreSQL de teste e as senhas de teste ficam só na máquina do humano e no `.env` local, que o git ignora. Não registre valores aqui.
- S1-01 feita em 19/10/2026: `npm install` e `.env` de teste criados nesta pasta (ignorados pelo git). Banco de teste `bazar_proto` no PostgreSQL temporário da porta 5544; API na 3100 e front na 5173, subidos desta pasta.

## Pendências e dúvidas
Estão na seção "Pendências abertas" de `docs/PLANO-DE-SPRINTS.md`. Anote aqui só o que surgir durante o código e ainda não estiver lá.

## Registro de trabalho
Uma linha por dia de trabalho ou por tarefa: `AAAA-MM-DD | tarefa | o que foi feito | o que ficou pendente`.

- 2026-10-19 | S0-01 a S0-08 | alinhamento concluído, plano de sprints escrito, CLAUDE.md e memoria.md criados | Sprint 1 aguardando ordem do humano
- 2026-10-19 | S1-01 | ambiente preparado nesta pasta; linha de base conferida (smoke 114, reteste 37, concorrência OK) | S1-02 em diante
- 2026-10-19 | S1-02 a S1-09 | PWA, fila offline, sincronização, operador offline e pendências removidos (front, API, banco, mocks, testes, READMEs e scripts SQL); verificado: typecheck, build, audit (0), smoke 109, reteste 36, concorrência OK, SQL 04 e 07 | S1-10 em diante. Não verificado: venda feita clicando no PDV no navegador (só a API real e a tela de login foram exercitadas)
