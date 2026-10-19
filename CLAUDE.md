# Claude Code no Bazar Luz da Esperança

Sistema web do bazar beneficente (PDV, doações, estoque duplo, caixa, financeiro). Monolito React 19 + Vite (`apps/web`) e Fastify 5 + Prisma 7 + PostgreSQL (`apps/api`), TypeScript estrito. Responda e comente em português.

**Fase atual: protótipo.** Construímos e validamos com o grupo e o professor antes de escrever o documento oficial de cada tela. Não crie documentação oficial de telas antes da validação.

## Antes de tudo
1. Leia `memoria.md` (estado atual, armadilhas, ambiente).
2. Leia `docs/PLANO-DE-SPRINTS.md`: decisões fechadas, sprint atual e tarefas. É a fonte do que fazer.
3. **Só codifique quando o humano mandar** ("pode começar"). Analisar, ler e propor não precisa de ordem; alterar arquivos sim.

## O que ler, e quando
| Para quê | Leia |
|---|---|
| Rodar o projeto | `README.md` |
| Regras de negócio, perfis, fluxos, segurança | `docs/README_MVP.md` (só a seção que precisa) |
| Trabalhar no front | `apps/web/README.md` |
| Trabalhar na API | `apps/api/README.md` |
| Mexer no banco | `database/README.md` e `apps/api/prisma/schema.prisma` |
| Identidade visual | `docs/marca/identidade-visual.md` |
| Entender decisão de estrutura | `docs/arquitetura/reestruturacao-2026-10.md` |

## O que NÃO ler
- `node_modules/`, `dist/`, `package-lock.json`, `apps/api/src/generated/` (gerado pelo Prisma), `uploads/`.
- `Claude outputs/` e `docs/marca/*.pptx` (binários; o conteúdo útil já está em `docs/README_MVP.md` e em `identidade-visual.md`).
- `docs/qa/` (tickets antigos): só para tratar um ticket específico.
- `database/05_carga_volume_teste.sql` e `06_benchmark_queries.sql`: só em teste de volume.
- Migrações em `apps/api/prisma/migrations/`: só a que você vai criar ou consultar.
- `.env*`: nunca copie valores para notas, prompts, logs ou commits.

## Onde achar as coisas
- Os domínios têm o **mesmo nome no front e no back**: `apps/web/src/features/<domínio>` e `apps/api/src/modules/<domínio>` (acesso/auth, pdv, caixa, entradas, estoque, financeiro, relatorios, cadastros, admin, fiscal). Código comum em `shared/`.
- Rotas e telas do front: `apps/web/src/app/App.tsx`; menu: `apps/web/src/app/layout/AppLayout.tsx`.
- Permissões: `apps/api/src/shared/permissoes.ts` (lista fixa) e o tipo `Permissao` em `apps/web/src/shared/api/types.ts`.
- Toda rota da API declara `config.acesso`; rota sem regra não sobe.
- Modelo de dados: `apps/api/prisma/schema.prisma`; SQL do DBA em `database/`.
- Testes: `apps/api/tests/` (smoke, concorrencia, reteste-qa).
- API simulada do front (só em dev): `apps/web/src/mocks/`.

## Rodar
`npm install` na raiz. Front: `npm run dev:web`. API: `npm run dev:api`. Verificação: `npm run typecheck`, `npm run build`, `npm run test:smoke`, `test:concorrencia`, `test:reteste` (sempre em banco de TESTE). Detalhes e variáveis em `README.md`. Antes de subir um servidor, confira se a porta está livre (`ss -ltnp`): outros projetos desta máquina usam portas parecidas. Veja `memoria.md`.

## Regras do projeto que não se quebram
- Migrações `0001` a `0003` **não se editam** (quebra o checksum). Toda mudança de banco entra em migração nova.
- Ninguém escreve em `saldo_estoque`: toda mudança de estoque é uma linha em `movimentacao`, e o trigger aplica o saldo. Estoque só sobe por entrada e aprovação, nunca por edição livre.
- Regras críticas valem no servidor **e** no banco. O front só esconde menus; quem decide é a API.
- O servidor recalcula preço, desconto, total e troco. O front nunca manda valor como verdade.
- Papel de banco da API sem `DELETE`. Nada se apaga, só se desativa.
- Entrada validada com Zod (lista branca de campos). SQL sempre parametrizado.
- Erros no padrão RFC 9457, sem stack trace. Sem dado pessoal em log, URL ou auditoria.
- Segredos só por variável de ambiente.
- Idempotência por UUID gerado no cliente em venda, transferência e recebimento.
- Cada perfil vê só o que é dele, nem mais, nem menos. Teste o 403 dos perfis que não devem acessar.

## Como trabalhar
- Uma tarefa do plano por vez, na ordem. Marque `- [x]` em `docs/PLANO-DE-SPRINTS.md` **só** quando a tarefa estiver pronta **e** verificada (definição de pronto no próprio plano).
- **Teste verde não basta.** Execute o sistema de verdade (caminho feliz, entrada inválida, cada perfil afetado) e mostre a saída. O que não foi executado é "não verificado".
- Siga o estilo do código vizinho: nomes, comentários e idioma. Sem refatorar o que não foi pedido.
- Commits pequenos, um por tarefa ou grupo coeso, com mensagem clara. **Não inclua `Co-Authored-By: Claude` nem "Generated with Claude Code"** em commits ou PRs.
- Não faça `push`, `--force`, apagar branch ou arquivo sem o humano pedir. Não use `--dangerously-skip-permissions`.
- Banco de produção ou de dados reais: nunca. Teste só em banco de teste.
- **O `agy` é sempre o QA** (regra do humano, 19/10/2026): depois de implementar uma funcionalidade, peça ao `agy` para testá-la e revisá-la; antes de começar uma sprint ou tarefa, peça a ele para analisar as tarefas. Chame como a skill `orquestracao-de-agentes` do cérebro manda: modo `plan` (só leitura), prompt em **uma linha**, dizendo que ele **não deve executar comandos de terminal**, com `--add-dir` do projeto, e informando os resultados dos testes que você já rodou. Faça commit local antes da chamada. O que o `agy` disser é opinião: confira cada achado nos arquivos antes de aceitar e diga ao humano o que aceitou e o que recusou.
- Em dúvida de produto, pergunte ao humano; não decida regra de negócio sozinho.

## Memória
Anote em `memoria.md` o que for importante enquanto trabalha: decisões técnicas, armadilhas, comandos que funcionaram, estado da sprint, o que ficou pela metade. Atualize ao terminar cada tarefa. Sem senhas, tokens nem dados pessoais.

## O cérebro (consulte quando ajudar)
O cérebro de conhecimento do humano fica em `/home/victor/Documentos/AI-brain`. **Não leia tudo**: abra `00-INDEX.md` e vá só no que ajuda.
- Skills úteis em `skills/<nome>/SKILL.md`: `nova-feature`, `criar-modulo-com-testes`, `modelagem-de-dados`, `estrategia-de-testes`, `seguranca-e-lgpd`, `design-de-interface`, `api-web-mobile`, `git-e-integracao-continua`, `corrigir-bug`, `revisar-clean-code`, `orquestracao-de-agentes`, `planejamento-e-backlog`, `documentar`.
- Lições em `05-Licoes/INDEX.md` (por exemplo, `teste-verde-nao-prova-o-sistema`).
- O cérebro é só leitura aqui. Se achar algo reutilizável que valha registrar lá, **proponha ao humano**; não edite o cérebro por conta própria.
