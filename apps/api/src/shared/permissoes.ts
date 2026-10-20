/** Lista fixa de permissões (D-10). Os códigos são os do contrato do front-end (api/types.ts). */
export const PERMISSOES = [
  'usuarios.gerenciar', 'perfis.gerenciar', 'auditoria.consultar',
  'cadastros.gerenciar', 'cadastros.consultar', 'clientes.gerenciar', 'parametros.gerenciar',
  'entrada.registrar', 'triagem.reabrir', 'produtos.aprovar', 'parceiros.criar',
  'estoque.consultar', 'estoque.transferir', 'estoque.ajustar', 'custo.consultar', 'produtos.preco', 'produtos.desconto', 'etiquetas.imprimir',
  'caixa.operar', 'venda.cancelar', 'venda.desconto_autorizar', 'terminais.gerenciar',
  'contas_pagar.gerenciar', 'contas_receber.receber', 'contas_receber.lancar', 'recebimento.estornar',
  'relatorios.consultar', 'relatorios.estoque', 'fiscal.gerenciar', 'privacidade.gerenciar',
] as const;
export type Permissao = (typeof PERMISSOES)[number];

/** Perfil padrão Administrador (id fixo das migrações). */
export const PERFIL_ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';

/** Regra de acesso declarada por TODA rota (fail secure: rota sem regra não sobe). */
export type RegraAcesso = 'publica' | 'autenticado' | readonly Permissao[];
