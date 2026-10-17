const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const openBtn = document.getElementById('open');

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: 'ping' }).catch(() => null);
  statusEl.className = `status ${r?.ok ? 'on' : 'off'}`;
  statusText.innerHTML = r?.ok
    ? `Conectado ao YTA <span class="num">${r.version}</span>`
    : 'YTA fechado';
}

openBtn.addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'show' }).catch(() => null);
  if (!r) {
    // Fechado: abre pelo yta:// (o Chrome pergunta "Abrir o YTA?" na primeira vez).
    chrome.tabs.create({ url: 'yta://open' });
  }
  window.close();
});

refresh();
