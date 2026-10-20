/** ADM / PRV — parâmetros, importação de cadastros e direitos do titular (LGPD) (RF-ADM-01/02, RF-PRV-02/03). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../shared/errors.js';
import { dataExiste, parse, zMotivo, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { codigoErro, gerarCsv, gerarXlsx, lerPlanilha } from '../../shared/planilha.js';
import { fromDbDate, toDbDate } from '../../shared/dates.js';
import { money } from '../../shared/money.js';
import { exigirUsuario, tem } from '../../plugins/auth.js';
import { FINALIDADE_CLIENTE, VERSAO_AVISO } from '../cadastros/clientes.routes.js';
import { documentoValido, normalizarDocumento } from '../../shared/documento.js';
import type { Permissao } from '../../shared/permissoes.js';

const TIPOS_PARAM: Record<string, { tipo: 'number' | 'text' | 'bool'; min?: number; max?: number; vazio?: boolean }> = {
  'fiado.prazo_dias': { tipo: 'number', min: 1, max: 365, vazio: true },
  'alerta.vencimento_dias': { tipo: 'number', min: 0, max: 60 },
  'sessao.timeout_min': { tipo: 'number', min: 5, max: 480 },
  'senha.tamanho_minimo': { tipo: 'number', min: 8, max: 64 },
  'anexo.tamanho_max_mb': { tipo: 'number', min: 1, max: 10 },
  'cpf.limite_mensal': { tipo: 'number', min: 0, max: 1_000_000, vazio: true }, // em reais; 0 ou em branco = sem limite
  'cpf.obrigatorio': { tipo: 'bool' }, // 1 = sim, 0 = não
  // tamanho do rolo (S4-01): abaixo de 30 x 20 mm o Code 128 do BZ + 6 dígitos não cabe com barras que o leitor 1D lê
  'etiqueta.largura_mm': { tipo: 'number', min: 30, max: 120 },
  'etiqueta.altura_mm': { tipo: 'number', min: 20, max: 100 },
  'estoque.pouco_saldo': { tipo: 'number', min: 0, max: 1000 }, // P-08: um valor para todos; 0 = só avisa o que acabou
};

/**
 * Modelos para baixar (S5-02): o cabeçalho que cada importação espera e linhas de exemplo (fictícias), em CSV ou XLSX.
 * Quem baixa é quem pode importar aquele tipo.
 */
const MODELOS: Record<string, { perm: Permissao; titulo: string; cab: string[]; exemplo: string[][] }> = {
  lote: {
    perm: 'entrada.registrar', titulo: 'Produtos do lote',
    cab: ['titulo_etiqueta', 'nome', 'categoria', 'preco', 'quantidade', 'valor_atribuido', 'estoque', 'peca_unica', 'codigo', 'modelo', 'marca', 'ano', 'tipo', 'tamanho', 'cor', 'condicao'],
    exemplo: [
      ['Caneca branca', 'Caneca de porcelana branca', 'Utensílios', '7,00', '6', '2,00', 'Bazar', 'não', '', '', '', '', '', '', 'branca', 'boa'],
      ['Vestido azul', 'Vestido de festa azul', 'Roupa adulto', '60,00', '1', '15,00', 'Bazar', 'sim', '', '', '', '', 'festa', 'M', 'azul', 'ótima'],
      ['', '', '', '', '4', '1,50', 'Doações', '', 'BZ000006', '', '', '', '', '', '', ''],
    ],
  },
  categorias: { perm: 'cadastros.gerenciar', titulo: 'Categorias', cab: ['nome', 'preco_padrao', 'venda_por_categoria'], exemplo: [['Roupa adulto', '10,00', 'sim'], ['Peças especiais', '', 'não']] },
  parceiros: { perm: 'cadastros.gerenciar', titulo: 'Parceiros', cab: ['nome', 'tipo', 'documento', 'cidade'], exemplo: [['Loja Exemplo', 'LOJA', '12.ABC.345/01DE-35', 'Parnaíba'], ['Doadora Exemplo', 'PESSOA_FISICA', '', 'Parnaíba']] },
  campanhas: { perm: 'cadastros.gerenciar', titulo: 'Campanhas', cab: ['nome', 'inicio', 'fim'], exemplo: [['Campanha do Agasalho', '2026-05-01', '2026-07-31']] },
  clientes: { perm: 'cadastros.gerenciar', titulo: 'Clientes', cab: ['nome', 'telefone'], exemplo: [['Cliente Exemplo', '(86) 90000-0000']] },
  'carga-inicial': {
    perm: 'estoque.ajustar', titulo: 'Carga inicial',
    cab: ['categoria', 'quantidade', 'preco', 'estoque', 'controle', 'valor_atribuido', 'descricao'],
    exemplo: [['Roupa adulto', '30', '10,00', 'Bazar', 'categoria', '10,00', ''], ['Peças especiais', '1', '45,00', 'Bazar', 'etiquetado', '20,00', 'Bolsa de couro marrom']],
  },
};

export async function rotasAdmin(app: FastifyInstance) {
  app.get('/modelos/:tipo', { config: { acesso: ['entrada.registrar', 'cadastros.gerenciar', 'estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo } = parse(z.object({ tipo: z.enum(Object.keys(MODELOS) as [string, ...string[]]) }), req.params);
    const { formato } = parse(z.object({ formato: z.enum(['csv', 'xlsx']).default('csv') }), req.query);
    const m = MODELOS[tipo]!;
    // a mesma regra de quem importa (clientes: cadastros e clientes, como em /importacoes/clientes)
    if (!tem(u, m.perm) || (tipo === 'clientes' && !tem(u, 'clientes.gerenciar'))) throw new AppError(403, 'Sem permissão para esta importação', 'SEM_PERMISSAO');
    const nome = `modelo-${tipo}.${formato}`;
    if (formato === 'csv') return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${nome}"`).send(gerarCsv(m.cab, m.exemplo));
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${nome}"`).send(await gerarXlsx(m.titulo, m.cab, m.exemplo));
  });

  // ---------------- parâmetros ----------------
  const listar = async () => (await prisma.parametro.findMany({ orderBy: { chave: 'asc' } }))
    .map((p) => ({ chave: p.chave, valor: p.valor, descricao: p.descricao ?? '', tipo: TIPOS_PARAM[p.chave]?.tipo ?? 'text' }));

  app.get('/parametros', { config: { acesso: ['parametros.gerenciar'] } }, listar);

  app.put('/parametros', { config: { acesso: ['parametros.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ valores: z.array(z.object({ chave: z.string().max(60), valor: z.string().trim().max(200) })).max(50) }), req.body);
    for (const v of b.valores) {
      const def = TIPOS_PARAM[v.chave];
      if (!def) throw new AppError(400, `Parâmetro desconhecido: ${v.chave}`, 'VALIDACAO');
      if (v.valor === '' && def.vazio) continue;
      if (def.tipo === 'bool' && v.valor !== '0' && v.valor !== '1') throw new AppError(400, `Valor inválido para ${v.chave} (use 0 ou 1)`, 'VALIDACAO');
      const n = Number(v.valor);
      if (def.tipo === 'number' && (!/^\d+$/.test(v.valor) || n < (def.min ?? 0) || n > (def.max ?? Infinity))) {
        throw new AppError(400, `Valor inválido para ${v.chave} (${def.min} a ${def.max})`, 'VALIDACAO');
      }
    }
    await prisma.$transaction(async (tx) => {
      for (const v of b.valores) {
        const antes = await tx.parametro.findUnique({ where: { chave: v.chave } });
        await tx.parametro.update({ where: { chave: v.chave }, data: { valor: v.valor } });
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PARAMETRO_ALTERADO', 'parametro', v.chave, { valor: antes?.valor }, { valor: v.valor });
      }
    });
    return listar();
  });

  // ---------------- importação de cadastros (RF-ADM-01) ----------------
  app.post('/importacoes/:tipo', { config: { acesso: ['cadastros.gerenciar'], rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const u = exigirUsuario(req);
    const { tipo } = parse(z.object({ tipo: z.enum(['categorias', 'parceiros', 'campanhas', 'clientes']) }), req.params);
    if (tipo === 'clientes' && !u.permissoes.has('clientes.gerenciar')) throw new AppError(403, 'Importar clientes exige permissão de clientes', 'SEM_PERMISSAO');
    const arq = await req.file();
    if (!arq || arq.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const pl = await lerPlanilha(await arq.toBuffer());
    if (!pl.cabecalho.includes('nome')) throw new AppError(400, 'Planilha fora do modelo', 'PLANILHA_INVALIDA', 'Coluna obrigatória ausente: nome');

    const existentes = new Set<string>((tipo === 'categorias' ? await prisma.categoria.findMany({ select: { nome: true } })
      : tipo === 'parceiros' ? await prisma.parceiro.findMany({ select: { nome: true } })
      : tipo === 'campanhas' ? await prisma.campanha.findMany({ select: { nome: true } })
      : await prisma.cliente.findMany({ where: { anonimizadoEm: null }, select: { nome: true } })).map((x) => x.nome.trim().toLowerCase()));

    // S5-05 (P-19): como todas as importações, grava as linhas válidas e devolve as aceitas e as recusadas (com o motivo);
    // nome já cadastrado (ou repetido na planilha) é recusado, não gravado de novo
    const aceitas: { linha: number; nome: string }[] = [];
    const recusadas: { linha: number; nome: string; motivo: string }[] = [];
    const vistos = new Set<string>();
    for (const { numero, valores: v } of pl.linhas) {
      const nome = (v.nome ?? '').trim();
      const chave = nome.toLowerCase();
      const e: string[] = [];
      if (nome.length < 2 || nome.length > 120) e.push('nome: obrigatório (2 a 120 caracteres)');
      if (tipo === 'categorias' && v.preco_padrao && !/^\d{1,8}([.,]\d{1,2})?$/.test(v.preco_padrao)) e.push('preco_padrao: valor no formato 12,50');
      else if (tipo === 'categorias' && /^(s|sim|true|1)$/i.test(v.venda_por_categoria ?? '') && !(Number((v.preco_padrao ?? '').replace(',', '.')) > 0)) {
        e.push('preco_padrao: obrigatório e maior que zero quando venda_por_categoria = sim'); // RF-CAD-01 cenário 2
      }
      const doc = normalizarDocumento(v.documento ?? '');
      if (tipo === 'parceiros' && doc && !documentoValido(doc)) e.push('documento: CPF/CNPJ inválido'); // RF-CAD-02 cenário 2
      if (tipo === 'clientes' && !/^\d{10,11}$/.test((v.telefone ?? '').replace(/\D/g, ''))) e.push('telefone: obrigatório, com DDD');
      if (tipo === 'campanhas' && ((v.inicio && !dataExiste(v.inicio)) || (v.fim && !dataExiste(v.fim)))) e.push('inicio/fim: data no formato aaaa-mm-dd');
      else if (tipo === 'campanhas' && v.inicio && v.fim && v.fim < v.inicio) e.push('fim: antes do início');
      if (tipo === 'parceiros' && v.tipo && !['EMPRESA', 'LOJA', 'PESSOA_FISICA', 'OUTRO'].includes(v.tipo.toUpperCase())) e.push('tipo: EMPRESA, LOJA, PESSOA_FISICA ou OUTRO');
      if (!e.length && (existentes.has(chave) || vistos.has(chave))) e.push(vistos.has(chave) ? 'nome repetido na planilha' : 'já cadastrado');
      if (e.length) { recusadas.push({ linha: numero, nome: nome.slice(0, 120), motivo: e.join('; ') }); continue; }
      vistos.add(chave);
      try {
        if (tipo === 'categorias') {
          await prisma.categoria.create({ data: { nome, precoPadrao: v.preco_padrao ? v.preco_padrao.replace(',', '.') : null, vendaPorCategoria: /^(s|sim|true|1)$/i.test(v.venda_por_categoria ?? '') } });
        } else if (tipo === 'parceiros') {
          await prisma.parceiro.create({ data: { nome, tipo: (v.tipo?.toUpperCase() as 'EMPRESA' | 'LOJA' | 'PESSOA_FISICA' | 'OUTRO') || 'OUTRO', documento: doc || null, cidade: v.cidade || null } });
        } else if (tipo === 'campanhas') {
          await prisma.campanha.create({ data: { nome, dataInicio: v.inicio ? toDbDate(v.inicio) : null, dataFim: v.fim ? toDbDate(v.fim) : null } });
        } else {
          // Clientes importados: o consentimento registrado é o da planilha (ciência colhida na origem)
          await prisma.cliente.create({ data: { nome, telefone: (v.telefone ?? '').replace(/\D/g, ''),
            consentimentos: { create: { titularTipo: 'CLIENTE', finalidade: FINALIDADE_CLIENTE, versaoAviso: `${VERSAO_AVISO}-importacao`, registradoPorId: u.id } } } });
        }
        aceitas.push({ linha: numero, nome });
      } catch (er) {
        req.log.error({ erro: codigoErro(er), linha: numero }, 'importação de cadastro'); // sem a mensagem: o Prisma repete os valores da linha
        recusadas.push({ linha: numero, nome: nome.slice(0, 120), motivo: 'Erro ao gravar a linha' });
      }
    }
    await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'IMPORTACAO', tipo, '*', undefined, { linhas: pl.linhas.length, aceitas: aceitas.length, recusadas: recusadas.length });
    return { total: pl.linhas.length, aceitas, recusadas };
  });

  // ---------------- LGPD: direitos do titular (RF-PRV-02/03, RN-22) ----------------
  const zTitular = z.object({ tipo: z.enum(['cliente', 'parceiro']), id: zUuid });

  app.get('/titulares/:tipo/:id/exportar', { config: { acesso: ['privacidade.gerenciar'], rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo, id } = parse(zTitular, req.params);
    let dados: unknown;
    if (tipo === 'cliente') {
      const c = await prisma.cliente.findUnique({ where: { id }, include: { consentimentos: true } });
      if (!c) naoEncontrado('Titular');
      const contas = await prisma.contaReceber.findMany({ where: { clienteId: id }, include: { recebimentos: true, venda: { select: { numero: true } } } });
      const vendas = await prisma.venda.findMany({ where: { clienteId: id }, select: { numero: true, ocorridaEm: true, total: true, status: true } });
      dados = {
        geradoEm: new Date().toISOString(), titular: { tipo: 'cliente', id: c!.id, nome: c!.nome, telefone: c!.telefone, documento: c!.documento, observacao: c!.observacao, ativo: c!.ativo, criadoEm: c!.criadoEm, anonimizadoEm: c!.anonimizadoEm },
        consentimentos: c!.consentimentos.map((x) => ({ finalidade: x.finalidade, versaoAviso: x.versaoAviso, registradoEm: x.registradoEm, revogadoEm: x.revogadoEm })),
        compras: vendas.map((v) => ({ numero: v.numero, data: v.ocorridaEm, total: money(v.total), status: v.status })),
        contasReceber: contas.map((x) => ({ vendaNumero: x.venda?.numero, descricao: x.descricao, valor: money(x.valor), vencimento: fromDbDate(x.vencimento), status: x.status,
          recebimentos: x.recebimentos.map((r) => ({ valor: money(r.valor), data: r.recebidoEm, estornado: !!r.estornadoEm })) })),
      };
    } else {
      const p = await prisma.parceiro.findUnique({ where: { id }, include: { consentimentos: true } });
      if (!p || p.tipo !== 'PESSOA_FISICA') naoEncontrado('Titular');
      const lotes = await prisma.loteEntrada.findMany({ where: { parceiroId: id }, select: { numero: true, tipo: true, recebidoEm: true } });
      dados = {
        geradoEm: new Date().toISOString(), titular: { tipo: 'parceiro', id: p!.id, nome: p!.nome, documento: p!.documento, telefone: p!.telefone, email: p!.email, cidade: p!.cidade, observacao: p!.observacao },
        consentimentos: p!.consentimentos.map((x) => ({ finalidade: x.finalidade, versaoAviso: x.versaoAviso, registradoEm: x.registradoEm, revogadoEm: x.revogadoEm })),
        doacoes: lotes,
      };
    }
    await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'TITULAR_EXPORTADO', tipo, id);
    return reply.header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="titular-${id}.json"`)
      .send(JSON.stringify(dados, null, 2));
  });

  app.post('/titulares/:tipo/:id/anonimizar', { config: { acesso: ['privacidade.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo, id } = parse(zTitular, req.params);
    const b = parse(z.object({ motivo: zMotivo, confirmar: z.boolean().default(false) }), req.body);
    await prisma.$transaction(async (tx) => {
      if (tipo === 'cliente') {
        const c = await tx.cliente.findUnique({ where: { id } });
        if (!c) naoEncontrado('Titular');
        if (c!.anonimizadoEm) conflito('JA_ANONIMIZADO', 'Titular já anonimizado');
        const debito = await tx.contaReceber.count({ where: { clienteId: id, status: { in: ['ABERTA', 'PARCIAL'] } } });
        if (debito && !b.confirmar) conflito('CLIENTE_COM_DEBITO', 'Cliente possui débito em aberto. Confirme para anonimizar mesmo assim.');
        // RN-22: remove o que identifica; vendas e lançamentos financeiros são preservados
        await tx.cliente.update({ where: { id }, data: { nome: `Titular anonimizado ${id.slice(-4)}`, telefone: '', documento: null, observacao: null, ativo: false, anonimizadoEm: new Date() } });
        await tx.consentimento.updateMany({ where: { clienteId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      } else {
        const p = await tx.parceiro.findUnique({ where: { id } });
        if (!p || p.tipo !== 'PESSOA_FISICA') naoEncontrado('Titular');
        if (p!.nome.startsWith('Titular anonimizado')) conflito('JA_ANONIMIZADO', 'Titular já anonimizado');
        // a origem dos lotes continua (prestação de contas), sem identificar a pessoa
        await tx.parceiro.update({ where: { id }, data: { nome: `Titular anonimizado ${id.slice(-4)}`, documento: null, telefone: null, email: null, observacao: null, ativo: false } });
        await tx.consentimento.updateMany({ where: { parceiroId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TITULAR_ANONIMIZADO', tipo, id, undefined, { motivo: b.motivo, comDebitoConfirmado: b.confirmar });
    });
    return reply.code(204).send();
  });
}
