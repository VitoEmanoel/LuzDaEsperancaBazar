/** PDF do fechamento de caixa: resumo, linha do tempo da abertura ao fechamento e campos de assinatura. Documento não fiscal. */
import PDFDocument from 'pdfkit';
import type { EventoCaixa } from './caixa.service.js';

export interface DadosFechamentoPdf {
  instituicao: { nome: string; cnpj?: string | null };
  terminal: string; operador: string;
  abertoEm: Date; fechadoEm: Date | null; status: 'ABERTO' | 'FECHADO';
  fundoTroco: string; totaisPorForma: Record<string, string>; suprimentos: string; sangrias: string;
  esperado: string; contado: string | null; diferenca: string | null; observacao: string | null;
  eventos: EventoCaixa[]; gavetaAgora: string;
}

export const brl = (v: string | number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });
const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: 'America/Fortaleza' });
/** A fonte padrão do PDF só tem Latin-1. */
export const latin = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ').replace(/→/g, '->').replace(/—/g, '-').replace(/[^\x20-\xFF]/g, '?');
export const FORMAS: [string, string][] = [['DINHEIRO', 'Dinheiro'], ['PIX', 'PIX'], ['CARTAO_DEBITO', 'Cartão de débito'], ['CARTAO_CREDITO', 'Cartão de crédito'], ['FIADO', 'Fiado']];

export function gerarPdfFechamento(d: DadosFechamentoPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Fechamento de caixa', Author: d.instituicao.nome } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(partes))));
  const L = 36, W = doc.page.width - 72;

  doc.font('Helvetica-Bold').fontSize(14).text(latin(d.instituicao.nome), L, 36);
  if (d.instituicao.cnpj) doc.font('Helvetica').fontSize(9).fillColor('#444').text(`CNPJ ${d.instituicao.cnpj}`).fillColor('#000');
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).text('Fechamento de caixa');
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(latin(`Terminal: ${d.terminal} · Operador: ${d.operador}`))
    .text(latin(`Aberto em ${quando.format(d.abertoEm)}${d.fechadoEm ? ` · Fechado em ${quando.format(d.fechadoEm)}` : ' · caixa ainda aberto (parcial)'}`))
    .fillColor('#000');

  const par = (rot: string, val: string, negrito = false) => {
    const y = doc.y;
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(latin(rot), L, y, { width: W * 0.6 });
    doc.text(val, L + W * 0.6, y, { width: W * 0.4, align: 'right' });
    doc.y = y + 15;
  };
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('Resumo'); doc.moveDown(0.3);
  par('Fundo de troco', brl(d.fundoTroco));
  for (const [k, rot] of FORMAS) par(`Vendas em ${rot.toLowerCase()}`, brl(d.totaisPorForma[k] ?? 0));
  par('Suprimentos', brl(d.suprimentos)); par('Sangrias', `- ${brl(d.sangrias)}`);
  par(d.status === 'FECHADO' ? 'Dinheiro esperado na gaveta' : 'Dinheiro na gaveta agora', brl(d.esperado), true);
  if (d.contado !== null) { par('Dinheiro contado', brl(d.contado)); par('Diferença', brl(d.diferenca ?? 0), true); }
  if (d.observacao) { doc.moveDown(0.3).font('Helvetica').fontSize(9).text(latin(`Observação: ${d.observacao}`), L, doc.y, { width: W }); }

  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('O que aconteceu, da abertura ao fechamento', L); doc.moveDown(0.3);
  const cols = [0.12, 0.5, 0.18, 0.2];
  const linha = (v: string[], negrito = false) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y; doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let alt = 0; let x = L;
    v.forEach((t, i) => { const w = W * cols[i]!; alt = Math.max(alt, doc.heightOfString(latin(t), { width: w - 4 })); });
    v.forEach((t, i) => { const w = W * cols[i]!; doc.text(latin(t), x, y, { width: w - 4, align: i >= 2 ? 'right' : 'left' }); x += w; });
    doc.y = y + alt + 4; doc.x = L;
  };
  linha(['Hora', 'Evento', 'Valor', 'Gaveta depois'], true);
  for (const e of d.eventos) {
    linha([latin(hora.format(new Date(e.quando))), `${e.descricao}${e.aposFechamento ? ' (depois do fechamento)' : ''}`, brl(e.valor), e.gavetaApos !== undefined ? brl(e.gavetaApos) : '-']);
  }

  doc.moveDown(2.5);
  if (doc.y > doc.page.height - 110) doc.addPage();
  const y = doc.y;
  doc.moveTo(L, y).lineTo(L + W * 0.45, y).stroke(); doc.moveTo(L + W * 0.55, y).lineTo(L + W, y).stroke();
  doc.font('Helvetica').fontSize(8).text('Operador do caixa', L, y + 3, { width: W * 0.45 });
  doc.text('Conferido por', L + W * 0.55, y + 3, { width: W * 0.45 });
  doc.moveDown(2).fontSize(8).fillColor('#666').text('Documento não fiscal. Gerado pelo Sistema de Bazar - Luz da Esperança.', L);
  doc.end();
  return fim;
}
