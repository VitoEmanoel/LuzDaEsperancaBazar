# Testar e corrigir

## Testes
- **Teste o comportamento observável** (o que a API devolve, o que a tela mostra), nunca detalhes internos.
- **Um cenário por teste**, com nome que diz o cenário e o resultado. O valor esperado vem da regra ou de um exemplo conhecido, nunca recalculado como o código faz.
- **Dados fictícios** e criados pelo próprio teste. Nunca dado real, nunca o banco de produção.
- Para cada campo de dinheiro e de data: um teste com valor fora do formato e um com valor inexistente (ex.: `2026-02-31`), esperando 400.
- Para cada rota nova: o 403 de cada perfil que não deve acessar.
- **Durante a tarefa, rode só os testes afetados**; a bateria completa uma vez, no fim. A API limita logins por minuto: espere entre as baterias.
- **Teste instável** (passa e falha sem mudança): conserte a causa (espera por condição, não pausa fixa; dado compartilhado; relógio) ou remova. Nunca "rodar de novo até passar".
- Nunca apague, pule ou enfraqueça um teste para ficar verde.

## Testes de tela (Playwright)
- Rótulos e nomes com `{ exact: true }`: o Playwright busca **por trecho** (`'De'` também acha "Detalhe").
- O que se repete (botão "Fechar"), dentro do container certo (`.modal`, `section`) ou com `.last()`.
- Campo dentro do próprio `<label>` (select, checkbox): o nome acessível inclui as opções; ache pelo container.
- Depois de trocar de aba ou de tela, espere um texto que só existe no conteúdo novo antes de agir.
- Preencha os campos **antes** de emular a impressão (`.no-print` esconde campos).
- Confira o perfil real de cada usuário de teste e os nomes que existem nos dados antes de usá-los.
- Ao mudar o texto de um aviso no código, procure o texto antigo nos roteiros.
- Rode o roteiro numa tela só antes de rodar todos.

## Corrigir um bug
1. **Reproduza primeiro**, com um comando que falha por causa do bug (teste, `curl`, roteiro). Sem reprodução não há correção, só palpite.
2. Confirme que é **o erro descrito**, e não um parecido. Reduza o caso ao mínimo.
3. Leia o erro inteiro: a primeira linha diz o quê; a pilha diz onde (primeira linha de código nosso).
4. Escreva 3 a 5 hipóteses com previsão ("se for X, mudar Y faz sumir") e teste uma variável por vez.
5. Escreva o **teste de regressão** e veja-o falhar antes de corrigir.
6. Faça a **menor mudança na causa raiz**. Rode o teste novo, o cenário original e os testes afetados.
7. Remova a depuração. Explique ao humano a causa, o que mudou e o teste que protege.
8. Depois de 3 tentativas sem resolver, pare e pergunte.
