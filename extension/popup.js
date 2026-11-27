// Popup da extensão (2.0): o que está baixando agora, as chaves dos downloads do navegador (moram no
// YTA — Ajustes, bandeja e este popup mostram as mesmas) e os sites em que o botão foi escondido.
const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

const dec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const bytes = (n) =>
  !Number.isFinite(n) || n <= 0 ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${dec.format(n / 1048576)} MB` : `${dec.format(n / 1073741824)} GB`;
function clock(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const r = String(Math.floor(s % 60)).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
function site(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m)\./, '');
    return /(^|\.)(youtube\.com|youtu\.be)$/.test(h) ? 'YouTube' : /(^|\.)instagram\.com$/.test(h) ? 'Instagram' : h;
  } catch {
    return '';
  }
}
const shortUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '');

/* ---------- Conectado / fechado ---------- */
let online = null;
function setStatus(ok) {
  if (ok === online) return;
  online = ok;
  $('status').className = `status${ok ? ' on' : ''}`;
  $('status-text').textContent = ok ? 'Conectado' : 'YTA fechado';
  loadSettings();
}

/* ---------- Agora ---------- */
function meta(it) {
  const where = site(it.url);
  switch (it.phase) {
    case 'download':
      return [where, it.part === 'audio' ? 'áudio' : null, it.eta != null && it.percent < 100 ? `${clock(it.eta)} restante` : null].filter(Boolean).join(' · ');
    case 'convert':
      if (it.format === 'video') return it.copy === false ? 'Convertendo para H.264…' : 'Juntando vídeo e áudio…';
      return it.copy ? 'Finalizando…' : 'Convertendo…';
    case 'queued':
      return `${where} · Na fila`;
    case 'paused':
      return `${where} · Pausado`;
    case 'listing':
      return 'Lendo a playlist…';
    case 'preparing':
      return `${where} · ${it.kind === 'file' ? 'Conectando…' : 'Buscando…'}`;
    default:
      return where;
  }
}

function renderItems(list) {
  const has = list.length > 0;
  $('items').hidden = !has;
  $('empty').hidden = has;
  $('empty').textContent = online
    ? 'Nada baixando. Passe o mouse sobre um vídeo e use o botão Baixar; clique direito num link também funciona.'
    : 'O YTA está fechado. Abra o app para baixar e ver o andamento aqui.';
  const speed = list.reduce((sum, it) => sum + (it.phase === 'download' && it.speed > 0 ? it.speed : 0), 0);
  $('speed').textContent = speed > 0 ? `${bytes(speed)}/s` : '';
  $('items').replaceChildren(
    ...list.map((it) => {
      const moving = it.phase === 'download' || it.phase === 'convert';
      const paused = it.phase === 'paused';
      const pct = (moving || paused) && it.percent != null ? Math.floor(it.percent) : null;
      const el = document.createElement('div');
      el.className = 'item';
      const line = document.createElement('div');
      line.className = 'line';
      const name = document.createElement('span');
      name.className = `name${it.kind === 'file' ? ' mono' : ''}`;
      name.textContent = it.title || shortUrl(it.url);
      line.append(name);
      if (pct != null) {
        const p = document.createElement('span');
        p.className = `pct${paused ? ' rest' : ''}`;
        p.textContent = `${pct}%`;
        line.append(p);
      }
      el.append(line);
      if (pct != null) {
        const bar = document.createElement('div');
        bar.className = `bar${paused ? ' rest' : ''}`;
        const fill = document.createElement('span');
        fill.style.transform = `scaleX(${pct / 100})`;
        bar.append(fill);
        el.append(bar);
      }
      const m = document.createElement('span');
      m.className = 'minor';
      m.textContent = meta(it);
      el.append(m);
      return el;
    }),
  );
}

/* ---------- Downloads do navegador (chaves do YTA) ---------- */
const switches = [...document.querySelectorAll('.switch')];
function renderSettings(s) {
  const ok = Boolean(s) && typeof s.capture === 'boolean';
  for (const sw of switches) {
    sw.disabled = !ok;
    sw.setAttribute('aria-checked', String(ok && Boolean(s[sw.dataset.key])));
  }
  $('closed-hint').hidden = ok;
}
async function loadSettings() {
  renderSettings(online ? await ask({ type: 'settings-get' }) : null);
}
for (const sw of switches) {
  sw.addEventListener('click', async () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    renderSettings(await ask({ type: 'settings-set', patch: { [sw.dataset.key]: next } }));
  });
}

/* ---------- Sites em que o botão foi escondido ("Não mostrar em …" no menu do botão) ---------- */
async function showHidden() {
  const { hiddenSites = [] } = await chrome.storage.sync.get('hiddenSites');
  const el = $('hidden-sites');
  if (!hiddenSites.length) {
    el.textContent = 'Nenhum';
    return;
  }
  el.textContent = `${hiddenSites.map((h) => h.replace(/^www\./, '')).join(', ')} · `;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'link';
  undo.textContent = 'Mostrar de novo';
  undo.addEventListener('click', async () => {
    await chrome.storage.sync.set({ hiddenSites: [] });
    showHidden();
  });
  el.append(undo);
}

$('open').addEventListener('click', async () => {
  const r = await ask({ type: 'show' });
  // Fechado: abre pelo yta:// (o Chrome pergunta "Abrir o YTA?" na primeira vez).
  if (!r) chrome.tabs.create({ url: 'yta://open' });
  window.close();
});

/* Enquanto o popup está aberto, o andamento atualiza a cada segundo. */
async function tick() {
  const r = await ask({ type: 'items' });
  setStatus(Boolean(r));
  renderItems(r?.items || []);
}
ask({ type: 'ping' }); // confere a versão (recarrega a extensão se o YTA atualizou)
tick();
setInterval(tick, 1000);
showHidden();
