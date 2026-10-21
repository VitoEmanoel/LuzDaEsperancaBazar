# Banco de dados — scripts do DBA

PostgreSQL 16 (compatível com 11+). Fonte da verdade do esquema: `apps/api/prisma/migrations/*` aplicadas com `npx prisma migrate deploy` (papel **bazar_owner**). Os arquivos daqui são para revisão, testes e operação.

| Arquivo | O que faz | Quem roda / onde |
|---|---|---|
| `01_ddl_completo.sql` | 0001 a 0017 concatenadas: instalação do zero sem Prisma | dono, banco **vazio** |
| `02_dml_dados_iniciais.sql` | Dados de referência idempotentes (locais, permissões, perfis, motivos, parâmetros, regra fiscal GERAL) | dono |
| `03_seguranca_papeis.sql` | Papéis `bazar_api` (sem DELETE, sem escrita no saldo, timeouts) e `bazar_relatorio` (somente leitura, sem PII). Senhas por `-v`, vindas do cofre | superusuário, **após cada deploy** |
| `04_testes_0003.sql` | 28 tentativas de violar as regras da 0003 (tudo em ROLLBACK) | superusuário, banco de teste |
| `08_testes_0009.sql` | 32 tentativas de violar as regras da 0009 (produto, entrada por lote, aprovação, peça única), mais 3 do papel da API (tudo em ROLLBACK) | superusuário, banco de teste |
| `09_testes_0010.sql` | 34 tentativas de violar as regras da 0010 (quem aprova e quem devolve, também no INSERT, ajuste só de saída, desconto e preço efetivo, desativação de perfil, auditoria do parceiro sem dado pessoal), tudo em ROLLBACK | superusuário, banco de teste (depois do `test:sprint3`) |
| `10_testes_0011.sql` | 9 conferências da 0011 (permissão de imprimir etiquetas só no Admin e no Estoquista, rolo padrão 50 x 30 mm, histórico da impressão sem dado pessoal, reaplicar sem duplicar), tudo em ROLLBACK | superusuário, banco de teste (depois do `test:sprint4`) |
| `11_testes_0012.sql` | 14 conferências da 0012 (CNPJ com letras no parceiro e na instituição, Financeiro cria parceiro, pouco saldo padrão 5, reaplicar sem duplicar), tudo em ROLLBACK | superusuário, banco de teste (depois do `test:sprint5`) |
| `12_testes_0013.sql` | 9 conferências da 0013 (chave da NF-e com 44 caracteres e CNPJ com letras, a mesma chave não entra duas vezes, só lote de compra tem nota), tudo em ROLLBACK | superusuário, banco de teste |
| `13_testes_0014.sql` | 6 conferências da 0014 (impressão do pedido na idempotência, Vendedor sem gerenciar clientes, um lote de saldo inicial só), tudo em ROLLBACK | superusuário, banco de teste |
| `14_testes_0015.sql` | 8 conferências da 0015 (terminal fixo no usuário: quem tem só abre caixa nele, sem terminal abre em qualquer um, um caixa por terminal, terminal com usuário não se apaga), tudo em ROLLBACK | superusuário, banco de teste |
| `15_testes_0016.sql` | 15 conferências da 0016 (caixa às cegas: fecha com diferença sem observação, a conta da diferença não muda depois, justificativa só de quem fechou, com texto, data e autor, uma vez só, nunca em caixa aberto, sem diferença ou com a observação antiga, e o caixa fechado continua sem reabrir), tudo em ROLLBACK | superusuário, banco de teste |
| `16_testes_0017.sql` | 13 conferências da 0017 (troco no fiado: em dinheiro o recebido é obrigatório no recebimento novo e é sempre valor + troco, PIX e cartão sem recebido nem troco, a conta abate só o valor, o recebido e o troco não mudam depois, e o recebimento antigo sem o recebido continua válido e estornável), tudo em ROLLBACK | superusuário, banco de teste |
| `05_carga_volume_teste.sql` | ~5 anos fictícios: 64 mil itens, 129 mil movimentações, 60 mil vendas (recusa rodar fora de banco de teste) | dono, banco de teste |
| `06_benchmark_queries.sql` | EXPLAIN ANALYZE das 13 consultas mais pesadas da API (SQL copiado de `apps/api/src/`) | qualquer, após o 05 |
| `07_manutencao_rotina.sql` | Limpeza de sessões/idempotência vencidas, conferência do saldo e da prestação de contas, alertas | dono, diário |

Ordem para um ambiente novo (comandos a partir da **raiz** do monorepo):

```bash
npm run db:deploy                                           # MIGRATION_DATABASE_URL = bazar_owner
psql -U postgres -d bazar -v senha_api="$SENHA_API" -f database/03_seguranca_papeis.sql
ADMIN_INITIAL_PASSWORD=... npm run db:seed
psql -U bazar_owner -d bazar -f database/07_manutencao_rotina.sql  # conferência: tudo 0
```

Regra de ouro do saldo: **ninguém escreve em `saldo_estoque`**. Toda mudança de estoque é uma linha em `movimentacao`; o trigger aplica o saldo. Divergência em `fn_confere_saldo()` = investigar a causa; só então `SELECT fn_recalcula_saldo();` (dono, janela sem vendas).
