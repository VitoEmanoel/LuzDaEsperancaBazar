# Plano de sprints do protótipo — Bazar Luz da Esperança

**Fase:** protótipo. Construímos tudo primeiro, validamos com o grupo e o professor, e só depois escrevemos o documento oficial de cada tela.
**Criado em:** 19/10/2026 · **Sprints:** semanais, de segunda a domingo. As datas são previstas e podem mudar.
**Entrega final prevista:** fim de novembro / início de dezembro de 2026. Se o prazo apertar, os itens marcados com **(corte possível)** saem primeiro.

## Como usar este arquivo
- Cada tarefa começa com uma caixinha: `- [ ]` (a fazer) ou `- [x]` (feita e conferida).
- Só marque `[x]` depois de a tarefa estar pronta **e** verificada (veja a definição de pronto abaixo).
- Códigos de tarefa: `S3-07` = Sprint 3, tarefa 7. Não renumere; se uma tarefa for cortada, risque o texto e escreva o motivo.
- Dúvidas que bloqueiam alguma tarefa ficam na seção "Pendências abertas".

## Definição de pronto (vale para toda tarefa de código)
- [ ] `npm run typecheck` e `npm run build` sem erros
- [ ] `npm run test:smoke`, `test:concorrencia` e `test:reteste` passando (em banco de teste)
- [ ] Teste novo cobrindo a regra criada ou alterada
- [ ] Sistema **executado de verdade** (caminho feliz, entrada inválida e cada perfil afetado), não só os testes
- [ ] Revisão crítica por outra IA (o `agy`), com cada achado conferido antes de aceitar
- [ ] `docs/README_MVP.md` atualizado se a regra ou a tela mudou
- [ ] Commit sem a linha `Co-Authored-By` do Claude

---

## 1. O que vamos construir (decisões fechadas)

### Perfis
Quatro perfis padrão: **Admin, Estoquista, Vendedor e Financeiro**. O Admin cria quantos perfis a mais precisar (um perfil é uma soma de permissões). Cada perfil vê **só o que é dele, nem mais, nem menos**; a API recusa o resto. O Admin vê tudo o que acontece, mas **não vende**.

| Área | Admin | Estoquista | Vendedor | Financeiro |
|---|---|---|---|---|
| PDV, abrir e fechar caixa, sangria e suprimento | — | — | sim (só o dele) | — |
| Caixas do dia (todos, com detalhe) | sim | — | — | sim |
| Lotes e cadastro de produtos | ver | sim (doações) | — | ver; lança compra |
| Aprovação de produtos | sim | — | — | — |
| Estoque, transferência, etiquetas | sim | sim | só "restam N" no PDV | ver |
| Custo / valor atribuído | sim | sim | — | sim |
| Preço do produto | sim | sim | — | — |
| Desconto no produto | sim | — | — | sim |
| Cadastros de apoio (categorias, campanhas, motivos) | sim | só consulta | — | — |
| Parceiros | sim | cria e consulta | — | — |
| Contas a pagar e a receber, fluxo de caixa | ver | — | — | sim |
| Relatórios de estoque, descartes e transferências | sim | sim | — | sim |
| Relatórios de receita e prestação de contas | sim | — | — | sim |
| Usuários, perfis, terminais, parâmetros, auditoria, LGPD, fiscal | sim | — | — | — |

### Entrada de mercadoria
1. O estoquista cria o lote de doação; **parceiro é obrigatório** e ele pode criar o parceiro na hora.
2. O estoquista cadastra os produtos do lote (título da etiqueta, nome, modelo, marca, ano, tipo, tamanho, cor, condição, categoria, quantidade, preço e valor atribuído).
3. Importação por CSV, XLSX ou NF-e (XML) cadastra os itens automaticamente, **sem aprovar**. PDF só como anexo.
4. O **Admin valida**: item a item ou o lote inteiro, e pode devolver ao estoquista com motivo. O saldo só sobe na aprovação.
5. Compra de mercadoria é lançada pelo Financeiro ou pelo Admin; o estoquista só cadastra os itens depois.

### Produto e etiqueta
- Um produto tem **um código só** (Code 128 curto), com várias unidades. Produto repetido recebe **nova entrada**; o saldo nunca é editado livremente.
- O preço é do produto. Mudar o preço **não obriga a reetiquetar**: o sistema sempre cobra o valor atual.
- Tela de impressão em lote: o usuário escolhe os produtos e a **quantidade de etiquetas de cada um**, independente do saldo. A etiqueta leva título curto, valor e código. O tamanho do rolo é um parâmetro do sistema.
- Peça única continua existindo, com código próprio e quantidade 1.

### PDV e caixa
- Leitura por **bipador e por câmera**. Ao ler: produto, preço atual e "restam N".
- Padrão `n*código`; alerta de estoque insuficiente.
- O vendedor cancela só item do carrinho, antes de pagar. **Sem desconto para o vendedor.**
- Abertura com **saldo inicial (troco)**. Sangria e suprimento no PDV.
- Fechamento mostra **tudo o que aconteceu da abertura ao fechamento**, tem valor recebido obrigatório, fechamento parcial (ver o total sem fechar) e PDF.
- PDV responsivo.

### Desconto
Opção A: o Financeiro ou o Admin aplica o desconto **no produto** (percentual ou preço promocional, com motivo e validade). O PDV já cobra o valor com desconto. Fica na auditoria e nos relatórios.

### Estoque
Baixa, ajuste de saída e preço ficam na lista de itens. **Sem entrada de estoque por ajuste.** O estoquista vê o custo.

### Financeiro
Contas a pagar e a receber, resumo financeiro com impressão e PDF, **fluxo de caixa** (entradas, saídas, resultado do dia, saldo acumulado e previsto dos próximos 30 dias; dinheiro físico separado do que entra por PIX e cartão).

### Sai do sistema
PWA, fila offline e sincronização, tela de triagem (vira cadastro + aprovação) e a página de ajustes (absorvida pela lista de estoque). O sistema é só web e exige internet.

### Telas (cerca de 33)
- **Todos (3):** Login · Trocar senha · Início (diferente por perfil)
- **Vendedor (3):** Abrir caixa · PDV · Fechar caixa
- **Estoquista (8):** Lotes de doação · Novo lote · Cadastrar produtos do lote · Importar lote · Estoque · Produto (dados e histórico) · Transferência · Imprimir etiquetas
- **Financeiro (7):** Contas a pagar · Contas a receber e fiado · Nova compra · Resumo financeiro · Fluxo de caixa · Fechamentos de caixa · Relatórios
- **Admin (12 exclusivas):** Aprovação de produtos · Caixas do dia · Usuários · Perfis e permissões · Terminais · Parâmetros · Instituição · Regra fiscal · Auditoria · LGPD · Cadastros de apoio · Carga inicial e modelos de importação

---

## 2. Sprints

### Sprint 0 — Alinhamento (19/10 a 25/10) · concluída
- [x] S0-01 Consolidar as duas listas de notas de ajuste em uma só
- [x] S0-02 Analisar o código atual: telas, rotas, permissões, triagem, estoque, caixa, PWA
- [x] S0-03 Pesquisar sistemas de bazar e brechó existentes e comparar com o nosso
- [x] S0-04 Definir perfis e a regra de visibilidade
- [x] S0-05 Definir o mapa de telas (cerca de 33)
- [x] S0-06 Fechar as decisões de produto, etiqueta, aprovação, desconto e fluxo de caixa
- [x] S0-07 Validar o resumo final com o humano
- [x] S0-08 Escrever este plano

### Sprint 1 — Sem offline e perfis (26/10 a 01/11)
**Objetivo:** sistema só web, com os 4 perfis e a visibilidade correta.

Remover offline e PWA
- [ ] S1-01 Preparar o ambiente na pasta do projeto (dependências, `.env` de teste, banco de teste) e criar a branch da sprint
- [ ] S1-02 Remover o Service Worker (`public/sw.js`), o registro no `main.tsx` e o manifesto PWA
- [ ] S1-03 Remover a fila offline, o IndexedDB e a sincronização (`shared/offline/*`, `connectivity`)
- [ ] S1-04 Remover o operador offline do login (`operadorOffline.ts`, `AuthContext`, `LoginPage`)
- [ ] S1-05 Remover a tela de Sincronização e o item de menu
- [ ] S1-06 Remover a rota `/sync/lote` e a permissão `sincronizacao.resolver` na API, se existirem
- [ ] S1-07 Remover os bloqueios por fila offline na abertura e no fechamento de caixa e no logout
- [ ] S1-08 Manter a idempotência por UUID em venda, transferência e recebimento (evita duplicar em clique duplo)
- [ ] S1-09 Ajustar a API simulada (mocks) e os testes que cobriam sincronização; registrar a nova contagem de testes

Perfis e visibilidade
- [ ] S1-10 Migração nova: renomear Caixa para Vendedor, Triagem para Estoquista e criar o perfil Financeiro
- [ ] S1-11 Criar as permissões novas (aprovar produto, ver caixas do dia, aplicar desconto, imprimir etiquetas, lançar compra, entre outras)
- [ ] S1-12 Semear as permissões de cada perfil conforme a matriz acima
- [ ] S1-13 Tirar do Admin a permissão de operar o PDV
- [ ] S1-14 Trocar o termo "triagem" por "estoquista" na interface
- [ ] S1-15 Menu e rotas montados a partir das permissões; Início por perfil (esqueleto)
- [ ] S1-16 Vendedor enxerga só o próprio caixa e as próprias vendas
- [ ] S1-17 Perfis criados pelo Admin continuam funcionando; os 4 padrão continuam protegidos contra desativação
- [ ] S1-18 Bateria nova de testes: cada perfil tenta acessar o que não deveria e recebe 403
- [ ] S1-19 Rodar a definição de pronto e percorrer o sistema logado em cada um dos 4 perfis
- [ ] S1-20 Revisão pelo agy e correções
- [ ] S1-21 Atualizar `README.md` e `docs/README_MVP.md` (sem PWA, novos perfis)

### Sprint 2 — Produto, lote e cadastro (02/11 a 08/11)
**Objetivo:** o produto com código único e várias unidades, e o cadastro separado da aprovação, no banco e na API.

- [ ] S2-01 Ler o `schema.prisma` completo e desenhar o modelo: produto, entradas por lote e estados do item
- [ ] S2-02 Tabela de produto com título da etiqueta, nome, modelo, marca, ano, tipo, tamanho, cor, condição, categoria e preço
- [ ] S2-03 Gerar o código curto do produto (sequencial, compatível com Code 128), sem quebrar os códigos já existentes
- [ ] S2-04 Migração nova ligando produto a lote e origem (parceiro ou campanha), com os estados **cadastrado** e **aprovado**
- [ ] S2-05 Regras no banco: o saldo só sobe na aprovação; peça única continua com quantidade 1
- [ ] S2-06 Parceiro obrigatório no lote (tela, API e banco); estoquista pode criar parceiro
- [ ] S2-07 API: cadastrar produto no lote (fica "cadastrado", sem efeito no estoque)
- [ ] S2-08 API: nova entrada para produto já existente (soma ao saldo por movimentação, com origem)
- [ ] S2-09 API: aprovar item a item e o lote inteiro; devolver ao estoquista com motivo; tudo na auditoria
- [ ] S2-10 Venda por PEPS sobre o produto, mantendo a atribuição da receita ao parceiro de origem
- [ ] S2-11 Manter o descarte com motivo no cadastro do lote
- [ ] S2-12 Tela Novo lote (com criação de parceiro na hora)
- [ ] S2-13 Tela Cadastrar produtos do lote (substitui a triagem)
- [ ] S2-14 Adaptar a prestação de contas e o conferidor de saldo (`07_manutencao_rotina.sql`) ao produto
- [ ] S2-15 Testes: aprovação, devolução, PEPS por produto e duas vendas disputando a última unidade
- [ ] S2-16 Rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 3 — Aprovação, estoque unificado e desconto (09/11 a 15/11)
**Objetivo:** o Admin aprova; o estoque vira uma tela só; desconto no produto.

- [ ] S3-01 Tela **Aprovação de produtos** (Admin): fila, aprovar item a item ou lote inteiro, devolver com motivo
- [ ] S3-02 Estoque: baixa, ajuste de saída e alteração de preço como ações na lista de itens
- [ ] S3-03 Remover a opção de **entrada** do ajuste (tela e API)
- [ ] S3-04 Tela Produto: dados, edição dos campos e histórico
- [ ] S3-05 Custo visível ao estoquista, ao Admin e ao Financeiro; escondido do Vendedor
- [ ] S3-06 Manter a transferência Bazar e Doações
- [ ] S3-07 Mover a carga inicial para a área do Admin
- [ ] S3-08 Preço do produto alterável por Admin e Estoquista, com motivo e auditoria
- [ ] S3-09 **Desconto no produto** (Financeiro e Admin): percentual ou preço promocional, motivo, validade, auditoria
- [ ] S3-10 O PDV e as consultas passam a usar o preço efetivo (com desconto)
- [ ] S3-11 Relatórios mostram o desconto concedido
- [ ] S3-12 Financeiro: consulta de lotes e produtos em modo leitura
- [ ] S3-13 Testes por perfil para as telas e ações novas
- [ ] S3-14 Rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 4 — Etiquetas, PDV e caixa (16/11 a 22/11)
**Objetivo:** etiquetas em lote e um PDV completo.

Etiquetas
- [ ] S4-01 Parâmetro de tamanho do rolo (Admin)
- [ ] S4-02 Etiqueta com título, valor e código Code 128, com página no tamanho do rolo
- [ ] S4-03 Tela **Imprimir etiquetas**: lista com busca, seleção, quantidade livre por produto e pré-visualização
- [ ] S4-04 Impressão individual ou em lote, também a partir do Estoque
- [ ] S4-05 Histórico de impressão (quem, quando, quantas) **(corte possível)**
- [ ] S4-06 Teste de impressão numa impressora real, quando houver

PDV e caixa
- [ ] S4-07 Abertura de caixa com **saldo inicial (troco)** obrigatório
- [ ] S4-08 PDV: ao ler o código, mostrar produto, preço atual e "restam N"
- [ ] S4-09 Padrão `n*código`; recusar quantidade maior que 1 em peça única
- [ ] S4-10 Alerta de estoque insuficiente
- [ ] S4-11 Cancelar item do carrinho antes de pagar; remover o desconto da tela do Vendedor
- [ ] S4-12 Sangria e suprimento no PDV (conferir o que já existe)
- [ ] S4-13 Valor recebido obrigatório (ver pendência sobre as formas de pagamento)
- [ ] S4-14 Fechamento parcial: ver o total do caixa sem fechar
- [ ] S4-15 Fechamento com a **linha do tempo completa**: cada venda, sangria e suprimento, da abertura ao fechamento
- [ ] S4-16 PDF do fechamento de caixa
- [ ] S4-17 PDV responsivo (celular, tablet e computador)
- [ ] S4-18 Testes e rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 5 — Importação, visões de Admin e Financeiro, câmera (23/11 a 29/11)
**Objetivo:** importar lotes, dar ao Admin e ao Financeiro suas visões e ler pela câmera.

Importação
- [ ] S5-01 Ticket 13: aceitar CNPJ alfanumérico (formato de 2026) no cadastro de parceiro
- [ ] S5-02 Modelos para baixar (CSV, XLSX e NF-e de exemplo) em cada importação
- [ ] S5-03 Importador CSV/XLSX de lote: cria itens **cadastrados**, com erros por linha
- [ ] S5-04 Importador de NF-e (XML): leitura segura, chave de acesso única (sem importar a nota duas vezes), parceiro identificado pelo CNPJ do emitente
- [ ] S5-05 Padronizar o formato e as mensagens de erro de todas as importações

Admin e Financeiro
- [ ] S5-06 Tela **Caixas do dia** (Admin e Financeiro) com o detalhe de cada caixa
- [ ] S5-07 Início do Admin como painel de acompanhamento (vendas do dia, caixas abertos, lotes aguardando aprovação)
- [ ] S5-08 Tela **Fluxo de caixa** (Financeiro)
- [ ] S5-09 Tela **Fechamentos de caixa** (Financeiro)
- [ ] S5-10 Resumo financeiro com impressão e PDF
- [ ] S5-11 Tela **Nova compra** (Financeiro e Admin) gerando a conta a pagar

Câmera
- [ ] S5-12 Leitura por câmera no PDV e no Estoque (testar com a webcam em `localhost`) **(corte possível)**
- [ ] S5-13 Definir onde hospedar com HTTPS e testar a câmera no celular **(corte possível)**
- [ ] S5-14 Testes e rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 6 — Validação do protótipo (30/11 a 06/12)
**Objetivo:** provar que o protótipo funciona inteiro e colher os ajustes.

- [ ] S6-01 Roteiro de ponta a ponta por perfil (do lote doado até a venda e o fechamento) executado no sistema
- [ ] S6-02 Rodar todas as baterias, mais a de acesso por perfil
- [ ] S6-03 Teste de volume (`05_carga_volume_teste.sql`) e conferência (`07_manutencao_rotina.sql`) no novo modelo
- [ ] S6-04 Revisão de segurança: dependências, rotas novas, leitura de XML, uploads
- [ ] S6-05 Revisão de acessibilidade e de responsividade
- [ ] S6-06 Revisão crítica do protótipo inteiro pelo agy
- [ ] S6-07 Demonstração ao grupo e ao professor
- [ ] S6-08 Registrar os ajustes pedidos e a decisão de validar o protótipo

### Sprint 7 — Documentação oficial (07/12 a 13/12)
**Objetivo:** o documento oficial de cada tela, no padrão do projeto do personal. Só começa depois de S6-08.

Documentos do projeto
- [ ] S7-01 Regras de negócio em arquivo próprio (reconstruir as RN-01 a RN-32 e acrescentar as novas)
- [ ] S7-02 Visão e glossário revisados
- [ ] S7-03 Modelo de dados atualizado (com o produto)
- [ ] S7-04 Integrações (NF-e, impressão de etiquetas, leitura por câmera)
- [ ] S7-05 Matriz de perfis e permissões
- [ ] S7-06 README das telas, com a lista, a situação e o fluxo de cada perfil

Ficha de cada tela (objetivo, quem usa, esboço, ações, requisitos funcionais e não funcionais, regras, estados, casos de borda, mensagens, segurança, dados, critérios de aceite, casos de uso)
- [ ] S7-07 Comuns: Login · Trocar senha · Início
- [ ] S7-08 Vendedor: Abrir caixa · PDV · Fechar caixa
- [ ] S7-09 Estoquista: Lotes de doação · Novo lote · Cadastrar produtos do lote · Importar lote
- [ ] S7-10 Estoquista: Estoque · Produto · Transferência · Imprimir etiquetas
- [ ] S7-11 Financeiro: Contas a pagar · Contas a receber · Nova compra · Resumo financeiro
- [ ] S7-12 Financeiro: Fluxo de caixa · Fechamentos de caixa · Relatórios
- [ ] S7-13 Admin: Aprovação de produtos · Caixas do dia · Usuários · Perfis e permissões
- [ ] S7-14 Admin: Terminais · Parâmetros · Instituição · Regra fiscal
- [ ] S7-15 Admin: Auditoria · LGPD · Cadastros de apoio · Carga inicial e modelos

Fechamento
- [ ] S7-16 Revisão de cada lote de fichas pelo agy, com os achados conferidos
- [ ] S7-17 Product backlog formal e sprints seguintes

---

## 3. Pendências abertas
- [ ] P-01 Modelo do bipador (provavelmente 1D; o Code 128 funciona nos dois tipos)
- [ ] P-02 Modelo da impressora e tamanho do rolo de etiqueta (bloqueia S4-06)
- [ ] P-03 Onde hospedar com HTTPS e quem mantém (bloqueia S5-13; a câmera no celular só abre com HTTPS)
- [ ] P-04 Valor recebido obrigatório: só em dinheiro ou em todas as formas de pagamento (S4-13)
- [ ] P-05 Desconto: a validade é obrigatória ou opcional (S3-09)
- [ ] P-06 Prefixo do código do produto e campos obrigatórios do cadastro (S2-03)
- [ ] P-07 Financeiro e Admin com consulta de lotes: confirmar que é só leitura (S3-12)

## 4. Riscos
- **Prazo:** são 6 sprints de construção até a validação. Os itens marcados como corte possível saem primeiro.
- **Modelo de produto (Sprint 2):** mexe no estoque, na venda e na prestação de contas. É a mudança de maior risco; os testes de concorrência e de PEPS são obrigatórios.
- **Migrações:** as migrações 0001 a 0003 não podem ser editadas (o checksum quebra); toda mudança de banco entra em migração nova.
- **Câmera no celular:** depende de HTTPS (P-03).
- **Documentação das regras:** o arquivo de regras de negócio original não está no repositório e será reconstruído (S7-01).
