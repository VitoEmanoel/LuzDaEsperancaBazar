# Sistema de Bazar — Luz da Esperança

Gestão do bazar beneficente do **Centro Espírita e Obras Sociais Luz da Esperança** (Parnaíba, PI):
PDV (somente web, exige internet), entrada e triagem de doações, estoque duplo Bazar ⇄ Doações, caixa,
financeiro, relatórios de prestação de contas por parceiro/campanha, auditoria e LGPD.

Monolito **React 19 + Vite** (web) · **Fastify 5 + Prisma 7 + PostgreSQL** (API) · TypeScript estrito nos dois.

## Estrutura

```
.
├── apps/
│   ├── web/          @bazar/web — front-end (PDV + Backoffice), organizado por domínio em src/features
│   └── api/          @bazar/api — API REST /api/v1, organizada por domínio em src/modules
├── database/         scripts SQL do DBA (DDL completo, papéis, testes, carga, manutenção)
├── docs/
│   ├── arquitetura/  decisões de estrutura (mapa antes → depois da reestruturação)
│   ├── marca/        brandbook e como ele é aplicado no sistema
│   └── qa/           relatórios de QA
└── package.json      npm workspaces + scripts unificados
```

Os domínios têm **o mesmo nome no front e no back**:

| Domínio | Web (`apps/web/src/features/`) | API (`apps/api/src/modules/`) |
|---|---|---|
| Acesso | `auth/` | `acesso/` |
| PDV | `pdv/` | `pdv/` |
| Caixa | `caixa/` | `caixa/` |
| Entradas e triagem | `entradas/` | `entradas/` |
| Estoque | `estoque/` | `estoque/` |
| Financeiro | `financeiro/` | `financeiro/` |
| Relatórios | `relatorios/` | `relatorios/` |
| Cadastros | `cadastros/` | `cadastros/` |
| Administração / LGPD / fiscal | `admin/` | `admin/`, `fiscal/` |
| Código comum | `shared/` | `shared/` |

## Começar

Requisitos: Node ≥ 20.19 (ver `.nvmrc`) e, para a API real, PostgreSQL 16.

### Opção A — só o front, com API simulada (para conhecer as telas)

```bash
npm install                                    # na raiz: instala web + api
cp apps/web/.env.example apps/web/.env.local   # já vem com VITE_USE_MOCK=true
npm run dev:web                                # http://localhost:5173
```

Usuários de teste (só existem neste modo): `admin` / `Admin@123`, `caixa` / `Caixa@123`, `triagem` / `Triagem@123`.
Os dados ficam na memória da aba: o F5 zera tudo e não dá para usar em mais de um aparelho.

### Opção B — sistema completo (API + banco)

```bash
# 1. Banco e papéis (uma vez). Senhas vindas do cofre/variáveis — nunca no código.
psql -U postgres -c "CREATE ROLE bazar_owner LOGIN PASSWORD '<senha_owner>'"
psql -U postgres -c "CREATE DATABASE bazar OWNER bazar_owner"

# 2. Configuração da API
cp apps/api/.env.example apps/api/.env
#    preencha DATABASE_URL (papel bazar_api), MIGRATION_DATABASE_URL (bazar_owner),
#    JWT_SECRET (>= 32 caracteres aleatórios) e ADMIN_INITIAL_PASSWORD (>= 12 caracteres)

# 3. Tabelas, papel da API e administrador inicial
npm run db:deploy
psql -U postgres -d bazar -v senha_api="<senha_api>" -f database/03_seguranca_papeis.sql
npm run db:seed                                # login: admin / a senha de ADMIN_INITIAL_PASSWORD

# 4. Front apontando para a API real
#    em apps/web/.env.local troque para VITE_USE_MOCK=false (ou apague a linha)
npm run dev:api                                # http://localhost:3000/api/v1  (terminal 1)
npm run dev:web                                # http://localhost:5173         (terminal 2)
```

No primeiro login o sistema pede a troca da senha. Depois, em **Administração**: crie um **terminal** para cada
aparelho de caixa e os **usuários** (Caixa, Triagem) — cada pessoa com o seu login.

### Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| "Erro inesperado" / "Não foi possível falar com a API" no login | Front no modo API real, mas a API não está rodando (ou falta `apps/web/.env.local`) | Rode `npm run dev:api` **ou** use `VITE_USE_MOCK=true` em `apps/web/.env.local`; reinicie o `dev:web` depois de mudar o `.env.local` |
| Usuários de teste (`Admin@123`) não entram com a API ligada | Eles só existem na API simulada | Use o admin do seed (`ADMIN_INITIAL_PASSWORD`) |
| A API não sobe: `[config] variáveis de ambiente inválidas` | `.env` incompleto | Preencha as variáveis citadas (a mensagem mostra só os nomes) |
| Toda tela dá erro de servidor | `DATABASE_URL` usa o papel `bazar_api`, que ainda não existe | Rode `database/03_seguranca_papeis.sql` (passo 3) |
| "Muitas tentativas" no login | 5 senhas erradas bloqueiam o login por 10 min | Aguarde 10 minutos ou reinicie a API em desenvolvimento |
| Funciona no computador, mas não no celular | `localhost` só vale no próprio computador; o cookie de sessão exige HTTPS fora dele | Para vários aparelhos, publique em servidor com HTTPS e coloque o endereço em `CORS_ORIGINS` |
| Depois do F5 volta para o login | Endereço aberto diferente do que está em `CORS_ORIGINS` (ex.: `127.0.0.1` em vez de `localhost`) | Abra pelo mesmo endereço configurado ou inclua o outro em `CORS_ORIGINS` |
| "Abrir caixa" sem opções | Nenhum terminal cadastrado | Administração → Terminais |

| Script (raiz) | O que faz |
|---|---|
| `npm run dev:web` / `dev:api` | sobe cada app em modo desenvolvimento |
| `npm run build` | compila API e web |
| `npm run typecheck` | `tsc` nos dois workspaces |
| `npm run audit` | `npm audit --audit-level=high` em todas as dependências |
| `npm run db:deploy` / `db:seed` | migrações Prisma e carga inicial |
| `npm run test:smoke` / `test:concorrencia` / `test:reteste` | testes ponta a ponta da API (banco de teste); `test:reteste` cobre os tickets do QA |

Detalhes de cada parte: [`apps/web/README.md`](apps/web/README.md), [`apps/api/README.md`](apps/api/README.md),
[`database/README.md`](database/README.md). Identidade visual: [`docs/marca/identidade-visual.md`](docs/marca/identidade-visual.md).

## Segurança — resumo

- Segredos só por variável de ambiente (Azure Key Vault / Google Secret Manager em produção); `.env*` fora do Git.
- JWT com algoritmo fixado, `exp`, `iss`/`aud`; refresh em cookie `HttpOnly; Secure; SameSite=Strict` com rotação.
- AuthZ por permissão em todas as rotas no servidor (o front só esconde menus); papel de banco sem `DELETE`.
- O aparelho guarda só o terminal fixo e o carrinho em andamento (sem dado pessoal, token ou senha); logout apaga isso.
- Fontes e assets servidos pelo próprio app (CSP `'self'`, sem CDN).
