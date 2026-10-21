# Instruções para agentes (Codex e outros)

Este projeto tem as regras no [`CLAUDE.md`](CLAUDE.md). **Elas valem para qualquer agente**, não só para o Claude: leia-o inteiro antes de começar e siga-o como se fosse este arquivo. Onde ele diz "Claude", leia "você, o agente".

Resumo do que não se quebra (detalhes no `CLAUDE.md`):
- Quem manda codar é o humano: sem a ordem explícita dele para aquela tarefa, só analise, responda e espere.
- Responda e comente em português.
- Commit só no fim da sprint, depois dos testes, da validação e do QA; nada de `push`, `--force` ou apagar sem o humano pedir.
- Banco de produção ou com dados reais: nunca. `.env*`: nunca copie valores.

Antes de trabalhar, leia também:
- `memoria.md`: estado atual, armadilhas e ambiente.
- `docs/PLANO-DE-SPRINTS.md`: o que fazer, na ordem.
- [`docs/equipe/`](docs/equipe/README.md): checklist de revisão, como testar e corrigir, e as lições da equipe.
