# Reestruturação do repositório (05/10/2026)

O código saiu de duas pastas soltas (`bazar-frontend/`, `bazar-backend/`) para um monorepo com npm workspaces.
Nenhuma regra de negócio, contrato de API, migração Prisma ou script SQL mudou de conteúdo — só de lugar
(as migrações `0001`–`0003` estão byte a byte iguais; mexer nelas quebraria o checksum do `migrate deploy`).

Tickets do QA (`docs/qa/`, apagada em 20/10/2026; continua no histórico do git) citam o nome do arquivo e a linha da versão anterior: os nomes de arquivo foram mantidos
(exceto os listados abaixo), mas a linha pode ter andado algumas posições por causa dos imports reescritos.

## Pastas

| Antes | Depois |
|---|---|
| `bazar-frontend/` | `apps/web/` (pacote `@bazar/web`) |
| `bazar-backend/` | `apps/api/` (pacote `@bazar/api`) |
| `bazar-backend/db/` | `database/` |
| `QA_Correcoes_por_Area.md` | `docs/qa/2026-10-01_correcoes-por-area.md` |
| `bazar-frontend.zip`, `bazar-backend.tar.gz` | removidos (cópias antigas do código) |
| `src/styles/global.css` (web) | `src/styles/{tokens,base,components,layout,pdv,print}.css` + `index.css` |
| `src/api/modules/index.ts` (barrel do web) | removido — cada tela importa direto de `features/<modulo>/<modulo>.api.ts` |

## Front-end — `apps/web/` (antes → depois)

| Antes | Depois |
|---|---|
| `src/App.tsx` | `src/app/App.tsx` |
| `src/components/Layout.tsx` | `src/app/layout/AppLayout.tsx` |
| `src/api/http.ts` | `src/shared/api/http.ts` |
| `src/api/types.ts` | `src/shared/api/types.ts` |
| `src/api/modules/admin.ts` | `src/features/admin/admin.api.ts` |
| `src/api/modules/auth.ts` | `src/features/auth/auth.api.ts` |
| `src/api/modules/cadastros.ts` | `src/features/cadastros/cadastros.api.ts` |
| `src/api/modules/caixa.ts` | `src/features/caixa/caixa.api.ts` |
| `src/api/modules/entradas.ts` | `src/features/entradas/entradas.api.ts` |
| `src/api/modules/estoque.ts` | `src/features/estoque/estoque.api.ts` |
| `src/api/modules/financeiro.ts` | `src/features/financeiro/financeiro.api.ts` |
| `src/api/modules/pdv.ts` | `src/features/pdv/pdv.api.ts` |
| `src/api/modules/relatorios.ts` | `src/features/relatorios/relatorios.api.ts` |
| `src/auth/AuthContext.tsx` | `src/features/auth/AuthContext.tsx` |
| `src/auth/guards.tsx` | `src/features/auth/guards.tsx` |
| `src/pages/LoginPage.tsx` | `src/features/auth/pages/LoginPage.tsx` |
| `src/pages/TrocarSenhaPage.tsx` | `src/features/auth/pages/TrocarSenhaPage.tsx` |
| `src/components/Barcode.tsx` | `src/shared/components/Barcode.tsx` |
| `src/components/ConfirmMotivo.tsx` | `src/shared/components/ConfirmMotivo.tsx` |
| `src/components/Modal.tsx` | `src/shared/components/Modal.tsx` |
| `src/components/Toast.tsx` | `src/shared/components/Toast.tsx` |
| `src/components/ui.tsx` | `src/shared/components/ui.tsx` |
| `src/components/useAsync.ts` | `src/shared/hooks/useAsync.ts` |
| `src/components/ItemPicker.tsx` | `src/features/estoque/components/ItemPicker.tsx` |
| `src/pages/HomePage.tsx` | `src/features/inicio/pages/HomePage.tsx` |
| `src/pages/VendasPage.tsx` | `src/features/pdv/pages/VendasPage.tsx` |
| `src/pages/SincronizacaoPage.tsx` | `src/features/pdv/pages/SincronizacaoPage.tsx` |
| `src/pages/RelatoriosPage.tsx` | `src/features/relatorios/pages/RelatoriosPage.tsx` |
| `src/pages/CadastrosPage.tsx` | `src/features/cadastros/pages/CadastrosPage.tsx` |
| `src/pages/admin/AdminPage.tsx` | `src/features/admin/pages/AdminPage.tsx` |
| `src/pages/pdv/AbrirCaixaPage.tsx` | `src/features/caixa/pages/AbrirCaixaPage.tsx` |
| `src/pages/pdv/FecharCaixaPage.tsx` | `src/features/caixa/pages/FecharCaixaPage.tsx` |
| `src/pages/pdv/LancamentoModal.tsx` | `src/features/caixa/components/LancamentoModal.tsx` |
| `src/pages/pdv/PdvPage.tsx` | `src/features/pdv/pages/PdvPage.tsx` |
| `src/pages/pdv/carrinho.ts` | `src/features/pdv/carrinho.ts` |
| `src/pages/pdv/ComprovanteModal.tsx` | `src/features/pdv/components/ComprovanteModal.tsx` |
| `src/pages/pdv/PagamentoModal.tsx` | `src/features/pdv/components/PagamentoModal.tsx` |
| `src/pages/pdv/usePdvSessao.ts` | `src/features/pdv/hooks/usePdvSessao.ts` |
| `src/pages/admin/AuditoriaTab.tsx` | `src/features/admin/components/AuditoriaTab.tsx` |
| `src/pages/admin/ConfigTabs.tsx` | `src/features/admin/components/ConfigTabs.tsx` |
| `src/pages/admin/LgpdTab.tsx` | `src/features/admin/components/LgpdTab.tsx` |
| `src/pages/admin/PerfisTab.tsx` | `src/features/admin/components/PerfisTab.tsx` |
| `src/pages/admin/UsuariosTab.tsx` | `src/features/admin/components/UsuariosTab.tsx` |
| `src/pages/entradas/LotesPage.tsx` | `src/features/entradas/pages/LotesPage.tsx` |
| `src/pages/entradas/NovoLotePage.tsx` | `src/features/entradas/pages/NovoLotePage.tsx` |
| `src/pages/entradas/TriagemPage.tsx` | `src/features/entradas/pages/TriagemPage.tsx` |
| `src/pages/estoque/AjustesPage.tsx` | `src/features/estoque/pages/AjustesPage.tsx` |
| `src/pages/estoque/EstoquePage.tsx` | `src/features/estoque/pages/EstoquePage.tsx` |
| `src/pages/estoque/HistoricoItemPage.tsx` | `src/features/estoque/pages/HistoricoItemPage.tsx` |
| `src/pages/estoque/TransferenciaPage.tsx` | `src/features/estoque/pages/TransferenciaPage.tsx` |
| `src/pages/financeiro/ContasPagarPage.tsx` | `src/features/financeiro/pages/ContasPagarPage.tsx` |
| `src/pages/financeiro/ContasReceberPage.tsx` | `src/features/financeiro/pages/ContasReceberPage.tsx` |
| `src/pages/financeiro/ResumoFinanceiroPage.tsx` | `src/features/financeiro/pages/ResumoFinanceiroPage.tsx` |
| `src/lib/barcode.ts` | `src/shared/lib/barcode.ts` |
| `src/lib/connectivity.ts` | `src/shared/lib/connectivity.ts` |
| `src/lib/download.ts` | `src/shared/lib/download.ts` |
| `src/lib/feedback.ts` | `src/shared/lib/feedback.ts` |
| `src/lib/format.ts` | `src/shared/lib/format.ts` |
| `src/lib/money.ts` | `src/shared/lib/money.ts` |
| `src/lib/uuid.ts` | `src/shared/lib/uuid.ts` |
| `src/offline/hooks.ts` | `src/shared/offline/hooks.ts` |
| `src/offline/idb.ts` | `src/shared/offline/idb.ts` |
| `src/offline/queue.ts` | `src/shared/offline/queue.ts` |
| `src/offline/sync.ts` | `src/shared/offline/sync.ts` |

Componente renomeado: `Layout` → `AppLayout`. Novo: `shared/components/BrandMark.tsx`.

## Back-end — `apps/api/` (antes → depois)

| Antes | Depois |
|---|---|
| `src/modules/acs/auth.routes.ts` | `src/modules/acesso/auth.routes.ts` |
| `src/modules/acs/senhas.ts` | `src/modules/acesso/senhas.service.ts` |
| `src/modules/acs/tentativas.ts` | `src/modules/acesso/tentativas.service.ts` |
| `src/modules/acs/usuarios.routes.ts` | `src/modules/acesso/usuarios.routes.ts` |
| `src/modules/adm/admin.routes.ts` | `src/modules/admin/admin.routes.ts` |
| `src/modules/cad/cadastros.routes.ts` | `src/modules/cadastros/cadastros.routes.ts` |
| `src/modules/cad/clientes.routes.ts` | `src/modules/cadastros/clientes.routes.ts` |
| `src/modules/cxa/caixa.routes.ts` | `src/modules/caixa/caixa.routes.ts` |
| `src/modules/cxa/caixa.service.ts` | `src/modules/caixa/caixa.service.ts` |
| `src/modules/ent/lotes.routes.ts` | `src/modules/entradas/lotes.routes.ts` |
| `src/modules/est/estoque.routes.ts` | `src/modules/estoque/estoque.routes.ts` |
| `src/modules/fin/financeiro.routes.ts` | `src/modules/financeiro/financeiro.routes.ts` |
| `src/modules/fis/fiscal.routes.ts` | `src/modules/fiscal/fiscal.routes.ts` |
| `src/modules/fis/fiscal.service.ts` | `src/modules/fiscal/fiscal.service.ts` |
| `src/modules/rel/relatorios.routes.ts` | `src/modules/relatorios/relatorios.routes.ts` |
| `src/lib/parametros.ts` | `src/shared/parametros.ts` |
| `src/lib/tokens.ts` | `src/shared/tokens.ts` |
| `src/lib/prisma.ts` | `src/shared/prisma.ts` |
| `src/lib/idempotencia.ts` | `src/shared/idempotencia.ts` |
| `src/lib/http.ts` | `src/shared/http.ts` |
| `src/lib/planilha.ts` | `src/shared/planilha.ts` |
| `src/lib/audit.ts` | `src/shared/audit.ts` |
| `src/lib/money.ts` | `src/shared/money.ts` |
| `src/lib/permissoes.ts` | `src/shared/permissoes.ts` |
| `src/lib/dates.ts` | `src/shared/dates.ts` |
| `src/lib/errors.ts` | `src/shared/errors.ts` |

Módulos com sigla de 3 letras passaram a ter o nome do domínio, igual ao das features do front:
`acs→acesso`, `adm→admin`, `cad→cadastros`, `cxa→caixa`, `ent→entradas`, `est→estoque`, `fin→financeiro`, `fis→fiscal`, `rel→relatorios` (`pdv` mantido).
`src/lib/` virou `src/shared/` (mesmo nome usado no front).
