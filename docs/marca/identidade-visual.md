# Identidade visual no sistema

Fonte: `brandbook-luz-da-esperanca.pptx` (nesta pasta). Implementação: `apps/web/src/styles/tokens.css`.
Toda cor das telas sai de um token — não use hexadecimal direto em componentes.

## Cores

### Paleta estratégica (slide 08)

| Token | Cor | Nome | Uso no sistema |
|---|---|---|---|
| `--marca-verde-esperanca` | `#5B8C3E` | Verde Esperança | destaques grandes: bordas de cartão, carrinho, modal, foco |
| `--marca-dourado-terra` | `#8C6D46` | Dourado Terra | apoio: quantidades no carrinho, subtítulos |
| `--marca-branco-osso` | `#FAF7F2` | Branco-osso | fundo de todas as telas |
| `--marca-cinza-texto` | `#4A4A4A` | Cinza-texto | texto do corpo (8,3:1 sobre o fundo) |

Tons de apoio das capas: verde-floresta `#2D461F` (menu lateral, cabeçalho do PDV, login), verde-musgo `#3E5A2E`
(títulos, hover), sálvia `#BFCDB3`, areia `#D8B989` (títulos de grupo no menu), linho `#E7E2D8` (bordas).

### Ajustes de acessibilidade (RNF-16, WCAG AA)

Algumas cores da marca não chegam a 4,5:1 em texto pequeno. Nesses casos o sistema usa o **mesmo matiz, mais escuro**:

| Token semântico | Valor | Derivado de | Contraste |
|---|---|---|---|
| `--primary` (botões, links) | `#4E7A34` | Verde Esperança (3,99:1) | 5,1:1 com texto branco |
| `--secondary` | `#7A5E3B` | Dourado Terra | 5,6:1 |
| `--muted` | `#6B6B63` | Cinza suave `#7A7A72` | 5,0:1 |
| `--danger` | `#B83A2B` | Vermelho-coral | 5,7:1 |
| `--info` | `#1F6F9F` | Azul-céu | 5,5:1 |
| `--warn` | `#7F5F12` | Amarelo-sol | ≥ 4,6:1 no fundo de alerta |

### Acentos — uma cor por área (slide 09)

As pétalas marcam as frentes de atuação; no sistema, cada grupo do menu e cada atalho da tela inicial usa uma.
Regra do brandbook: no máximo 1–2 acentos por peça.

| Acento | Cor | Área no sistema |
|---|---|---|
| Vermelho-coral | `#E85D4C` | Operação (PDV, vendas) |
| Laranja | `#F2994A` | Entradas e estoque |
| Amarelo-sol | `#F2C94C` | Financeiro |
| Azul-céu | `#3D9BD1` | Gestão (relatórios, cadastros, administração) |
| Roxo-suave | `#9B6FC4` | reservado |

Os cinco aparecem juntos só na marca (flor e pontos), como na capa do brandbook.

## Tipografia (slide 10)

| Papel | Fonte | Onde |
|---|---|---|
| Títulos e display | **Lora** (serifada) | `h1–h3`, nome da marca, totais do carrinho, títulos de cartão |
| Corpo | **Nunito** (sans humanista) | todo o resto, inclusive números (`tabular-nums`) |
| Comprovante | monoespaçada do sistema | impressão 80 mm |

As fontes são servidas pelo próprio app (`@fontsource-variable/lora` e `/nunito`): funcionam offline no PDV e
respeitam a CSP `default-src 'self'` — não usar Google Fonts por CDN.
Fonte manuscrita (Patrick Hand/Caveat) **não** se aplica: o sistema é peça institucional.

## Direção de arte (slide 11)

- "Casa acolhedora, não instituição fria": fundo branco-osso, cantos arredondados (8/12/16 px), sombras suaves em verde.
- Espaço em branco generoso e hierarquia clara: título em Lora verde, texto em Nunito cinza.
- Ícones de forma simples inspirados nas pétalas: `shared/components/BrandMark.tsx` (flor de cinco pétalas).
  Ela **não substitui o logotipo oficial** — se a instituição fornecer o arquivo do logo, troque `FlorMarca` e `public/icon.svg`.

## Tom de voz (slide 06) nas mensagens da interface

Acolhedor, simples e encorajador: "Boas-vindas!", "Que bom ter você aqui." Mensagens de erro dizem o que fazer, sem jargão.

## Tema escuro

Derivado do verde-floresta das capas (`prefers-color-scheme: dark`). Etiquetas e comprovante são sempre preto no branco.
