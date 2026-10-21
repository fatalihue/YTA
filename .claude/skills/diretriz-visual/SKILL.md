---
name: diretriz-visual
description: Diretriz visual do YTA (app desktop, frontend React + Tailwind 4). Usar ANTES de qualquer trabalho de interface — tipografia, espaçamento, cor, componentes, movimento, estados, copy, acessibilidade — e para decidir qual skill de design chamar em cada passo. Sintetiza impeccable, ui-craft(-dense-dashboard), web-design-guidelines, emil-design-eng/review-animations, design-taste-frontend e shadcn/sleek, mais as lições do rework visual do TrueReplayer (out/2026). Em conflito, ESTA diretriz vence as skills genéricas; decisão registrada do dono vence esta diretriz.
---

# YTA — diretriz visual

Nasceu do rework visual do TrueReplayer (13–16-10-2026), generalizada para um projeto novo.
Regra de ouro: **as skills dão estrutura (papéis, razões, escalas); os valores moram nos tokens**
(`tokens.css`, ao lado deste arquivo — ponto de partida das fundações).

Armadilhas técnicas já pagas (Tailwind 4, foco, zoom, codemods): [licoes-tecnicas.md](licoes-tecnicas.md).

## 0. Postura

- **Modo Operate** (impeccable): é uma ferramenta — o usuário quer completar uma tarefa (colar,
  escolher, converter, salvar) e voltar ao que fazia. Leitura rápida, consistência e expectativa
  nativa do desktop vêm antes de expressão. A marca vive em detalhes precisos, nunca em ornamento.
  Se um dia houver página de divulgação, ela é modo Persuade e segue outra régua.
- **Sistema antes de tela.** Tokens e primitivos primeiro; telas consomem os primitivos. Uma tela
  que precisa de um valor novo revela um token faltando, não uma exceção.
- **Teste do produto:** quem conhece esse tipo de app confia nele de cara. Estranheza sem
  propósito é falha; familiaridade conquistada é o alvo.
- **Ruído:** por tela, 1 elemento primário, 2–3 secundários, o resto calado. Ponto de decisão com
  ≤4 opções; fileira de ações = 1 primária, 1–2 secundárias, o resto num menu.
- **Ordem das alavancas:** tipografia → espaçamento/ritmo → cor → movimento → recomposição.
- **Decisão registrada.** Toda escolha que um cético tentaria desfazer vai para a seção 9
  ("Decisões do projeto") com data e motivo. Não re-sugerir o que está lá.

## 1. Fundações (tokens) — leis

### Tipografia
- Famílias: Segoe UI Variable (Text/Display/Small) com fallback de sistema + uma mono (Cascadia
  Mono → Consolas). Nenhuma fonte web sem decisão registrada.
- **Rampa única de 5 tamanhos:** `caption 11/16` · `minor 12/16` · `body 13/18` · `subtitle 15/20`
  · `title 20/28` (`text-caption/-minor/-body/-subtitle/-title`). **11px é o piso.** Proibido
  `text-[Npx]` e proibido misturar `text-xs` com a rampa para o mesmo papel.
- A rampa define tamanho **e** altura de linha. Controle cuja altura vem de padding + linha (sem
  `h-*`) e precisa herdar a linha do contexto leva `leading-[inherit]`, não um `leading-*` fixo.
- Duas classes de tamanho no mesmo elemento: quem vence é a ORDEM no CSS gerado, não a ordem na
  className. Não empilhar.
- `font-display` em títulos (diálogo, painel, estado vazio, ≥15px); `font-small` em 11px.
- Pesos **400/500/600** só; `font-bold`, `<strong>` e `<b>` sem classe são violação (o preflight dá
  `bolder` = 700). ≤3 pesos por tela. Não engordar texto grande.
- Hierarquia por espaço → tamanho → peso → cor. Níveis vizinhos diferem ≥1,5× em ao menos um sinal;
  no máximo 4 níveis por tela.
- **Números:** `tabular-nums` em todo valor que muda ou se compara (progresso, durações, tamanhos,
  contadores, porcentagens). **Mono só para dado** (URL, caminho, nome de arquivo, ID, código,
  valor digitado). Chrome (rótulos, botões, títulos, frases de status) nunca em mono — mono não é
  fantasia de "técnico". Campos são sans por padrão; o campo de DADO pede `font-mono`.
- Line-height 1.3–1.4 em UI; 1.5+ só em prosa. Nunca mudar peso/tamanho/padding no hover.
- `label-micro` (11px/600/caixa alta) é a ÚNICA caixa-alta, como legenda de seção — nunca como
  "eyebrow" em cima de outro título.

### Espaçamento e dimensões
- Escala: **2 · 4 · 6 · 8 · 12 · 16 · 24 · 32** px (Tailwind `0.5 · 1 · 1.5 · 2 · 3 · 4 · 6 · 8`).
  Proibido valor arbitrário (`[13px]`, `[3px]`…) fora de hairline de 1px e de alinhamento medido
  e comentado.
- Invariante: dentro do grupo < entre grupos < entre seções (quebra de seção ≥2× o gap entre
  blocos). Agrupar por proximidade antes de borda, fundo ou card. **Nunca card dentro de card.**
- **Alturas de controle: 3.** `h-8` (32, padrão), `h-7` (28, compacto/inline), `h-6` (24, ícone
  pequeno). Alvo mínimo de clique 24px.
- Faixas fixas (barra de título, toolbar, status bar, cabeçalho de painel) viram token por papel
  (`--spacing-*` → `h-titlebar`, `h-band`…), nunca número mágico repetido.

### Raio, profundidade, camadas
- Raio por papel: `control 4` · `overlay 8` (menu, tooltip, toast) · `dialog 12`. `rounded-full`
  só para pílula/ponto/avatar. Raio aninhado: externo = interno + gap.
- **Borda de 1px antes de sombra.** Sombra só `shadow-overlay` e `shadow-dialog`, e elas TÊM de ler
  a variável de runtime (ver lições: no Tailwind 4 a utility gerada pelo `@theme` copia o valor).
- **Uma receita de véu:** `bg-scrim` / `bg-scrim-strong`. Nunca `bg-black/N`. Blur decorativo é
  proibido.
- z-index semântico em token (dropdown · sticky · backdrop · modal · toast · tooltip); nada de
  `z-[999]`.

### Cor (estrutura; valores nos temas)
- **Nunca hex/rgba literal** em componente. Tudo por `var(--color-*)` / `color-mix`. Literal só no
  arquivo de tokens/temas e em dado do usuário (cor escolhida por ele). Vale montar um gate de lint
  para isso cedo — é a regra que mais regride.
- 90%+ neutro. **Um** accent: ação primária, seleção atual, indicador de estado — 3–5 aparições por
  tela. Nunca decoração; nunca saturado em estado inativo.
- **Matiz semântico cru nunca vira texto:** o tom puro (erro, sucesso, aviso) é para preenchimento
  e tinta; texto e ícone usam o `-fg` resolvido por contraste; texto sobre preenchimento sólido usa
  `-ink`.
- Cor nunca é o único sinal: junto vai texto, ícone, forma ou posição. Ligado/desligado = dois
  canais (preenchimento ~12 % + borda ~40 % do accent, mais forma/posição).
- Contraste: texto 4,5:1; controles, ícones, foco e não-texto 3:1. Hover/active/focus sempre com
  MAIS contraste que o repouso. Conferir em um tema escuro e um claro, em todo estado.
- Hover e press = tokens de sobreposição reutilizáveis (`bg-wash-hover`), não cor por componente.
- Temas escuros: borda/realce em vez de sombra pesada. `color-scheme` por tema e `<select>` nativo
  com `background-color` e `color` explícitos (dark mode do Windows).
- Superfícies da plataforma também são do tema: seleção de texto, caret, scrollbar (cor, não
  comportamento), anel de foco.

## 2. Primitivos — um jeito de fazer cada coisa

Antes de estilizar uma tela, a tela usa o primitivo. Extrair token/componente quando houver 3+ usos
com a mesma intenção — e então todos os usos migram, não só o novo.

| Coisa | Primitivo | Regra |
|---|---|---|
| Botão com texto | `Button` (primary · secondary · ghost · destructive · destructiveText; xs/sm/md) | 1 primária por contexto; repouso/hover/active/foco/desabilitado/carregando distintos; hover de primária por token que se afasta da tinta, nunca `/80` |
| Botão de ícone | `IconButton` / `iconButtonClass()` | `aria-label` SEMPRE + tooltip |
| Campo | `input-field` (32) / `input-inline` (28) | Sans por padrão, `font-mono` no campo de dado; nada de casca feita à mão |
| Número | `NumberInput` | Unidade dentro do campo ("80 ms"); `tabular-nums` |
| Rótulo de campo | `Field` | O rótulo NOMEIA o controle (`aria-labelledby` / `htmlFor`) — `<label>` solto não nomeia nada |
| Chip | `chipStyles` / um `tokenChipClass` | Contorno + `×`; borda `border-default` (a `subtle` some no tema claro) |
| Menu / popover | `menu-surface` + `menu-item` (32px/12px) | Nasce do gatilho, sai do container por portal, abre por clique E teclado |
| Diálogo | `DialogShell` + `DialogFooter` | Altura nunca muda com o estado; fechar sujo pergunta (`canClose`); Esc fecha; foco preso e devolvido |
| Validação | `FieldError` | Sempre montado, uma linha, `role="alert"` ao recusar |
| Tooltip | um `Tooltip`/portal próprio | Nunca `title=`; só quando acrescenta informação |
| Aviso | `Callout` | Hairline de 1px no tom + lavagem leve; nunca faixa lateral grossa |
| Escolha 2–5 opções | `SegmentedControl` (`grow`) | ≤5 = segmentado; >10 = type-ahead; ~20+ = busca |
| Toolbar | `role="toolbar"` com roving tabindex | UMA parada de Tab, ←/→ dentro, Home/End nas pontas |

**Estados obrigatórios** em todo interativo: default, hover, focus-visible, active, disabled,
loading, error (o que se aplicar). Mesma ação = mesma UI: dois "Save" diferentes = um está errado.

## 3. Superfícies e padrões

- **Lista / tabela:** texto à esquerda, números à direita com `tabular-nums`, status ao centro.
  Cabeçalho em sentence case (ou `label-micro`), peso 500, cor secundária. Hover de linha = troca de
  fundo, sem movimento. Seleção = tinta do accent mantida no hover. Ações de linha no hover também
  alcançáveis pelo teclado.
- **Fila de trabalho** (downloads/conversões): cada item mostra estado em dois canais (ícone +
  texto), progresso com número tabular, tempo/tamanho em `tabular-nums`; erro do item fica no item
  e não derruba a fila.
- **Diálogos:** o modal não é a primeira ideia — esgotar inline/progressivo antes. Confirmação
  repete o verbo da ação ("Delete file"), nunca Yes/No/OK. Fricção pelo tamanho do estrago:
  reversível = agir + desfazer; médio = confirmação nomeando o objeto; irreversível = confirmação
  explícita.
- **Vazio:** uma linha que ensina + a ação (ou atalho) para começar. Sem gradiente, sem
  ilustração decorativa. O primeiro uso é o caso comum — tratar como onboarding.
- **Carregando:** esqueleto no formato final, só após ~200ms; botão mantém o rótulo com spinner
  dentro. Nunca inventar progresso; progresso indeterminado diz o que está fazendo ("Converting…").
- **Erro:** o que falhou, por quê (se souber), como sair. Nunca "Something went wrong" nem código
  interno como mensagem. Preservar o que o usuário digitou.
- **Valor ausente:** travessão `—`, nunca `null`, `N/A` ou `0` falso.
- **Overflow:** filhos flex com `min-w-0`; texto de uma linha trunca com reticências; nomes longos
  (título de vídeo, caminho) testados; prefixo longo comum = truncar no meio.
- **Arrastar:** sem seleção de texto durante o drag; tratar `pointercancel`, perda de captura e
  `blur` da janela; o próximo drag tem de funcionar.

## 4. Movimento

- **Frequência decide:** ação de teclado e o que acontece 100+/dia → **sem animação**. Dezenas/dia
  (hover, navegação em lista) → <150ms ou nada. Ocasional (diálogo, toast) → padrão. Nenhuma
  coreografia de entrada; sem stagger em listas.
- **Durações: 3 tokens** — `--motion-fast 100` (feedback, hover), `--motion-base 150` (menu,
  popover, tooltip, troca de estado), `--motion-slow 250` (diálogo, painel). Teto de 300ms para UI;
  acima disso só barra de progresso.
- **Easing:** entrada desacelera (`--ease-enter`). Nunca `ease-in` em entrada. Sem bounce/elastic.
  Saída mais curta que a entrada (a curva da saída é decisão do projeto — registrar).
- **Só `transform` e `opacity`.** Nunca `transition: all`; não animar width/height/top/left/margin.
- Popover/menu/tooltip nascem do gatilho; diálogo nasce do centro. Nunca de `scale(0)`: partir de
  0,95–0,97 + opacidade. Press: `scale(0.97–0.98)` no `:active`, sutil.
- O que dispara rápido ou é interrompido (toggle, toast, item novo) → `transition`, não
  `@keyframes`, para poder voltar do meio.
- **Um portão de movimento:** `html[data-animations="true"]` é o efeito de um ajuste
  System/On/Off (System segue `prefers-reduced-motion` ao vivo). Toda utility de movimento leva o
  prefixo `motion-ok:` (variante em `tokens.css`); animação inline em JS checa o atributo. Spinner
  de carregamento é a exceção. Movimento reduzido = menos movimento, não zero: mantém opacidade,
  cor e feedback de estado.
- Subárvore trocada sob uma transição global leva `key` (evita animação fantasma).

## 5. Copy

- **Um idioma de rótulo por app**, decidido no início e registrado (seção 9). Sentence case para
  rótulos genéricos; nome próprio (de recurso, de formato) fica como é.
- Botão = verbo + objeto. A ação mantém o nome no fluxo inteiro ("Convert" → "Converted"). Um termo
  por conceito; varrer verbos de botão em busca de deriva.
- Caractere `…` (não `...`), inclusive em "Saving…" e em ações que abrem diálogo ("Choose folder…").
  Numerais para contagens. `&nbsp;` em `Ctrl&nbsp;K`, `10&nbsp;MB`. Aspas curvas em texto visível.
- Sem possessivo em rótulo ("Folder", não "Your folder"); tooltip acrescenta, não repete o rótulo.
  Sucesso curto, sem exclamação. Dizer cada coisa uma vez.

## 6. Acessibilidade e teclado

- `focus-visible` com anel do tema em todo interativo; nunca `outline-none` sem substituto;
  `:focus-within` em controle composto; contêiner com `overflow-hidden` não pode cortar o anel
  (desenhar para dentro). Nada sticky cobre o foco.
- Ícone sozinho = `aria-label`; ícone decorativo = `aria-hidden`. `aria-live="polite"` em toast e
  status; `role="alert"` na recusa de validação; `aria-expanded` em disclosure; `aria-pressed` em
  toggle; `role="checkbox"` + `aria-checked` (inclusive `mixed`) em linha que age como checkbox;
  `aria-current` no item ativo; `aria-invalid` em campo com erro.
- `<button>` para ação (nunca `div onClick`); se um `div` precisa agir, `role="button"`,
  `tabIndex={0}` e Enter/Espaço — e a tecla só no próprio elemento (`e.target === e.currentTarget`),
  não nos botões de dentro.
- Sem `tabindex > 0`; o que só aparece no hover aparece também no foco (`focus-visible:opacity-100`).
  Todo fluxo principal feito só no teclado; menus de contexto pelo Shift+F10/tecla Menu.
- Testar com Alto Contraste do Windows e com zoom/escala alta.

## 7. Escala da janela

Se a UI usar CSS `zoom` no `<html>` para escala: medir é VISUAL (`getBoundingClientRect`,
`clientX`), escrever é LAYOUT (`left/top/width`) — converter uma vez num utilitário. Unidade de
viewport sob zoom = `calc(Nvh / var(--ui-zoom))`. Validar em 100%, num zoom alto e na janela mínima.

## 8. Proibições (resumo)

Hex/rgba literal · `bg-black/N` · `text-[Npx]` · `font-bold`/`<strong>` sem classe · espaçamento
arbitrário · card aninhado · grade de cards idênticos como estrutura · eyebrow · texto em gradiente
· glow · blur decorativo · borda lateral colorida >1px · sombra deslocada dura · emoji/Unicode no
lugar de ícone (uma família: lucide, um traço) · mono como fantasia · pílula colorida em todo delta
· ponto de status decorativo · `transition: all` · `scale(0)` · `ease-in` em entrada · animação em
ação de teclado · animação fora do portão · `title=` · placeholder como rótulo · Yes/No/OK ·
"Something went wrong" · validação vermelha ao montar · bloquear colar · `div onClick` · z-index ad
hoc · `...` em texto visível.

## 9. Decisões do projeto (registrar aqui)

Herdadas do TrueReplayer como ponto de partida — confirmar ou trocar no início do YTA:

| Decisão | Valor inicial | Status |
|---|---|---|
| Idioma dos rótulos | pt-BR (o dono escreve em português; app de uso pessoal) | decidida 17-10-2026 |
| Curva de saída | `--ease-exit` = desacelerada, mais curta que a entrada | a confirmar |
| Animações | só System (segue o Windows, sem ajuste na UI — app de uma tela, "sem firulas") | decidida 17-10-2026 |
| Tema | segue o Windows (claro/escuro), sem seletor na UI | decidida 17-10-2026 |
| Vários links | fila com até 3 itens ao mesmo tempo (substitui a fila sequencial): medido 26,8 s → 9,9 s em 3 áudios longos; mais conexões por arquivo não ganharam nada (~70 MB/s com uma só) | decidida 17-10-2026 |
| Foco dos campos de link e pasta | sem anel/borda azul ao focar; só a borda clareia (`data-focus-quiet`). Pedido do dono; os demais controles mantêm o anel | decidida 17-10-2026 |
| Vídeo | formato "Vídeo" salva MP4; melhor resolução por padrão, preferindo H.264+AAC na mesma resolução; com um link, lista as resoluções do vídeo; com vários, a escolha é teto | decidida 17-10-2026 |
| Altura da janela | mínima comporta 5 itens da fila sem corte; formulário com altura fixa (formato e qualidade na mesma linha); a janela nunca se redimensiona sozinha | decidida 17-10-2026 |
| Login do YouTube | pelo Chrome (ou Edge) real num perfil só do YTA; os cookies são lidos pelo próprio navegador invisível e renovados a cada uso. Janela embutida descartada: o Google bloqueia ("navegador pode não ser seguro"). Ler cookies do Chrome/Edge direto não funciona no Windows (app-bound). Usado só como reserva — nunca em todo download | decidida 17-10-2026 |
| Velocidade do download | arquivo em pedaços (`youtube:formats=dashy`) com 8 baixados ao mesmo tempo, como o IDM; o YouTube limita ~15 MB/s por conexão no vídeo. Medido 15 → 67 MB/s; 16 pedaços não ganha. Formatos HLS excluídos (sem tamanho) | decidida 17-10-2026 |
| Instagram | aceito junto do YouTube (posts, reels, IGTV, stories); arquivo nomeado "conta - código" (o título do IG é genérico); carrossel = um arquivo por vídeo; login no mesmo perfil do Chrome (aba do Instagram), só como reserva | decidida 17-10-2026 |
| Vídeo compatível (WhatsApp) | Instagram prefere sempre a versão progressiva H.264 (ex.: 720p) à DASH VP9 de maior resolução; caixa "Converter para H.264 se preciso" recodifica só o que não for H.264/AAC, pela placa de vídeo quando houver (NVENC → QSV → AMF → libx264) | decidida 17-10-2026 |
| Instalador e atualização | NSIS de um clique, só do usuário (sem administrador); atualização automática (electron-updater, feed genérico em releases/latest/download), baixa sozinha e avisa "Versão X pronta · Reiniciar e atualizar" no cabeçalho da fila. O assistido foi descartado: no update silencioso ele elevava para "todos os usuários" e quebrava | decidida 17-10-2026 |
| Extensão do navegador | botão dividido sobre o vídeo (corpo = última escolha, setinha = menu), andamento no próprio botão; fala com o app por 127.0.0.1 (cabeçalho X-YTA + origem da extensão) e abre o app por yta://start; modo desenvolvedor, pasta fixa em %APPDATA%\yta\extension que o app atualiza | decidida 17-10-2026 |
| Bandeja | fechar a janela esconde (app segue na bandeja); pedido da extensão não rouba o foco, só notifica | decidida 17-10-2026 |
| Outros sites | genérico, não lista: qualquer link http(s); o yt-dlp (~1.800 sites + extrator genérico) decide; plano B = arquivo .m3u8/.mpd/.mp4 que a extensão viu a página tocar, com o título da página; login de qualquer site pelo perfil do Chrome do YTA; botão da extensão em todos os sites com "Não mostrar em …" | decidida 18-10-2026 |
| Fila × Baixados | abas no cabeçalho da lista (label-micro, ativa com sublinhado de 2 px no accent); histórico de 1.000, a lista mostra 300; "Limpar histórico" pede segundo clique | decidida 18-10-2026 |
| Avisos na linha de ajuda dos links | ações em forma de link (LinkButton) na mesma linha, para o formulário não mudar de altura: "já baixado · Baixar de novo", "playlist · Só o vídeo / A playlist inteira", "Link copiado · Colar" | decidida 18-10-2026 |
| Pastas | uma para áudio e outra para vídeo (Música/Vídeos); a linha mostra a do formato | decidida 18-10-2026 |
| Acelerador de downloads | a extensão entrega ao YTA os downloads do navegador que dá para acelerar (pedaços, ≥ 1 MB); motor próprio (electron/accel.cjs, sem binário novo) com até 8 conexões em rampa e divisão dinâmica; pasta Downloads, sem campo de pasta na tela ("sem firulas"); item "Arquivo" na mesma fila com 3 vagas próprias e "N conexões" na linha; chave no popup da extensão, ligada por padrão. Pedido do dono (assinatura do IDM acabando) | decidida 19-10-2026 |
| Janelas do acelerador | "Baixar arquivo" (nome, pasta, Lembrar esta pasta, Não perguntar de novo, Cancelar/Baixar) e "Download concluído" (Abrir, Abrir pasta, Fechar, Não mostrar ao concluir), como as do IDM: janelas próprias de 480 px, por cima das outras, altura pelo conteúdo, uma por download; pasta mostrada pelo fim do caminho; liga/desliga na bandeja e no popup. Pedido do dono | decidida 19-10-2026 |
| Janela de andamento | substitui a "Download concluído": abre para tudo que vem do navegador (captura e botão do vídeo), mostra etapa, %, baixado, velocidade, restante e conexões/formato em 4 colunas (label-micro sobre o valor), termina como Concluído/Falhou na mesma janela; Pausar/Retomar/Cancelar agem na fila, Esconder só fecha; sem roubar o foco, por cima só 3 s, até 3 em cascata; "Não mostrar esta janela" + bandeja/popup. Pedido do dono (maquete aprovada) | decidida 20-10-2026 |
| Pausar/Retomar tudo | botões no cabeçalho da fila, só quando servem (há o que pausar / há pausados); pausar guarda os pedaços; item pausado mostra "continua de onde parou", sem percentual (o da pausa cairia ao retomar) | decidida 18-10-2026 |
| Queda de conexão | retomada automática: até 3 tentativas (3 s e 8 s de espera), continuando do ponto onde parou; vídeo privado/indisponível não tenta de novo | decidida 17-10-2026 |
| Formato | M4A (padrão) · Opus · MP3. M4A e Opus copiam o fluxo original do YouTube, sem conversão; o dono ouve em todo lugar e quis as três opções | decidida 17-10-2026 |
| Qualidade do MP3 | só aparece com MP3; padrão 256 kbps para compensar a perda da conversão Opus→MP3 (substitui o padrão 192) | decidida 17-10-2026 |
| Campos | sans por padrão, mono no campo de dado | herdada |
| Aviso (`Callout`) | hairline 1px + lavagem, sem faixa lateral | herdada |
| Toolbar | uma parada de Tab (roving) | herdada |

## 10. Como trabalhar

**Fatia vertical por vez** (uma superfície inteira, não uma regra no app todo — exceto fundações).

1. **Fundações** (uma vez): `tokens.css` no `index.css` do frontend, temas escuro e claro, gate de
   lint de cor literal.
2. **Primitivos** (tabela da seção 2) antes das telas.
3. **Por superfície:**
   - **Capturas "antes"** em um tema escuro e um claro (Playwright headless; a skill
     `playwright-cli` ajuda).
   - **Diagnóstico:** `/impeccable critique <alvo>` ou o método de `ui-craft/references/review.md`
     (evidência `arquivo:linha` → um conserto por achado → passe de falsificação → top 3–5).
   - **Varredura mecânica:** `/web-design-guidelines <arquivos>`.
   - **Consertos num lote**, no nível mais estreito correto (token faltando × implementação avulsa ×
     desencontro de conceito × defeito local). Por script ancorado, com contagem exata de trocas.
   - Mexeu em movimento → `/review-animations` e tabela Antes/Depois/Por quê no estilo
     `emil-design-eng`.
   - **Barra de acabamento:** `ui-craft/references/finish-bar.md`; pronto = zero crítico, zero maior.
4. **Verificação limitada:** build com gate de lint → UMA rodada de capturas "depois" (dois temas,
   zoom alto, janela mínima) + checagem de que nenhum atributo vazou como texto → corrigir num lote
   → no máximo mais uma rodada → parar. Sem polir em laço.
5. Quadro antes × depois e relatório curto (Checado / Mudou / Deixado / Veredito).

**Não usar** para o app: `/impeccable live|generate|overdrive|bolder|delight`, o material de
landing da `design-taste-frontend`, as cores/fontes fixas de `shadcn`/`sleek`/
`ui-craft-dense-dashboard` (só a estrutura delas). O lançador da impeccable (`scripts/impeccable`)
baixa um executável para `~\.impeccable` na primeira execução — **pedir ao dono antes de rodar**;
sem ele, a skill lê o contexto direto (esta diretriz faz o papel do DESIGN.md).
