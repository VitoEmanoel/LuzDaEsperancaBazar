# Memória do projeto

Anotações de quem trabalha no código (Claude Code ou pessoa). Atualize ao terminar cada tarefa e quando descobrir algo importante. **Sem senhas, tokens nem dados pessoais.** As regras de trabalho estão no `CLAUDE.md`; o plano e as tarefas, em `docs/PLANO-DE-SPRINTS.md`.

## 1. Regras do humano (não quebrar)
- **Só codar com autorização explícita do humano, para aquela tarefa.** Pergunta, dúvida, relato de problema, descrição de ideia ou "temos que consertar" **não são ordem**. Eu quebrei isso duas vezes em 19/10/2026 (abri uma branch sem ordem e implementei o limite de estoque enquanto ele esperava as dúvidas). Se ele pedir para esperar, esperar. **A Sprint 2 só começa quando ele mandar.**
- **Terceirizar com o `agy`; a palavra final é do Claude** (conferir, decidir, responder ao humano). O agy é sempre o QA: testa o que foi implementado e analisa as tarefas antes de começar.
- **Acompanhar o agy até ele responder de verdade.** Chamada grande estoura o tempo (`exit=124`, sem resposta): quebrar em fatias pequenas, conferir o código de saída e **refazer a fatia que falhou**. O que ele diz é opinião: conferir cada achado nos arquivos, aceitar o que é real, recusar o resto com o motivo e contar ao humano.
- **Ao terminar uma sprint: commit e push da branch** (a ordem do humano). **Quem faz o merge é o humano**, pelo pull request. Correção depois do merge vai numa branch própria.
- **Sem `Co-Authored-By` do Claude** em commits e PRs.
- Ao fim de uma sprint, parar e mostrar tudo que foi feito e alterado.
- **Não afirmar que uma tela funciona sem tê-la usado num navegador de verdade** (ver "Teste de tela" na seção 5). Teste de API verde não prova a tela.

## 2. Estado atual (19/10/2026)
- Fase: protótipo. Sprint 0, Sprint 1 (sem offline, perfis) e Sprint 1B (regras de venda e caixa, mais o CPF) **concluídas e mergeadas no `main`** (pull request nº 1, merge `f64cdd9`). A branch antiga foi apagada.
- **Em andamento:** branch `correcao-foco-do-cpf`, que conserta o foco de todas as janelas (bug do CPF relatado pelo humano) e acrescenta os testes de tela. Verificada: typecheck, build e 25 verificações de navegador. Falta o merge do humano.
- Próxima: **Sprint 2** (produto, lote e cadastro), só com a ordem do humano.
- Pendente do humano: conferir no navegador as telas de cada perfil (S1-19) e decidir os pontos da seção 8.

## 3. Repositório, pastas e ambiente
- Repositório oficial: `VitoEmanoel/LuzDaEsperancaBazar`, remoto `origin` **via SSH** (`git@github.com:...`); o HTTPS não tem credenciais.
- Pasta de trabalho oficial: `/home/victor/Documentos/LuzDaEsperancaBazar/`. Há um clone antigo em `/home/victor/Documentos/Luz-da-Esperan-a---Bazar/` (remoto do colega): **não trabalhar nele**.
- Ambiente: Node 26.11 (o projeto pede 20.19 ou mais), PostgreSQL 18.6 (a documentação diz 16; funcionou).
- Portas desta máquina: **3000 e 5433 são de outro projeto do humano** (Docker). O sistema usa: API real na **3100**, front real na **5173**, **demonstração com API simulada na 5174**, PostgreSQL de teste na **5544** (banco `bazar_proto`, subido por TCP, fora do projeto). Os usuários da demonstração estão em `apps/web/README.md`.
- Segredos e senhas de teste ficam só no `.env` local (o git ignora). Nunca no repositório (conferido: nenhum no `main`).

## 4. Referência de testes (Sprint 1B + CPF, banco novo)
`typecheck` e `build` sem erros, `npm audit` 0 vulnerabilidades, `test:smoke` 151, `test:concorrencia` 5, `test:reteste` 36, `test:perfis` 120, `test:cpf` 37, SQL `04_testes_0003` 23 de 23, `07_manutencao_rotina` sem divergência, 24 permissões. Testes de tela no navegador (`apps/web/tests-ui/`): CPF 11 de 11 e janelas do PDV 14 de 14 (seção 5).

## 5. Como verificar
- **Banco de teste limpo antes de cada rodada** (a suíte troca a senha do admin): derrubar a API da 3100, `DROP/CREATE DATABASE`, `npm run db:deploy`, `database/03_seguranca_papeis.sql`, `npm run db:seed`, subir a API. **Nunca encadear esse script num pipe** (`| tail`): o servidor em segundo plano segura o cano e o comando trava; usar `> arquivo 2>&1 < /dev/null`.
- **Ordem das baterias:** `smoke` primeiro (define a senha do admin e cria os usuários), depois `concorrencia`, `reteste`, `perfis` e `cpf`. **Esperar ~65 s entre elas**: o login aceita 10 por minuto por IP, senão dá 429 e a bateria acusa "Rode o smoke antes".
- Variáveis: `API_URL=http://127.0.0.1:3100/api/v1` e `ADMIN_INITIAL_PASSWORD` (a do `.env`).
- SQL: `psql -U postgres -d <banco> -f database/04_testes_0003.sql` e, como dono, `database/07_manutencao_rotina.sql`. Instalação do zero sem Prisma (conferida): `01_ddl_completo.sql` (0001 a 0008), `02_dml_dados_iniciais.sql`, `03_seguranca_papeis.sql`.
- **Teste de tela (navegador de verdade).** O Playwright já deixou um Chromium em `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`. Instalar só o pacote leve de controle **numa pasta fora do projeto** (`npm i playwright-core`), lançar com `executablePath` e `--no-sandbox`, abrir a demonstração (`http://localhost:5174`, `vendedor`), conferir o foco com `document.activeElement` e tirar capturas. Foi assim que o bug do CPF foi reproduzido e provado corrigido. Os dois testes ficam em `apps/web/tests-ui/` (`cpf-ui.mjs` e `janelas-ui.mjs`, fora do build; o cabeçalho de cada um explica como rodar). **Rodar de novo sempre que mexer no `Modal`, no PDV ou em qualquer janela.** Captura simples sem navegador aberto: `firefox --headless --screenshot arquivo.png --window-size=1200,800 <url>`.

## 6. Lições e armadilhas (técnicas)
- **Janela (`Modal`): `onFechar` muda de identidade a cada render do pai.** Se ela entrar nas dependências do `useEffect`, o efeito reinicia a cada tecla e o foco volta para o primeiro botão (o ✕). O `Modal` agora guarda `onFechar` num `ref` e **respeita o `autoFocus` do React** (só leva o foco para dentro se ele ainda não estiver na janela, e nunca para o ✕). Foi o bug do CPF relatado pelo humano ("sai do campo e vai para o X").
- **O foco de uma janela tem de nascer no campo certo e nunca passar por outro botão:** se o conteúdo do corpo só aparece depois (efeito, carregamento), o `Modal` focava o primeiro botão e o primeiro número digitado se perdia. O `PagamentoModal` agora já nasce com a primeira linha de pagamento. O `Modal` só foca controles **ativos** (botão desligado não recebe foco) e, se não houver nenhum, foca a própria janela (`tabIndex={-1}`).
- **Campo com valor padrão (ex.: "1" em tirar por quantidade):** selecionar o conteúdo ao receber o foco (`onFocus` com `select()`), senão o número digitado soma ao que já está lá ("11").
- **Botão com letra sublinhada:** `<u>S</u>im` dentro de um botão `inline-flex` vira dois itens com espaço ("S im"), e o leitor de tela lê errado. Embrulhar o rótulo num único `<span>`.
- **`pg_advisory_xact_lock` devolve `void`**, que o Prisma `$queryRaw` não lê (erro 500). Usar `SELECT 1 FROM (SELECT pg_advisory_xact_lock(...)) t`.
- **Restaurar estado guardado no aparelho:** fazer no inicializador do estado, nunca por `useEffect` (o efeito roda com o estado vazio e sobrescreve o salvo; o StrictMode roda o efeito duas vezes).
- **O leitor de código digita rápido:** atalhos de tecla soltos (como S e N) precisam ignorar teclas coladas (<80 ms), repetidas e com modificador.
- Enter dentro de um campo que está num `<form>` envia o formulário de fora: capturar o Enter nos campos de janelas aninhadas.
- `#` num valor do `.env` vira comentário e trunca a senha. `ADMIN_INITIAL_PASSWORD` precisa de 12+ caracteres; o seed é idempotente. `CORS_ORIGINS` só aceita `http://localhost:5173` (abrir por `localhost`, não `127.0.0.1`).
- Socket Unix do PostgreSQL falha com caminho longo: usar TCP em `127.0.0.1`. Não usar `pkill -f` com nome que aparece no próprio comando (pode encerrar a sessão): matar pelo PID da porta (`ss -ltnp`).
- Migrações já aplicadas **não se editam** (checksum). Toda mudança de banco entra em migração nova. A `0005` e a `0006` foram editadas só antes de qualquer push.

## 7. Decisões técnicas (por área)
**Perfis e permissões** (migrações 0005 e 0006)
- Quatro perfis padrão: **Administrador** (todas as 24 permissões, **inclusive abrir caixa**), **Vendedor** (`caixa.operar`, `clientes.gerenciar`), **Estoquista** (`entrada.registrar`, `estoque.consultar`, `estoque.transferir`, `cadastros.consultar`, `relatorios.estoque`), **Financeiro** (`contas_pagar.gerenciar`, `contas_receber.receber`, `contas_receber.lancar`, `relatorios.consultar`, `relatorios.estoque`, `estoque.consultar`). O Admin cria perfis personalizados (`padrao = false`, não são tocados pelas migrações).
- Permissão `relatorios.estoque`: relatórios de estoque, descartes e transferências; receita, vendas, fiado e prestação de contas exigem `relatorios.consultar`.
- Consequência da decisão de dar caixa ao Admin: ele também pode vender, dar desconto (limite 100%) e cancelar as próprias vendas, sem segundo aprovador. O agy apontou; o humano decidiu assim e **não respondeu** se quer um freio.
- Só as permissões que a sprint exige foram criadas; as demais entram com a funcionalidade (sprints 2 a 5).

**Offline removido** (migração 0004): sem PWA, fila, sincronização, operador offline nem pendências. Hora da venda sempre do servidor. O aparelho guarda só o terminal fixo e o carrinho (`localStorage`, prefixo `bazar.`); o logout apaga o carrinho e **mantém o terminal**, e o terminal desativado apaga tudo.

**Pagamento e troco** (migração 0007)
- O operador **digita o valor recebido em cada forma**; o front calcula o aplicado, o que falta e o troco. A conta tira primeiro PIX, cartão e fiado e deixa o **dinheiro por último**, então a ordem das linhas não muda o resultado. Cada forma só aparece em uma linha.
- Servidor: recebido obrigatório em dinheiro, PIX e cartão (`RECEBIDO_OBRIGATORIO`); dinheiro >= devido (`RECEBIDO_INSUFICIENTE`); PIX e cartão = valor (`TROCO_INVALIDO`); fiado não tem recebido (`FIADO_COM_RECEBIDO`); total zero recusado (`VENDA_SEM_VALOR`). O banco guarda `valor_recebido` só para dinheiro e exige em dinheiro (`NOT VALID`: só vendas novas).
- Fiado não tem troco (decisão do humano). Recebimento de fiado em dinheiro no caixa continua sem valor recebido.

**Caixa**
- Abertura com saldo inicial digitado (pode ser 0). Sangria: a tela mostra o dinheiro da gaveta e bloqueia acima dele; o servidor também (`SANGRIA_ACIMA_SALDO`), com trava `FOR UPDATE`, e duas sangrias simultâneas só deixam uma passar. A fórmula da gaveta já exclui o troco.
- Linha do tempo (`GET /caixas/:id/linha-do-tempo`) e PDF (`GET /caixas/:id/fechamento.pdf`, pdfkit): o operador vê o próprio caixa; quem tem `relatorios.consultar` vê qualquer um. Cancelamento depois do fechamento aparece mas **não mexe na gaveta já conferida**. "Total do caixa" no PDV é o fechamento parcial.
- **Reembolso em dinheiro** de caixa fechado (cancelar venda, estornar fiado) vira **saída paga no financeiro** (categoria `Reembolso de venda`); o resumo financeiro mostra `reembolsos` à parte, fora de `saidas`.
- Tecla Esc no PDV tira uma unidade da última linha, só com o campo vazio; com texto digitado só limpa o campo.

**CPF na venda** (migração 0008)
- No **primeiro bip** da venda o PDV pergunta Sim/Não (atalhos S e N); em Sim, digita o CPF (máscara, validado pelos dígitos). O item bipado espera a resposta e volta para a caixa de leitura se a pergunta for cancelada. Carrinho restaurado depois do F5 pergunta de novo.
- O CPF fica **só na memória da tela**; aparece **inteiro só no comprovante**, **mascarado** na barra do PDV, nunca em listas, auditoria nem logs. Rotas **POST** (o CPF não vai na URL): `POST /pdv/cpf/saldo`.
- Tabela própria `venda_cpf` (a venda não guarda CPF); a API apaga os CPFs de meses anteriores no primeiro uso do mês, e o `07_manutencao_rotina.sql` também. O papel de relatórios não lê `venda_cpf`.
- O **Admin decide em Parâmetros**: `cpf.limite_mensal` (em **reais por CPF no mês**, inteiro; 0 ou em branco = sem limite) e `cpf.obrigatorio` (sim/não; com ele ligado o "Não" some e o servidor recusa venda sem CPF válido). Saldo em reais; venda cancelada devolve o saldo. Trava `pg_advisory_xact_lock` por CPF contra vendas simultâneas.

**PDV (outros):** catálogo traz `saldoBazar` por categoria; bloqueia e avisa a quantidade; avisa peça que está em Doações; ✕ do carrinho pergunta quantas unidades tirar; erro 409 de estoque ao finalizar recarrega o catálogo; mesmo id de venda e de sangria entre tentativas (reenvio não duplica).

## 8. Pendências e dúvidas
- **Conferir no navegador as telas de cada perfil** (S1-19): a janela do CPF já foi testada de verdade; falta o resto (pagamento, sangria, fechamento, perfis).
- **Admin sem freio:** pode vender, dar desconto e cancelar as próprias vendas. Perguntar ao humano de novo antes da Sprint 2.
- Esc com o campo vazio tirar uma unidade (P-13 do plano): trocar por confirmação se atrapalhar.
- Limite do CPF só em reais inteiros (R$ 2.000, R$ 5.000), por escolha.
- Sprint 2 em diante: ver `docs/PLANO-DE-SPRINTS.md` (produto de código único, aprovação pelo Admin, estoque unificado, desconto no produto, etiquetas, importação, dashboards).

## 9. Registro de trabalho
Uma linha por dia de trabalho ou por tarefa: `AAAA-MM-DD | tarefa | o que foi feito | o que ficou pendente`.

- 2026-10-19 | S0 | alinhamento concluído, plano de sprints, `CLAUDE.md` e `memoria.md` criados | —
- 2026-10-19 | S1-01 a S1-21 | offline/PWA removidos; perfis Administrador, Estoquista, Vendedor, Financeiro; reembolso como saída no financeiro; QA do agy em duas rodadas | S1-19 (telas no navegador)
- 2026-10-19 | S1B-01 a S1B-16 | valor recebido e troco obrigatórios, estoque no PDV, exclusão por quantidade, sangria limitada à gaveta, abertura com saldo, total do caixa, linha do tempo e PDF, PDV responsivo, Admin abre caixa; migrações 0006 e 0007; concorrência passou a verificar de verdade | —
- 2026-10-19 | S1B-17 a S1B-21 | CPF na venda (migração 0008, `test:cpf`, janela no PDV, limite em reais e obrigatoriedade decididos pelo Admin); bug de trava (`void`) achado pelo próprio teste e corrigido | —
- 2026-10-19 | merge | humano fez o merge no `main` (PR nº 1, `f64cdd9`); branch antiga apagada; verificado: conteúdo idêntico ao testado, sem segredos | —
- 2026-10-19 | correção do foco do CPF | humano relatou que o foco saía do campo para o ✕ e o "Sim" não respondia; causa: `onFechar` no efeito do `Modal` e `autoFocus` ignorado; corrigido em `correcao-foco-do-cpf`; provado no navegador (6 falhas no código antigo, 11 de 11 no novo) | commit, push e merge do humano
