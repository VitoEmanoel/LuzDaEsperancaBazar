# Sistema de Bazar — Luz da Esperança

Gestão do bazar beneficente do **Centro Espírita e Obras Sociais Luz da Esperança** (Parnaíba, PI):
PDV (somente web, exige internet), entrada e triagem de doações, estoque duplo Bazar ⇄ Doações, caixa,
financeiro, relatórios de prestação de contas por parceiro/campanha, auditoria e LGPD.

Monolito **React 19 + Vite** (web) · **Fastify 5 + Prisma 7 + PostgreSQL** (API) · TypeScript estrito nos dois.

## Estrutura

```
.
├── apps/
│   ├── web/                @bazar/web — front-end (PDV + Backoffice)
│   │   ├── src/features/   telas, organizadas por domínio
│   │   ├── src/shared/     componentes, cliente da API e utilitários comuns
│   │   ├── src/mocks/      API simulada (só em desenvolvimento, com VITE_USE_MOCK=true)
│   │   └── tests-ui/       testes de tela no navegador (rodam à parte, fora do build)
│   └── api/                @bazar/api — API REST /api/v1
│       ├── src/modules/    rotas e regras, organizadas por domínio
│       ├── src/shared/     código comum (erros, auditoria, idempotência, permissões)
│       ├── prisma/         schema.prisma, migrações (0001 em diante) e seed
│       └── tests/          testes ponta a ponta da API (sempre em banco de teste)
├── database/               scripts SQL do DBA (DDL completo, papéis, testes de cada migração, carga, manutenção)
├── docs/
│   ├── README_MVP.md       regras de negócio, perfis, fluxos e segurança
│   ├── PLANO-DE-SPRINTS.md decisões, sprints e tarefas
│   ├── arquitetura/        decisões de estrutura (mapa antes → depois da reestruturação)
│   ├── equipe/             checklist de revisão (QA), testes e lições da equipe
│   └── marca/              brandbook e como ele é aplicado no sistema
├── CLAUDE.md / AGENTS.md   instruções para os agentes de IA que trabalham no projeto
├── memoria.md              estado atual, armadilhas e ambiente (anotações de trabalho)
└── package.json            npm workspaces + scripts unificados
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
| Início e painéis | `inicio/` | `painel/` |
| Cadastros | `cadastros/` | `cadastros/` |
| Administração / LGPD / fiscal | `admin/` | `admin/`, `fiscal/` |
| Código comum | `shared/` | `shared/` |

## Começar

São dois jeitos de rodar:

- **Opção A — só as telas, com a API simulada:** precisa só do Node. Bom para conhecer o sistema e apresentar. Os
  dados ficam na memória da aba (o F5 zera tudo).
- **Opção B — o sistema completo (API + banco):** precisa do Node e do PostgreSQL. É o que guarda os dados de verdade.

Os comandos estão para **Linux** (terminal) e para **Windows 10/11** (use o **PowerShell**, não o Prompt de Comando).

### 1. Instalar as dependências (uma vez por computador)

| Programa | Versão | Para quê |
|---|---|---|
| Git | qualquer recente | baixar o projeto |
| Node.js (com o npm) | **22** (`.nvmrc`); no mínimo 20.19 | rodar o front e a API |
| PostgreSQL | **16** recomendado (funciona do 14 em diante) | banco de dados (só na opção B) |
| Navegador | Chrome, Edge ou Firefox atualizado | usar o sistema |

#### Linux

Ubuntu / Debian / Mint:

```bash
sudo apt update
sudo apt install -y git curl postgresql          # o PostgreSQL só é preciso na opção B
sudo systemctl enable --now postgresql
```

Arch / Manjaro:

```bash
sudo pacman -S --needed git curl postgresql      # o PostgreSQL só é preciso na opção B
sudo -iu postgres initdb -D /var/lib/postgres/data   # só na primeira instalação do PostgreSQL
sudo systemctl enable --now postgresql
```

Node.js pelo **nvm** (vale para qualquer distribuição e respeita a versão do projeto):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# feche e abra o terminal
nvm install 22
nvm alias default 22
```

#### Windows 10/11 (PowerShell)

Abra o **PowerShell** e instale pelo `winget` (já vem no Windows 10/11 atualizado):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id PostgreSQL.PostgreSQL.16 -e      # só na opção B
```

- O instalador do PostgreSQL pede uma **senha para o usuário `postgres`**: anote, ela é usada nos passos da opção B.
- **Feche e abra o PowerShell** depois das instalações.
- Libere os scripts do npm no PowerShell (uma vez; sem isso aparece "a execução de scripts foi desabilitada"):

  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

- O instalador do PostgreSQL **não põe o `psql` no PATH**. Ponha uma vez (ajuste o 16 se instalou outra versão) e
  feche e abra o PowerShell:

  ```powershell
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Program Files\PostgreSQL\16\bin', 'User')
  ```

Sem o `winget`, baixe os instaladores em git-scm.com, nodejs.org (versão LTS) e postgresql.org/download/windows.

#### Conferir (os dois sistemas)

```bash
git --version
node -v        # v22.x (ou no mínimo v20.19)
npm -v
psql --version # só na opção B
```

### 2. Baixar o projeto e instalar as bibliotecas (os dois sistemas)

```bash
git clone https://github.com/VitoEmanoel/LuzDaEsperancaBazar.git
cd LuzDaEsperancaBazar
npm install            # na raiz: instala o front e a API e gera o cliente do Prisma
```

Se o `npm install` avisar que pulou scripts de instalação (o npm mais novo bloqueia), gere o cliente do Prisma à mão:
`npx prisma generate` dentro de `apps/api`.

### 3. Opção A — só as telas, com a API simulada

Linux:

```bash
cp apps/web/.env.example apps/web/.env.local   # já vem com VITE_USE_MOCK=true
npm run dev:web
```

Windows (PowerShell):

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local   # já vem com VITE_USE_MOCK=true
npm run dev:web
```

Abra **http://localhost:5173**. Usuários de teste (só existem neste modo): `admin` / `Admin@123`,
`vendedor` / `Vendedor@123`, `estoquista` / `Estoquista@123`, `financeiro` / `Financeiro@123`.
Os dados ficam na memória da aba: o F5 zera tudo e não dá para usar em mais de um aparelho.

### 4. Opção B — o sistema completo (API + banco)

Escolha **três senhas** antes de começar (só letras e números, para não precisar escapar nada na URL do banco):
a do dono do banco (`<senha_owner>`), a da API (`<senha_api>`) e a do administrador inicial do sistema (12 caracteres
ou mais). Nunca grave senhas no código nem no Git.

**4.1. Criar o banco e o dono** (uma vez)

Linux (o usuário `postgres` do sistema entra no banco sem senha):

```bash
sudo -u postgres psql -c "CREATE ROLE bazar_owner LOGIN PASSWORD '<senha_owner>'"
sudo -u postgres psql -c "CREATE DATABASE bazar OWNER bazar_owner"
```

Windows (pede a senha do `postgres` escolhida na instalação):

```powershell
psql -U postgres -c "CREATE ROLE bazar_owner LOGIN PASSWORD '<senha_owner>'"
psql -U postgres -c "CREATE DATABASE bazar OWNER bazar_owner"
```

**4.2. Configurar a API**

Linux: `cp apps/api/.env.example apps/api/.env`  ·  Windows: `Copy-Item apps/api/.env.example apps/api/.env`

Abra `apps/api/.env` num editor e preencha:

| Variável | O que pôr |
|---|---|
| `DATABASE_URL` | `postgresql://bazar_api:<senha_api>@localhost:5432/bazar` |
| `MIGRATION_DATABASE_URL` | `postgresql://bazar_owner:<senha_owner>@localhost:5432/bazar` |
| `JWT_SECRET` | 32 caracteres aleatórios ou mais (comando abaixo) |
| `ADMIN_INITIAL_PASSWORD` | a senha inicial do `admin` (12 caracteres ou mais; o sistema pede a troca no 1º acesso) |

Para gerar o `JWT_SECRET`:

- Linux: `openssl rand -base64 48`
- Windows (PowerShell):

  ```powershell
  $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
  ```

As outras variáveis podem ficar como estão para rodar no próprio computador.

**4.3. Criar as tabelas, o papel da API e o administrador**

Linux:

```bash
npm run db:deploy
sudo -u postgres psql -d bazar -v senha_api="<senha_api>" < database/03_seguranca_papeis.sql
npm run db:seed        # cria o admin com a senha de ADMIN_INITIAL_PASSWORD
```

Windows (PowerShell):

```powershell
npm run db:deploy
psql -U postgres -d bazar -v senha_api="<senha_api>" -f database/03_seguranca_papeis.sql
npm run db:seed        # cria o admin com a senha de ADMIN_INITIAL_PASSWORD
```

**4.4. Apontar o front para a API real**

Crie o `apps/web/.env.local` (se ainda não existir, copie do `.env.example` como na opção A) e deixe a linha assim:

```
VITE_USE_MOCK=false
```

**4.5. Subir** (dois terminais abertos na pasta do projeto, iguais nos dois sistemas)

```bash
npm run dev:api        # terminal 1: http://localhost:3000/api/v1
npm run dev:web        # terminal 2: http://localhost:5173
```

Abra **http://localhost:5173** e entre com `admin` e a senha de `ADMIN_INITIAL_PASSWORD`. No primeiro login o sistema
pede a troca da senha.

**4.6. Primeiro uso**, em **Administração**:

- **Terminais:** crie um para cada caixa (ex.: "Caixa 1 — Balcão").
- **Usuários:** crie cada pessoa com o seu login e perfil (Vendedor, Estoquista, Financeiro ou um perfil criado por
  você). O terminal pode ficar **fixo no usuário** (opcional): quem tem terminal fixo abre o caixa direto nele, em
  qualquer aparelho.
- O Vendedor opera o PDV. O Administrador também pode abrir caixa, para pagar contas e receber fiado com o dinheiro
  da gaveta.

### 5. Depois de atualizar o projeto (`git pull`)

Iguais nos dois sistemas (no Linux, troque o comando do `psql` pelo do passo 4.3):

```bash
npm install                 # bibliotecas novas
npm run db:deploy           # migrações novas do banco
psql -U postgres -d bazar -v senha_api="<senha_api>" -f database/03_seguranca_papeis.sql   # permissões das tabelas novas
```

Se o login der erro de servidor depois do `pull`, gere o cliente do Prisma (`npx prisma generate` em `apps/api`) e
reinicie o `dev:api`. Com a API simulada, só reinicie o `dev:web`.

### Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Windows: "a execução de scripts foi desabilitada neste sistema" ao rodar `npm` | Política do PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (passo 1) |
| Windows: "psql não é reconhecido como comando" | A pasta `bin` do PostgreSQL não está no PATH | Passo 1 (Windows) e feche e abra o PowerShell; ou use o "SQL Shell (psql)" do menu Iniciar |
| Linux: `psql: ... Peer authentication failed for user "postgres"` | No Linux o `postgres` entra pelo usuário do sistema | Use `sudo -u postgres psql ...` |
| Linux: `Permission denied` ao ler `database/03_seguranca_papeis.sql` com `-f` | O usuário `postgres` não lê a sua pasta pessoal | Mande o arquivo pela entrada: `... < database/03_seguranca_papeis.sql` (passo 4.3) |
| "Erro inesperado" / "Não foi possível falar com a API" no login | Front no modo API real, mas a API não está rodando (ou falta `apps/web/.env.local`) | Rode `npm run dev:api` **ou** use `VITE_USE_MOCK=true` em `apps/web/.env.local`; reinicie o `dev:web` depois de mudar o `.env.local` |
| Usuários de teste (`Admin@123`) não entram com a API ligada | Eles só existem na API simulada | Use o admin do seed (`ADMIN_INITIAL_PASSWORD`) |
| A API não sobe: `[config] variáveis de ambiente inválidas` | `.env` incompleto | Preencha as variáveis citadas (a mensagem mostra só os nomes) |
| Toda tela dá erro de servidor | `DATABASE_URL` usa o papel `bazar_api`, que ainda não existe | Rode `database/03_seguranca_papeis.sql` (passo 4.3) |
| Login dá erro de servidor depois de um `git pull` | Migração nova sem o cliente do Prisma atualizado | Passo 5 |
| `Port 5173 is in use` / API não sobe na 3000 | Outro programa usa a porta | Linux: `ss -ltnp \| grep 5173`; Windows: `netstat -ano \| findstr :5173`; feche o programa ou mude `PORT` no `.env` da API (e `VITE_API_PROXY` ao subir o front) |
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
| `npm run test:smoke` / `test:concorrencia` / `test:reteste` / `test:perfis` / `test:cpf` / `test:produto` | testes ponta a ponta da API (**sempre em banco de teste**); `test:reteste` cobre os tickets do QA; `test:perfis` confere o acesso de cada perfil; `test:produto` cobre o produto, o cadastro no lote e a aprovação (Sprint 2) |
| `npm run test:sprint3` / `test:sprint4` / `test:sprint5` / `test:sprint6` | testes de cada sprint (rodar depois do `test:smoke`). O login aceita 10 tentativas por minuto: espere um minuto entre as baterias |


Detalhes de cada parte: [`apps/web/README.md`](apps/web/README.md), [`apps/api/README.md`](apps/api/README.md),
[`database/README.md`](database/README.md). Identidade visual: [`docs/marca/identidade-visual.md`](docs/marca/identidade-visual.md).

## Segurança — resumo

- Segredos só por variável de ambiente (Azure Key Vault / Google Secret Manager em produção); `.env*` fora do Git.
- JWT com algoritmo fixado, `exp`, `iss`/`aud`; refresh em cookie `HttpOnly; Secure; SameSite=Strict` com rotação.
- AuthZ por permissão em todas as rotas no servidor (o front só esconde menus); papel de banco sem `DELETE`.
- O aparelho guarda só o terminal fixo e o carrinho em andamento (sem dado pessoal, token ou senha); logout apaga isso.
- Fontes e assets servidos pelo próprio app (CSP `'self'`, sem CDN).
