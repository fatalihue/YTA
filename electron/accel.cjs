/*
 * Acelerador de downloads (o que o IDM faz, sem o resto):
 * - consulta o arquivo (tamanho, se o servidor aceita pedaços, nome);
 * - divide em até 8 pedaços baixados ao mesmo tempo, cada um numa conexão;
 * - quando uma conexão termina, pega metade do maior pedaço que ainda falta (divisão dinâmica):
 *   todas trabalham até o fim, sem a última conexão lenta segurando o arquivo;
 * - servidor que limita conexões (429/503/403 com outras ativas): fica com as que funcionam;
 * - pausa e retoma (inclusive depois de fechar o app): o estado dos pedaços vai para um JSON;
 * - grava direto no arquivo final (.part), num arquivo esparso: escrever o fim antes do começo
 *   não obriga o Windows a preencher de zeros o meio (medido: 734 ms → 1 ms num arquivo de 4 GB).
 *
 * Cookies só vão para o host de onde vieram (um redirecionamento para outro domínio não os leva).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CONNECTIONS = 8; // o padrão do IDM; o ganho para de crescer por volta disso
const MIN_SPLIT = 1024 * 1024; // pedaço mínimo: abaixo disso abrir conexão custa mais que ganha
const WRITE_CHUNK = 1024 * 1024; // junta os pedaços que chegam e grava de 1 MB em 1 MB
const STALL_MS = 30_000; // conexão sem receber nada por 30 s conta como queda
const MAX_TRIES = 8; // tentativas por pedaço antes de desistir
const RAMP_MS = 250; // intervalo entre uma conexão nova e a próxima
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

class HttpError extends Error {
  constructor(status) {
    super(
      status === 401 || status === 403
        ? 'O site recusou o acesso (o link pode ter expirado ou exigir login).'
        : status === 404 || status === 410
          ? 'O arquivo não existe mais nesse endereço.'
          : `O servidor respondeu ${status}.`,
    );
    this.status = status;
  }
}
/** O servidor mandou o arquivo inteiro onde se pediu um pedaço: ele mudou ou não aceita mais pedaços. */
class RangeIgnored extends Error {
  constructor() {
    super('O arquivo mudou no servidor.');
  }
}

function headersFor(url, opts) {
  const u = new URL(url);
  const h = { 'User-Agent': opts.userAgent || DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'identity' };
  if (opts.referer) h.Referer = opts.referer;
  const cookie = opts.cookies?.[u.hostname];
  if (cookie) h.Cookie = cookie;
  return h;
}

/** GET com redirecionamentos seguidos à mão (para os cookies não vazarem para outro domínio). */
async function request(url, opts, { range, ifRange, signal }) {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const headers = headersFor(current, opts);
    if (range) headers.Range = range;
    if (range && ifRange) headers['If-Range'] = ifRange;
    const res = await fetch(current, { headers, redirect: 'manual', signal });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
      continue;
    }
    return { res, url: current };
  }
  throw new Error('O site redirecionou vezes demais.');
}

/** filename*=UTF-8''… (RFC 5987) ou filename="…" do Content-Disposition. */
function dispositionName(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (!plain) return null;
  const raw = (plain[2] ?? plain[1]).trim();
  // Muitos servidores mandam UTF-8 cru num cabeçalho lido como latin1 ("RelatÃ³rio").
  const fixed = Buffer.from(raw, 'latin1').toString('utf8');
  return fixed.includes('�') ? raw : fixed;
}

/** Nome a partir do endereço (último trecho do caminho), se ele parecer um arquivo. */
function urlName(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return /\.\w{1,8}$/.test(last) ? last : null;
  } catch {
    return null;
  }
}

/**
 * Consulta: pede só o 1º byte. 206 + Content-Range = aceita pedaços (e diz o tamanho); 200 = não
 * aceita (baixa numa conexão só). Devolve também o endereço final, o tipo e o nome sugerido.
 */
async function probe(url, opts = {}, signal) {
  const { res, url: finalUrl } = await request(url, opts, { range: 'bytes=0-0', signal });
  await res.body?.cancel().catch(() => {});
  let size = null;
  let ranges = false;
  if (res.status === 206) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
    if (m) {
      size = Number(m[1]);
      ranges = true;
    }
  } else if (res.status === 200) {
    size = Number(res.headers.get('content-length')) || null;
  } else {
    throw new HttpError(res.status);
  }
  const etag = res.headers.get('etag');
  return {
    finalUrl,
    size,
    ranges,
    type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
    name: dispositionName(res.headers.get('content-disposition')) || urlName(finalUrl) || urlName(url),
    // If-Range só aceita ETag forte (sem W/); sem ela, a data de modificação.
    validator: etag && !etag.startsWith('W/') ? etag : res.headers.get('last-modified') || null,
  };
}

const fsutil = (args) =>
  new Promise((resolve) => execFile('fsutil', args, { windowsHide: true, timeout: 10_000 }, () => resolve()));

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeState(file, state) {
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    fs.renameSync(`${file}.tmp`, file);
  } catch {}
}

/**
 * Baixa `url` para `part`. stateFile guarda os pedaços (retomada). onProgress recebe
 * { done, size, speed, eta, conns }. Cancelar/pausar: abortar `signal` (o estado fica salvo).
 */
async function download({ url, opts = {}, part, stateFile, signal, onProgress = () => {}, connections = CONNECTIONS }) {
  const info = await probe(url, opts, signal);
  const saved = readState(stateFile);
  const canResume =
    saved &&
    info.ranges &&
    saved.size === info.size &&
    saved.validator === info.validator &&
    Array.isArray(saved.segments) &&
    fs.existsSync(part);
  const size = info.size;
  // Pedaços: [{ start, end (exclusivo), pos (gravado até), recv (recebido até), reqEnd (fim pedido
  // ao servidor) }]. Só os que faltam. Começa com um pedaço só (o arquivo inteiro); as conexões
  // novas o dividem conforme entram.
  const segments = canResume
    ? saved.segments.map((s) => ({ start: s.start, end: s.end, pos: s.pos, recv: s.pos, reqEnd: 0 }))
    : [{ start: 0, end: size ?? Infinity, pos: 0, recv: 0, reqEnd: 0 }];

  if (!canResume) {
    fs.writeFileSync(part, '');
    if (info.ranges) await fsutil(['sparse', 'setflag', path.win32.normalize(part)]);
  }
  const fd = await fs.promises.open(part, 'r+');
  const ifRange = info.ranges ? info.validator : null;
  const state = () => ({
    url,
    size,
    validator: info.validator,
    segments: segments.filter((s) => s.pos < s.end).map(({ start, end, pos }) => ({ start, end, pos })),
  });

  const inner = new AbortController(); // derruba todas as conexões (erro fatal ou pausa)
  const stop = () => inner.abort();
  signal?.addEventListener('abort', stop);
  let fatal = null;
  let limit = info.ranges ? connections : 1;
  let locked = false; // o servidor recusou uma conexão a mais: não abre outras
  let workers = 0;
  /** Espera que a pausa interrompe. */
  const wait = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        inner.signal.removeEventListener('abort', done);
        resolve();
      }
      inner.signal.addEventListener('abort', done);
    });
  let received = 0; // bytes recebidos nesta sessão (velocidade)
  const busy = () => segments.filter((s) => s.busy).length;

  /** Próximo pedaço livre; sem livre, metade do maior que está sendo baixado. */
  function nextSegment() {
    const free = segments.find((s) => !s.busy && s.pos < s.end);
    if (free) return free;
    if (!info.ranges) return null;
    let best = null;
    for (const s of segments) if (s.busy && (!best || s.end - s.recv > best.end - best.recv)) best = s;
    if (!best || best.end - best.recv < 2 * MIN_SPLIT) return null;
    const mid = best.recv + Math.floor((best.end - best.recv) / 2);
    const fresh = { start: mid, end: best.end, pos: mid, recv: mid, reqEnd: 0 };
    best.end = mid; // a conexão dele para em mid
    segments.push(fresh);
    return fresh;
  }
  /** Há o que dar a mais uma conexão? */
  const hasWork = () =>
    segments.some((s) => !s.busy && s.pos < s.end) ||
    segments.some((s) => s.busy && s.end - s.recv >= 2 * MIN_SPLIT);

  /** Pedaço recusado, sem nada baixado: volta para a conexão de quem ele saiu (se ela ainda o cobre). */
  function release(seg) {
    if (seg.busy || seg.pos !== seg.start) return;
    const parent = segments.find((s) => s.busy && s.end === seg.start && s.reqEnd >= seg.end);
    if (!parent) return;
    parent.end = seg.end;
    segments.splice(segments.indexOf(seg), 1);
  }

  async function fetchSegment(seg) {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    inner.signal.addEventListener('abort', abort);
    let timer = null;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(new Error('stall')), STALL_MS);
    };
    let buf = [];
    let bufLen = 0;
    const flush = async () => {
      if (!bufLen) return;
      const data = buf.length === 1 ? buf[0] : Buffer.concat(buf, bufLen);
      const at = seg.pos;
      buf = [];
      bufLen = 0;
      await fd.write(data, 0, data.length, at);
      seg.pos = at + data.length;
    };
    try {
      arm();
      const range = info.ranges ? `bytes=${seg.pos}-${seg.end === Infinity ? '' : seg.end - 1}` : null;
      seg.reqEnd = seg.end;
      const { res } = await request(url, opts, { range, ifRange, signal: ctrl.signal });
      if (info.ranges && res.status === 200) {
        await res.body?.cancel().catch(() => {});
        throw new RangeIgnored();
      }
      if (res.status !== (info.ranges ? 206 : 200)) {
        await res.body?.cancel().catch(() => {});
        throw new HttpError(res.status);
      }
      for await (const chunk of res.body) {
        arm();
        const room = seg.end - seg.recv;
        const c = chunk.length > room ? Buffer.from(chunk.buffer, chunk.byteOffset, room) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length);
        buf.push(c);
        bufLen += c.length;
        seg.recv += c.length;
        received += c.length;
        if (bufLen >= WRITE_CHUNK) await flush();
        if (seg.recv >= seg.end) break; // o pedaço encolheu (divisão) ou chegou ao fim
      }
      await flush();
      if (seg.end === Infinity) seg.end = seg.pos; // tamanho desconhecido: o fim é onde o servidor parou
      // O pedaço cresceu depois do pedido (um vizinho recusado voltou para ele): pede o resto.
      if (seg.pos < seg.end && seg.pos >= seg.reqEnd) return;
      if (seg.pos < seg.end) throw new Error('A conexão terminou antes do fim do pedaço.');
    } finally {
      clearTimeout(timer);
      inner.signal.removeEventListener('abort', abort);
      ctrl.abort(); // solta a conexão se o laço saiu antes do fim do corpo
      // O que já chegou é válido (veio da posição certa): grava antes de devolver o pedaço.
      await flush().catch(() => {});
      seg.recv = seg.pos;
    }
  }

  /**
   * Uma conexão. `extra`: aberta pela rampa (a 2ª em diante); se o servidor recusar logo o 1º
   * pedido dela, ele não quer mais conexões: ela sai, o pedaço volta e a rampa para.
   */
  async function worker(extra) {
    workers++;
    let first = extra;
    let refusals = 0; // recusas seguidas desta conexão enquanto outras funcionam
    let seg = null;
    const quit = () => {
      locked = true;
      limit = Math.max(1, Math.min(limit, workers - 1));
      seg.busy = false;
      release(seg);
    };
    try {
      while (!fatal && !inner.signal.aborted) {
        if (workers > limit) return; // o servidor limitou as conexões
        seg = nextSegment();
        if (!seg) return;
        seg.busy = true;
        let backoff = 0;
        const before = seg.pos;
        try {
          await fetchSegment(seg);
          seg.tries = 0;
          refusals = 0;
          first = false;
        } catch (err) {
          if (inner.signal.aborted) return;
          const others = busy() > 1;
          if (err instanceof RangeIgnored) {
            fatal = err;
            return stop();
          }
          const refusal = err instanceof HttpError && [403, 429, 503].includes(err.status);
          // Conexão nova recusada (ou que nem conectou) enquanto as outras baixam: limite do servidor.
          if (first && others && (refusal || (!(err instanceof HttpError) && seg.pos === seg.start))) return quit();
          first = false;
          // Recusa de uma conexão que já funcionava pode ser passageira (a anterior ainda
          // fechando); três seguidas: esta sai e as outras pegam o pedaço dela.
          if (others && refusal) {
            if (++refusals >= 3) return quit();
            backoff = 1000 * refusals;
          } else if (err instanceof HttpError && [401, 404, 410].includes(err.status)) {
            fatal = err;
            return stop();
          } else {
            // Caiu depois de baixar um tanto: é queda comum, não insistência num erro; a espera não cresce.
            if (seg.pos > before) seg.tries = 0;
            seg.tries = (seg.tries || 0) + 1;
            // Recusa sem outra conexão funcionando: provavelmente o link expirou; não insiste muito.
            const refused = err instanceof HttpError && [401, 403].includes(err.status);
            if (seg.tries > (refused ? 2 : MAX_TRIES)) {
              fatal = err instanceof HttpError ? err : new Error('A conexão caiu várias vezes seguidas. Tente de novo.');
              return stop();
            }
            if (!info.ranges) {
              // Sem pedaços não há como continuar do meio: recomeça do zero.
              seg.pos = 0;
              seg.recv = 0;
            }
            backoff = Math.min(15_000, 1000 * 2 ** (seg.tries - 1));
          }
        } finally {
          seg.busy = false; // antes da espera: outra conexão pode assumir o pedaço enquanto esta espera
        }
        if (backoff) await wait(backoff);
      }
    } finally {
      workers--;
    }
  }

  // Progresso (a cada 500 ms) e estado salvo (a cada 1 s).
  let speed = null;
  let lastReceived = 0;
  let lastAt = Date.now();
  let ticks = 0;
  const tick = () => {
    const now = Date.now();
    const instant = ((received - lastReceived) * 1000) / Math.max(1, now - lastAt);
    lastReceived = received;
    lastAt = now;
    speed = speed === null ? instant : speed * 0.7 + instant * 0.3;
    const left = segments.reduce((sum, s) => sum + (s.end === Infinity ? 0 : s.end - s.recv), 0);
    const done = size ? size - left : segments[0].recv;
    onProgress({ done, size, speed, eta: size && speed > 0 ? left / speed : null, conns: busy() });
    if (++ticks % 2 === 0 && info.ranges) writeState(stateFile, state());
  };
  const timer = setInterval(tick, 500);

  // Rampa (como o IDM): uma conexão de cada vez, a cada RAMP_MS, cada nova pegando metade do maior
  // pedaço. Servidor que limita conexões recusa logo uma das primeiras e a rampa para ali — abrir
  // as 8 de uma vez fazia esses servidores recusarem quase todas (ficava mais lento que uma só).
  const pool = new Set();
  const spawn = (extra) => {
    const p = worker(extra).finally(() => pool.delete(p));
    pool.add(p);
  };
  let ramp = null;
  try {
    spawn(false);
    if (info.ranges) {
      ramp = setInterval(() => {
        if (!locked && !fatal && !inner.signal.aborted && workers < limit && hasWork()) spawn(true);
      }, RAMP_MS);
    }
    // Sem conexão viva e ainda faltando (a última saiu numa recusa): abre outra, poucas vezes.
    for (let revive = 0; ; ) {
      while (pool.size) await Promise.race(pool);
      if (fatal || inner.signal.aborted || !segments.some((s) => s.pos < s.end) || revive++ >= 3) break;
      spawn(false);
    }
    clearInterval(ramp);
    if (fatal) throw fatal;
    if (signal?.aborted) throw signal.reason || new Error('aborted');
    if (segments.some((s) => s.pos < s.end)) throw new Error('O download parou antes do fim. Tente de novo.');
    tick();
  } finally {
    clearInterval(ramp);
    clearInterval(timer);
    signal?.removeEventListener('abort', stop);
    if (info.ranges) writeState(stateFile, state());
    await fd.close().catch(() => {});
  }
  if (info.ranges) await fsutil(['sparse', 'setflag', path.win32.normalize(part), '0']);
  return { size: size ?? segments[0].end, info };
}

/** Marca "baixado da internet" (como o navegador faz): o Windows segue avisando ao abrir um .exe. */
function markOfTheWeb(file, { url, referer } = {}) {
  const lines = ['[ZoneTransfer]', 'ZoneId=3'];
  if (referer && /^https?:/i.test(referer)) lines.push(`ReferrerUrl=${referer}`);
  if (url && /^https?:/i.test(url)) lines.push(`HostUrl=${url}`);
  try {
    fs.writeFileSync(`${file}:Zone.Identifier`, `${lines.join('\r\n')}\r\n`);
  } catch {
    // FAT/exFAT (pendrive) não têm fluxos alternativos.
  }
}

module.exports = { probe, download, markOfTheWeb, dispositionName, urlName, HttpError, RangeIgnored, MIN_SPLIT, CONNECTIONS };
