/**
 * DTOs dos contratos da API (Especificação Técnica, seção 5).
 * Convenções: dinheiro = string "12.50"; datas = ISO 8601 com fuso; ids = UUID.
 * Quando o back-end publicar o OpenAPI, estes tipos devem ser gerados a partir dele.
 */
import type { Money } from '../lib/money';
export type { Money };
export type Uuid = string;
export type IsoDateTime = string;
/** Data local sem hora, "aaaa-mm-dd" (filtros de período, vencimentos). */
export type LocalDate = string;

// ---------- Enumerações (arquivo 04) ----------
export type TipoEntrada = 'DOACAO' | 'COMPRA' | 'SALDO_INICIAL';
export type TipoControle = 'ETIQUETADO' | 'CATEGORIA';
export type LocalEstoque = 'BAZAR' | 'DOACOES';
export type TipoMovimentacao =
  | 'ENTRADA' | 'TRANSFERENCIA' | 'VENDA' | 'ESTORNO_VENDA' | 'BAIXA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SAIDA';
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'FIADO';
export type StatusContaReceber = 'ABERTA' | 'PARCIAL' | 'QUITADA' | 'CANCELADA';

export const FORMAS_PAGAMENTO: { value: FormaPagamento; label: string }[] = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_DEBITO', label: 'Débito' },
  { value: 'CARTAO_CREDITO', label: 'Crédito' },
  { value: 'FIADO', label: 'Fiado' },
];
/** Formas válidas para receber fiado e pagar contas (fiado não quita fiado). */
export type FormaQuitacao = Exclude<FormaPagamento, 'FIADO'>;
export const FORMAS_QUITACAO = FORMAS_PAGAMENTO.filter((f): f is { value: FormaQuitacao; label: string } => f.value !== 'FIADO');

// ---------- Permissões (lista fixa de 29 — ACS) ----------
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
/** Perfil padrão Administrador (id fixo): o único que aprova o próprio cadastro (S3-22). */
export const PERFIL_ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';

// ---------- Erros (RFC 9457) ----------
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code?: string;
  detail?: string;
  requestId?: string;
  /** Erros de validação por campo ou por linha (carga/importação). */
  errors?: { campo?: string; linha?: number; mensagem: string }[];
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }

// ---------- ACS ----------
export interface Me {
  id: Uuid;
  nome: string;
  login: string;
  perfil: { id: Uuid; nome: string };
  permissoes: Permissao[];
  /** Limite de desconto do perfil em % (PA-08 pendente: confirmar se é % ou R$). */
  limiteDesconto: Money;
  trocarSenha: boolean;
}
export interface LoginResponse { accessToken: string; expiresIn: number; usuario: Me }
export interface Usuario { id: Uuid; nome: string; login: string; perfilId: Uuid; perfilNome: string; ativo: boolean }
export interface Perfil { id: Uuid; nome: string; padrao: boolean; ativo?: boolean; permissoes: Permissao[]; limiteDesconto: Money }
/** Permissão com a descrição em português e a área (para a tela de perfis agrupar: S3-18). */
export interface PermissaoInfo { codigo: Permissao; descricao: string; grupo: string }
export interface AuditoriaRegistro {
  id: Uuid; ocorridoEm: IsoDateTime; usuarioNome: string; acao: string; entidade: string; entidadeId: string;
}

// ---------- CAD ----------
export interface Categoria { id: Uuid; nome: string; precoPadrao: Money; vendaPorCategoria: boolean; ativo: boolean }
/** Categoria no catálogo do PDV: traz quanto há para vender por categoria no Bazar. */
export interface CategoriaPdv extends Categoria { saldoBazar: number }
export type TipoParceiro = 'EMPRESA' | 'LOJA' | 'PESSOA_FISICA' | 'OUTRO';
export const TIPOS_PARCEIRO: { value: TipoParceiro; label: string }[] = [
  { value: 'EMPRESA', label: 'Empresa' }, { value: 'LOJA', label: 'Loja' },
  { value: 'PESSOA_FISICA', label: 'Pessoa física' }, { value: 'OUTRO', label: 'Outro' },
];
export interface Parceiro {
  id: Uuid; nome: string; tipo?: TipoParceiro; especial?: boolean; ativo: boolean;
  /** Só na escrita: CPF (11) ou CNPJ (14), só dígitos. O servidor confere o dígito verificador. */
  documento?: string;
  /** Só na leitura: CNPJ formatado ou CPF mascarado (o servidor não devolve CPF inteiro). */
  documentoExibicao?: string;
}
export interface Campanha { id: Uuid; nome: string; inicio?: LocalDate; fim?: LocalDate; ativo: boolean }
export interface Motivo { id: Uuid; nome: string; ativo: boolean }
export interface CategoriaDespesa { id: Uuid; nome: string; ativo: boolean }
export interface Cliente {
  id: Uuid; nome: string; telefone: string; ativo: boolean;
  anonimizado?: boolean;
  /** PRV: ciência do aviso de privacidade e finalidade registradas no cadastro. */
  cienciaAviso?: boolean;
}
export interface Instituicao { nome: string; cnpj: string; endereco: string; telefone: string }

// ---------- ENT / TRI ----------
export interface LoteEntrada {
  id: Uuid;
  numero: number;
  tipo: TipoEntrada;
  parceiroId?: Uuid; parceiroNome?: string;
  campanhaId?: Uuid; campanhaNome?: string;
  documento?: string;
  temAnexo: boolean;
  /** Na NF-e importada (S5-04), a lista dos produtos da nota, para o estoque cadastrar. */
  observacao?: string;
  recebidoEm: IsoDateTime;
  status: 'ABERTO' | 'TRIADO';
  /** Unidades aprovadas pelo Administrador (só elas estão no estoque e na prestação de contas). */
  aprovados: number;
  /** Itens aguardando a aprovação e itens devolvidos ao estoquista (Sprint 2). */
  pendentes?: number;
  devolvidos?: number;
  descartados: number;
  /** Custo: só para quem pode vê-lo (S3-05). */
  valorAtribuido?: Money;
  valorCompra?: Money;
  pago?: boolean;
}
export interface NovoLoteRequest {
  id: Uuid; tipo: TipoEntrada; parceiroId?: Uuid; campanhaId?: Uuid; documento?: string;
  valorCompra?: Money; pago?: boolean; vencimento?: LocalDate;
}
/** Estado do item no lote (Sprint 2): o estoque só recebe na aprovação pelo Administrador. */
export type StatusItem = 'CADASTRADO' | 'DEVOLVIDO' | 'APROVADO';
/** Campos do produto (P-06): título da etiqueta, nome e preço obrigatórios; o resto é opcional. */
export interface CamposProduto {
  tituloEtiqueta: string; nome: string; preco: Money; pecaUnica?: boolean;
  modelo?: string; marca?: string; ano?: number; tipo?: string; tamanho?: string; cor?: string; condicao?: string;
}
export interface Produto extends CamposProduto { id: Uuid; codigo: string; categoriaId: Uuid; pecaUnica: boolean }
export interface ProdutoBusca extends Produto { categoriaNome: string; saldoBazar: number; saldoDoacoes: number }
/**
 * Item do lote. Por categoria: `preco` sugere o valor atribuído. Produto (`ETIQUETADO`): produto novo (`produto`)
 * ou nova entrada de um que já existe (`produtoId`); o valor atribuído é obrigatório.
 */
export interface TriagemItemRequest {
  id: Uuid; categoriaId: Uuid; controle: TipoControle; quantidade: number; preco?: Money;
  /** Valor UNITÁRIO para a prestação de contas (RN-33). Compra: custo unitário. */
  valorAtribuido?: Money;
  descricao?: string; localDestino: LocalEstoque;
  produtoId?: Uuid; produto?: CamposProduto;
}
/** Correção de item cadastrado ou devolvido (só os campos enviados mudam). */
export interface CorrecaoItemRequest {
  quantidade?: number; valorAtribuido?: Money; descricao?: string; localDestino?: LocalEstoque; categoriaId?: Uuid; produto?: Partial<CamposProduto>;
}
export interface ItemLote {
  id: Uuid; controle: TipoControle; codigo?: string; descricao: string; categoriaId: Uuid; categoriaNome: string;
  /** O custo só vem para quem tem a permissão de vê-lo (S3-05). */
  quantidade: number; preco: Money; valorAtribuido?: Money; localDestino: LocalEstoque;
  status: StatusItem; motivoDevolucao?: string; produto?: Produto;
  /** Quem cadastrou: só outra pessoa aprova ou devolve (o Administrador pode o próprio; S3-22). */
  criadoPorId?: Uuid;
}
/** Item na fila de aprovação (S3-01): o que espera conferência, de todos os lotes. */
export interface ItemAprovacao extends ItemLote {
  criadoPorNome: string; criadoEm: IsoDateTime; loteId: Uuid; loteNumero: number; loteTipo: TipoEntrada;
  parceiroNome?: string; campanhaNome?: string; podeConferir: boolean;
}
export interface TriagemDescarteRequest { id: Uuid; categoriaId: Uuid; motivoId: Uuid; observacao?: string }
export interface LoteDetalhe extends LoteEntrada {
  itens: ItemLote[];
  descartes: { id: Uuid; categoriaNome: string; motivoNome: string; registradoEm: IsoDateTime; revertido: boolean }[];
}
/** Etiqueta do produto (S4-02): título curto, código BZ e o preço normal (P-18); `quantidade` = cópias. */
export interface EtiquetaProduto { produtoId: Uuid; codigo: string; titulo: string; nome: string; preco: Money; quantidade: number }
export interface PedidoEtiquetas { produtos: { produtoId: Uuid; quantidade: number }[] }
/** Tamanho do rolo em milímetros (parâmetros do Admin, S4-01). */
export interface TamanhoRolo { larguraMm: number; alturaMm: number }
export interface EtiquetasPreparadas extends TamanhoRolo { itens: EtiquetaProduto[] }

// ---------- EST ----------
export interface ItemEstoque {
  id: Uuid; codigo?: string; descricao: string;
  categoriaId: Uuid; categoriaNome: string; controle: TipoControle;
  /** Preço efetivo (com o desconto vigente do produto); `precoSemDesconto` só quando há desconto (S3-10). */
  preco: Money; precoSemDesconto?: Money;
  produtoId?: Uuid; pecaUnica?: boolean;
  /** Custo unitário da entrada: só para quem pode ver custo (S3-05). */
  valorAtribuido?: Money;
  loteId: Uuid; loteNumero: number; parceiroNome?: string; campanhaNome?: string;
  saldoBazar: number; saldoDoacoes: number;
}
export interface HistoricoEvento {
  ocorridoEm: IsoDateTime; tipo: TipoMovimentacao | 'TRIAGEM'; descricao: string;
  quantidade: number; local?: LocalEstoque; usuarioNome?: string;
}
export interface TransferenciaRequest {
  id: Uuid; itemId?: Uuid; codigo?: string; quantidade: number; origem: LocalEstoque; destino: LocalEstoque; motivo?: string;
}
export interface BaixaRequest { id: Uuid; itemId: Uuid; quantidade: number; local: LocalEstoque; motivoId: Uuid }
/** O ajuste de inventário é só de saída (S3-03): o estoque só sobe por entrada aprovada. */
export interface AjusteRequest {
  id: Uuid; itemId: Uuid; local: LocalEstoque; tipo: 'AJUSTE_SAIDA'; quantidade: number; motivo: string;
}
export type TipoDesconto = 'PERCENTUAL' | 'PRECO';
/** Desconto no produto (S3-09): percentual ou preço promocional; validade opcional, até o fim do dia. */
export interface DescontoProduto { tipo: TipoDesconto; valor: Money; ate?: LocalDate; motivo?: string; porNome?: string; em?: IsoDateTime; vigente: boolean }
export interface ProdutoEntrada {
  itemId: Uuid; loteId: Uuid; loteNumero: number; recebidoEm: IsoDateTime; origem?: string; status: StatusItem;
  quantidade: number; saldoBazar: number; saldoDoacoes: number; valorAtribuido?: Money;
}
export interface ProdutoEvento {
  ocorridoEm: IsoDateTime; tipo: string; usuarioNome?: string;
  /** movimentação */ loteNumero?: number; quantidade?: number; origem?: LocalEstoque; destino?: LocalEstoque; detalhe?: string;
  /** mudança do produto (auditoria) */ antes?: Record<string, unknown>; depois?: Record<string, unknown>;
}
/** Tela do produto (S3-04). */
export interface ProdutoDetalhe extends CamposProduto {
  id: Uuid; codigo: string; categoriaId: Uuid; categoriaNome: string; precoEfetivo: Money; desconto?: DescontoProduto;
  ativo: boolean; criadoEm: IsoDateTime; saldoBazar: number; saldoDoacoes: number; entradas: ProdutoEntrada[]; eventos: ProdutoEvento[];
}

// ---------- PDV ----------
export interface CatalogoPdv {
  versao: string;
  categorias: CategoriaPdv[];
  /** Um por produto com saldo no Bazar. `itemId` é o id do produto; `saldoBazar` e `pecaUnica` vêm do servidor real (Sprint 2). */
  itensEtiquetados: { itemId: Uuid; codigo: string; descricao: string; preco: Money; precoSemDesconto?: Money; saldoBazar?: number; pecaUnica?: boolean }[];
  /** RNF-19: só nome e telefone dos clientes do fiado. */
  clientesFiado: { id: Uuid; nome: string; telefone: string }[];
  regrasFiscais: RegraFiscal[];
  fiadoPrazoDias?: number;
  /** O Administrador decide, em Parâmetros, se o CPF é obrigatório na venda e qual o limite mensal por CPF (em reais; 0 = sem limite). */
  cpfObrigatorio?: boolean;
  cpfLimiteMensal?: number;
}
/** Saldo do CPF no mês: `limite` e `saldo` são nulos quando não há limite. */
export interface SaldoCpf { cpf: string; limite: Money | null; comprado: Money; saldo: Money | null; obrigatorio: boolean }
export type VendaItemRequest =
  | { codigo: string; quantidade: number; desconto?: Money } // produto: várias unidades; peça única só 1 (o servidor confere)
  | { categoriaId: Uuid; quantidade: number; desconto?: Money };
export interface PagamentoRequest { forma: FormaPagamento; valor: Money; valorRecebido?: Money }
/** Corpo de PUT /vendas/:id — o servidor recalcula preços, total e troco. */
export interface VendaRequest {
  terminalId: Uuid;
  caixaId: Uuid;
  clienteId?: Uuid;
  /** CPF da compra (só dígitos); o servidor valida e confere o limite do mês */
  cpf?: string;
  itens: VendaItemRequest[];
  desconto?: Money;
  pagamentos: PagamentoRequest[];
  vencimentoFiado?: LocalDate;
}
export interface Venda {
  id: Uuid;
  numero: number;
  /** CPF inteiro: só vem no comprovante (nunca nas listas) e some no fim do mês */
  cpf?: string;
  ocorridaEm: IsoDateTime;
  status: 'CONCLUIDA' | 'CANCELADA';
  subtotal: Money;
  desconto: Money;
  total: Money;
  troco: Money;
  itens: { descricao: string; quantidade: number; precoUnitario: Money; total: Money; loteNumero?: number }[];
  pagamentos: PagamentoRequest[];
  operadorNome: string;
  clienteNome?: string;
  vencimentoFiado?: LocalDate;
}

// ---------- CXA ----------
export interface Terminal { id: Uuid; nome: string; ativo: boolean }
export interface CaixaSessao {
  id: Uuid; terminalId: Uuid; terminalNome: string; operadorId?: Uuid; operadorNome: string;
  abertoEm: IsoDateTime; fundoTroco: Money; status: 'ABERTO' | 'FECHADO';
  fechadoEm?: IsoDateTime; esperado?: Money; contado?: Money; diferenca?: Money; observacao?: string;
}
export interface CaixaLancamentoRequest { id: Uuid; tipo: 'SANGRIA' | 'SUPRIMENTO'; valor: Money; motivo: string }
export interface PreviaFechamento {
  fundoTroco: Money; suprimentos: Money; sangrias: Money;
  totaisPorForma: Record<FormaPagamento, Money>;
  esperadoDinheiro: Money; quantidadeVendas: number;
}
/** Cada coisa que aconteceu no caixa, da abertura ao fechamento. */
export interface EventoCaixa {
  quando: IsoDateTime;
  tipo: 'ABERTURA' | 'VENDA' | 'VENDA_CANCELADA' | 'SANGRIA' | 'SUPRIMENTO' | 'RECEBIMENTO_FIADO' | 'RECEBIMENTO_ESTORNADO' | 'FECHAMENTO';
  descricao: string; valor: Money;
  /** dinheiro que o evento põe (+) ou tira (-) da gaveta */
  efeitoDinheiro: Money;
  /** dinheiro na gaveta depois do evento (ausente em evento posterior ao fechamento) */
  gavetaApos?: Money;
  aposFechamento?: boolean;
}
export interface LinhaDoTempo { gavetaAgora: Money; eventos: EventoCaixa[] }

// ---------- FIN ----------
export interface ContaPagar {
  id: Uuid; descricao: string; categoriaDespesaId: Uuid; categoriaDespesaNome: string; valor: Money;
  vencimento: LocalDate; status: 'ABERTA' | 'PAGA' | 'CANCELADA'; pagaEm?: IsoDateTime; saiuDoCaixa?: boolean;
  formaPagamento?: FormaQuitacao;
}
export interface ContaReceber {
  id: Uuid; clienteId: Uuid; clienteNome: string; vendaNumero?: number; descricao?: string;
  valor: Money; saldo: Money; vencimento: LocalDate; status: StatusContaReceber;
}
export interface Recebimento {
  id: Uuid; contaReceberId: Uuid; valor: Money; recebidoEm: IsoDateTime; caixaId?: Uuid; estornado: boolean; forma?: FormaQuitacao;
}
export interface ExtratoCliente {
  cliente: { id: Uuid; nome: string };
  contas: ContaReceber[]; recebimentos: Recebimento[]; saldoDevedor: Money;
}
export interface ResumoFinanceiro {
  de: LocalDate; ate: LocalDate;
  entradasPorForma: Record<FormaPagamento, Money>;
  recebimentosFiado: Money; saidas: Money; resultado: Money;
  /** reembolsos em dinheiro de caixa fechado: já saíram das vendas, não descontam de novo */
  reembolsos: Money;
}

/**
 * Resultado de toda importação de planilha (S5-05, P-19): as linhas válidas são gravadas (aceitas) e as erradas voltam
 * com a linha e o motivo (recusadas). O lote também traz o item criado, o código e a quantidade.
 */
export interface ResultadoImportacao {
  total: number;
  aceitas: { linha: number; nome: string; itemId?: Uuid; codigo?: string; quantidade?: number }[];
  recusadas: { linha: number; nome: string; motivo: string }[];
}
export type TipoModelo = 'lote' | 'categorias' | 'parceiros' | 'campanhas' | 'clientes' | 'carga-inicial';

/**
 * NF-e importada (S5-04, P-20): a nota inteira vira um lote de compra com a conta a pagar (ou é recusada inteira, com o
 * motivo). Os produtos vêm só para conferência: o estoque os cadastra depois no lote.
 */
export interface ResultadoNfe {
  lote: LoteEntrada;
  fornecedor: { nome: string; novo: boolean };
  numero: string; serie: string; emissao: LocalDate; valor: Money; vencimento: LocalDate; parcelas: number;
  produtos: { item: number; nome: string; quantidade: string; unidade: string; valorUnitario: string; valorTotal: string }[];
}

// ---------- PAINEL (dashboards e fluxo de caixa, Sprint 5) ----------
export interface ContasResumo { quantidade: number; valor: Money; itens: { id: Uuid; descricao: string; valor: Money; vencimento: LocalDate }[] }
export interface ContasAPagarPainel { vencidas: ContasResumo; proximos7Dias: ContasResumo }
export interface FilaEntrada { lotesEmCadastro: number; itensAguardandoAprovacao: number }
export interface EventoSensivel { id: string; tipo: 'VENDA_CANCELADA' | 'RECEBIMENTO_ESTORNADO' | 'REEMBOLSO' | 'DIFERENCA_CAIXA'; quando: IsoDateTime; descricao: string; valor: Money }
export interface PainelAdmin {
  de: LocalDate; ate: LocalDate;
  vendas: { total: Money; quantidade: number; ticketMedio: Money; porForma: Record<FormaPagamento, Money>; porDia: { dia: LocalDate; total: Money; quantidade: number }[] };
  caixasAbertos: { id: Uuid; terminalNome: string; operadorNome: string; abertoEm: IsoDateTime; esperadoDinheiro: Money }[];
  entrada: FilaEntrada;
  estoque: { itensBazar: number; itensDoacoes: number; valorPotencial: Money; /** só com a permissão de ver custo */ valorAtribuido?: Money };
  contasPagar: ContasAPagarPainel;
  fiado: { aberto: Money; vencido: Money };
  eventos: EventoSensivel[];
}
export interface PainelEstoque {
  de: LocalDate; ate: LocalDate;
  categorias: { categoriaId: Uuid; categoria: string; bazar: number; doacoes: number }[];
  itensBazar: number; itensDoacoes: number;
  entrada: FilaEntrada; entradasHoje: number; entradas7Dias: number;
  entradasPorDia: { dia: LocalDate; quantidade: number }[];
  descartes: number;
  poucoSaldo: { limite: number; itens: { produtoId: Uuid; codigo: string; nome: string; categoria: string; saldo: number }[] };
  ultimasMovimentacoes: { id: string; tipo: string; quantidade: number; quando: IsoDateTime; descricao: string; origem?: string; destino?: string; usuarioNome: string }[];
}
export interface ResultadoPeriodo { entradas: Money; saidas: Money; resultado: Money }
export interface PainelFinanceiro {
  de: LocalDate; ate: LocalDate;
  hoje: ResultadoPeriodo; mes: ResultadoPeriodo;
  periodo: ResultadoPeriodo & { entradasPorForma: Record<FormaPagamento, Money>; recebimentosFiado: Money };
  porDia: { dia: LocalDate; entradas: Money; saidas: Money }[];
  contasPagar: ContasAPagarPainel;
  fiado: { aberto: Money; vencido: Money };
  caixasComDiferenca: { quantidade: number; itens: { id: Uuid; terminalNome: string; operadorNome: string; fechadoEm: IsoDateTime; diferenca: Money }[] };
  reembolsos: { quantidade: number; valor: Money };
}
export interface FluxoCaixa {
  de: LocalDate; ate: LocalDate; hoje: LocalDate;
  dias: { dia: LocalDate; entradas: Money; saidas: Money; aReceber: Money; aPagar: Money; saldoDoDia: Money; acumulado: Money }[];
  totais: { entradas: Money; saidas: Money; aReceber: Money; aPagar: Money; saldo: Money };
  atrasados: { aPagar: Money; aReceber: Money };
}

// ---------- FIS ----------
export interface RegraFiscal {
  id: Uuid; alvo: 'GERAL' | 'CATEGORIA' | 'ITEM'; alvoId?: Uuid; alvoNome?: string;
  situacao: 'ISENTO' | 'TRIBUTADO'; aliquota: Money; vigenciaInicio: LocalDate; vigenciaFim?: LocalDate;
}

// ---------- REL ----------
export type TipoRelatorio = 'prestacao-contas' | 'vendas' | 'estoque' | 'descartes' | 'transferencias' | 'fiado';
export interface RelatorioSecao {
  titulo: string;
  colunas: { chave: string; rotulo: string; tipo?: 'money' | 'number' | 'date' | 'text' }[];
  linhas: Record<string, string | number | null>[];
  totais?: Record<string, string | number>;
}
/** Seção principal + blocos à parte (ex.: vendas canceladas, descartes por motivo). */
export interface RelatorioResposta extends RelatorioSecao { blocos?: RelatorioSecao[] }

// ---------- ADM ----------
export interface Parametro { chave: string; valor: string; descricao: string; tipo: 'number' | 'text' | 'bool' }
