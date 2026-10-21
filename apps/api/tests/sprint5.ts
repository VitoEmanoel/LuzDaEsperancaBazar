/**
 * Sprint 5: CNPJ alfanumérico (S5-01), pouco saldo nos parâmetros (S5-17), Nova compra do Financeiro (S5-11),
 * Caixas do dia com o detalhe de cada caixa (S5-06 e S5-09), o resumo financeiro em PDF (S5-10), os dashboards (S5-07, S5-15,
 * S5-16), o fluxo de caixa (S5-08), a importação de planilha no lote (S5-03) e os modelos e importações padronizadas (S5-02, S5-05). Dados 100% fictícios.
 * Rodar DEPOIS do smoke (senha do admin e caixa aberto do operador caixa1). Uso: API_URL=... npm run test:sprint5
 */
import { randomUUID as uuid } from 'node:crypto';
import ExcelJS from 'exceljs';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
const SENHA_ADMIN = process.env.ADMIN_SENHA ?? 'Nova-Senha-Forte-1';
let falhas = 0, oks = 0;
function check(cond: unknown, nome: string, extra?: unknown) {
  if (cond) { oks++; console.log(`  ✔ ${nome}`); } else { falhas++; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 320) : ''); }
}
class Cliente {
  token: string | null = null;
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    const bytes = ct.includes('json') ? null : Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct, bytes, data: (ct.includes('json') ? await r.json().catch(() => null) : null) as any };
  }
  /** Envio de arquivo (multipart), como o navegador faz. */
  async arquivo(path: string, nome: string, tipo: string, conteudo: string | Buffer) {
    const fd = new FormData();
    fd.append('arquivo', new Blob([conteudo], { type: tipo }), nome);
    const r = await fetch(BASE + path, { method: 'POST', headers: this.token ? { authorization: `Bearer ${this.token}` } : {}, body: fd });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, data: (ct.includes('json') ? await r.json().catch(() => null) : null) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  async login(login: string, senha: string) { const r = await this.post('/auth/login', { login, senha }); if (r.status === 200) this.token = r.data.accessToken; return r; }
}

async function novoUsuario(admin: Cliente, perfil: string, login: string) {
  const perfilId = ((await admin.get('/perfis')).data as any[]).find((p) => p.nome === perfil).id;
  const u = (await admin.post('/usuarios', { id: uuid(), nome: `Teste ${login}`, login, perfilId })).data;
  const c = new Cliente();
  await c.login(login, u.senhaProvisoria);
  await c.put('/auth/senha', { senhaAtual: u.senhaProvisoria, novaSenha: 'Sprint5-Senha-2026' });
  await c.login(login, 'Sprint5-Senha-2026');
  return c;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function main() {
  const admin = new Cliente();
  if ((await admin.login('admin', SENHA_ADMIN)).status !== 200) throw new Error('Rode o smoke antes (ele define a senha do admin) ou informe ADMIN_SENHA');
  const caixa = new Cliente();
  if ((await caixa.login('caixa1', 'Caixa-Senha-2026')).status !== 200) throw new Error('Rode o smoke antes: falta o operador caixa1');
  const cx = (await caixa.get('/caixas/atual')).data;
  if (!cx?.id) throw new Error('O operador caixa1 precisa de um caixa aberto (o smoke deixa um aberto)');
  const sufixo = uuid().slice(0, 6);
  const est = await novoUsuario(admin, 'Estoquista', `e5_${sufixo}`);
  const fin = await novoUsuario(admin, 'Financeiro', `f5_${sufixo}`);
  const vend = await novoUsuario(admin, 'Vendedor', `v5_${sufixo}`);

  console.log('CNPJ alfanumérico (S5-01, ticket 13)');
  let r = await est.post('/parceiros', { id: uuid(), nome: `Loja nova ${sufixo}`, tipo: 'LOJA', documento: '12.abc.345/01de-35' });
  check(r.status === 201 && r.data.documentoExibicao === '12.ABC.345/01DE-35', 'CNPJ com letras (exemplo da Receita), com pontuação e minúsculas, é aceito e guardado em maiúsculas', r.data);
  r = await est.post('/parceiros', { id: uuid(), nome: `Loja errada ${sufixo}`, tipo: 'LOJA', documento: '12ABC34501DE36' });
  check(r.status === 400, 'CNPJ com letras e dígito verificador errado é recusado', r.data);
  r = await est.post('/parceiros', { id: uuid(), nome: `Loja letra no fim ${sufixo}`, tipo: 'LOJA', documento: '12ABC34501DEA5' });
  check(r.status === 400, 'os dois últimos caracteres do CNPJ continuam números', r.data);
  r = await est.post('/parceiros', { id: uuid(), nome: `Loja antiga ${sufixo}`, tipo: 'LOJA', documento: '11222333000181' });
  check(r.status === 201 && r.data.documentoExibicao === '11.222.333/0001-81', 'CNPJ só com números continua aceito', r.data);
  r = await est.post('/parceiros', { id: uuid(), nome: `Pessoa ${sufixo}`, tipo: 'PESSOA_FISICA', documento: '5299822472A' });
  check(r.status === 400, 'CPF com letra é recusado', r.data);
  r = await admin.arquivo('/importacoes/parceiros', 'parceiros.csv', 'text/csv', `nome;documento;tipo\nImportada ${sufixo};12.ABC.345/01DE-35;LOJA\n`);
  check(r.status === 200 && r.data.aceitas?.length === 1, 'a importação de parceiros aceita o CNPJ com letras', r.data);
  r = await admin.arquivo('/importacoes/parceiros', 'parceiros.csv', 'text/csv', `nome;documento\nImportada errada ${sufixo};12ABC34501DE36\n`);
  check(r.status === 200 && r.data.recusadas?.[0]?.motivo.includes('CPF/CNPJ'), 'e recusa o CNPJ com letras e dígito errado', r.data);
  const inst = (await admin.get('/instituicao')).data;
  r = await admin.put('/instituicao', { ...inst, cnpj: '12.ABC.345/01DE-35' });
  check(r.status === 200 && r.data.cnpj === '12ABC34501DE35', 'o CNPJ da instituição aceita letras', r.data);
  r = await admin.put('/instituicao', { ...inst, cnpj: '12ABC34501DEXX' });
  check(r.status === 400, 'o CNPJ da instituição com letra nos dígitos verificadores é recusado', r.data);
  await admin.put('/instituicao', inst);

  console.log('Pouco saldo nos parâmetros (S5-17, P-08)');
  const par = ((await admin.get('/parametros')).data as any[]).find((p) => p.chave === 'estoque.pouco_saldo');
  check(par?.valor === '5' && par.tipo === 'number', 'o parâmetro existe, é número e começa em 5', par);
  check((await admin.put('/parametros', { valores: [{ chave: 'estoque.pouco_saldo', valor: 'abc' }] })).status === 400, 'valor que não é número é recusado');
  check((await admin.put('/parametros', { valores: [{ chave: 'estoque.pouco_saldo', valor: '1001' }] })).status === 400, 'acima de 1000 é recusado');
  r = await admin.put('/parametros', { valores: [{ chave: 'estoque.pouco_saldo', valor: '8' }] });
  check(r.status === 200 && (r.data as any[]).find((p) => p.chave === 'estoque.pouco_saldo')?.valor === '8', 'o Admin muda o valor', r.data);
  await admin.put('/parametros', { valores: [{ chave: 'estoque.pouco_saldo', valor: '5' }] });

  console.log('Nova compra do Financeiro (S5-11)');
  r = await fin.post('/parceiros', { id: uuid(), nome: `Fornecedor ${sufixo}`, tipo: 'EMPRESA', documento: '12ABC34501DE35' });
  check(r.status === 201, 'o Financeiro cadastra o fornecedor novo, com CNPJ de letras', r.data);
  const forn = r.data;
  check((await fin.req('PATCH', `/parceiros/${forn.id}`, { nome: 'Outro nome' })).status === 403, 'mas não edita parceiro (só o Admin)');
  r = await fin.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: forn.id, valorCompra: '150.00', vencimento: '2026-12-01', documento: 'NF 123' });
  check(r.status === 201 && r.data.tipo === 'COMPRA', 'o Financeiro lança a compra', r.data);
  const loteCompra = r.data;
  const conta = ((await fin.get('/contas-pagar?pageSize=100')).data.items as any[]).find((c) => c.loteId === loteCompra.id);
  check(conta?.valor === '150.00' && conta.status === 'ABERTA' && conta.vencimento === '2026-12-01', 'a conta a pagar nasce junto, com o valor e o vencimento', conta);
  r = await fin.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: forn.id });
  check(r.status === 403, 'o Financeiro não cria lote de doação', r.data);
  r = await fin.post('/lotes', { id: uuid(), tipo: 'SALDO_INICIAL', parceiroId: forn.id });
  check(r.status === 403, 'nem de saldo inicial', r.data);
  check((await fin.arquivo(`/lotes/${loteCompra.id}/documento`, 'nota.pdf', 'application/pdf', PDF)).status === 204, 'o Financeiro anexa a nota da compra');
  const doacao = (await est.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: forn.id })).data;
  check((await fin.arquivo(`/lotes/${doacao.id}/documento`, 'termo.pdf', 'application/pdf', PDF)).status === 403, 'mas não anexa documento em lote de doação');
  check((await fin.post(`/lotes/${loteCompra.id}/itens`, {})).status === 403, 'nem cadastra os produtos do lote (é do estoque)');
  check((await est.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: forn.id, valorCompra: '10.00' })).status === 403, 'o Estoquista continua sem lançar compra');
  check((await vend.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: forn.id, valorCompra: '10.00' })).status === 403, 'o Vendedor não lança compra');

  console.log('Caixas do dia e fechamentos (S5-06 e S5-09)');
  const term = (await admin.post('/terminais', { id: uuid(), nome: `Caixa S5 ${sufixo}` })).data;
  const cxv = (await vend.post('/caixas', { id: uuid(), terminalId: term.id, fundoTroco: '20.00' })).data;
  r = await vend.post(`/caixas/${cxv.id}/fechar`, { contado: '18.50', observacao: 'Faltou troco na conferência' });
  check(r.status === 200 && r.data.diferenca === '-1.50', 'caixa fechado com R$ 1,50 a menos', r.data);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  r = await fin.get('/caixas?status=ABERTO&pageSize=100');
  check(r.status === 200 && (r.data.items as any[]).some((c) => c.id === cx.id) && (r.data.items as any[]).every((c) => c.status === 'ABERTO'), 'o Financeiro vê os caixas abertos agora, de qualquer operador', r.data?.items?.length);
  r = await admin.get(`/caixas?de=${hoje}&ate=${hoje}&comDiferenca=true&pageSize=100`);
  const comDif = r.data?.items as any[] | undefined;
  check(r.status === 200 && comDif?.some((c) => c.id === cxv.id) && comDif.every((c) => c.status === 'FECHADO' && c.diferenca !== '0.00'), 'filtro "fechados com diferença" traz só os que tiveram diferença', comDif?.length);
  r = await fin.get(`/caixas?status=FECHADO&de=${hoje}&ate=${hoje}&pageSize=100`);
  check(r.status === 200 && (r.data.items as any[]).some((c) => c.id === cxv.id) && !(r.data.items as any[]).some((c) => c.id === cx.id), 'filtro "fechados" não traz o caixa aberto', r.data?.items?.length);
  check((await fin.get('/caixas?status=OUTRO')).status === 400, 'situação desconhecida é recusada');
  r = await fin.get(`/caixas/${cx.id}/resumo`);
  check(r.status === 200 && r.data.caixa?.id === cx.id && r.data.caixa.operadorNome && r.data.totaisPorForma?.DINHEIRO !== undefined && r.data.esperadoDinheiro !== undefined, 'o detalhe traz o caixa, os totais por forma e o dinheiro esperado', r.data);
  r = await admin.get(`/caixas/${cxv.id}/resumo`);
  check(r.status === 200 && r.data.caixa.diferenca === '-1.50' && r.data.fundoTroco === '20.00', 'o Admin abre o detalhe de um caixa fechado', r.data);
  check((await caixa.get(`/caixas/${cx.id}/resumo`)).status === 200, 'o operador vê o detalhe do próprio caixa');
  check((await vend.get(`/caixas/${cx.id}/resumo`)).data?.code === 'CAIXA_DE_OUTRO_OPERADOR', 'mas não o de outro operador');
  check((await est.get('/caixas')).status === 403 && (await est.get(`/caixas/${cx.id}/resumo`)).status === 403, 'o Estoquista não vê os caixas');
  check((await fin.get(`/caixas/${uuid()}/resumo`)).status === 404, 'caixa inexistente: 404');

  console.log('Resumo financeiro em PDF (S5-10)');
  r = await fin.get(`/financeiro/resumo?de=${hoje}&ate=${hoje}`);
  check(r.status === 200 && r.data.reembolsos !== undefined && r.data.resultado !== undefined, 'o resumo traz os reembolsos à parte', r.data);
  r = await fin.get(`/financeiro/resumo.pdf?de=${hoje}&ate=${hoje}`);
  check(r.status === 200 && r.ct.includes('application/pdf') && r.bytes?.subarray(0, 5).toString() === '%PDF-', 'o Financeiro baixa o resumo em PDF', r.ct);
  check((await admin.get(`/financeiro/resumo.pdf?de=${hoje}&ate=${hoje}`)).status === 200, 'o Admin também');
  check((await fin.get('/financeiro/resumo.pdf?de=2026-10-20&ate=2026-10-01')).status === 400, 'período invertido é recusado');
  check((await fin.get('/financeiro/resumo.pdf')).status === 400, 'sem o período é recusado');
  check((await vend.get(`/financeiro/resumo.pdf?de=${hoje}&ate=${hoje}`)).status === 403 && (await est.get(`/financeiro/resumo.pdf?de=${hoje}&ate=${hoje}`)).status === 403, 'Vendedor e Estoquista não baixam o resumo');

  console.log('Dashboards (S5-07, S5-15, S5-16)');
  const dia = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date(Date.now() + n * 864e5));
  r = await admin.get(`/painel/admin?de=${dia(-6)}&ate=${hoje}`);
  const somaFormas = r.data ? Object.values(r.data.vendas.porForma as Record<string, string>).reduce((x: number, v) => x + Math.round(Number(v) * 100), 0) : -1;
  check(r.status === 200 && r.data.vendas.porDia.length === 7 && somaFormas === Math.round(Number(r.data.vendas.total) * 100), 'painel do Admin: 7 dias no gráfico e as formas somam o total', r.data?.vendas);
  check(r.data?.caixasAbertos?.some((c: any) => c.id === cx.id && c.esperadoDinheiro !== undefined), 'painel do Admin: o caixa aberto aparece com o dinheiro esperado');
  check(r.data?.estoque?.valorAtribuido !== undefined && Array.isArray(r.data?.eventos), 'painel do Admin: estoque com custo (o Admin vê custo) e os eventos sensíveis');
  const soPix = await admin.get(`/painel/admin?de=${dia(-6)}&ate=${hoje}&forma=PIX`);
  check(soPix.status === 200 && soPix.data.vendas.total === soPix.data.vendas.porForma.PIX, 'filtro de forma: o total é só o PIX', soPix.data?.vendas);
  check((await admin.get(`/painel/admin?de=${hoje}&ate=${dia(-1)}`)).status === 400, 'período invertido é recusado');
  check((await admin.get(`/painel/admin?de=2024-01-01&ate=${hoje}`)).status === 400, 'período de mais de um ano é recusado');
  check((await admin.get(`/painel/admin?de=2026-13-01&ate=2026-13-02`)).status === 400 && (await admin.get(`/painel/admin?de=2026-02-31&ate=2026-03-01`)).status === 400, 'data inexistente (mês 13, 31 de fevereiro) volta 400, não 500');
  check((await admin.get(`/painel/admin?de=${dia(-366)}&ate=${hoje}`)).status === 400 && (await admin.get(`/painel/admin?de=${dia(-365)}&ate=${hoje}`)).status === 200, 'no máximo 366 dias, contando os dois extremos');
  check((await fin.get(`/painel/admin?de=${hoje}&ate=${hoje}`)).status === 403 && (await est.get(`/painel/admin?de=${hoje}&ate=${hoje}`)).status === 403, 'Financeiro e Estoquista não abrem o painel do Admin');
  await admin.post('/perfis', { nome: `Auditor ${sufixo}`, permissoes: ['auditoria.consultar'] });
  const auditor = await novoUsuario(admin, `Auditor ${sufixo}`, `a5_${sufixo}`);
  r = await auditor.get(`/painel/admin?de=${hoje}&ate=${hoje}`);
  check(r.status === 200 && r.data.estoque.valorAtribuido === undefined, 'perfil sem "ver custo" abre o painel sem o custo do estoque', r.data?.estoque);
  r = await est.get(`/painel/estoque?de=${dia(-6)}&ate=${hoje}`);
  check(r.status === 200 && r.data.poucoSaldo.limite === 5 && r.data.entradasPorDia.length === 7 && Array.isArray(r.data.ultimasMovimentacoes), 'painel do Estoque: pouco saldo pelo parâmetro (5), entradas por dia e movimentações', r.data?.poucoSaldo);
  check(r.status === 200 && !JSON.stringify(r.data).includes('valorAtribuido') && !JSON.stringify(r.data).includes('potencial'), 'painel do Estoque não traz custo nem valor', Object.keys(r.data ?? {}));
  check(r.data?.poucoSaldo?.itens?.every((p: any) => p.saldo <= 5), 'pouco saldo: só produtos com 5 ou menos');
  const catFiltro = r.data?.categorias?.[0]?.categoriaId;
  const comDois = catFiltro ? await est.get(`/painel/estoque?de=${dia(-6)}&ate=${hoje}&categoriaId=${catFiltro}&parceiroId=${forn.id}`) : null;
  check(comDois?.status === 200 && comDois.data.categorias.every((c: any) => c.categoriaId === catFiltro), 'categoria e parceiro juntos: o filtro de categoria continua valendo', comDois?.data?.categorias);
  check((await vend.get(`/painel/estoque?de=${hoje}&ate=${hoje}`)).status === 403, 'o Vendedor não abre o painel do Estoque');
  r = await fin.get(`/painel/financeiro?de=${dia(-29)}&ate=${hoje}`);
  const cent = (v: string) => Math.round(Number(v) * 100);
  check(r.status === 200 && cent(r.data.hoje.entradas) - cent(r.data.hoje.saidas) === cent(r.data.hoje.resultado) && r.data.porDia.length === 30, 'painel do Financeiro: entradas menos saídas dá o resultado; 30 dias no gráfico', r.data?.hoje);
  check(r.data?.caixasComDiferenca?.itens?.some((c: any) => c.id === cxv.id && c.diferenca === '-1.50'), 'painel do Financeiro: o caixa fechado com diferença aparece');
  check((await est.get(`/painel/financeiro?de=${hoje}&ate=${hoje}`)).status === 403 && (await vend.get(`/painel/financeiro?de=${hoje}&ate=${hoje}`)).status === 403, 'Estoquista e Vendedor não abrem o painel do Financeiro');

  console.log('Fluxo de caixa (S5-08)');
  r = await fin.get(`/financeiro/fluxo-caixa?de=${hoje}&ate=2026-12-01`);
  const ultimo = r.data?.dias?.at(-1);
  check(r.status === 200 && ultimo?.dia === '2026-12-01' && cent(ultimo.aPagar) >= 15000, 'a conta da compra aparece como "a pagar" no dia do vencimento', ultimo);
  check(r.data?.dias?.filter((d: any) => d.dia > hoje).every((d: any) => d.entradas === '0.00' && d.saidas === '0.00'), 'depois de hoje só há previsto (nada realizado)');
  check(r.data && ultimo.acumulado === r.data.totais.saldo, 'o acumulado do último dia é o saldo do período', r.data?.totais);
  check((await vend.get(`/financeiro/fluxo-caixa?de=${hoje}&ate=${hoje}`)).status === 403, 'o Vendedor não abre o fluxo de caixa');

  console.log('Importação de planilha no lote (S5-03)');
  const catImp = (await admin.post('/categorias', { id: uuid(), nome: `Importada ${sufixo}`, precoPadrao: '5.00', vendaPorCategoria: false })).data;
  const loteImp = (await est.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: forn.id })).data;
  const csv = ['titulo_etiqueta;nome;categoria;preco;quantidade;valor_atribuido;estoque;peca_unica',
    `Caneca;Caneca ${sufixo};${catImp.nome};12,50;3;2,00;Bazar;não`,
    `;Sem preço ${sufixo};${catImp.nome};;1;1;;`,
    `Vaso;Vaso ${sufixo};Categoria que não existe;20;1;5;;`,
    `Quadro;Quadro ${sufixo};${catImp.nome};45;2;10;;sim`,
    `Abajur;Abajur ${sufixo};${catImp.nome};30;1;8;Depósito;`,
    `Prato;Prato ${sufixo};${catImp.nome.toUpperCase()};1.234,50;1;3;Doações;`].join('\n');
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'lote.csv', 'text/csv', csv);
  const motivos = (r.data?.recusadas ?? []).map((x: any) => `${x.linha}:${x.motivo}`);
  check(r.status === 200 && r.data.total === 6 && r.data.aceitas.length === 2 && r.data.recusadas.length === 4, 'grava as 2 linhas válidas e recusa as 4 erradas', r.data);
  check(motivos.some((m: string) => m.startsWith('3:') && m.includes('preco')) && motivos.some((m: string) => m.startsWith('4:') && m.includes('Categoria')) && motivos.some((m: string) => m.startsWith('5:') && m.includes('Peça única'))
    && motivos.some((m: string) => m.startsWith('6:') && m.includes('Estoque')), 'cada recusada volta com a linha e o motivo', motivos);
  const itensImp = (await est.get(`/lotes/${loteImp.id}`)).data.itens as any[];
  check(itensImp.length === 2 && itensImp.every((i) => i.status === 'CADASTRADO'), 'as linhas aceitas viram itens cadastrados, sem aprovar', itensImp.map((i) => i.status));
  check(itensImp.some((i) => i.preco === '1234.50' && i.localDestino === 'DOACOES'), 'preço com milhar (1.234,50) e estoque Doações são lidos', itensImp.map((i) => [i.preco, i.localDestino]));
  const codImp = r.data.aceitas[0].codigo;
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'entrada.csv', 'text/csv', `codigo;quantidade;valor_atribuido\n${codImp};4;1,50\nBZ999999;1;1\n`);
  check(r.status === 200 && r.data.aceitas.length === 1 && r.data.aceitas[0].codigo === codImp && r.data.recusadas[0]?.motivo.includes('inexistente'), 'pelo código: nova entrada de produto que já existe; código desconhecido é recusado', r.data);
  const grande = ['nome;categoria;preco;quantidade;valor_atribuido', ...Array.from({ length: 1001 }, (_, k) => `Item ${k};${catImp.nome};1;1;1`)].join('\n');
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'grande.csv', 'text/csv', grande);
  check(r.status === 413 && r.data?.code === 'PLANILHA_GRANDE' && (await est.get(`/lotes/${loteImp.id}`)).data.itens.length === 3, 'mais de 1.000 linhas: recusada inteira, sem gravar nada', r.data);
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'x.csv', 'text/csv', 'coluna;outra\na;b\n');
  check(r.status === 400 && r.data?.code === 'PLANILHA_INVALIDA', 'planilha fora do modelo é recusada inteira', r.data);
  check((await vend.arquivo(`/lotes/${loteImp.id}/importacao`, 'lote.csv', 'text/csv', csv)).status === 403, 'o Vendedor não importa');
  r = await fin.arquivo(`/lotes/${loteCompra.id}/importacao`, 'lote.csv', 'text/csv', csv);
  check(r.status === 403, 'o Financeiro não importa produtos (é do estoque)', r.data);
  const compraImp = (await admin.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: forn.id, valorCompra: '30.00' })).data;
  r = await admin.arquivo(`/lotes/${compraImp.id}/importacao`, 'c.csv', 'text/csv', `nome;categoria;preco;quantidade;valor_atribuido\nCesto ${sufixo};${catImp.nome};9;1;\nCesta ${sufixo};${catImp.nome};9;1;0\n`);
  check(r.status === 200 && r.data.recusadas.length === 2 && r.data.recusadas[0].motivo.includes('valor_atribuido') && r.data.recusadas[1].motivo.includes('custo'),
    'em lote de compra, linha sem custo ou com custo zero é recusada', r.data);
  r = await admin.req('PATCH', `/produtos/${itensImp[0].produto.id}/preco`, { preco: 'abc', motivo: 'teste de validação' });
  check(r.status === 400 && r.data?.code === 'VALIDACAO', 'preço fora do formato volta 400 (antes dava 500)', r.data);

  console.log('Modelos para baixar e importações padronizadas (S5-02, S5-05)');
  for (const t of ['lote', 'categorias', 'parceiros', 'campanhas', 'clientes', 'carga-inicial']) {
    const csvM = await admin.get(`/modelos/${t}?formato=csv`), xlsxM = await admin.get(`/modelos/${t}?formato=xlsx`);
    check(csvM.status === 200 && csvM.ct.includes('text/csv') && csvM.bytes!.length > 20 && xlsxM.status === 200 && xlsxM.bytes!.subarray(0, 2).toString() === 'PK', `modelo ${t} em CSV e XLSX`, [csvM.status, xlsxM.status]);
  }
  const modeloLote = (await est.get('/modelos/lote')).bytes!.toString('utf8');
  check(modeloLote.includes('titulo_etiqueta') && modeloLote.includes('valor_atribuido'), 'o Estoquista baixa o modelo do lote, com as colunas certas');
  check((await est.get('/modelos/categorias')).status === 403 && (await est.get('/modelos/carga-inicial')).status === 403, 'mas não os modelos de cadastros nem da carga inicial');
  check((await vend.get('/modelos/clientes')).status === 403 && (await fin.get('/modelos/lote')).status === 403, 'Vendedor e Financeiro não baixam modelos');
  check((await admin.get('/modelos/outro')).status === 400 && (await admin.get('/modelos/lote?formato=pdf')).status === 400, 'tipo ou formato desconhecido: 400');
  // o modelo baixado importa de novo sem erro de cabeçalho (o lote tem uma linha pelo código BZ que já existe na base de teste)
  r = await admin.arquivo('/importacoes/categorias', 'cat.csv', 'text/csv', `nome;preco_padrao;venda_por_categoria\nNova ${sufixo};5,00;sim\nRuim ${sufixo};;sim\nNova ${sufixo};5,00;sim\n${catImp.nome};;não\n`);
  check(r.status === 200 && r.data.total === 4 && r.data.aceitas.length === 1 && r.data.recusadas.length === 3, 'cadastros: grava a válida e recusa as outras (sem preço, repetida na planilha, já cadastrada)', r.data);
  check(r.data?.recusadas?.some((x: any) => x.motivo === 'nome repetido na planilha') && r.data?.recusadas?.some((x: any) => x.motivo === 'já cadastrado'), 'o motivo diz se repetiu na planilha ou se já existe', r.data?.recusadas);
  // S6-17: a carga inicial só vale uma vez. Planilha só com linhas recusadas não grava nada e devolve as recusadas na ordem
  r = await admin.arquivo('/carga-inicial', 'carga.csv', 'text/csv', `categoria;quantidade;preco;estoque;controle\nInexistente ${sufixo};1;4,00;Bazar;categoria\n${catImp.nome};2;4,00;Depósito;categoria\n`);
  check(r.status === 200 && r.data.aceitas.length === 0 && r.data.recusadas.length === 2 && r.data.recusadas[0].linha === 2 && r.data.recusadas[1].linha === 3, 'carga inicial só com linhas ruins: não grava nada e devolve as recusadas na ordem das linhas', r.data);
  r = await admin.arquivo('/carga-inicial', 'carga.csv', 'text/csv', `categoria;quantidade;preco;estoque;controle\n${catImp.nome};3;4,00;Bazar;categoria\n`);
  const primeira = r.status === 200 && r.data.aceitas.length === 1; // o reteste, se rodou antes, já fez a carga
  check(primeira || (r.status === 409 && r.data?.code === 'CARGA_JA_FEITA'), 'carga inicial com linha válida: grava (a primeira) ou é recusada (já feita)', r.data);
  r = await admin.arquivo('/carga-inicial', 'carga.csv', 'text/csv', `categoria;quantidade;preco;estoque;controle\n${catImp.nome};3;4,00;Bazar;categoria\n`);
  check(r.status === 409 && r.data?.code === 'CARGA_JA_FEITA', 'segunda carga inicial é recusada (estoque novo só por lote e aprovação)', r.data);
  // correções do QA da S5-05
  r = await admin.arquivo('/importacoes/campanhas', 'camp.csv', 'text/csv', `nome;inicio;fim\nInvertida ${sufixo};2026-11-10;2026-11-01\n`);
  check(r.status === 200 && r.data.aceitas.length === 0 && r.data.recusadas[0]?.motivo === 'fim: antes do início', 'campanha com fim antes do início é recusada, como na tela', r.data);
  const catOff = (await admin.post('/categorias', { id: uuid(), nome: `Desativada ${sufixo}`, precoPadrao: '5.00', vendaPorCategoria: false })).data;
  await admin.patch(`/categorias/${catOff.id}`, { ativo: false });
  r = await admin.arquivo('/carga-inicial', 'carga.csv', 'text/csv', `categoria;quantidade;preco;estoque;controle\n${catOff.nome};3;4,00;Bazar;categoria\n`);
  check(r.status === 200 && r.data.aceitas.length === 0 && r.data.recusadas.length === 1, 'carga inicial não aceita categoria desativada', r.data);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('categorias');
  ws.addRow(['nome']); ws.addRow([{ richText: [{ text: 'Rica ' }, { font: { bold: true }, text: sufixo }] }]);
  r = await admin.arquivo('/importacoes/categorias', 'rica.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await wb.xlsx.writeBuffer()));
  check(r.status === 200 && r.data.aceitas[0]?.nome === `Rica ${sufixo}`, 'XLSX com texto formatado é lido como texto (não "[object Object]")', r.data);
  // zip-bomba (na importação do lote, que lê a planilha do mesmo jeito; a de cadastros já gastou o limite de 5 por minuto): poucos KB compactados que viram mais de 50 MB na memória são recusados antes de o ExcelJS carregar
  const wbB = new ExcelJS.Workbook(); const wsB = wbB.addWorksheet('categorias');
  wsB.addRow(['nome']); for (let i = 0; i < 55; i++) wsB.addRow([`${i}`.padEnd(1024 * 1024, 'x')]);
  const bomba = Buffer.from(await wbB.xlsx.writeBuffer());
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'bomba.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bomba);
  check(bomba.length < 2 * 1024 * 1024 && r.status === 413 && r.data?.code === 'PLANILHA_GRANDE', 'XLSX que passa de 50 MB descompactado é recusado (zip-bomba)', { kb: Math.round(bomba.length / 1024), status: r.status, code: r.data?.code });
  // a mesma bomba dizendo no fim do zip que tem 1 arquivo só: o ExcelJS lê todos assim mesmo, então a conferência também
  const forjada = Buffer.from(bomba); const fimZip = forjada.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  forjada.writeUInt16LE(1, fimZip + 8); forjada.writeUInt16LE(1, fimZip + 10);
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'forjada.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', forjada);
  check(r.status === 413 && r.data?.code === 'PLANILHA_GRANDE', 'zip-bomba com a contagem de arquivos adulterada também é recusada', { status: r.status, code: r.data?.code });
  // S6-04: XLSX corrompido (zip bom, conteúdo estragado) derrubava o ExcelJS com TypeError e virava 500; agora é 415 (10ª importação do lote no minuto: o limite é 10)
  const { deflateRawSync } = await import('node:zlib');
  const zipCom = (arquivos: [string, string][]) => { // zip mínimo, sem biblioteca: o bastante para o ExcelJS achar o workbook e quebrar nele
    const locais: Buffer[] = [], centrais: Buffer[] = []; let off = 0;
    for (const [nome, txt] of arquivos) {
      const dados = deflateRawSync(Buffer.from(txt)), n = Buffer.from(nome), crc = (zlibCrc(Buffer.from(txt)) >>> 0);
      const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(dados.length, 18); l.writeUInt32LE(txt.length, 22); l.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(dados.length, 20); c.writeUInt32LE(txt.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      locais.push(l, n, dados); centrais.push(c, n); off += 30 + n.length + dados.length;
    }
    const cd = Buffer.concat(centrais), fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
    return Buffer.concat([...locais, cd, fim]);
  };
  const zlibCrc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c; };
  const corrompido = zipCom([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook><sheets><sheet name="a" sheetId="1"'],
  ]);
  r = await est.arquivo(`/lotes/${loteImp.id}/importacao`, 'corrompido.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', corrompido);
  check(r.status === 415 && r.data?.code === 'TIPO_INVALIDO', 'XLSX corrompido é recusado como tipo inválido (415), não erro interno', { status: r.status, code: r.data?.code });

  console.log('Importação de NF-e (S5-04, P-20)');
  const XML = 'application/xml';
  const dv11 = (base: string, pesos: number[]) => { const s = pesos.reduce((t, p, i) => t + (base.charCodeAt(i) - 48) * p, 0) % 11; return s < 2 ? 0 : 11 - s; };
  const novoCnpj = () => { let b = String(Math.floor(Math.random() * 1e12)).padStart(12, '7'); b += dv11(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return b + dv11(b, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); };
  const dvChave = (b: string) => { let s = 0; for (let i = 0; i < 43; i++) s += (b.charCodeAt(42 - i) - 48) * (2 + (i % 8)); const m = s % 11; return m < 2 ? 0 : 11 - m; };
  const chaveDe = (xml: string) => /Id="NFe([0-9A-Z]{44})"/.exec(xml)![1]!;
  /** Troca o emitente da nota de exemplo (o CNPJ está dentro da chave: refaz a chave e o dígito). */
  const comEmitente = (xml: string, cnpj: string, nome: string) => {
    const antiga = chaveDe(xml), base = antiga.slice(0, 6) + cnpj + antiga.slice(20, 43), nova = base + dvChave(base);
    return xml.replaceAll(antiga, nova).replace('<CNPJ>12ABC34501DE35</CNPJ><xNome>Fornecedor Exemplo Ltda</xNome>', `<CNPJ>${cnpj}</CNPJ><xNome>${nome}</xNome>`);
  };
  const modelo = async () => (await fin.get('/modelos/nfe')).bytes!.toString('utf8');
  // a nota tem de ser para a instituição: o bloco usa um CNPJ só dele e devolve o original no fim
  const instAntes = (await admin.get('/instituicao')).data;
  await admin.put('/instituicao', { ...instAntes, cnpj: novoCnpj() });

  const m1 = await fin.get('/modelos/nfe');
  check(m1.status === 200 && m1.ct.includes('xml') && m1.bytes!.toString('utf8').includes('<nfeProc') && m1.bytes!.toString('utf8').includes('<tpAmb>2</tpAmb>'), 'o Financeiro baixa a NF-e de exemplo (homologação, sem valor fiscal)', m1.status);
  check((await est.get('/modelos/nfe')).status === 403 && (await vend.get('/modelos/nfe')).status === 403, 'Estoquista e Vendedor não baixam a NF-e de exemplo');

  const cnpjNovo = novoCnpj(), nomeNovo = `Fornecedor NF-e ${sufixo}`;
  const xml1 = comEmitente(await modelo(), cnpjNovo, nomeNovo);
  r = await fin.arquivo('/lotes/nfe', 'nota.xml', XML, xml1);
  check(r.status === 201 && r.data.lote.tipo === 'COMPRA' && r.data.fornecedor.novo === true && r.data.fornecedor.nome === nomeNovo && r.data.valor === '400.00' && r.data.produtos.length === 2, 'a NF-e vira lote de compra e cadastra o emitente como fornecedor', r.data);
  const loteNfe = r.data?.lote;
  const vencEsperado = /<dVenc>(\d{4}-\d{2}-\d{2})<\/dVenc>/.exec(xml1)![1];
  check(r.data?.vencimento === vencEsperado && r.data?.parcelas === 1, 'a conta a pagar vence na data da parcela da nota', r.data?.vencimento);
  const detNfe = (await admin.get(`/lotes/${loteNfe?.id}`)).data;
  check(detNfe?.valorCompra === '400.00' && detNfe?.documento?.startsWith(r.data?.numero), 'o lote guarda o valor e o número da nota', detNfe);
  const parcNfe = ((await admin.get(`/parceiros?busca=${encodeURIComponent(nomeNovo)}`)).data as any[]);
  check(parcNfe.length === 1 && parcNfe[0].tipo === 'EMPRESA', 'o fornecedor foi cadastrado uma vez só, como empresa', parcNfe);
  r = await fin.arquivo('/lotes/nfe', 'nota.xml', XML, xml1);
  check(r.status === 409 && r.data?.code === 'NFE_JA_IMPORTADA', 'a mesma nota de novo: 409, nada duplicado', r.data);
  const xml2 = comEmitente(await modelo(), cnpjNovo, nomeNovo);
  r = await fin.arquivo('/lotes/nfe', 'nota2.xml', XML, xml2);
  check(r.status === 201 && r.data.fornecedor.novo === false, 'outra nota do mesmo emitente usa o fornecedor já cadastrado', r.data?.fornecedor);
  const xml3 = await modelo();
  const [p1, p2] = await Promise.all([fin.arquivo('/lotes/nfe', 'a.xml', XML, xml3), fin.arquivo('/lotes/nfe', 'b.xml', XML, xml3)]);
  check([p1.status, p2.status].sort().join() === '201,409', 'dois envios da mesma nota ao mesmo tempo: um entra, o outro volta 409', [p1.status, p2.status]);

  const base = await modelo();
  const recusa = async (xml: string, nome: string, code?: string) => {
    const x = await fin.arquivo('/lotes/nfe', 'ruim.xml', XML, xml);
    check(x.status === 400 && (!code || x.data?.code === code), nome, [x.status, x.data?.code, x.data?.detail]);
  };
  await recusa(base.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE nfeProc [<!ENTITY x SYSTEM "file:///etc/passwd">]>'), 'XML com DTD/entidade (XXE) é recusado sem ler', 'NFE_INVALIDA');
  await recusa('%PDF-1.4 não é xml', 'arquivo que não é XML (PDF da DANFE) é recusado');
  // S6-04: o teto de 2 MB vale já na leitura do arquivo, com o mesmo código de antes
  const enorme = await fin.arquivo('/lotes/nfe', 'enorme.xml', XML, base.replace('<infNFe', ' '.repeat(2 * 1024 * 1024 + 10) + '<infNFe'));
  check(enorme.status === 413 && enorme.data?.code === 'ARQUIVO_GRANDE', 'NF-e acima de 2 MB é recusada (413 ARQUIVO_GRANDE)', [enorme.status, enorme.data?.code]);
  await recusa(base.slice(0, 400), 'XML cortado é recusado');
  await recusa(base.replace('<cStat>100</cStat>', '<cStat>101</cStat>'), 'nota cancelada é recusada', 'NFE_CANCELADA');
  await recusa(base.replace(/<protNFe[\s\S]*<\/protNFe>/, ''), 'nota sem protocolo de autorização é recusada', 'NFE_SEM_PROTOCOLO');
  await recusa(base.replace('<mod>55</mod>', '<mod>65</mod>'), 'NFC-e (cupom) é recusada');
  const ch = chaveDe(base);
  await recusa(base.replaceAll(ch, ch.slice(0, 43) + ((Number(ch[43]) + 1) % 10)), 'chave com dígito errado é recusada');
  await recusa(comEmitente(base, novoCnpj(), 'Outro').replace(/<emit><CNPJ>[0-9A-Z]{14}/, '<emit><CNPJ>11222333000181'), 'chave que não é do emitente é recusada');
  await recusa(base.replace(/<dest><CNPJ>[0-9A-Z]{14}<\/CNPJ>/, '<dest><CNPJ>11222333000181</CNPJ>'), 'nota emitida para outro CNPJ (não a instituição) é recusada', 'NFE_OUTRO_DESTINATARIO');
  await recusa(base.replace(/<vNF>[\d.]+<\/vNF>/, '<vNF>0.00</vNF>'), 'nota com valor zero é recusada');

  const cnpjInativo = novoCnpj();
  const pInativo = (await admin.post('/parceiros', { id: uuid(), nome: `Inativo NF-e ${sufixo}`, tipo: 'EMPRESA', documento: cnpjInativo })).data;
  await admin.req('PATCH', `/parceiros/${pInativo.id}`, { ativo: false });
  r = await fin.arquivo('/lotes/nfe', 'inativo.xml', XML, comEmitente(await modelo(), cnpjInativo, 'Inativo'));
  check(r.status === 409 && r.data?.code === 'FORNECEDOR_INATIVO', 'emitente desativado: 409, sem criar outro fornecedor', r.data);
  check((await est.arquivo('/lotes/nfe', 'n.xml', XML, await modelo())).status === 403 && (await vend.arquivo('/lotes/nfe', 'n.xml', XML, base)).status === 403, 'Estoquista e Vendedor não importam NF-e');
  r = await admin.arquivo('/lotes/nfe', 'admin.xml', XML, await modelo());
  check(r.status === 201, 'o Admin também importa', r.data);
  // correções do QA da S5-04
  const cnpjEnt = novoCnpj();
  const xmlEnt = comEmitente(await modelo(), cnpjEnt, `ACME &amp; FILHOS &#8212; ${sufixo}`).replace('<qCom>20.0000</qCom>', '<qCom>100</qCom>');
  r = await fin.arquivo('/lotes/nfe', 'ent.xml', XML, xmlEnt);
  check(r.status === 201 && r.data.fornecedor.nome === `ACME & FILHOS — ${sufixo}`, 'o nome com &amp; e entidade numérica é gravado decodificado', r.data?.fornecedor);
  const obs = (await admin.get(`/lotes/${r.data?.lote?.id}`)).data?.observacao ?? '';
  check(obs.includes('100 PCT Cabide') && obs.includes('5 RL Saco'), 'a quantidade inteira (100) não perde zeros na lista do lote', obs);
  const cnpjCorrida = novoCnpj(), nomeCorrida = `Corrida ${sufixo}`;
  const [c1, c2] = await Promise.all([fin.arquivo('/lotes/nfe', 'c1.xml', XML, comEmitente(await modelo(), cnpjCorrida, nomeCorrida)), fin.arquivo('/lotes/nfe', 'c2.xml', XML, comEmitente(await modelo(), cnpjCorrida, nomeCorrida))]);
  const parcCorrida = (await admin.get(`/parceiros?busca=${encodeURIComponent(nomeCorrida)}`)).data as any[];
  check(c1.status === 201 && c2.status === 201 && parcCorrida.length === 1 && [c1.data.fornecedor.novo, c2.data.fornecedor.novo].sort().join() === 'false,true', 'duas notas do mesmo emitente novo ao mesmo tempo: um fornecedor só', [c1.status, c2.status, parcCorrida.length]);
  await admin.put('/instituicao', instAntes);

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
