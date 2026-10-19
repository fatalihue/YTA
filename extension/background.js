// Serviço de fundo da extensão: é o único que conversa com o YTA (servidor em 127.0.0.1).
// O script das páginas pede por mensagem; assim o cabeçalho X-YTA e a origem chrome-extension://
// (as duas travas do servidor) vêm sempre daqui.

const PORTS = [47821, 47822, 47823]; // mesma ordem que o app tenta
let port = null;

async function call(path, { method = 'GET', body } = {}) {
  const candidates = port ? [port, ...PORTS.filter((p) => p !== port)] : PORTS;
  for (const p of candidates) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}${path}`, {
        method,
        headers: { 'X-YTA': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 403 || res.status === 404) continue; // outra coisa nessa porta
      port = p;
      return await res.json();
    } catch {
      // nada escutando nessa porta
    }
  }
  port = null;
  return null; // YTA fechado
}

/** Quando o YTA atualiza, ele troca os arquivos desta extensão: recarrega uma vez por versão. */
async function checkVersion(appVersion) {
  const mine = chrome.runtime.getManifest().version;
  if (!appVersion || appVersion === mine) return;
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === appVersion) return; // pasta carregada não é a do YTA: não entra em laço
  await chrome.storage.local.set({ reloadedFor: appVersion });
  chrome.runtime.reload();
}

async function ping() {
  const r = await call('/ping');
  if (r?.app === 'YTA') {
    checkVersion(r.version);
    return { ok: true, version: r.version };
  }
  return { ok: false };
}

/* ---------- Arquivos de vídeo que cada aba carrega (o truque do IDM) ----------
 * Em sites que o yt-dlp não reconhece, o YTA baixa direto o arquivo que a página tocava. Guardado
 * em storage.session porque o serviço de fundo dorme e perde a memória. */
const KNOWN = /(^|\.)(youtube\.com|youtu\.be|instagram\.com)$/;
const mediaKey = (tabId) => `media:${tabId}`;

function mediaKind(details) {
  const u = details.url;
  if (/\.m3u8(\?|$)/i.test(u)) return 'hls';
  if (/\.mpd(\?|$)/i.test(u)) return 'dash';
  if (details.type === 'media' && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u)) return 'file';
  return null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    let host = '';
    try {
      host = new URL(d.initiator || d.documentUrl || d.url).hostname;
    } catch {}
    if (KNOWN.test(host)) return; // YouTube e Instagram o YTA reconhece sozinho
    const kind = mediaKind(d);
    if (!kind) return;
    const key = mediaKey(d.tabId);
    chrome.storage.session.get(key).then((got) => {
      const list = got[key] || [];
      if (list.some((m) => m.url === d.url)) return;
      list.push({ url: d.url, kind, frameId: d.frameId, time: Date.now() });
      chrome.storage.session.set({ [key]: list.slice(-30) });
    });
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other'] },
);

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(mediaKey(tabId)));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Carregamento novo da página (não a troca de endereço dentro do mesmo site): esquece os arquivos.
  if (info.status === 'loading' && info.url) chrome.storage.session.remove(mediaKey(tabId));
});

/** O melhor candidato: a 1ª lista HLS do quadro (costuma ser a "master", com todas as qualidades). */
async function pickMedia(tabId, frameId) {
  const key = mediaKey(tabId);
  const list = (await chrome.storage.session.get(key))[key] || [];
  const inFrame = list.filter((m) => m.frameId === frameId);
  const pool = inFrame.length ? inFrame : list;
  return (
    pool.find((m) => m.kind === 'hls' && /master|playlist|index/i.test(m.url)) ||
    pool.find((m) => m.kind === 'hls') ||
    pool.find((m) => m.kind === 'dash') ||
    [...pool].reverse().find((m) => m.kind === 'file') ||
    null
  )?.url || null;
}

/** Completa o pedido com o que só o serviço de fundo sabe: página, título e arquivo detectado. */
async function enrich(request, tab, frameId = 0, frameUrl = null) {
  const page = frameUrl || tab?.url || request.url;
  let host = '';
  try {
    host = new URL(request.url).hostname;
  } catch {}
  if (KNOWN.test(host)) return request;
  return {
    ...request,
    referer: page,
    title: tab?.title || null,
    mediaUrl: tab?.id >= 0 ? await pickMedia(tab.id, frameId) : null,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'ping':
        return ping();
      case 'enqueue': {
        const request = sender.tab ? await enrich(msg.request, sender.tab, sender.frameId, sender.url) : msg.request;
        return (await call('/enqueue', { method: 'POST', body: request })) || { ok: false, offline: true };
      }
      case 'status':
        return (await call(`/status?id=${encodeURIComponent(msg.id)}`)) || { phase: 'offline' };
      case 'probe':
        return (await call(`/probe?url=${encodeURIComponent(msg.url)}`)) || { ok: false, offline: true };
      case 'reveal':
        return call('/reveal', { method: 'POST', body: { id: msg.id } });
      case 'show':
        return call('/show', { method: 'POST', body: {} });
      default:
        return null;
    }
  })().then(reply);
  return true; // resposta assíncrona
});

/* ---------- Acelerador: downloads do navegador vão para o YTA (como o IDM) ----------
 * O download é segurado no momento em que o navegador escolhe o nome (o arquivo ainda está
 * chegando) e oferecido ao YTA. Se ele assumir (o servidor aceita pedaços e o arquivo tem 1 MB ou
 * mais), o navegador cancela o dele; se recusar, estiver fechado ou demorar, o download segue
 * normal no navegador — nada se perde. Os cookies vão junto porque muitos downloads exigem a
 * sessão do site; só os do próprio arquivo (e do endereço de origem, se for outro). */
const CAPTURE_MIN = 1024 * 1024;

async function cookiesFor(urls) {
  const out = {};
  for (const u of urls) {
    let host;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    if (host in out) continue;
    const list = await chrome.cookies.getAll({ url: u }).catch(() => []);
    out[host] = list.map((c) => `${c.name}=${c.value}`).join('; ');
  }
  return out;
}

async function offerToYta(item) {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return false; // blob:, data: (gerados pela página) ficam no navegador
  if (item.byExtensionId || item.incognito) return false;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize;
  if (size > 0 && size < CAPTURE_MIN) return false;
  const { capture = true } = await chrome.storage.sync.get('capture');
  if (!capture) return false;
  const body = {
    url,
    referrer: item.referrer || null,
    filename: (item.filename || '').split(/[\\/]/).pop() || null,
    mime: item.mime || null,
    size: size > 0 ? size : null,
    cookies: await cookiesFor([url, item.url]),
    userAgent: navigator.userAgent,
  };
  const r = await Promise.race([call('/capture', { method: 'POST', body }), new Promise((res) => setTimeout(() => res(null), 15_000))]);
  return Boolean(r?.ok);
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  offerToYta(item)
    .catch(() => false)
    .then(async (taken) => {
      if (!taken) return suggest();
      await chrome.downloads.cancel(item.id).catch(() => {});
      chrome.downloads.erase({ id: item.id }).catch(() => {}); // some da lista de downloads do navegador
    });
  return true; // nome decidido depois (o download espera)
});

/* Clique direito: "Baixar com o YTA" em links, páginas e vídeos, com a última escolha. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'yta-link', title: 'Baixar com o YTA', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'yta-page', title: 'Baixar esta página com o YTA', contexts: ['page', 'video'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'yta-link' ? info.linkUrl : info.pageUrl || tab?.url;
  if (!url) return;
  const { choice } = await chrome.storage.sync.get('choice');
  const base = { url, ...(choice || { format: 'm4a' }) };
  // Link: aponta para outra página, então o arquivo que esta aba toca não serve de plano B.
  const request = info.menuItemId === 'yta-link' ? base : await enrich(base, tab, info.frameId || 0, info.frameUrl);
  const r = await call('/enqueue', { method: 'POST', body: request });
  if (!r && tab?.id) {
    // YTA fechado: a página abre o yta:// (o Chrome pergunta uma vez) e tenta de novo.
    chrome.tabs.sendMessage(tab.id, { type: 'launch-and-enqueue', request }).catch(() => {});
  }
});
