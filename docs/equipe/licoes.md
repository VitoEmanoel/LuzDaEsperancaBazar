# Lições (erros que não podem se repetir)

Cada entrada: o que aconteceu e como evitar. Escreva de forma geral; acrescente as novas no fim.

## Teste verde não prova que o sistema funciona
**Aconteceu:** dezenas de testes passavam e o programa quebrava com qualquer entrada inválida, porque ninguém o executou com entrada errada.
**Evitar:** antes de dizer que funciona, execute o sistema: caminho feliz, entrada inválida de cada campo e cada perfil afetado, mostrando a saída.

## Rodar só os testes afetados durante a tarefa
**Aconteceu:** tarefas simples demoraram porque a bateria completa (minutos, com esperas pelo limite de login) rodou várias vezes no meio do trabalho.
**Evitar:** durante a tarefa, só os testes da parte mexida; a bateria completa uma vez, no fim. Rode em segundo plano e faça outra coisa enquanto isso.

## Conferir no código antes de afirmar
**Aconteceu:** foi dito que uma função "já existia, bastava um atalho", olhando só a tela. A rota não aceitava aquele perfil, e a decisão do humano foi tomada em cima de uma afirmação errada.
**Evitar:** antes de dizer "já existe", confira o caminho inteiro para o perfil: regra de acesso da rota e checagens internas, rota do front, menu e dados. Diga como conferiu.

## Zod 4: o `refine` roda depois de um `regex` reprovado
**Aconteceu:** valor em dinheiro ou data fora do formato dava 500 em vez de 400: o `refine` convertia o valor já reprovado e lançava exceção. O `refine` do objeto inteiro também roda.
**Evitar:** `regex(re, { message, abort: true })`; `refine` que converte nunca lança; data: conferir que existe (`2026-02-31` vira 3 de março sem aviso). Teste com valor fora do formato e inexistente.

## Editar código por script: delimitar o bloco certo
**Aconteceu:** um bloco foi trocado por script procurando o fim pelo primeiro `});`; havia outro dentro dele, o corte parou no lugar errado e o build quebrou.
**Evitar:** prefira a ferramenta de edição com o trecho exato; num script, delimite pelo começo do bloco seguinte. Rode o verificador de tipos logo depois.

## Correção do QA pede nova autorização
**Aconteceu:** com a tarefa já entregue, os achados do revisor foram corrigidos sem perguntar; a correção parou no meio e o código ficou sem compilar.
**Evitar:** o relatório do QA é informação, não ordem: mostre o que aceita e recusa e **pergunte antes** de corrigir. Ao corrigir, crie primeiro (função, tipo, import) e só depois use, rodando o verificador de tipos a cada passo.

## Responder no idioma do humano
**Aconteceu:** mensagens curtas de andamento saíram em inglês, e o humano não entendeu.
**Evitar:** tudo em português, inclusive as mensagens curtas entre um passo e outro.

## Revisor travado: trocar cedo
**Aconteceu:** um agente revisor estourou o tempo várias vezes, até em pedidos pequenos, e travou o trabalho.
**Evitar:** pedido pequeno, com limite de tempo; com duas falhas seguidas, troque de agente e avise o humano.
