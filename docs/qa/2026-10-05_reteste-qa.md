# QA — Reteste de integração após a reestruturação (05/10/2026)

**Veredito: [REPROVADO]**

Escopo: monorepo `apps/web` + `apps/api` + `database/`, cruzado com 02 (Requisitos), 03 (Critérios de Aceite) e com os 12 tickets do QA de 01/10.

A reestruturação não quebrou nada: front, back e banco continuam integrados. O motivo da reprovação é outro: **nenhum dos 12 tickets de 01/10 foi corrigido.** A própria nota de arquitetura confirma que nenhuma regra de negócio mudou.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run typecheck` (web + api) e `vite build` | 0 erros; bundle sem mocks |
| Migrações 0001→0003 em PostgreSQL 16 limpo × `database/01_ddl_completo.sql` | esquemas idênticos (diff do pg_dump = 0) |
| `schema.prisma` × banco (277 campos mapeados) | 0 colunas ausentes |
| `03_seguranca_papeis.sql` + seed + API rodando como `bazar_api` | OK |
| `tests/smoke.ts` | 114 ok / 0 falha |
| `tests/concorrencia.ts` | 1 venda só da última peça; saldo ≥ 0; IDOR → 403 |
| `database/04_testes_0003.sql` (com papel da API) | 28 ok / 0 falha |
| `database/07_manutencao_rotina.sql` | 0 divergências |
| Contrato de rotas: chamadas `http.*` do web × rotas da API | 78 chamadas, todas existem no back (as 6 rotas genéricas de cadastro batem com `DEFINICOES`) |
| `npm audit` | 0 vulnerabilidades |

Na API real, confirmei 3 defeitos: categoria por categoria sem preço → **201** (R$ 0,00); CNPJ `11111111111111` → **201**; PATCH no parceiro especial com o mesmo nome → **409**. Os outros nove foram confirmados lendo o código atual.

## Tickets de correção (todos reabertos, com os caminhos novos)

### Ticket 1 — Recebimento de fiado gravado sempre como DINHEIRO · Prioridade alta (bloqueia o piloto)
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: `apps/web/src/features/financeiro/pages/ContasReceberPage.tsx:77` envia `{ id, valor, caixaId }` sem `forma`, e o back usa `DINHEIRO` como padrão (`financeiro.routes.ts:186`). Um fiado pago por PIX ou cartão no caixa entra no dinheiro esperado, e o fechamento mostra uma sobra que não existe. Em `ContasPagarPage.tsx:89`, todo pagamento fora do caixa é gravado como `PIX` (`financeiro.routes.ts:129`).
* [COMO CORRIGIR]: Em `features/financeiro/financeiro.api.ts`, adicionar `forma: 'DINHEIRO'|'PIX'|'CARTAO_DEBITO'|'CARTAO_CREDITO'` em `receber` e `formaPagamento?` em `pagar`. Nos dois modais, incluir um select obrigatório (padrão Dinheiro). Com "saiu do caixa" marcado, fixar DINHEIRO. O back já aceita os dois campos.

### Ticket 2 — Comprovante sem nome e CNPJ da instituição · Alta
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: `features/pdv/components/ComprovanteModal.tsx:15` tem o nome fixo no código e não mostra o CNPJ, então RF-CAD-07 e RF-PDV-08 falham. O `GET /instituicao` já está liberado para `caixa.operar`, mas o front não chama.
* [COMO CORRIGIR]: Em `features/pdv/hooks/usePdvSessao.ts`, com internet, chamar `instituicaoApi.obter()` e guardar em `KV.instituicao`. Passar o resultado para `ComprovanteModal` e para a reimpressão em `VendasPage`, com nome e CNPJ formatado. Sem internet, usar a cópia guardada.

### Ticket 3 — Categoria "vende por categoria" aceita sem preço · Alta
* [AGENTE CULPADO]: Back-end
* [DESCRIÇÃO DO ERRO]: RF-CAD-01, cenário 2. `apps/api/src/modules/cadastros/cadastros.routes.ts:34-50` e a importação (`admin/admin.routes.ts:92`) aceitam `vendaPorCategoria:true` sem `precoPadrao`. A categoria aparece no PDV a R$ 0,00 e a venda falha com `CATEGORIA_SEM_PRECO`.
* [COMO CORRIGIR]: Usar `superRefine` no criar e no atualizar: se `vendaPorCategoria` (o valor novo ou o atual) for verdadeiro, exigir `precoPadrao > 0`; senão, 400 `VALIDACAO` no campo `precoPadrao`. Na importação, registrar o erro por linha.

### Ticket 4 — CPF/CNPJ sem dígito verificador · Média
* [AGENTE CULPADO]: Back-end
* [DESCRIÇÃO DO ERRO]: `cadastros.routes.ts:60` confere só a quantidade de dígitos (RF-CAD-02, cenário 2).
* [COMO CORRIGIR]: Criar `apps/api/src/shared/documento.ts` com `cpfValido` e `cnpjValido` (módulo 11, recusando sequências repetidas) e aplicar via `.refine` em `zParceiro.documento`, com o erro no campo `documento`.

### Ticket 5 — Cadastro de parceiro sem tipo e documento · Média
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: `features/cadastros/pages/CadastrosPage.tsx:22` só tem o campo `nome`. Todo parceiro é gravado como `OUTRO` e não há onde informar CPF ou CNPJ.
* [COMO CORRIGIR]: Em `CONFIG.parceiros`, incluir `tipo` (select EMPRESA/LOJA/PESSOA_FISICA/OUTRO) e `documento` opcional (só dígitos), exibindo o erro de campo que vem do back.

### Ticket 6 — Valor atribuído não editável na triagem · Alta
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: `features/entradas/pages/TriagemPage.tsx:135` nunca envia `valorAtribuido`, então o back usa o preço de venda. Em lote de compra, a prestação de contas sai errada (RF-TRI-01, cenário 5).
* [COMO CORRIGIR]: Adicionar `valorAtribuido?: Money` em `TriagemItemRequest` (`shared/api/types.ts`) e o campo "Valor atribuído (unitário)" no `FormAprovar`: em lote de doação, vem preenchido com o preço; em lote de compra, é obrigatório.

### Ticket 7 — Relatórios de vendas e de descartes incompletos · Alta
* [AGENTE CULPADO]: Back-end
* [DESCRIÇÃO DO ERRO]: RF-REL-02: `relatorios/relatorios.routes.ts:113` (`vendas`) lista as vendas uma a uma, sem totais por dia, forma, categoria e operador, e sem bloco de canceladas. RF-REL-04: `:168` (`descartesRel`) não filtra por parceiro ou campanha e não soma por motivo.
* [COMO CORRIGIR]: Manter `RelatorioResposta` e adicionar ao `zFiltro` os campos `agrupar` (`dia|forma|categoria|operador|motivo`), `parceiroId?` e `campanhaId?`. As canceladas saem em bloco próprio. PDF, CSV e XLSX usam o mesmo filtro.

### Ticket 8 — Tela de relatórios sem os novos filtros · Média (depende do 7)
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: `features/relatorios/pages/RelatoriosPage.tsx` envia só `de`, `ate` e `modo`.
* [COMO CORRIGIR]: Incluir `agrupar`, `parceiroId` e `campanhaId` em `FiltroRelatorio` (`features/relatorios/relatorios.api.ts`) e os selects correspondentes nas abas Vendas e Descartes.

### Ticket 9 — PDV não reabre sem internet depois de recarregar a página · Alta (Must)
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: Em `features/auth/AuthContext.tsx:38`, se o refresh falhar sem rede, o operador vai para `/login`, que exige internet. O carrinho e a fila ficam presos no IndexedDB (RF-PDV-10, RNF-05).
* [COMO CORRIGIR]: No login online, salvar no IndexedDB um resumo do operador (id, nome, permissões, limite de desconto, `salvoEm`), sem o token. No bootstrap, se der `NetworkError` e houver `KV.caixaAtual` e um resumo do mesmo operador dentro de `pdv.max_horas_sem_sync`, liberar só `/pdv`. Ao reconectar, exigir refresh ou novo login antes de sincronizar. O logout continua apagando tudo.

### Ticket 10 — Parceiro "Doador não identificado" não pode ser editado · Baixa
* [AGENTE CULPADO]: Back-end
* [DESCRIÇÃO DO ERRO]: `cadastros.routes.ts:77` recusa qualquer PATCH que tenha `nome`, mesmo que ele não mude. Confirmado: 409 `PARCEIRO_ESPECIAL`.
* [COMO CORRIGIR]: Trocar a condição para `b.nome && b.nome !== atual.nome`.

### Ticket 11 — Carga inicial recusa "Doações" com acento · Média
* [AGENTE CULPADO]: Back-end
* [DESCRIÇÃO DO ERRO]: `estoque/estoque.routes.ts:225` troca `Õ` por `O` antes de comparar com `'DOAÇÕES'`. Sobra "DOAÇOES" e a linha é recusada.
* [COMO CORRIGIR]: `.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase()` antes de comparar com BAZAR/DOACOES. Aplicar o mesmo na coluna `controle`.

### Ticket 12 — Sem aviso de telefone já cadastrado · Baixa
* [AGENTE CULPADO]: Front-end
* [DESCRIÇÃO DO ERRO]: RF-CAD-04, cenário 3. `PagamentoModal.tsx:175` e `CadastrosPage.tsx:123` criam o cliente sem verificar o telefone.
* [COMO CORRIGIR]: Antes de criar, buscar pelos dígitos com `clientesApi.buscar(digitos)` (sem internet: `catalogo.clientesFiado`). Se encontrar, perguntar "É a mesma pessoa?" com as opções "Usar existente" e "Cadastrar mesmo assim", sem bloquear.

## DBA
Nenhuma correção.

## Ordem sugerida
1 → 2, 3, 6, 9 → 7 e depois 8 → 4, 5, 11 → 10, 12.

## Bem feito (mantido)
JWT HS256 com algoritmo fixado e `iss`/`aud`/`exp`; refresh com rotação e detecção de reuso; AuthZ por rota (fail secure); anti-IDOR; helmet com CSP; CORS sem `*` (validado na subida); rate limit; logs sem PII; erros RFC 9457 sem stack; saldo travado no banco; papel da API sem DELETE; Service Worker sem cache de `/api`. A reestruturação deixou a estrutura mais clara (mesmos nomes de domínio no front e no back).

## Recomendações de LGPD pendentes (não reprovam)
- O `GET /pdv/catalogo` continua copiando nome e telefone de todos os clientes ativos para cada terminal. Limitar aos clientes com fiado recente.
- O motivo da anonimização é texto livre e vai para a auditoria. Orientar na tela para não digitar dados pessoais.
