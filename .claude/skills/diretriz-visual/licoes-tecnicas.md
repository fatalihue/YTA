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
    antes do primeiro download (uma corrida já mandou arquivos de teste para a pasta Música — e a
    2.0 repetiu o erro: o teste trocava só Downloads, e o M4A foi para Música). Hoje
    `YTA_TEST_DOWNLOADS` troca Downloads, Música e Vídeos de uma vez; conferir a pasta no relatório.
22. **Acelerador: abrir as 8 conexões de uma vez é pior que uma só** em servidores com limite (a
    Hetzner responde 429 a partir da 3ª; medido 26,7 → 2,8 MB/s). Abrir em rampa e parar na primeira
    recusa de uma conexão nova; devolver o pedaço recusado à conexão de onde ele saiu.
23. **Testar downloads no Edge/Chrome por script:** o 2º download disparado pela mesma página é
    segurado pelo aviso "baixar vários arquivos" e nem chega à extensão. No perfil de teste:
    `profile.default_content_setting_values.automatic_downloads = 1` em `Default/Preferences`.
24. **Servidor de teste de velocidade pode recusar User-Agent de navegador** (a Hetzner fecha a
    conexão para "Mozilla/…"). Medir com um UA neutro; no app, a captura usa o UA do navegador.
25. **Botão da extensão no YouTube preso à miniatura, não à prévia.** A prévia ao passar o mouse é
    outro player (`#inline-preview-player`, também um `ytd-player`) que some quando o botão a cobre (o
    YouTube entende que o mouse saiu) e só nasce depois do ponteiro parar. Preso ao `<video>` dela, o
    botão sumia no caminho até ele. Medir no YouTube real (Edge + `--load-extension` + CDP).
26. **Instagram (nov/2026): o que quebrou é a API de stories, não os cookies.** `feed/reels_media`
    responde vazia fora do navegador e 500 dentro dele, e o yt-dlp traduz como "You need to log in".
    `media/ID/info` com os mesmos cookies funciona (story, post, foto, carrossel); destaque só pela
    página logada (`items` do reel no JSON embutido). Erro de diagnóstico que custou uma release com
    a explicação errada: a página inicial sem cabeçalhos de navegador vem "deslogada" (`USER_ID` 0)
    mesmo com sessão válida. Para saber se um login vale, chamar uma API que exija login.
27. **yt-dlp com arquivo direto de CDN:** o ID vira o nome do arquivo com a query assinada; no
    template use `%(id).64B` (caminho > 260 no Windows dá "Invalid argument"). E `[acodec!=none]`
    descarta codec desconhecido — o .mp4 direto não informa codec; `[acodec!=?none]` aceita.
28. **yt-dlp em carrossel do Instagram com foto:** lista os vídeos e termina com erro na 1ª foto
    ("No video formats found"), derrubando o item inteiro. Testar carrossel misto, não só de vídeo.
29. **O Electron não lê o `APPDATA` do ambiente** para o userData: um teste "isolado" por variável
    de ambiente rodou no perfil real (e gravou no histórico). Isolar com `app.setPath('userData')`
    antes de qualquer uso (`YTA_TEST_USERDATA`, só fora do app instalado). O localStorage leva
    ~5–7 s para ir ao disco: esperar antes de matar o processo num teste que confere preferências.

## Interface 2.0 (nov/2026)

30. **Cascadia Mono variável no Chromium (Windows 11):** pedida pela família, sai engrossada pelo
    hinting a 12–13 px (parece negrito). Numa página solta, `font-variation-settings: 'wght' 400`
    "corrige"; na janela do app não muda nada, e o peso 350 funciona ou não conforme a ordem em que
    as instâncias carregam. `local('Cascadia Mono Regular')` não acha a face (o que parecia regular
    era a Consolas de reserva). Conferir fonte SEMPRE na janela real, em 1x, ampliando a captura.
31. **Tailwind 4 registra `--tw-*` com `inherits: false`** (e zera com `initial`): regra própria que
    lê `var(--tw-font-weight)` não vê o peso do pai. Não construir em cima das variáveis internas.
32. **`input type="search"` tem um "x" nativo** (`::-webkit-search-cancel-button`) que duplica o
    botão de fechar do campo; esconder com `appearance: none`.
33. **Dica perto da barra de título:** com `titleBarOverlay`, os botões do Windows são desenhados
    POR CIMA da página; uma dica posicionada acima de um botão a menos de ~80 px do topo some atrás
    deles. Abrir para baixo.
34. **Regra genérica de item vence a de um controle dentro do menu:** `.menu button { width: 100% }`
    (0,1,1) passou por cima de `.switch { width: 30px }` (0,1,0) e a chave virou uma barra. Estilizar
    itens por classe (`.menu .item`), nunca pela tag.
35. **Teste da extensão por script (Edge):** (a) o manifesto exclui `http://127.0.0.1/*` (páginas do
    próprio YTA) e o app só aceita endereço com ponto — servir a página de teste em `127.0.0.2`;
    (b) janela encoberta pausa o `requestAnimationFrame` (a pílula nunca aparece):
    `--disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion`;
    (c) `--load-extension` pede `--disable-features=DisableLoadExtensionCommandLineSwitch`; (d) o
    msedge.exe lançado passa a vez a outros processos — fechar com `Browser.close` pelo CDP (matar o
    PID deixa o navegador vivo segurando a porta de depuração, e a rodada seguinte fala com ele);
    (e) clique que fecha a janela nunca recebe a resposta do `Runtime.evaluate`: pôr limite de tempo.
36. **Menu em portal que só monta depois de medir a posição:** o efeito que foca o primeiro item
    rodava antes de o menu existir (React roda os efeitos da 1ª passada antes do re-render pedido
    pelo efeito de layout) — na 1ª abertura de cada menu o foco ficava no gatilho e as setas não
    andavam. Focar num efeito que depende de `[open, pos]`.
37. **Nada opcional entre "arquivo pronto" e "item concluído":** a miniatura da lista (ffmpeg lendo
    a capa pela internet, até 20 s) segurava o fim do download; fechar o app nesse meio-tempo fazia a
    fila baixar tudo de novo ao reabrir. Trabalho opcional vai depois, em segundo plano, e nunca pode
    lançar erro síncrono (um `mkdirSync` que falha antes do `.catch` vira "Falhou").
38. **Conferir arquivos no processo principal só de forma assíncrona:** `existsSync` em 1.000
    entradas a cada item concluído trava a fila, o andamento e a extensão — e numa pasta de rede fora
    do ar, por segundos. `fs.promises.access` em paralelo.
39. **Script de página da extensão:** aceitar só eventos com `isTrusted` (a página pode disparar
    `pointermove` e `.click()` sintéticos e baixar sem o usuário); `aria-live` nunca em texto que
    muda várias vezes por segundo (bytes, velocidade) — o leitor de tela não para de falar.
