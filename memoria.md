# Memória do projeto

Anotações de quem trabalha no código (Claude Code ou pessoa). Atualize ao terminar cada tarefa e quando descobrir algo importante. **Sem senhas, tokens nem dados pessoais.** Veja as regras no `CLAUDE.md`.

## Estado atual
- Fase: protótipo, em alinhamento. Sprint 0 concluída (19/10/2026). Aguardando o humano mandar começar a Sprint 1.
- Plano e tarefas: `docs/PLANO-DE-SPRINTS.md`.
- Branch: `main`, igual ao `origin/main`. Nada de código alterado desde o merge inicial.
- Última tarefa feita: S0-08 (escrever o plano).
- Próxima: S1-01.

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
- Após a Sprint 1 a contagem de testes vai mudar (sai a sincronização). Registre aqui os números novos.

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
(Anote aqui as decisões de desenho que não estão no plano: nomes de tabelas, estados, formatos de código, escolhas de biblioteca, e o motivo.)

## Comandos úteis
(Anote aqui comandos que funcionaram: subir o banco de teste, resetar o admin, rodar uma bateria só, etc.)

## Ambiente local
- O PostgreSQL de teste e as senhas de teste ficam só na máquina do humano e no `.env` local, que o git ignora. Não registre valores aqui.
- Nesta pasta ainda **não** foi feito `npm install` nem criado `.env`: faça isso na tarefa S1-01.

## Pendências e dúvidas
Estão na seção "Pendências abertas" de `docs/PLANO-DE-SPRINTS.md`. Anote aqui só o que surgir durante o código e ainda não estiver lá.

## Registro de trabalho
Uma linha por dia de trabalho ou por tarefa: `AAAA-MM-DD | tarefa | o que foi feito | o que ficou pendente`.

- 2026-10-19 | S0-01 a S0-08 | alinhamento concluído, plano de sprints escrito, CLAUDE.md e memoria.md criados | Sprint 1 aguardando ordem do humano
