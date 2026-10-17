# YTA

Cola um ou mais links do YouTube ou do Instagram, escolhe a pasta e o formato, e sai o arquivo de
áudio ou o vídeo completo. App desktop para Windows (Electron + React + Tailwind 4).

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

## Desenvolver e publicar

```
npm install
npm start                      # compila e abre o app
npm run dist                   # gera release/YTA-Setup-x.y.z.exe + latest.yml (sem publicar)

npm version patch              # sobe a versão (commit + tag)
npm run release -- "- Novidade 1" "- Novidade 2"
```

`npm run release` exige a árvore limpa no `main`, gera o instalador, envia o código e a tag e cria a
release (marcada como *latest*) com o instalador, o `.blockmap` e o `latest.yml` — os arquivos que
os apps instalados leem para se atualizar. Sem notas, o GitHub gera a partir dos commits.

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

## Instagram

Aceita links de posts, reels, IGTV e stories. O arquivo sai como "conta - código do post" (o título
que o Instagram dá é genérico) e a primeira linha da legenda vira o título nos metadados. Um
carrossel com vários vídeos vira um arquivo por vídeo. No vídeo, o app prefere a versão H.264 do
Instagram (compatível com o WhatsApp), mesmo quando existe uma de resolução maior em VP9. O
Instagram exige login para muita coisa (stories sempre) e bloqueia quem baixa demais em sequência.

## Login (YouTube e Instagram)

Às vezes o YouTube pede "confirme que você não é um robô" (comum depois de muitos downloads seguidos
do mesmo IP) ou exige login por restrição de idade; o Instagram exige login para muitos posts.
"Entrar no YouTube/Instagram…" abre o Chrome (ou o Edge, se não houver Chrome) num perfil separado,
só do YTA, com uma aba para cada site: entre nas contas que quiser e feche a janela. O login fica
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
