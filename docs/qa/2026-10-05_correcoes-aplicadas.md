# Correções do reteste de QA (05/10/2026)

Resposta ao relatório `2026-10-05_reteste-qa.md`. Os 12 tickets foram corrigidos e verificados contra
PostgreSQL 16 limpo (`database/01_ddl_completo.sql` + `03_seguranca_papeis.sql` + seed), com a API rodando
como `bazar_api`.

## Resultado das verificações

| Verificação | Resultado |
|---|---|
| `npm run typecheck` (web + api, com o cliente Prisma gerado) | 0 erros |
| `tests/smoke.ts` | 114 ok / 0 falha |
| `tests/concorrencia.ts` | 1 venda só da última peça; saldo ≥ 0; IDOR → 403 |
| **`tests/reteste-qa.ts` (novo)** | **37 ok / 0 falha** — cobre os tickets 1, 2, 3, 4, 5, 6, 7, 9 (contrato), 10 e 11 |
| `database/04_testes_0003.sql` | 0 falha |
| `database/07_manutencao_rotina.sql` | 0 divergências |
| E2E no navegador (build de produção + Service Worker) | PDV reabre sem internet após F5, venda offline vai para a fila, ao reconectar a sessão é confirmada e a fila sincroniza |
| `npm audit` | 0 vulnerabilidades |

Nenhuma migração Prisma foi alterada (o checksum do `migrate deploy` continua válido) e não houve mudança de banco.

## O que mudou, por ticket

| # | Correção | Onde |
|---|---|---|
| 1 | Seletor obrigatório de forma (padrão Dinheiro) no recebimento de fiado e no pagamento de conta; "saiu do caixa" fixa DINHEIRO. Só dinheiro entra no esperado da gaveta. `contaPagarDto` passou a devolver `formaPagamento`; o extrato mostra a forma | `features/financeiro/*`, `financeiro.routes.ts` |
| 2 | `carregarInstituicao()` busca `GET /instituicao` online e guarda cópia no IndexedDB; comprovante e reimpressão mostram nome, CNPJ formatado e endereço (offline usa a cópia) | `features/pdv/instituicao.ts`, `ComprovanteModal.tsx`, `usePdvSessao.ts`, `VendasPage.tsx` |
| 3 | Categoria vendida por categoria exige `precoPadrao > 0` no criar e no atualizar (vale o estado final); importação registra erro por linha. No front, o preço só é obrigatório quando "Vende por categoria" está marcado | `cadastros.routes.ts`, `admin.routes.ts`, `CadastrosPage.tsx` |
| 4 | `shared/documento.ts` (módulo 11, recusa sequências repetidas) aplicado em `zParceiro.documento` e na importação, com erro no campo `documento` | `apps/api/src/shared/documento.ts` |
| 5 | Formulário de parceiro com Tipo (Empresa/Loja/Pessoa física/Outro) e CPF/CNPJ opcional; erros do servidor aparecem embaixo do campo (`errosPorCampo`). A API devolve `documentoExibicao`: CNPJ formatado, CPF mascarado (LGPD) | `CadastrosPage.tsx`, `shared/api/http.ts`, `cadastros.routes.ts` |
| 6 | Campo "Valor atribuído (unitário)" na triagem: doação sugere o preço; compra exige o custo. O servidor também recusa item de compra sem `valorAtribuido` (defesa em profundidade) | `TriagemPage.tsx`, `lotes.routes.ts` |
| 7 | `zFiltro` com `agrupar` (`dia/forma/categoria/operador/motivo`), `parceiroId`, `campanhaId`. Vendas: totais por grupo (categoria usa a receita com desconto rateado, `vw_venda_item_receita`) e canceladas sempre em bloco próprio. Descartes: filtro por parceiro/campanha + quantidade por motivo. PDF/CSV/XLSX exportam o mesmo conteúdo, com totais e blocos | `relatorios.routes.ts` |
| 8 | Tela de relatórios com "Mostrar" (por dia/forma/categoria/operador/lista) em Vendas e Parceiro/Campanha/Motivo em Descartes; renderiza os blocos | `RelatoriosPage.tsx`, `relatorios.api.ts` |
| 9 | Resumo do operador no IndexedDB (id, nome, permissões, limite de desconto, `salvoEm` — sem token). Sem rede no carregamento: libera só `/pdv`, só com `caixa.operar`, só com caixa aberto pelo mesmo operador e dentro de `pdv.max_horas_sem_sync` (agora no catálogo). Ao reconectar, refresh obrigatório antes de sincronizar; se falhar, novo login sem perder carrinho nem fila. Logout e sessão expirada apagam o resumo | `features/auth/operadorOffline.ts`, `AuthContext.tsx`, `guards.tsx`, `shared/offline/sync.ts`, `caixa.service.ts` (`operadorId`), `pdv.routes.ts` |
| 10 | Só é "renomear" quando o nome muda de fato | `cadastros.routes.ts` |
| 11 | Normalização `NFD` sem diacríticos + `trim` + maiúsculas em `estoque` e `controle` | `estoque.routes.ts` |
| 12 | Antes de criar cliente, procura o mesmo telefone (online: `POST /clientes/busca`; offline: catálogo local) e pergunta "É a mesma pessoa?" com "Usar existente" / "Cadastrar mesmo assim" | `features/cadastros/telefoneDuplicado.ts`, `AvisoTelefoneDuplicado.tsx`, `PagamentoModal.tsx`, `CadastrosPage.tsx` |

## Recomendações de LGPD

- **Atendida:** o catálogo do PDV agora só leva nome e telefone de clientes com fiado em aberto, fiado nos últimos 180 dias ou cadastro nos últimos 90 dias.
- **Atendida:** a tela de anonimização orienta a não digitar dados pessoais no motivo (que vai para a auditoria).

## Fora do escopo (continua como antes)

RF-PDV-06 (autorização de desconto acima do limite, PA-08) e RF-PDV-11 (devolução, PA-14).

## Como rodar a regressão

```bash
npm run db:deploy && npm run db:seed        # banco de TESTE vazio
npm run dev:api
API_URL=http://localhost:3000/api/v1 ADMIN_INITIAL_PASSWORD=... npm run test:smoke
API_URL=http://localhost:3000/api/v1 npm run test:reteste   # depois do smoke (usa a senha que ele define)
```
