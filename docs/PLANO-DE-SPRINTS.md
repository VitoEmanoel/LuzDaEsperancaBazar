# Plano de sprints do protótipo — Bazar Luz da Esperança

**Fase:** protótipo. Construímos tudo primeiro, validamos com o grupo e o professor, e só depois escrevemos o documento oficial de cada tela.
**Criado em:** 19/10/2026 · **Sprints:** semanais, de segunda a domingo. As datas são previstas e podem mudar.
**Entrega final prevista:** a meta era fim de novembro / início de dezembro de 2026. Com a Sprint 1B (regras de venda e caixa) e os três dashboards, o fim do plano passou para a semana de **14/12 a 20/12**. Se o prazo apertar, os itens marcados com **(corte possível)** saem primeiro.

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
- [ ] Revisão crítica por outra IA (o agente de QA escolhido pelo humano), com cada achado conferido antes de aceitar
- [ ] `docs/README_MVP.md` atualizado se a regra ou a tela mudou
- [ ] Commit sem a linha `Co-Authored-By` do Claude

---

## 1. O que vamos construir (decisões fechadas)

### Perfis
Quatro perfis padrão: **Admin, Estoquista, Vendedor e Financeiro**. O Admin cria quantos perfis a mais precisar (um perfil é uma soma de permissões). Cada perfil vê **só o que é dele, nem mais, nem menos**; a API recusa o resto. O Admin vê tudo o que acontece e **pode abrir caixa** (decisão de 19/10/2026: para pagar contas e receber fiado com o dinheiro da gaveta; na Sprint 1 ele tinha perdido essa função).

| Área | Admin | Estoquista | Vendedor | Financeiro |
|---|---|---|---|---|
| PDV, abrir e fechar caixa, sangria e suprimento | sim (só o dele) | — | sim (só o dele) | — |
| Caixas do dia (todos, com detalhe) | sim | — | — | sim |
| Lotes e cadastro de produtos | ver | sim (doações) | — | ver; lança compra |
| Aprovação de produtos | sim | sim (não o que ele cadastrou) | — | — |
| Estoque, transferência, etiquetas | sim | sim | só "restam N" no PDV | ver |
| Custo / valor atribuído | sim | sim | — | sim |
| Preço do produto | sim | sim | — | — |
| Desconto no produto | sim | — | — | sim |
| Cadastros de apoio (categorias, campanhas, motivos) | sim | só consulta | — | — |
| Parceiros | sim | cria e consulta | — | cria fornecedor e consulta |
| Contas a pagar e a receber, fluxo de caixa | ver | — | — | sim |
| Relatórios de estoque, descartes e transferências | sim | sim | — | sim |
| Relatórios de receita e prestação de contas | sim | — | — | sim |
| Usuários, perfis, terminais, parâmetros, auditoria, LGPD, fiscal | sim | — | — | — |

> **O que a Sprint 1 já entrega e o que entra depois.** A migração `0005` entrega a visibilidade com as funcionalidades que já existem. Os itens da matriz que dependem de funcionalidade nova entram na sprint dela: preço pelo Estoquista e desconto no produto (Sprint 3), consulta de lotes e produtos pelo Financeiro (S3-12), criar parceiro pelo Estoquista (S2-06), aprovação de produtos (Sprints 2 e 3), lançar compra (S5-11) e caixas do dia (S5-06).

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
- Padrão `n*código`.
- **O PDV não deixa vender mais do que há no estoque do Bazar:** avisa quantas unidades existem e bloqueia na hora de adicionar (o servidor confere de novo ao gravar).
- **Excluir do carrinho por quantidade:** o ✕ da linha pergunta quantas unidades tirar. Peça única sai inteira.
- **Pagamento com valor recebido obrigatório em todas as formas.** O operador informa quanto recebeu em cada forma (dinheiro, PIX, cartão, fiado) e o sistema faz a conta: se a venda é R$ 100 e a pessoa paga R$ 20 no PIX, sobram R$ 80, que o operador informa em outra forma (por exemplo dinheiro). A venda **só finaliza** quando a soma cobre o total. Em dinheiro o sistema calcula e mostra o **troco** (conta de R$ 20 paga com nota de R$ 100: troco de R$ 80). Em PIX e cartão não dá para receber mais do que falta.
- **Sangria limitada ao dinheiro que de fato está no caixa:** o sistema calcula o dinheiro da gaveta (fundo de troco + dinheiro das vendas, já descontado o troco + fiado recebido em dinheiro + suprimentos − sangrias) e **bloqueia** sangria acima disso, na tela e no servidor.
- O vendedor cancela só item do carrinho, antes de pagar. **Sem desconto para o vendedor.**
- Abertura com **saldo inicial (troco)** obrigatório. Sangria e suprimento no PDV.
- Fechamento mostra **tudo o que aconteceu da abertura ao fechamento**, fechamento parcial (ver o total sem fechar) e PDF.
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
- [x] S1-01 Preparar o ambiente na pasta do projeto (dependências, `.env` de teste, banco de teste) e criar a branch da sprint
- [x] S1-02 Remover o Service Worker (`public/sw.js`), o registro no `main.tsx` e o manifesto PWA
- [x] S1-03 Remover a fila offline, o IndexedDB e a sincronização (`shared/offline/*`, `connectivity`)
- [x] S1-04 Remover o operador offline do login (`operadorOffline.ts`, `AuthContext`, `LoginPage`)
- [x] S1-05 Remover a tela de Sincronização e o item de menu
- [x] S1-06 Remover a rota `/sync/lote` e a permissão `sincronizacao.resolver` na API, se existirem
- [x] S1-07 Remover os bloqueios por fila offline na abertura e no fechamento de caixa e no logout
- [x] S1-08 Manter a idempotência por UUID em venda, transferência e recebimento (evita duplicar em clique duplo)
- [x] S1-09 Ajustar a API simulada (mocks) e os testes que cobriam sincronização; registrar a nova contagem de testes

Perfis e visibilidade
- [x] S1-10 Migração nova: renomear Caixa para Vendedor, Triagem para Estoquista e criar o perfil Financeiro
- [x] S1-11 Criar as permissões que a Sprint 1 exige (`relatorios.estoque`); as demais (aprovar produto, caixas do dia, desconto no produto, imprimir etiquetas, lançar compra, entre outras) entram com a funcionalidade, nas sprints 2 a 5
- [x] S1-12 Semear as permissões de cada perfil conforme a matriz acima
- [x] S1-13 Tirar do Admin a permissão de operar o PDV *(revertida na S1B-16: o humano decidiu em 19/10/2026 que o Admin pode abrir caixa)*
- [x] S1-14 Trocar o termo "triagem" por "estoquista" na interface (o perfil; "triagem" como processo continua até a Sprint 2, quando a tela vira cadastro + aprovação)
- [x] S1-15 Menu e rotas montados a partir das permissões; Início por perfil (esqueleto)
- [x] S1-16 Vendedor enxerga só o próprio caixa e as próprias vendas
- [x] S1-17 Perfis criados pelo Admin continuam funcionando; os 4 padrão continuam protegidos contra desativação
- [x] S1-18 Bateria nova de testes: cada perfil tenta acessar o que não deveria e recebe 403
- [ ] S1-19 Rodar a definição de pronto e percorrer o sistema logado em cada um dos 4 perfis *(definição de pronto cumprida e acesso por perfil provado pela API em `test:perfis`; falta a conferência das telas de cada perfil no navegador, que fica para o humano na revisão da Sprint 1)*
- [x] S1-20 Revisão pelo agy e correções (duas rodadas; achados conferidos nos arquivos, aceitos e corrigidos ou recusados com motivo)
- [x] S1-21 Atualizar `README.md` e `docs/README_MVP.md` (sem PWA, novos perfis)

### Sprint 1B — PDV e caixa: regras de venda (02/11 a 08/11)
**Objetivo:** o PDV não deixa vender o que não existe, não finaliza sem informar o que foi recebido, calcula o troco e não deixa tirar mais dinheiro do que há no caixa. Reúne as tarefas de PDV e caixa que estavam na Sprint 4 e os pedidos feitos depois da demonstração da Sprint 1. **Só começa com a ordem do humano.**

- [x] S1B-01 Limite de estoque no PDV por categoria: o catálogo traz o saldo do Bazar, o botão mostra "N em estoque", o sistema bloqueia e avisa a quantidade ao passar (o servidor continua conferindo ao gravar). *A primeira versão foi escrita sem ordem do humano; ele mandou manter e ela passou pela análise e pelo QA do agy como as demais.*
- [x] S1B-02 Avisar quando a peça lida está no estoque de Doações e não pode ser vendida
- [x] S1B-03 Excluir do carrinho por quantidade: o ✕ da linha pergunta quantas unidades tirar (peça única sai inteira)
- [x] S1B-04 Pagamento: o operador informa quanto recebeu em cada forma (dinheiro, PIX, cartão, fiado), sem preenchimento automático; a venda só finaliza quando a soma cobre o total e o sistema mostra o que ainda falta
- [x] S1B-05 Troco: em dinheiro, o sistema calcula e mostra o troco (recebido − devido); em PIX e cartão não aceita receber mais do que falta
- [x] S1B-06 Servidor: recusa venda sem valor recebido em qualquer forma e confere a soma e o troco (contrato `PagamentoRequest` e regras do banco)
- [x] S1B-07 Sangria: o sistema calcula o dinheiro da gaveta, mostra na tela de sangria e bloqueia valor acima dele, no PDV e no servidor
- [x] S1B-08 Abertura de caixa com saldo inicial (troco) obrigatório *(veio da S4-07)*
- [x] S1B-09 Fechamento com a linha do tempo completa: cada venda, sangria e suprimento, da abertura ao fechamento *(veio da S4-15)*
- [x] S1B-10 Fechamento parcial: ver o total do caixa sem fechar *(veio da S4-14)*
- [x] S1B-11 PDF do fechamento de caixa *(veio da S4-16)*
- [x] S1B-12 PDV responsivo: celular, tablet e computador *(veio da S4-17)*
- [x] S1B-13 A tecla Esc não apaga item do carrinho quando a pessoa está digitando no campo do código ou da quantidade (achado do agy)
- [x] S1B-14 Testes: estoque acima do saldo, valor recebido obrigatório em cada forma, troco, soma que não fecha, sangria acima do dinheiro da gaveta, exclusão por quantidade
- [x] S1B-16 O Administrador volta a poder abrir caixa (`caixa.operar`): migração nova, testes de perfil e de pagar conta com dinheiro do caixa e receber fiado na gaveta pelo Admin, mocks e documentação. O reembolso em dinheiro continua como saída no financeiro (decisão já tomada)
- [x] S1B-17 **CPF na venda** (decidido pelo humano em 19/10/2026): o CPF aparece no comprovante e fica registrado na venda. *Ordem do humano recebida em 19/10/2026; implementada e verificada.* Banco e API: tabela própria `venda_cpf` (a venda não guarda CPF), dois parâmetros do Admin: o **limite mensal por CPF em reais** (por exemplo R$ 2.000 ou R$ 5.000; 0 = sem limite) e se o **CPF é obrigatório** na venda (sim ou não; o servidor recusa venda sem CPF válido quando for obrigatório), rota que valida o CPF e devolve o saldo em reais, venda recusada acima do limite (conta o total das vendas do mês daquele CPF; venda cancelada devolve o saldo), e **limpeza automática todo mês** (CPF e contagem zeram; roda no primeiro uso do mês, sem depender de agendador, e também no script de manutenção)
- [x] S1B-18 CPF no PDV: no **primeiro bip** de cada venda o sistema pergunta se a compra é com CPF (Sim / Não); em Sim a pessoa digita o CPF (validado pelos dígitos; sem validar não segue); quando o Admin marcou o CPF como **obrigatório** o "Não" não aparece e a venda não finaliza sem CPF válido; o sistema mostra o **saldo do CPF em reais** no mês e bloqueia a venda que passar do limite; em Não ignora. O CPF **não** fica guardado no aparelho (some se a página recarregar)
- [x] S1B-19 CPF **inteiro** no comprovante; em listas e relatórios o CPF não aparece
- [x] S1B-20 Admin: em Parâmetros, "limite de compras por CPF no mês, em reais" e "CPF obrigatório na venda" (sim ou não)
- [x] S1B-21 Testes do CPF (validação dos dígitos, limite e saldo em reais, soma entre vendas do mesmo CPF, virada do mês, venda cancelada devolve o saldo) e aviso de privacidade (LGPD) na tela
- [x] S1B-15 Rodar a definição de pronto; análise das tarefas e QA pelo agy; atualizar a documentação *(feito: análise antes e revisão depois, duas rodadas; achados conferidos nos arquivos)*

### Sprint 2 — Produto, lote e cadastro (09/11 a 15/11) · concluída em 19/10/2026, aguardando validação do humano
**Objetivo:** o produto com código único e várias unidades, e o cadastro separado da aprovação, no banco e na API.

- [x] S2-01 Ler o `schema.prisma` completo e desenhar o modelo: produto, entradas por lote e estados do item
- [x] S2-02 Tabela de produto com título da etiqueta, nome, modelo, marca, ano, tipo, tamanho, cor, condição, categoria e preço
- [x] S2-03 Gerar o código curto do produto (sequencial, compatível com Code 128), sem quebrar os códigos já existentes
- [x] S2-04 Migração nova ligando produto a lote e origem (parceiro ou campanha), com os estados **cadastrado** e **aprovado**
- [x] S2-05 Regras no banco: o saldo só sobe na aprovação; peça única continua com quantidade 1
- [x] S2-06 Parceiro obrigatório no lote (tela, API e banco); estoquista pode criar parceiro
- [x] S2-07 API: cadastrar produto no lote (fica "cadastrado", sem efeito no estoque)
- [x] S2-08 API: nova entrada para produto já existente (soma ao saldo por movimentação, com origem)
- [x] S2-09 API: aprovar item a item e o lote inteiro; devolver ao estoquista com motivo; tudo na auditoria
- [x] S2-10 Venda por PEPS sobre o produto, mantendo a atribuição da receita ao parceiro de origem
- [x] S2-11 Manter o descarte com motivo no cadastro do lote
- [x] S2-12 Tela Novo lote (com criação de parceiro na hora)
- [x] S2-13 Tela Cadastrar produtos do lote (substitui a triagem)
- [x] S2-14 Adaptar a prestação de contas e o conferidor de saldo (`07_manutencao_rotina.sql`) ao produto
- [x] S2-15 Testes: aprovação, devolução, PEPS por produto e duas vendas disputando a última unidade; e as lacunas achadas pelo QA em 19/10/2026: preço adulterado na venda, campo extra recusado, reenvio de recebimento com o mesmo id e corpo do erro no padrão RFC 9457
- [x] S2-16 Rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 3 — Aprovação, estoque unificado e desconto (16/11 a 22/11)
**Objetivo:** o Admin aprova; o estoque vira uma tela só; desconto no produto.

- [x] S3-01 Tela **Aprovação de produtos** (Admin): fila, aprovar item a item ou lote inteiro, devolver com motivo
- [x] S3-02 Estoque: baixa, ajuste de saída e alteração de preço como ações na lista de itens
- [x] S3-03 Remover a opção de **entrada** do ajuste (tela e API)
- [x] S3-04 Tela Produto: dados, edição dos campos e histórico
- [x] S3-05 Custo visível ao estoquista, ao Admin e ao Financeiro; escondido do Vendedor
- [x] S3-06 Manter a transferência Bazar e Doações
- [x] S3-07 Mover a carga inicial para a área do Admin
- [x] S3-08 Preço do produto alterável por Admin e Estoquista, com motivo e auditoria
- [x] S3-09 **Desconto no produto** (Financeiro e Admin): percentual ou preço promocional, motivo, validade, auditoria
- [x] S3-10 O PDV e as consultas passam a usar o preço efetivo (com desconto)
- [x] S3-11 Relatórios mostram o desconto concedido
- [x] S3-12 Financeiro: consulta de lotes e produtos em modo leitura
- [x] S3-15 Lista de Estoque com colunas claras: "Quantidade no Bazar" e "Quantidade em Doações" (hoje só "Bazar" e "Doações", o que confundiu) e uma coluna **Total** por produto *(confirmado pelo humano em 20/10/2026)*
- [x] S3-16 Auditoria da alteração de parceiro (`PATCH /parceiros`) sem dado pessoal: hoje grava o nome e o CPF mascarado no antes/depois; passar a registrar só os campos alterados, sem o valor dos dados pessoais *(decisão do humano, 20/10/2026: entra na Sprint 3)*
- [x] S3-17 Botão **Imprimir** do caixa fechado (`FecharCaixaPage`) imprime página em branco: a impressão só mostra `.print-area` e essa tela não tem; marcar o resumo do fechamento como área de impressão e esconder os botões no papel *(confirmado pelo humano em 20/10/2026)*
- [x] S3-18 **Perfis e permissões** (Admin): mostrar cada permissão pela descrição em português (a API já tem em `DESCRICOES`), agrupada por área (Vendas e caixa, Entradas e estoque, Financeiro, Relatórios, Administração), com "marcar todas" por grupo; a demonstração com as mesmas descrições *(pedido do humano, 20/10/2026)*
- [x] S3-19 **Copiar perfil**: criar um perfil novo a partir de outro (ex.: copiar o Administrador para fazer outro perfil de administração, ou o Estoquista e acrescentar o PDV) *(pedido do humano, 20/10/2026)*
- [x] S3-20 **Desativar perfil** criado por engano: só se nenhum usuário ativo usar o perfil; perfis padrão não se desativam; nada se apaga. Rota nova na API com `perfis.gerenciar`, auditoria e teste de 403 *(pedido do humano, 20/10/2026)*
- [x] S3-21 Conferir no navegador que o Admin cria perfil com permissões personalizadas, cria outro usuário Administrador e que o perfil novo vê só o que é dele (menu e 403 da API) *(pedido do humano, 20/10/2026; hoje já é possível, falta provar na tela)*
- [x] S3-22 **Estoquista também aprova** e devolve os produtos dos lotes (triagem junto com o Admin), **mas não o que ele mesmo cadastrou**: outra pessoa confere. O Administrador continua aprovando qualquer item. Vale na API e no banco *(decisão do humano, 20/10/2026)*
- [x] S3-13 Testes por perfil para as telas e ações novas
- [x] S3-14 Rodar a definição de pronto; revisão pelo agy; atualizar a documentação

### Sprint 4 — Etiquetas e PDV com produto (23/11 a 29/11)
**Objetivo:** etiquetas em lote e o PDV lendo o produto de código único. As regras de venda e caixa foram para a Sprint 1B.

Etiquetas
- [x] S4-01 Parâmetro de tamanho do rolo (Admin)
- [x] S4-02 Etiqueta com título, valor e código Code 128, com página no tamanho do rolo
- [x] S4-03 Tela **Imprimir etiquetas**: lista com busca, seleção, quantidade livre por produto e pré-visualização
- [x] S4-04 Impressão individual ou em lote, também a partir do Estoque
- [x] S4-05 Histórico de impressão (quem, quando, quantas) **(corte possível)**
- [ ] S4-06 Teste de impressão numa impressora real, quando houver

PDV e caixa
- S4-07 ~~Abertura de caixa com **saldo inicial (troco)** obrigatório~~ → movida para a S1B-08
- [x] S4-08 PDV: ao ler o código, mostrar produto, preço atual e "restam N"
- [x] S4-09 Padrão `n*código`; recusar quantidade maior que 1 em peça única
- S4-10 ~~Alerta de estoque insuficiente~~ → movida para a S1B-01
- S4-11 ~~Cancelar item do carrinho antes de pagar; remover o desconto da tela do Vendedor~~ → movida para a S1B-03
- S4-12 ~~Sangria e suprimento no PDV (conferir o que já existe)~~ → movida para a S1B-07
- S4-13 ~~Valor recebido obrigatório (ver pendência sobre as formas de pagamento)~~ → movida para a S1B-04 a S1B-06
- S4-14 ~~Fechamento parcial: ver o total do caixa sem fechar~~ → movida para a S1B-10
- S4-15 ~~Fechamento com a **linha do tempo completa**: cada venda, sangria e suprimento, da abertura ao fechamento~~ → movida para a S1B-09
- S4-16 ~~PDF do fechamento de caixa~~ → movida para a S1B-11
- S4-17 ~~PDV responsivo (celular, tablet e computador)~~ → movida para a S1B-12
- [x] S4-19 Esc no PDV com o campo vazio pede confirmação antes de tirar uma unidade (P-13)
- [x] S4-20 Campo de senha: o botão Mostrar/Esconder fica dentro do `<label>` e o leitor de tela lê "Senha Mostrar a senha"; o campo deve se chamar só "Senha" *(achado nos testes de tela da Sprint 3; o humano mandou entrar na Sprint 4, 20/10/2026)*
- [x] S4-18 Testes e rodar a definição de pronto; análise das tarefas e QA pelo agy; atualizar a documentação

### Sprint 5 — Importação, visões, dashboards e câmera (30/11 a 06/12)
**Objetivo:** importar lotes, dar a cada perfil suas visões e dashboards com gráficos e filtros, e ler pela câmera.

Importação
- [x] S5-01 Ticket 13: aceitar CNPJ alfanumérico (formato de 2026) no cadastro de parceiro
- [x] S5-02 Modelos para baixar (CSV, XLSX e NF-e de exemplo) em cada importação (CSV e XLSX; a NF-e de exemplo em XML veio com a S5-04)
- [x] S5-03 Importador CSV/XLSX de lote: cria itens **cadastrados**, com erros por linha
- [x] S5-04 Importador de NF-e (XML): leitura segura, chave de acesso única (sem importar a nota duas vezes), parceiro identificado pelo CNPJ do emitente (decisões em P-20)
- [x] S5-05 Padronizar o formato e as mensagens de erro de todas as importações

Admin e Financeiro
- [x] S5-06 Tela **Caixas do dia** (Admin e Financeiro) com o detalhe de cada caixa
- [x] S5-07 **Dashboard do Admin** como primeira tela, com visão geral do que está acontecendo, **gráficos e filtros** (período: hoje, 7 dias, 30 dias e personalizado; por operador e por forma de pagamento): vendas (total, quantidade, ticket médio e por forma), caixas abertos agora (quem, desde quando, dinheiro esperado), lotes aguardando conferência, estoque (itens e valor), contas vencidas e a vencer, fiado em aberto e os últimos eventos sensíveis (cancelamentos, estornos, reembolsos e diferenças de caixa)
- [x] S5-15 **Dashboard do Estoque**, com gráficos e filtros (período, categoria, parceiro): itens no estoque (Bazar e Doações, por categoria), lotes aguardando triagem, entradas do dia e da semana, descartes, itens com pouco saldo e as últimas movimentações
- [x] S5-16 **Dashboard do Financeiro**, com gráficos e filtros (período, forma de pagamento): entradas e saídas do dia e do mês, resultado, contas a pagar vencidas e dos próximos 7 dias, fiado a receber (total e vencido), caixas fechados com diferença e reembolsos
- [x] S5-17 Parâmetro de "pouco saldo" para o alerta do dashboard do Estoque (ver P-08)
- [x] S5-18 Gráficos acessíveis e legíveis nos dois temas (usar a skill `dataviz` do Claude Code): cores com contraste, texto alternativo e tabela equivalente
- [x] S5-08 Tela **Fluxo de caixa** (Financeiro)
- [x] S5-09 Tela **Fechamentos de caixa** (Financeiro)
- [x] S5-10 Resumo financeiro com impressão e PDF
- [x] S5-11 Tela **Nova compra** (Financeiro e Admin) gerando a conta a pagar

Câmera
- [ ] S5-12 Leitura por câmera no PDV e no Estoque (testar com a webcam em `localhost`) **(corte possível)** *(21/10/2026: implementada com `@zxing/browser`, autorizada pelo humano; Code 128 e Code 39; verificada no navegador com câmera simulada do Chromium, `tests-ui/camera-ui.mjs` 18/18; falta o humano conferir com uma webcam de verdade)*
- [ ] S5-13 Definir onde hospedar com HTTPS e testar a câmera no celular **(corte possível)** *(21/10/2026, decisão do humano: por ora só um HTTPS de teste no servidor de desenvolvimento, `VITE_HTTPS_CERT` e `VITE_HTTPS_KEY`, como explica o README do apps/web; provado pelo IP da rede: em http o botão some, em https a câmera lê, também com a API real; falta o humano testar num celular de verdade; a hospedagem é a P-03)*
- [x] S5-14 Testes e rodar a definição de pronto; revisão pelo QA (agente escolhido pelo humano); atualizar a documentação *(21/10/2026: todas as baterias da API, SQL e telas verdes; corrigido o `test:sprint3`, que usava a data UTC e falhava entre 21h e meia-noite; QA do Sonnet antes e depois, achados conferidos)*

### Sprint 6 — Validação do protótipo (07/12 a 13/12)
**Objetivo:** provar que o protótipo funciona inteiro e colher os ajustes.

- [ ] S6-01 Roteiro de ponta a ponta por perfil (do lote doado até a venda e o fechamento) executado no sistema
- [ ] S6-02 Rodar todas as baterias, mais a de acesso por perfil
- [x] S6-03 Teste de volume (`05_carga_volume_teste.sql`) e conferência (`07_manutencao_rotina.sql`) no novo modelo *(21/10/2026: o 05 foi reescrito para o produto, com aprovação por outra pessoa, PEPS e fila; escala 1 em ~11 min, 07 com 0 divergência, 06 com as 13 consultas abaixo de 150 ms; `02_dml_dados_iniciais.sql` atualizado às migrações 0001 a 0013)*
- [ ] S6-04 Revisão de segurança: dependências, rotas novas, leitura de XML, uploads *(21/10/2026, adiantado: Vite 7.3.7 (0 vulnerabilidades), XLSX com teto contra zip-bomba, a mesma forma de pagamento em duas linhas recusada, consultas do CPF em sequência dentro da venda, NF-e sem conferência da assinatura registrada como limitação; falta a revisão completa das rotas novas e dos uploads)*
- [ ] S6-05 Revisão de acessibilidade e de responsividade
- [ ] S6-06 Revisão crítica do protótipo inteiro pelo QA (agente escolhido pelo humano)
- [ ] S6-07 Demonstração ao grupo e ao professor
- [ ] S6-08 Registrar os ajustes pedidos e a decisão de validar o protótipo

### Sprint 7 — Documentação oficial (14/12 a 20/12)
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
- [ ] S7-16 Revisão de cada lote de fichas pelo QA (agente escolhido pelo humano), com os achados conferidos
- [ ] S7-17 Product backlog formal e sprints seguintes
- [ ] S7-18 Atualizar os três documentos de planejamento da faculdade (WBS/EAP, Product Backlog e Sprint Planning, em `/home/VT/Documentos/referencia/docBazar/`, fonte em `docBazar/fonte/`) com o que o protótipo validou, incluindo os pedidos novos (perfis e permissões, celular, impressão do fechamento) *(decisão do humano, 20/10/2026: depois de finalizar o protótipo)*

---

## 3. Pendências abertas
- [x] P-01 Bipador: o modelo ainda não existe; a etiqueta usa código de barras comum (Code 128), então basta um **leitor 1D** (decidido pelo humano em 20/10/2026)
- [ ] P-02 Modelo da impressora e tamanho do rolo de etiqueta (bloqueia só a S4-06). Ainda não há impressora (20/10/2026): o **tamanho do rolo é configurável** pelo Admin (S4-01), com um padrão até a compra
- [ ] P-03 Onde hospedar com HTTPS e quem mantém (bloqueia S5-13; a câmera no celular só abre com HTTPS)
- [x] P-04 Valor recebido obrigatório: **em todas as formas de pagamento** (decidido pelo humano em 19/10/2026; vai para a S1B-04 a S1B-06)
- [x] P-05 Desconto: a validade é **opcional** (decidido em 20/10/2026): sem data de fim, vale até alguém encerrar. O desconto manual do PDV **pode somar** ao do produto, calculado sobre o preço já com desconto e dentro do limite do perfil. O custo tem **permissão própria** ("Ver custo"), ligada no Admin, no Estoquista e no Financeiro
- [x] P-06 Prefixo do código do produto e campos obrigatórios do cadastro (S2-03). Decidido em 19/10/2026: o código continua **`BZ` + 6 dígitos**, na mesma sequência de hoje (as etiquetas já impressas valem). Obrigatórios: **título da etiqueta, nome, categoria, preço, quantidade e valor atribuído**; modelo, marca, ano, tipo, tamanho, cor e condição são opcionais
- [x] P-07 Financeiro consulta lotes e produtos **só para leitura** (confirmado em 20/10/2026; S3-12)
- [x] P-08 "Pouco saldo" no dashboard do Estoque: **um valor único**, configurável pelo Admin em Parâmetros, começando em 5 unidades (decidido pelo humano em 20/10/2026; S5-15, S5-17)
- [ ] P-09 O Vendedor pode **ver** o limite da sangria? Para bloquear com uma mensagem útil ("só há R$ X em dinheiro no caixa"), o sistema mostra o dinheiro da gaveta; isso desfaz o fechamento "às cegas". Confirmar (S1B-07)
- [x] P-10 Pagar conta "com dinheiro do caixa" e receber fiado na gaveta exigem caixa aberto de quem faz. Decidido em 19/10/2026: o **Administrador** pode abrir caixa (S1B-16). O Financeiro continua sem caixa; se ele precisar dessas duas operações na gaveta, o Admin ou um perfil personalizado as faz
- [ ] P-11 Recebimento de fiado em dinheiro no caixa: informar o valor recebido e calcular o troco, como na venda? Hoje o recebimento só tem o valor (achado do QA do agy)
- [x] P-12 CPF e limite: o limite é em **valor (R$) por CPF por mês**, por exemplo R$ 2.000 ou R$ 5.000 (decidido pelo humano em 19/10/2026). **O Admin decide, em Parâmetros, se o CPF é obrigatório** (decidido em 19/10/2026). Se não for obrigatório, sem CPF o limite não vale para aquela venda.
- [x] P-13 Esc no PDV com o campo do código vazio tira uma unidade da última linha. Decidido em 19/10/2026: **pedir confirmação** antes de tirar (tarefa S4-19)
- [x] P-14 Decisões da Sprint 2 (19/10/2026): a **venda por categoria continua** ao lado do produto de código único; item **devolvido** pelo Admin fica editável e o estoquista reenvia; a nova entrada **não muda o preço** (o preço é do produto; mudar é a S3-08); no lote de doação a **campanha é opcional** e o parceiro do lote não precisa ser o da campanha
- [x] P-16 Quem aprova a entrada no estoque: **Admin e Estoquista** (decidido em 20/10/2026, muda a decisão da Sprint 2 de só o Admin). O Estoquista não aprova nem devolve o item que ele mesmo cadastrou; o Admin aprova qualquer um (S3-22)
- [x] P-17 Valor potencial do relatório de posição de estoque: continua pelo **preço normal** do produto, sem o desconto (decidido pelo humano em 20/10/2026)
- [x] P-18 Decisões da Sprint 4 (humano, 20/10/2026): a etiqueta imprime **só o preço normal** do produto (o desconto aparece no caixa; não obriga reetiquetar); rolo padrão **50 × 30 mm** até a impressora chegar (o Admin muda); o histórico de impressão (S4-05) vai **na auditoria**, sem tabela nova; dá para imprimir etiqueta de **qualquer produto ativo**, mesmo sem saldo no Bazar; código de barras passa de Code 39 para **Code 128** (as etiquetas já coladas continuam lidas); permissão nova **Imprimir etiquetas** (Admin e Estoquista, como a S1-11 previa). PDV: `n*código` acima do saldo é **recusado inteiro** com aviso; "restam N" **só na mensagem do bip**; a confirmação do Esc abre com o foco em **Cancelar**, tira com **S** ou clique em **Tirar**, ignora a digitação rápida do leitor e vale também para o botão "Remover último"
- [x] P-19 Decisões da Sprint 5 (humano, 20/10/2026): a importação de lote **grava as linhas válidas** e mostra as aceitas e as recusadas com destaque diferente, cada recusada com o motivo; **todas as importações gravam as válidas** (cadastros e carga inicial também, que antes eram tudo ou nada; decidido na S5-05); a NF-e **cadastra o emitente** como parceiro automaticamente quando ele não existe e vira **lote de compra** com a conta a pagar no valor da nota; "Nova compra" entra no menu do Financeiro (S5-11); **Caixas do dia e Fechamentos de caixa numa tela só**, com filtro (S5-06 e S5-09); gráficos **feitos no projeto**, sem biblioteca, com as cores da identidade visual; o dashboard do Admin fica na tela inicial **junto com os atalhos**; o **Financeiro cadastra o fornecedor** novo na hora da compra (editar parceiro continua só com o Admin); o **CNPJ alfanumérico** vale onde já se aceita CNPJ (parceiro, importação de parceiros, emitente da NF-e e instituição; escolha do Claude, a pedido do humano); a câmera fica nesta sprint se der para testar e validar (no computador pela webcam em `localhost`; no celular depende de HTTPS, P-03)
- [x] P-20 Importação da NF-e (S5-04): o humano deixou a decisão com o Claude (20/10/2026, "faça o que achar melhor"). Ficou assim: **quem importa** é quem tem contas a pagar (Admin e Financeiro; criar o fornecedor novo exige `parceiros.criar`); a nota **cria o lote de compra** com a conta a pagar no **valor total da nota**, vencendo na **primeira parcela** (sem parcela, na emissão; uma conta por lote, como na Nova compra); os **produtos não viram itens** (a NF-e não traz categoria nem preço de venda): vão listados na observação do lote e o estoque os cadastra; **recusa** nota sem protocolo de autorização, cancelada, de homologação (aceita só fora de produção, para testes), NFC-e, de entrada própria, de outro destinatário (quando a instituição tem CNPJ) e de fornecedor desativado; o **XML não é guardado** (o anexo continua PDF ou imagem). A nota entra inteira ou é recusada inteira, com o motivo (não é planilha de linhas)
- [x] P-15 Admin sem segundo aprovador: decidido em 19/10/2026 que o cancelamento **pede motivo**. Já é assim para todos os perfis (mínimo de 5 caracteres, testado no smoke); nada a mudar

## 4. Riscos
- **Prazo:** são 7 sprints de construção até a validação (a Sprint 1B e os dashboards acrescentaram uma semana; o plano termina na semana de 14/12 a 20/12). Os itens marcados como corte possível saem primeiro; se a Sprint 1B ficar grande, as tarefas S1B-09 a S1B-12 voltam para a Sprint 4.
- **Modelo de produto (Sprint 2):** mexe no estoque, na venda e na prestação de contas. É a mudança de maior risco; os testes de concorrência e de PEPS são obrigatórios.
- **Migrações:** as migrações 0001 a 0003 não podem ser editadas (o checksum quebra); toda mudança de banco entra em migração nova.
- **Câmera no celular:** depende de HTTPS (P-03).
- **Documentação das regras:** o arquivo de regras de negócio original não está no repositório e será reconstruído (S7-01).
