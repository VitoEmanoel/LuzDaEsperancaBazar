# Produto de código único, entrada por lote e aprovação (Sprint 2, S2-01)

Desenho do modelo da Sprint 2. Decisões do humano em 19/10/2026: código `BZ` + 6 dígitos (mesma sequência), venda por categoria continua, item devolvido fica editável, nova entrada não muda o preço, campanha opcional no lote (ver P-06, P-14 no plano).

## Antes (até a 0008)
- `item` é a entrada de um lote: `ETIQUETADO` (código e preço próprios, quantidade 1) ou `CATEGORIA` (sem código, preço da categoria, várias unidades).
- O item nasce já aprovado: `tg_item_exige_entrada` exige a movimentação `ENTRADA` no mesmo commit.
- O PDV vende a peça etiquetada pelo código do item e a categoria por PEPS entre os itens.

## Depois (migração 0009)
### Tabela nova `produto`
`id`, `codigo` (único, `BZ` + 6 dígitos de `seq_codigo_barras`), `titulo_etiqueta`, `nome`, `categoria_id`, `preco_venda` (> 0), `peca_unica` (sim/não), `modelo`, `marca`, `ano`, `tipo`, `tamanho`, `cor`, `condicao` (opcionais), `ativo`, `criado_por_id`, `criado_em`, `atualizado_em`.
- O preço é do produto e vale para todas as unidades (o PDV cobra sempre o preço atual).
- Peça única: só uma entrada (`item`) e no máximo 1 unidade em estoque.

### `item` passa a ser a entrada de um produto num lote
- Colunas novas: `produto_id` (obrigatório em `ETIQUETADO`, nulo em `CATEGORIA`), `status` (`CADASTRADO`, `DEVOLVIDO`, `APROVADO`), `local_destino_id` (Bazar ou Doações, usado na aprovação), `motivo_devolucao`, `aprovado_por_id`, `aprovado_em`.
- `CATEGORIA` continua igual (decisão do humano), mas também passa pela aprovação.
- Itens que já existem viram `APROVADO`. Cada item `ETIQUETADO` antigo ganha um produto com o mesmo código, o mesmo preço e `peca_unica = true`: as etiquetas impressas continuam valendo.
- `item.codigo_barras` e `item.preco_venda` ficam só nos itens antigos (não se editam); o código e o preço passam a ser lidos do produto.

### Estados e regras no banco
| Estado | Estoque | Quem muda | Pode editar |
|---|---|---|---|
| `CADASTRADO` | nada | estoquista cadastra | sim (estoquista) |
| `DEVOLVIDO` | nada | Admin devolve com motivo | sim; ao salvar volta a `CADASTRADO` |
| `APROVADO` | `ENTRADA` na aprovação | Admin aprova item ou lote | só a descrição do item (o preço é do produto) |

- `tg_item_exige_entrada` (no commit, `AFTER INSERT OR UPDATE`): item `APROVADO` tem exatamente a `ENTRADA` da quantidade inicial; item não aprovado não tem nenhuma movimentação.
- `fn_valida_movimentacao`: recusa movimentação de item não aprovado (`ITEM_NAO_APROVADO`); a regra de "no máximo 1 unidade" passa a valer só para produto de peça única (antes: todo `ETIQUETADO`), senão o estorno de um produto de várias unidades falharia.
- `fn_item_imutavel`: enquanto `CADASTRADO` ou `DEVOLVIDO` o item pode ser editado; depois de aprovado, as regras de hoje. `APROVADO` não volta atrás.
- Peça única: uma única entrada por produto e quantidade 1. O gatilho trava a linha do `produto` (`FOR UPDATE`) antes de contar, para dois cadastros simultâneos não passarem juntos.
- `ck_item_etiquetado` é reescrita: `ETIQUETADO` exige `produto_id` (código e preço próprios só nos itens antigos); `CATEGORIA` continua sem produto, código e preço.
- `ck_lote_origem`: doação exige parceiro (campanha opcional). `NOT VALID`, para não barrar lotes antigos só com campanha.
- `produto` segue o padrão das outras tabelas: sem exclusão (`fn_bloqueia_exclusao`), chaves para `usuario` com `ON DELETE RESTRICT` e `SELECT, INSERT, UPDATE` para o `bazar_api` (o `03_seguranca_papeis.sql` também cobre).
- Lote encerrado (`TRIADO`): não aceita item novo (como hoje), mas os itens dele ainda são aprovados, devolvidos e corrigidos. Encerrar o lote não exige que tudo esteja aprovado.
- Descarte revertido: o item de reversão nasce `CADASTRADO` e passa pela aprovação como os outros.
- Prestação de contas: `vw_prestacao_contas_lote`, o relatório de prestação de contas e o resumo dos lotes contam só itens `APROVADO`. O `07_manutencao_rotina.sql` passa a conferir também "item não aprovado com movimentação" (deve ser 0). Estoque e relatórios leem código e preço do produto.
- Regra fiscal por item continua apontando para a entrada (`item`); regra por produto fica fora da Sprint 2.

### API
- `POST /lotes/:id/itens` (estoquista): cadastra um item `CADASTRADO`, sem estoque. `ETIQUETADO` com produto novo (campos do produto) ou com `produtoId` de um produto que já existe (nova entrada; o preço do produto não muda; peça única recusa).
- `PATCH /lotes/:id/itens/:itemId` (estoquista): edita item `CADASTRADO` ou `DEVOLVIDO` (e o produto novo dele, se ainda não tiver unidades aprovadas); devolvido volta a `CADASTRADO`.
- `POST /itens/:id/aprovar`, `POST /lotes/:id/aprovar` (todos os `CADASTRADO` do lote) e `POST /itens/:id/devolver` com motivo: permissão nova `produtos.aprovar`, só do Administrador. Travam o item (`FOR UPDATE`) antes de mudar o estado, para não cruzar com uma edição. Tudo na auditoria.
- `GET /produtos?busca=` para achar o produto da nova entrada.
- Permissão nova `parceiros.criar` (Estoquista): cria parceiro, sem editar nem desativar.
- Venda: o item `{ codigo, quantidade }` aceita quantidade maior que 1 (recusada em peça única) e o mesmo código repetido soma. Baixa por PEPS entre as entradas aprovadas do produto com saldo no Bazar (lote mais antigo primeiro), uma linha de venda por entrada consumida: a receita continua atribuída ao parceiro de cada lote. **Travas numa ordem só:** a venda escolhe as entradas candidatas (de produtos e de categorias) e trava todas de uma vez por `item.id`, a mesma ordem do estorno (`fn_estorna_venda_cancelada`) e da gravação das movimentações; só depois lê o saldo e reparte pelo PEPS. Antes, a categoria travava na ordem do PEPS, que podia cruzar com o estorno.
- Catálogo do PDV: `itensEtiquetados` vira um por produto com saldo no Bazar. Mantém os campos de hoje (`itemId` passa a ser o id do produto, `codigo`, `descricao`, `preco`) e ganha `saldoBazar`, que o PDV atual ignora.
- Carga inicial (Admin): cria os itens já aprovados (quem carrega é o Admin); cada linha `ETIQUETADO` cria um produto de peça única, como hoje (quantidade 1). Produto de várias unidades por planilha fica para a importação (S5).

### Fora da Sprint 2
Tela de aprovação (S3-01), edição do produto e histórico (S3-04), preço com motivo (S3-08), leitura `n*código` e "restam N" no PDV (S4).
