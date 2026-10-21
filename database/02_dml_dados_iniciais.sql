-- =====================================================================================
-- DML — dados de referência e da primeira instalação (idempotente: pode rodar de novo)
-- Os mesmos dados já entram pelas migrações (0002 e seguintes); este arquivo serve para conferir/restaurar
-- a carga de referência num banco existente. Reflete as migrações 0001 a 0013 (perfis, permissões e parâmetros
-- de hoje). Só ACRESCENTA o que falta: não muda o que o Administrador alterou. Rodar com o papel DONO.
--   psql -v ON_ERROR_STOP=1 -1 -d bazar -f database/02_dml_dados_iniciais.sql
-- O usuário Administrador NÃO é criado aqui (senha precisa de hash argon2id): use
--   ADMIN_INITIAL_PASSWORD=... npm run db:seed     (troca obrigatória no 1º acesso)
-- =====================================================================================

-- estoques físicos (ids fixos: a API e as views usam 1 = BAZAR, 2 = DOACOES)
INSERT INTO local_estoque (id, codigo, nome, permite_venda) VALUES
  (1, 'BAZAR', 'Estoque do bazar', true),
  (2, 'DOACOES', 'Estoque de doações', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ dados iniciais
INSERT INTO permissao (codigo, modulo, descricao) VALUES
  ('usuarios.gerenciar', 'ACS', 'Usuários e redefinição de senha'),
  ('perfis.gerenciar', 'ACS', 'Perfis, permissões e limite de desconto'),
  ('auditoria.consultar', 'ACS', 'Trilha de auditoria'),
  ('cadastros.gerenciar', 'CAD', 'Categorias, parceiros, campanhas, motivos, importação'),
  ('cadastros.consultar', 'CAD', 'Consultar cadastros'),
  ('clientes.gerenciar', 'CAD', 'Clientes'),
  ('parametros.gerenciar', 'ADM', 'Parâmetros e dados da instituição'),
  ('entrada.registrar', 'ENT', 'Lotes, itens aprovados, descartes, etiquetas, encerrar triagem'),
  ('triagem.reabrir', 'TRI', 'Reabrir lote, reverter descarte'),
  ('estoque.consultar', 'EST', 'Estoque e histórico do item'),
  ('estoque.transferir', 'EST', 'Transferir entre bazar e doações'),
  ('estoque.ajustar', 'EST', 'Baixa, ajuste, preço, carga inicial'),
  ('caixa.operar', 'PDV', 'Abrir/fechar caixa, vender, sangria, suprimento'),
  ('venda.cancelar', 'PDV', 'Cancelar venda'),
  ('venda.desconto_autorizar', 'PDV', 'Desconto acima do limite do perfil'),
  ('terminais.gerenciar', 'CXA', 'Pontos de caixa'),
  ('contas_pagar.gerenciar', 'FIN', 'Contas a pagar e lote de compra'),
  ('contas_receber.receber', 'FIN', 'Receber fiado, extrato do cliente'),
  ('contas_receber.lancar', 'FIN', 'Conta a receber manual'),
  ('recebimento.estornar', 'FIN', 'Estornar recebimento'),
  ('relatorios.consultar', 'REL', 'Relatórios, prestação de contas, histórico de caixas'),
  ('fiscal.gerenciar', 'FIS', 'Regra de imposto'),
  ('privacidade.gerenciar', 'PRV', 'Exportar e anonimizar titulares'),
  ('relatorios.estoque', 'REL', 'Relatórios de estoque, descartes e transferências'),
  ('produtos.aprovar', 'ENT', 'Aprovar ou devolver os produtos cadastrados nos lotes'),
  ('parceiros.criar', 'CAD', 'Criar parceiro (doador ou fornecedor) ao registrar o lote ou a compra'),
  ('custo.consultar', 'EST', 'Ver o custo (valor atribuído) dos produtos, das entradas e dos relatórios de estoque'),
  ('produtos.preco', 'EST', 'Alterar o preço de venda do produto, com motivo'),
  ('produtos.desconto', 'EST', 'Dar e encerrar desconto no produto (percentual ou preço promocional), com motivo'),
  ('etiquetas.imprimir', 'EST', 'Imprimir etiquetas dos produtos (título, preço e código de barras)')
ON CONFLICT (codigo) DO NOTHING;

-- os quatro perfis padrão (0005): Caixa virou Vendedor e Triagem virou Estoquista, com os mesmos ids
INSERT INTO perfil (id, nome, descricao, padrao, limite_desconto_pct) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Administrador', 'Gestão do bazar', true, 100),
  ('00000000-0000-4000-8000-0000000000a2', 'Vendedor', 'Opera o PDV: vende e abre e fecha o próprio caixa', true, 0),
  ('00000000-0000-4000-8000-0000000000a3', 'Estoquista', 'Entradas, cadastro de produtos e estoque (tudo que não é venda nem financeiro)', true, 0),
  ('00000000-0000-4000-8000-0000000000a4', 'Financeiro', 'Contas a pagar e a receber, fluxo de caixa e relatórios', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissao (perfil_id, permissao_codigo)
SELECT '00000000-0000-4000-8000-0000000000a1', codigo FROM permissao
ON CONFLICT DO NOTHING;
-- Vendedor (a2), Estoquista (a3) e Financeiro (a4), como na matriz do plano
INSERT INTO perfil_permissao (perfil_id, permissao_codigo)
SELECT p, unnest(c) FROM (VALUES
  ('00000000-0000-4000-8000-0000000000a2'::uuid, ARRAY['caixa.operar']), -- sem clientes.gerenciar desde a 0014 (S6-15)
  ('00000000-0000-4000-8000-0000000000a3'::uuid, ARRAY['cadastros.consultar', 'custo.consultar', 'entrada.registrar', 'estoque.consultar', 'estoque.transferir',
                                                     'etiquetas.imprimir', 'parceiros.criar', 'produtos.aprovar', 'produtos.preco', 'relatorios.estoque']),
  ('00000000-0000-4000-8000-0000000000a4'::uuid, ARRAY['contas_pagar.gerenciar', 'contas_receber.lancar', 'contas_receber.receber', 'custo.consultar', 'estoque.consultar',
                                                     'parceiros.criar', 'produtos.desconto', 'relatorios.consultar', 'relatorios.estoque'])
) AS t(p, c)
ON CONFLICT DO NOTHING;

INSERT INTO parceiro (id, nome, tipo, nao_identificado, atualizado_em)
VALUES ('00000000-0000-4000-8000-0000000000b1', 'Doador não identificado', 'OUTRO', true, now())
ON CONFLICT DO NOTHING;

INSERT INTO motivo_descarte (id, nome) VALUES (gen_random_uuid(), 'Defeito'), (gen_random_uuid(), 'Incompleto') ON CONFLICT (nome) DO NOTHING;
INSERT INTO motivo_baixa (id, nome) VALUES (gen_random_uuid(), 'Avaria'), (gen_random_uuid(), 'Perda') ON CONFLICT (nome) DO NOTHING;

-- reembolso em dinheiro de caixa fechado vira saída paga no financeiro (0005)
INSERT INTO categoria_despesa (id, nome) VALUES ('00000000-0000-4000-8000-0000000000c1', 'Reembolso de venda') ON CONFLICT DO NOTHING;

INSERT INTO parametro (chave, valor, descricao) VALUES
  ('fiado.prazo_dias', '', 'Prazo padrão do fiado em dias (PA-07)'),
  ('alerta.vencimento_dias', '3', 'Avisar contas a pagar com vencimento em até N dias'),
  ('sessao.timeout_min', '30', 'Tempo de inatividade da sessão em minutos (PA-17)'),
  ('senha.tamanho_minimo', '8', 'Tamanho mínimo da senha (PA-17)'),
  ('anexo.tamanho_max_mb', '5', 'Tamanho máximo do anexo do lote em MB (RNF-18)'),
  ('cpf.limite_mensal', '0', 'Limite de compras por CPF no mês, em reais (0 = sem limite)'),
  ('cpf.obrigatorio', '0', 'CPF obrigatório na venda (1 = sim, 0 = não)'),
  ('etiqueta.largura_mm', '50', 'Largura da etiqueta do rolo, em milímetros'),
  ('etiqueta.altura_mm', '30', 'Altura da etiqueta do rolo, em milímetros'),
  ('estoque.pouco_saldo', '5', 'Pouco saldo: o dashboard do Estoque avisa o produto com esta quantidade ou menos')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO instituicao (id, nome, uf, atualizado_em) VALUES (1, 'Associação Luz da Esperança', 'PI', now())
ON CONFLICT (id) DO NOTHING;


-- RN-17: regra fiscal GERAL ISENTO vigente (só se ainda não existir e já houver um Administrador)
INSERT INTO regra_fiscal (id, escopo, situacao, aliquota, vigencia_inicio, fundamento_legal, criada_por_id)
SELECT gen_random_uuid(), 'GERAL', 'ISENTO', 0, DATE '2026-01-01', 'Situação atual: isenta (PA-05 em análise com o contador)', u.id
FROM usuario u
WHERE u.perfil_id = '00000000-0000-4000-8000-0000000000a1' AND u.ativo
  AND NOT EXISTS (SELECT 1 FROM regra_fiscal WHERE escopo = 'GERAL')
ORDER BY u.criado_em LIMIT 1;

-- conferência
SELECT 'locais' AS item, count(*) FROM local_estoque
UNION ALL SELECT 'permissoes', count(*) FROM permissao
UNION ALL SELECT 'perfis padrão', count(*) FROM perfil WHERE padrao
UNION ALL SELECT 'parâmetros', count(*) FROM parametro
UNION ALL SELECT 'regra fiscal geral vigente', count(*) FROM regra_fiscal WHERE escopo = 'GERAL' AND vigencia_fim IS NULL;
