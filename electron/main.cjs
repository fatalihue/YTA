const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const bridge = require('./bridge.cjs');

// Em pacote, o binário do ffmpeg-static fica fora do asar.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const binDir = path.join(app.getPath('userData'), 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp.exe');
const workRoot = path.join(app.getPath('temp'), 'yta');
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
  let candidate = path.join(folder, `${name}.${ext}`);
  const taken = (p) => reserved.has(p.toLowerCase()) || fs.existsSync(p) || fs.existsSync(`${p}.part`);
  for (let n = 2; taken(candidate); n++) {
    candidate = path.join(folder, `${name} (${n}).${ext}`);
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

async function plan(format, bitrate, streams, meta, compat) {
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
  return {
    inputs: [src.file],
    output: ['-vn', '-map_metadata', '-1', ...tagArgs(meta), ...codec, ...spec.muxer],
    duration,
    copy,
    label: format.toUpperCase(),
  };
}

async function runJob({ id, url, folder, format, bitrate, maxHeight, compat, mediaUrl, referer, title }) {
  if (jobs.has(id)) return { ok: false, error: 'Esse item já está em andamento.' };
  if (format !== 'video' && !FORMATS[format]) return { ok: false, error: `Formato desconhecido: ${format}.` };
  const job = { child: null, cancelled: false };
  jobs.set(id, job);
  const workDir = path.join(workRoot, `${id}-${Date.now().toString(36)}`);
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
      out = uniqueFile(folder, safeName(fileTitle(meta)), ext);
      reserved.add(out.toLowerCase());
      send('job-event', { id, type: 'target', file: out });
      await finish(job, id, await plan(format, bitrate, streams, meta, Boolean(compat)), out);
      reserved.delete(out.toLowerCase());
      files.push(out);
      out = null;
    }
    return { ok: true, file: files[0], files };
  } catch (err) {
    if (out) fs.rmSync(`${out}.part`, { force: true });
    if (err instanceof Cancelled) return { ok: false, cancelled: true };
    if (err.loginKind === 'refused') return { ok: false, error: 'O site recusou mesmo com login. Tente mais tarde.' };
    return { ok: false, error: err.message, needsLogin: err.loginKind === 'required' };
  } finally {
    if (out) reserved.delete(out.toLowerCase());
    jobs.delete(id);
    // taskkill solta os arquivos de forma assíncrona; tenta de novo por alguns instantes.
    fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }, () => {});
  }
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
ipcMain.handle('pick-folder', async (_e, start) => {
  const r = await dialog.showOpenDialog(win, {
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
ipcMain.handle('run-job', (_e, opts) => runJob(opts));
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
ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('retry-tool', () => prepareTool().then(() => true, () => false));

if (!bridge.claimSingleInstance()) app.exit(0); // já há um YTA aberto: o pedido foi entregue a ele
app.setAppUserModelId('local.yta'); // notificações do Windows com o nome e o ícone do app

app.whenReady().then(() => {
  fs.rm(workRoot, { recursive: true, force: true }, () => {}); // sobras de uma sessão interrompida
  // Login por janela embutida da versão anterior (o Google bloqueava); não é mais usado.
  fs.rm(path.join(app.getPath('userData'), 'Partitions', 'youtube-login'), { recursive: true, force: true }, () => {});
  createWindow();
  bridge.init({ getWin: () => win, probe, rendererReady: () => rendererReady });
});
app.on('before-quit', () => {
  for (const id of jobs.keys()) cancelJob(id);
});
app.on('window-all-closed', () => {
  for (const id of jobs.keys()) cancelJob(id);
  app.quit();
});
