/*
 * Ponte do YTA com o Windows e com a extensão do navegador:
 * - janela única (um segundo clique ou um yta:// vai para o YTA já aberto);
 * - bandeja: fechar a janela deixa o app rodando, para a extensão sempre achá-lo;
 * - yta://start abre o YTA na bandeja (para a extensão falar com ele); yta://open mostra a janela;
 * - servidor em 127.0.0.1 para a extensão: enfileirar, consultar andamento, resoluções;
 * - notificações do Windows para pedidos vindos da extensão.
 *
 * Segurança do servidor: só responde a pedidos com o cabeçalho X-YTA (uma página comum não
 * consegue enviá-lo sem um preflight, que é negado), com Host 127.0.0.1/localhost (barra o DNS
 * rebinding, em que um site aponta o próprio domínio para 127.0.0.1 e vira "mesma origem") e,
 * quando há Origin, só à nossa extensão.
 */
const { app, Tray, Menu, Notification, nativeImage, shell, dialog, clipboard, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const EXTENSION_ID = 'eehgfpphodgneiebkbdffnjneljodbke';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const PORTS = [47821, 47822, 47823]; // a extensão tenta na mesma ordem
const PROTOCOL = 'yta';

let ctx = null; // { getWin, probe, capture, askDownload, showDone, discardWork, rendererReady }
let tray = null;
let quitting = false;
let port = null;
let lastExtensionContact = 0;
let reqSeq = 0;
const waitingReply = new Map(); // reqId → resolve
const queuedForRenderer = []; // pedidos que chegaram antes da interface carregar
const items = new Map(); // id → estado resumido (a interface manda a cada mudança)
const fromExtension = new Set(); // ids pedidos pela extensão (recebem notificação)
const stateFile = () => path.join(app.getPath('userData'), 'bridge.json');

/** Registro de diagnóstico (yta.log na pasta de dados, até ~200 KB): o app reaberto pelo
 * instalador ou pela bandeja não tem console visível. */
const logFile = () => path.join(app.getPath('userData'), 'yta.log');
function log(...parts) {
  const line = `${new Date().toISOString()} [v${app.getVersion()}] ${parts.join(' ')}
`;
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 200 * 1024) fs.renameSync(f, `${f}.old`);
    fs.appendFileSync(f, line);
  } catch {}
  console.warn(line.trim());
}

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
};
const writeState = (patch) => fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch }));

/* Preferências do acelerador: janela "Baixar arquivo" (perguntar onde salvar), janela "Download
 * concluído" e a pasta lembrada. Mudam pela bandeja, pelo popup da extensão e pelas próprias janelas. */
function downloadPrefs() {
  const st = readState();
  return { askSave: st.askSave ?? true, showDone: st.showDone ?? true, fileFolder: st.fileFolder || null };
}
function setDownloadPrefs(patch = {}) {
  const clean = {};
  for (const k of ['askSave', 'showDone']) if (typeof patch[k] === 'boolean') clean[k] = patch[k];
  if (typeof patch.fileFolder === 'string' && patch.fileFolder) clean.fileFolder = patch.fileFolder;
  if (!Object.keys(clean).length) return downloadPrefs();
  writeState(clean);
  if (tray) tray.setContextMenu(trayMenu());
  return downloadPrefs();
}

/** Pasta fixa da extensão (carregada no Chrome em modo desenvolvedor). */
const extensionDir = () => path.join(app.getPath('userData'), 'extension');
const bundledExtensionDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', 'extension');

/** Janela única. Devolve false se outra instância já estava aberta (esta deve sair). */
function claimSingleInstance() {
  if (!app.requestSingleInstanceLock()) return false;
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleProtocol(link);
    else showWindow();
  });
  return true;
}

/** Iniciado por um yta:// (ou --hidden): começa só na bandeja. */
function startsHidden() {
  return process.argv.some((a) => a.startsWith(`${PROTOCOL}://`) || a === '--hidden');
}

function registerProtocol() {
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
}

function handleProtocol(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return;
  }
  // Só abrir: pôr links na fila é pelo servidor local (que confere que o pedido é da extensão).
  // Um yta://add?url=… deixaria qualquer site enfileirar downloads depois do "Abrir o YTA?".
  if (u.hostname === 'open') showWindow();
  // yta://start: só abre o app (na bandeja) para a extensão poder falar com ele.
}

function showWindow() {
  const win = ctx?.getWin();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Fechar a janela só a esconde; "Sair" (bandeja) ou o update encerram de verdade. */
function hideOnClose(win) {
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readState().trayHintShown) {
      writeState({ trayHintShown: true });
      notify('O YTA continua na bandeja', 'Ele fica rodando para receber os pedidos da extensão. Para sair, use o ícone ao lado do relógio.');
    }
  });
}

/* Iniciar com o Windows, já na bandeja (--hidden): a extensão sempre acha o YTA. Ligado por
 * padrão na primeira execução instalada; só no app instalado (no desenvolvimento registraria o
 * Electron de teste). */
const LOGIN_ARGS = ['--hidden'];
const autostartOn = () => app.isPackaged && app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin;
function setAutostart(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS });
  writeState({ autostartDecided: true });
}
function initAutostart() {
  if (app.isPackaged && !readState().autostartDecided) setAutostart(true);
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Abrir o YTA', click: showWindow },
    { label: 'Conectar extensão do navegador…', click: () => showExtensionHelp() },
    { type: 'separator' },
    {
      label: 'Perguntar onde salvar downloads',
      type: 'checkbox',
      checked: downloadPrefs().askSave,
      click: (item) => setDownloadPrefs({ askSave: item.checked }),
    },
    {
      label: 'Avisar ao concluir downloads',
      type: 'checkbox',
      checked: downloadPrefs().showDone,
      click: (item) => setDownloadPrefs({ showDone: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: autostartOn(),
      enabled: app.isPackaged,
      click: (item) => {
        setAutostart(item.checked);
        tray.setContextMenu(trayMenu());
      },
    },
    { type: 'separator' },
    { label: 'Sair', click: () => quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('YTA');
  tray.setContextMenu(trayMenu());
  tray.on('click', showWindow);
}

function quit() {
  quitting = true;
  app.quit();
}

const shown = new Set();
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'tray.png'), silent: true });
  shown.add(n);
  const release = () => shown.delete(n);
  n.on('click', () => {
    release();
    onClick?.();
  });
  n.on('close', release);
  n.on('failed', release);
  n.show();
  setTimeout(release, 10 * 60 * 1000); // teto, caso o Windows nunca avise o fechamento
}

/* ---------- Fila: pedidos externos entram pela interface (que é dona da fila) ---------- */

function enqueue(request) {
  const reqId = ++reqSeq;
  const payload = { reqId, ...request };
  return new Promise((resolve) => {
    waitingReply.set(reqId, resolve);
    if (ctx?.rendererReady()) ctx.getWin().webContents.send('external-add', payload);
    else queuedForRenderer.push(payload);
    setTimeout(() => {
      if (waitingReply.delete(reqId)) resolve({ ok: false, error: 'O YTA não respondeu.' });
    }, 15_000);
  }).then((r) => {
    if (r.ok) {
      fromExtension.add(r.id);
      if (request.kind === 'file') notify('Baixando com o YTA', request.title || request.url);
      else notify('Adicionado à fila do YTA', request.url);
    }
    return r;
  });
}

function flushRendererQueue() {
  for (const payload of queuedForRenderer.splice(0)) ctx.getWin().webContents.send('external-add', payload);
}

ipcMain.on('external-added', (_e, reply) => {
  const resolve = waitingReply.get(reply.reqId);
  if (resolve) {
    waitingReply.delete(reply.reqId);
    resolve(reply);
  }
});

ipcMain.on('items-state', (_e, list) => {
  const seen = new Set();
  for (const it of list) {
    seen.add(it.id);
    const before = items.get(it.id);
    items.set(it.id, it);
    if (!fromExtension.has(it.id) || before?.phase === it.phase) continue;
    if (it.phase === 'done' && it.kind === 'file' && it.file && downloadPrefs().showDone) {
      ctx.showDone(it.file); // janela "Download concluído" no lugar da notificação
    } else if (it.phase === 'done') {
      notify('Salvo pelo YTA', it.file ? path.basename(it.file) : it.title || it.url, () => it.file && shell.showItemInFolder(it.file));
    } else if (it.phase === 'error') {
      notify('O YTA não conseguiu baixar', `${it.title || it.url}\n${it.error || ''}`.trim(), showWindow);
    }
  }
  for (const id of items.keys()) if (!seen.has(id)) items.delete(id); // tirado da fila
});

/* ---------- Servidor local para a extensão ---------- */

function startServer() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || '')) return deny(res, 403);
    if (origin && origin !== EXTENSION_ORIGIN) return deny(res, 403);
    if (req.method === 'OPTIONS') return deny(res, 403); // sem preflight: páginas não chegam aqui
    if (req.headers['x-yta'] !== '1') return deny(res, 403);
    lastExtensionContact = Date.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/ping') {
        ensureExtensionSynced(); // a extensão recarrega ao ver a versão nova; a pasta tem de estar nela
        return send(res, { app: 'YTA', version: app.getVersion() });
      }
      if (req.method === 'POST' && url.pathname === '/enqueue') {
        const body = await readJson(req);
        if (!body?.url) return send(res, { ok: false, error: 'Sem link.' }, 400);
        return send(res, await enqueue(body));
      }
      // Download do navegador que a extensão segurou: o YTA assume se der para acelerar.
      if (req.method === 'POST' && url.pathname === '/capture') {
        const r = await ctx.capture(await readJson(req));
        if (!r.ok) return send(res, r);
        // Com a janela "Baixar arquivo": o navegador já pode cancelar o dele; a fila espera a resposta.
        if (downloadPrefs().askSave) {
          ctx.askDownload(r.request);
          return send(res, { ok: true, asked: true });
        }
        const q = await enqueue(r.request);
        if (!q.ok) ctx.discardWork(r.request.uid);
        return send(res, q.ok ? { ok: true, id: q.id } : { ok: false, reason: q.error || 'O YTA não aceitou.' });
      }
      if (url.pathname === '/settings') {
        const p = req.method === 'POST' ? setDownloadPrefs(await readJson(req)) : downloadPrefs();
        return send(res, { askSave: p.askSave, showDone: p.showDone });
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        const it = items.get(Number(url.searchParams.get('id')));
        return send(res, it || { phase: 'gone' });
      }
      if (req.method === 'GET' && url.pathname === '/probe') {
        return send(res, await ctx.probe(url.searchParams.get('url') || ''));
      }
      if (req.method === 'POST' && url.pathname === '/reveal') {
        const it = items.get(Number((await readJson(req))?.id));
        if (it?.file) shell.showItemInFolder(it.file);
        return send(res, { ok: Boolean(it?.file) });
      }
      if (req.method === 'POST' && url.pathname === '/show') {
        showWindow();
        return send(res, { ok: true });
      }
      return deny(res, 404);
    } catch (err) {
      return send(res, { ok: false, error: err.message }, 500);
    }
  });
  const tryListen = (i) => {
    if (i >= PORTS.length) return;
    server.once('error', () => tryListen(i + 1));
    server.listen(PORTS[i], '127.0.0.1', () => {
      port = PORTS[i];
    });
  };
  tryListen(0);
}

function send(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': EXTENSION_ORIGIN });
  res.end(JSON.stringify(data));
}
function deny(res, status) {
  res.writeHead(status);
  res.end();
}
function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 256 * 1024) req.destroy(); // cookies do download cabem com folga
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

/* ---------- Extensão: pasta fixa, sempre na versão do app ---------- */

/** Copia a extensão do app para a pasta fixa quando a versão muda (a extensão então se recarrega). */
function syncExtension() {
  const src = bundledExtensionDir();
  const dest = extensionDir();
  if (!fs.existsSync(path.join(src, 'manifest.json'))) return;
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).version;
  } catch {}
  if (current === app.getVersion() && app.isPackaged) return;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  const manifestFile = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.version = app.getVersion();
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}

/** Logo depois de um update o instalador pode abrir o app antes de gravar resourcesextension:
 * a cópia é tentada de novo depois e sempre que a extensão chama, até a pasta estar na versão. */
function extensionVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(extensionDir(), 'manifest.json'), 'utf8')).version;
  } catch {
    return null;
  }
}
function ensureExtensionSynced() {
  if (extensionVersion() === app.getVersion()) return true;
  try {
    syncExtension();
    log('[bridge] extensão copiada para a versão', String(extensionVersion()));
    return extensionVersion() === app.getVersion();
  } catch (err) {
    log('[bridge] syncExtension falhou:', err.code || '', err.message);
  }
}

async function showExtensionHelp() {
  const dir = extensionDir();
  await clipboard.writeText(dir); // assíncrono no Electron 44
  const connected = Date.now() - lastExtensionContact < 90_000;
  const { response } = await dialog.showMessageBox(ctx.getWin()?.isVisible() ? ctx.getWin() : undefined, {
    type: 'info',
    title: 'Extensão do navegador',
    message: connected ? 'A extensão do YTA está conectada.' : 'Conectar a extensão do YTA ao Chrome (ou Edge)',
    detail: [
      '1. Abra chrome://extensions (no Edge: edge://extensions).',
      '2. Ative o "Modo do desenvolvedor".',
      '3. Clique em "Carregar sem compactação" e escolha a pasta:',
      `   ${dir}`,
      '',
      'O caminho já foi copiado. A extensão se atualiza sozinha junto com o YTA.',
    ].join('\n'),
    buttons: ['Abrir a pasta', 'Fechar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) shell.openPath(dir);
}

ipcMain.handle('extension-help', () => showExtensionHelp());

function init(context) {
  ctx = context;
  app.on('before-quit', () => {
    quitting = true;
  });
  // Cada parte isolada: um problema numa (ex.: copiar a extensão) não derruba as outras.
  for (const step of [registerProtocol, syncExtension, initAutostart, createTray, startServer]) {
    try {
      step();
    } catch (err) {
      log(`[bridge] ${step.name} falhou:`, err.message);
    }
  }
  // Até a pasta da extensão estar na versão do app: a cada 15 s, no máximo 20 vezes.
  let tries = 0;
  const retry = setInterval(() => {
    tries++;
    if (ensureExtensionSynced() || tries >= 20) clearInterval(retry);
  }, 15_000);
  log('[bridge] iniciado', process.argv.slice(1).join(' '), '| extensão na versão', String(extensionVersion()));
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleProtocol(link);
}

module.exports = {
  enqueue,
  downloadPrefs,
  setDownloadPrefs,
  claimSingleInstance,
  startsHidden,
  hideOnClose,
  flushRendererQueue,
  showWindow,
  init,
  serverPort: () => port,
};
