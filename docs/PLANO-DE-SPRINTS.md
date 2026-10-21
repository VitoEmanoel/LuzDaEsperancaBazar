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
- [x] S5-12 Leitura por câmera no PDV e no Estoque (testar com a webcam em `localhost`) **(corte possível)** *(21/10/2026: implementada com `@zxing/browser`, autorizada pelo humano; Code 128 e Code 39; verificada no navegador com câmera simulada do Chromium, `tests-ui/camera-ui.mjs` 18/18; falta o humano conferir com uma webcam de verdade)* *(21/10/2026: validada pelo humano no notebook e no celular: a câmera leu a etiqueta e o produto entrou na venda)*
- [x] S5-13 Definir onde hospedar com HTTPS e testar a câmera no celular **(corte possível)** *(21/10/2026, decisão do humano: por ora só um HTTPS de teste no servidor de desenvolvimento, `VITE_HTTPS_CERT` e `VITE_HTTPS_KEY`, como explica o README do apps/web; provado pelo IP da rede: em http o botão some, em https a câmera lê, também com a API real; falta o humano testar num celular de verdade; a hospedagem é a P-03)* *(21/10/2026: validada pelo humano no celular, pelo endereço de sempre com a flag do Chrome que trata o IP como seguro; o certificado autoassinado foi recusado pelo navegador do celular. A hospedagem com HTTPS de verdade continua na P-03)*
- [x] S5-14 Testes e rodar a definição de pronto; revisão pelo QA (agente escolhido pelo humano); atualizar a documentação *(21/10/2026: todas as baterias da API, SQL e telas verdes; corrigido o `test:sprint3`, que usava a data UTC e falhava entre 21h e meia-noite; QA do Sonnet antes e depois, achados conferidos)*

### Sprint 6 — Validação do protótipo (07/12 a 13/12)
**Objetivo:** provar que o protótipo funciona inteiro e colher os ajustes.

- [x] S6-01 Roteiro de ponta a ponta por perfil (do lote doado até a venda e o fechamento) executado no sistema *(21/10/2026, sistema real: front 5173 em modo real, API 3100, banco de teste novo. Admin: primeiro acesso, troca de senha, cria Estoquista/Vendedor/Financeiro (cada um troca a senha provisória), categorias e terminal. Estoquista: lote doado, 3 produtos (peça única, 6 canecas, 5 pratos para Doações), não aprova o próprio cadastro. Admin aprova (saldo sobe só aí). Estoquista: transfere 3 pratos e imprime 10 etiquetas. Vendedor: abre o caixa com R$ 50, 3 vendas (dinheiro com troco, PIX, débito com o "lança o que há"), sangria de R$ 20, fecha com R$ 79 sem diferença. Financeiro: caixas do dia, detalhe, resumo, fluxo e painel com R$ 89. 403 de verdade na API para o Vendedor e o Estoquista. Banco: 3 vendas = R$ 89, só 2 pratos em Doações, 07 sem divergência. Defeito achado e corrigido: dois itens do menu ativos ao mesmo tempo (Estoque e Transferência). Roteiros na scratchpad da sessão (e2e/1 a 6))*
- [x] S6-02 Rodar todas as baterias, mais a de acesso por perfil *(21/10/2026, banco novo: smoke 158, concorrencia 5, reteste 37, perfis 248, cpf 37, produto 49, sprint3 46, sprint4 22, sprint5 117; SQL 04 23, 08 32, 09 34, 10 9, 11 14, 12 9, todos sem falha; 07 sem divergência; nenhum erro no log da API; testes de tela da S6-09 a S6-13 verdes)*
- [x] S6-03 Teste de volume (`05_carga_volume_teste.sql`) e conferência (`07_manutencao_rotina.sql`) no novo modelo *(21/10/2026: o 05 foi reescrito para o produto, com aprovação por outra pessoa, PEPS e fila; escala 1 em ~11 min, 07 com 0 divergência, 06 com as 13 consultas abaixo de 150 ms; `02_dml_dados_iniciais.sql` atualizado às migrações 0001 a 0013)*
- [x] S6-04 Revisão de segurança: dependências, rotas novas, leitura de XML, uploads *(21/10/2026, adiantado: Vite 7.3.7 (0 vulnerabilidades), XLSX com teto contra zip-bomba, a mesma forma de pagamento em duas linhas recusada, consultas do CPF em sequência dentro da venda, NF-e sem conferência da assinatura registrada como limitação; falta a revisão completa das rotas novas e dos uploads)* *(21/10/2026: rotas das Sprints 4 e 5 e uploads revistos com o QA do Sonnet; corrigidos o XLSX corrompido (500 → 415), o teto da NF-e e do anexo já na leitura do arquivo e `documento`/`email` fora do log; sprint5 119 com os 2 testes novos; conferidos e sem defeito: lista branca das importações, SQL dos relatórios (modo é enum), DTD/entidades na NF-e, tipo real do anexo. Decisão do humano (21/10/2026): o documento do lote continua como está (baixam `entrada.registrar`, `produtos.aprovar` e `estoque.consultar`), assim como o CPF no comprovante para o Financeiro e o telefone no catálogo do PDV)*
- [x] S6-05 Revisão de acessibilidade e de responsividade *(21/10/2026: responsividade na S6-12; acessibilidade: janela sobre janela (Esc e Tab só na de cima), título com id próprio, Tab só pelo que se vê, fechar só com clique inteiro no fundo, `fechavel` sem reiniciar a janela, abas com setas/Home/End e tabindex móvel, paginação anunciada, aviso sem anúncio dobrado; contraste de 15 pares de cores ≥ 4,5:1 nos dois temas; `tests-ui/acessibilidade-ui.mjs` 11/11; QA do Sonnet e do Copilot (Auto) depois: 3 aceitos, 2 recusados. Adiados, de comum acordo com o QA: `th scope`/`caption`, cada barra do gráfico como parada de Tab, o F6 do PDV sobre o do navegador e o `window.confirm` do terminal)*
- [x] S6-06 Revisão crítica do protótipo inteiro pelo QA (agente escolhido pelo humano) *(21/10/2026: Sonnet e Copilot; os achados aceitos viraram as tarefas S6-14 a S6-17, com as decisões do humano)*
- [ ] S6-07 Demonstração ao grupo e ao professor
- [ ] S6-08 Registrar os ajustes pedidos e a decisão de validar o protótipo

Ajustes pedidos na validação (humano, 21/10/2026, depois de testar a câmera no celular; branch `sprint-6-ajustes-validacao`)
- [x] S6-09 Tirar a **Venda por categoria** da tela do PDV ("mais atrapalha do que ajuda"). Só a tela: a API continua aceitando a linha por categoria, para voltar fácil se for preciso. Muda a decisão da P-14 *(21/10/2026: verificada na demonstração; carrinho guardado com linha de categoria ainda fecha a venda; QA do Sonnet antes e depois, sem defeito)*
- [x] S6-10 Campo **Qtd.** ao lado do código de barras: digita a quantidade e bipa (leitor, teclado ou câmera), sem bipar um por um; o campo volta a 1 depois de cada item lançado. O `n*código` continua valendo e manda mais que o campo; peça única só 1 e nunca mais do que há no Bazar, como hoje *(21/10/2026: `tests-ui/qtd-pdv-ui.mjs` 15/15, inclusive CPF adiando o bip, Esc e Enter no campo, dois bips seguidos e celular 390 px; cpf, janelas, produto, sprint4 e camera-ui ajustados para bipar e verdes; typecheck e build)*
- [x] S6-11 Quantidade acima do estoque no PDV (Qtd. ou `n*código`): **lança o que houver no Bazar e avisa** ("só havia 3: lancei 3"), em vez de recusar tudo; peça única lança 1 e avisa; sem nenhuma, avisa como hoje. O saldo do mês do CPF continua recusando (é limite de dinheiro). Muda a P-18 (decisão do humano, 21/10/2026) *(21/10/2026: feita; aviso "Atenção:" com estilo próprio e bipe de erro; testes qtd-pdv-ui e sprint4-ui ajustados e verdes; QA do Sonnet antes e depois: 1 defeito no texto do aviso, corrigido)*
- [x] S6-12 Acabamento visual em todas as larguras (parte da S6-05, autorizado pelo humano em 21/10/2026, depois da varredura de 25 telas × 5 larguras): (1) topo do PDV alinhado no celular e no tablet; (2) fichas compactas no celular (principal em destaque, secundário em "ver mais", botões na largura toda); (3) tabela do tablet sem cortar colunas; (4) filtros em grade, busca larga e câmera ao lado; (5) atalhos do Início em 2 colunas; (6) texto de ajuda do código mais curto no celular; (7) botão do menu do celular maior e com "Menu" *(21/10/2026: feita; a tabela escolhe o formato pelo espaço: inteira, sem as `col-sec` (Estoque e Lotes), fichas até 1100 px ou rolagem; fichas e colunas escondidas só na tela, o papel sai com a tabela inteira; varredura 25 telas × 5 larguras sem problema e nenhuma tabela sobrando de 390 a 1366 px; os 6 testes de tela verdes; QA do Sonnet antes e depois)*
- [x] S6-13 Outro caixa vendeu antes (o servidor recusa a venda por saldo): o PDV **ajusta o carrinho sozinho ao que há agora** (reduz ou tira a linha) e avisa o que mudou; o operador confere o total e recebe de novo. Sem reserva no bip (opção 1, decisão do humano em 21/10/2026; a reserva ficou de fora pelo custo) *(21/10/2026: feita; `ajustarAoEstoque` em `carrinho.ts`; `tests-ui/estoque-mudou-ui.mjs` 6/6 e a função conferida à parte (nada mudou, categoria ausente, linhas repetidas, peça única e preço novo); QA do Sonnet antes (11 aceitos, 1 recusado: o pagamento já trava o reenvio) e depois, sem defeito)*

Achados da revisão do protótipo (S6-06, QA do Sonnet e do Copilot; decisões do humano em 21/10/2026)
- [x] S6-14 Integridade da API: id de operação repetido com outro conteúdo (ou de outro escopo/usuário) responde 409 `ID_EM_USO` em vez de fingir sucesso (venda, transferência, baixa, ajuste, recebimento, lançamento de caixa, conta a pagar, terminal, descarte); ninguém lança conta a pagar na categoria "Reembolso de venda" (só o cancelamento com reembolso); erro interno sem a mensagem do Prisma no log (pode ter CPF, nome, telefone); corpos de venda e de dinheiro com `.strict()`. No front: transferência e recebimento com o id da operação mantido nas novas tentativas e o "Registrar" do recebimento travado enquanto grava (achado do Copilot) *(21/10/2026: feita e testada (bateria completa verde, sprint6 23/23), mas **reaberta pela revisão do QA (Sonnet e Copilot)**. Falta corrigir, todos conferidos no código: (1) o reenvio compara só alguns campos, rota por rota: a venda não compara pagamentos, cliente, CPF, desconto nem vencimento do fiado (`vendas.service.ts`, `processarVenda`), e a corrida em `pdv.routes.ts` (`DUPLICADO` → `jaExistia`) só confere o operador; o recebimento não compara `caixaId`, `observacao` nem quem recebeu; abrir caixa (`caixa.routes.ts`, `POST /caixas`) não compara terminal nem fundo; o lançamento não compara o motivo; a conta a pagar não compara favorecido nem quem criou; a conta a receber, o descarte (`lotes.routes.ts`) e o terminal comparam pouco. Correção combinada: todas essas rotas passam a usar `reservarChave` (`shared/idempotencia.ts`, impressão sha-256 do corpo já validado, escopo e usuário) em vez de comparar campo a campo; na venda, a impressão do corpo inteiro. (2) `semDadoPessoal` (`app.ts`) tira só a 1ª linha da pilha, mas a mensagem do Prisma tem várias linhas e pode trazer os valores gravados: guardar só as linhas `at ...`; provar com um erro real do Prisma. (3) No `ReceberModal` (`ContasReceberPage.tsx`), o efeito que renova o `opId` não depende de `caixa?.id`)* *(21/10/2026, rodada 4: corrigido o que o QA achou. Venda, abrir caixa, lançamento, terminal, conta a pagar, conta a receber, recebimento e descarte usam `reservarChave` com a impressão do pedido inteiro (o alvo da URL entra nela) ANTES das outras conferências e na mesma transação; com a chave já limpa (30 dias) fica a conferência antiga. Na venda, itens somados e ordenados, pagamentos por forma e CPF só os dígitos; o PDV, ao receber 409 de uma venda já gravada, mostra o comprovante dela e avisa (provado no sistema real com a resposta perdida). Log de erro só com as linhas "at " da pilha (provado com erro real do Prisma com nome e telefone). `ReceberModal` renova o id com o caixa. Testes: sprint6 67. Fica para o humano decidir (fora da lista da tarefa, achado do QA): `POST /clientes`, `POST /lotes` e `POST /lotes/:id/itens` ainda comparam só parte do conteúdo; e transferência, baixa e ajuste não têm registro próprio, então um reenvio depois de 30 dias (chave limpa) faria de novo)*
- [x] S6-15 Vendedor sem `clientes.gerenciar` (migração nova): no PDV continua cadastrando e buscando o cliente do fiado, mas não lista nem edita a base de clientes *(21/10/2026: migração 0014 feita, provada na API (sprint6) e no sistema real (menu sem Clientes/Cadastros, `/cadastros` direto não abre). Falta (QA do Sonnet): `POST /clientes/busca` com termo vazio devolve até 50 clientes com telefone a quem só tem `caixa.operar`; exigir termo com pelo menos 3 caracteres para esse caso, sem mudar quem tem `clientes.gerenciar`)* *(21/10/2026, rodada 4: busca com termo de 3 ou mais para quem só tem `caixa.operar` (`TERMO_CURTO`); o Financeiro e o Admin continuam com a busca vazia para lançar a conta; PDV busca a partir de 3; mock igual)*
- [x] S6-16 Vendedor (só `caixa.operar`) consulta o código sem os dados do doador: sem parceiro, campanha, lote e saldo de Doações *(21/10/2026: DTO reduzido em `GET /itens/codigo/:codigo` com `estaEmDoacoes`; sprint6 e roteiro no sistema real (a resposta que chega ao navegador do Vendedor não tem doador; o PDV avisa "está no estoque de Doações"); QA do Sonnet e do Copilot sem defeito)*
- [x] S6-17 Carga inicial de estoque só uma vez: depois da primeira, a API recusa (estoque novo só por lote e aprovação) *(21/10/2026: feita (409 `CARGA_JA_FEITA` e índice `uq_lote_saldo_inicial_unico`), sprint5 121 e SQL 13 6/6. Decisão do humano: linhas recusadas na carga entram depois por lote com aprovação (fica como está). Falta (QA do Sonnet): se todas as linhas válidas falharem ao gravar, o lote de saldo inicial fica vazio e trava a carga para sempre; como nada se apaga, criar o lote junto da primeira linha gravada. Anotado sem correção: a 0014 falha num banco que já tenha dois lotes de saldo inicial; hoje só há o banco de teste, recriado a cada bateria)* *(21/10/2026, rodada 4: o lote nasce na transação da primeira linha gravada; sem linha gravada, nenhum lote. Provado no banco de teste com um gatilho temporário: todas as linhas falham → 0 lotes; depois grava; terceira vez 409 `CARGA_JA_FEITA`)*

Ajustes do caixa e do fiado (decisões do humano em 21/10/2026, depois do roteiro do Vendedor no sistema real)
- [x] S6-18 Abrir caixa: o terminal com caixa aberto aparece na lista como "aberto com Ana" (**só o primeiro nome**, decisão do humano) e não dá para escolher; a recusa diz qual terminal e com quem está ("O Caixa 1 já está aberto com Ana. Escolha outro terminal."), sem o código interno (ref.). Separar os dois casos que hoje são um `CAIXA_JA_ABERTO` só: terminal ocupado por outra pessoa × a própria pessoa já tem caixa aberto (esse continua levando direto ao PDV). A regra já vale no banco (0002, `ux_caixa_aberto_por_terminal` e `ux_caixa_aberto_por_operador`) e na API; na corrida (dois abrindo ao mesmo tempo) o índice recusa: traduzir pelo nome do índice e buscar o nome de quem ocupa **fora** da transação abortada. Ao receber a recusa, a tela recarrega a lista. `GET /terminais` para quem só tem `caixa.operar` ganha `ocupadoPor` (primeiro nome) e nada mais (sem id do caixa, do operador, fundo ou hora). Mock igual. Testes: dois abrindo o mesmo terminal em paralelo (um 201, um 409 com o nome), a mesma pessoa em dois terminais, o JSON de `/terminais` do Vendedor inteiro, terminal liberado ao fechar, Estoquista 403, tela com o ocupado desativado *(21/10/2026: feita com a S6-21. `TERMINAL_OCUPADO` com o primeiro nome ("O Caixa 1 já está aberto com Ana. Escolha outro terminal.") separado de `CAIXA_JA_ABERTO` (a própria pessoa volta ao PDV); na corrida, traduzido pelo índice e relido fora da transação; `GET /terminais` com `ocupadoPor` (só de outra pessoa) e nada mais; lista com o ocupado desativado; mock igual. Testes: sprint6 (corrida de dois no mesmo terminal, a mesma pessoa em dois, JSON exato do Vendedor, liberado ao fechar), smoke 159, sistema real)*
- [x] S6-19 Sangria e fechamento **às cegas**, como no mercado, **sem senha de supervisor** (P-09; decisões do humano em 21/10/2026). Regra: **o dono de um caixa ABERTO nunca vê o dinheiro esperado nem o da gaveta, qualquer que seja o perfil (o Admin também, no caixa dele)**; quem não é o dono e tem `relatorios.consultar` vê o esperado dos caixas dos outros (Caixas do dia, painéis); depois de FECHADO, o dono vê esperado e diferença. Sangria: digita o valor sem ver o saldo; acima do que há, a API recusa **sem número** na mensagem, e cada sangria recusada vai para a auditoria (valor tentado, sem o saldo), porque testar valores revela o saldo (limite aceito). **Fechamento definitivo** (decisão do humano): a pessoa informa o contado, confirma ("Você contou R$ X. Depois de confirmar, o caixa fecha e não dá para mudar"), o caixa **fecha na hora** e só então aparecem esperado e diferença; com diferença, a justificativa é pedida em seguida, **uma vez só** (rota nova para a justificativa do caixa fechado; o banco recusa mudar depois; migração nova, nunca editar 0001 a 0003). Lugares que hoje mostram o esperado ou a gaveta a quem opera (todos entram): `GET /caixas/:id/previa-fechamento`, `GET /caixas/:id/resumo` (botão "Total do caixa" do PDV, `ResumoCaixaModal`), `GET /caixas/:id/linha-do-tempo` (`gavetaAgora`, `gavetaApos`), `GET /caixas/:id/fechamento.pdf` com o caixa aberto, a mensagem `SANGRIA_ACIMA_SALDO` ("Disponível: X", em `caixa.service.ts`, usada também por `POST /contas-pagar/:id/pagar` com `saiuDoCaixa`), a mensagem `OBSERVACAO_OBRIGATORIA` do fechar ("Esperado X, contado Y"), `LancamentoModal.tsx` ("Dinheiro na gaveta agora"), `FecharCaixaPage.tsx` (esperado e diferença ao vivo), `/painel/admin` (`caixasAbertos.esperadoDinheiro`, tirar o caixa do próprio Admin) e a API simulada (`mocks/server.ts`). Limite inevitável: quem opera ainda pode somar as próprias vendas. Testes: cada rota acima para o Vendedor e para o Admin dono com o caixa aberto, sangria e conta paga do caixa acima do saldo sem número, fechar sem diferença, com diferença e justificativa depois, segunda justificativa recusada, Admin/Financeiro vendo o esperado do caixa de outro, dono vendo depois de fechado; reescrever os testes que leem a prévia (`reteste-qa.ts`, smoke) para ler pelo caixa fechado ou por outro usuário. **Decisões e desenho de 21/10/2026 (depois da análise do QA, Sonnet e Copilot):** (a) **tirar o botão "Total do caixa" do PDV** (decisão do humano: os totais por forma deixam somar a gaveta; o vendedor vê tudo depois de fechar); (b) **justificativa pendente**: pedida na mesma tela logo depois de fechar; se a pessoa sair sem justificar, um aviso aparece no próximo acesso ("Seu caixa fechou com diferença de R$ X. Justifique.") até ela responder; **só quem fechou justifica**; Admin e Financeiro veem "sem justificativa" em Caixas do dia; **não bloqueia** abrir caixa novo (decisão do humano); caixas fechados antes da 0016 nunca ficam pendentes; (c) banco (0016): o CHECK `ck_caixa_fechamento` (0002) exige observação para fechar com diferença e o gatilho `fn_valida_alteracao_caixa` (0002) não deixa mudar nada em caixa fechado: a 0016 recria o CHECK sem a observação e troca a função para aceitar, em caixa FECHADO, só a gravação única da justificativa (colunas novas `justificativa_diferenca`, `justificada_em`, `justificada_por_id`; `observacao` fica para o histórico); (d) `POST /caixas/:id/fechar` com `{ id, contado }` (id da operação gerado na tela, nunca o id do caixa, que já é a chave da abertura) e `reservarChave`; `POST /caixas/:id/justificativa` só para quem fechou; (e) a auditoria da sangria recusada é gravada **fora** da transação que recusa (senão o rollback leva junto), nas duas portas (lançamento e conta paga com dinheiro do caixa); (f) `caixaVisivel`: dono com caixa ABERTO recebe 403, mesmo com `relatorios.consultar` *(21/10/2026: feita. Migração 0016 (colunas da justificativa, CHECK sem a observação, gatilho que aceita só a justificativa única de quem fechou e recusa a de caixa que já tem a observação antiga, índice das pendências); rotas `fechar` `{id, contado}`, `justificativa` e `minhas-pendencias`; `previa-fechamento` removida; `ResumoCaixaModal` apagado com o botão. Verificado: typecheck e build; bateria completa em banco novo (smoke 165, concorrencia 5, reteste 37, perfis 252, cpf 37, produto 49, sprint3 46, sprint4 22, sprint5 122, sprint6 111; SQL 04 e 08 a 15 sem falha, 15: 15/15; 07 sem divergência); 9 testes de tela (inclusive o novo `cegas-ui.mjs`); sistema real 9/9 (Vendedor abre com R$ 30, sangria de R$ 40 recusada sem número, sangria de R$ 10, Admin vê R$ 20,00, fecha com R$ 18, falta de R$ 2,00, justifica) e a tela Caixas sem o Detalhe no caixa aberto do próprio Admin. Achado no caminho: o teste do painel chamava `/painel/admin` sem o período (400) e passava sem testar nada; agora manda o dia e exige 200. QA do Sonnet e do Copilot depois: aceitos o Detalhe da tela Caixas no próprio caixa aberto (abria só com erro), a justificativa no banco para caixa com a observação antiga e o caixa da sangria recusada na conta paga guardado dentro da transação (antes buscava de novo e podia pegar outro caixa); recusados a falha da auditoria da recusa engolida (relançar trocaria o 409 por um 500, e a recusa não mudou nada) e os detalhes da auditoria no mock (o mock não guarda detalhe em nenhuma ação))*
- [x] S6-20 Recebimento do fiado (Admin e Financeiro, como hoje; todas as formas): em dinheiro, informa o **valor recebido** e a tela mostra o **troco**, como no PDV; só o valor da dívida entra no caixa e na conta (P-11). Migração nova: `recebimento.valor_recebido` (nulo) e `troco` (padrão 0), com CHECK (dinheiro: recebido ≥ valor; outras formas: ausente ou igual ao valor; troco = recebido − valor). `valorRecebido` opcional no corpo (ausente = valor); o servidor valida e calcula o troco (`TROCO_INVALIDO`, como na venda); o `.strict()` exige pôr o campo no schema. Parcial: o troco é sobre a parcela, nunca sobre o saldo; `valor ≤ saldo` continua, o recebido pode passar do saldo. O esperado da gaveta e os relatórios continuam somando só `valor`; o estorno devolve só `valor`. Fora do caixa, o troco é só informativo. Reenvio: o novo campo entra na impressão (S6-14). Tela: "Valor recebido" e "Troco" só em dinheiro; o `opId` renova quando o recebido muda. Testes: troco com caixa (esperado sobe só a dívida), recebido menor (400), PIX/cartão com recebido diferente (400), parcial com troco, reenvio igual (200) e com outro recebido (409), estorno, Vendedor 403, SQL dos CHECKs, testes antigos com o corpo novo *(21/10/2026: feita. Decisões do humano no mesmo dia: rótulos "Valor a receber" (a parte da dívida) e "Valor recebido" (o que o cliente entregou; em branco = o valor), o recebido e o troco aparecem no extrato e na linha do tempo do caixa (como na venda) e, sem caixa aberto, a tela mostra o troco igual. Desenho igual ao da venda: `valor_recebido` só em dinheiro (nulo em PIX, cartão e nos antigos), sempre valor + troco (CHECKs `ck_receb_troco` e `ck_receb_dinheiro`); o recebido é obrigatório em dinheiro só no INSERT (gatilho), para não barrar o estorno de recebimento antigo; o recebido e o troco não mudam depois. Erros como na venda: `RECEBIDO_INSUFICIENTE` e `TROCO_INVALIDO`. Verificado: typecheck e build; bateria completa em banco novo (smoke 166, concorrencia 5, reteste 37, perfis 252, cpf 37, produto 49, sprint3 46, sprint4 22, sprint5 122, sprint6 133 com 22 da S6-20; SQL 04 e 08 a 16 sem falha, 16_testes_0017: 13/13; 07 sem divergência); 10 testes de tela (novo `troco-fiado-ui.mjs` 8/8); sistema real 9/9 (Admin recebe R$ 12,50 com R$ 20,00 no caixa, troco R$ 7,50, o Financeiro vê o esperado subir só R$ 12,50, PIX quita sem troco) e o reenvio com a chave já limpa (envelhecida e apagada no banco) 6/6. QA do Sonnet e do Copilot antes (aceitos: travar o recebido e o troco no gatilho de imutabilidade, o recebido acima do saldo, a demonstração com o 409 do reenvio) e depois: aceito o reenvio com a chave limpa conferir o recebido também em PIX e cartão; recusados o 409 para o mesmo pedido em outro formato (é o decidido; a tela manda sempre o mesmo), as diferenças da demonstração que dão a mesma resposta, a conferência curta depois dos 30 dias (limitação anotada na S6-22) e a demonstração sem a expiração das chaves)*
- [x] S6-22 Reenvio do **cadastro de cliente e de lote** pela impressão do pedido (decisão do humano em 21/10/2026, achado do QA da S6-14): `POST /clientes`, `POST /lotes` e `POST /lotes/:id/itens` passam a usar `reservarChave` como as outras rotas; o mesmo id com outros dados responde 409 `ID_EM_USO` ("Este cadastro já foi gravado com outros dados"), em vez de "ok" com o dado antigo. Limitação anotada, sem correção (decisão do humano): transferência, baixa e ajuste dependem só da chave de idempotência, limpa depois de 30 dias; um pedido idêntico, com o mesmo id, reenviado depois disso seria feito de novo. Nenhuma tela faz isso (cada operação ganha id novo; o reenvio é só logo depois de um erro), e produtos, saldos e histórico nunca se apagam *(21/10/2026: feita. Achado no caminho: o cadastro de cliente (Cadastros e o rápido do PDV) e o Novo lote geravam um id novo a cada clique, então a resposta perdida + clique de novo criava um segundo cliente/lote; agora o id fica numa ref e só renova depois do sucesso. API simulada igual (com o usuário na impressão). Verificado: typecheck; bateria completa verde; banco novo + smoke 159 + sprint6 82/82 (15 da S6-22, inclusive o recusado por validação e reenviado corrigido com o mesmo id); 8 testes de tela; sistema real 7/7 (resposta perdida no cliente e no lote: um só no banco, o mesmo id no reenvio; no cliente, o 2º clique também mostra "Este telefone já está cadastrado"). QA do Sonnet e do Copilot: aceito o usuário na impressão do mock; recusados a tela parada no 409 até fechar (é o "avisar" decidido; renovar o id criaria a duplicata), a comparação curta depois da limpeza de 30 dias (limitação anotada) e o telefone sem normalizar no mock (a tela reenvia o mesmo texto))*
- [x] S6-21 **Terminal fixo no usuário** (decisões do humano em 21/10/2026): o Admin define, no cadastro do usuário, um terminal **opcional** ("Ana → Caixa 1"); vários usuários podem ter o mesmo terminal (turnos). O terminal vai com a pessoa, não com a máquina: ao entrar em qualquer computador ou celular, quem tem terminal vai direto para "Abrir caixa · Caixa 1" e só digita o troco (sem lista); se já tem caixa aberto, continua nele (o PDV já retoma pelo `GET /caixas/atual`). Se o terminal dela estiver aberto com outra pessoa: "O Caixa 1 já está aberto com Maria. Peça para ela fechar ou fale com o Administrador." Quem não tem terminal (ex.: o Admin, ou um vendedor novo) escolhe na lista da S6-18. **A regra vale no servidor**: quem tem terminal definido não abre outro, nem chamando a API direto (403). Terminal desativado ou definido para um usuário desativado: a tela avisa e manda falar com o Admin. Migração nova: `usuario.terminal_id` (nulo, FK para `terminal`); `POST/PATCH /usuarios` e a tela de Usuários com o campo; `GET /auth/me` (ou o login) devolve o terminal; mock igual. Fazer junto com a S6-18 (a mesma tela). Corrigir junto: depois da troca de senha do primeiro acesso o Vendedor cai no Início, e o `README_MVP.md` diz que ele entra direto no PDV. Testes: Vendedor com terminal abre direto; tenta abrir outro terminal pela API (403); terminal ocupado por outro (mensagem com o primeiro nome); troca de aparelho com o caixa aberto continua no mesmo caixa; sem terminal escolhe na lista; Admin define e tira o terminal; perfis sem `usuarios.gerenciar` 403 *(21/10/2026: migração 0015 (`usuario.terminal_id`, gatilho `TERMINAL_DO_USUARIO`, `database/14_testes_0015.sql` 8/8, `01_ddl_completo.sql` até a 0015); Usuários com o campo (criar e lista); `/me` com o terminal; abrir caixa direto no terminal da pessoa, 403 em outro (também pela API), aviso de terminal desativado ou ocupado, a tela relê o terminal se o Admin trocar (achado do QA); depois da troca de senha do primeiro acesso o Vendedor vai ao PDV (`destino.ts`). Sistema real: 10/10 + 4/4 (troca do terminal com a tela aberta); demonstração 2/2. QA do Sonnet antes (24 pontos, quase todos aceitos) e depois (1 defeito, corrigido; 1 teste a mais, feito))*

**Onde a Sprint 6 está (atualizado em 21/10/2026, rodada 4) e por onde continuar:**
- **Feito e verificado:** S6-01 a S6-06, S6-09 a S6-18 e S6-21 (o terminal fixo e o terminal ocupado entraram no `main` com a migração 0015).
- **Falta codar, nesta ordem (atualizado em 21/10/2026, depois da conferência local):** (0) ~~S6-22~~ feita; (1) ~~S6-19~~ feita (migração 0016); (2) ~~S6-20~~ feita (migração 0017). Tudo o que era de codar na Sprint 6 está feito; ficam S6-07 e S6-08 (do humano) e o commit, com a ordem do humano.
- **Decidido pelo humano em 21/10/2026:** a idempotência do cadastro de cliente e de lote virou a S6-22; os 30 dias da chave ficam só anotados (na S6-22); na S6-19, sai o botão "Total do caixa" e a justificativa pendente aparece como aviso até ser feita.
- **Com o humano:** S6-07 (demonstração ao grupo e ao professor) e S6-08 (registrar os ajustes pedidos e a decisão de validar). A Sprint 7 só começa depois da S6-08.
- **Como fazer cada tarefa:** o QA (agente que o humano escolher; nesta sessão foi o Sonnet) analisa ANTES de codar; testes novos no `apps/api/tests/sprint6.ts` (rodar logo depois do smoke, porque gasta estoque); bateria completa em banco de TESTE novo, na ordem do README; sistema real (front 5173 em modo real + API 3100) com cada perfil afetado; revisão do QA depois, com cada achado conferido no código. Commit sem `Co-Authored-By`.

### Sprint 7 — Documentação oficial (14/12 a 20/12)
**Objetivo:** o documento oficial de cada tela. Só começa depois de S6-08.

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
- [x] P-09 O Vendedor pode **ver** o limite da sangria? Decidido pelo humano em 21/10/2026: **não**. Sangria e fechamento às cegas, como no mercado, sem senha de supervisor (S6-19)
- [x] P-10 Pagar conta "com dinheiro do caixa" e receber fiado na gaveta exigem caixa aberto de quem faz. Decidido em 19/10/2026: o **Administrador** pode abrir caixa (S1B-16). O Financeiro continua sem caixa; se ele precisar dessas duas operações na gaveta, o Admin ou um perfil personalizado as faz
- [x] P-11 Recebimento de fiado em dinheiro: informar o valor recebido e calcular o troco, como na venda? Decidido pelo humano em 21/10/2026: **sim** (S6-20). Quem recebe continua sendo o Admin e o Financeiro, em todas as formas
- [x] P-12 CPF e limite: o limite é em **valor (R$) por CPF por mês**, por exemplo R$ 2.000 ou R$ 5.000 (decidido pelo humano em 19/10/2026). **O Admin decide, em Parâmetros, se o CPF é obrigatório** (decidido em 19/10/2026). Se não for obrigatório, sem CPF o limite não vale para aquela venda.
- [x] P-13 Esc no PDV com o campo do código vazio tira uma unidade da última linha. Decidido em 19/10/2026: **pedir confirmação** antes de tirar (tarefa S4-19)
- [x] P-14 Decisões da Sprint 2 (19/10/2026): a **venda por categoria continua** ao lado do produto de código único (21/10/2026: o humano pediu para tirá-la da tela do PDV, S6-09; a API continua); item **devolvido** pelo Admin fica editável e o estoquista reenvia; a nova entrada **não muda o preço** (o preço é do produto; mudar é a S3-08); no lote de doação a **campanha é opcional** e o parceiro do lote não precisa ser o da campanha
- [x] P-16 Quem aprova a entrada no estoque: **Admin e Estoquista** (decidido em 20/10/2026, muda a decisão da Sprint 2 de só o Admin). O Estoquista não aprova nem devolve o item que ele mesmo cadastrou; o Admin aprova qualquer um (S3-22)
- [x] P-17 Valor potencial do relatório de posição de estoque: continua pelo **preço normal** do produto, sem o desconto (decidido pelo humano em 20/10/2026)
- [x] P-18 Decisões da Sprint 4 (humano, 20/10/2026): a etiqueta imprime **só o preço normal** do produto (o desconto aparece no caixa; não obriga reetiquetar); rolo padrão **50 × 30 mm** até a impressora chegar (o Admin muda); o histórico de impressão (S4-05) vai **na auditoria**, sem tabela nova; dá para imprimir etiqueta de **qualquer produto ativo**, mesmo sem saldo no Bazar; código de barras passa de Code 39 para **Code 128** (as etiquetas já coladas continuam lidas); permissão nova **Imprimir etiquetas** (Admin e Estoquista, como a S1-11 previa). PDV: `n*código` acima do saldo é **recusado inteiro** com aviso (21/10/2026: trocado pela S6-11, lança o que há e avisa); "restam N" **só na mensagem do bip**; a confirmação do Esc abre com o foco em **Cancelar**, tira com **S** ou clique em **Tirar**, ignora a digitação rápida do leitor e vale também para o botão "Remover último"
- [x] P-19 Decisões da Sprint 5 (humano, 20/10/2026): a importação de lote **grava as linhas válidas** e mostra as aceitas e as recusadas com destaque diferente, cada recusada com o motivo; **todas as importações gravam as válidas** (cadastros e carga inicial também, que antes eram tudo ou nada; decidido na S5-05); a NF-e **cadastra o emitente** como parceiro automaticamente quando ele não existe e vira **lote de compra** com a conta a pagar no valor da nota; "Nova compra" entra no menu do Financeiro (S5-11); **Caixas do dia e Fechamentos de caixa numa tela só**, com filtro (S5-06 e S5-09); gráficos **feitos no projeto**, sem biblioteca, com as cores da identidade visual; o dashboard do Admin fica na tela inicial **junto com os atalhos**; o **Financeiro cadastra o fornecedor** novo na hora da compra (editar parceiro continua só com o Admin); o **CNPJ alfanumérico** vale onde já se aceita CNPJ (parceiro, importação de parceiros, emitente da NF-e e instituição; escolha do Claude, a pedido do humano); a câmera fica nesta sprint se der para testar e validar (no computador pela webcam em `localhost`; no celular depende de HTTPS, P-03)
- [x] P-20 Importação da NF-e (S5-04): o humano deixou a decisão com o Claude (20/10/2026, "faça o que achar melhor"). Ficou assim: **quem importa** é quem tem contas a pagar (Admin e Financeiro; criar o fornecedor novo exige `parceiros.criar`); a nota **cria o lote de compra** com a conta a pagar no **valor total da nota**, vencendo na **primeira parcela** (sem parcela, na emissão; uma conta por lote, como na Nova compra); os **produtos não viram itens** (a NF-e não traz categoria nem preço de venda): vão listados na observação do lote e o estoque os cadastra; **recusa** nota sem protocolo de autorização, cancelada, de homologação (aceita só fora de produção, para testes), NFC-e, de entrada própria, de outro destinatário (quando a instituição tem CNPJ) e de fornecedor desativado; o **XML não é guardado** (o anexo continua PDF ou imagem). A nota entra inteira ou é recusada inteira, com o motivo (não é planilha de linhas)
- [x] P-15 Admin sem segundo aprovador: decidido em 19/10/2026 que o cancelamento **pede motivo**. Já é assim para todos os perfis (mínimo de 5 caracteres, testado no smoke); nada a mudar

## 4. Riscos
- **Prazo:** são 7 sprints de construção até a validação (a Sprint 1B e os dashboards acrescentaram uma semana; o plano termina na semana de 14/12 a 20/12). Os itens marcados como corte possível saem primeiro; se a Sprint 1B ficar grande, as tarefas S1B-09 a S1B-12 voltam para a Sprint 4.
- **Modelo de produto (Sprint 2):** mexe no estoque, na venda e na prestação de contas. É a mudança de maior risco; os testes de concorrência e de PEPS são obrigatórios.
- **Migrações:** as migrações 0001 a 0003 não podem ser editadas (o checksum quebra); toda mudança de banco entra em migração nova.
- **Câmera no celular:** depende de HTTPS (P-03).
- **Documentação das regras:** o arquivo de regras de negócio original não está no repositório e será reconstruído (S7-01).
