# YTA

Cola um ou mais links de vídeo (YouTube, Instagram e a maioria dos sites), escolhe a pasta e o
formato, e sai o arquivo de áudio ou o vídeo completo. App desktop para Windows (Electron + React + Tailwind 4).

## Instalar

Baixe o `YTA-Setup-x.y.z.exe` da [última release](https://github.com/fatalihue/YTA/releases/latest)
e rode. Instala em um clique, só para o usuário atual (sem pedir administrador), em
`%LOCALAPPDATA%\Programs\YTA`, com atalhos no menu Iniciar e na área de trabalho.

O instalador não é assinado: na primeira vez o SmartScreen pode avisar — "Mais informações" →
"Executar assim mesmo".

### Atualização automática

Ao abrir (e a cada 4 h) o YTA procura uma versão nova, baixa em segundo plano e mostra
"Versão X pronta · Reiniciar e atualizar" no cabeçalho da fila. Reiniciando, ele instala em
silêncio e reabre já atualizado; se não, instala ao fechar o app. Com downloads em andamento, ele
espera — não interrompe a fila.

O feed é o `latest.yml` da release mais recente, lido pelo endereço fixo
`releases/latest/download/` (sem a API do GitHub, como no TrueReplayer).

## Extensão do navegador

Um botão **"Baixar"** aparece no canto dos vídeos de qualquer site — com regras próprias no YouTube
(página, Shorts, prévias, players embutidos) e no Instagram (feed, reels, posts) —, como o do IDM:

- **clique no corpo**: baixa com a última escolha (ex.: "Áudio M4A");
- **setinha**: menu com áudio (M4A, Opus, MP3), vídeo (melhor ou as resoluções reais daquele vídeo)
  e "Compatível com WhatsApp (H.264)";
- o próprio botão mostra o andamento: na fila → baixando % → **Salvo · Abrir pasta**;
- o **×** esconde o botão naquele vídeo; **"Não mostrar em …"** (no menu) esconde no site todo
  (desfaz pelo ícone da extensão); clique direito em um link: "Baixar com o YTA".

O download acontece no YTA (mesma fila, pasta e formatos); a extensão só envia o pedido. Com o YTA
fechado, ela o abre pelo `yta://` (o Chrome pergunta "Abrir o YTA?" na primeira vez — marque
"sempre permitir") e o app fica só na bandeja.

**Instalar (modo desenvolvedor):** no YTA, botão de peça de quebra-cabeça no cabeçalho da fila (ou
ícone da bandeja → "Conectar extensão do navegador…"). Ele copia o caminho da pasta da extensão
(`%APPDATA%\yta\extension`); em `chrome://extensions` (ou `edge://extensions`) ative o
"Modo do desenvolvedor" → "Carregar sem compactação" → cole o caminho. A pasta é atualizada pelo
próprio YTA a cada versão e a extensão se recarrega sozinha.

**Segurança:** o YTA escuta só em `127.0.0.1` e só aceita pedidos da extensão (cabeçalho próprio,
que páginas comuns não conseguem enviar, e origem `chrome-extension://` com o ID fixo dela).

## Bandeja

Fechar a janela deixa o YTA rodando ao lado do relógio (para a extensão sempre achá-lo); "Sair" no
ícone da bandeja encerra de verdade. Pedidos da extensão entram na fila sem abrir a janela e
avisam por notificação do Windows ("Salvo: …" — clique para abrir a pasta).

## Desenvolver e publicar

```
npm install
npm start                      # compila e abre o app
npm run dist                   # gera release/YTA-Setup-x.y.z.exe + latest.yml (sem publicar)
npm run icons                  # regera os ícones (app, bandeja, extensão)

npm version patch              # sobe a versão (commit + tag)
npm run release -- "- Novidade 1" "- Novidade 2"
```

`npm run release` exige a árvore limpa no `main`, gera o instalador, envia o código e a tag e cria a
release (marcada como *latest*) com o instalador, o `.blockmap` e o `latest.yml` — os arquivos que
os apps instalados leem para se atualizar. Sem notas, o GitHub gera a partir dos commits.

## No dia a dia

- **Arrastar e soltar** um link do navegador na janela já põe na fila.
- **Link copiado:** ao voltar para a janela com um link de vídeo na área de transferência, aparece
  "Link copiado: … · Colar".
- **Pastas separadas:** áudios vão para uma pasta e vídeos para outra (padrão: Música e Vídeos); a
  linha "Salvar … em" mostra a do formato escolhido.
- **Playlists do YouTube:** o link da playlist vira os vídeos dela, numerados (01, 02…) numa pasta
  com o nome da playlist. Um vídeo aberto dentro de uma playlist pergunta "Só o vídeo" ou "A
  playlist inteira". Os "Mix" automáticos (`list=RD…`) são infinitos e ficam como vídeo único.
  Baixando a mesma playlist de novo, só os vídeos novos entram (os já baixados são pulados).
- **Baixados:** a aba ao lado da fila guarda os últimos 1.000 downloads (abrir a pasta, baixar de
  novo, tirar do histórico). Colar um link já baixado no mesmo formato avisa e oferece "Baixar de novo".
- **Pausar tudo / Retomar tudo** (cabeçalho da fila): pausar para os downloads guardando o que já
  veio; retomar continua daí (cada item pausado também tem o seu "Retomar"). Pausados continuam
  pausados ao reabrir o app.
- **A fila sobrevive ao fechar:** o que estava na fila ou baixando volta ao reabrir, e um download
  interrompido continua de onde parou.
- **Capa:** M4A e MP3 saem com a miniatura do vídeo como capa (o Opus não guarda capa).
- **Iniciar com o Windows** (ícone da bandeja), ligado por padrão: o YTA abre já na bandeja e a
  extensão sempre o encontra.

## Formatos

| Formato | Como é gravado | Quando usar |
|---|---|---|
| **M4A** (padrão) | AAC original, sem conversão | Toca em praticamente tudo (iPhone, Android, Windows, carro) |
| **Opus** | Opus original, sem conversão | Melhor qualidade e menor arquivo; pode não tocar no iPhone e em aparelhos antigos |
| **MP3** | Convertido pelo ffmpeg (128–320 kbps, padrão 256) | Aparelhos antigos, som de carro, pendrive |
| **Vídeo** | MP4: melhor vídeo + melhor áudio, juntados sem recodificar | Vídeo completo; resolução escolhível |

M4A e Opus só trocam a embalagem, então saem em segundos e sem perda. Se não houver o codec
original, o app converte (AAC 192 kbps ou Opus 160 kbps). Título, artista, ano e link vão para os
metadados em todos os formatos.

No **Vídeo**, o padrão é a maior resolução disponível. Com um único link, a lista mostra só as
resoluções que aquele vídeo tem; com vários, a escolha vale como teto (cada vídeo sai nela ou na
maior abaixo). Na mesma resolução, prefere H.264 + AAC; acima de 1080p o YouTube só oferece VP9/AV1.
Atenção ao tamanho: 1 h em 4K passa fácil de 10 GB.

**Converter para H.264 se preciso (WhatsApp)** garante MP4 com H.264 + AAC: o que já vier assim só
é juntado; o resto é convertido pela placa de vídeo (NVIDIA, Intel ou AMD) ou, sem ela, pelo
processador. O arquivo convertido fica maior (4K em H.264 ≈ 2× o VP9).

## Outros sites

Qualquer link `http(s)` é aceito. O yt-dlp reconhece ~1.800 sites (Vimeo, X/Twitter, TikTok,
Facebook, Reddit, Twitch, Dailymotion, SoundCloud, sites de notícia…) e tem um extrator genérico
que procura o vídeo no HTML das outras páginas. Se nem assim achar, a extensão manda junto o arquivo
de vídeo que a página estava tocando (`.m3u8`, `.mpd`, `.mp4`) e o YTA baixa direto dele, com o
título da página — o mesmo truque do IDM.

- Páginas com vários vídeos baixam todos (um arquivo por vídeo).
- Muitos sites exigem conta (Vimeo, Reddit…): "Entrar e tentar de novo" abre o site na janela de
  login do YTA; entre e feche a janela.
- Serviços com **DRM** (Netflix, Prime Video, Disney+, Spotify, Globoplay…) não dá para baixar.
- Extratores do yt-dlp às vezes quebram quando um site muda; o yt-dlp é atualizado a cada abertura
  do YTA e as correções chegam sozinhas.

## Instagram

Aceita links de posts, reels, IGTV e stories. O arquivo sai como "conta - código do post" (o título
que o Instagram dá é genérico) e a primeira linha da legenda vira o título nos metadados. Um
carrossel com vários vídeos vira um arquivo por vídeo. No vídeo, o app prefere a versão H.264 do
Instagram (compatível com o WhatsApp), mesmo quando existe uma de resolução maior em VP9. O
Instagram exige login para muita coisa (stories sempre) e bloqueia quem baixa demais em sequência.

**Stories:** o link de um story (`/stories/conta/123…/`) baixa só aquele story; o botão da extensão
segue o story que está na tela ao passar para o próximo. **Destaques** (`/stories/highlights/…`)
baixam o destaque inteiro: o endereço é do destaque, não do item, e o botão avisa ("Baixar destaque
inteiro"). Um link sem número (`/stories/conta/`) baixa todos os stories atuais da conta. Baixar
um story conta como visualização sua.

## Login

Às vezes o YouTube pede "confirme que você não é um robô" (comum depois de muitos downloads seguidos
do mesmo IP) ou exige login por restrição de idade; o Instagram exige login para muitos posts.
"Entrar em sites…" abre o Chrome (ou o Edge, se não houver Chrome) num perfil separado,
só do YTA, com abas do YouTube e do Instagram (e do site do item, quando vem de "Entrar e tentar
de novo"; dá para abrir qualquer outro site nessa janela): entre nas contas que quiser e feche-a. O login fica
nesse perfil, sem mexer no seu navegador, e é usado **apenas** quando o site exige: o app reabre o
perfil invisível, renova os cookies e o item tenta de novo sozinho. "Sair" apaga o perfil e os
cookies.

## Como funciona

- Vários links de uma vez (um por linha) entram numa fila que processa até 3 itens ao mesmo tempo.
- Se a conexão cair, o item tenta de novo sozinho (até 3 vezes) e continua de onde parou.
- Cada arquivo é baixado em pedaços, 8 ao mesmo tempo (como o IDM): o YouTube limita a velocidade
  por conexão, e assim o vídeo passa de ~15 MB/s para ~65–70 MB/s.
- O yt-dlp usa o próprio YTA como motor JavaScript (Node embutido), que ele exige para o YouTube.
- O `yt-dlp.exe` oficial é baixado do GitHub na primeira abertura (para `%APPDATA%\yta\bin`) e
  atualizado a cada abertura — o YouTube quebra versões antigas com frequência.
- O yt-dlp só baixa; a gravação final é feita pelo ffmpeg (`ffmpeg-static`), que informa o
  progresso real. O arquivo nunca sobrescreve outro: se o nome existe, vira "Nome (2).m4a".
- Pasta, formato e qualidade escolhidos ficam lembrados.
