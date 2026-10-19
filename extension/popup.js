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

/* Sites em que o botão foi escondido ("Não mostrar em …" no menu do botão). */
const hiddenEl = document.getElementById('hidden-sites');
async function showHidden() {
  const { hiddenSites = [] } = await chrome.storage.sync.get('hiddenSites');
  hiddenEl.hidden = !hiddenSites.length;
  if (!hiddenSites.length) return;
  hiddenEl.textContent = `Botão oculto em: ${hiddenSites.map((h) => h.replace(/^www\./, '')).join(', ')}. `;
  const undo = document.createElement('button');
  undo.className = 'link';
  undo.textContent = 'Mostrar de novo';
  undo.addEventListener('click', async () => {
    await chrome.storage.sync.set({ hiddenSites: [] });
    showHidden();
  });
  hiddenEl.append(undo);
}

/* Acelerador: ligado por padrão. */
const captureEl = document.getElementById('capture');
chrome.storage.sync.get('capture').then(({ capture = true }) => {
  captureEl.checked = capture;
});
captureEl.addEventListener('change', () => chrome.storage.sync.set({ capture: captureEl.checked }));

refresh();
showHidden();
