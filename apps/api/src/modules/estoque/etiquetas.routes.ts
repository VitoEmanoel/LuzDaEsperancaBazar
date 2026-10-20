/**
 * Etiquetas (S4-01 a S4-05): a etiqueta é do produto (título, preço normal e código BZ em Code 128), no tamanho do rolo.
 * Imprime só o preço normal (P-18): o desconto aparece no caixa e não obriga reetiquetar.
 * O histórico (quem, quando, quantas) fica na auditoria do produto (P-18), sem tabela nova.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parse, zUuid } from '../../shared/http.js';
import { auditar } from '../../shared/audit.js';
import { money } from '../../shared/money.js';
import { paramNum } from '../../shared/parametros.js';
import { exigirUsuario } from '../../plugins/auth.js';

/** Teto por impressão: um rolo grande, sem travar o navegador montando milhares de páginas. */
const MAX_ETIQUETAS = 500;

const zPedido = z.object({
  produtos: z.array(z.object({ produtoId: zUuid, quantidade: z.number().int().min(1).max(MAX_ETIQUETAS) })).min(1).max(200),
}).strict();

/** Mantém o rolo nos limites do Admin (30 a 120 x 20 a 100 mm) mesmo se o parâmetro for mudado direto no banco. */
const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
async function tamanhoRolo() {
  return {
    larguraMm: entre(await paramNum(prisma, 'etiqueta.largura_mm', 50), 30, 120),
    alturaMm: entre(await paramNum(prisma, 'etiqueta.altura_mm', 30), 20, 100),
  };
}

/** Confere o pedido e devolve os dados atuais de cada produto, na ordem pedida. */
async function montar(b: z.infer<typeof zPedido>) {
  const total = b.produtos.reduce((s, p) => s + p.quantidade, 0);
  if (total > MAX_ETIQUETAS) throw new AppError(400, `No máximo ${MAX_ETIQUETAS} etiquetas por impressão`, 'ETIQUETAS_DEMAIS');
  const ids = [...new Set(b.produtos.map((p) => p.produtoId))];
  if (ids.length !== b.produtos.length) throw new AppError(400, 'Produto repetido no pedido: some as quantidades', 'VALIDACAO');
  const rows = await prisma.produto.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true, codigo: true, tituloEtiqueta: true, nome: true, precoVenda: true } });
  const porId = new Map(rows.map((r) => [r.id, r]));
  const faltam = ids.filter((id) => !porId.has(id));
  if (faltam.length) throw new AppError(400, 'Produto inexistente ou inativo', 'VALIDACAO');
  return b.produtos.map((p) => {
    const r = porId.get(p.produtoId)!;
    return { produtoId: r.id, codigo: r.codigo, titulo: r.tituloEtiqueta, nome: r.nome, preco: money(r.precoVenda), quantidade: p.quantidade };
  });
}

export async function rotasEtiquetas(app: FastifyInstance) {
  // tamanho do rolo para a pré-visualização (quem imprime não tem acesso aos parâmetros do Admin)
  app.get('/etiquetas/config', { config: { acesso: ['etiquetas.imprimir'] } }, async () => tamanhoRolo());

  // pré-visualização: dados atuais, sem registrar nada
  app.post('/etiquetas/preparar', { config: { acesso: ['etiquetas.imprimir'] } }, async (req) => {
    const b = parse(zPedido, req.body);
    return { ...(await tamanhoRolo()), itens: await montar(b) };
  });

  // impressão: os mesmos dados, e o histórico de cada produto na auditoria (S4-05)
  app.post('/etiquetas/impressoes', { config: { acesso: ['etiquetas.imprimir'] } }, async (req) => {
    const u = exigirUsuario(req);
    const b = parse(zPedido, req.body);
    const itens = await montar(b);
    const rolo = await tamanhoRolo();
    await prisma.$transaction(async (tx) => {
      for (const i of itens) {
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'ETIQUETAS_IMPRESSAS', 'produto', i.produtoId, undefined,
          { quantidade: i.quantidade, preco: i.preco, rolo: `${rolo.larguraMm}x${rolo.alturaMm}` });
      }
    });
    return { ...rolo, itens };
  });
}
