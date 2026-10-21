/**
 * Estado em memória da API SIMULADA (somente `npm run dev` com VITE_USE_MOCK=true).
 * Não é lógica de servidor de verdade: existe apenas para o front ser exercitado
 * contra os contratos da seção 5 enquanto o back-end Fastify não está pronto.
 * Todos os nomes/telefones são FICTÍCIOS — nunca colocar dados reais/de produção aqui.
 */
import type {
  CaixaSessao, Campanha, Categoria, CategoriaDespesa, Cliente, ContaPagar, ContaReceber, FormaPagamento,
  HistoricoEvento, Instituicao, LocalEstoque, Motivo, Parametro, Parceiro, Perfil, Permissao,
  Recebimento, RegraFiscal, StatusItem, Terminal, TipoControle, TipoEntrada, Venda, AuditoriaRegistro,
} from '../shared/api/types';
import { PERFIL_ADMIN_ID, PERMISSOES } from '../shared/api/types';

let n = 0;
/** Ids determinísticos legíveis para o seed (formato UUID). */
export const sid = (p: string) => `${p.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const dias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const data = (d: number) => dias(d).slice(0, 10);

export interface UsuarioDb { id: string; nome: string; login: string; senha: string; perfilId: string; ativo: boolean; trocarSenha: boolean }
export interface LoteDb {
  id: string; numero: number; tipo: TipoEntrada; parceiroId?: string; campanhaId?: string; documento?: string;
  temAnexo: boolean; recebidoEm: string; status: 'ABERTO' | 'TRIADO'; valorCompra?: number; pago?: boolean;
}
/** Produto de código único (Sprint 2): preço em centavos; vale para todas as entradas. */
export interface ProdutoDb {
  id: string; codigo: string; tituloEtiqueta: string; nome: string; categoriaId: string; preco: number; pecaUnica: boolean;
  modelo?: string; marca?: string; ano?: number; tipo?: string; tamanho?: string; cor?: string; condicao?: string;
  /** Desconto vigente (S3-09): `valor` em centavos (PERCENTUAL: 25,00% = 2500). Validade opcional, até o fim do dia. */
  desconto?: { tipo: 'PERCENTUAL' | 'PRECO'; valor: number; ate?: string; motivo: string; porNome: string; em: string };
}
/** Entrada num lote. `codigo` e `preco` espelham o produto (ETIQUETADO); o saldo só existe depois da aprovação. */
export interface ItemDb {
  id: string; codigo?: string; descricao: string; categoriaId: string; controle: TipoControle; preco: number;
  /** Valor atribuído unitário em centavos (RN-33); ausente = preço. */
  valorAtribuido?: number;
  loteId: string; criadoEm: string; quantidadeInicial: number; localInicial: LocalEstoque;
  saldo: Record<LocalEstoque, number>;
  produtoId?: string; status: StatusItem; motivoDevolucao?: string;
  /** Quem cadastrou: só outra pessoa aprova ou devolve (o Administrador pode o próprio; S3-22). Ausente nos itens da carga. */
  criadoPorId?: string;
}
export interface MovDb { id: string; itemId: string; tipo: HistoricoEvento['tipo']; quantidade: number; local?: LocalEstoque; ocorridoEm: string; usuarioNome: string; descricao: string }
export interface DescarteDb { id: string; loteId: string; categoriaId: string; motivoId: string; registradoEm: string; revertido: boolean }
export interface VendaDb extends Venda { caixaId: string; terminalId: string; operadorId: string; alocacoes: { itemId: string; quantidade: number; precoUnit: number; precoTabela?: number }[]; clienteId?: string }
export interface CaixaDb extends CaixaSessao { operadorId: string; lancamentos: { id: string; tipo: 'SANGRIA' | 'SUPRIMENTO'; valor: number; motivo: string; em: string }[] }

// o Administrador tem o mesmo id fixo da API real (as telas comparam com PERFIL_ADMIN_ID)
const PERFIL_ADMIN = PERFIL_ADMIN_ID, PERFIL_VENDEDOR = sid('perfcxa'), PERFIL_ESTOQUISTA = sid('perftri'), PERFIL_FINANCEIRO = sid('perffin');
// Mesmas permissões dos perfis padrão (migrações 0005 e 0006: o Administrador tem tudo, inclusive abrir caixa).
const vendedorPerms: Permissao[] = ['caixa.operar']; // sem clientes.gerenciar desde a 0014 (S6-15)
// 0010 (Sprint 3): o Estoquista vê o custo, muda o preço e aprova (não o próprio); o Financeiro vê o custo e dá desconto
const estoquistaPerms: Permissao[] = ['entrada.registrar', 'estoque.consultar', 'estoque.transferir', 'cadastros.consultar', 'relatorios.estoque', 'parceiros.criar', 'custo.consultar', 'produtos.preco', 'produtos.aprovar', 'etiquetas.imprimir'];
const financeiroPerms: Permissao[] = ['parceiros.criar', 'contas_pagar.gerenciar', 'contas_receber.receber', 'contas_receber.lancar', 'relatorios.consultar', 'relatorios.estoque', 'estoque.consultar', 'custo.consultar', 'produtos.desconto'];

const catRoupaAd = sid('catroup'), catRoupaInf = sid('catinf'), catCalc = sid('catcalc'), catLivro = sid('catliv'), catUtens = sid('catute'), catPeca = sid('catpeca');
const parcNI = sid('parcni'), parcA = sid('parca'), parcB = sid('parcb');
const campAgasalho = sid('campag'), campNatal = sid('campnat');
const mdDanif = sid('mddan'), mdIncomp = sid('mdinc'), mdSujo = sid('mdsuj');
const mbAvaria = sid('mbava'), mbPerda = sid('mbper'), mbDoacao = sid('mbdoa');
const lote1 = sid('lote1'), lote2 = sid('lote2');
const term1 = sid('term1'), term2 = sid('term2');
const cli1 = sid('cli1'), cli2 = sid('cli2'), cli3 = sid('cli3');
const despEnergia = sid('desen'), despMaterial = sid('desmat'), despReembolso = sid('desreemb');

export const db = {
  seq: { lote: 2, venda: 1000 },
  instituicao: { nome: 'Associação Luz da Esperança', cnpj: '00.000.000/0001-00', endereco: 'Parnaíba – PI', telefone: '(86) 0000-0000' } as Instituicao,
  perfis: [
    { id: PERFIL_ADMIN, nome: 'Administrador', padrao: true, permissoes: [...PERMISSOES], limiteDesconto: '100.00' },
    { id: PERFIL_VENDEDOR, nome: 'Vendedor', padrao: true, permissoes: vendedorPerms, limiteDesconto: '0.00' },
    { id: PERFIL_ESTOQUISTA, nome: 'Estoquista', padrao: true, permissoes: estoquistaPerms, limiteDesconto: '0.00' },
    { id: PERFIL_FINANCEIRO, nome: 'Financeiro', padrao: true, permissoes: financeiroPerms, limiteDesconto: '0.00' },
  ] as Perfil[],
  // Senhas em texto puro APENAS no mock. O servidor real usa argon2id (RNF-07).
  usuarios: [
    { id: sid('usradm'), nome: 'Ana Administradora', login: 'admin', senha: 'Admin@123', perfilId: PERFIL_ADMIN, ativo: true, trocarSenha: false },
    { id: sid('usrcxa'), nome: 'Carlos Vendedor', login: 'vendedor', senha: 'Vendedor@123', perfilId: PERFIL_VENDEDOR, ativo: true, trocarSenha: false },
    { id: sid('usrtri'), nome: 'Teresa Estoquista', login: 'estoquista', senha: 'Estoquista@123', perfilId: PERFIL_ESTOQUISTA, ativo: true, trocarSenha: false },
    { id: sid('usrfin'), nome: 'Fabio Financeiro', login: 'financeiro', senha: 'Financeiro@123', perfilId: PERFIL_FINANCEIRO, ativo: true, trocarSenha: false },
  ] as UsuarioDb[],
  categorias: [
    { id: catRoupaAd, nome: 'Roupa adulto', precoPadrao: '10.00', vendaPorCategoria: true, ativo: true },
    { id: catRoupaInf, nome: 'Roupa infantil', precoPadrao: '5.00', vendaPorCategoria: true, ativo: true },
    { id: catCalc, nome: 'Calçados', precoPadrao: '15.00', vendaPorCategoria: true, ativo: true },
    { id: catLivro, nome: 'Livros', precoPadrao: '3.00', vendaPorCategoria: true, ativo: true },
    { id: catUtens, nome: 'Utensílios', precoPadrao: '4.00', vendaPorCategoria: true, ativo: true },
    { id: catPeca, nome: 'Peças especiais (etiquetadas)', precoPadrao: '25.00', vendaPorCategoria: false, ativo: true },
  ] as Categoria[],
  parceiros: [
    { id: parcNI, nome: 'Doador não identificado', especial: true, ativo: true },
    { id: parcA, nome: 'Loja Parceira Alfa', ativo: true },
    { id: parcB, nome: 'Comunidade Bairro Beta', ativo: true },
  ] as Parceiro[],
  campanhas: [
    { id: campAgasalho, nome: 'Campanha do Agasalho 2026', inicio: data(-60), fim: data(30), ativo: true },
    { id: campNatal, nome: 'Natal Solidário 2026', inicio: data(20), fim: data(90), ativo: true },
  ] as Campanha[],
  motivosDescarte: [
    { id: mdDanif, nome: 'Danificado', ativo: true }, { id: mdIncomp, nome: 'Incompleto', ativo: true }, { id: mdSujo, nome: 'Sujo/mofado', ativo: true },
  ] as Motivo[],
  motivosBaixa: [
    { id: mbAvaria, nome: 'Avaria no estoque', ativo: true }, { id: mbPerda, nome: 'Perda/extravio', ativo: true }, { id: mbDoacao, nome: 'Doado à assistência', ativo: true },
  ] as Motivo[],
  categoriasDespesa: [
    { id: despEnergia, nome: 'Energia', ativo: true }, { id: despMaterial, nome: 'Material de consumo', ativo: true },
    { id: despReembolso, nome: 'Reembolso de venda', ativo: true },
  ] as CategoriaDespesa[],
  clientes: [
    { id: cli1, nome: 'Maria Exemplo', telefone: '(86) 90000-0001', ativo: true, cienciaAviso: true },
    { id: cli2, nome: 'João Fictício', telefone: '(86) 90000-0002', ativo: true, cienciaAviso: true },
    { id: cli3, nome: 'Rita Teste', telefone: '(86) 90000-0003', ativo: true, cienciaAviso: true },
  ] as Cliente[],
  terminais: [{ id: term1, nome: 'Caixa 1 — Balcão', ativo: true }, { id: term2, nome: 'Caixa 2 — Tablet', ativo: true }] as Terminal[],
  lotes: [
    { id: lote1, numero: 1, tipo: 'DOACAO', parceiroId: parcA, documento: 'Termo 045/2026', temAnexo: false, recebidoEm: dias(-20), status: 'TRIADO' },
    { id: lote2, numero: 2, tipo: 'DOACAO', parceiroId: parcB, campanhaId: campAgasalho, temAnexo: false, recebidoEm: dias(-3), status: 'ABERTO' },
  ] as LoteDb[],
  itens: [] as ItemDb[],
  produtos: [] as ProdutoDb[],
  movs: [] as MovDb[],
  descartes: [] as DescarteDb[],
  vendas: [] as VendaDb[],
  caixas: [] as CaixaDb[],
  contasPagar: [
    { id: sid('cp1'), descricao: 'Conta de energia — setembro', categoriaDespesaId: despEnergia, categoriaDespesaNome: 'Energia', valor: '187.40', vencimento: data(-2), status: 'ABERTA' },
    { id: sid('cp2'), descricao: 'Sacolas e etiquetas', categoriaDespesaId: despMaterial, categoriaDespesaNome: 'Material de consumo', valor: '96.00', vencimento: data(5), status: 'ABERTA' },
  ] as ContaPagar[],
  contasReceber: [
    { id: sid('cr1'), clienteId: cli1, clienteNome: 'Maria Exemplo', descricao: 'Saldo anterior ao sistema', valor: '45.00', saldo: '45.00', vencimento: data(10), status: 'ABERTA' },
  ] as ContaReceber[],
  recebimentos: [] as Recebimento[],
  regrasFiscais: [
    { id: sid('rf1'), alvo: 'GERAL', situacao: 'ISENTO', aliquota: '0.00', vigenciaInicio: '2026-01-01' },
  ] as RegraFiscal[],
  parametros: [
    { chave: 'fiado.prazo_dias', valor: '30', descricao: 'Prazo padrão do fiado em dias (PA-07 pendente)', tipo: 'number' },
    { chave: 'alerta.vencimento_dias', valor: '3', descricao: 'Avisar contas a pagar com vencimento em até N dias', tipo: 'number' },
    { chave: 'sessao.timeout_min', valor: '30', descricao: 'Tempo de inatividade da sessão (min)', tipo: 'number' },
    { chave: 'senha.tamanho_minimo', valor: '8', descricao: 'Tamanho mínimo da senha', tipo: 'number' },
    { chave: 'anexo.tamanho_max_mb', valor: '5', descricao: 'Tamanho máximo do anexo do lote (MB)', tipo: 'number' },
    { chave: 'cpf.limite_mensal', valor: '0', descricao: 'Limite de compras por CPF no mês, em reais (0 = sem limite)', tipo: 'number' },
    { chave: 'cpf.obrigatorio', valor: '0', descricao: 'CPF obrigatório na venda', tipo: 'bool' },
    { chave: 'etiqueta.altura_mm', valor: '30', descricao: 'Altura da etiqueta do rolo, em milímetros', tipo: 'number' },
    { chave: 'etiqueta.largura_mm', valor: '50', descricao: 'Largura da etiqueta do rolo, em milímetros', tipo: 'number' },
    { chave: 'estoque.pouco_saldo', valor: '5', descricao: 'Pouco saldo: o dashboard do Estoque avisa o produto com esta quantidade ou menos', tipo: 'number' },
  ] as Parametro[],
  auditoria: [] as AuditoriaRegistro[],
};

// ---------- Seed de itens e movimentações ----------
function addItem(p: Omit<ItemDb, 'id' | 'criadoEm' | 'saldo' | 'status'> & { id?: string; status?: StatusItem }) {
  const it: ItemDb = { ...p, id: p.id ?? sid('item'), criadoEm: dias(-19), saldo: { BAZAR: 0, DOACOES: 0 }, status: p.status ?? 'APROVADO' };
  db.itens.push(it);
  if (it.status === 'APROVADO') { // o estoque só recebe na aprovação
    it.saldo[p.localInicial] = p.quantidadeInicial;
    db.movs.push({ id: sid('mov'), itemId: it.id, tipo: 'ENTRADA', quantidade: p.quantidadeInicial, local: p.localInicial, ocorridoEm: it.criadoEm, usuarioNome: 'Teresa da Triagem', descricao: 'Entrada (aprovação do lote)' });
  }
  return it;
}
function addProduto(p: Omit<ProdutoDb, 'id'>) { const pr = { ...p, id: sid('prod') }; db.produtos.push(pr); return pr; }
// peças antigas: cada uma é um produto de peça única com o mesmo código
['Jaqueta jeans', 'Vestido de festa', 'Bolsa de couro', 'Terno masculino', 'Liquidificador'].forEach((d, i) => {
  const pr = addProduto({ codigo: `BZ${String(i + 1).padStart(6, '0')}`, tituloEtiqueta: d, nome: d, categoriaId: catPeca, preco: [3500, 6000, 4500, 8000, 3000][i]!, pecaUnica: true });
  addItem({ codigo: pr.codigo, descricao: d, categoriaId: catPeca, controle: 'ETIQUETADO', preco: pr.preco, loteId: lote1, quantidadeInicial: 1, localInicial: 'BAZAR', produtoId: pr.id });
});
// produto de várias unidades (Sprint 2), aprovado, e um cadastro aguardando a aprovação do Administrador
const caneca = addProduto({ codigo: 'BZ000006', tituloEtiqueta: 'Caneca branca', nome: 'Caneca de porcelana branca', categoriaId: catUtens, preco: 700, pecaUnica: false, cor: 'branca' });
addItem({ codigo: caneca.codigo, descricao: caneca.nome, categoriaId: catUtens, controle: 'ETIQUETADO', preco: caneca.preco, valorAtribuido: 200, loteId: lote1, quantidadeInicial: 6, localInicial: 'BAZAR', produtoId: caneca.id });
const prato = addProduto({ codigo: 'BZ000007', tituloEtiqueta: 'Prato fundo', nome: 'Prato fundo de louça', categoriaId: catUtens, preco: 500, pecaUnica: false });
addItem({ codigo: prato.codigo, descricao: prato.nome, categoriaId: catUtens, controle: 'ETIQUETADO', preco: prato.preco, valorAtribuido: 150, loteId: lote2, quantidadeInicial: 4, localInicial: 'BAZAR', produtoId: prato.id, status: 'CADASTRADO' });
addItem({ descricao: 'Roupa adulto (lote 1)', categoriaId: catRoupaAd, controle: 'CATEGORIA', preco: 1000, loteId: lote1, quantidadeInicial: 30, localInicial: 'BAZAR' });
addItem({ descricao: 'Livros (lote 1)', categoriaId: catLivro, controle: 'CATEGORIA', preco: 300, loteId: lote1, quantidadeInicial: 20, localInicial: 'BAZAR' });
addItem({ descricao: 'Roupa infantil (lote 1)', categoriaId: catRoupaInf, controle: 'CATEGORIA', preco: 500, loteId: lote1, quantidadeInicial: 15, localInicial: 'DOACOES' });
addItem({ descricao: 'Roupa adulto (lote 2)', categoriaId: catRoupaAd, controle: 'CATEGORIA', preco: 1000, loteId: lote2, quantidadeInicial: 12, localInicial: 'BAZAR' });
addItem({ descricao: 'Calçados (lote 2)', categoriaId: catCalc, controle: 'CATEGORIA', preco: 1500, loteId: lote2, quantidadeInicial: 8, localInicial: 'BAZAR' });
db.descartes.push({ id: sid('desc'), loteId: lote1, categoriaId: catRoupaAd, motivoId: mdDanif, registradoEm: dias(-19), revertido: false });

export const FORMAS: FormaPagamento[] = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO'];

// ---------- Dados de exemplo dos últimos 30 dias (Sprint 5: os painéis, os gráficos e o fluxo de caixa já abrem com números) ----------
// Tudo inventado e sempre igual (sequência fixa): caixas fechados por dia, vendas, contas pagas, fiado recebido e entradas no estoque.
{
  let semente = 7;
  const sorteio = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const reais = (c: number) => (c / 100).toFixed(2);
  const vendedor = db.usuarios.find((u) => u.login === 'vendedor')!;
  const NOMES: [string, string, number][] = [['Roupa adulto', 'Roupa adulto (lote 1)', 1000], ['Livros', 'Livros (lote 1)', 300], ['Calçados', 'Calçados (lote 2)', 1500], ['Caneca de porcelana branca', 'Caneca', 700], ['Roupa infantil', 'Roupa infantil', 500]];
  let numero = 0;
  for (let d = -29; d <= -1; d++) {
    if (new Date(Date.now() + d * 86_400_000).getDay() === 0) continue; // domingo fechado
    const abertoEm = new Date(new Date(dias(d)).setHours(8, 30, 0, 0)).toISOString();
    const fechadoEm = new Date(new Date(dias(d)).setHours(17, 45, 0, 0)).toISOString();
    const caixa: CaixaDb = { id: sid('cxex'), terminalId: term1, terminalNome: 'Caixa 1 — Balcão', operadorId: vendedor.id, operadorNome: vendedor.nome, abertoEm, fundoTroco: '50.00', status: 'FECHADO', lancamentos: [] };
    let dinheiro = 0;
    const qtd = 3 + Math.floor(sorteio() * 7);
    for (let k = 0; k < qtd; k++) {
      const [desc, , preco] = NOMES[Math.floor(sorteio() * NOMES.length)]!;
      const un = 1 + Math.floor(sorteio() * 4), total = preco * un;
      const r = sorteio();
      const forma: FormaPagamento = r < 0.35 ? 'DINHEIRO' : r < 0.75 ? 'PIX' : r < 0.85 ? 'CARTAO_DEBITO' : r < 0.95 ? 'CARTAO_CREDITO' : 'FIADO';
      const cancelada = sorteio() < 0.03;
      if (forma === 'DINHEIRO' && !cancelada) dinheiro += total;
      const ocorridaEm = new Date(new Date(abertoEm).getTime() + (k + 1) * 50 * 60_000).toISOString();
      db.vendas.push({
        id: sid('vdex'), numero: ++numero, ocorridaEm, status: cancelada ? 'CANCELADA' : 'CONCLUIDA', subtotal: reais(total), desconto: '0.00', total: reais(total), troco: '0.00',
        itens: [{ descricao: desc, quantidade: un, precoUnitario: reais(preco), total: reais(total) }],
        pagamentos: [{ forma, valor: reais(total), ...(forma === 'DINHEIRO' ? { valorRecebido: reais(total) } : {}) }],
        operadorNome: vendedor.nome, caixaId: caixa.id, terminalId: term1, operadorId: vendedor.id, alocacoes: [],
        ...(forma === 'FIADO' ? { clienteId: cli2, clienteNome: 'João Fictício' } : {}),
      });
    }
    // duas conferências com diferença no mês (uma faltou, outra sobrou)
    const esperado = 5000 + dinheiro, dif = d === -12 ? -350 : d === -5 ? 200 : 0;
    Object.assign(caixa, { fechadoEm, esperado: reais(esperado), contado: reais(esperado + dif), diferenca: reais(dif), ...(dif ? { observacao: dif < 0 ? 'Faltou troco na conferência' : 'Sobra de moedas' } : {}) });
    db.caixas.push(caixa);
  }
  db.seq.venda = Math.max(db.seq.venda, numero);
  // contas já pagas no mês e mais algumas a vencer
  const pagas: [string, string, string, number][] = [['Conta de água — setembro', 'Material de consumo', '64.30', -26], ['Aluguel do salão', 'Material de consumo', '400.00', -20], ['Conta de energia — agosto', 'Energia', '172.90', -15], ['Material de limpeza', 'Material de consumo', '58.75', -9], ['Sacolas recicladas', 'Material de consumo', '45.00', -4]];
  for (const [descricao, cat, valor, d] of pagas) {
    const categoria = db.categoriasDespesa.find((c) => c.nome === cat)!;
    db.contasPagar.push({ id: sid('cpex'), descricao, categoriaDespesaId: categoria.id, categoriaDespesaNome: categoria.nome, valor, vencimento: data(d), status: 'PAGA', pagaEm: dias(d) });
  }
  db.contasPagar.push({ id: sid('cpex'), descricao: 'Internet — outubro', categoriaDespesaId: despMaterial, categoriaDespesaNome: 'Material de consumo', valor: '99.90', vencimento: data(3), status: 'ABERTA' });
  db.contasPagar.push({ id: sid('cpex'), descricao: 'Reforma da vitrine', categoriaDespesaId: despMaterial, categoriaDespesaNome: 'Material de consumo', valor: '250.00', vencimento: data(12), status: 'ABERTA' });
  // fiado: uma conta recebida em parte e outra a receber
  const crJoao = { id: sid('crex'), clienteId: cli2, clienteNome: 'João Fictício', descricao: 'Compras de setembro', valor: '80.00', saldo: '30.00', vencimento: data(-6), status: 'PARCIAL' as const };
  db.contasReceber.push(crJoao, { id: sid('crex'), clienteId: cli3, clienteNome: 'Rita Teste', descricao: 'Compra fiada', valor: '36.00', saldo: '36.00', vencimento: data(6), status: 'ABERTA' });
  db.recebimentos.push({ id: sid('rcex'), contaReceberId: crJoao.id, valor: '50.00', recebidoEm: dias(-8), estornado: false, forma: 'PIX' });
  // estoque: produtos de várias unidades com pouco saldo e entradas em dias diferentes
  const entradas: [string, string, number, number, number][] = [['Copo de vidro', 'Copo de vidro liso', 300, 3, -25], ['Panela de alumínio', 'Panela de alumínio média', 2500, 2, -17], ['Toalha de banho', 'Toalha de banho', 1200, 9, -11], ['Livro infantil', 'Livro infantil ilustrado', 800, 4, -6], ['Tênis', 'Tênis infantil', 2000, 1, -2]];
  entradas.forEach(([titulo, nome, preco, qtd, d], i) => {
    const pr = addProduto({ codigo: `BZ${String(20 + i).padStart(6, '0')}`, tituloEtiqueta: titulo, nome, categoriaId: i === 3 ? catLivro : catUtens, preco, pecaUnica: false });
    const it = addItem({ codigo: pr.codigo, descricao: nome, categoriaId: pr.categoriaId, controle: 'ETIQUETADO', preco, valorAtribuido: Math.round(preco / 3), loteId: lote1, quantidadeInicial: qtd, localInicial: i === 2 ? 'DOACOES' : 'BAZAR', produtoId: pr.id });
    it.criadoEm = dias(d);
    db.movs.filter((m) => m.itemId === it.id).forEach((m) => { m.ocorridoEm = dias(d); });
  });
}
