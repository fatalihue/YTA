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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'ping':
        return ping();
      case 'enqueue':
        return (await call('/enqueue', { method: 'POST', body: msg.request })) || { ok: false, offline: true };
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
  const request = { url, ...(choice || { format: 'm4a' }) };
  const r = await call('/enqueue', { method: 'POST', body: request });
  if (!r && tab?.id) {
    // YTA fechado: a página abre o yta:// (o Chrome pergunta uma vez) e tenta de novo.
    chrome.tabs.sendMessage(tab.id, { type: 'launch-and-enqueue', request }).catch(() => {});
  }
});
