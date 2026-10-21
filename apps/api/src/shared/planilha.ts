/**
 * Leitura de planilha modelo (CSV ou XLSX) para importações e carga inicial,
 * e escrita de CSV/XLSX nos relatórios (com proteção contra injeção de fórmula).
 */
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from './errors.js';

export const MAX_LINHAS = 5000;
/** Teto do XLSX descompactado: uma planilha modelo de 5.000 linhas tem poucos MB. */
export const MAX_XLSX_DESCOMPACTADO = 50 * 1024 * 1024;

export interface Planilha { cabecalho: string[]; linhas: { numero: number; valores: Record<string, string> }[] }

const normalizar = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');

function parseCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
      if (linhas.length > MAX_LINHAS + 1) break;
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ''));
}

/**
 * Zip-bomba: um XLSX de poucos KB pode virar GBs na memória. Antes de o ExcelJS carregar tudo, cada arquivo do zip é
 * descompactado com teto (o tamanho declarado no zip pode mentir); passou do teto somando todos, a planilha é recusada.
 */
function conferirTamanhoXlsx(buf: Buffer, teto = MAX_XLSX_DESCOMPACTADO): void {
  const grande = () => new AppError(413, 'Planilha grande demais depois de descompactada', 'PLANILHA_GRANDE');
  const invalida = () => new AppError(415, 'Envie a planilha modelo em CSV ou XLSX', 'TIPO_INVALIDO');
  // fim do diretório central (assinatura 0x06054b50) nos últimos 22 bytes + o comentário do zip (até 64 KB)
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw invalida();
  // percorre o diretório central enquanto houver registro, como o JSZip do ExcelJS (ele ignora a contagem do fim do zip:
  // um zip que declara 1 arquivo e traz 2 teria o segundo descompactado sem conferir)
  let p = buf.readUInt32LE(fim + 16);
  let resta = teto;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    if (p + 46 > buf.length) throw invalida();
    const metodo = buf.readUInt16LE(p + 10), compactado = buf.readUInt32LE(p + 20), declarado = buf.readUInt32LE(p + 24), local = buf.readUInt32LE(p + 42);
    if (declarado === 0xffffffff || compactado === 0xffffffff || declarado > resta) throw grande(); // zip64 não cabe numa planilha modelo
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw invalida();
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + compactado);
    let real: number;
    if (metodo === 0) real = dados.length;
    else if (metodo === 8) {
      try { real = inflateRawSync(dados, { maxOutputLength: Math.max(1, resta) }).length; }
      catch (e) { throw (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? grande() : invalida(); }
    } else throw invalida();
    resta -= real;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  conferirTamanhoXlsx(buf);
  const wb = new ExcelJS.Workbook();
  // XLSX corrompido (zip bom, conteúdo estragado) derruba o ExcelJS com TypeError: é arquivo inválido (415), não erro interno (S6-04)
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); }
  catch { throw new AppError(415, 'Envie a planilha modelo em CSV ou XLSX', 'TIPO_INVALIDO'); }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const linhas: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (linhas.length > MAX_LINHAS + 1) return;
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value;
      const s = v === null || v === undefined ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') // texto colado com formatação
        : typeof v === 'object' && 'text' in v ? String(v.text)
        : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      vals[col - 1] = s;
    });
    linhas.push(Array.from(vals, (x) => x ?? ''));
  });
  return linhas;
}

/** Lê CSV (texto) ou XLSX (zip pelos magic bytes). Cabeçalhos normalizados (minúsculas, sem acento). */
export async function lerPlanilha(buf: Buffer): Promise<Planilha> {
  const tipo = await fileTypeFromBuffer(buf);
  let linhas: string[][];
  if (tipo?.ext === 'xlsx' || tipo?.mime === 'application/zip') linhas = await parseXlsx(buf);
  else if (!tipo) linhas = parseCsv(buf.toString('utf8'));
  else throw new AppError(415, 'Envie a planilha modelo em CSV ou XLSX', 'TIPO_INVALIDO');
  if (linhas.length < 2) throw new AppError(400, 'Planilha vazia', 'PLANILHA_VAZIA');
  if (linhas.length > MAX_LINHAS + 1) throw new AppError(413, `Planilha com mais de ${MAX_LINHAS} linhas`, 'PLANILHA_GRANDE');
  const cabecalho = linhas[0]!.map(normalizar);
  return {
    cabecalho,
    linhas: linhas.slice(1).map((vals, i) => ({
      numero: i + 2,
      valores: Object.fromEntries(cabecalho.map((h, j) => [h, (vals[j] ?? '').trim()])),
    })),
  };
}

/** Log da linha que falhou: só o código do erro (a mensagem do Prisma repete os valores, com dado pessoal). */
export const codigoErro = (e: unknown): string => (e as { code?: string })?.code ?? (e as Error)?.name ?? 'desconhecido';

// ---------------- escrita ----------------
/** Evita CSV/XLSX injection: células que começam com = + - @ (ou tab/CR) viram texto. */
export const celulaSegura = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
};

export function gerarCsv(cab: string[], linhas: unknown[][]): Buffer {
  const esc = (v: unknown) => `"${celulaSegura(v).replace(/"/g, '""')}"`;
  const txt = [cab.map(esc).join(';'), ...linhas.map((l) => l.map(esc).join(';'))].join('\r\n');
  return Buffer.from('﻿' + txt, 'utf8');
}

export async function gerarXlsx(titulo: string, cab: string[], linhas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow(cab).font = { bold: true };
  for (const l of linhas) ws.addRow(l.map((v) => (typeof v === 'number' ? v : celulaSegura(v))));
  ws.columns.forEach((c) => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
