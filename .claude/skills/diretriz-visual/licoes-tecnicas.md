# Lições técnicas (pagas no rework do TrueReplayer, out/2026)

Cada item custou um defeito real ou uma regressão quase lançada. Ler antes de mexer em tokens,
foco, tipografia ou fazer codemod.

## Tailwind 4

1. **Sombra do `@theme` não segue o tema.** A utility gerada (`shadow-dialog`) COPIA o valor do
   `@theme` para dentro da regra (para injetar `--tw-shadow-color`). Trocar `--shadow-dialog` em
   runtime não muda nada para quem usa a classe. Token que o runtime reescreve → fora do `@theme` +
   `@utility shadow-x { box-shadow: var(--shadow-x) }`. Cores não têm o problema (a utility lê
   `var(--color-*)`). Regra geral: conferir o CSS GERADO antes de confiar numa utility de token.
2. **CSS sem camada vence qualquer utility.** A regra global de `:focus-visible` (sem `@layer`)
   ganha de `focus-visible:outline-offset-[-2px]`. Ajuste de foco em componente = outra regra sem
   camada, mais específica (ex.: `[data-focus-inset]:focus-visible`).
3. **Empate de duas classes de tamanho** é decidido pela ordem no CSS gerado, não pela className.
   Ex.: `.text-[11px]` sai ANTES de `.text-ui`, então um `text-[11px]` ao lado de `text-ui` é inerte.
4. **`text-[Npx]` define só o tamanho** (herda `line-height: 1.5`); as utilities de rampa definem
   tamanho e linha. Migrar para a rampa muda alturas onde a altura vem de padding + linha — medir
   antes e depois (retrato de altura de todos os elementos) e usar `leading-[inherit]` nos
   controles que precisam manter a altura de antes.
5. **`@custom-variant motion-ok (&:where(html[data-animations="true"] *))`** é o portão de movimento
   barato: prefixo em qualquer utility, especificidade zero.

## Navegador / WebView

6. **`overflow-hidden` corta o anel de foco** de um filho que preenche o pai (o outline fica fora da
   caixa). Desenhar o anel para dentro (`outline-offset: -2px` + halo `inset`).
7. **`crypto.randomUUID` só existe em contexto seguro.** Num harness que serve o app por
   interceptação, usar `http://localhost:<porta>`, não uma origem inventada.
8. **Preflight dá `font-weight: bolder` a `<strong>`/`<b>`** → 700 sobre texto 400. Usar
   `<span className="font-semibold">`.
9. **`<label>` sem `htmlFor` não nomeia o controle.** Um `Field` precisa ligar rótulo e controle
   (`useId` + `aria-labelledby`, ou grupo rotulado com `display: contents`).
10. **CSS `zoom` no `<html>` cria dois espaços:** medir (`getBoundingClientRect`, `clientX`) é
    VISUAL; escrever (`left/top/width`) é LAYOUT. Viewport units ignoram o zoom do ancestral:
    `calc(100vw / var(--ui-zoom))`.
11. **`role="dialog"` num painel** pode fazer guardas de teclado ("está dentro de um diálogo?")
    engolirem os próprios atalhos do painel (Ctrl+S, Esc). Painel lateral = `role="region"` com nome.

## Codemods e verificação

12. **Atributo JSX inserido "na linha depois do `<button`"** vira TEXTO dentro do botão quando a
    tag fecha na mesma linha — e o build passa (texto solto é JSX válido). Varrer "linha de
    atributo cujo anterior termina em `>`/`/>`", e fazer o harness de captura falhar se
    `document.body.innerText` contiver `aria-…=` ou `role="`.
13. **Regex de tag com `[^>]*` erra em `onClick={() => …}`** — o `=>` tem `>`.
14. **Substituição com contagem esperada** (falha se achar N≠esperado), ancorada em texto único,
    preservando CRLF/LF; nunca `sed -i` em arquivo CRLF; trechos com crase ou `$` vão por arquivo,
    não por heredoc/`node -e` do shell (o bash come crases e `\`).
15. **"Corrigir a causa raiz" pode desfazer compensações calibradas.** Antes de mudar a base (ex.:
    a fonte herdada de uma célula), procurar `translate-y-[-2px]` e afins que dependem dela; se
    houver várias, preferir alinhar o caso fora do padrão ao padrão dos vizinhos.
16. **Antes × depois honesto:** buildar os DOIS commits (`git worktree add --detach` para o "antes")
    e capturar os mesmos estados semeados, nos dois temas; tema injetado por `addInitScript` antes do
    carregamento (gravar storage e recarregar perde para o app).
17. **Mapa automático superestima dívida.** Contagens por grep incluem comentários e casos
    deliberados (três `Section` com papéis diferentes, um invólucro fino que parece duplicata).
    Confirmar no código antes de "consolidar".

## Electron (YTA, out/2026)

18. **Electron 44: `clipboard.readText()` devolve uma Promise.** Código síncrono antigo
    (`readText().slice()`) quebra com "is not a function". Conferir APIs que mudaram de síncronas
    para assíncronas a cada atualização grande do Electron.
19. **`will-navigate` com `preventDefault()` também bloqueia `location.reload()`.** Proteger a
    janela contra navegação (links/arquivos soltos) quebra testes que recarregam a página para
    aplicar o localStorage: gravar, fechar o app (`window.close()`) e reabrir.
20. **Promessa vinda do `contextBridge` não é "esperada" pelo CDP** (`Runtime.evaluate` com
    `awaitPromise` devolve `{}`). Nos testes, encadear `.then(String, e => 'ERRO ' + e.message)`.
21. **Teste que baixa de verdade precisa de trava de pasta**: conferir que o destino é o do teste
    antes do primeiro download (uma corrida já mandou arquivos de teste para a pasta Música).
22. **Acelerador: abrir as 8 conexões de uma vez é pior que uma só** em servidores com limite (a
    Hetzner responde 429 a partir da 3ª; medido 26,7 → 2,8 MB/s). Abrir em rampa e parar na primeira
    recusa de uma conexão nova; devolver o pedaço recusado à conexão de onde ele saiu.
23. **Testar downloads no Edge/Chrome por script:** o 2º download disparado pela mesma página é
    segurado pelo aviso "baixar vários arquivos" e nem chega à extensão. No perfil de teste:
    `profile.default_content_setting_values.automatic_downloads = 1` em `Default/Preferences`.
24. **Servidor de teste de velocidade pode recusar User-Agent de navegador** (a Hetzner fecha a
    conexão para "Mozilla/…"). Medir com um UA neutro; no app, a captura usa o UA do navegador.
