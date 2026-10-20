/** PDF do resumo financeiro do período (S5-10): o mesmo da tela, pelo regime de caixa. Documento não fiscal. */
import PDFDocument from 'pdfkit';
import { brl, FORMAS, latin } from '../caixa/fechamento.pdf.js';

export interface DadosResumoPdf {
  instituicao: { nome: string; cnpj?: string | null };
  de: string; ate: string;
  entradasPorForma: Record<string, string>;
  recebimentosFiado: string; saidas: string; reembolsos: string; resultado: string;
}

const data = (d: string) => d.split('-').reverse().join('/');
const agora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });

export function gerarPdfResumo(d: DadosResumoPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Resumo financeiro', Author: d.instituicao.nome } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(partes))));
  const L = 36, W = doc.page.width - 72;

  doc.font('Helvetica-Bold').fontSize(14).text(latin(d.instituicao.nome), L, 36);
  if (d.instituicao.cnpj) doc.font('Helvetica').fontSize(9).fillColor('#444').text(`CNPJ ${d.instituicao.cnpj}`).fillColor('#000');
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).text('Resumo financeiro');
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(latin(d.de === d.ate ? `Dia ${data(d.de)}` : `Período de ${data(d.de)} a ${data(d.ate)}`))
    .text(latin(`Gerado em ${agora.format(new Date())}`))
    .fillColor('#000');

  const par = (rot: string, val: string, negrito = false) => {
    const y = doc.y;
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(latin(rot), L, y, { width: W * 0.6 });
    doc.text(val, L + W * 0.6, y, { width: W * 0.4, align: 'right' });
    // o rótulo longo quebra em duas linhas: avança pela altura dele
    doc.y = y + Math.max(15, doc.heightOfString(latin(rot), { width: W * 0.6 }) + 3);
  };
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('Entradas', L); doc.moveDown(0.3);
  for (const [k, rot] of FORMAS) par(`Vendas em ${rot.toLowerCase()}${k === 'FIADO' ? ' (a receber, não entra no resultado)' : ''}`, brl(d.entradasPorForma[k] ?? 0));
  par('Recebimentos de fiado', brl(d.recebimentosFiado));
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).text('Saídas', L); doc.moveDown(0.3);
  par('Contas pagas', `- ${brl(d.saidas)}`);
  par('Reembolsos de venda (já fora das vendas, não descontam de novo)', brl(d.reembolsos));
  doc.moveDown(0.5);
  par('Resultado do período (caixa)', brl(d.resultado), true);

  doc.moveDown(2).fontSize(8).fillColor('#666').text('Documento não fiscal. Gerado pelo Sistema de Bazar - Luz da Esperança.', L);
  doc.end();
  return fim;
}
