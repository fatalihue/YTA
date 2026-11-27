// Botão "Baixar" sobre os vídeos de qualquer site (como o do IDM). YouTube e Instagram têm regras
// próprias para achar o link de cada vídeo; nos outros sites vai o endereço da página (ou do
// player embutido) e o serviço de fundo junta o arquivo de vídeo que a página tocava.
// - Clique na pílula: baixa com a última escolha. Setinha: menu com áudio/vídeo/resolução,
//   WhatsApp e esconder (neste vídeo / neste site).
// - A pílula mostra o andamento (na fila → anel com o % → salvo · abrir pasta).
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

  // A prévia que toca ao passar o mouse numa miniatura também é um ytd-player (#inline-preview-player).
  const YT_PREVIEW = '#inline-preview-player, ytd-video-preview, #video-preview';
  const YT_LINK = 'a[href*="/watch?v="], a[href*="/shorts/"]';

  function youtubeUrl(video, hits) {
    // Miniatura (o botão fica preso a ela): o link é o dela.
    if (video.matches?.(YT_LINK)) return new URL(video.getAttribute('href'), location.origin).href;
    // Player principal (página do vídeo ou Shorts): o link é o da própria página.
    if (!video.closest(YT_PREVIEW) && video.closest('#movie_player, ytd-player, #shorts-player, ytd-reel-video-renderer')) {
      const u = new URL(location.href);
      if (u.pathname === '/watch' && u.searchParams.get('v')) return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
      const s = u.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (s) return `https://www.youtube.com/shorts/${s[1]}`;
      // Player do YouTube embutido em outro site.
      const e = u.pathname.match(/^\/embed\/([\w-]{11})/);
      if (e) return `https://www.youtube.com/watch?v=${e[1]}`;
    }
    // Prévia na home/busca: o link da miniatura sob o ponteiro.
    const a = hits.map((el) => el.closest?.(YT_LINK)).find(Boolean);
    return a ? new URL(a.getAttribute('href'), location.origin).href : null;
  }

  function instagramUrl(video) {
    // Stories e destaques: tela própria, sem post em volta; o link é o da página
    // (/stories/conta/123…/ ou /stories/highlights/123…/). Exigem login no YTA.
    const story = location.pathname.match(/^\/stories\/[\w.-]+(?:\/\d+)?/);
    if (story) {
      // Story compartilhado com você: o passe (?dlrf=…) libera o story de conta privada.
      const pass = new URLSearchParams(location.search).get('dlrf');
      return `https://www.instagram.com${story[0]}/${pass ? `?dlrf=${encodeURIComponent(pass)}` : ''}`;
    }
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

  // Ícones (traço do lucide, como no app).
  const svg = (body, size = 14) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    mark: '<span class="mark"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M6 20h12"/></svg></span>',
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    up: svg('<path d="m18 15-6-6-6 6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
    pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', 16),
    check: svg('<path d="M20 6 9 17l-5-5"/>', 16),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>', 16),
    stop: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', 16),
    tick: svg('<path d="M20 6 9 17l-5-5"/>', 14),
  };
  /** Anel de andamento (16 px): trilho + arco do %; sem %, gira um pedaço. */
  const ring = (pct) =>
    pct == null
      ? '<svg class="spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" style="stroke: var(--track)" stroke-width="2"/><circle cx="8" cy="8" r="6.5" fill="none" style="stroke: var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="10 40.84"/></svg>'
      : `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" style="stroke: var(--track)" stroke-width="2"/><circle cx="8" cy="8" r="6.5" fill="none" style="stroke: var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="${((Math.max(0, Math.min(100, pct)) / 100) * 40.84).toFixed(2)} 40.84" transform="rotate(-90 8 8)"/></svg>`;

  const host = document.createElement('yta-overlay');
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      /* Tokens do YTA 2.0 (Grafite, tema escuro: o botão fica sobre vídeo), só para esta extensão. */
      :host { --card: #17181b; --elevated: #202226; --open: #26282d; --border: #2e3136; --strong: #3a3d44;
        --text: #edeef0; --muted: #a7acb4; --faint: #868c95; --accent: #7c9cff; --track: #34373d; --ok: #5cd38a;
        --err: #ff7b7b; --ink: #f2f3f5; --ink-fg: #0f1012; all: initial; }
      * { box-sizing: border-box; font-family: 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif; }
      .pill { display: flex; align-items: center; height: 32px; border: 1px solid var(--strong); border-radius: 16px;
        background: var(--card); box-shadow: 0 6px 20px rgba(0,0,0,.35); color: var(--text); font-size: 13px;
        line-height: 18px; overflow: hidden; }
      button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; cursor: pointer;
        color: inherit; white-space: nowrap; }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      .main { height: 30px; gap: 8px; padding: 0 12px 0 6px; font-weight: 500; }
      .main:hover, .arrow:hover { background: var(--elevated); }
      .lead { display: inline-flex; width: 20px; justify-content: center; flex-shrink: 0; }
      .mark { width: 20px; height: 20px; border-radius: 10px; background: var(--ink); color: var(--ink-fg);
        display: inline-flex; align-items: center; justify-content: center; }
      .text { display: inline-flex; align-items: center; gap: 6px; }
      .vr { width: 1px; height: 18px; background: var(--strong); flex-shrink: 0; }
      .arrow { width: 34px; height: 30px; justify-content: center; color: var(--muted); }
      .arrow[aria-expanded="true"] { background: var(--open); color: var(--text); }
      .pill.busy .vr, .pill.busy .arrow { display: none; }
      .num { font-variant-numeric: tabular-nums; }
      .muted { color: var(--muted); font-weight: 400; }
      .ok { color: var(--ok); } .err { color: var(--err); }
      .spin { animation: s 0.8s linear infinite; }
      @keyframes s { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
      .menu { position: absolute; top: 40px; left: 0; width: 260px; padding: 6px; background: var(--card);
        border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45);
        color: var(--text); font-size: 13px; line-height: 18px; display: flex; flex-direction: column;
        overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--strong) transparent; }
      .menu[hidden] { display: none; }
      .menu .item { flex-shrink: 0; height: 32px; padding: 0 10px; border-radius: 8px; gap: 8px; width: 100%; }
      .menu .item:hover, .menu .item:focus-visible { background: var(--elevated); }
      .menu .name { flex: 1; }
      .menu .hint { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
      .menu .tick { width: 14px; display: inline-flex; color: var(--text); }
      .menu .soft { color: var(--muted); }
      .label { flex-shrink: 0; padding: 8px 10px 4px; font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: .06em;
        text-transform: uppercase; color: var(--faint); }
      .note { flex-shrink: 0; padding: 6px 10px; font-size: 12px; line-height: 16px; color: var(--faint); }
      .sep { height: 1px; margin: 6px 4px; background: #26282c; flex-shrink: 0; }
      .row { flex-shrink: 0; height: 36px; padding: 0 10px; display: flex; align-items: center; gap: 8px; }
      .row span { flex: 1; }
      .switch { width: 30px; height: 18px; flex-shrink: 0; border-radius: 9px; border: 1px solid #4a4e55;
        position: relative; padding: 0; }
      .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
        border-radius: 6px; background: var(--muted); }
      .switch[aria-checked="true"] { background: var(--ink); border-color: var(--ink); }
      .switch[aria-checked="true"]::after { left: 14px; background: var(--ink-fg); }
      .switch:focus-visible { outline-offset: 2px; }
    </style>
    <div class="pill">
      <button class="main"><span class="lead"></span><span class="text"></span></button>
      <span class="vr"></span>
      <button class="arrow" aria-label="Escolher formato" aria-haspopup="menu" aria-expanded="false"></button>
    </div>
    <div class="menu" role="menu" aria-label="Formato" hidden></div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const pill = $('.pill');
  const mainBtn = $('.main');
  const leadEl = $('.lead');
  const textEl = $('.text');
  const arrowBtn = $('.arrow');
  const menu = $('.menu');
  arrowBtn.innerHTML = ICON.down;

  let choice = { format: 'm4a', maxHeight: null, compat: false };
  chrome.storage.sync.get('choice').then(({ choice: c }) => {
    if (c) choice = c;
    render();
  });

  const AUDIO = { m4a: 'M4A', opus: 'Opus', mp3: 'MP3' };
  const choiceLabel = (c) =>
    c.format === 'video' ? `Vídeo${c.maxHeight ? ` ${c.maxHeight}p` : ''}${c.compat ? ' · H.264' : ''}` : AUDIO[c.format] || c.format;

  /* ---------- Qual vídeo está sob o ponteiro ---------- */

  let video = null; // vídeo atual (no YouTube, pode ser a miniatura: ver targetAt)
  let videoUrl = null;
  let lastHits = []; // elementos sob o ponteiro na última vez (YouTube: link da miniatura)

  /*
   * O link certo é o do vídeo que está NA TELA agora. Stories, Shorts e reels trocam de vídeo sem
   * o mouse se mexer (setas, rolagem, avanço automático) — e o endereço da página muda junto.
   * Antes o link só era recalculado no movimento do mouse: passando para o próximo story com o
   * ponteiro parado (ou já sobre o botão), o botão seguia com o link do anterior.
   */
  function refreshUrl() {
    if (!video || !video.isConnected) return;
    const u = urlFor(video, lastHits);
    if (u && u !== videoUrl) {
      videoUrl = u;
      closeMenu();
      render();
    }
  }
  // Barato: só roda com o botão visível.
  setInterval(() => {
    if (host.style.display === 'block') refreshUrl();
  }, 400);

  /** Destaque do Instagram: o endereço é do destaque inteiro (não muda ao passar os itens). */
  const isHighlight = () => isInstagram && /^\/stories\/highlights\//.test(location.pathname);
  let pointer = { x: 0, y: 0 };
  const hidden = new WeakSet(); // vídeos em que o usuário escolheu "Esconder neste vídeo"
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
  // ignorado sem nenhum cálculo (o script roda em todas as páginas e quadros). No YouTube as
  // miniaturas contam como vídeo (a prévia só nasce depois do ponteiro parar).
  const videos = document.getElementsByTagName('video');
  document.addEventListener(
    'pointermove',
    (e) => {
      // Só o mouse de verdade: uma página não pode mover o botão nem baixar sem o usuário.
      if (!e.isTrusted || (!videos.length && !video && !isYouTube)) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (e.composedPath().includes(host)) return; // sobre o próprio botão
        const hits = document.elementsFromPoint(pointer.x, pointer.y);
        const v = targetAt(hits);
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
        lastHits = hits;
        videoUrl = urlFor(v, hits) || videoUrl;
        render();
        place();
      });
    },
    { passive: true },
  );
  /*
   * O que está sob o ponteiro. No YouTube, numa miniatura, é a própria miniatura (o link): a
   * prévia que o YouTube toca por cima dela vai e volta — some quando o ponteiro chega no botão
   * (o botão cobre a miniatura e o YouTube entende que o mouse saiu) e só nasce depois do ponteiro
   * parar. Preso à prévia, o botão sumia no caminho até ele; preso à miniatura, fica parado.
   */
  function targetAt(hits) {
    const v = hits.find((el) => el.tagName === 'VIDEO') || findVideoBehind();
    if (!isYouTube || (v && !v.closest(YT_PREVIEW))) return v; // player principal: o próprio vídeo
    for (const el of hits) {
      const a = el.closest?.(YT_LINK);
      if (!a) continue;
      const r = a.getBoundingClientRect();
      if (r.width >= MIN_W && r.height >= MIN_H) return a; // a miniatura (o título é baixo demais)
    }
    return v;
  }

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

  // Andando, o botão vira um selo de status (sem a setinha; clique abre o YTA). Parado: baixa.
  const BUSY = ['launching', 'sending', 'queued', 'paused', 'listing', 'preparing', 'download', 'convert'];

  function paint(lead, html, label, busy = false) {
    leadEl.innerHTML = lead;
    textEl.innerHTML = html;
    mainBtn.setAttribute('aria-label', label);
    pill.classList.toggle('busy', busy);
    if (busy) closeMenu();
  }

  function render() {
    const job = videoUrl ? jobs.get(videoUrl) : null;
    if (!job || job.phase === 'gone') {
      // Destaque: o yt-dlp não tem como escolher o item, então o rótulo diz que vem tudo.
      const what = isHighlight() ? 'Baixar destaque inteiro' : 'Baixar';
      return paint(ICON.mark, `${what} <span class="muted">${choiceLabel(choice)}</span>`, `${what} com o YTA: ${choiceLabel(choice)}`);
    }
    const pct = job.percent == null ? null : Math.floor(job.percent);
    const num = pct == null ? '' : ` <span class="num">${pct}%</span>`;
    switch (job.phase) {
      case 'launching':
        return paint(ring(null), 'Abrindo o YTA…', 'Abrindo o YTA', true);
      case 'sending':
        return paint(ring(null), 'Enviando…', 'Enviando para o YTA', true);
      case 'listing':
        return paint(ring(null), 'Lendo a playlist…', 'Lendo a playlist no YTA; abrir o YTA', true);
      case 'preparing':
        return paint(ring(null), 'Buscando…', 'Buscando o vídeo no YTA; abrir o YTA', true);
      case 'paused':
        return paint(`<span class="muted">${ICON.pause}</span>`, '<span class="muted">Pausado no YTA</span>', 'Pausado no YTA; abrir o YTA', true);
      case 'download': {
        const what = `Baixando${job.part === 'audio' ? ' áudio' : ''}`;
        return paint(ring(pct), `${what}${num}`, `${what} ${pct ?? ''}%; abrir o YTA`, true);
      }
      case 'convert': {
        const what = job.copy === false ? 'Convertendo' : 'Finalizando';
        return paint(ring(pct), `${what}${num}`, `${what}; abrir o YTA`, true);
      }
      case 'done':
        return paint(`<span class="ok">${ICON.check}</span>`, '<span class="ok">Salvo</span><span class="vr"></span>Abrir pasta', 'Salvo. Abrir a pasta');
      case 'error':
        return paint(
          `<span class="err">${ICON.alert}</span>`,
          `<span class="err">Falhou</span><span class="muted">· ${escapeHtml(job.error || 'ver no YTA')}</span>`,
          `Falhou: ${job.error || ''}. Abrir o YTA`,
        );
      case 'cancelled':
        return paint(`<span class="muted">${ICON.stop}</span>`, '<span class="muted">Cancelado ·</span> Baixar de novo', 'Cancelado. Baixar de novo');
      case 'offline':
        return paint(`<span class="err">${ICON.alert}</span>`, '<span class="err">YTA fechado</span> · Abrir o YTA', 'YTA fechado. Abrir o YTA e baixar');
      default: // queued (e o que vier de novo)
        return paint(`<span class="muted">${ICON.clock}</span>`, '<span class="muted">Na fila do YTA</span>', 'Na fila do YTA; abrir o YTA', true);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]).slice(0, 60);
  }

  const dec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const bytes = (n) =>
    !Number.isFinite(n) || n <= 0 ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${dec.format(n / 1048576)} MB` : `${dec.format(n / 1073741824)} GB`;

  /* ---------- Ações ---------- */

  async function download(request) {
    const url = videoUrl;
    if (!url) {
      paint(`<span class="err">${ICON.alert}</span>`, '<span class="err">Não achei o link deste vídeo</span>', 'Não achei o link deste vídeo');
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

  mainBtn.addEventListener('click', (e) => {
    if (!e.isTrusted) return; // .click() da página não baixa nada
    refreshUrl(); // o vídeo pode ter trocado desde o último movimento do mouse
    const job = videoUrl && jobs.get(videoUrl);
    if (job?.phase === 'done') return ask({ type: 'reveal', id: job.id });
    if (job?.phase === 'error') return ask({ type: 'show' });
    if (job?.phase === 'launching' || job?.phase === 'sending') return; // já está indo
    if (job && BUSY.includes(job.phase)) return ask({ type: 'show' }); // andando: o YTA mostra o resto
    if (job?.phase === 'offline') jobs.delete(videoUrl);
    download(choice);
  });

  /* ---------- Menu (setinha): formato, WhatsApp e esconder ---------- */

  const menuOpen = () => !menu.hidden;
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    arrowBtn.setAttribute('aria-expanded', 'false');
    arrowBtn.innerHTML = ICON.down;
  }

  // Resoluções e tamanhos do último link consultado (reabrir o menu não espera de novo).
  let probed = { url: null, info: null };
  async function openMenu(viaKeyboard) {
    // Cabe na janela: perto do pé da página o menu rola em vez de sair da tela.
    menu.style.maxHeight = `${Math.max(160, innerHeight - pill.getBoundingClientRect().bottom - 20)}px`;
    menu.hidden = false;
    arrowBtn.setAttribute('aria-expanded', 'true');
    arrowBtn.innerHTML = ICON.up;
    const url = videoUrl;
    const cached = url && probed.url === url ? probed.info : null;
    buildMenu(cached, Boolean(url) && !cached);
    if (viaKeyboard) menu.querySelector('button')?.focus();
    if (!url || cached) return;
    const p = await ask({ type: 'probe', url });
    if (p?.ok) probed = { url, info: p };
    if (menuOpen() && videoUrl === url) buildMenu(p?.ok ? p : null, false);
  }

  const VIDEO_CAPS = [2160, 1440, 1080, 720, 480, 360];
  function buildMenu(info, loading) {
    const focused = root.activeElement?.dataset?.key; // reconstruir não tira o foco do teclado
    const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text || '' });
    const item = (key, name, hint, checked, onClick, cls = '') => {
      const b = el('button', `item ${cls}`);
      b.dataset.key = key;
      b.setAttribute('role', checked == null ? 'menuitem' : 'menuitemradio');
      if (checked != null) b.setAttribute('aria-checked', String(checked));
      b.innerHTML = `<span class="name">${name}</span>${hint ? `<span class="hint">${hint}</span>` : ''}${checked != null ? `<span class="tick">${checked ? ICON.tick : ''}</span>` : ''}`;
      b.addEventListener('click', (e) => e.isTrusted && onClick(e));
      return b;
    };
    const pick = (c) => {
      choice = c;
      chrome.storage.sync.set({ choice });
      closeMenu();
      render();
      download(choice);
    };
    const isVideo = choice.format === 'video'; // (video, sem sufixo, é o elemento sob o ponteiro)
    const sizes = info?.sizes || {};

    menu.replaceChildren(el('div', 'label', 'Áudio'));
    for (const [key, name] of Object.entries(AUDIO)) {
      const hint = key === 'mp3' ? 'convertido' : sizes[key] ? `~${bytes(sizes[key])}` : 'original';
      menu.append(item(key, name, hint, choice.format === key, () => pick({ ...choice, format: key })));
    }

    menu.append(el('div', 'sep'), el('div', 'label', 'Vídeo'));
    // Como no app: com as resoluções do vídeo, "Melhor" diz qual é e as outras trazem o tamanho;
    // sem elas, tetos ("Até 720p").
    const heights = (info?.heights || []).filter((h) => h <= 4320);
    const exact = heights.length > 0;
    menu.append(item('best', 'Melhor', exact ? `${heights[0]}p` : '', isVideo && !choice.maxHeight, () => pick({ ...choice, format: 'video', maxHeight: null })));
    if (loading) menu.append(el('div', 'note', 'Carregando resoluções…'));
    else
      for (const h of exact ? heights.slice(1) : VIDEO_CAPS) {
        const size = exact ? bytes(info.videoSizes?.[h]) : '';
        menu.append(item(`h${h}`, exact ? `${h}p` : `Até ${h}p`, size ? `~${size}` : '', isVideo && choice.maxHeight === h, () => pick({ ...choice, format: 'video', maxHeight: h })));
      }

    const row = el('div', 'row');
    row.append(el('span', '', 'Compatível com WhatsApp'));
    const sw = el('button', 'switch');
    sw.dataset.key = 'compat';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', 'Compatível com WhatsApp (vídeo em H.264)');
    sw.setAttribute('aria-checked', String(Boolean(choice.compat)));
    sw.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      choice = { ...choice, compat: !choice.compat };
      chrome.storage.sync.set({ choice });
      sw.setAttribute('aria-checked', String(choice.compat));
      render();
    });
    row.append(sw);
    menu.append(el('div', 'sep'), row, el('div', 'sep'));

    menu.append(
      item('hide', 'Esconder neste vídeo', '', null, () => {
        if (video) hidden.add(video);
        closeMenu();
        host.style.display = 'none';
      }, 'soft'),
      item('site', `Não mostrar em ${topHost.replace(/^www\./, '')}`, '', null, async () => {
        const { hiddenSites = [] } = await chrome.storage.sync.get('hiddenSites');
        await chrome.storage.sync.set({ hiddenSites: [...new Set([...hiddenSites, topHost])] });
        closeMenu();
        host.style.display = 'none';
      }, 'soft'),
    );
    if (focused) menu.querySelector(`[data-key="${focused}"]`)?.focus();
  }

  // Teclado: ↑↓ andam pelos itens, Esc fecha e volta para a setinha.
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('button')];
    const i = list.indexOf(root.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      arrowBtn.focus();
    }
  });
  // detail 0 = ativado pelo teclado: o foco entra no menu.
  arrowBtn.addEventListener('click', (e) => e.isTrusted && (menuOpen() ? closeMenu() : openMenu(e.detail === 0)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  document.addEventListener('pointerdown', (e) => {
    if (!e.composedPath().includes(host)) closeMenu();
  });

  // Clique direito "Baixar com o YTA" com o app fechado: abre e tenta de novo.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'launch-and-enqueue') launchAndRetry(msg.request);
  });
})();
