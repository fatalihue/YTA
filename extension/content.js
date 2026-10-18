// Botão "YTA" sobre os vídeos de qualquer site (como o do IDM). YouTube e Instagram têm regras
// próprias para achar o link de cada vídeo; nos outros sites vai o endereço da página (ou do
// player embutido) e o serviço de fundo junta o arquivo de vídeo que a página tocava.
// - Clique no corpo: baixa com a última escolha. Setinha: menu com áudio/vídeo/resolução.
// - O botão mostra o andamento (na fila → baixando % → salvo · abrir pasta).
// - YTA fechado: abre o app por yta://start (o Chrome pergunta uma vez) e tenta de novo.
(() => {
  if (window.__ytaButton) return;
  window.__ytaButton = true;

  // Site da aba (dentro de um player embutido, o da página que o contém): é o que "Não mostrar
  // neste site" guarda.
  const topHost = (() => {
    const anc = location.ancestorOrigins;
    try {
      return anc && anc.length ? new URL(anc[anc.length - 1]).hostname : location.hostname;
    } catch {
      return location.hostname;
    }
  })();
  let blocked = false;
  chrome.storage.sync.get('hiddenSites').then(({ hiddenSites }) => {
    blocked = (hiddenSites || []).includes(topHost);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hiddenSites) blocked = (changes.hiddenSites.newValue || []).includes(topHost);
  });

  const MIN_W = 200;
  const MIN_H = 120;
  const FORMATS = [
    { key: 'm4a', label: 'Áudio M4A' },
    { key: 'opus', label: 'Áudio Opus' },
    { key: 'mp3', label: 'Áudio MP3' },
  ];
  const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Qual é o link "deste" vídeo ---------- */

  const isYouTube = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname);
  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);

  function youtubeUrl(video, hits) {
    // Player principal (página do vídeo ou Shorts): o link é o da própria página.
    if (video.closest('#movie_player, ytd-player, #shorts-player, ytd-reel-video-renderer')) {
      const u = new URL(location.href);
      if (u.pathname === '/watch' && u.searchParams.get('v')) return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
      const s = u.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (s) return `https://www.youtube.com/shorts/${s[1]}`;
      // Player do YouTube embutido em outro site.
      const e = u.pathname.match(/^\/embed\/([\w-]{11})/);
      if (e) return `https://www.youtube.com/watch?v=${e[1]}`;
    }
    // Prévia na home/busca: o link da miniatura sob o ponteiro.
    const a = hits.map((el) => el.closest?.('a[href*="/watch?v="], a[href*="/shorts/"]')).find(Boolean);
    return a ? new URL(a.getAttribute('href'), location.origin).href : null;
  }

  function instagramUrl(video) {
    // Stories e destaques: tela própria, sem post em volta; o link é o da página
    // (/stories/conta/123…/ ou /stories/highlights/123…/). Exigem login no YTA.
    const story = location.pathname.match(/^\/stories\/[\w.-]+(?:\/\d+)?/);
    if (story) return `https://www.instagram.com${story[0]}/`;
    const post = video.closest('article, [role="dialog"], main');
    const a = post?.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    const own = location.pathname.match(/^\/(p|reels?|tv)\/[\w-]+/);
    if (own && (!a || video.closest('[role="dialog"], main'))) return `https://www.instagram.com${own[0]}/`;
    return a ? new URL(a.getAttribute('href'), location.origin).href.replace(/\?.*$/, '') : null;
  }

  // Outros sites: a página (o yt-dlp reconhece ~1.800 sites e tem um extrator genérico).
  const urlFor = (video, hits) =>
    isYouTube ? youtubeUrl(video, hits) : isInstagram ? instagramUrl(video) : location.href.replace(/#.*$/, '');

  /* ---------- Interface (Shadow DOM: o CSS do site não vaza para cá) ---------- */

  const host = document.createElement('yta-overlay');
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      /* Tokens do YTA (tema escuro), só para esta extensão. */
      :host { --bg: #24262c; --bg-hover: #2c2f36; --border: rgba(255,255,255,.11); --text: #e6e7ea;
        --muted: #a8abb2; --accent: #2f6fe4; --accent-hover: #3b7bf0; --ok: #6fd69a; --err: #ff8a8a;
        --shadow: 0 8px 24px rgba(0,0,0,.45); all: initial; }
      * { box-sizing: border-box; font-family: 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif; }
      .bar { display: flex; align-items: stretch; height: 28px; border: 1px solid var(--border); border-radius: 4px;
        background: var(--bg); box-shadow: var(--shadow); color: var(--text); font-size: 13px; line-height: 18px; }
      button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 10px; cursor: pointer; color: inherit;
        white-space: nowrap; }
      button:hover { background: var(--bg-hover); }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      .main { border-radius: 3px 0 0 3px; font-weight: 500; }
      .main .logo { width: 16px; height: 16px; border-radius: 4px; background: var(--accent); display: grid; place-items: center; }
      .arrow, .close { padding: 0 6px; border-left: 1px solid var(--border); color: var(--muted); }
      .close { border-radius: 0 3px 3px 0; }
      .num { font-variant-numeric: tabular-nums; }
      .ok { color: var(--ok); } .err { color: var(--err); } .muted { color: var(--muted); }
      .menu { position: absolute; top: 32px; left: 0; min-width: 236px; padding: 4px 0; background: var(--bg);
        border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); color: var(--text); font-size: 12px; }
      .menu[hidden] { display: none; }
      .menu button { width: 100%; min-height: 28px; padding: 4px 12px; font-size: 12px; justify-content: space-between; }
      .menu .label { padding: 6px 12px 2px; font-size: 11px; font-weight: 600; letter-spacing: .06em;
        text-transform: uppercase; color: var(--muted); }
      .menu .check { color: var(--accent); }
      .menu label { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; color: var(--muted); }
      .menu input { accent-color: var(--accent); margin: 0; }
      .sep { height: 1px; margin: 4px 0; background: var(--border); }
      .spin { width: 12px; height: 12px; border: 2px solid var(--muted); border-top-color: transparent; border-radius: 50%;
        animation: s 0.8s linear infinite; }
      @keyframes s { to { transform: rotate(360deg); } }
    </style>
    <div class="bar" part="bar">
      <button class="main"><span class="logo"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1v5M2.5 4 5 6.5 7.5 4M2 8.5h6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg></span>
        <span class="text">YTA</span></button>
      <button class="arrow" aria-label="Escolher formato" aria-haspopup="menu" aria-expanded="false">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg></button>
      <button class="close" aria-label="Esconder neste vídeo">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" stroke-width="1.4"/></svg></button>
    </div>
    <div class="menu" role="menu" hidden></div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const mainBtn = $('.main');
  const textEl = $('.text');
  const arrowBtn = $('.arrow');
  const closeBtn = $('.close');
  const menu = $('.menu');

  let choice = { format: 'm4a', maxHeight: null, compat: false };
  chrome.storage.sync.get('choice').then(({ choice: c }) => {
    if (c) choice = c;
    render();
  });

  const choiceLabel = (c) =>
    c.format === 'video'
      ? `Vídeo ${c.maxHeight ? `${c.maxHeight}p` : 'melhor'}${c.compat ? ' · H.264' : ''}`
      : `Áudio ${c.format === 'opus' ? 'Opus' : c.format.toUpperCase()}`;

  /* ---------- Qual vídeo está sob o ponteiro ---------- */

  let video = null; // vídeo atual
  let videoUrl = null;
  let pointer = { x: 0, y: 0 };
  const hidden = new WeakSet(); // vídeos em que o usuário clicou no ×
  const jobs = new Map(); // url → { id, phase, percent, part, copy, error }

  function place() {
    if (!video || !video.isConnected) return hide();
    const r = video.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H || r.bottom < 0 || r.top > innerHeight) return hide();
    host.style.display = 'block';
    host.style.transform = `translate(${Math.max(4, r.left + 12)}px, ${Math.max(4, r.top + 12)}px)`;
  }
  function hide() {
    if (menuOpen()) return;
    host.style.display = 'none';
  }

  let ticking = false;
  // Coleção viva: contar os vídeos da página não custa nada. Sem vídeo, o movimento do mouse é
  // ignorado sem nenhum cálculo (o script roda em todas as páginas e quadros).
  const videos = document.getElementsByTagName('video');
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!videos.length && !video) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (e.composedPath().includes(host)) return; // sobre o próprio botão
        const hits = document.elementsFromPoint(pointer.x, pointer.y);
        const v = hits.find((el) => el.tagName === 'VIDEO') || findVideoBehind(hits);
        if (!v || hidden.has(v) || blocked) {
          if (!menuOpen()) {
            video = null;
            hide();
          }
          return;
        }
        if (v !== video) {
          video = v;
          closeMenu();
        }
        videoUrl = urlFor(v, hits) || videoUrl;
        render();
        place();
      });
    },
    { passive: true },
  );
  // Sites põem camadas por cima do <video>: procura um vídeo que contenha o ponto.
  function findVideoBehind() {
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      if (pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom) return v;
    }
    return null;
  }
  addEventListener('scroll', () => place(), { passive: true, capture: true });
  addEventListener('resize', () => place(), { passive: true });

  /* ---------- Estado do botão ---------- */

  function render() {
    const job = videoUrl ? jobs.get(videoUrl) : null;
    mainBtn.classList.remove('busy');
    if (!job) {
      textEl.innerHTML = `Baixar · ${choiceLabel(choice)}`;
      mainBtn.setAttribute('aria-label', `Baixar com o YTA: ${choiceLabel(choice)}`);
      return;
    }
    const pct = job.percent == null ? '' : ` <span class="num">${Math.floor(job.percent)}%</span>`;
    const states = {
      launching: '<span class="spin"></span> Abrindo o YTA…',
      sending: '<span class="spin"></span> Enviando…',
      queued: '<span class="muted">Na fila do YTA</span>',
      paused: '<span class="muted">Pausado no YTA</span>',
      listing: '<span class="spin"></span> Lendo a playlist…',
      preparing: '<span class="spin"></span> Buscando…',
      download: `<span class="spin"></span> Baixando${job.part === 'audio' ? ' áudio' : ''}${pct}`,
      convert: `<span class="spin"></span> ${job.copy === false ? 'Convertendo' : 'Finalizando'}${pct}`,
      done: '<span class="ok">Salvo</span> · Abrir pasta',
      error: `<span class="err">Falhou</span> · ${escapeHtml(job.error || 'ver no YTA')}`,
      cancelled: '<span class="muted">Cancelado</span> · Baixar de novo',
      offline: '<span class="err">YTA fechado</span> · Abrir o YTA',
      gone: `Baixar · ${choiceLabel(choice)}`,
    };
    textEl.innerHTML = states[job.phase] || states.queued;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]).slice(0, 60);
  }

  /* ---------- Ações ---------- */

  async function download(request) {
    const url = videoUrl;
    if (!url) {
      textEl.innerHTML = '<span class="err">Não achei o link deste vídeo</span>';
      setTimeout(render, 3000);
      return;
    }
    jobs.set(url, { phase: 'sending' });
    render();
    let r = await ask({ type: 'enqueue', request: { url, ...request } });
    if (r?.offline) {
      jobs.set(url, { phase: 'launching' });
      render();
      r = await launchAndRetry({ url, ...request });
    }
    if (!r?.ok) {
      jobs.set(url, { phase: r?.offline ? 'offline' : 'error', error: r?.error });
      render();
      return;
    }
    jobs.set(url, { id: r.id, phase: 'queued' });
    render();
    follow(url);
  }

  /** YTA fechado: yta://start abre o app (o Chrome pergunta "Abrir o YTA?" na 1ª vez). */
  async function launchAndRetry(request) {
    const a = document.createElement('a');
    a.href = 'yta://start';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const p = await ask({ type: 'ping' });
      if (p?.ok) return ask({ type: 'enqueue', request });
    }
    return { ok: false, offline: true };
  }

  async function follow(url) {
    for (;;) {
      await sleep(1000);
      const job = jobs.get(url);
      if (!job?.id) return;
      const s = await ask({ type: 'status', id: job.id });
      if (!s) continue;
      jobs.set(url, { ...job, phase: s.phase, percent: s.percent, part: s.part, copy: s.copy, error: s.error });
      if (url === videoUrl) render();
      if (['done', 'error', 'cancelled', 'gone', 'offline'].includes(s.phase)) return;
    }
  }

  mainBtn.addEventListener('click', () => {
    const job = videoUrl && jobs.get(videoUrl);
    if (job?.phase === 'done') return ask({ type: 'reveal', id: job.id });
    if (job?.phase === 'error' || job?.phase === 'offline') {
      if (job.phase === 'offline') jobs.delete(videoUrl);
      else return ask({ type: 'show' });
    }
    if (job && !['cancelled', 'gone', 'offline'].includes(job.phase)) return; // já está andando
    download(choice);
  });

  closeBtn.addEventListener('click', () => {
    if (video) hidden.add(video);
    closeMenu();
    host.style.display = 'none';
  });

  /* ---------- Menu ---------- */

  const menuOpen = () => !menu.hidden;
  function closeMenu() {
    menu.hidden = true;
    arrowBtn.setAttribute('aria-expanded', 'false');
  }

  async function openMenu() {
    menu.hidden = false;
    arrowBtn.setAttribute('aria-expanded', 'true');
    buildMenu(null);
    if (!videoUrl) return;
    const p = await ask({ type: 'probe', url: videoUrl });
    if (menuOpen()) buildMenu(p?.ok ? p.heights : []);
  }

  function buildMenu(heights) {
    const item = (label, active, onClick) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span>${label}</span>${active ? '<span class="check">✓</span>' : ''}`;
      b.addEventListener('click', onClick);
      return b;
    };
    const pick = (c) => {
      choice = c;
      chrome.storage.sync.set({ choice });
      closeMenu();
      render();
      download(choice);
    };
    menu.replaceChildren();
    const audio = document.createElement('div');
    audio.className = 'label';
    audio.textContent = 'Áudio';
    menu.append(audio);
    for (const f of FORMATS) menu.append(item(f.label.replace('Áudio ', ''), choice.format === f.key, () => pick({ ...choice, format: f.key })));
    const sep = document.createElement('div');
    sep.className = 'sep';
    const vid = document.createElement('div');
    vid.className = 'label';
    vid.textContent = 'Vídeo';
    menu.append(sep, vid);
    menu.append(item('Melhor disponível', choice.format === 'video' && !choice.maxHeight, () => pick({ ...choice, format: 'video', maxHeight: null })));
    if (heights === null) {
      const wait = document.createElement('div');
      wait.className = 'label';
      wait.style.textTransform = 'none';
      wait.textContent = 'Carregando resoluções…';
      menu.append(wait);
    } else {
      for (const h of heights.filter((x) => x <= 2160)) {
        menu.append(item(`${h}p`, choice.format === 'video' && choice.maxHeight === h, () => pick({ ...choice, format: 'video', maxHeight: h })));
      }
    }
    const compat = document.createElement('label');
    compat.innerHTML = `<input type="checkbox" ${choice.compat ? 'checked' : ''}> Compatível com WhatsApp (H.264)`;
    compat.querySelector('input').addEventListener('change', (e) => {
      choice = { ...choice, compat: e.target.checked };
      chrome.storage.sync.set({ choice });
      render();
    });
    menu.append(compat);
    const sep2 = document.createElement('div');
    sep2.className = 'sep';
    menu.append(sep2, item(`Não mostrar em ${topHost.replace(/^www\./, '')}`, false, async () => {
      const { hiddenSites = [] } = await chrome.storage.sync.get('hiddenSites');
      await chrome.storage.sync.set({ hiddenSites: [...new Set([...hiddenSites, topHost])] });
      closeMenu();
      host.style.display = 'none';
    }));
  }

  arrowBtn.addEventListener('click', () => (menuOpen() ? closeMenu() : openMenu()));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  document.addEventListener('pointerdown', (e) => {
    if (!e.composedPath().includes(host)) closeMenu();
  });

  // Clique direito "Baixar com o YTA" com o app fechado: abre e tenta de novo.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'launch-and-enqueue') launchAndRetry(msg.request);
  });
})();
