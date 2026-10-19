# Memória do projeto

Anotações de quem trabalha no código (Claude Code ou pessoa). Atualize ao terminar cada tarefa e quando descobrir algo importante. **Sem senhas, tokens nem dados pessoais.** Veja as regras no `CLAUDE.md`.

## Regras do humano (não quebrar)
- **Só codar com autorização explícita do humano.** Em 19/10/2026 eu quebrei isso duas vezes: iniciei a branch `prototipo` sem ordem (desfeita) e implementei o limite de estoque no PDV enquanto ele esperava eu tirar dúvidas. Pergunta, dúvida, relato ou "temos que consertar" não é ordem. Ver o `CLAUDE.md`.
- **Terceirizar com o agy; a palavra final é do Claude** (confere, decide, responde ao humano).
- Sem `Co-Authored-By` do Claude. O `agy` é sempre o QA.
- Ao terminar uma sprint, parar e mostrar tudo que foi feito e alterado.

## Estado atual
- Fase: protótipo, em alinhamento. Sprint 0 concluída (19/10/2026). Sprint 1 em andamento (o humano mandou começar).
- Plano e tarefas: `docs/PLANO-DE-SPRINTS.md`.
- Branch: `sprint-1-sem-offline-e-perfis` (a partir de `main`; o `main` local está 1 commit à frente do `origin`, com o plano e estes arquivos).
- Última tarefa feita: S1B-16 (Sprint 1B pronta e verificada, com análise antes e revisão do agy depois). Faltam as tarefas do CPF (S1B-17 a S1B-21), **que esperam a ordem do humano**, e a S1-19 na parte do navegador (conferir as telas de cada perfil).
- Sprint 1 foi entregue e mostrada ao humano. Não começar a Sprint 2 sem ordem.
- **Alteração sem autorização, ainda sem commit:** limite de estoque do PDV (catálogo com `saldoBazar` por categoria, botão com "N em estoque", bloqueio ao passar, aviso da quantidade, mensagem de peça no estoque de Doações; testes `smoke` 128 ok). O humano decide se mantém ou descarta.
- Regra do humano: o `agy` é sempre o QA (testar o que foi implementado e analisar as tarefas). Ver `CLAUDE.md`.

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
- Depois da remoção do offline (S1-09): `test:smoke` 109 ok, `test:reteste` 36 ok, `test:concorrencia` OK, SQL 04 23/23, SQL 07 zero divergência, 23 permissões.
- Sprint 1B completa (referência): `test:smoke` 151 ok, `test:concorrencia` 5 ok, `test:reteste` 36 ok, `test:perfis` 120 ok, SQL 04 23/23, SQL 07 sem divergência, `npm audit` 0, 24 permissões.

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
- **Pagamento (S1B-04 a S1B-06):** o operador digita o **valor recebido** em cada forma; o front calcula o valor aplicado, o que falta e o troco. A conta tira primeiro PIX, cartão e fiado, e o **dinheiro por último** (o dinheiro fecha o que sobrou e gera o troco), então a ordem das linhas não muda o resultado. O servidor exige recebido em dinheiro, PIX e cartão (`RECEBIDO_OBRIGATORIO`), dinheiro >= devido (`RECEBIDO_INSUFICIENTE`), PIX e cartão = valor (`TROCO_INVALIDO`) e recusa recebido no fiado (`FIADO_COM_RECEBIDO`). O banco só guarda `valor_recebido` para dinheiro (`ck_pagamento_dinheiro`) e, pela migração 0007, **exige** recebido em dinheiro (`NOT VALID`: só vendas novas). Venda de total zero é recusada (`VENDA_SEM_VALOR`).
- **Sangria:** a fórmula da gaveta (`calcularPrevia`) já exclui o troco (soma o `valor` aplicado, não o recebido). A tela mostra o dinheiro da gaveta e bloqueia acima dele; o servidor trava a sessão (`FOR UPDATE`) e também recusa. Duas sangrias simultâneas: uma passa, a outra leva `SANGRIA_ACIMA_SALDO` (testado em `concorrencia.ts`).
- **Linha do tempo do caixa:** `GET /caixas/:id/linha-do-tempo` e `GET /caixas/:id/fechamento.pdf` (pdfkit). Operador vê o próprio caixa; quem tem `relatorios.consultar` vê qualquer um. Cancelamento ou estorno **depois** do fechamento aparece na linha do tempo mas **não mexe na gaveta já conferida** (o reembolso saiu pelo financeiro), e `calcularPrevia` de um caixa fechado ainda conta a venda cancelada depois do fechamento.
- **Administrador abre caixa** (migração 0006, decisão do humano em 19/10/2026): ele tem todas as permissões. Consequência: ele também pode vender, dar desconto (limite 100% no perfil) e cancelar as próprias vendas, sem segundo aprovador; o agy apontou, o humano decidiu assim.
- **PDV:** catálogo traz `saldoBazar` por categoria; o PDV bloqueia e avisa a quantidade; ✕ pergunta quantas unidades tirar; Esc tira uma unidade da última linha e só com o campo vazio; erro 409 de estoque ao finalizar recarrega o catálogo e deixa ajustar o carrinho; sangria e suprimento reaproveitam o mesmo id entre tentativas.
- **CPF (decidido, ainda não implementado):** perguntar no primeiro bip da venda (Sim/Não); validar os dígitos; aparece **inteiro** só no comprovante; fica guardado e **zera e é apagado todo mês**; o Admin define o limite por CPF; o sistema mostra o saldo do CPF. Ver `docs/PLANO-DE-SPRINTS.md` (S1B-17 a S1B-21, P-12).
- QA do agy na Sprint 1 (duas rodadas, três fatias em paralelo, 420 s de limite cada; a chamada única e grande estourou o tempo): aceitos e corrigidos o resumo financeiro que deduzia o reembolso duas vezes (agora `reembolsos` à parte e fora de `saidas`), a migração 0005 que quebraria com nome de perfil ou categoria repetido, o Financeiro com `cadastros.consultar` a mais, o carrinho sem dono e sem `vendaId` persistido (agora restaurado de forma síncrona e por usuário), o logout apagando o terminal fixo, o Vendedor caindo no Início, a rota `/admin` sem guarda e testes fracos. Recusados: preço pelo Estoquista e lotes para o Financeiro (são Sprint 3 e 5) e o Escape do PDV apagando item (já existia; vai para a Sprint 4).
- Restaurar estado guardado no aparelho: fazer na criação do estado (inicializador), nunca por `useEffect`, porque o efeito roda com o estado vazio e sobrescreve o que está salvo (e o StrictMode roda o efeito duas vezes).
- Perfis (migração `0005_perfis_e_reembolso`): Caixa virou **Vendedor** (`caixa.operar`, `clientes.gerenciar`), Triagem virou **Estoquista** (`entrada.registrar`, `estoque.consultar`, `estoque.transferir`, `cadastros.consultar`, `relatorios.estoque`) e nasceu **Financeiro** (`contas_pagar.gerenciar`, `contas_receber.receber`, `contas_receber.lancar`, `relatorios.consultar`, `relatorios.estoque`, `estoque.consultar`, `cadastros.consultar`). O **Administrador tem tudo menos `caixa.operar`**. Mesmos ids, usuários e histórico. Perfis personalizados (`padrao = false`) não são tocados.
- Nova permissão `relatorios.estoque`: dá acesso aos relatórios de estoque, descartes e transferências. Receita, vendas, fiado e prestação de contas continuam exigindo `relatorios.consultar` (checado no servidor por tipo de relatório).
- **Reembolso em dinheiro vira saída no financeiro** (decisão do humano em 19/10/2026): cancelar venda de caixa já fechado e estornar recebimento de fiado de caixa fechado criam uma conta a pagar já paga, fora do caixa, na categoria `Reembolso de venda` (`registrarReembolso` em `financeiro/reembolso.service.ts`). Isso evita exigir caixa aberto do Administrador. Caixa ainda aberto: a venda cancelada ou o recebimento estornado já saem do valor esperado, como antes.
- O menu do front esconde o item "Relatórios de estoque" de quem já tem "Relatórios" (campo `escondeSe`). A rota `/vendas` agora exige `venda.cancelar` (o Vendedor não vê "Vendas").
- Só as permissões que a Sprint 1 exige foram criadas. As demais (aprovar produto, caixas do dia, desconto no produto, imprimir etiquetas, lançar compra, ver lotes só leitura, carga inicial só do Admin, criar parceiro) entram junto com a funcionalidade, nas sprints 2 a 5.
- Migração `0004_remove_offline`: apaga a tabela `pendencia_sincronizacao`, o enum `StatusPendencia`, a permissão `sincronizacao.resolver` e o parâmetro `pdv.max_horas_sem_sync`. O trigger `tg_permissao_sem_exclusao` é desligado só dentro dessa migração para permitir o `DELETE`. As colunas `venda.numero_local` e `venda.origem_registro` e o valor `OFFLINE` do enum ficam, pelo histórico; toda venda nova é `ONLINE`.
- A hora da venda é sempre a do servidor. `VendaRequest` não aceita mais `ocorridaEm`, `origem` nem `numeroLocal`.
- `database/01_ddl_completo.sql` agora é a concatenação das migrações 0001 a 0004. `02_dml` e `03_seguranca_papeis` e `07_manutencao_rotina` foram ajustados e validados num banco criado do zero.
- O aparelho guarda só o terminal fixo e o carrinho em `localStorage`, pela camada `shared/lib/armazenamento.ts` (chaves com prefixo `bazar.`). O logout e o terminal desativado apagam tudo.
- O PDV reaproveita o mesmo id de venda entre tentativas (`vendaId` em `PdvPage`) e o zera quando o carrinho muda; assim reenviar não duplica.

## Comandos úteis
- Banco de teste limpo antes de cada rodada das baterias (a suíte troca a senha do admin): derrubar a API da porta 3100, `DROP/CREATE DATABASE bazar_proto OWNER bazar_owner`, `npm run db:deploy`, `psql -f database/03_seguranca_papeis.sql -v senha_api=...`, `npm run db:seed`, subir a API de novo.
- Rodar as baterias: `API_URL=http://127.0.0.1:3100/api/v1 ADMIN_INITIAL_PASSWORD=<senha do .env> npm run test:smoke` (e `test:concorrencia`, `test:reteste`).
- SQL de integridade: `psql -U postgres -d <banco> -f database/04_testes_0003.sql` e, como dono, `database/07_manutencao_rotina.sql`.
- O login aceita 10 tentativas por minuto (por IP). As baterias fazem muitos logins: **espere uns 65 segundos entre `smoke`, `concorrencia`/`reteste` e `perfis`**, senão o login devolve 429 e a bateria acusa "Rode o smoke antes".
- Ordem das baterias: `smoke` primeiro (define a senha do admin e cria os usuários), depois `concorrencia`, `reteste` e `perfis`.
- Captura de tela sem navegador aberto: `firefox --headless --screenshot arquivo.png --window-size=1200,800 <url>`.
- Instalar do zero sem Prisma (conferido): `01_ddl_completo.sql` (dono, banco vazio), `02_dml_dados_iniciais.sql`, `03_seguranca_papeis.sql`.

## Ambiente local
- O PostgreSQL de teste e as senhas de teste ficam só na máquina do humano e no `.env` local, que o git ignora. Não registre valores aqui.
- S1-01 feita em 19/10/2026: `npm install` e `.env` de teste criados nesta pasta (ignorados pelo git). Banco de teste `bazar_proto` no PostgreSQL temporário da porta 5544; API na 3100 e front na 5173, subidos desta pasta.

## Pendências e dúvidas
- **Armadilha de teste:** nunca encadear `reset-db.sh` num pipe (`| tail`): o servidor em segundo plano segura o cano e o comando trava. Use redirecionamento para arquivo (`> arquivo 2>&1 < /dev/null`).
- **Conferir no navegador:** as telas de cada perfil e o PDV (venda, F5 com carrinho, outro operador no mesmo aparelho) ainda não foram exercitados clicando; só a API real, o build e a tela de login.
- **Pagar conta "com dinheiro do caixa"** (sangria automática, RN-32) exige que quem paga tenha caixa aberto. Com o Financeiro e o Administrador sem `caixa.operar`, isso só funciona para um perfil personalizado que reúna as duas coisas. Decidir com o humano se a opção continua, se sai ou se muda de lugar.
- **Receber fiado no caixa** (recebimento ligado ao caixa do vendedor) também depende de uma permissão que o Vendedor padrão não tem (`contas_receber.receber`). O Financeiro recebe fora do caixa. Confirmar se o Vendedor precisa receber fiado na gaveta.
Estão na seção "Pendências abertas" de `docs/PLANO-DE-SPRINTS.md`. Anote aqui só o que surgir durante o código e ainda não estiver lá.

## Registro de trabalho
Uma linha por dia de trabalho ou por tarefa: `AAAA-MM-DD | tarefa | o que foi feito | o que ficou pendente`.

- 2026-10-19 | S0-01 a S0-08 | alinhamento concluído, plano de sprints escrito, CLAUDE.md e memoria.md criados | Sprint 1 aguardando ordem do humano
- 2026-10-19 | S1-01 | ambiente preparado nesta pasta; linha de base conferida (smoke 114, reteste 37, concorrência OK) | S1-02 em diante
- 2026-10-19 | S1-02 a S1-09 | PWA, fila offline, sincronização, operador offline e pendências removidos (front, API, banco, mocks, testes, READMEs e scripts SQL); verificado: typecheck, build, audit (0), smoke 109, reteste 36, concorrência OK, SQL 04 e 07 | S1-10 em diante. Não verificado: venda feita clicando no PDV no navegador (só a API real e a tela de login foram exercitadas)
