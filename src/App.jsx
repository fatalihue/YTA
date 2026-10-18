import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FolderOpen, Loader2, Pause, Play, Puzzle } from 'lucide-react';
import { Button, Field, IconButton, LinkButton, SegmentedControl } from './ui.jsx';
import { QueueItem } from './QueueItem.jsx';
import { HistoryItem } from './HistoryItem.jsx';

const api = window.yta;

const FORMATS = [
  { value: 'm4a', label: 'M4A' },
  { value: 'opus', label: 'Opus' },
  { value: 'mp3', label: 'MP3' },
  { value: 'video', label: 'Vídeo' },
];

const MP3_QUALITIES = [
  { value: 128, label: '128 kbps' },
  { value: 192, label: '192 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 320, label: '320 kbps' },
];

// Tetos de resolução quando há vários links (cada vídeo tem as suas resoluções).
const VIDEO_CAPS = [4320, 2160, 1440, 1080, 720, 480, 360];
const heightLabel = (h) => (h === 4320 ? '8K (4320p)' : h === 2160 ? '4K (2160p)' : h === 1080 ? '1080p (Full HD)' : h === 720 ? '720p (HD)' : `${h}p`);

const YOUTUBE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\/\S+$/i;
// Instagram: posts, reels, IGTV e stories (stories exigem login).
const INSTAGRAM = /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reels?|tv|stories)\/\S+$/i;
// Qualquer outro site: o yt-dlp reconhece ~1.800 e tem um extrator genérico para o resto.
const WEB = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+\S*$/i;
const SUPPORTED = (url) => YOUTUBE.test(url) || INSTAGRAM.test(url) || WEB.test(url);
const ACTIVE = ['preparing', 'download', 'convert'];
const PENDING = ['queued', 'listing', 'paused', ...ACTIVE]; // ainda vai baixar (é o que a fila salva guarda)
// Itens processados ao mesmo tempo: sobrepõe as consultas ao YouTube e usa mais núcleos na conversão.
const PARALLEL = 3;
const HISTORY_SHOWN = 300; // o histórico guarda 1.000; a lista mostra os mais recentes

/** ID do vídeo, para não enfileirar o mesmo vídeo duas vezes. */
function videoKey(url) {
  const ig = url.match(/instagram\.com\/(?:p|reels?|tv)\/([\w-]+)/i);
  if (ig) return `ig:${ig[1]}`;
  const m = YOUTUBE.test(url) && url.match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/);
  return m ? m[1] : url.replace(/#.*$/, '');
}
/** Chave do histórico: o mesmo vídeo em outro formato (M4A × MP3 × vídeo) é outro download. */
const historyKey = (url, format) => `${format}:${videoKey(url)}`;

/**
 * Playlist do YouTube no link. Mix/rádio (RD…) são infinitos e listas pessoais (WL, LL) exigem
 * conta: ficam como vídeo único. `only`: o link é só da playlist (sem um vídeo escolhido).
 */
function playlistOf(url) {
  if (!YOUTUBE.test(url)) return null;
  let u;
  try {
    u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const list = u.searchParams.get('list');
  if (!list || /^(RD|UL|WL$|LL$)/.test(list)) return null;
  return { only: u.pathname === '/playlist' || !u.searchParams.get('v') };
}
const playlistUrl = (url) => {
  const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  return `https://www.youtube.com/playlist?list=${u.searchParams.get('list')}`;
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const shortUrl = (url) => url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48);

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* preferência perdida não impede o uso */
  }
}

let nextId = 1;

export default function App() {
  const [links, setLinks] = useState('');
  const [linksError, setLinksError] = useState('');
  // Aviso na linha de ajuda dos links: { text, actions: [{ label, run }] }.
  const [notice, setNotice] = useState(null);
  const [clipOffer, setClipOffer] = useState(null); // links copiados oferecidos para colar
  // Pastas separadas para áudio e vídeo (a antiga "folder" vira a de áudio).
  const [folderAudio, setFolderAudio] = useState(() => load('folderAudio', load('folder', '')));
  const [folderVideo, setFolderVideo] = useState(() => load('folderVideo', ''));
  const [format, setFormat] = useState(() => load('format', 'm4a'));
  const [bitrate, setBitrate] = useState(() => load('mp3Bitrate', 256));
  const [maxHeight, setMaxHeight] = useState(() => load('videoHeight', null)); // null = melhor
  const [compat, setCompat] = useState(() => load('videoCompat', false)); // garantir H.264 + AAC
  const [probed, setProbed] = useState(null); // { url, state: 'loading'|'ok'|'error', heights }
  const [tool, setTool] = useState({ state: 'pending' });
  const [update, setUpdate] = useState({ state: 'idle' });
  const [loggedIn, setLoggedIn] = useState(false);
  // idle | waiting (janela do navegador aberta) | checking; browser = Chrome/Edge; error da última tentativa
  const [loginState, setLoginState] = useState({ state: 'idle', browser: null, error: '', sites: {} });
  const [items, setItems] = useState([]);
  const [view, setView] = useState('queue'); // queue | history
  const [history, setHistory] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const running = useRef(new Set()); // ids em andamento
  const listing = useRef(new Set()); // playlists sendo lidas
  const pausing = useRef(new Set()); // em andamento que pedimos para pausar (o resultado volta como cancelado)
  const textareaRef = useRef(null);
  const lastClip = useRef(''); // texto da área de transferência já oferecido (não oferece de novo)
  // Valores atuais para assinantes criados uma vez só (extensão, arrastar, área de transferência).
  const settingsRef = useRef({});
  const itemsRef = useRef([]);
  const linksRef = useRef('');
  const folder = format === 'video' ? folderVideo : folderAudio;
  settingsRef.current = { folderAudio, folderVideo, format, bitrate, maxHeight, compat };
  itemsRef.current = items;
  linksRef.current = links;

  const patch = (id, change) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...(typeof change === 'function' ? change(it) : change) } : it)));

  /** Um item da fila com as escolhas atuais (ou as de `over`). */
  function makeItem(url, over = {}) {
    const s = settingsRef.current;
    const fmt = over.format || s.format;
    return {
      id: nextId++,
      uid: uid(),
      url,
      format: fmt,
      folder: over.folder || (fmt === 'video' ? s.folderVideo : s.folderAudio),
      bitrate: over.bitrate || s.bitrate,
      maxHeight: fmt === 'video' ? (over.maxHeight === undefined ? s.maxHeight : over.maxHeight) : null,
      compat: fmt === 'video' && (over.compat === undefined ? s.compat : Boolean(over.compat)),
      key: historyKey(url, fmt),
      prefix: over.prefix || '',
      kind: over.kind || 'video',
      mediaUrl: over.mediaUrl || null,
      referer: over.referer || null,
      pageTitle: over.pageTitle || null,
      phase: over.kind === 'playlist' ? 'listing' : 'queued',
      title: over.title || null,
      progress: {},
    };
  }
  const isPending = (url, format) =>
    itemsRef.current.some((it) => PENDING.includes(it.phase) && it.kind !== 'playlist' && historyKey(it.url, it.format) === historyKey(url, format));

  useEffect(() => {
    api.toolStatus().then(setTool);
    api.updateState().then(setUpdate);
    const offUpdate = api.onUpdateState(setUpdate);
    api.loginStatus().then((r) => {
      setLoggedIn(r.loggedIn);
      setLoginState((s) => ({ ...s, browser: r.browser, sites: r.sites || {} }));
    });
    const offLogin = api.onLoginState((e) => setLoginState((s) => ({ ...s, state: e.state, browser: e.browser || s.browser })));
    const offTool = api.onToolStatus(setTool);
    const offJob = api.onJobEvent((e) => {
      if (e.type === 'meta') patch(e.id, { title: e.title, phase: 'download', retry: null });
      else if (e.type === 'retry') patch(e.id, { phase: 'preparing', progress: {}, retry: e.login ? { login: true } : e.media ? { media: true } : { attempt: e.attempt, max: e.max } });
      else if (e.type === 'target') patch(e.id, { file: e.file });
      else if (e.type === 'resolution') patch(e.id, { height: e.height });
      else if (e.type === 'progress') {
        const { id, type, stage, ...p } = e;
        // Ao trocar de etapa o progresso recomeça do zero.
        patch(id, (it) =>
          ACTIVE.includes(it.phase) ? { phase: stage, progress: { ...(it.phase === stage ? it.progress : {}), ...p } } : {},
        );
      }
    });
    // Pedido da extensão (botão no vídeo): entra na mesma fila, com a pasta do tipo (áudio/vídeo).
    const offExternal = api.onExternalAdd((req) => {
      const url = String(req.url || '').trim();
      if (!SUPPORTED(url)) {
        api.externalAdded({ reqId: req.reqId, ok: false, error: 'O YTA ainda não baixa deste site.' });
        return;
      }
      const fmt = ['m4a', 'opus', 'mp3', 'video'].includes(req.format) ? req.format : settingsRef.current.format;
      const same = itemsRef.current.find(
        (it) => PENDING.includes(it.phase) && it.kind !== 'playlist' && historyKey(it.url, it.format) === historyKey(url, fmt),
      );
      if (same) {
        api.externalAdded({ reqId: req.reqId, ok: true, id: same.id, existing: true });
        return;
      }
      const item = makeItem(url, {
        format: fmt,
        bitrate: Number(req.bitrate) || undefined,
        maxHeight: req.maxHeight,
        compat: req.compat,
        // Arquivo de vídeo que a página tocava (plano B), a página e o título dela.
        mediaUrl: req.mediaUrl,
        referer: req.referer,
        pageTitle: req.title,
      });
      itemsRef.current = [...itemsRef.current, item];
      setItems((list) => [...list, item]);
      api.externalAdded({ reqId: req.reqId, ok: true, id: item.id });
    });
    const offHistory = api.onHistoryChanged(() => refreshHistoryRef.current());
    // A fila que estava pendente ao fechar volta (e retoma os pedaços já baixados).
    api.queueLoad().then((saved) => {
      const restored = (saved || [])
        .filter((it) => it && it.url && it.uid)
        .map((it) => ({ ...it, id: nextId++, phase: it.paused ? 'paused' : it.kind === 'playlist' ? 'listing' : 'queued', progress: {}, error: null, retry: null }));
      if (restored.length) setItems((list) => [...restored, ...list]);
    });
    api.rendererReady();
    // Pastas salvas que sumiram voltam para Música e Vídeos.
    (async () => {
      const special = await api.specialFolders();
      const a = load('folderAudio', load('folder', ''));
      // Só troca se ninguém escolheu outra pasta enquanto a verificação rodava.
      if (!a || !(await api.folderExists(a))) setFolderAudio((cur) => (cur === a ? special.music : cur));
      const v = load('folderVideo', '');
      if (!v || !(await api.folderExists(v))) setFolderVideo((cur) => (cur === v ? special.videos : cur));
    })();
    return () => {
      offTool();
      offJob();
      offExternal();
      offUpdate();
      offLogin();
      offHistory();
    };
  }, []);

  /* ---------- Histórico ---------- */
  const refreshHistoryRef = useRef(() => {});
  refreshHistoryRef.current = () => {
    if (view === 'history') api.historyList().then(setHistory);
  };
  useEffect(() => {
    if (view === 'history') api.historyList().then(setHistory);
  }, [view]);

  /* ---------- Processo principal: estado para a extensão e fila salva (agrupados) ---------- */
  const reportTimer = useRef(null);
  const savedQueue = useRef(null); // última fila gravada (evita regravar sem mudança)
  useEffect(() => {
    if (reportTimer.current) return; // já há um envio marcado; ele lê a fila mais recente
    reportTimer.current = setTimeout(() => {
      reportTimer.current = null;
      const list = itemsRef.current;
      api.reportItems(
        list.map((it) => ({
          id: it.id, url: it.url, title: it.title, format: it.format, phase: it.phase,
          part: it.progress?.part || null, percent: it.progress?.percent ?? null,
          copy: it.progress?.copy ?? null, file: it.file || null, error: it.error || null,
        })),
      );
      const pending = list
        .filter((it) => PENDING.includes(it.phase))
        .map(({ uid: u, key, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, prefix, kind, mediaUrl, referer, pageTitle, title, phase }) => ({
          uid: u, key, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, prefix, kind, mediaUrl, referer, pageTitle, title,
          paused: phase === 'paused',
        }));
      const json = JSON.stringify(pending);
      if (json !== savedQueue.current) {
        savedQueue.current = json;
        api.queueSave(pending);
      }
    }, 250);
  }, [items]);

  useEffect(() => save('folderAudio', folderAudio), [folderAudio]);
  useEffect(() => save('folderVideo', folderVideo), [folderVideo]);
  useEffect(() => save('format', format), [format]);
  useEffect(() => save('mp3Bitrate', bitrate), [bitrate]);
  useEffect(() => save('videoHeight', maxHeight), [maxHeight]);
  useEffect(() => save('videoCompat', compat), [compat]);

  // Fila: até PARALLEL itens ao mesmo tempo, iniciados na ordem em que entraram.
  useEffect(() => {
    if (tool.state === 'error') return;
    const free = PARALLEL - running.current.size;
    const next = items.filter((it) => it.phase === 'queued').slice(0, Math.max(0, free));
    for (const item of next) {
      running.current.add(item.id);
      patch(item.id, { phase: 'preparing', progress: {}, error: null, retry: null });
      const { id, uid: u, key, prefix, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, pageTitle } = item;
      api
        .run({ id, uid: u, key, prefix, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, title: pageTitle })
        .catch((err) => ({ ok: false, error: `Erro interno do YTA: ${err?.message || err}` }))
        .then((r) => {
          running.current.delete(item.id);
          const wasPausing = pausing.current.has(item.id);
          if (r.ok) patch(item.id, { phase: 'done', file: r.file, files: r.files || [r.file], retry: null });
          else if (r.cancelled && wasPausing) patch(item.id, { phase: 'paused', pausing: false, retry: null });
          else if (r.cancelled) patch(item.id, { phase: 'cancelled', retry: null });
          else patch(item.id, { phase: 'error', error: r.error, needsLogin: Boolean(r.needsLogin), retry: null });
          pausing.current.delete(item.id);
        });
    }
  }, [items, tool.state]);

  // Playlists: lê a lista e troca o item "Lendo a playlist…" pelos vídeos dela, numerados.
  useEffect(() => {
    if (tool.state !== 'ready') return;
    for (const item of items) {
      if (item.phase !== 'listing' || listing.current.has(item.id)) continue;
      listing.current.add(item.id);
      api.expandPlaylist(item.url, item.folder).then(async (r) => {
        listing.current.delete(item.id);
        if (!itemsRef.current.some((it) => it.id === item.id)) return; // tirada da fila enquanto lia
        if (!r.ok) {
          patch(item.id, { phase: 'error', error: r.error });
          return;
        }
        const pad = String(r.entries.length).length < 2 ? 2 : String(r.entries.length).length;
        const keys = r.entries.map((e) => historyKey(e.url, item.format));
        const done = await api.historyCheck(keys);
        const fresh = [];
        const already = [];
        r.entries.forEach((e, i) => {
          const over = {
            format: item.format, folder: r.folder, bitrate: item.bitrate, maxHeight: item.maxHeight, compat: item.compat,
            prefix: `${String(i + 1).padStart(pad, '0')} - `, title: e.title,
          };
          if (done[keys[i]]) already.push({ url: e.url, over });
          else if (!isPending(e.url, item.format)) fresh.push(makeItem(e.url, over));
        });
        setItems((list) => {
          const at = list.findIndex((it) => it.id === item.id);
          if (at < 0) return list;
          return [...list.slice(0, at), ...fresh, ...list.slice(at + 1)];
        });
        if (already.length) {
          setNotice({
            text: `${r.title}: ${already.length} de ${r.entries.length} já tinham sido baixados (pulados).`,
            actions: [{ label: 'Baixar esses de novo', run: () => addItems(already.map((a) => makeItem(a.url, a.over))) }],
          });
        }
      });
    }
  }, [items, tool.state]);

  const validLinks = links.split(/\s+/).filter((l) => SUPPORTED(l));
  const singleLink = validLinks.length === 1 && !playlistOf(validLinks[0])?.only ? validLinks[0] : null;

  // Com um só link e Vídeo escolhido, consulta as resoluções que esse vídeo tem.
  useEffect(() => {
    if (format !== 'video' || !singleLink || tool.state !== 'ready') return;
    if (probed?.url === singleLink) return;
    const timer = setTimeout(() => {
      setProbed({ url: singleLink, state: 'loading', heights: [] });
      api.probe(singleLink).then((r) =>
        setProbed((cur) => (cur?.url === singleLink ? { url: singleLink, state: r.ok ? 'ok' : 'error', heights: r.heights || [] } : cur)),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [format, singleLink, tool.state, probed?.url]);

  const probe = probed && probed.url === singleLink && probed.state === 'ok' ? probed : null;
  const probing = format === 'video' && probed?.url === singleLink && probed?.state === 'loading';

  async function chooseFolder() {
    const picked = await api.pickFolder(folder);
    if (!picked) return;
    if (format === 'video') setFolderVideo(picked);
    else setFolderAudio(picked);
  }

  function addItems(list) {
    if (!list.length) return;
    itemsRef.current = [...itemsRef.current, ...list];
    setItems((cur) => [...cur, ...list]);
    setView('queue');
  }

  /**
   * Põe links na fila (campo, arrastar e soltar). Playlists viram um item que se expande; um
   * vídeo dentro de playlist pergunta; o que já foi baixado (arquivo ainda na pasta) fica de fora
   * com "Baixar de novo".
   */
  async function enqueueLinks(lines, { keepInvalid = true } = {}) {
    const valid = [];
    const invalid = [];
    for (const l of lines) (SUPPORTED(l) ? valid : invalid).push(l);
    const fmt = settingsRef.current.format;
    const seen = new Set();
    let repeated = 0;
    const videos = [];
    const playlists = [];
    const ambiguous = [];
    for (const url of valid) {
      const pl = playlistOf(url);
      const k = pl?.only ? `pl:${playlistUrl(url)}` : historyKey(url, fmt);
      if (seen.has(k) || (!pl?.only && isPending(url, fmt))) {
        repeated++;
        continue;
      }
      seen.add(k);
      if (pl?.only) playlists.push(playlistUrl(url));
      else if (pl) ambiguous.push(url);
      else videos.push(url);
    }
    const done = videos.length ? await api.historyCheck(videos.map((u) => historyKey(u, fmt))) : {};
    const already = videos.filter((u) => done[historyKey(u, fmt)]);
    const fresh = videos.filter((u) => !done[historyKey(u, fmt)]);
    addItems([...fresh.map((u) => makeItem(u)), ...playlists.map((u) => makeItem(u, { kind: 'playlist' }))]);

    if (keepInvalid) setLinks(invalid.join('\n')); // o que não deu para enfileirar fica no campo
    setLinksError(
      !keepInvalid || !invalid.length ? ''
      : invalid.length === 1 ? 'Esta linha não é um link (comece com https://).'
      : `${invalid.length} linhas não são links (comece com https://).`,
    );
    setClipOffer(null);
    if (ambiguous.length) {
      setNotice({
        text: ambiguous.length === 1 ? 'Este vídeo faz parte de uma playlist.' : `${ambiguous.length} vídeos fazem parte de playlists.`,
        actions: [
          { label: 'Só o vídeo', run: () => addItems(ambiguous.map((u) => makeItem(u))) },
          {
            label: 'A playlist inteira',
            run: () => addItems([...new Set(ambiguous.map(playlistUrl))].map((u) => makeItem(u, { kind: 'playlist' }))),
          },
        ],
      });
    } else if (already.length) {
      setNotice({
        text: already.length === 1 ? 'Este vídeo já foi baixado.' : `${already.length} vídeos já foram baixados.`,
        actions: [{ label: 'Baixar de novo', run: () => addItems(already.map((u) => makeItem(u))) }],
      });
    } else if (repeated) {
      setNotice({ text: repeated === 1 ? '1 link já estava na fila.' : `${repeated} links já estavam na fila.`, actions: [] });
    } else {
      setNotice(null);
    }
  }

  function submit(e) {
    e?.preventDefault();
    const lines = links.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      setLinksError('Cole ao menos um link.');
      return;
    }
    enqueueLinks(lines);
  }
  const enqueueRef = useRef(enqueueLinks);
  enqueueRef.current = enqueueLinks;

  /* ---------- Arrastar e soltar um link na janela ---------- */
  useEffect(() => {
    const hasText = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'text/uri-list' || t === 'text/plain');
    let depth = 0;
    const over = (e) => {
      e.preventDefault(); // inclusive arquivos: nada solto aqui pode fazer a janela navegar
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasText(e) ? 'copy' : 'none';
    };
    const enter = (e) => {
      e.preventDefault();
      if (!hasText(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      const lines = text.split(/\s+/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (lines.some(SUPPORTED)) enqueueRef.current(lines.filter(SUPPORTED), { keepInvalid: false });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  /* ---------- "Link copiado: … · Colar" ao voltar para a janela ---------- */
  useEffect(() => {
    const check = async () => {
      const text = (await api.clipboardText().catch(() => '')) || '';
      if (!text || text === lastClip.current) return;
      lastClip.current = text; // cada texto copiado é oferecido uma vez só
      const current = linksRef.current;
      const urls = [...new Set(text.split(/\s+/).filter(SUPPORTED))]
        .filter((u) => !current.includes(u) && !isPending(u, settingsRef.current.format))
        .slice(0, 50);
      setClipOffer(urls.length ? urls : null);
      if (urls.length) setNotice(null); // a oferta é mais recente que qualquer aviso anterior
    };
    const t = setTimeout(check, 600);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', check);
    };
  }, []);
  function pasteOffer() {
    const urls = clipOffer || [];
    setLinks((prev) => [prev.trim(), ...urls].filter(Boolean).join('\n'));
    setClipOffer(null);
    textareaRef.current?.focus();
  }

  /** Pausar tudo: o que espera fica pausado; o que está baixando para e guarda os pedaços. */
  function pauseAll() {
    for (const it of itemsRef.current) {
      if (ACTIVE.includes(it.phase) && !pausing.current.has(it.id)) {
        pausing.current.add(it.id);
        api.pause(it.id);
      }
    }
    setItems((list) =>
      list.map((it) =>
        it.phase === 'queued' ? { ...it, phase: 'paused' } : ACTIVE.includes(it.phase) ? { ...it, pausing: true } : it,
      ),
    );
  }
  /** Retomar: volta para a fila na mesma ordem e continua dos pedaços já baixados. */
  const resumeAll = () => setItems((list) => list.map((it) => (it.phase === 'paused' ? { ...it, phase: 'queued' } : it)));
  const resume = (item) => patch(item.id, { phase: 'queued' });

  function cancel(item) {
    if (item.phase === 'queued' || item.phase === 'listing' || item.phase === 'paused') {
      setItems((list) => list.filter((it) => it.id !== item.id));
      if (item.uid) api.discardWork(item.uid); // pedaços de um item restaurado (retomaria deles)
    } else api.cancel(item.id);
  }
  const retry = (item) =>
    patch(item.id, { phase: item.kind === 'playlist' ? 'listing' : 'queued', progress: {}, error: null, needsLogin: false });

  /** url: site de um item que pediu login (abre numa aba a mais na janela de login). */
  async function login(url) {
    setLoginState((s) => ({ ...s, error: '' }));
    const r = await api.login(url);
    setLoggedIn(r.loggedIn);
    setLoginState((s) => ({ ...s, browser: r.browser || s.browser, sites: r.sites || s.sites, error: r.error || '' }));
    return r;
  }
  async function logout() {
    const r = await api.logout();
    setLoggedIn(r.loggedIn);
    setLoginState((s) => ({ ...s, sites: {}, error: '' }));
  }
  // Item recusado por falta de login: entra e, se deu certo, tenta de novo.
  async function loginAndRetry(item) {
    const known = YOUTUBE.test(item.url) || INSTAGRAM.test(item.url);
    const r = await login(item.url);
    if (r.extraOk || (known && r.loggedIn)) retry(item);
  }
  const remove = (item) => setItems((list) => list.filter((it) => it.id !== item.id));
  const clearFinished = () => setItems((list) => list.filter((it) => PENDING.includes(it.phase)));

  const finished = items.filter((it) => ['done', 'error', 'cancelled'].includes(it.phase)).length;
  const canPause = items.some((it) => it.phase === 'queued' || (ACTIVE.includes(it.phase) && !it.pausing));
  const canResume = items.some((it) => it.phase === 'paused');
  const done = items.filter((it) => it.phase === 'done').length;
  const noun = format === 'video' ? ['vídeo', 'vídeos'] : ['áudio', 'áudios'];

  // Linha de ajuda dos links: aviso com ações > link copiado > dica.
  const linksHint = notice ? (
    <HintLine text={notice.text} actions={notice.actions.map((a) => ({ ...a, run: () => { setNotice(null); a.run(); } }))} />
  ) : clipOffer ? (
    <HintLine
      text={clipOffer.length === 1 ? `Link copiado: ${shortUrl(clipOffer[0])}` : `${clipOffer.length} links copiados`}
      actions={[{ label: 'Colar', run: pasteOffer }]}
    />
  ) : (
    'YouTube, Instagram e a maioria dos sites. Um por linha; Ctrl+Enter adiciona.'
  );

  return (
    <main className="relative flex h-full flex-col bg-bg-base">
      <form onSubmit={submit} className="flex shrink-0 flex-col gap-3 p-6 pb-4" noValidate>
        <Field label="Links de vídeo" hint={linksHint} error={linksError}>
          {({ id, describedBy, invalid }) => (
            <textarea
              ref={textareaRef}
              id={id}
              className="input-area font-mono"
              data-focus-quiet
              rows={3}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              placeholder="https://www.youtube.com/watch?v=…"
              value={links}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && submit(e)}
              onChange={(e) => {
                setLinks(e.target.value);
                if (linksError) setLinksError('');
                if (notice) setNotice(null);
                if (clipOffer) setClipOffer(null);
              }}
            />
          )}
        </Field>

        <Field label={format === 'video' ? 'Salvar vídeos em' : 'Salvar áudios em'}>
          {({ id }) => (
            <div className="flex gap-2">
              <input
                id={id}
                className="input-field min-w-0 font-mono text-text-secondary"
                data-focus-quiet
                type="text"
                readOnly
                value={folder}
                onDoubleClick={chooseFolder}
              />
              <Button onClick={chooseFolder} className="shrink-0">
                <FolderOpen size={16} aria-hidden />
                Escolher…
              </Button>
            </div>
          )}
        </Field>

        {/* Formato e qualidade numa linha só, com uma ajuda embaixo: a altura não muda com a escolha. */}
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-3">
            <Field label="Formato">
              {({ labelId }) => (
                <SegmentedControl options={FORMATS} value={format} onChange={setFormat} labelId={labelId} />
              )}
            </Field>
            <Field label={format === 'video' ? 'Resolução' : 'Qualidade'}>
              {({ id, labelId }) =>
                format === 'mp3' ? (
                  <SegmentedControl options={MP3_QUALITIES} value={bitrate} onChange={setBitrate} labelId={labelId} />
                ) : format === 'video' ? (
                  <ResolutionSelect id={id} value={maxHeight} onChange={setMaxHeight} probe={probe} probing={probing} />
                ) : (
                  <p id={id} className="flex h-8 items-center text-body text-text-tertiary">
                    Original, sem conversão
                  </p>
                )
              }
            </Field>
          </div>
          {format === 'video' ? (
            // Mesma altura da linha de ajuda: o formulário não muda de tamanho.
            <div className="flex h-4 min-w-0 items-center gap-3 text-caption font-small text-text-tertiary">
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-text-secondary">
                <input
                  type="checkbox"
                  className="size-3.5 accent-accent-solid"
                  checked={compat}
                  onChange={(e) => setCompat(e.target.checked)}
                />
                Converter para H.264 se preciso (WhatsApp)
              </label>
              <span className="truncate" aria-live="polite">
                {compat ? 'Só converte o que vier em VP9/AV1; leva mais tempo.' : formatHint(format, { probe, probing, multiple: validLinks.length > 1 })}
              </span>
            </div>
          ) : (
            <p className="truncate text-caption font-small text-text-tertiary" aria-live="polite">
              {formatHint(format, { probe, probing, multiple: validLinks.length > 1 })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          {tool.state === 'installing' || tool.state === 'error' ? (
            <ToolNotice tool={tool} />
          ) : (
            <LoginControl loggedIn={loggedIn} login={loginState} onLogin={() => login()} onLogout={logout} />
          )}
          <Button type="submit" variant="primary" disabled={!folder || tool.state === 'error'} className="shrink-0">
            <Download size={16} aria-hidden />
            {validLinks.length > 1 ? `Baixar ${validLinks.length} ${noun[1]}` : `Baixar ${noun[0]}`}
          </Button>
        </div>
      </form>

      <section aria-label={view === 'queue' ? 'Fila' : 'Baixados'} className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
        <header className="flex h-band shrink-0 items-center gap-3 px-6">
          <div role="tablist" aria-label="Lista" className="flex h-full items-stretch gap-4">
            {[
              ['queue', 'Fila'],
              ['history', 'Baixados'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`label-micro -mb-px border-b-2 ${
                  view === key ? 'border-accent-solid text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'queue' && items.length > 0 && (
            <span className="text-minor text-text-tertiary tabular-nums">
              {done} de {items.length} {items.length === 1 ? 'salvo' : 'salvos'}
            </span>
          )}
          <span className="flex-1" />
          <UpdateNotice update={update} busy={items.some((it) => ACTIVE.includes(it.phase))} />
          <IconButton label="Extensão do navegador" onClick={() => api.extensionHelp()}>
            <Puzzle size={16} aria-hidden />
          </IconButton>
          {view === 'queue' && canResume && (
            <Button variant="ghost" className="h-7 shrink-0" onClick={resumeAll}>
              <Play size={14} aria-hidden />
              Retomar tudo
            </Button>
          )}
          {view === 'queue' && canPause && (
            <Button variant="ghost" className="h-7 shrink-0" onClick={pauseAll}>
              <Pause size={14} aria-hidden />
              Pausar tudo
            </Button>
          )}
          {view === 'queue' ? (
            <Button variant="ghost" className="h-7 shrink-0" disabled={!finished} onClick={clearFinished}>
              Limpar concluídos
            </Button>
          ) : (
            <Button
              variant={confirmClear ? 'destructiveText' : 'ghost'}
              className="h-7 shrink-0"
              disabled={!history.length}
              onBlur={() => setConfirmClear(false)}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  setTimeout(() => setConfirmClear(false), 4000);
                  return;
                }
                setConfirmClear(false);
                api.historyClear().then(() => setHistory([]));
              }}
            >
              {confirmClear ? 'Confirmar limpeza' : 'Limpar histórico'}
            </Button>
          )}
        </header>
        {view === 'queue' ? (
          items.length === 0 ? (
            <p className="px-6 text-body text-text-tertiary">
              Cole ou arraste links aqui. Até 3 baixam ao mesmo tempo; playlists também.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {items.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  onCancel={() => cancel(item)}
                  onRetry={() => retry(item)}
                  onRemove={() => remove(item)}
                  onReveal={() => api.reveal(item.file)}
                  onLogin={() => loginAndRetry(item)}
                  onResume={() => resume(item)}
                />
              ))}
            </ul>
          )
        ) : history.length === 0 ? (
          <p className="px-6 text-body text-text-tertiary">O que você baixar aparece aqui, para abrir ou baixar de novo.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {history.slice(0, HISTORY_SHOWN).map((entry) => (
              <HistoryItem
                key={entry.uid + entry.at}
                entry={entry}
                onReveal={() => entry.files?.[0] && api.reveal(entry.files.find(Boolean))}
                onAgain={() => addItems([makeItem(entry.url, { format: entry.format })])}
                onRemove={() => api.historyRemove(entry.uid).then(() => setHistory((h) => h.filter((x) => x.uid !== entry.uid)))}
              />
            ))}
          </ul>
        )}
      </section>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-modal flex items-center justify-center bg-scrim-strong">
          <p className="flex items-center gap-2 rounded-overlay border border-border-default bg-bg-card px-4 py-3 text-subtitle font-display text-text-primary shadow-overlay">
            <Download size={20} aria-hidden className="text-accent" />
            Solte para baixar
          </p>
        </div>
      )}
    </main>
  );
}

/** Texto curto + ações em forma de link, numa linha só (trunca o texto, nunca as ações). */
function HintLine({ text, actions }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{text}</span>
      {actions.map((a) => (
        <LinkButton key={a.label} onClick={a.run}>
          {a.label}
        </LinkButton>
      ))}
    </span>
  );
}

function formatHint(format, { probe, probing, multiple }) {
  if (format === 'm4a') return 'Áudio AAC original, sem perda, com a capa do vídeo. Toca em praticamente tudo.';
  if (format === 'opus') return 'Áudio Opus original: melhor qualidade e menor arquivo. Pode não tocar no iPhone.';
  if (format === 'mp3') return 'Convertido do original, com a capa do vídeo; 256 kbps compensa a perda.';
  if (probing) return 'Verificando as resoluções deste vídeo…';
  if (probe?.heights.length) return `MP4 com o melhor áudio. Este vídeo vai até ${probe.heights[0]}p.`;
  if (multiple) return 'MP4. Cada vídeo sai na resolução escolhida ou na maior abaixo dela.';
  return 'MP4 com o melhor áudio. Acima de 1080p o vídeo vem em VP9 ou AV1.';
}

/** Com um link consultado: só as resoluções que o vídeo tem. Sem consulta: tetos genéricos. */
function ResolutionSelect({ id, value, onChange, probe, probing }) {
  const heights = probe?.heights.length ? probe.heights : VIDEO_CAPS;
  const options = [
    { value: '', label: probe?.heights.length ? `Melhor — ${heightLabel(probe.heights[0])}` : 'Melhor disponível' },
    ...heights.map((h) => ({ value: String(h), label: probe ? heightLabel(h) : `Até ${heightLabel(h)}` })),
  ];
  // Preferência salva que este vídeo não tem continua valendo como teto.
  if (value && !heights.includes(value)) options.push({ value: String(value), label: `Até ${heightLabel(value)}` });
  return (
    <select
      id={id}
      className="input-field tabular-nums"
      value={value ? String(value) : ''}
      aria-busy={probing || undefined}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Login (só usado quando o site exige). Fica no canto, calado. */
function LoginControl({ loggedIn, login, onLogin, onLogout }) {
  const browser = login.browser || 'navegador';
  const names = [login.sites?.youtube && 'YouTube', login.sites?.instagram && 'Instagram'].filter(Boolean);
  const connected = names.join(' e ');
  const missing = login.sites?.youtube ? 'Instagram' : 'YouTube';
  if (login.state === 'waiting' || login.state === 'checking')
    return (
      <p className="mr-auto flex min-w-0 items-center gap-1.5 text-minor text-text-secondary" aria-live="polite">
        <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
        <span className="truncate">
          {login.state === 'waiting'
            ? `Entre nas contas que quiser na janela do ${browser} e feche-a ao terminar.`
            : 'Verificando o login…'}
        </span>
      </p>
    );
  if (!loggedIn)
    return (
      <div className="mr-auto flex min-w-0 items-center gap-2">
        <Button variant="ghost" className="shrink-0" onClick={onLogin}>
          Entrar em sites…
        </Button>
        {login.error && (
          <p className="truncate text-minor text-danger-fg" role="alert">
            {login.error}
          </p>
        )}
      </div>
    );
  return (
    <div className="mr-auto flex min-w-0 items-center gap-1 text-minor text-text-secondary">
      <span className="truncate">Conectado: {connected || 'YouTube'}</span>
      {/* Reabre o mesmo perfil: dá para entrar no site que falta sem perder o outro. */}
      <Button variant="ghost" className="h-7 shrink-0" onClick={onLogin}>
        {connected === 'YouTube e Instagram' ? 'Contas…' : `Entrar no ${missing}…`}
      </Button>
      <Button variant="ghost" className="h-7 shrink-0" onClick={onLogout}>
        Sair
      </Button>
    </div>
  );
}

/** Atualização automática: baixa sozinha; pronta, oferece reiniciar (ou instala ao fechar). */
function UpdateNotice({ update, busy }) {
  if (update.state === 'downloading')
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-minor text-text-tertiary" aria-live="polite">
        <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
        <span className="truncate tabular-nums">
          Baixando a versão {update.version}… {Math.floor(update.percent || 0)}%
        </span>
      </span>
    );
  if (update.state !== 'ready') return null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-minor text-text-secondary" aria-live="polite">
      <span className="truncate">
        Versão {update.version} pronta{busy ? ' · instala ao fechar o app' : ''}
      </span>
      {!busy && (
        <Button variant="secondary" className="h-7 shrink-0" onClick={() => api.installUpdate()}>
          Reiniciar e atualizar
        </Button>
      )}
    </span>
  );
}

function ToolNotice({ tool }) {
  if (tool.state === 'installing')
    return (
      <p className="mr-auto flex min-w-0 items-center gap-1.5 text-minor text-text-secondary" aria-live="polite">
        <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
        Instalando o yt-dlp (só na primeira vez)…
      </p>
    );
  if (tool.state === 'error')
    return (
      <p className="mr-auto flex min-w-0 items-center gap-1.5 text-minor text-danger-fg" role="alert">
        <AlertCircle size={12} className="shrink-0" aria-hidden />
        <span className="truncate">Não foi possível baixar o yt-dlp.</span>
        <Button variant="ghost" className="h-7 shrink-0" onClick={() => api.retryTool()}>
          Tentar de novo
        </Button>
      </p>
    );
  return null;
}
