# Sistema de Bazar — Luz da Esperança · Documentação do MVP

**Versão:** 0.2.0 · **Data:** 05/10/2026 · **Status:** aprovado no 2º reteste de QA (com uma ressalva, ver seção 13)

---

## 1. O que é e qual o intuito

O Sistema de Bazar substitui o controle manual do bazar beneficente do **Centro Espírita e Obras Sociais Luz da Esperança** (Parnaíba – PI) por uma aplicação web única que junta:

- **Ponto de venda (PDV)** web, que exige internet;
- **entrada e triagem de doações**;
- **dois estoques independentes**, Bazar (o que é vendido) e Doações (o que vai para a assistência social);
- **controle de caixa** por terminal;
- **financeiro** (contas a pagar e fiado);
- **prestação de contas por doador/campanha**.

### Problemas que resolve

| Hoje (manual) | Com o sistema |
|---|---|
| Sem visão única do dinheiro e do caixa | Caixa por terminal com abertura, sangria/suprimento e fechamento conferido; resumo financeiro por período |
| Itens migram do bazar para a assistência sem registro | Transferência entre os dois estoques sempre registrada e auditada (motivo + usuário) |
| Impossível dizer quanto cada parceiro (ex.: C&A, campanhas) gerou | Toda doação nasce ligada a parceiro/campanha; o relatório mostra recebido, descartado, vendido, receita e o que resta em estoque |
| Planilhas paralelas e erros de soma | O servidor recalcula tudo; o saldo de estoque é mantido pelo banco e não pode ser editado à mão |

### Metas do piloto

- Operar **5 dias úteis seguidos** com 100% das vendas e transferências registradas.
- Totais de caixa **batendo com a contagem física**.
- Zero planilhas paralelas. Entrega final: fim de novembro / início de dezembro de 2026.

### Sobre ser um SaaS

O MVP é hoje um **monolito single-tenant** (uma instituição por instalação: um banco, uma instituição cadastrada, um conjunto de parâmetros). A arquitetura já facilita evoluir para SaaS — código organizado por domínio, regras no servidor e no banco, configuração por tela (parâmetros, regra fiscal, dados da instituição) — mas multi-instituição exige isolamento por tenant (ex.: `instituicao_id` + Row-Level Security no PostgreSQL), onboarding e cobrança, que **não fazem parte do MVP**.

---

## 2. Quem usa (perfis)

| Perfil | O que faz | Onde trabalha |
|---|---|---|
| **Administrador** | Tudo: cadastros, usuários, perfis, parâmetros, regra fiscal, relatórios, financeiro, cancelamentos, LGPD, auditoria, e abrir caixa (para pagar contas e receber fiado com o dinheiro da gaveta) | Backoffice |
| **Vendedor** | Abre/fecha o próprio caixa, vende, sangria/suprimento, cadastro rápido de cliente para fiado | PDV em tela cheia (entra direto nele) |
| **Estoquista** | Registra lotes de doação, cadastra itens (com etiqueta), **aprova e devolve o que outra pessoa cadastrou** (Sprint 3), muda o preço do produto, transfere entre estoques, consulta estoque, custo e relatórios de estoque | Backoffice → Entradas e Estoque |
| **Financeiro** | Contas a pagar e a receber, resumo financeiro, relatórios, consulta de estoque, de lotes e de produtos (só leitura), custo e **desconto no produto** (Sprint 3) | Backoffice → Financeiro |

Os perfis são **compostos por 30 permissões** (ex.: `caixa.operar`, `estoque.transferir`, `relatorios.consultar`, `custo.consultar`, `etiquetas.imprimir`). O Administrador cria perfis novos em **Administração › Perfis e permissões**: as permissões aparecem em português, agrupadas por área (Vendas e caixa, Entradas e estoque, Financeiro, Relatórios, Administração), com "marcar todas" por grupo; um perfil pode nascer como **cópia** de outro; o perfil criado por engano é **desativado** (só sem usuário ativo; os padrão nunca), e o nome fica livre. Outro Administrador é só um usuário com o perfil Administrador. O menu só esconde o que o usuário não usaria; **quem decide é sempre o servidor**.

---

## 3. Stack tecnológica

| Camada | Tecnologia | Por quê |
|---|---|---|
| Front-end | **React 19 + TypeScript estrito + Vite 7**, React Router 7 | Interface rápida, tipagem forte ponta a ponta |
| Back-end | **Node.js ≥ 20.19 + Fastify 5 + TypeScript** | Desempenho e plugins maduros de segurança |
| Validação | **Zod 4** | Toda entrada validada com lista branca de campos |
| Banco | **PostgreSQL 16** (compatível 11+) | Regras críticas garantidas por triggers e CHECKs |
| ORM | **Prisma 7** com `adapter-pg` | Migrações versionadas, consultas parametrizadas |
| Autenticação | **JWT HS256** (`jose`) + refresh opaco em cookie HttpOnly; senhas **argon2id** | Ver seção 9 |
| Segurança HTTP | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` | CSP/HSTS, CORS restrito, limite de tentativas |
| Relatórios | `pdfkit` (PDF), `exceljs` (XLSX), CSV próprio | Exportação com proteção contra injeção de fórmula |
| Upload | `@fastify/multipart` + `file-type` | Tipo real do arquivo por *magic bytes* |
| Fontes | `@fontsource-variable/lora` e `/nunito` | Servidas pelo próprio app (CSP `'self'`, sem CDN) |
| Monorepo | **npm workspaces** | Um `npm install`, scripts unificados |

---

## 4. Estrutura do repositório

```
BAZAR/
├── apps/
│   ├── web/                 @bazar/web — PDV + Backoffice
│   │   └── src/
│   │       ├── app/         rotas e layout (menu lateral)
│   │       ├── features/    um módulo por domínio: auth, inicio, pdv, caixa, entradas,
│   │       │                estoque, financeiro, relatorios, cadastros, admin
│   │       ├── shared/      api (cliente HTTP, tipos), components, hooks, lib
│   │       ├── styles/      tokens.css (brandbook) → base → components → layout → pdv → print
│   │       └── mocks/       API simulada, só em desenvolvimento (fora do build)
│   └── api/                 @bazar/api — API REST /api/v1
│       ├── prisma/          schema (33 tabelas, 18 enums), migrações 0001–0003, seed
│       ├── src/
│       │   ├── modules/     acesso, cadastros, entradas, estoque, pdv, caixa,
│       │   │                financeiro, fiscal, relatorios, admin
│       │   ├── shared/      tokens, dinheiro, datas, auditoria, documento (CPF/CNPJ)…
│       │   └── plugins/     auth.ts — AuthN/AuthZ central
│       └── tests/           smoke, concorrência, reteste-qa
├── database/                scripts SQL do DBA (DDL, papéis, testes, carga, manutenção)
└── docs/                    arquitetura, marca (brandbook), qa
```

Cada domínio tem **o mesmo nome no front e no back** (ex.: `features/financeiro` ↔ `modules/financeiro`).

---

## 5. Funcionalidades — como acontecem

### 5.1 Entrada de doações: cadastro e aprovação (Sprint 2)

**Fluxo:** lote recebido → o estoquista cadastra os produtos do lote (ficam **aguardando aprovação**, sem estoque) → o **Administrador aprova** item a item ou o lote inteiro (só aí o estoque recebe) ou **devolve com motivo** (o estoquista corrige e reenvia) → descartados nunca entram → lote encerrado. Desenho em `docs/arquitetura/produto-e-aprovacao.md`.

1. **Registrar o lote** (`/entradas/novo`) com tipo:
   - **Doação** — exige o **parceiro** (doador); a campanha é opcional (RN-04, S2-06). Sem doador conhecido, use "Doador não identificado". O estoquista **cria o parceiro na hora** (permissão `parceiros.criar`; editar e desativar continuam com o Administrador);
   - **Compra** — exige fornecedor e valor pago, e **gera automaticamente uma conta a pagar** (RN-05);
   - **Saldo inicial** — só pela carga inicial da implantação (o Administrador carrega; os itens já entram aprovados).
   Pode anexar o documento do lote (PDF/imagem; o servidor confere o tipo real).
2. **Cadastrar os produtos do lote** (`/entradas/:id/triagem`), em duas colunas:
   - **Cadastrar**, de três jeitos:
     - **Produto novo:** ganha um **código único** `BZ` + 6 dígitos (a mesma sequência das peças antigas: as etiquetas já impressas valem). Obrigatórios: título da etiqueta (até 40 letras), nome, categoria, preço, quantidade e valor atribuído; marca, modelo, ano, tipo, tamanho, cor e condição são opcionais (P-06). **Peça única** tem 1 unidade e não recebe nova entrada.
     - **Produto que já existe:** nova entrada do mesmo código em outro lote (busca por código ou nome). **Não muda o preço**, que é do produto (P-14).
     - **Por categoria:** itens comuns em quantidade, como antes (o preço é o da categoria).
     Em todos: **valor atribuído unitário** (compra: o **custo**) e o estoque de destino (Bazar ou Doações), usado na aprovação.
   - **Descartar:** um registro por item, com motivo. Descartado nunca entra no estoque.
3. **Aprovar** (Administrador e Estoquista, `produtos.aprovar`; Sprint 3, P-16): aprova item a item, o lote inteiro ou pela fila **Aprovação de produtos** (`/aprovacoes`, todos os lotes); o estoque recebe a quantidade no local escolhido. **Quem cadastrou não aprova nem devolve o próprio item** (outra pessoa confere; só o perfil Administrador pode o próprio): ao aprovar o lote, os itens da própria pessoa ficam para outra. Vale na API e no banco (`AUTO_APROVACAO`). **Devolver** exige motivo: o item fica "devolvido", o estoquista corrige (quantidade, valor, destino e, se o produto nasceu nessa entrada, título, nome e preço) e ele volta para a aprovação. Aprovado não volta atrás. Tudo na auditoria.
4. **Etiquetas** (Sprint 4, permissão `etiquetas.imprimir`: Administrador e Estoquista): tela **Imprimir etiquetas** (`/estoque/etiquetas`) com busca, quantidade livre por produto (sugere uma por unidade em estoque) e pré-visualização no tamanho real do rolo; também abre já preenchida a partir do lote, da lista do Estoque e da tela do produto. A etiqueta leva o título curto, o código de barras **Code 128** (lido por qualquer leitor 1D; as etiquetas antigas em Code 39 têm o mesmo texto e continuam sendo lidas), o código legível e o **preço normal** do produto (o desconto aparece no caixa e não obriga reetiquetar; P-18). O papel sai com uma página do tamanho do rolo por etiqueta; o tamanho fica em **Parâmetros** (`etiqueta.largura_mm` e `etiqueta.altura_mm`, padrão 50 × 30 mm até a impressora chegar). Qualquer produto ativo ganha etiqueta, mesmo sem saldo no Bazar; no máximo 500 por vez. Cada impressão fica no **histórico do produto** (quem, quando, quantas), pela auditoria.
5. **Encerrar o lote.** Lote encerrado não aceita item novo (RN-28), mas os itens dele ainda são aprovados, devolvidos e corrigidos; reabrir ou reverter descarte exige permissão e motivo, e vai para a auditoria. Item de descarte revertido também passa pela aprovação.

### 5.2 Estoque duplo (Bazar ⇄ Doações)

- **Estoque numa tela só** (`/estoque`, Sprint 3) com filtros por estoque, categoria, parceiro e campanha, e as colunas **Quantidade no Bazar**, **Quantidade em Doações** e **Total**. As ações ficam na própria linha: **Baixa** (com motivo cadastrado) e **Ajuste** de inventário — **só de saída** (o estoque só sobe por entrada aprovada; o banco recusa ajuste de entrada) — para o Administrador; **Preço** do produto para o Administrador e o Estoquista (`produtos.preco`). O preço padrão da categoria fica no botão do topo. Tudo com motivo e auditoria. Cada linha é uma entrada (lote) de um produto.
- **Custo** (valor atribuído) só para quem tem `custo.consultar` (Administrador, Estoquista, Financeiro): a API não manda o custo a quem não pode ver (o PDV nunca recebe), nem a coluna nos relatórios.
- **Produto** (`/estoque/produtos/:id`): dados (editáveis por quem cadastra; o código, a categoria e a peça única não mudam aqui), preço, desconto, as entradas com o saldo de cada uma e o histórico (movimentações, preço, desconto, edição). O **histórico da entrada** por categoria continua em `/estoque/itens/:id`.
- **Desconto no produto** (Financeiro e Administrador, `produtos.desconto`): percentual ou **preço promocional**, com motivo e **validade opcional** (sem data, vale até alguém encerrar; com data, até o fim daquele dia). O PDV, o estoque e a venda usam o **preço efetivo** (`fn_preco_efetivo`, a mesma conta em todo lugar); o desconto manual do PDV pode somar, calculado sobre o preço já com desconto e dentro do limite do perfil (o desconto do produto não conta nesse limite). Se o preço baixar até o promocional, a promoção acaba sozinha. A venda guarda o preço sem desconto e o desconto do produto, e o relatório de vendas mostra o **desconto do produto** e o **desconto no PDV** em colunas separadas.
- **Transferência** entre Bazar e Doações, com motivo e usuário registrados; produto de várias unidades transfere em quantidade, e um código com várias entradas pede a escolha da entrada.
- **Carga inicial** por planilha (CSV/XLSX), em **Administração › Carga inicial**, tudo ou nada; aceita "Doações", "doacoes", "DOAÇÕES".

**Regra de ouro:** ninguém escreve no saldo. Toda mudança é uma linha em `movimentacao`, e um trigger do banco atualiza o saldo. Garante: saldo nunca negativo (RN-06/07), só vende do Bazar (RN-10), histórico imutável — nada se apaga (RN-11/24).

### 5.3 PDV (ponto de venda)

Tela cheia, pensada para leitor de código e tablet de 10".

- **Leitura de código:** campo sempre focado; leitor USB funciona como teclado (Enter); feedback sonoro e visual. Ao ler, mostra o produto, o preço de agora (com o desconto, se houver) e **quantas restam no Bazar** (ou "peça única"). Bipar de novo um produto de várias unidades soma uma unidade na mesma linha (até o saldo do Bazar); peça única não entra duas vezes.
- **Várias unidades de uma vez (`n*código`):** digitar `3*` antes de bipar (ou `3*BZ000123` + Enter) lança 3 unidades, de 1 a 999. Pedido acima do saldo do Bazar é **recusado inteiro**, com o aviso de quanto cabe; peça única só aceita 1.
- **Venda por categoria:** botões com preço para itens comuns, com quantidade (F2).
- **Atalhos:** F2 quantidade · F4 pagamento · Esc tira 1 do último item (pergunta antes) · F6 sangria/suprimento.
- **Pagamento** (F4): o operador **digita quanto recebeu em cada forma** (dinheiro, PIX, débito, crédito) e o sistema faz a conta: mostra o que falta e, em dinheiro, o **troco** (conta de R$ 20 paga com nota de R$ 100: troco de R$ 80). A venda só finaliza quando a soma cobre o total. PIX e cartão não aceitam receber mais do que falta. No fiado o valor digitado é o que fica na conta do cliente (RN-15). Desconto só até o limite do perfil (o Vendedor padrão não dá desconto).
- **CPF na compra (S1B-17 a S1B-21):** no **primeiro bip** de cada venda o PDV pergunta "A compra é com CPF?" (**S**im / **N**ão). Em Sim, o vendedor digita o CPF (com máscara; o sistema confere os dígitos e não segue com CPF inválido) e vê o **saldo do CPF no mês**; o PDV bloqueia o que passar do saldo. O CPF aparece **inteiro** só no comprovante (nunca nas listas nem na auditoria), fica guardado na tabela `venda_cpf` até o fim do mês e **depois é apagado** (e o saldo zera). O CPF não fica guardado no aparelho. O **Administrador decide**, em Parâmetros, o **limite de compras por CPF no mês em reais** (0 = sem limite) e se o **CPF é obrigatório** (com ele obrigatório o "Não" não aparece e o servidor recusa venda sem CPF válido). Venda cancelada devolve o saldo. Duas vendas ao mesmo tempo do mesmo CPF não passam juntas do limite.
- **Estoque no PDV:** o catálogo traz o saldo do Bazar por categoria; o botão mostra "N em estoque" e o sistema **bloqueia e avisa a quantidade** ao passar do que há (o servidor confere de novo ao gravar). Peça que está no estoque de Doações avisa que não pode ser vendida.
- **Tirar do carrinho por quantidade:** o ✕ pergunta quantas unidades tirar (peça única sai inteira). Esc com o campo vazio (e o botão "Remover último") **pergunta antes** de tirar uma unidade da última linha: a janela abre com o foco em **Cancelar**, então o Enter que o leitor manda no fim de cada código nunca tira item sem querer; tira com **S** ou com o clique em "Sim, tirar 1" (o S colado em outra tecla, como o leitor digita, não vale). Com texto digitado, Esc só limpa o campo.
- **Fiado:** exige cliente e vencimento; **cadastro rápido de cliente** com ciência do aviso de privacidade (LGPD); se o telefone já existe, pergunta "É a mesma pessoa?".
- **Comprovante não fiscal** com nome, CNPJ e endereço da instituição (impressão 80 mm).
- **O servidor recalcula tudo** (preço, subtotal, desconto, total, troco); a tela é só conferência.
- **PEPS** na venda por categoria **e por produto** (S2-10): as unidades saem da entrada aprovada mais antiga, com desempate fixo (RN-09), e cada entrada consumida vira uma linha da venda — a receita continua atribuída ao parceiro de cada lote. Dois caixas disputando a última unidade: só um vende (testado). Cancelar a venda devolve as unidades às entradas de onde saíram.

### 5.4 Sem modo offline

O sistema é **somente web** e exige internet (decisão de 19/10/2026, Sprint 1). Não há PWA, Service Worker, fila local
nem sincronização. A venda é gravada direto no servidor, com o id gerado no cliente como chave de idempotência: se a
resposta se perder e o operador repetir, a mesma venda é devolvida, sem duplicar. O aparelho guarda só o terminal fixo
e o carrinho em andamento (sem dado pessoal, token ou senha), e o logout apaga isso. A hora da venda é sempre a do servidor.
(A migração `0004_remove_offline` retirou a tabela de pendências, a permissão `sincronizacao.resolver` e o parâmetro `pdv.max_horas_sem_sync`.)

### 5.5 Controle de caixa

**Fluxo:** abrir (terminal + fundo de troco) → vender / receber / sangria / suprimento → fechar (contado × esperado).

- **Um caixa aberto por terminal e um por operador** (RN-12/13, garantido no banco).
- **Sangria e suprimento** com motivo. A tela da sangria mostra o **dinheiro que há na gaveta agora** e bloqueia valor acima dele (o servidor também recusa, e duas sangrias simultâneas não passam juntas).
- **Abertura** com saldo inicial (troco) obrigatório: o operador digita o valor (0 se não houver troco).
- **Total do caixa** (fechamento parcial): no PDV, mostra o dinheiro da gaveta, as vendas por forma e tudo o que aconteceu desde a abertura, sem fechar o caixa, com PDF.
- **Linha do tempo e PDF do fechamento:** ao fechar, o sistema mostra tudo o que aconteceu da abertura ao fechamento (cada venda com o recebido e o troco, cancelamentos, sangrias, suprimentos, fiado recebido) com o dinheiro da gaveta depois de cada evento, e gera o PDF do fechamento. O Vendedor vê só o próprio caixa; Administrador e Financeiro veem qualquer caixa.
- **Fechamento** (RN-19): prévia com totais por forma e **dinheiro esperado** = fundo + vendas em dinheiro + fiado recebido em dinheiro + suprimentos − sangrias. O operador informa o contado; a diferença fica registrada com justificativa.
- Fiado recebido em PIX ou cartão é gravado com a forma correta; só dinheiro entra no esperado da gaveta.

### 5.6 Financeiro

- **Contas a pagar** (`/financeiro/pagar`): lançamento com categoria de despesa e vencimento; alertas de vencidas e a vencer na tela inicial; no pagamento, informa a forma. Se "saiu do caixa", vira sangria automática; cancelar uma conta paga com dinheiro do caixa devolve o valor como suprimento (RN-32).
- **Contas a receber / fiado** (`/financeiro/receber`): nascem das vendas fiadas ou de lançamento manual; recebimento total ou parcial, dentro ou fora do caixa, com forma obrigatória; extrato por cliente; estorno pelo administrador, sempre do recebimento inteiro e uma única vez (RN-27).
- **Resumo financeiro:** entradas por forma, fiado recebido, saídas e resultado do período.

### 5.7 Relatórios e prestação de contas

Todos aparecem na tela e exportam em **PDF, CSV e XLSX**, com os mesmos números e o mesmo filtro (RF-REL-07).

| Relatório | O que mostra |
|---|---|
| **Prestação de contas** | Por **parceiro ou por campanha** (nunca somados); doação, compra e saldo inicial separados; bloco "recebido no período" (lotes, aprovados, descartados, valor atribuído), bloco "movimentado no período" (vendidos, receita, transferências, baixas) e saldo atual |
| **Vendas** | Total por dia, forma, categoria (receita com desconto rateado) ou operador, ou lista venda a venda; **canceladas sempre à parte**; imposto calculado quando houver regra tributada |
| **Estoque** | Quantidade, valor atribuído e valor de venda potencial por categoria, em cada estoque |
| **Descartes** | Filtro por parceiro e campanha; quantidade por motivo |
| **Transferências** | Cada movimento Bazar ⇄ Doações: item, sentido, quantidade, usuário e data |
| **Fiado em aberto** | Saldo por cliente, vencidas em destaque |

**Exemplo:** "Quanto a C&A gerou em setembro?" → Prestação de contas por parceiro, período de setembro: a linha da C&A mostra itens recebidos, descartados, valor atribuído, itens vendidos no mês (inclusive de doações antigas), receita e o que ainda está em estoque.

### 5.8 Cadastros

Categorias, parceiros, campanhas, motivos de descarte e de baixa, categorias de despesa e clientes.

- **Nada é excluído — só desativado** (RN-24).
- Categoria vendida por categoria exige preço maior que zero.
- Parceiro com tipo (Empresa, Loja, Pessoa física, Outro) e CPF/CNPJ opcional com dígito verificador conferido. O "Doador não identificado" é especial: não pode ser desativado nem renomeado.
- Importação de cadastros por planilha, com erro por linha.

### 5.9 Administração, regra fiscal, auditoria e LGPD

- **Usuários e perfis:** senha provisória exibida uma única vez e troca obrigatória no primeiro acesso; perfis compostos pelas 24 permissões.
- **Terminais, parâmetros** (prazo do fiado, sessão…) e **dados da instituição** (aparecem no comprovante).
- **Regra fiscal versionada:** geral, por categoria ou por item; isento ou tributado, alíquota, fundamento legal e vigência. Nova regra encerra a anterior **sem alterar vendas passadas**: cada venda guarda cópia da regra usada (RN-17).
- **Auditoria imutável** de ações sensíveis (cancelamentos, ajustes, estornos, exportações), **sem dados pessoais**.
- **LGPD:** ciência do aviso de privacidade registrada; **exportação** dos dados do titular; **anonimização** irreversível (as vendas continuam nos relatórios sem identificar a pessoa); catálogo do PDV só leva clientes com fiado ativo ou recente; CPF de parceiro nunca volta inteiro da API.

---

## 6. Ciclo de vida de uma doação

```
Doador/Campanha ──► Lote de entrada ──► Cadastro ─┬─► Descarte (motivo) ──► fim
                                                   │
                                                   └─► Aguardando aprovação ◄─┐ devolve com motivo
                                                          │      └────────────┘ (estoquista corrige)
                                                          ▼ Administrador aprova
                                                       Item aprovado
                                                         │
                                       ┌─────────────────┴─────────────────┐
                                       ▼                                   ▼
                                 Estoque BAZAR  ◄── transferência ──►  Estoque DOAÇÕES
                                       │                                   │
                                 Venda no PDV                       Assistência social
                                       │
                                 Receita atribuída ao doador/campanha de origem
                                       │
                                 Relatório de prestação de contas
```

Cada passo fica ligado ao lote de origem; por isso a receita de uma venda de setembro pode ser atribuída à doação recebida em março.

---

## 7. Regras de negócio essenciais e onde ficam

As regras críticas são validadas **duas vezes**: na API e no banco (defesa em profundidade).

| Regra | API | Banco |
|---|---|---|
| Saldo nunca negativo; só vende do Bazar | trava `FOR UPDATE` | `tg_valida_movimentacao` |
| Peça única tem 1 unidade e uma entrada só | validação | `tg_item_produto`, `tg_valida_movimentacao` |
| Estoque só sobe na aprovação; item não aprovado não movimenta | `POST /itens/:id/aprovar` | `tg_item_exige_entrada`, `tg_valida_movimentacao` |
| Aprovado não volta; devolvido não é aprovado sem reenvio | `lotes.routes.ts` | `tg_item_imutavel`, `ck_item_aprovacao`, `ck_item_devolucao` |
| Doação exige parceiro | `POST /lotes` | `tg_lote_doacao_exige_parceiro` |
| Código do produto não muda; produto não se apaga | — | `tg_produto_imutavel`, `tg_produto_sem_exclusao` |
| Fiado exige cliente e conta a receber | `vendas.service.ts` | `tg_valida_venda_completa` |
| Pagamentos = total; troco só em dinheiro | servidor recalcula | `ck_pagamento_*`, `ck_venda_totais` |
| Um caixa aberto por terminal e por operador | `POST /caixas` | índices únicos parciais |
| Cancelamento com estorno automático | reembolso por sangria | `tg_estorna_venda_cancelada` |
| Nada se apaga | API sem DELETE | `fn_bloqueia_exclusao`; papel da API sem DELETE |
| Regra fiscal sem sobreposição de vigência | `fiscal.service.ts` | `ux_regra_vigente` |

---

## 8. API

- **Base:** `/api/v1`, cerca de 80 rotas REST.
- **Erros** no padrão RFC 9457 (`application/problem+json`), com `code` de negócio (ex.: `SALDO_INSUFICIENTE`), erros por campo e `requestId`; **nunca** stack trace.
- **Toda rota declara a permissão exigida**; se alguma não declarar, a API não sobe (*fail secure*).
- **Idempotência:** venda, transferência e recebimento usam UUID gerado no cliente; reenviar não duplica.
- **Exemplos:** `PUT /vendas/:id`, `GET /pdv/catalogo` (ETag), `POST /caixas`, `POST /caixas/:id/fechar`, `POST /lotes`, `POST /lotes/:id/itens`, `GET /relatorios/:tipo?formato=pdf|csv|xlsx`, `POST /titulares/:tipo/:id/anonimizar`.

---

## 9. Segurança (baseline OWASP ASVS nível 2)

| Controle | Implementação |
|---|---|
| Autenticação | **JWT HS256 com algoritmo fixado**, expiração de 15 min, `iss`/`aud` validados; `alg=none` e assinatura adulterada recusados (testado) |
| Sessão | Refresh opaco de 256 bits em cookie `HttpOnly; Secure; SameSite=Strict`, só o hash no banco; **rotação com detecção de reuso** (revoga todas as sessões) |
| Senhas | argon2id; bloqueio de 10 min após 5 erros; rate limit em `/auth/*`; mensagem genérica |
| Autorização | No servidor, em todas as rotas; anti-IDOR (caixa/venda de outro operador → 403/404) |
| Entrada | Zod com lista branca (sem *mass assignment*); SQL sempre parametrizado |
| Upload | Tamanho limitado, tipo real conferido, nome aleatório, anti *path traversal* |
| HTTP | Helmet (CSP, HSTS, nosniff, `frame-ancestors 'none'`), CORS por lista (nunca `*`), `Cache-Control: no-store` |
| Segredos | Só por variável de ambiente, validadas na subida; produção via Azure Key Vault / Google Secret Manager; `.env*` fora do Git |
| Banco | Papel `bazar_api` sem DELETE e sem escrita no saldo; `bazar_relatorio` só leitura e sem PII |
| Logs | pino com `redact`: sem token, cookie ou dado pessoal |
| Front | Token só em memória; sem PII em URL (busca de cliente no corpo do POST); telefone mascarado nas listas |
| Dependências | `npm audit` com 0 vulnerabilidades |

---

## 10. Identidade visual

Segue o brandbook da instituição (`docs/marca/`):

- **Cores:** verde-esperança `#5B8C3E`, dourado-terra `#8C6D46`, branco-osso `#FAF7F2`, cinza-texto `#4A4A4A`; menu, cabeçalho do PDV e login em verde-floresta `#2D461F`. Onde a cor da marca não atinge WCAG AA, usa-se o mesmo tom mais escuro (ex.: botões `#4E7A34`).
- **Acentos das pétalas** identificam cada área do menu (coral: operação; laranja: estoque; amarelo: financeiro; azul: gestão).
- **Fontes:** **Lora** nos títulos, **Nunito** no corpo.
- Tema escuro automático derivado do verde; fonte base de 17 px, alvos de toque ≥ 44 px, foco sempre visível.

---

## 11. Qualidade — testes e verificações

| Bateria | Resultado atual |
|---|---|
| `tests/smoke.ts` (fluxos críticos e segurança) | 157 ok |
| `tests/concorrencia.ts` (disputa da última peça, IDOR) | OK |
| `tests/reteste-qa.ts` (regressão dos 12 tickets) | 37 ok |
| `tests/perfis.ts` (acesso de cada perfil, perfil personalizado, proteção dos perfis padrão, custo escondido, desativação) | 212 ok |
| `tests/cpf.ts` (CPF: dígitos, limite em reais, obrigatório, só no comprovante, trava entre vendas, limpeza do mês) | 37 ok |
| `tests/produto.ts` (Sprint 2: cadastro, devolução, aprovação, nova entrada, PEPS por produto, estorno, disputa da última unidade) | 49 ok |
| `tests/sprint3.ts` (Sprint 3: aprovação por outra pessoa, fila, ajuste só de saída, produto, custo, preço, desconto no PDV e na venda, relatórios, auditoria do parceiro) | 46 ok |
| `tests/sprint4.ts` (Sprint 4: tamanho do rolo, etiqueta com preço normal, limites do pedido, histórico na auditoria, permissão, venda acima do saldo) | 22 ok |
| `database/04_testes_0003.sql` (tentativas de violar regras do banco) | 23 de 23 (28 com o papel da API) |
| `database/08_testes_0009.sql` (regras do produto e da aprovação no banco) | 32 de 32 (35 com o papel da API) |
| `database/09_testes_0010.sql` (Sprint 3: quem aprova e devolve, ajuste só de saída, desconto e preço efetivo, perfis, auditoria do parceiro) | 34 de 34 |
| `database/10_testes_0011.sql` (Sprint 4: permissão de etiquetas, rolo padrão, auditoria da impressão sem dado pessoal) | 9 de 9 |
| `database/07_manutencao_rotina.sql` (conferência de saldo e prestação de contas) | 0 divergência |
| Telas no navegador (`apps/web/tests-ui/`: CPF, janelas do PDV, cadastro e aprovação de produtos, PDV e etiquetas da Sprint 4) | 11, 14, 19 e 30 ok |
| Telas da Sprint 3 no navegador (Chrome por CDP, sistema real) | 20 + 9 (perfis pela tela) + 11 (correções do QA e impressão do caixa) ok |
| Etiquetas no sistema real (PDF no tamanho do rolo, código lido pelo `zbarimg` de 30 × 20 a 120 × 100 mm) | 5 ok, todos os tamanhos lidos |
| Typecheck web + api e `npm audit` | 0 erros, 0 vulnerabilidades |

Teste de volume (`05_carga_volume_teste.sql`): cerca de 5 anos simulados — 64 mil itens, 129 mil movimentações, 60 mil vendas.

---

## 12. Como rodar

```bash
npm install                                  # na raiz: instala web + api

# Só o front, com API simulada (sem banco)
cp apps/web/.env.example apps/web/.env.local # VITE_USE_MOCK=true
npm run dev:web                              # http://localhost:5173

# API real (PostgreSQL 16)
cp apps/api/.env.example apps/api/.env       # preencher segredos — nunca versionar
npm run db:deploy && npm run db:seed         # migrações + admin inicial (troca de senha obrigatória)
psql -d bazar -v senha_api="..." -f database/03_seguranca_papeis.sql
npm run dev:api                              # http://localhost:3000/api/v1

# Testes, em banco de TESTE, nesta ordem:
npm run test:smoke && npm run test:concorrencia && npm run test:reteste && npm run test:perfis && npm run test:cpf && npm run test:produto && npm run test:sprint3   # espere ~1 minuto entre as baterias: o login aceita 10 por minuto
```

**Produção:** atrás de proxy com TLS (`TRUST_PROXY=true`), segredos vindos do cofre, pasta de uploads em volume com backup, `03_seguranca_papeis.sql` após cada deploy e `07_manutencao_rotina.sql` diariamente.

---

## 13. Status e próximos passos

**Veredito do QA (2º reteste):** aprovado.

| Item | Situação |
|---|---|
| **Ticket 13 — CNPJ alfanumérico** (formato da Receita Federal a partir de julho/2026) | Recomendado antes do go-live; hoje um CNPJ com letras é recusado. Não bloqueia (documento é opcional) |
| RF-PDV-06 — desconto acima do limite com autorização | Depende da PA-08 |
| RF-PDV-11 — devolução/troca | Depende da PA-14 |
| Impressão térmica direta | Hoje usa a impressão do navegador (RNF-11) |
| Multi-instituição (SaaS) | Fora do MVP (ver seção 1) |

**Roteiro do piloto:**

1. Carga inicial do estoque.
2. Cadastro de parceiros, campanhas e usuários.
3. 5 dias úteis de operação real, com conferência diária do caixa.
4. Relatório de prestação de contas por parceiro ao final.
