import { randomUUID as uuid } from 'node:crypto';
// Rodar DEPOIS do smoke (usa os dados criados por ele). Dois caixas disputando o mesmo estoque.
const B = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
async function login(l: string, s: string) { const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, senha: s }) }); return (await r.json()).accessToken as string; }
let falhas = 0;
const confere = (ok: boolean, msg: string, extra?: unknown) => { console.log(`  ${ok ? '✔' : '✘'} ${msg}`, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); if (!ok) falhas++; };
const j = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const adm = await login('admin', 'Nova-Senha-Forte-1');
const cx = await login('caixa1', 'Caixa-Senha-2026');
// segundo operador e terminal
const perfis = await (await fetch(B + '/perfis', { headers: j(adm) })).json();
const pc = perfis.find((p: any) => p.nome === 'Vendedor');
const u2 = await (await fetch(B + '/usuarios', { method: 'POST', headers: j(adm), body: JSON.stringify({ id: uuid(), nome: 'Op2', login: 'caixa2', perfilId: pc.id }) })).json();
let t2 = await login('caixa2', u2.senhaProvisoria);
await fetch(B + '/auth/senha', { method: 'PUT', headers: j(t2), body: JSON.stringify({ senhaAtual: u2.senhaProvisoria, novaSenha: 'Outra-Senha-Forte-77' }) });
t2 = await login('caixa2', 'Outra-Senha-Forte-77');
const term3 = await (await fetch(B + '/terminais', { method: 'POST', headers: j(adm), body: JSON.stringify({ id: uuid(), nome: 'Caixa 3' }) })).json();
const cx2id = uuid();
await fetch(B + '/caixas', { method: 'POST', headers: j(t2), body: JSON.stringify({ id: cx2id, terminalId: term3.id, fundoTroco: '0.00' }) });
const atual1 = await (await fetch(B + '/caixas/atual', { headers: j(cx) })).json();
const cats = await (await fetch(B + '/categorias', { headers: j(adm) })).json();
const roupa = cats.find((c: any) => c.nome === 'Roupa adulto');
const est = await (await fetch(B + `/estoque?categoriaId=${roupa.id}&local=BAZAR`, { headers: j(adm) })).json();
const saldo = est.items.reduce((s: number, i: any) => s + i.saldoBazar, 0);
const cat = await (await fetch(B + '/pdv/catalogo', { headers: j(cx) })).json();
const peca = cat.itensEtiquetados[0];
console.log('saldo roupa bazar', saldo, 'peça', peca.codigo);
const venda = (t: string, caixaId: string, terminalId: string, itens: any[], valor: string) => fetch(B + `/vendas/${uuid()}`, { method: 'PUT', headers: j(t), body: JSON.stringify({ terminalId, caixaId, itens, /* sem ocorridaEm/origem: o servidor nunca usou, e o corpo é estrito (S6-14) */ pagamentos: [{ forma: 'PIX', valor, valorRecebido: valor }] }) }).then(async (r) => ({ s: r.status, b: await r.json() }));
// 1) mesma peça em 2 caixas simultâneos
const r = await Promise.all([venda(cx, atual1.id, atual1.terminalId, [{ codigo: peca.codigo, quantidade: 1 }], peca.preco), venda(t2, cx2id, term3.id, [{ codigo: peca.codigo, quantidade: 1 }], peca.preco)]);
console.log('peça concorrente:', r.map((x) => x.s + ':' + (x.b.code ?? 'ok')).join(' '));
confere(r.filter((x) => x.s === 201).length === 1 && r.some((x) => x.b.code === 'ITEM_INDISPONIVEL'), 'peça única: só um dos dois caixas consegue vender', r.map((x) => [x.s, x.b.code]));
// 2) categoria: cada caixa tenta levar mais da metade+1 do saldo
const q = Math.floor(saldo / 2) + 1;
const valor = (q * Number(roupa.precoPadrao)).toFixed(2);
const r2 = await Promise.all([venda(cx, atual1.id, atual1.terminalId, [{ categoriaId: roupa.id, quantidade: q }], valor), venda(t2, cx2id, term3.id, [{ categoriaId: roupa.id, quantidade: q }], valor)]);
console.log('categoria concorrente:', r2.map((x) => x.s + ':' + (x.b.code ?? 'ok')).join(' '));
confere(r2.filter((x) => x.s === 201).length === 1 && r2.some((x) => x.b.code === 'SALDO_INSUFICIENTE'), 'categoria: os dois caixas juntos não levam mais do que o saldo', r2.map((x) => [x.s, x.b.code]));
const est2 = await (await fetch(B + `/estoque?categoriaId=${roupa.id}&local=BAZAR`, { headers: j(adm) })).json();
console.log('saldo final >= 0:', est2.items.every((i: any) => i.saldoBazar >= 0), est2.items.reduce((s: number, i: any) => s + i.saldoBazar, 0));
confere(est2.items.every((i: any) => i.saldoBazar >= 0), 'saldo final nunca fica negativo');
// 3) operador 2 usando o caixa do operador 1 (IDOR)
const r3 = await venda(t2, atual1.id, atual1.terminalId, [{ categoriaId: roupa.id, quantidade: 1 }], roupa.precoPadrao);
console.log('IDOR caixa alheio:', r3.s, r3.b.code);
confere(r3.s === 403 && r3.b.code === 'CAIXA_DE_OUTRO_OPERADOR', 'operador não vende no caixa de outro (IDOR)', [r3.s, r3.b.code]);
// 4) duas sangrias simultâneas que juntas passam do dinheiro da gaveta: só uma pode passar
await fetch(B + `/caixas/${cx2id}/lancamentos`, { method: 'POST', headers: j(t2), body: JSON.stringify({ id: uuid(), tipo: 'SUPRIMENTO', valor: '100.00', motivo: 'Reforço (teste de concorrência)' }) });
const sangria = () => fetch(B + `/caixas/${cx2id}/lancamentos`, { method: 'POST', headers: j(t2), body: JSON.stringify({ id: uuid(), tipo: 'SANGRIA', valor: '80.00', motivo: 'Sangria concorrente' }) })
  .then(async (r) => ({ s: r.status, b: r.status === 204 ? {} : await r.json() }));
const r4 = await Promise.all([sangria(), sangria()]);
console.log('sangrias concorrentes:', r4.map((x) => x.s + ':' + ((x.b as any).code ?? 'ok')).join(' '));
confere(r4.filter((x) => x.s === 204).length === 1 && r4.some((x) => (x.b as any).code === 'SANGRIA_ACIMA_SALDO'), 'duas sangrias simultâneas que passam do saldo: só uma é aceita', r4.map((x) => [x.s, (x.b as any).code]));
console.log(falhas ? `\n${falhas} falha(s)` : '\nconcorrência: tudo certo');
if (falhas) process.exitCode = 1;
