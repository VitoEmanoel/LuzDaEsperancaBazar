# @bazar/web — Front-end

Interface web (React 19 + TypeScript estrito + Vite) do sistema de bazar, com **PDV** e **Backoffice** (somente web, exige internet).
Baseado na *Especificação Técnica* (seções 4 e 5). Não contém lógica de servidor nem banco: a pasta `src/mocks` só simula a API em desenvolvimento.

## Rodar

```bash
npm install                      # na RAIZ do monorepo (workspaces)
cd apps/web
cp .env.example .env.local       # VITE_USE_MOCK=true
npm run dev                      # http://localhost:5173
npm run build                    # tsc + bundle de produção (sem mocks)
npm run audit                    # (na raiz) npm audit --audit-level=high
```

Usuários da API simulada (**somente dev**; o build de produção não inclui `src/mocks`):

| Login | Senha | Perfil |
|---|---|---|
| `admin` | `Admin@123` | Administrador (tudo, menos operar o PDV) |
| `vendedor` | `Vendedor@123` | Vendedor (vai direto ao PDV) |
| `estoquista` | `Estoquista@123` | Estoquista |
| `financeiro` | `Financeiro@123` | Financeiro |

Códigos de peças etiquetadas no seed: `BZ000001` a `BZ000005`. 
A API simulada vive na memória da aba: recarregar a página (F5) zera os dados.

## Estrutura (por domínio — espelha `apps/api/src/modules`)

```
src/
  main.tsx               bootstrap: fontes, estilos, mocks (só dev)
  app/
    App.tsx              rotas (Especificação Técnica, seção 4) + providers
    layout/AppLayout.tsx menu lateral filtrado por permissão (só UX) + barra superior
  features/              uma pasta por módulo de negócio; cada uma tem <modulo>.api.ts, pages/, components/, hooks/
    auth/                AuthContext, guards, login, troca de senha            (API: acesso)
    inicio/              painel inicial com alertas e atalhos
    pdv/                 PDV, carrinho, pagamento, comprovante, vendas         (API: pdv)
    caixa/               abrir/fechar caixa, sangria e suprimento               (API: caixa)
    entradas/            lotes de entrada e triagem                             (API: entradas)
    estoque/             posição, histórico, transferência, ajustes, ItemPicker (API: estoque)
    financeiro/          contas a pagar/receber, resumo                         (API: financeiro)
    relatorios/          relatórios e exportações                               (API: relatorios)
    cadastros/           categorias, parceiros, campanhas, clientes…            (API: cadastros)
    admin/               usuários, perfis, parâmetros, fiscal, auditoria, LGPD  (API: admin, fiscal)
  shared/                código sem regra de negócio, usado por várias features
    api/                 http.ts (cliente único: token em memória, refresh single-flight, timeout, RFC 9457) e types.ts (DTOs)
    components/          BrandMark, Modal, ConfirmMotivo, Toast, Barcode (Code 39), ui (Field, Badge, Tabs…)
    hooks/               useAsync
    lib/                 dinheiro em centavos, datas America/Fortaleza, UUID, armazenamento local mínimo, beep
  styles/                tokens.css (brandbook) → base → components → layout → pdv → print (index.css importa todos)
  mocks/                 API simulada (dev) — imita permissões, 409 de negócio, PEPS, idempotência
```

Regras de dependência: `features/*` podem usar `shared/*` e, quando necessário, outra feature
(ex.: o PDV usa `caixa` e `estoque`); `shared/*` nunca importa de `features/*`.

## Identidade visual

Segue o brandbook da instituição (`docs/marca/identidade-visual.md`): verde-esperança, dourado-terra,
branco-osso e cinza-texto; acentos das pétalas um por área do menu; **Lora** nos títulos e **Nunito** no
corpo, servidas pelo próprio app (`@fontsource-variable/*`) — sem CDN, compatível com a CSP `'self'`.
Todas as cores ficam em `src/styles/tokens.css`; telas não usam cor fixa.

## Rotas implementadas (seção 4)

`/login`, `/trocar-senha`, `/`, `/pdv`, `/pdv/abrir`, `/pdv/fechar`, `/vendas`, `/entradas`, `/entradas/novo`,
`/entradas/:id/triagem`, `/estoque`, `/estoque/itens/:id`, `/estoque/transferir`, `/estoque/ajustes`,
`/financeiro/pagar`, `/financeiro/receber`, `/financeiro/resumo`, `/relatorios/:tipo`,
`/cadastros/:tipo`, `/admin/*` (usuários, perfis, terminais, parâmetros, instituição, regra fiscal, auditoria, importação, LGPD).

## PDV

- Campo de código sempre focado; leitor USB em modo teclado (Enter). Feedback sonoro e visual.
- Atalhos: **F2** quantidade/categoria · **F4** pagamento · **Esc** remove último · **F6** sangria/suprimento.
- Pagamento dividido, troco, fiado (cliente + vencimento), cadastro rápido de cliente com ciência LGPD, desconto limitado pelo perfil.
- A venda é gravada direto no servidor. O id da venda (UUID do cliente) é a chave de idempotência: se a resposta se perder
  e o operador repetir, a mesma venda é devolvida, sem duplicar. O carrinho é preservado no aparelho se a sessão expirar.
- Sem modo offline: se faltar internet, o PDV mostra o erro e a venda não é registrada.

## Segurança no front-end (baseline da seção 3)

| Controle | Onde |
|---|---|
| Access token só em memória; refresh em cookie HttpOnly (front nunca lê) | `shared/api/http.ts` |
| Refresh único em paralelo; falha → sessão expirada, sem loop | `refreshAccessToken` |
| Timeout em toda requisição (15 s; 60 s upload/relatório) | `shared/api/http.ts` |
| Busca de cliente via **POST** `/clientes/busca` — nenhuma PII em URL | `features/cadastros/cadastros.api.ts` |
| Telefone mascarado em listas; nada de PII em `console.*` | `shared/lib/format.ts` |
| O aparelho guarda só o terminal fixo e o carrinho; sem tokens, senhas, documentos ou dados de cliente | `shared/lib/armazenamento.ts` |
| Logout limpa o token em memória e o que o sistema guardou no aparelho | `AuthContext.tsx` |
| Logout explícito não “herda” a rota do usuário anterior | `guards.tsx` |
| Terminal desativado (`code: TERMINAL_DESATIVADO`) apaga dados locais | `usePdvSessao.ts` |
| Menus/botões filtrados por permissão **apenas como UX** — o servidor decide (403) | `AppLayout.tsx`, `guards.tsx` |
| Valores calculados no front são só exibição; servidor recalcula preços/total/troco | `PdvPage.tsx` |
| `caixaId`/`terminalId` vêm da sessão de caixa do servidor, não de input do usuário | `usePdvSessao.ts` |
| Senha provisória exibida uma única vez, nunca persistida | `UsuariosTab.tsx` |
| Ações destrutivas pedem motivo + confirmação | `ConfirmMotivo.tsx` |
| Anexo: checagem de tamanho/tipo só como UX; validação real (magic bytes) é do servidor | `NovoLotePage.tsx` |
| Mocks e credenciais de teste fora do bundle de produção | `main.tsx` (`import.meta.env.DEV`) |
| Dependências sem CVE (`react-router-dom` ≥ 7.18.4) | `package.json` |

**A cargo do servidor/infra (não é front):** CSP restritiva, HSTS, `@fastify/helmet`, CORS restrito, rate limit,
cookie `Secure; SameSite=Strict`. Sugestão de CSP compatível com este build:
`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.

## Divergências / pontos para validar com o back-end

1. **`GET /terminais`** precisa aceitar `caixa.operar` (só leitura dos ativos) para o operador escolher o terminal na abertura. Hoje a seção 5 declara só `terminais.gerenciar`.
2. **Listas de cadastros (`GET /categorias` etc.)** são lidas também por perfis com `caixa.operar`, `entrada.registrar`, `estoque.consultar`, `contas_pagar.gerenciar` (combos das telas).
3. **`limiteDesconto`** foi tratado como **percentual** (PA-08 pendente). `desconto` da venda vai em R$, conforme o contrato.
4. **Prazo do fiado** usa 30 dias como padrão provisório (PA-07); o ideal é o catálogo do PDV trazer `fiado.prazo_dias`.
5. Erro `TERMINAL_DESATIVADO` (código de negócio) é esperado em `GET /caixas/atual` quando o terminal for desativado.
6. `POST /lotes` aceita `vencimento` para compra não paga (a conta a pagar nasce na mesma transação).
7. Rotas de preço/ajuste/reabertura enviam `motivo` no corpo (auditoria).

## Não incluído

Lógica de servidor e banco (por definição), devolução/troca (PA-14), autorização de desconto acima do limite por
supervisor (PA-08), impressão térmica direta (usa impressão do navegador, RNF-11).
