const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const bridge = require('./bridge.cjs');
const accel = require('./accel.cjs');

// Em pacote, o binário do ffmpeg-static fica fora do asar.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const binDir = path.join(app.getPath('userData'), 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp.exe');
const workRoot = path.join(app.getPath('temp'), 'yta');
// Testes automáticos: pasta de Downloads trocada (nunca no app instalado), para não gravar na real.
if (!app.isPackaged && process.env.YTA_TEST_DOWNLOADS) app.setPath('downloads', process.env.YTA_TEST_DOWNLOADS);
// Cookies do login do YouTube, no formato que o yt-dlp lê (ver o bloco de login mais abaixo).
const cookiesFile = path.join(app.getPath('userData'), 'youtube-cookies.txt');

/**
 * O yt-dlp precisa de um motor JavaScript para conversar direito com o YouTube. O próprio
 * executável do app vira um Node com ELECTRON_RUN_AS_NODE=1, então não há nada a instalar.
 */
const ytdlpEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ELECTRON_RUN_AS_NODE: '1' };
const jsRuntimeArgs = ['--js-runtimes', `node:${process.execPath}`];

let win = null;
const jobs = new Map(); // id → { child, cancelled }
let toolReady = null; // promessa: yt-dlp presente e atualizado
let toolStatus = { state: 'pending' };

function send(channel, payload) {
  if (channel === 'tool-status') toolStatus = payload;
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function downloadYtDlp() {
  fs.mkdirSync(binDir, { recursive: true });
  const res = await fetch(YTDLP_URL);
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const tmp = `${ytdlpPath}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, ytdlpPath);
}

const updateStamp = path.join(binDir, 'last-update-check');
const UPDATE_EVERY = 12 * 60 * 60 * 1000;
function updateYtDlp() {
  try {
    if (Date.now() - fs.statSync(updateStamp).mtimeMs < UPDATE_EVERY) return Promise.resolve();
  } catch {}
  return new Promise((resolve) => {
    execFile(ytdlpPath, ['-U'], { windowsHide: true, timeout: 60_000 }, (err) => {
      if (!err) fs.writeFileSync(updateStamp, new Date().toISOString());
      resolve();
    });
  });
}

function prepareTool() {
  toolReady = (async () => {
    if (!fs.existsSync(ytdlpPath)) {
      send('tool-status', { state: 'installing' });
      await downloadYtDlp();
      fs.writeFileSync(updateStamp, new Date().toISOString()); // acabou de vir: é a versão mais nova
    } else {
      send('tool-status', { state: 'updating' });
      await updateYtDlp(); // falha de rede aqui não impede o uso da versão local
    }
    send('tool-status', { state: 'ready' });
  })().catch((err) => {
    send('tool-status', { state: 'error', message: err.message });
    toolReady = null;
    throw err;
  });
  toolReady.catch(() => {});
  return toolReady;
}

function friendlyError(stderr) {
  const line = stderr
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('ERROR:'));
  const raw = (line || stderr.trim().split(/\r?\n/).pop() || '').replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, '');
  if (/\bdrm\b/i.test(raw)) return 'Protegido por DRM: este site não permite baixar o vídeo.';
  if (/private video/i.test(raw)) return 'O vídeo é privado.';
  if (/requested format is not available/i.test(raw)) return 'Este vídeo não tem áudio disponível nesse formato (pode ser mudo).';
  if (/unavailable|not available|does not exist/i.test(raw)) return 'O vídeo não está disponível.';
  if (/sign in to confirm your age|age-restricted/i.test(raw)) return 'O vídeo tem restrição de idade e exige login no YouTube.';
  if (/sign in to confirm/i.test(raw)) return 'O YouTube pediu verificação de que não é um robô e exige login.';
  if (/cookies/i.test(raw) && /invalid|expired|no longer valid/i.test(raw)) return 'O login do YouTube expirou. Entre de novo.';
  if (/empty media response/i.test(raw)) return 'O Instagram exige login para este conteúdo.';
  if (GENERIC_LOGIN.test(raw)) return 'Este site exige login. Entre na conta pelo YTA e tente de novo.';
  if (/rate-?limit/i.test(raw)) return 'O Instagram limitou os acessos. Entre na conta ou tente mais tarde.';
  if (/there is no video in this post|no video formats/i.test(raw)) return 'Este post não tem vídeo.';
  // O site respondeu (não é falta de internet): "unable to download webpage: HTTP Error 404".
  if (/HTTP Error 404|HTTP Error 410/i.test(raw)) return 'O vídeo não existe mais nesse endereço.';
  if (/HTTP Error 40[13]/i.test(raw)) return 'O site recusou o acesso (pode exigir login).';
  if (/unable to download webpage|getaddrinfo|timed out|connection/i.test(raw)) return 'Sem conexão. Verifique a internet.';
  if (/is not a valid url/i.test(raw)) return 'Endereço inválido.';
  if (/unsupported url|no video could be found|no media found/i.test(raw)) return 'Não encontrei vídeo nesta página.';
  if (/live event|is live/i.test(raw)) return 'Transmissões ao vivo não podem ser baixadas.';
  return raw || 'O yt-dlp encerrou sem dizer o motivo.';
}

/** Pedidos que só passam com login (verificação de robô, idade, Instagram e qualquer site que peça conta). */
const GENERIC_LOGIN = /login required|requires? (a )?log ?in|you need to log in|logged-in|authentication is required|registered users|members only|use --cookies/i;
const LOGIN_ERRORS = new RegExp(`sign in to confirm|age-restricted|confirm your age|empty media response|rate-?limit|${GENERIC_LOGIN.source}`, 'i');
/** A página não tem vídeo que o yt-dlp reconheça (aí vale tentar o arquivo que a extensão viu). */
const NOT_FOUND = /unsupported url|no video could be found|no media found|no video formats/i;
function needsLogin(stderr) {
  return LOGIN_ERRORS.test(stderr);
}

/** Rede, bloqueio temporário ou processo encerrado sem motivo valem nova tentativa; vídeo privado não. */
function isRetryable(stderr) {
  return !LOGIN_ERRORS.test(stderr) && !NOT_FOUND.test(stderr) && !/\bdrm\b|private video|unavailable|not available|does not exist|no video in this post|not a valid url|live event|is live/i.test(stderr);
}

/** Site do link (define qual login usar): youtube, instagram ou o domínio (ex.: vimeo.com). */
function siteOf(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {}
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  return host || 'outro';
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [3000, 8000]; // antes da 2ª e da 3ª tentativa

/** Espera interrompível pelo cancelamento. */
async function pause(job, ms) {
  for (let t = 0; t < ms && !job.cancelled; t += 200) await new Promise((r) => setTimeout(r, 200));
}

function killTree(pid) {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}
const isAlive = (child) => child && child.exitCode === null && child.signalCode === null;

const num = (v) => (v === undefined || v === 'NA' || v === 'N/A' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Lê a saída linha a linha. */
function onLines(stream, cb) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(cb);
  });
}

/** Envia no máximo um evento de progresso a cada 150 ms (o último sempre passa). */
function throttled(fn) {
  let last = 0;
  return (payload, force) => {
    const now = Date.now();
    if (force || now - last >= 150) {
      last = now;
      fn(payload);
    }
  };
}

function safeName(name) {
  const clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 180)
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return `_${clean}`;
  return clean || 'audio';
}

// Nomes já escolhidos por itens em andamento (com itens em paralelo, o arquivo ainda não existe).
const reserved = new Set();

/** "Nome.m4a", ou "Nome (2).m4a" se já existir — nunca sobrescreve. */
function uniqueFile(folder, name, ext) {
  const dot = ext ? `.${ext}` : ''; // arquivo baixado pelo acelerador pode não ter extensão
  let candidate = path.join(folder, `${name}${dot}`);
  const taken = (p) => reserved.has(p.toLowerCase()) || fs.existsSync(p) || fs.existsSync(`${p}.part`);
  for (let n = 2; taken(candidate); n++) {
    candidate = path.join(folder, `${name} (${n})${dot}`);
  }
  return candidate;
}

/**
 * Formatos de saída. M4A e Opus pegam o fluxo original do YouTube e só trocam a embalagem
 * (sem perda e quase instantâneo); recodificam apenas se o vídeo não tiver esse codec.
 * MP3 sempre converte.
 */
// Sem HLS (m3u8): no modo em pedaços o yt-dlp passaria a preferi-los, e eles não informam o
// tamanho (progresso e tempo restante oscilam) nem a taxa do áudio.
const NO_HLS = '[protocol!*=m3u8]';

const FORMATS = {
  m4a: {
    // Sem faixa só de áudio (posts do Instagram), usa o arquivo com vídeo e tira o áudio dele.
    select: `bestaudio[ext=m4a][acodec^=mp4a]${NO_HLS}/bestaudio${NO_HLS}/bestaudio/best[acodec!=none]`,
    original: (acodec) => /^mp4a/.test(acodec || ''),
    encode: ['-c:a', 'aac', '-b:a', '192k'],
    muxer: ['-f', 'ipod', '-movflags', '+faststart'],
  },
  opus: {
    select: `bestaudio[acodec=opus]${NO_HLS}/bestaudio${NO_HLS}/bestaudio/best[acodec!=none]`,
    original: (acodec) => acodec === 'opus',
    encode: ['-c:a', 'libopus', '-b:a', '160k'],
    muxer: ['-f', 'opus'],
  },
  mp3: {
    select: `bestaudio${NO_HLS}/bestaudio/best[acodec!=none]`,
    original: () => false,
    encode: (bitrate) => ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-id3v2_version', '3'],
    muxer: ['-f', 'mp3'],
  },
};

class Cancelled extends Error {}

/**
 * Vídeo: maior resolução até o teto pedido; na mesma resolução, prefere H.264 + AAC (tocam em
 * tudo). Acima de 1080p o YouTube só tem VP9/AV1. Vídeo e áudio vêm em arquivos separados (a
 * vírgula) para o ffmpeg juntar com progresso; vídeos antigos só com formato combinado caem no "b".
 */
const VIDEO_SORT = 'res,fps,vcodec:h264,acodec:aac';
// Instagram: as versões DASH (as de maior resolução) costumam ser VP9, que o WhatsApp recusa. A
// versão H.264 é a "progressiva" (vídeo e áudio juntos, ids sem "dash-"), cujo codec o yt-dlp não
// conhece, então ela é pedida pelo nome. Sem ela, cai na melhor DASH.
const instagramVideoSelect = (maxHeight) => `b[format_id!^=dash]${NO_HLS}/${videoSelect(maxHeight)}`;
function videoSelect(maxHeight) {
  const h = maxHeight ? `[height<=${Number(maxHeight)}]` : '';
  return `(bv*${h}${NO_HLS},ba${NO_HLS})/b${h}${NO_HLS}/(bv*${h},ba)/b${h}/b`;
}

/** Etapa 1: yt-dlp baixa o(s) fluxo(s) para uma pasta de trabalho. */
function fetchStreams(job, id, url, workDir, format, maxHeight, withLogin, referer) {
  const video = format === 'video';
  // Capa: o Opus (Ogg) não guarda imagem pelo ffmpeg, então só M4A e MP3 pedem a miniatura.
  const cover = format === 'm4a' || format === 'mp3';
  const args = [
    ...jsRuntimeArgs,
    ...(withLogin ? ['--cookies', cookiesFile] : []),
    ...(referer ? ['--referer', referer] : []),
    '--no-playlist',
    '--no-simulate',
    '--progress',
    '--newline',
    '--encoding', 'utf-8',
    // Conexão parada por 30 s conta como queda: o yt-dlp tenta de novo sozinho (até 10×) e
    // continua de onde parou; se mesmo assim falhar, runJob reinicia o processo, que retoma o .part.
    '--socket-timeout', '30',
    '--retries', '10',
    '--retry-sleep', 'http:exp=1:10',
    // O YouTube limita a velocidade por conexão (~15 MB/s no vídeo). Como o IDM: o arquivo vira
    // pedaços (dashy) e 8 são baixados ao mesmo tempo. Medido: 15 → 67 MB/s; 16 não ganha mais.
    '--extractor-args', 'youtube:formats=dashy',
    '--concurrent-fragments', '8',
    '--fragment-retries', '10',
    ...(video
      ? ['-S', VIDEO_SORT, '-f', siteOf(url) === 'instagram' ? instagramVideoSelect(maxHeight) : videoSelect(maxHeight)]
      : ['-f', FORMATS[format].select]),
    '--ffmpeg-location', ffmpegPath,
    '-o', path.join(workDir, '%(id)s.%(format_id)s.%(ext)s'),
    ...(cover
      ? ['--write-thumbnail', '--convert-thumbnails', 'jpg', '-o', `thumbnail:${path.join(workDir, '%(id)s.thumb.%(ext)s')}`]
      : []),
    '--progress-template',
    'download:YTA_PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--print', 'before_dl:YTA_META %(.{id,extractor,title,description,uploader,channel,artist,duration,upload_date,webpage_url,acodec,vcodec,height,filesize,filesize_approx})j',
    '--print', 'after_move:YTA_FILE %(filepath)s',
    url,
  ];
  const progress = throttled((p) => send('job-event', { id, type: 'progress', stage: 'download', ...p }));

  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath, args, {
      windowsHide: true,
      env: ytdlpEnv,
    });
    job.child = child;
    let stderr = '';
    let meta = null;
    let current = null; // fluxo sendo baixado agora
    // Por item baixado, na ordem: um vídeo do YouTube é um item; um carrossel do Instagram, vários.
    const entries = []; // [{ meta, streams: [{ file, hasVideo, hasAudio, height }] }]

    onLines(child.stdout, (line) => {
      if (line.startsWith('YTA_META ')) {
        let m;
        try {
          m = JSON.parse(line.slice('YTA_META '.length));
        } catch {
          m = {};
        }
        let entry = entries.find((e) => e.meta.id === m.id);
        if (!entry) entries.push((entry = { meta: m, streams: [] }));
        current = {
          entry,
          // Codec desconhecido (null) conta como presente: as versões progressivas do Instagram não o informam.
          hasVideo: m.vcodec !== 'none',
          hasAudio: m.acodec !== 'none',
          height: num(m.height),
          acodec: m.acodec,
          // Tamanho que o YouTube informa para o formato; em pedaços o yt-dlp só estima o total.
          size: num(m.filesize) ?? num(m.filesize_approx),
        };
        if (!meta) {
          meta = m;
          send('job-event', { id, type: 'meta', title: m.title || null, duration: num(m.duration) });
        }
        // Em vídeo, cada fluxo tem a sua barra: "Baixando vídeo" e depois "Baixando áudio".
        const part = !video ? null : current.hasVideo ? 'video' : 'audio';
        if (current.hasVideo) send('job-event', { id, type: 'resolution', height: current.height });
        send('job-event', { id, type: 'progress', stage: 'download', part, percent: 0, done: 0, size: null, speed: null, eta: null });
      } else if (line.startsWith('YTA_PROGRESS ')) {
        const [done, total, estimate, speed, eta] = line.slice('YTA_PROGRESS '.length).split(' ').map(num);
        const known = current?.size;
        const size = total ?? known ?? estimate;
        const percent = done !== null && size ? Math.min(100, (done / size) * 100) : null;
        // Com o tamanho real, o tempo restante sai dele (a estimativa do yt-dlp oscila em pedaços).
        const left = known && total === null && speed ? Math.max(0, (known - done) / speed) : eta;
        progress({ percent, done: done !== null && size ? Math.min(done, size) : done, size, speed, eta: left }, percent === 100);
      } else if (line.startsWith('YTA_FILE ') && current) {
        const { entry, ...stream } = current;
        entry.streams.push({ ...stream, file: line.slice('YTA_FILE '.length) });
      }
    });
    child.stderr.on('data', (c) => (stderr = (stderr + c.toString('utf8')).slice(-20_000)));
    child.on('error', (err) => reject(new Error(`Não foi possível iniciar o yt-dlp: ${err.message}`)));
    child.on('close', (code) => {
      if (job.cancelled) reject(new Cancelled());
      else if (code === 0 && entries.some((e) => e.streams.length)) resolve({ entries: entries.filter((e) => e.streams.length) });
      else reject(Object.assign(new Error(friendlyError(stderr)), { stderr, retryable: isRetryable(stderr), needsLogin: needsLogin(stderr) }));
    });
  });
}

const isInstagram = (meta) => /instagram/i.test(meta.extractor || '');

/** Nome do arquivo: o título; no Instagram ("Video by fulano") vira "conta - código do post". */
function fileTitle(meta) {
  if (isInstagram(meta)) return `${meta.channel || meta.uploader || 'instagram'} - ${meta.id}`;
  return meta.title || 'video';
}

function tagArgs(meta) {
  const year = /^\d{4}/.test(meta.upload_date || '') ? meta.upload_date.slice(0, 4) : null;
  // No Instagram o título útil é a primeira linha da legenda.
  const caption = isInstagram(meta) ? (meta.description || '').split(/\r?\n/)[0].slice(0, 120).trim() : '';
  return [
    ['title', caption || (isInstagram(meta) ? fileTitle(meta) : meta.title)],
    ['artist', isInstagram(meta) ? meta.channel || meta.uploader : meta.artist || meta.uploader],
    ['date', year],
    ['comment', meta.webpage_url],
  ]
    .filter(([, v]) => v)
    .flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
}

/** Etapa 2: ffmpeg grava o arquivo final (cópia, junção ou conversão), com progresso real. */
function finish(job, id, { inputs, output, duration, copy, label }, out) {
  const args = [
    '-hide_banner', '-nostats', '-y',
    ...inputs.flatMap((f) => ['-i', f]),
    ...output,
    '-progress', 'pipe:1',
    `${out}.part`,
  ];
  const progress = throttled((p) => send('job-event', { id, type: 'progress', stage: 'convert', copy, ...p }));
  send('job-event', { id, type: 'progress', stage: 'convert', copy, percent: duration ? 0 : null, speed: null });

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    job.child = child;
    let stderr = '';
    let speed = null;
    onLines(child.stdout, (line) => {
      const [key, value] = line.split('=');
      if (key === 'speed') speed = num(value?.replace('x', ''));
      if (key === 'out_time_us') {
        const t = num(value);
        if (t === null) return; // ffmpeg ainda não sabe o tempo; mantém o último percentual
        const elapsed = Math.max(0, t / 1e6); // no começo o ffmpeg informa tempo negativo
        // ETA = mídia que falta ÷ velocidade (em "× o tempo real").
        const eta = duration && speed ? Math.max(0, (duration - elapsed) / speed) : null;
        progress({ percent: duration ? Math.min(100, (elapsed / duration) * 100) : null, speed, eta });
      }
      if (key === 'progress' && value === 'end') progress({ percent: 100, speed, eta: 0 }, true);
    });
    child.stderr.on('data', (c) => (stderr = (stderr + c.toString('utf8')).slice(-4000)));
    child.on('error', (err) => reject(new Error(`Não foi possível iniciar o ffmpeg: ${err.message}`)));
    child.on('close', (code) => {
      if (job.cancelled) return reject(new Cancelled());
      if (code !== 0) {
        const last = stderr.trim().split(/\r?\n/).pop() || '';
        return reject(new Error(/permission denied/i.test(last)
          ? 'Sem permissão para gravar na pasta escolhida.'
          : /no space left/i.test(last)
            ? 'Sem espaço no disco de destino.'
            : `A gravação do ${label} falhou (${last || `código ${code}`}).`));
      }
      try {
        fs.renameSync(`${out}.part`, out);
        resolve(out);
      } catch (err) {
        reject(new Error(`Não foi possível salvar o arquivo: ${err.message}`));
      }
    });
  });
}

/** Monta a etapa 2 de cada formato. */
/** Codecs reais de um arquivo (o yt-dlp não sabe os das versões progressivas do Instagram). */
function fileCodecs(file) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true }, (_err, _out, stderr) => {
      resolve({
        video: (String(stderr).match(/Stream #\S+.*?: Video: (\w+)/) || [])[1] || null,
        audio: (String(stderr).match(/Stream #\S+.*?: Audio: (\w+)/) || [])[1] || null,
        tenBit: /Video: .*(10le|10be|p010)/.test(String(stderr)),
      });
    });
  });
}

/**
 * Encoder de H.264: placa de vídeo quando houver (bem mais rápido em 4K), senão o processador.
 * Testado uma vez por sessão com um vídeo sintético de meio segundo.
 */
const H264_ENCODERS = [
  ['h264_nvenc', ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-pix_fmt', 'yuv420p', '-profile:v', 'high']],
  ['h264_qsv', ['-c:v', 'h264_qsv', '-global_quality', '21', '-pix_fmt', 'nv12', '-profile:v', 'high']],
  ['h264_amf', ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high']],
  ['libx264', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high']],
];
let h264Encoder = null;
function pickH264Encoder() {
  if (h264Encoder) return h264Encoder;
  h264Encoder = (async () => {
    for (const [name, args] of H264_ENCODERS) {
      const ok = await new Promise((resolve) => {
        execFile(
          ffmpegPath,
          ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '0.5', ...args, '-f', 'null', '-'],
          { windowsHide: true, timeout: 20_000 },
          (err) => resolve(!err),
        );
      });
      if (ok) return args;
    }
    return H264_ENCODERS.at(-1)[1];
  })();
  return h264Encoder;
}

async function plan(format, bitrate, streams, meta, compat, cover) {
  const duration = num(meta.duration);
  if (format === 'video') {
    const v = streams.find((s) => s.hasVideo) || streams[0];
    const a = streams.find((s) => s !== v && s.hasAudio);
    const inputs = a ? [v.file, a.file] : [v.file];
    // "Converter para H.264": só recodifica o que não for H.264 (8 bits) / AAC — o WhatsApp
    // e aparelhos antigos recusam VP9/AV1, HDR de 10 bits e Opus dentro do MP4.
    let videoCodec = ['-c:v', 'copy'];
    let audioCodec = ['-c:a', 'copy'];
    if (compat) {
      const vc = await fileCodecs(v.file);
      const ac = a ? await fileCodecs(a.file) : vc;
      if (vc.video !== 'h264' || vc.tenBit) {
        videoCodec = await pickH264Encoder();
      }
      if (ac.audio && ac.audio !== 'aac') audioCodec = ['-c:a', 'aac', '-b:a', '192k'];
    }
    const copy = videoCodec[1] === 'copy' && audioCodec[1] === 'copy';
    return {
      inputs,
      output: [
        '-map', '0:v:0', '-map', a ? '1:a:0' : '0:a:0?',
        ...videoCodec, ...audioCodec, '-map_metadata', '-1', ...tagArgs(meta),
        '-movflags', '+faststart', '-f', 'mp4',
      ],
      duration,
      copy,
      label: 'MP4',
    };
  }
  const spec = FORMATS[format];
  const src = streams[0];
  const copy = spec.original(src.acodec);
  const codec = copy ? ['-c:a', 'copy'] : typeof spec.encode === 'function' ? spec.encode(bitrate) : spec.encode;
  // Com capa: áudio + imagem (marcada como capa do álbum); sem ela, só o áudio.
  const coverArgs = !cover
    ? []
    : format === 'mp3'
      ? ['-c:v', 'copy', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
      : ['-c:v', 'copy', '-disposition:v:0', 'attached_pic'];
  return {
    inputs: cover ? [src.file, cover] : [src.file],
    output: [
      ...(cover ? ['-map', '0:a:0', '-map', '1:0'] : ['-vn']),
      '-map_metadata', '-1', ...tagArgs(meta), ...codec, ...coverArgs, ...spec.muxer,
    ],
    duration,
    copy,
    label: format.toUpperCase(),
  };
}

/** Miniatura baixada para este item (só existe nos formatos com capa e quando o site tem uma). */
function coverFor(workDir, meta) {
  const file = path.join(workDir, `${meta.id}.thumb.jpg`);
  return fs.existsSync(file) ? file : null;
}

async function runJob({ id, uid, key, prefix, url, folder, format, bitrate, maxHeight, compat, mediaUrl, referer, title }) {
  if (jobs.has(id)) return { ok: false, error: 'Esse item já está em andamento.' };
  if (format !== 'video' && !FORMATS[format]) return { ok: false, error: `Formato desconhecido: ${format}.` };
  const job = { child: null, cancelled: false, keepPartial: false, uid };
  jobs.set(id, job);
  // Pasta de trabalho do item (uid estável): um download interrompido ao fechar o app continua de
  // onde parou quando a fila volta. A limpeza é aguardada antes de responder, então um "Tentar de
  // novo" nunca começa enquanto a pasta da execução anterior está sendo apagada.
  const safeUid = /^[\w-]{4,64}$/.test(uid || '') ? uid : `${id}-${Date.now().toString(36)}`;
  const workDir = path.join(workRoot, safeUid);
  let out = null;
  try {
    if (!toolReady) prepareTool();
    await toolReady;
    if (job.cancelled) throw new Cancelled();
    if (!fs.existsSync(folder)) throw new Error('A pasta de destino não existe mais.');
    fs.mkdirSync(workDir, { recursive: true });

    let fetched;
    let withLogin = false; // o login só entra quando o site exige
    let source = url; // a página; o arquivo de vídeo detectado pela extensão é o plano B
    let usedMedia = false;
    const site = siteOf(url);
    for (let attempt = 1; ; attempt++) {
      try {
        fetched = await fetchStreams(job, id, source, workDir, format, maxHeight, withLogin, usedMedia ? referer || url : null);
        break;
      } catch (err) {
        if (!usedMedia && mediaUrl && /^https?:/i.test(mediaUrl) && NOT_FOUND.test(err.stderr || err.message)) {
          // O yt-dlp não reconheceu a página: baixa o arquivo que o navegador estava tocando (como o IDM).
          usedMedia = true;
          source = mediaUrl;
          attempt--;
          send('job-event', { id, type: 'retry', media: true });
          continue;
        }
        if (err.needsLogin && !withLogin && isLoggedIn(site)) {
          withLogin = true;
          attempt--; // a tentativa com login não conta como queda de conexão
          send('job-event', { id, type: 'retry', login: true });
          await freshCookies(site); // falha aqui vira erro do item ("login expirou")
          if (job.cancelled) throw new Cancelled();
          continue;
        }
        if (err.needsLogin) err.loginKind = withLogin ? 'refused' : 'required';
        if (err instanceof Cancelled || !err.retryable || attempt >= MAX_ATTEMPTS) throw err;
        send('job-event', { id, type: 'retry', attempt: attempt + 1, max: MAX_ATTEMPTS });
        await pause(job, RETRY_DELAYS[attempt - 1]);
        if (job.cancelled) throw new Cancelled();
      }
    }
    const ext = format === 'video' ? 'mp4' : format;
    const files = [];
    for (const { streams, meta } of fetched.entries) {
      // Arquivo direto (ex.: master.m3u8) não tem título: usa o da página.
      if (usedMedia && title) Object.assign(meta, { title, extractor: 'generic' });
      if (job.cancelled) throw new Cancelled();
      out = uniqueFile(folder, safeName(`${prefix || ''}${fileTitle(meta)}`), ext);
      reserved.add(out.toLowerCase());
      send('job-event', { id, type: 'target', file: out });
      await finish(job, id, await plan(format, bitrate, streams, meta, Boolean(compat), coverFor(workDir, meta)), out);
      reserved.delete(out.toLowerCase());
      files.push(out);
      out = null;
    }
    addHistory({ uid: safeUid, key, url, title: fetched.entries[0] ? fileTitle(fetched.entries[0].meta) : title || null, format, files });
    return { ok: true, file: files[0], files };
  } catch (err) {
    if (out) fs.rmSync(`${out}.part`, { force: true });
    if (err instanceof Cancelled) return { ok: false, cancelled: true };
    if (err.loginKind === 'refused') return { ok: false, error: 'O site recusou mesmo com login. Tente mais tarde.' };
    return { ok: false, error: err.message, needsLogin: err.loginKind === 'required' };
  } finally {
    if (out) reserved.delete(out.toLowerCase());
    // Ao sair do app no meio do download, os pedaços ficam para a fila retomar ao reabrir.
    // taskkill solta os arquivos de forma assíncrona; tenta de novo por alguns instantes.
    if (!job.keepPartial) {
      await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    }
    jobs.delete(id);
  }
}

/* ---------- Downloads em geral (o acelerador, como o IDM) ----------
 * Arquivos comuns (.zip, .exe, .iso, .pdf…) não passam pelo yt-dlp: o motor de electron/accel.cjs
 * divide em 8 conexões. Chegam pela captura da extensão (o download que o navegador ia fazer) ou
 * por um link direto colado no app. O que o navegador sabia (cookies, página, nome sugerido) fica
 * na pasta de trabalho do item, cifrado pelo Windows (safeStorage), para a retomada depois de
 * fechar o app ter o mesmo acesso. */
const CAPTURE_MIN = 1024 * 1024; // abaixo de 1 MB não há o que acelerar: fica com o navegador
const MIME_EXT = {
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/pdf': 'pdf',
  'application/x-msdownload': 'exe', 'application/x-msi': 'msi', 'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar', 'application/x-rar-compressed': 'rar', 'application/x-iso9660-image': 'iso',
  'application/gzip': 'gz', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'image/jpeg': 'jpg', 'image/png': 'png',
};

const workDirOf = (uid) => path.join(workRoot, uid);
const validUid = (uid) => /^[\w-]{4,64}$/.test(uid || '');
const readJsonFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Acesso do navegador (cookies, user agent, página, nome) guardado para o item. */
function saveFileRequest(workDir, req) {
  fs.mkdirSync(workDir, { recursive: true });
  const json = JSON.stringify(req);
  // Sem a cifra do Windows disponível, os cookies não vão para o disco (a retomada tenta sem eles).
  const data = safeStorage.isEncryptionAvailable()
    ? { enc: safeStorage.encryptString(json).toString('base64') }
    : { plain: { ...req, cookies: {} } };
  fs.writeFileSync(path.join(workDir, 'request.json'), JSON.stringify(data));
}
function readFileRequest(workDir) {
  const data = readJsonFile(path.join(workDir, 'request.json'));
  if (!data) return {};
  try {
    return data.enc ? JSON.parse(safeStorage.decryptString(Buffer.from(data.enc, 'base64'))) : data.plain || {};
  } catch {
    return {};
  }
}

/** "Relatório.tar.gz" → { base: "Relatório.tar", ext: "gz" }; sem extensão, tenta pelo tipo. */
function splitName(name, type) {
  const clean = path.basename(String(name || '').replace(/\\/g, '/')).trim();
  const m = /^(.+)\.([\w-]{1,12})$/.exec(clean);
  if (m) return { base: safeName(m[1]), ext: m[2].toLowerCase() };
  return { base: safeName(clean || 'download'), ext: MIME_EXT[type] || '' };
}

/** Apaga a pasta de trabalho do item e o .part que ela aponta (download geral pausado ou com erro). */
async function discardWork(uid) {
  const dir = workDirOf(uid);
  const target = readJsonFile(path.join(dir, 'target.json'));
  if (target?.part && /\.part$/.test(target.part)) await fs.promises.rm(target.part, { force: true }).catch(() => {});
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}

/** Pasta dos downloads gerais: a lembrada na janela "Baixar arquivo", se ainda existir; senão Downloads. */
function defaultFileFolder() {
  const kept = bridge.downloadPrefs().fileFolder;
  try {
    if (kept && fs.statSync(kept).isDirectory()) return kept;
  } catch {}
  return app.getPath('downloads');
}

async function runFileJob({ id, uid, key, url, folder, title, fileName }) {
  if (jobs.has(id)) return { ok: false, error: 'Esse item já está em andamento.' };
  const ctrl = new AbortController();
  const job = { child: null, cancelled: false, keepPartial: false, uid, abort: () => ctrl.abort() };
  jobs.set(id, job);
  const safeUid = validUid(uid) ? uid : `${id}-${Date.now().toString(36)}`;
  const workDir = workDirOf(safeUid);
  const targetFile = path.join(workDir, 'target.json');
  const stateFile = path.join(workDir, 'state.json');
  const dest = folder || defaultFileFolder();
  let out = null;
  let part = null;
  try {
    if (!fs.existsSync(dest)) throw new Error('A pasta de destino não existe mais.');
    fs.mkdirSync(workDir, { recursive: true });
    const req = readFileRequest(workDir);
    const opts = { cookies: req.cookies || {}, userAgent: req.userAgent || null, referer: req.referer || null };
    // Endereços: o direto (o que o navegador baixava; em CDNs é assinado e expira em ~1 h) e o
    // original (ex.: github.com/…/releases/download/…), que leva a um direto novo.
    const sources = [...new Set([req.directUrl, url].filter((u) => /^https?:\/\//i.test(u || '')))];
    let src = sources[0];
    let nextSource = 1;
    const expired = (err) => err instanceof accel.HttpError && [401, 403, 404, 410].includes(err.status);
    const target = readJsonFile(targetFile);
    let info = null;
    if (target?.out && target.part && fs.existsSync(target.part)) {
      ({ out, part } = target); // retomada: mesmo arquivo de antes
    } else {
      for (;;) {
        try {
          info = await accel.probe(src, opts, ctrl.signal);
          break;
        } catch (err) {
          if (!expired(err) || nextSource >= sources.length) throw err;
          src = sources[nextSource++];
        }
      }
      if (info.type === 'text/html' && !req.name) throw new Error('O link é de uma página, não de um arquivo.');
      const { base, ext } = splitName(fileName || req.name || info.name || title || 'download', info.type);
      out = uniqueFile(dest, base, ext);
      part = `${out}.part`;
      fs.writeFileSync(targetFile, JSON.stringify({ out, part }));
    }
    reserved.add(out.toLowerCase());
    send('job-event', { id, type: 'meta', title: path.basename(out), duration: null });
    send('job-event', { id, type: 'target', file: out });
    if (info?.size) {
      const st = await fs.promises.statfs(dest).catch(() => null);
      if (st && st.bavail * st.bsize < info.size) {
        throw new Error(`Sem espaço no disco: o arquivo tem ${(info.size / 1024 ** 3).toFixed(1)} GB.`);
      }
    }
    const progress = throttled((p) => send('job-event', { id, type: 'progress', stage: 'download', percent: p.size ? Math.min(100, (p.done / p.size) * 100) : null, ...p }));
    for (let restart = 0; ; ) {
      try {
        await accel.download({ url: src, opts, part, stateFile, signal: ctrl.signal, onProgress: progress });
        break;
      } catch (err) {
        if (job.cancelled) throw err;
        // Arquivo trocado no servidor desde a pausa: recomeça do zero uma vez.
        if (err instanceof accel.RangeIgnored && restart++ === 0) {
          fs.rmSync(stateFile, { force: true });
          continue;
        }
        // Endereço direto expirou (pausa longa): segue pelo original, dos mesmos pedaços.
        if (expired(err) && nextSource < sources.length) {
          src = sources[nextSource++];
          continue;
        }
        throw err;
      }
    }
    if (job.cancelled) throw new Cancelled();
    fs.renameSync(part, out);
    accel.markOfTheWeb(out, { url: src, referer: opts.referer });
    addHistory({ uid: safeUid, key, url, title: path.basename(out), format: 'file', files: [out] });
    return { ok: true, file: out, files: [out] };
  } catch (err) {
    if (job.cancelled) {
      if (!job.keepPartial && part) fs.rmSync(part, { force: true });
      return { ok: false, cancelled: true };
    }
    // Erro: guarda os pedaços; "Tentar de novo" continua deles ("Tirar da fila" apaga).
    if (part && fs.existsSync(part)) job.keepPartial = true;
    const msg = /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|getaddrinfo/i.test(`${err.message} ${err.cause?.code || ''}`)
      ? 'Sem conexão com o site. Verifique a internet.'
      : /EACCES|EPERM/.test(err.code || '') ? 'Sem permissão para gravar na pasta.'
      : /ENOSPC/.test(err.code || '') ? 'Sem espaço no disco de destino.'
      : err.message;
    return { ok: false, error: msg };
  } finally {
    if (out) reserved.delete(out.toLowerCase());
    if (!job.keepPartial) await discardWork(safeUid);
    jobs.delete(id);
  }
}

/**
 * Captura do navegador: a extensão segura o download e pergunta. O YTA só assume o que dá para
 * acelerar (o servidor aceita pedaços, 1 MB ou mais, não é página); o resto segue no navegador.
 */
async function captureDownload(body) {
  // url: o endereço original do download (identifica o item: "já baixado", "Baixar de novo");
  // finalUrl: aonde ele levou (o arquivo em si; pode ser assinado e temporário).
  const url = String(body?.url || '');
  const direct = /^https?:\/\//i.test(body?.finalUrl || '') ? String(body.finalUrl) : url;
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'Endereço não suportado.' };
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const cookies = {};
  for (const [host, value] of Object.entries(body.cookies || {}).slice(0, 10)) {
    if (/^[\w.-]+$/.test(host) && typeof value === 'string') cookies[host] = value.slice(0, 16_000);
  }
  const opts = { cookies, userAgent: str(body.userAgent, 400), referer: /^https?:/i.test(body.referrer || '') ? str(body.referrer, 2000) : null };
  let info;
  try {
    info = await accel.probe(direct, opts, AbortSignal.timeout(10_000));
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  if (info.type === 'text/html') return { ok: false, reason: 'É uma página, não um arquivo.' };
  if (!info.ranges) return { ok: false, reason: 'O servidor não aceita pedaços (não há o que acelerar).' };
  if (info.size < CAPTURE_MIN) return { ok: false, reason: 'Arquivo pequeno.' };
  const name = str(body.filename, 255)?.split(/[\\/]/).pop() || info.name || null;
  const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  saveFileRequest(workDirOf(uid), { ...opts, name, directUrl: direct !== url ? direct : null });
  return { ok: true, request: { kind: 'file', url, uid, title: name, size: info.size } };
}

/* ---------- Janelas do acelerador ("Baixar arquivo" e a de andamento, como no IDM) ----------
 * Janelas pequenas, uma por download; a página é a mesma do app (#ask/#progress,
 * src/DownloadDialog.jsx). Nascem escondidas e aparecem quando a página informa a altura.
 * - "ask": por cima de tudo e com o foco (Enter baixa);
 * - "progress": aparece na frente sem roubar o foco (quem clicou no vídeo segue no navegador), por
 *   cima só nos primeiros segundos, em cascata; no máximo 3 abertas — as demais só na fila. */
const DIALOG_WIDTH = 480;
const PROGRESS_MAX = 3;
const dialogs = new Map(); // webContents.id → { data, resolve, focus, slot }
const progressWins = new Map(); // id do item na fila → { w, last, doneSize }

function openDialog(kind, data, { focus = true, slot = 0, onWindow } = {}) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      useContentSize: true,
      width: DIALOG_WIDTH,
      height: 200,
      resizable: false,
      minimizable: kind === 'progress',
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: kind === 'ask' ? 'Baixar arquivo' : 'Baixando',
      icon: path.join(__dirname, 'tray.png'),
      backgroundColor: '#121316',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
    });
    const id = w.webContents.id;
    dialogs.set(id, { data, resolve, focus, slot });
    onWindow?.(w);
    w.setMenu(null);
    w.on('page-title-updated', (e) => e.preventDefault()); // o <title> da página é "YTA"
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('closed', () => {
      // Fechada pelo X: conta como cancelar.
      const d = dialogs.get(id);
      dialogs.delete(id);
      d?.resolve({ action: 'cancel' });
    });
    // Se a página não informar a altura (erro), aparece assim mesmo.
    setTimeout(() => !w.isDestroyed() && !w.isVisible() && showDialog(w, { focus, slot }), 3000);
    w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: kind });
  });
}
function showDialog(w, { focus, slot }) {
  w.center();
  if (slot) {
    const [x, y] = w.getPosition();
    w.setPosition(x + slot * 28, y + slot * 28); // cascata: uma não cobre a outra inteira
  }
  if (focus) {
    w.show();
    w.focus();
    return;
  }
  w.showInactive();
  setTimeout(() => !w.isDestroyed() && w.setAlwaysOnTop(false), 3000);
}

ipcMain.handle('dialog-data', (e) => dialogs.get(e.sender.id)?.data ?? null);
ipcMain.handle('dialog-answer', (e, answer) => {
  const d = dialogs.get(e.sender.id);
  dialogs.delete(e.sender.id);
  d?.resolve(answer && typeof answer === 'object' ? answer : { action: 'cancel' });
  BrowserWindow.fromWebContents(e.sender)?.close();
});
ipcMain.on('dialog-fit', (e, height) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !dialogs.has(e.sender.id) || !(height > 0 && height < 1000)) return;
  w.setContentSize(DIALOG_WIDTH, Math.ceil(height));
  if (!w.isVisible()) showDialog(w, dialogs.get(e.sender.id));
});
// "Nome.zip" já existe na pasta? Devolve o nome que vai sair ("Nome (2).zip").
ipcMain.handle('dialog-name-free', (_e, folder, name) => {
  if (typeof folder !== 'string' || typeof name !== 'string') return null;
  const { base, ext } = splitName(name);
  const file = uniqueFile(folder, base, ext);
  const wanted = path.join(folder, ext ? `${base}.${ext}` : base);
  return { free: file.toLowerCase() === wanted.toLowerCase(), next: path.basename(file) };
});
ipcMain.handle('open-file', (_e, file) => typeof file === 'string' && fs.existsSync(file) && shell.openPath(file));
ipcMain.handle('download-prefs-set', (_e, patch) => bridge.setDownloadPrefs(patch));

/** Download capturado com "Perguntar onde salvar": a janela decide nome e pasta antes da fila. */
async function askDownload(request) {
  let host = '';
  try {
    host = new URL(request.url).hostname.replace(/^www\./, '');
  } catch {}
  const answer = await openDialog('ask', { name: request.title || 'download', size: request.size, host, folder: defaultFileFolder() });
  if (answer.action !== 'download' || typeof answer.folder !== 'string' || !fs.existsSync(answer.folder)) {
    return discardWork(request.uid);
  }
  bridge.setDownloadPrefs({ ...(answer.dontAsk ? { askSave: false } : {}), ...(answer.remember ? { fileFolder: answer.folder } : {}) });
  const { base, ext } = splitName(String(answer.name || request.title || 'download'));
  const fileName = ext ? `${base}.${ext}` : base;
  const r = await bridge.enqueue({ ...request, title: fileName, fileName, folder: answer.folder });
  if (!r.ok) discardWork(request.uid);
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Item que veio do navegador entrou na fila: abre a janela de andamento (se a preferência
 * permitir e houver vaga). Devolve se abriu — sem janela, a ponte avisa por notificação.
 */
function openProgress(item) {
  if (!bridge.downloadPrefs().showProgress) return false;
  if (progressWins.has(item.id)) return true;
  if (progressWins.size >= PROGRESS_MAX) return false;
  const entry = { w: null, last: null, doneSize: undefined };
  progressWins.set(item.id, entry);
  const data = {
    id: item.id,
    kind: item.kind === 'file' ? 'file' : 'video',
    format: item.kind === 'file' ? 'file' : item.format || 'm4a',
    phase: 'queued',
    title: item.title || null,
    url: item.url,
    host: hostOf(item.url),
    folder: item.folder || (item.kind === 'file' ? defaultFileFolder() : null),
  };
  openDialog('progress', data, {
    focus: false,
    slot: progressWins.size - 1,
    onWindow: (w) => {
      entry.w = w;
      w.on('closed', () => progressWins.delete(item.id));
    },
  });
  return true;
}
const hasProgress = (id) => Boolean(progressWins.get(id)?.w && !progressWins.get(id).w.isDestroyed());

/** Estado da fila (a cada mudança): atualiza as janelas de andamento abertas. */
function progressUpdate(list) {
  for (const [id, entry] of progressWins) {
    const w = entry.w;
    if (!w || w.isDestroyed()) continue;
    const it = list.find((x) => x.id === id);
    if (!it || it.phase === 'cancelled') {
      w.close(); // cancelado ou tirado da fila
      continue;
    }
    if (it.phase === 'done' && entry.doneSize === undefined) {
      entry.doneSize = (it.files || [it.file]).filter(Boolean).reduce((sum, f) => {
        try {
          return sum + fs.statSync(f).size;
        } catch {
          return sum;
        }
      }, 0) || null;
    }
    const payload = {
      ...it,
      host: hostOf(it.url),
      folder: it.file ? path.dirname(it.file) : it.folder || (it.kind === 'file' ? defaultFileFolder() : null),
      doneSize: entry.doneSize ?? null,
    };
    const key = JSON.stringify(payload);
    if (key === entry.last) continue;
    entry.last = key;
    w.webContents.send('progress-update', payload);
    const name = it.title || hostOf(it.url);
    w.setTitle(
      it.phase === 'done' ? `Concluído · ${name}`
      : it.phase === 'error' ? `Falhou · ${name}`
      : it.phase === 'paused' ? `Pausado · ${name}`
      : it.percent != null && ['download', 'convert'].includes(it.phase) ? `${Math.floor(it.percent)}% · ${name}`
      : name,
    );
  }
}

// Botões da janela de andamento: quem manda na fila é a janela principal.
ipcMain.handle('item-action', (e, action) => {
  const id = [...progressWins].find(([, entry]) => entry.w && !entry.w.isDestroyed() && entry.w.webContents.id === e.sender.id)?.[0];
  if (id === undefined || !['pause', 'resume', 'cancel', 'retry'].includes(action)) return;
  win?.webContents.send('item-action', { id, action });
});

/* ---------- Histórico (o que já foi baixado) ---------- */
const historyFile = path.join(app.getPath('userData'), 'history.json');
const HISTORY_MAX = 1000;
let history = null;
let historyTimer = null;
function loadHistory() {
  if (history) return history;
  try {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  return history;
}
/** Gravação agrupada e fora da thread principal (vários itens terminam juntos). */
function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    historyTimer = null;
    fs.promises.writeFile(historyFile, JSON.stringify(history)).catch(() => {});
  }, 500);
}
function addHistory(entry) {
  const list = loadHistory();
  list.unshift({ ...entry, at: Date.now() });
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  saveHistory();
  send('history-changed');
}
/** Lista com "o arquivo ainda existe?" (o histórico guarda caminhos; arquivos podem ter sido apagados). */
function listHistory() {
  return loadHistory().map((h) => ({ ...h, exists: (h.files || []).some((f) => fs.existsSync(f)) }));
}
/** Quais destas chaves já foram baixadas (com arquivo ainda no disco). */
function checkHistory(keys) {
  const wanted = new Set(keys);
  const found = {};
  for (const h of loadHistory()) {
    if (!wanted.has(h.key) || found[h.key]) continue;
    if ((h.files || []).some((f) => fs.existsSync(f))) found[h.key] = { at: h.at, title: h.title };
  }
  return found;
}

/* ---------- Fila persistente (volta ao reabrir o app) ---------- */
const queueFile = path.join(app.getPath('userData'), 'queue.json');
let queuePending = null;
let queueTimer = null;
let queueFrozen = false; // saindo: os itens interrompidos viram "cancelado", e isso não pode ir para o disco
function saveQueue(list) {
  if (queueFrozen) return;
  queuePending = list;
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    const data = JSON.stringify(queuePending);
    queuePending = null;
    fs.promises.writeFile(queueFile, data).catch(() => {});
  }, 500);
}
function flushQueue() {
  if (!queuePending) return;
  clearTimeout(queueTimer);
  queueTimer = null;
  try {
    fs.writeFileSync(queueFile, JSON.stringify(queuePending));
  } catch {}
  queuePending = null;
}
function loadQueue() {
  try {
    const list = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* ---------- Playlists: só a lista (rápido), sem consultar cada vídeo ---------- */
const PLAYLIST_MAX = 1000;
function expandPlaylist(url, folder) {
  return (async () => {
    if (!toolReady) prepareTool();
    await toolReady;
    const json = await new Promise((resolve, reject) => {
      execFile(
        ytdlpPath,
        [...jsRuntimeArgs, '--flat-playlist', '--yes-playlist', '--no-warnings', '--encoding', 'utf-8', '-J', url],
        { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120_000, env: ytdlpEnv },
        (err, stdout, stderr) => (err ? reject(new Error(friendlyError(stderr || err.message))) : resolve(stdout)),
      );
    });
    const info = JSON.parse(json);
    const entries = (info.entries || [])
      .map((e) => ({ url: [e.url, e.webpage_url].find((u) => /^https?:\/\//.test(u || '')), title: e.title || null }))
      .filter((e) => e.url)
      .slice(0, PLAYLIST_MAX);
    if (!entries.length) throw new Error('A playlist está vazia ou é privada.');
    if (!fs.existsSync(folder)) throw new Error('A pasta de destino não existe mais.');
    const sub = path.join(folder, safeName(info.title || 'Playlist'));
    fs.mkdirSync(sub, { recursive: true });
    return { ok: true, title: info.title || 'Playlist', folder: sub, entries, total: (info.entries || []).length };
  })().catch((err) => ({ ok: false, error: err.message }));
}

/** Resoluções que o vídeo tem agora (consulta de ~3 s; guardada por vídeo durante a sessão). */
const probes = new Map();
function probe(url) {
  if (probes.has(url)) return probes.get(url);
  const p = (async () => {
    if (!toolReady) prepareTool();
    await toolReady;
    const ask = (withLogin) =>
      new Promise((resolve, reject) => {
        execFile(
          ytdlpPath,
          [...jsRuntimeArgs, ...(withLogin ? ['--cookies', cookiesFile] : []), '--no-playlist', '--no-warnings', '--encoding', 'utf-8', '-J', url],
          { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 60_000, env: ytdlpEnv },
          (err, stdout, stderr) =>
            err
              ? reject(Object.assign(new Error(friendlyError(stderr || err.message)), { needsLogin: needsLogin(stderr || '') }))
              : resolve(stdout),
        );
      });
    const json = await ask(false).catch((err) => {
      if (err.needsLogin && isLoggedIn(siteOf(url))) return freshCookies(siteOf(url)).then(() => ask(true));
      throw err;
    });
    const info = JSON.parse(json);
    const heights = [...new Set((info.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
      .map((f) => f.height))].sort((a, b) => b - a);
    return { ok: true, title: info.title || null, heights };
  })().catch((err) => {
    probes.delete(url); // falha não fica guardada
    return { ok: false, error: err.message };
  });
  probes.set(url, p);
  return p;
}

/*
 * Login do YouTube pelo Chrome (ou Edge) de verdade, num perfil só do YTA:
 * - O Google recusa login em janela embutida (Electron), mas aceita no navegador normal.
 * - O yt-dlp não consegue ler os cookies do Chrome/Edge no Windows (criptografia app-bound),
 *   então quem lê é o próprio navegador: o app reabre o perfil invisível e pede os cookies (CDP).
 * - O Chrome pode prender a sessão ao dispositivo e encurtar os cookies; por isso eles são
 *   renovados (visita ao YouTube no perfil invisível) a cada vez que o login for necessário.
 */
const loginProfile = path.join(app.getPath('userData'), 'login-browser');
const loginInfoFile = path.join(app.getPath('userData'), 'login.json');
// Uma aba por site; o usuário entra nos que quiser.
const LOGIN_URLS = [
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  'https://www.instagram.com/accounts/login/',
];
// Cookies que só existem com a conta conectada, por site.
const SITES = {
  youtube: { domain: /(^|\.)youtube\.com$/, cookies: ['LOGIN_INFO', 'SAPISID', '__Secure-3PSID'], visit: 'https://www.youtube.com/' },
  instagram: { domain: /(^|\.)instagram\.com$/, cookies: ['sessionid'], visit: null },
};

function findBrowser() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    ['Chrome', path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Chrome', path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Chrome', path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Edge', path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Edge', path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
  ];
  const found = candidates.find(([, exe]) => fs.existsSync(exe));
  return found ? { name: found[0], exe: found[1] } : null;
}

function loginInfo() {
  try {
    const info = JSON.parse(fs.readFileSync(loginInfoFile, 'utf8'));
    // login.json da versão anterior (só YouTube) não tinha a lista de sites.
    if (!info.sites) info.sites = { youtube: true };
    return info;
  } catch {
    return null;
  }
}

/** Conectado a um site (ou a algum, sem argumento). */
function isLoggedIn(site) {
  if (site && !SITES[site]) return fs.existsSync(loginProfile); // outros sites: tenta com o perfil
  const info = loginInfo();
  if (!info || !fs.existsSync(loginProfile)) return false;
  return site ? Boolean(info.sites?.[site]) : Object.values(info.sites || {}).some(Boolean);
}

/** Cookies do domínio do site (para "outros sites": qualquer cookie dele conta como sessão). */
const hasDomainCookies = (cookies, site) =>
  cookies.some((c) => c.domain.replace(/^\./, '') === site || c.domain.replace(/^\./, '').endsWith(`.${site}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Abre o perfil invisível, (opcionalmente) visita o YouTube e devolve todos os cookies. */
async function readBrowserCookies(exe, { visit = null } = {}) {
  const portFile = path.join(loginProfile, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const child = spawn(exe, [
    '--headless=new',
    `--user-data-dir=${loginProfile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { windowsHide: true });
  try {
    let lines = null;
    for (let i = 0; i < 80 && !lines; i++) {
      await sleep(250);
      if (fs.existsSync(portFile)) lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    }
    if (!lines) throw new Error('O navegador não abriu o perfil de login. Feche janelas dele abertas pelo YTA e tente de novo.');
    const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('Sem conexão com o navegador.')));
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => pending.delete(id) && reject(new Error('O navegador do login não respondeu.')), 15_000);
      });
    if (visit) {
      // Visita o YouTube para o navegador renovar a sessão antes de entregar os cookies.
      await call('Target.createTarget', { url: visit });
      await sleep(3500);
    }
    const res = await call('Storage.getCookies');
    await call('Browser.close'); // saída limpa: o perfil grava o que renovou
    await Promise.race([new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r))), sleep(10_000)]);
    return res.result?.cookies || [];
  } finally {
    if (isAlive(child)) killTree(child.pid);
  }
}

/** Grava os cookies do perfil do YTA (só tem os sites em que você entrou) no formato do yt-dlp. */
function writeCookiesFile(cookies) {
  const mine = cookies;
  const lines = mine.map((c) => {
    const domain = c.domain;
    return [
      domain,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      c.expires && c.expires > 0 ? Math.floor(c.expires) : 0,
      c.name,
      c.value,
    ].join('\t');
  });
  fs.writeFileSync(cookiesFile, ['# Netscape HTTP Cookie File', ...lines, ''].join('\n'), { mode: 0o600 });
}

const hasLogin = (cookies, site) =>
  cookies.some((c) => SITES[site].domain.test(c.domain.replace(/^\./, '')) && SITES[site].cookies.includes(c.name));
const loggedSites = (cookies) => Object.fromEntries(Object.keys(SITES).map((site) => [site, hasLogin(cookies, site)]));

/** Cookies recém-renovados para o yt-dlp. Itens em paralelo compartilham a mesma renovação. */
const refreshing = {};
const refreshedAt = {};
let browserBusy = Promise.resolve(); // um perfil só abre uma vez por vez
function freshCookies(site) {
  if (refreshing[site]) return refreshing[site];
  if (Date.now() - (refreshedAt[site] || 0) < 60_000 && fs.existsSync(cookiesFile)) return Promise.resolve();
  const run = browserBusy.then(async () => {
    const exe = loginInfo()?.exe || findBrowser()?.exe;
    if (!exe || !fs.existsSync(exe)) throw new Error('O navegador do login não foi encontrado. Entre de novo.');
    const cookies = await readBrowserCookies(exe, { visit: SITES[site]?.visit || null });
    if (SITES[site] && !hasLogin(cookies, site)) {
      throw Object.assign(new Error(`O login do ${site === 'instagram' ? 'Instagram' : 'YouTube'} expirou. Entre de novo.`), { loginKind: 'required' });
    }
    if (!SITES[site] && !hasDomainCookies(cookies, site)) {
      throw Object.assign(new Error(`Este site exige login. Entre na sua conta de ${site} pelo YTA e tente de novo.`), { loginKind: 'required' });
    }
    writeCookiesFile(cookies);
    refreshedAt[site] = Date.now();
  });
  browserBusy = run.catch(() => {});
  refreshing[site] = run.finally(() => {
    refreshing[site] = null;
  });
  return refreshing[site];
}

let loginRun = null;
/** extraUrl: site de um item que pediu login (abre numa aba a mais, além de YouTube e Instagram). */
function openLogin(extraUrl) {
  if (loginRun) return loginRun;
  loginRun = (async () => {
    const browser = findBrowser();
    if (!browser) return { loggedIn: isLoggedIn(), error: 'Nenhum Chrome ou Edge encontrado.' };
    send('login-state', { state: 'waiting', browser: browser.name });
    // Janela normal do navegador, perfil só do YTA. Termina quando o usuário fecha a janela.
    await new Promise((resolve) => {
      const child = spawn(browser.exe, [
        `--user-data-dir=${loginProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        ...LOGIN_URLS,
        ...(extraUrl && !SITES[siteOf(extraUrl)] ? [new URL(extraUrl).origin] : []),
      ]);
      child.once('exit', resolve);
      child.once('error', resolve);
    });
    send('login-state', { state: 'checking', browser: browser.name });
    await sleep(1000); // o navegador termina de gravar o perfil
    const cookies = await readBrowserCookies(browser.exe);
    const sites = loggedSites(cookies);
    const extraOk = extraUrl && !SITES[siteOf(extraUrl)] && hasDomainCookies(cookies, siteOf(extraUrl));
    if (!Object.values(sites).some(Boolean) && !extraOk) return { loggedIn: isLoggedIn(), sites: loginInfo()?.sites || {}, error: 'O login não foi concluído.' };
    writeCookiesFile(cookies);
    for (const site of Object.keys(sites)) if (sites[site]) refreshedAt[site] = Date.now();
    fs.writeFileSync(loginInfoFile, JSON.stringify({ browser: browser.name, exe: browser.exe, sites }));
    return { loggedIn: true, sites, extraOk: Boolean(extraOk), browser: browser.name };
  })()
    .catch((err) => ({ loggedIn: isLoggedIn(), error: err.message }))
    .finally(() => {
      loginRun = null;
      send('login-state', { state: 'idle' });
    });
  return loginRun;
}

async function logout() {
  fs.rmSync(cookiesFile, { force: true });
  fs.rmSync(loginInfoFile, { force: true });
  fs.rmSync(loginProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { loggedIn: false, sites: {} };
}

/*
 * Atualização automática (como o TrueReplayer): ao abrir e a cada 4 h o app procura uma versão
 * nova, baixa em segundo plano e avisa a interface; "Reiniciar" instala na hora, senão instala
 * ao fechar. O feed é o latest.yml da release mais recente, lido pelo endereço fixo
 * releases/latest/download (sem a API do GitHub, que já devolveu lista vazia para o
 * TrueReplayer e não gasta o limite de 60 consultas/hora). Configurado em package.json > build.publish.
 */
let updateState = { state: 'idle', current: app.getVersion() };
function setUpdate(next) {
  updateState = { ...next, current: app.getVersion() };
  send('update-state', updateState);
}

function setupUpdater() {
  // Teste local: YTA_UPDATE_URL aponta para um servidor em localhost (nunca outro endereço).
  const testUrl = process.env.YTA_UPDATE_URL;
  const localTest = testUrl && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(testUrl);
  if (!app.isPackaged && !localTest) return;
  if (localTest) {
    autoUpdater.setFeedURL({ provider: 'generic', url: testUrl });
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => setUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', version: updateState.version, percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // Sem internet ou GitHub fora do ar: tenta de novo na próxima verificação, sem incomodar.
    console.warn('[update]', err?.message || err);
    if (updateState.state !== 'ready') setUpdate({ state: 'idle' });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

function installUpdate() {
  if (updateState.state !== 'ready') return;
  for (const id of jobs.keys()) cancelJob(id);
  // Instalação silenciosa e reabre o app já atualizado.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.cancelled = true;
  job.abort?.(); // acelerador: derruba as conexões
  if (isAlive(job.child)) killTree(job.child.pid);
}

function createWindow() {
  win = new BrowserWindow({
    // Tamanhos da área de conteúdo (sem a moldura do Windows). A altura mínima comporta o
    // formulário (310) + cabeçalho da fila (45) + 5 itens em andamento (5 × 57) + margem (12).
    useContentSize: true,
    width: 640,
    height: 652,
    minWidth: 560,
    minHeight: 652,
    title: 'YTA',
    icon: path.join(__dirname, 'tray.png'),
    show: false, // aparece em ready-to-show; aberto pela extensão, fica só na bandeja
    backgroundColor: '#121316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const hidden = bridge.startsHidden();
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  bridge.hideOnClose(win);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    prepareTool();
    setupUpdater();
  });
}

Menu.setApplicationMenu(null);

let rendererReady = false;
ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  bridge.flushRendererQueue();
});
ipcMain.handle('tool-status', () => toolStatus);
ipcMain.handle('default-folder', () => app.getPath('music'));
ipcMain.handle('pick-folder', async (e, start) => {
  // Da janela que pediu (a principal ou a "Baixar arquivo").
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || win, {
    title: 'Escolher pasta',
    defaultPath: start || app.getPath('music'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('folder-exists', (_e, p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
});
ipcMain.handle('run-job', (_e, opts) => (opts?.kind === 'file' ? runFileJob(opts) : runJob(opts)));
ipcMain.handle('probe', (_e, url) => probe(url));
ipcMain.handle('update-state', () => updateState);
ipcMain.handle('update-install', () => installUpdate());
ipcMain.handle('login-status', () => ({
  loggedIn: isLoggedIn(),
  sites: isLoggedIn() ? loginInfo()?.sites || {} : {},
  browser: loginInfo()?.browser || findBrowser()?.name || null,
}));
ipcMain.handle('login', (_e, url) => openLogin(url));
ipcMain.handle('logout', () => logout());
ipcMain.handle('cancel-job', (_e, id) => cancelJob(id));
// Pausar: para como o cancelar, mas guarda os pedaços (a pasta de trabalho do item) para retomar.
ipcMain.handle('pause-job', (_e, id) => {
  const job = jobs.get(id);
  if (!job) return;
  job.keepPartial = true;
  cancelJob(id);
});
ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('retry-tool', () => prepareTool().then(() => true, () => false));
ipcMain.handle('history-list', () => listHistory());
ipcMain.handle('history-check', (_e, keys) => checkHistory(Array.isArray(keys) ? keys : []));
ipcMain.handle('history-remove', (_e, uid) => {
  history = loadHistory().filter((h) => h.uid !== uid);
  saveHistory();
});
ipcMain.handle('history-clear', () => {
  history = [];
  saveHistory();
});
ipcMain.handle('queue-load', () => loadQueue());
ipcMain.handle('discard-work', (_e, uid) => {
  if (!validUid(uid) || [...jobs.values()].some((j) => j.uid === uid)) return;
  return discardWork(uid);
});
ipcMain.on('queue-save', (_e, list) => Array.isArray(list) && saveQueue(list));
ipcMain.handle('playlist-expand', (_e, url, folder) => expandPlaylist(url, folder));
// No Electron 44 a área de transferência é assíncrona (readText devolve uma promessa).
ipcMain.handle('clipboard-text', async () => String((await clipboard.readText()) || '').slice(0, 4000));
ipcMain.handle('special-folders', () => ({ music: app.getPath('music'), videos: app.getPath('videos') }));

if (!bridge.claimSingleInstance()) app.exit(0); // já há um YTA aberto: o pedido foi entregue a ele
app.setAppUserModelId('local.yta'); // notificações do Windows com o nome e o ícone do app

app.whenReady().then(() => {
  // Pastas de trabalho com mais de 3 dias são sobras; as recentes podem ser retomadas pela fila.
  fs.promises
    .readdir(workRoot, { withFileTypes: true })
    .then((dirs) =>
      Promise.all(
        dirs.map(async (d) => {
          const p = path.join(workRoot, d.name);
          const { mtimeMs } = await fs.promises.stat(p);
          if (Date.now() - mtimeMs > 3 * 24 * 60 * 60 * 1000) await discardWork(d.name); // e o .part do acelerador
        }),
      ),
    )
    .catch(() => {});
  // Login por janela embutida da versão anterior (o Google bloqueava); não é mais usado.
  fs.rm(path.join(app.getPath('userData'), 'Partitions', 'youtube-login'), { recursive: true, force: true }, () => {});
  createWindow();
  bridge.init({ getWin: () => win, probe, capture: captureDownload, askDownload, openProgress, hasProgress, progressUpdate, discardWork, rendererReady: () => rendererReady });
});
app.on('before-quit', () => {
  for (const [id, job] of jobs) {
    job.keepPartial = true; // a fila volta ao reabrir e retoma destes pedaços
    cancelJob(id);
  }
  flushQueue();
  queueFrozen = true;
});
app.on('window-all-closed', () => {
  for (const id of jobs.keys()) cancelJob(id);
  app.quit();
});
