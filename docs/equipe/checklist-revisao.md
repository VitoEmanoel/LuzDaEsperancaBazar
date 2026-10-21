# Checklist de revisão (QA)

Use ao revisar uma tarefa ou antes de dizer que ela está pronta. O revisor **só lê** (não edita nem roda servidores); quem implementou confere cada achado no código antes de aceitar e responde ao humano o que aceitou e o que recusou, com o motivo.

## Como pedir a revisão a um agente
- Diga que ele só lê, liste os arquivos da tarefa, as regras que valem e os testes que já rodaram (com o resultado).
- Peça poucos problemas **reais** (bug, permissão, dado pessoal, erro 500), cada um com `arquivo:linha` e o cenário concreto que falha. Nada de estilo ou sugestão genérica.
- Pedido grande vai em fatias pequenas. Se o agente travar duas vezes seguidas, troque de agente e avise o humano.

## Funcionamento
- [ ] Atende a cada critério da tarefa no `docs/PLANO-DE-SPRINTS.md` e às regras do `docs/README_MVP.md`?
- [ ] O sistema foi **executado de verdade** (caminho feliz, entrada inválida, cada perfil afetado) e a saída foi mostrada? Teste verde sozinho não prova.
- [ ] Há teste para o comportamento novo, e os testes afetados passam?
- [ ] Casos de borda: entrada vazia, formato errado, data inexistente, valor zero ou negativo, arquivo grande, repetição do mesmo pedido.
- [ ] Nada fora do escopo, código morto ou refatoração não pedida?
- [ ] O mock do front (`apps/web/src/mocks/`) devolve o mesmo formato que a API real?
- [ ] Documentação atualizada quando o comportamento mudou?
- [ ] Alguma afirmação sem conferir no código (rota, permissão do perfil, tela e menu)?

## Segurança e LGPD
- [ ] Cada rota declara `config.acesso` e confere as permissões de dentro; o 403 dos perfis que não devem acessar foi testado.
- [ ] Anti-IDOR: trocar o `id` não mostra nem altera dado de outro usuário.
- [ ] Entrada validada com Zod (lista branca), SQL parametrizado, erro no padrão RFC 9457 e **nunca 500** para entrada inválida.
- [ ] O servidor recalcula preço, total e troco; o front não manda valor como verdade.
- [ ] Nenhum dado pessoal (nome, CPF, telefone) em log, URL ou auditoria. Cuidado com `log.error({ err })`: a mensagem do erro do banco pode repetir os valores.
- [ ] Nenhum segredo no código, em notas, logs ou commits; `.env` fora do git.
- [ ] Upload: tipo pelo conteúdo (não pelo nome), tamanho limitado, nada de executar o que veio no arquivo (planilha: injeção de fórmula; XML: DTD e entidades).
- [ ] Estoque só muda por `movimentacao`; nada se apaga, só se desativa.
- [ ] Dependência nova: origem conhecida, mantida, sem vulnerabilidade (`npm audit`), e instalada com autorização do humano.
