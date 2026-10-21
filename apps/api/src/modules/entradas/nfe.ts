/**
 * NF-e (S5-04): leitura segura do XML da nota (modelo 55, leiaute 4.00) e o XML de exemplo para baixar (S5-02).
 * Decisões em P-20 do plano: a nota vira lote de COMPRA com a conta a pagar; os produtos não viram itens (sem categoria
 * nem preço de venda, o estoque cadastra depois); recusa nota sem protocolo, cancelada, de homologação (só em produção),
 * NFC-e, de entrada própria e de outro destinatário.
 * Segurança: arquivo com DTD ou entidade é recusado antes de ler (XXE, "billion laughs"); valores lidos como texto
 * (a chave e o CNPJ não perdem zeros); a mensagem do leitor nunca volta ao cliente nem vai ao log (pode citar o XML).
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError } from '../../shared/errors.js';
import { cnpjValido, cpfValido, normalizarDocumento } from '../../shared/documento.js';
import { dataExiste } from '../../shared/http.js';

export const MAX_BYTES_NFE = 2 * 1024 * 1024; // uma NF-e comum tem menos de 200 KB; 990 produtos cabem em ~2 MB
const MAX_PRODUTOS = 1000;
const RE_CHAVE = /^[0-9]{6}[0-9A-Z]{14}[0-9]{24}$/;
const RE_VALOR = /^\d{1,8}(\.\d{1,2})?$/; // a NF-e usa ponto e até 2 casas no total

export interface ProdutoNfe { item: number; nome: string; quantidade: string; unidade: string; valorUnitario: string; valorTotal: string }
export interface NotaLida {
  chave: string; numero: string; serie: string; emissao: string; valor: string; vencimento: string; parcelas: number;
  emitente: { documento: string; tipo: 'EMPRESA' | 'PESSOA_FISICA'; nome: string; cidade: string | null };
  produtos: ProdutoNfe[];
}

const recusar = (motivo: string, code = 'NFE_INVALIDA'): never => { throw new AppError(400, 'NF-e recusada', code, motivo); };

/** Dígito verificador da chave (módulo 11, pesos 2 a 9 da direita para a esquerda; letra vale o código ASCII menos 48). */
export function dvChave(base43: string): number {
  let soma = 0;
  for (let i = 0; i < 43; i++) soma += (base43.charCodeAt(42 - i) - 48) * (2 + (i % 8));
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Corta pelo caractere, não pela unidade UTF-16: um emoji no limite não vira metade inválida. */
export const cortar = (s: string, max: number) => Array.from(s).slice(0, max).join('');

// as entidades ficam sem processar no leitor (nada de DTD); aqui só as 5 do XML e as numéricas, como texto
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (m, e: string) => {
  if (e[0] !== '#') return ENTIDADES[e]!;
  const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
});

/** Texto livre do XML (nome, produto): entidades decodificadas, sem caracteres de controle, espaços simples e no tamanho da coluna. */
const texto = (v: unknown, max: number) => cortar(decodificar(typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), max);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, trimValues: true,
  processEntities: false, htmlEntities: false,
  isArray: (nome) => nome === 'det' || nome === 'dup' || nome === 'detPag',
});

export interface ContextoNfe { cnpjInstituicao: string | null; aceitaHomologacao: boolean }

export function lerNfe(buf: Buffer, ctx: ContextoNfe): NotaLida {
  if (buf.length > MAX_BYTES_NFE) throw new AppError(413, 'Arquivo grande demais', 'ARQUIVO_GRANDE', 'A NF-e deve ter até 2 MB');
  const xml = buf.toString('utf8').replace(/^﻿/, '');
  if (!xml.trimStart().startsWith('<')) recusar('O arquivo não é um XML. Envie o XML da NF-e (não o PDF da DANFE).');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) recusar('O XML tem declarações (DTD) que uma NF-e não tem.');
  if (XMLValidator.validate(xml) !== true) recusar('O XML está corrompido ou incompleto.');
  let doc: Record<string, any>;
  try { doc = parser.parse(xml); } catch { return recusar('O XML está corrompido ou incompleto.'); }

  const proc = doc.nfeProc;
  const nfe = proc?.NFe ?? doc.NFe;
  const inf = nfe?.infNFe;
  if (!inf) recusar(doc.procEventoNFe || doc.evento ? 'Este arquivo é um evento (ex.: cancelamento), não a nota.' : 'O arquivo não é uma NF-e.');
  const prot = proc?.protNFe?.infProt;
  if (!prot) recusar('A nota não tem o protocolo de autorização da SEFAZ. Peça ao fornecedor o XML autorizado.', 'NFE_SEM_PROTOCOLO');

  // chave de acesso: no Id da nota e no protocolo, com o dígito certo
  const chave = str(inf['@_Id']).replace(/^NFe/, '').toUpperCase();
  if (!RE_CHAVE.test(chave) || dvChave(chave.slice(0, 43)) !== Number(chave[43])) recusar('A chave de acesso da nota é inválida.');
  if (str(prot.chNFe).toUpperCase() !== chave) recusar('A chave do protocolo não é a da nota.');
  const cStat = str(prot.cStat);
  if (['101', '135', '151', '155'].includes(cStat)) recusar('A nota foi cancelada.', 'NFE_CANCELADA');
  if (cStat !== '100' && cStat !== '150') recusar(`A nota não está autorizada (situação ${cStat || 'desconhecida'}).`, 'NFE_NAO_AUTORIZADA');

  const ide = inf.ide ?? {};
  if (str(ide.mod) !== '55') recusar(str(ide.mod) === '65' ? 'É uma NFC-e (cupom fiscal), não uma NF-e de compra.' : 'Modelo de nota desconhecido (esperado 55).');
  if (str(ide.tpNF) !== '1') recusar('É uma nota de entrada emitida pelo próprio destinatário, não uma venda do fornecedor.');
  if (str(ide.tpAmb) === '2' && !ctx.aceitaHomologacao) recusar('É uma nota de teste (homologação), sem valor fiscal.', 'NFE_HOMOLOGACAO');
  if (str(ide.tpAmb) !== '1' && str(ide.tpAmb) !== '2') recusar('Ambiente da nota desconhecido.');

  // emitente: CNPJ (com ou sem letras) ou CPF; precisa ser o mesmo que está na chave
  const emit = inf.emit ?? {};
  const cnpj = normalizarDocumento(str(emit.CNPJ)), cpf = normalizarDocumento(str(emit.CPF));
  const documento = cnpj || cpf;
  if (cnpj ? !cnpjValido(cnpj) : !cpfValido(cpf)) recusar('O CNPJ/CPF do emitente é inválido.');
  if (chave.slice(6, 20) !== (cnpj || `000${cpf}`)) recusar('A chave de acesso não é do emitente da nota.');
  const nomeEmit = texto(emit.xNome, 120) || texto(emit.xFant, 120);
  if (nomeEmit.length < 2) recusar('A nota não tem o nome do emitente.');

  // destinatário: a nota tem de ser para a instituição (quando o CNPJ dela está cadastrado)
  const dest = inf.dest ?? {};
  const destDoc = normalizarDocumento(str(dest.CNPJ) || str(dest.CPF));
  if (ctx.cnpjInstituicao && destDoc !== ctx.cnpjInstituicao) recusar('A nota foi emitida para outro destinatário (CNPJ diferente do da instituição).', 'NFE_OUTRO_DESTINATARIO');

  const valor = str(inf.total?.ICMSTot?.vNF);
  if (!RE_VALOR.test(valor) || Number(valor) <= 0) recusar('O valor total da nota é inválido.');

  const dets: any[] = inf.det ?? [];
  if (!dets.length) recusar('A nota não tem produtos.');
  if (dets.length > MAX_PRODUTOS) throw new AppError(413, 'Nota grande demais', 'NFE_GRANDE', `No máximo ${MAX_PRODUTOS} produtos por nota`);
  const produtos = dets.map((d, i) => ({
    item: Number(str(d['@_nItem'])) || i + 1, nome: texto(d.prod?.xProd, 120) || '(sem descrição)', quantidade: str(d.prod?.qCom),
    unidade: texto(d.prod?.uCom, 6), valorUnitario: str(d.prod?.vUnCom), valorTotal: str(d.prod?.vProd),
  }));

  // vencimento: a primeira parcela (uma conta por lote, no valor da nota); sem parcela, vence na emissão
  const emissao = str(ide.dhEmi || ide.dEmi).slice(0, 10);
  if (!dataExiste(emissao)) recusar('A data de emissão da nota é inválida.');
  const datas = ((inf.cobr?.dup ?? []) as any[]).map((d) => str(d.dVenc)).filter(dataExiste).sort();

  return {
    chave, numero: str(ide.nNF), serie: str(ide.serie), emissao, valor, vencimento: datas[0] ?? emissao, parcelas: datas.length,
    emitente: { documento, tipo: cnpj ? 'EMPRESA' : 'PESSOA_FISICA', nome: nomeEmit, cidade: texto(emit.enderEmit?.xMun, 80) || null },
    produtos,
  };
}

// ---------------- XML de exemplo (S5-02) ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EMIT_EXEMPLO = '12ABC34501DE35'; // CNPJ alfanumérico de exemplo da Receita (fictício)
const DEST_EXEMPLO = '11222333000181';

/**
 * Nota fictícia de homologação (tpAmb 2, sem valor fiscal): número sorteado a cada download, para importar mais de uma vez
 * nos testes; destinatário = o CNPJ da instituição, quando cadastrado. Em produção ela é recusada (é de teste).
 */
export function nfeExemplo(cnpjInstituicao: string | null, hoje: string, vencimento: string): string {
  const nNF = String(Math.floor(Math.random() * 999_999_998) + 1);
  const cNF = String(Math.floor(Math.random() * 99_999_999)).padStart(8, '0');
  const aamm = hoje.slice(2, 4) + hoje.slice(5, 7);
  const base = `22${aamm}${EMIT_EXEMPLO}55001${nNF.padStart(9, '0')}1${cNF}`;
  const chave = base + dvChave(base);
  const itens = [
    { nome: 'Cabide de plástico (pacote com 10)', q: '20.0000', un: 'PCT', vu: '12.50' },
    { nome: 'Saco plástico para roupas', q: '5.0000', un: 'RL', vu: '30.00' },
  ];
  const vProd = itens.reduce((s, i) => s + Number(i.q) * Number(i.vu), 0).toFixed(2);
  const det = itens.map((i, k) => `<det nItem="${k + 1}"><prod><cProd>${k + 1}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(i.nome)}</xProd><NCM>39232190</NCM><CFOP>5102</CFOP><uCom>${i.un}</uCom><qCom>${i.q}</qCom><vUnCom>${i.vu}</vUnCom><vProd>${(Number(i.q) * Number(i.vu)).toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>${i.un}</uTrib><qTrib>${i.q}</qTrib><vUnTrib>${i.vu}</vUnTrib><indTot>1</indTot></prod></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- MODELO DE EXEMPLO: nota fictícia de homologação (sem valor fiscal), só para testar a importação. -->
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">` +
    `<ide><cUF>22</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>${hoje}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave[43]}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe></ide>` +
    `<emit><CNPJ>${EMIT_EXEMPLO}</CNPJ><xNome>Fornecedor Exemplo Ltda</xNome><xFant>Fornecedor Exemplo</xFant><enderEmit><xLgr>Rua Exemplo</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>2207702</cMun><xMun>Parnaíba</xMun><UF>PI</UF></enderEmit><IE>ISENTO</IE><CRT>1</CRT></emit>` +
    `<dest><CNPJ>${cnpjInstituicao ?? DEST_EXEMPLO}</CNPJ><xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome></dest>` +
    det +
    `<total><ICMSTot><vProd>${vProd}</vProd><vDesc>0.00</vDesc><vFrete>0.00</vFrete><vOutro>0.00</vOutro><vNF>${vProd}</vNF></ICMSTot></total>` +
    `<cobr><fat><nFat>${nNF}</nFat><vOrig>${vProd}</vOrig><vLiq>${vProd}</vLiq></fat><dup><nDup>001</nDup><dVenc>${vencimento}</dVenc><vDup>${vProd}</vDup></dup></cobr>` +
    `<pag><detPag><tPag>15</tPag><vPag>${vProd}</vPag></detPag></pag></infNFe></NFe>` +
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>${hoje}T10:01:00-03:00</dhRecbto><nProt>222${nNF.padStart(12, '0')}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>
`;
}
