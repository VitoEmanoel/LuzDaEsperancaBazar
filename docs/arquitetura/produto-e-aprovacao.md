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
| `APROVADO` | `ENTRADA` na aprovação | Admin aprova item ou lote | só preço e descrição, como hoje (D-16) |

- `tg_item_exige_entrada` (no commit): item `APROVADO` tem exatamente a `ENTRADA` da quantidade inicial; item não aprovado não tem nenhuma movimentação.
- `fn_valida_movimentacao`: recusa movimentação de item não aprovado (`ITEM_NAO_APROVADO`); a regra de "no máximo 1 unidade" vale para produto de peça única (antes: todo `ETIQUETADO`).
- `fn_item_imutavel`: enquanto `CADASTRADO` ou `DEVOLVIDO` o item pode ser editado; depois de aprovado, as regras de hoje. `APROVADO` não volta atrás.
- Peça única: uma única entrada por produto e quantidade 1 (gatilho no `item`).
- `ck_item_etiquetado` passa a exigir `produto_id` em `ETIQUETADO`.
- `ck_lote_origem`: doação exige parceiro (campanha opcional). `NOT VALID`, para não barrar lotes antigos só com campanha.
- `vw_prestacao_contas_lote`: conta só itens `APROVADO` (mesmas colunas). O `07_manutencao_rotina.sql` passa a conferir também "item não aprovado com movimentação" (deve ser 0).

### API
- `POST /lotes/:id/itens` (estoquista): cadastra um item `CADASTRADO`, sem estoque. `ETIQUETADO` com produto novo (campos do produto) ou com `produtoId` de um produto que já existe (nova entrada; o preço do produto não muda; peça única recusa).
- `PATCH /lotes/:id/itens/:itemId` (estoquista): edita item `CADASTRADO` ou `DEVOLVIDO` (e o produto novo dele, se ainda não tiver unidades aprovadas); devolvido volta a `CADASTRADO`.
- `POST /itens/:id/aprovar`, `POST /lotes/:id/aprovar` (todos os `CADASTRADO` do lote) e `POST /itens/:id/devolver` com motivo: permissão nova `produtos.aprovar`, só do Administrador. Tudo na auditoria.
- `GET /produtos?busca=` para achar o produto da nova entrada.
- Permissão nova `parceiros.criar` (Estoquista): cria parceiro, sem editar nem desativar.
- Venda: o item `{ codigo, quantidade }` aceita quantidade maior que 1 (recusada em peça única) e o mesmo código repetido soma. Baixa por PEPS entre as entradas aprovadas do produto com saldo no Bazar (lote mais antigo primeiro), uma linha de venda por entrada consumida: a receita continua atribuída ao parceiro de cada lote. Travas em ordem fixa: produtos por código, depois categorias.
- Catálogo do PDV: `itensEtiquetados` vira um por produto com saldo no Bazar (`codigo`, `descricao`, `preco`, `saldoBazar`), sem mudar o formato que o PDV de hoje usa.
- Carga inicial (Admin): cria os itens já aprovados (quem carrega é o Admin).

### Fora da Sprint 2
Tela de aprovação (S3-01), edição do produto e histórico (S3-04), preço com motivo (S3-08), leitura `n*código` e "restam N" no PDV (S4).
