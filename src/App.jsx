import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Mark } from './ui.jsx';
import { TitleBar } from './TitleBar.jsx';
import { Banner, BatchCard, ClipChip, LinkBar, PreviewCard } from './Compose.jsx';
import { DownloadList } from './DownloadList.jsx';
import { Settings } from './Settings.jsx';
import { ACTIVE, PENDING, setPlaces, siteLabel } from './labels.js';

const api = window.yta;

const YOUTUBE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\/\S+$/i;
// Instagram: posts, reels, IGTV e stories (stories exigem login).
const INSTAGRAM = /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reels?|tv|stories)\/\S+$/i;
// Qualquer outro site: o yt-dlp reconhece ~1.800 e tem um extrator genérico para o resto.
const WEB = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+\S*$/i;
const SUPPORTED = (url) => YOUTUBE.test(url) || INSTAGRAM.test(url) || WEB.test(url);
// Link direto de arquivo (não de vídeo): vai para o acelerador, não para o yt-dlp. Mídia (.mp4,
// .mp3) continua no yt-dlp, que respeita o formato escolhido.
const FILE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|exe|msi|msix|msixbundle|appx|appxbundle|iso|img|vhdx?|dmg|apk|xapk|apks|deb|rpm|pdf|epub|cbz|cbr|psd|bin|cab|jar|nupkg|whl)$/i;
function isFileLink(url) {
  try {
    return WEB.test(url) && !YOUTUBE.test(url) && !INSTAGRAM.test(url) && FILE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
// Itens processados ao mesmo tempo: sobrepõe as consultas ao YouTube e usa mais núcleos na conversão.
// Downloads em geral (acelerador) têm as suas 3 vagas: um vídeo longo não segura um arquivo.
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

/** Que tipo de link é (decide a prévia): arquivo direto, playlist, vídeo de playlist ou vídeo. */
function linkKind(url) {
  if (isFileLink(url)) return 'file';
  const pl = playlistOf(url);
  if (pl?.only) return 'playlist';
  if (pl) return 'ambiguous';
  return 'video';
}
const badgeOf = (url) => ({ file: 'Arquivo', playlist: 'Playlist' })[linkKind(url)] || siteLabel(url) || 'Link';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const splitLinks = (text) => [...new Set(text.split(/\s+/).filter(SUPPORTED))];
const normalize = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState('');
  // Aviso embaixo da barra: { text, actions: [{ label, run }], tone }.
  const [notice, setNotice] = useState(null);
  const [clipOffer, setClipOffer] = useState(null); // links copiados oferecidos para colar
  // Pastas separadas para áudio e vídeo (a antiga "folder" vira a de áudio).
  const [folderAudio, setFolderAudio] = useState(() => load('folderAudio', load('folder', '')));
  const [folderVideo, setFolderVideo] = useState(() => load('folderVideo', ''));
  const [format, setFormat] = useState(() => (['m4a', 'opus', 'mp3', 'video'].includes(load('format', 'm4a')) ? load('format', 'm4a') : 'm4a'));
  const [bitrate, setBitrate] = useState(() => load('mp3Bitrate', 256));
  const [maxHeight, setMaxHeight] = useState(() => load('videoHeight', null)); // null = melhor
  const [compat, setCompat] = useState(() => load('videoCompat', false)); // garantir H.264 + AAC
  const [previews, setPreviews] = useState({}); // link → { state: 'loading'|'ok'|'error', data, error }
  const [already, setAlready] = useState({}); // chave do histórico → { at, title } dos links do campo
  const [included, setIncluded] = useState(() => new Set()); // já baixados que o usuário quis de novo
  const [playlistChoice, setPlaylistChoice] = useState('video');
  const [tool, setTool] = useState({ state: 'pending' });
  const [update, setUpdate] = useState({ state: 'idle' });
  const [loggedIn, setLoggedIn] = useState(false);
  // idle | waiting (janela do navegador aberta) | checking; browser = Chrome/Edge; error da última tentativa
  const [loginState, setLoginState] = useState({ state: 'idle', browser: null, error: '', sites: {} });
  const [prefs, setPrefsState] = useState(null);
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState(null); // null = busca fechada
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [placesReady, setPlacesReady] = useState(false); // nomes das pastas especiais chegaram: redesenha
  const running = useRef(new Map()); // id → tipo, em andamento
  const listing = useRef(new Set()); // playlists sendo lidas
  const pausing = useRef(new Set()); // em andamento que pedimos para pausar (o resultado volta como cancelado)
  const inputRef = useRef(null);
  const settingsButton = useRef(null);
  const lastClip = useRef(''); // texto da área de transferência já oferecido (não oferece de novo)
  // Valores atuais para assinantes criados uma vez só (extensão, arrastar, área de transferência).
  const settingsRef = useRef({});
  const itemsRef = useRef([]);
  const textRef = useRef('');
  settingsRef.current = { folderAudio, folderVideo, format, bitrate, maxHeight, compat };
  itemsRef.current = items;
  textRef.current = text;

  const patch = (id, change) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...(typeof change === 'function' ? change(it) : change) } : it)));

  /** Um item da fila com as escolhas atuais (ou as de `over`). */
  function makeItem(url, over = {}) {
    const s = settingsRef.current;
    const fmt = over.format || s.format;
    const file = fmt === 'file';
    return {
      id: nextId++,
      uid: over.uid || uid(),
      url,
      format: fmt,
      // Arquivos vão para a pasta de arquivos (Ajustes; null = a padrão, decidida pelo app).
      folder: file ? over.folder || null : over.folder || (fmt === 'video' ? s.folderVideo : s.folderAudio),
      bitrate: over.bitrate || s.bitrate,
      maxHeight: fmt === 'video' ? (over.maxHeight === undefined ? s.maxHeight : over.maxHeight) : null,
      compat: fmt === 'video' && (over.compat === undefined ? s.compat : Boolean(over.compat)),
      key: historyKey(url, fmt),
      prefix: over.prefix || '',
      kind: file ? 'file' : over.kind || 'video',
      mediaUrl: over.mediaUrl || null,
      referer: over.referer || null,
      pageTitle: over.pageTitle || null,
      fileName: over.fileName || null, // nome escolhido na janela "Baixar arquivo"
      phase: over.kind === 'playlist' ? 'listing' : 'queued',
      title: over.title || null,
      thumb: over.thumb || null,
      site: over.site || null,
      progress: {},
    };
  }
  const isPending = (url, format) =>
    itemsRef.current.some((it) => PENDING.includes(it.phase) && it.kind !== 'playlist' && historyKey(it.url, it.format) === historyKey(url, format));

  // Reaproveita as entradas que não mudaram: as linhas da lista (memo) só redesenham o que mudou.
  const refreshHistory = () =>
    api.historyList().then((list) =>
      setHistory((prev) => {
        const old = new Map(prev.map((h) => [`${h.uid}|${h.at}`, h]));
        return list.map((h) => {
          const o = old.get(`${h.uid}|${h.at}`);
          return o && o.exists === h.exists && o.thumb === h.thumb && o.title === h.title ? o : h;
        });
      }),
    );
  const refreshPrefs = () => api.appPrefs().then(setPrefsState);
  const setPrefs = (change) => api.setAppPrefs(change).then(setPrefsState);

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
    refreshPrefs();
    const offPrefs = api.onPrefsChanged(refreshPrefs);
    // A extensão "conectada" muda sozinha (último contato < 90 s): relê de vez em quando.
    const prefsTimer = setInterval(refreshPrefs, 30_000);
    refreshHistory();
    const offHistory = api.onHistoryChanged(refreshHistory);
    const offJob = api.onJobEvent((e) => {
      if (e.type === 'meta') patch(e.id, (it) => ({ title: e.title || it.title, thumb: e.thumb || it.thumb, phase: 'download', retry: null }));
      else if (e.type === 'retry') patch(e.id, { phase: 'preparing', progress: {}, retry: e.login ? { login: true } : e.browser ? { browser: true } : e.media ? { media: true } : { attempt: e.attempt, max: e.max } });
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
      // Download capturado ou link direto de arquivo (clique direito num .zip): acelerador.
      const fmt = req.kind === 'file' || isFileLink(url) ? 'file' : ['m4a', 'opus', 'mp3', 'video'].includes(req.format) ? req.format : settingsRef.current.format;
      const same = itemsRef.current.find(
        (it) => PENDING.includes(it.phase) && it.kind !== 'playlist' && historyKey(it.url, it.format) === historyKey(url, fmt),
      );
      if (same) {
        if (req.kind === 'file' && req.uid) api.discardWork(req.uid); // já está na fila: o acesso guardado sobra
        api.externalAdded({ reqId: req.reqId, ok: true, id: same.id, existing: true });
        return;
      }
      const item = makeItem(url, {
        uid: req.kind === 'file' ? req.uid : undefined, // a pasta de trabalho com o acesso do navegador
        title: req.kind === 'file' ? req.title : undefined,
        // Nome e pasta escolhidos na janela "Baixar arquivo" (sem ela, o padrão do app).
        fileName: req.kind === 'file' ? req.fileName : undefined,
        folder: req.kind === 'file' && typeof req.folder === 'string' ? req.folder : undefined,
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
      setPlaces(special); // "Music" → "Música" nos rótulos
      setPlacesReady(true);
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
      offPrefs();
      clearInterval(prefsTimer);
    };
  }, []);

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
          id: it.id, url: it.url, title: it.title, format: it.format, kind: it.kind, phase: it.phase,
          part: it.progress?.part || null, percent: it.progress?.percent ?? null,
          copy: it.progress?.copy ?? null, file: it.file || null, error: it.error || null,
          // Para a janela de andamento (electron/main.cjs > progressUpdate) e o popup da extensão.
          done: it.progress?.done ?? null, size: it.progress?.size ?? null, speed: it.progress?.speed ?? null,
          eta: it.progress?.eta ?? null, conns: it.progress?.conns ?? null, height: it.height || null,
          files: it.files || null, folder: it.folder || null, pausing: Boolean(it.pausing), retry: it.retry ? (it.retry.browser ? 'browser' : 'other') : null,
          thumb: it.thumb || null,
        })),
      );
      const pending = list
        .filter((it) => PENDING.includes(it.phase))
        .map(({ uid: u, key, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, prefix, kind, mediaUrl, referer, pageTitle, title, fileName, thumb, site, phase }) => ({
          uid: u, key, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, prefix, kind, mediaUrl, referer, pageTitle, title, fileName, thumb, site,
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
    // Sem o yt-dlp (instalação falhou), os arquivos seguem: o acelerador não depende dele.
    const toolDown = tool.state === 'error';
    const busy = (file) => [...running.current.values()].filter((k) => (k === 'file') === file).length;
    const queued = items.filter((it) => it.phase === 'queued' && (it.kind === 'file' || !toolDown));
    const next = [
      ...queued.filter((it) => it.kind === 'file').slice(0, Math.max(0, PARALLEL - busy(true))),
      ...queued.filter((it) => it.kind !== 'file').slice(0, Math.max(0, PARALLEL - busy(false))),
    ];
    for (const item of next) {
      running.current.set(item.id, item.kind);
      patch(item.id, { phase: 'preparing', progress: {}, error: null, retry: null });
      const { id, uid: u, key, prefix, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, pageTitle, kind, title, fileName } = item;
      api
        .run({ id, uid: u, key, prefix, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, kind, fileName, title: kind === 'file' ? title : pageTitle })
        .catch((err) => ({ ok: false, error: `Erro interno do YTA: ${err?.message || err}` }))
        .then((r) => {
          running.current.delete(item.id);
          const wasPausing = pausing.current.has(item.id);
          const finishedAt = Date.now();
          if (r.ok) patch(item.id, { phase: 'done', file: r.file, files: r.files || [r.file], retry: null, finishedAt });
          else if (r.cancelled && wasPausing) patch(item.id, { phase: 'paused', pausing: false, retry: null });
          else if (r.cancelled) patch(item.id, { phase: 'cancelled', retry: null, finishedAt });
          else patch(item.id, { phase: 'error', error: r.error, needsLogin: Boolean(r.needsLogin), retry: null, finishedAt });
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
          patch(item.id, { phase: 'error', error: r.error, finishedAt: Date.now() });
          return;
        }
        const pad = String(r.entries.length).length < 2 ? 2 : String(r.entries.length).length;
        const keys = r.entries.map((e) => historyKey(e.url, item.format));
        const done = await api.historyCheck(keys);
        const fresh = [];
        const skipped = [];
        r.entries.forEach((e, i) => {
          const over = {
            format: item.format, folder: r.folder, bitrate: item.bitrate, maxHeight: item.maxHeight, compat: item.compat,
            prefix: `${String(i + 1).padStart(pad, '0')} - `, title: e.title,
          };
          if (done[keys[i]]) skipped.push({ url: e.url, over });
          else if (!isPending(e.url, item.format)) fresh.push(makeItem(e.url, over));
        });
        setItems((list) => {
          const at = list.findIndex((it) => it.id === item.id);
          if (at < 0) return list;
          return [...list.slice(0, at), ...fresh, ...list.slice(at + 1)];
        });
        if (skipped.length) {
          setNotice({
            text: `${r.title}: ${skipped.length} de ${r.entries.length} já tinham sido baixados (pulados).`,
            actions: [{ label: 'Baixar esses de novo', run: () => addItems(skipped.map((a) => makeItem(a.url, a.over))) }],
          });
        }
      });
    }
  }, [items, tool.state]);

  /* ---------- O que está no campo ---------- */
  const tokens = text.split(/\s+/).filter(Boolean);
  const valid = splitLinks(text);
  const invalidTokens = tokens.filter((t) => !SUPPORTED(t));
  const mode = valid.length === 0 ? (tokens.length ? 'invalid' : 'empty') : valid.length === 1 ? 'single' : 'batch';
  const single = mode === 'single' ? valid[0] : null;
  const singleKind = single ? linkKind(single) : null;
  const fmtFor = (url) => (isFileLink(url) ? 'file' : format);

  // Prévia do link único (título, duração, miniatura, resoluções, tamanhos): consulta de ~2–3 s.
  useEffect(() => {
    const cached = single && previews[single];
    // Falhou (sem internet, site fora do ar): colar o link de novo, depois de 10 s, consulta outra vez.
    if (!single || (cached && !(cached.state === 'error' && Date.now() - cached.at > 10_000))) return;
    if (singleKind !== 'file' && tool.state !== 'ready') return;
    const url = single;
    const t = setTimeout(() => {
      setPreviews((p) => ({ ...p, [url]: { state: 'loading' } }));
      const ask = singleKind === 'file' ? api.filePreview(url) : singleKind === 'playlist' ? api.playlistPreview(playlistUrl(url)) : api.probe(url);
      ask.then(
        (r) => setPreviews((p) => ({ ...p, [url]: r?.ok ? { state: 'ok', data: r } : { state: 'error', error: r?.error, at: Date.now() } })),
        () => setPreviews((p) => ({ ...p, [url]: { state: 'error', at: Date.now() } })),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [single, singleKind, tool.state, previews]);

  // Já baixado? (os links do campo, no formato escolhido)
  const validKey = valid.join(' ');
  useEffect(() => {
    const keys = valid.filter((u) => linkKind(u) !== 'playlist').map((u) => historyKey(u, fmtFor(u)));
    if (!keys.length) return;
    let live = true;
    api.historyCheck(keys).then((found) => live && setAlready(found || {}));
    return () => {
      live = false;
    };
  }, [validKey, format, history]);

  const batchRows =
    mode === 'batch'
      ? valid.map((u) => {
          const k = linkKind(u);
          const kind = k === 'ambiguous' ? 'video' : k; // em lote, vídeo de playlist = só o vídeo
          const fmt = kind === 'file' ? 'file' : format;
          const found = kind !== 'playlist' ? already[historyKey(u, fmt)] : null;
          return { url: u, kind, badge: badgeOf(u), title: found?.title || null, already: Boolean(found), included: included.has(u), pending: kind !== 'playlist' && isPending(u, fmt) };
        })
      : [];

  function addItems(list) {
    if (!list.length) return;
    itemsRef.current = [...itemsRef.current, ...list];
    setItems((cur) => [...cur, ...list]);
  }

  function clearField() {
    setText('');
    setInputError('');
    setIncluded(new Set());
    setPlaylistChoice('video');
  }

  /** Enter na barra ou "Baixar" na prévia. */
  const submitting = useRef(false); // a conferência dos vários links espera o histórico: sem dois cliques
  async function submit() {
    if (submitting.current) return;
    if (mode === 'empty') return inputRef.current?.focus();
    if (mode === 'invalid') {
      setInputError(invalidTokens.length === 1 ? 'Isto não é um link (comece com https://).' : 'Isto não são links (cada um começa com https://).');
      return;
    }
    setNotice(null);
    if (mode === 'single') {
      const data = previews[single]?.data;
      if (singleKind === 'playlist' || (singleKind === 'ambiguous' && playlistChoice === 'playlist')) {
        addItems([makeItem(playlistUrl(single), { kind: 'playlist', title: singleKind === 'playlist' ? data?.title : undefined })]);
      } else {
        const fmt = fmtFor(single);
        if (isPending(single, fmt)) return setNotice({ text: 'Este link já está na fila.' });
        addItems([makeItem(single, { format: fmt, title: fmt === 'file' ? data?.name : data?.title, thumb: data?.thumbnail, site: data?.site })]);
      }
    } else {
      // A conferência "já baixado" do cartão é assíncrona: refeita aqui, um Enter logo depois de
      // colar não baixa de novo. E o mesmo vídeo por dois links (youtu.be e watch?v=) entra uma vez.
      const fmtOf = (r) => (r.kind === 'file' ? 'file' : format);
      const keyOf = (r) => (r.kind === 'playlist' ? `playlist:${playlistUrl(r.url)}` : historyKey(r.url, fmtOf(r)));
      const keys = batchRows.filter((r) => r.kind !== 'playlist').map(keyOf);
      submitting.current = true;
      const done = (keys.length && (await api.historyCheck(keys).catch(() => null))) || {};
      submitting.current = false;
      const seen = new Set();
      const skipped = [];
      const take = batchRows.filter((r) => {
        const k = keyOf(r);
        if (seen.has(k) || r.pending) return false;
        seen.add(k);
        if (done[k] && !r.included) {
          skipped.push(r);
          return false;
        }
        return true;
      });
      const asItem = (r) => (r.kind === 'playlist' ? makeItem(playlistUrl(r.url), { kind: 'playlist' }) : makeItem(r.url, { format: fmtOf(r) }));
      addItems(take.map(asItem));
      if (skipped.length) {
        setNotice({
          text: skipped.length === 1 ? '1 link já tinha sido baixado.' : `${skipped.length} links já tinham sido baixados.`,
          actions: [{ label: 'Baixar de novo', run: () => addItems(skipped.map(asItem)) }],
        });
      }
    }
    if (invalidTokens.length) {
      // O que não era link fica no campo, para corrigir.
      setText(invalidTokens.join('\n'));
      setInputError(invalidTokens.length === 1 ? 'Esta linha não é um link (comece com https://).' : `${invalidTokens.length} linhas não são links.`);
    } else clearField();
    inputRef.current?.focus();
  }

  /** Arrastar e soltar: vai direto para a fila (playlist inteira, vídeo de playlist = só o vídeo). */
  async function enqueueDropped(urls) {
    const videos = [];
    const playlists = [];
    let repeated = 0;
    for (const url of urls) {
      const kind = linkKind(url);
      if (kind === 'playlist') playlists.push(playlistUrl(url));
      else if (isPending(url, fmtFor(url))) repeated++;
      else videos.push(url);
    }
    const done = videos.length ? await api.historyCheck(videos.map((u) => historyKey(u, fmtFor(u)))) : {};
    const skipped = videos.filter((u) => done[historyKey(u, fmtFor(u))]);
    const fresh = videos.filter((u) => !done[historyKey(u, fmtFor(u))]);
    const asItem = (u) => makeItem(u, { format: fmtFor(u) });
    addItems([...fresh.map(asItem), ...playlists.map((u) => makeItem(u, { kind: 'playlist' }))]);
    if (skipped.length)
      setNotice({
        text: skipped.length === 1 ? 'Este link já foi baixado.' : `${skipped.length} links já foram baixados.`,
        actions: [{ label: 'Baixar de novo', run: () => addItems(skipped.map(asItem)) }],
      });
    else if (repeated) setNotice({ text: repeated === 1 ? '1 link já estava na fila.' : `${repeated} links já estavam na fila.` });
  }
  const dropRef = useRef(enqueueDropped);
  dropRef.current = enqueueDropped;

  /** Colar na barra: vários links (ou um a mais) entram na lista do campo em vez de virar texto. */
  function onPasteLinks(e) {
    const urls = splitLinks(e.clipboardData?.getData('text') || '');
    // Tudo selecionado (Ctrl+A) no campo com um link: colar TROCA, como em qualquer campo.
    const el = e.target;
    if (el instanceof HTMLInputElement && el.value && el.selectionStart === 0 && el.selectionEnd === el.value.length) {
      if (urls.length >= 2) {
        e.preventDefault();
        setText(urls.join('\n'));
        setInputError('');
      }
      return; // um link: o colar normal já troca o texto
    }
    if (urls.length >= 2 || (urls.length && (valid.length || mode === 'batch'))) {
      e.preventDefault();
      setText((prev) => [...new Set([...prev.split(/\s+/).filter(Boolean), ...urls])].join('\n'));
      setInputError('');
    }
  }

  /* ---------- Colar em qualquer lugar da janela (fora de um campo) ---------- */
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      if (t instanceof Element && t.closest('[role="dialog"]')) return; // Ajustes aberto: não mexe na barra escondida
      const urls = splitLinks(e.clipboardData?.getData('text') || '');
      if (!urls.length) return;
      e.preventDefault();
      setText((prev) => [...new Set([...prev.split(/\s+/).filter(Boolean), ...urls])].join('\n'));
      inputRef.current?.focus();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

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
      const dropped = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      const urls = splitLinks(dropped.split(/\s+/).filter((l) => !l.startsWith('#')).join(' '));
      if (urls.length) dropRef.current(urls);
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
      const clip = (await api.clipboardText().catch(() => '')) || '';
      if (!clip || clip === lastClip.current) return;
      lastClip.current = clip; // cada texto copiado é oferecido uma vez só
      const current = textRef.current;
      const urls = splitLinks(clip)
        .filter((u) => !current.includes(u) && !isPending(u, settingsRef.current.format))
        .slice(0, 50);
      setClipOffer(urls.length ? urls : null);
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
    setText((prev) => [...new Set([...prev.split(/\s+/).filter(Boolean), ...urls])].join('\n'));
    setClipOffer(null);
    inputRef.current?.focus();
  }

  /* ---------- Ações da fila ---------- */
  /** Pausar tudo: o que espera fica pausado; o que está baixando para e guarda os pedaços. */
  function pauseAll() {
    for (const it of itemsRef.current) {
      if (ACTIVE.includes(it.phase) && !pausing.current.has(it.id)) {
        pausing.current.add(it.id);
        api.pause(it.id);
      }
    }
    setItems((list) =>
      list.map((it) => (it.phase === 'queued' ? { ...it, phase: 'paused' } : ACTIVE.includes(it.phase) ? { ...it, pausing: true } : it)),
    );
  }
  /** Retomar: volta para a fila na mesma ordem e continua dos pedaços já baixados. */
  const resumeAll = () => setItems((list) => list.map((it) => (it.phase === 'paused' ? { ...it, phase: 'queued' } : it)));
  const resume = (item) => patch(item.id, { phase: 'queued' });
  /** Pausar um item só (linha da lista ou janela de andamento). */
  function pauseItem(item) {
    if (item.phase === 'queued') return patch(item.id, { phase: 'paused' });
    if (!ACTIVE.includes(item.phase) || pausing.current.has(item.id)) return;
    pausing.current.add(item.id);
    api.pause(item.id);
    patch(item.id, { pausing: true });
  }
  function cancel(item) {
    if (item.phase === 'queued' || item.phase === 'listing' || item.phase === 'paused') {
      setItems((list) => list.filter((it) => it.id !== item.id));
      if (item.uid) api.discardWork(item.uid); // pedaços de um item restaurado (retomaria deles)
    } else api.cancel(item.id);
  }
  const retry = (item) =>
    patch(item.id, { phase: item.kind === 'playlist' ? 'listing' : 'queued', progress: {}, error: null, needsLogin: false, finishedAt: null });

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
  // Arquivo com erro guarda os pedaços para "Tentar de novo"; tirar da lista os apaga.
  const dropWork = (it) => it.kind === 'file' && it.phase === 'error' && it.uid && api.discardWork(it.uid);
  const remove = (item) => {
    dropWork(item);
    setItems((list) => list.filter((it) => it.id !== item.id));
  };
  function clearFailed() {
    itemsRef.current.filter((it) => !PENDING.includes(it.phase)).forEach(dropWork);
    setItems((list) => list.filter((it) => PENDING.includes(it.phase)));
  }
  function confirmClearHistory() {
    setNotice({
      text: 'Limpar todo o histórico de baixados? Os arquivos continuam nas pastas.',
      actions: [
        { label: 'Limpar histórico', run: () => api.historyClear().then(refreshHistory) },
        { label: 'Cancelar', run: () => {} },
      ],
    });
  }
  // Botões da janela de andamento chegam aqui (a fila é desta janela).
  const itemActions = useRef({});
  itemActions.current = { pause: pauseItem, resume, cancel, retry };
  useEffect(
    () =>
      api.onItemAction(({ id, action }) => {
        const item = itemsRef.current.find((it) => it.id === id);
        if (item) itemActions.current[action]?.(item);
      }),
    [],
  );

  async function chooseFolder(kind) {
    const start = kind === 'video' ? folderVideo : kind === 'file' ? prefs?.fileFolder : folderAudio;
    const picked = await api.pickFolder(start);
    if (!picked) return;
    if (kind === 'video') setFolderVideo(picked);
    else if (kind === 'file') setPrefs({ fileFolder: picked });
    else setFolderAudio(picked);
  }

  const rowActions = {
    pause: pauseItem,
    resume,
    cancel,
    retry,
    login: loginAndRetry,
    remove,
    reveal: (entry) => api.reveal((entry.files || []).find(Boolean)),
    open: (entry) => api.openFile((entry.files || []).find(Boolean)),
    again: (entry) => addItems([makeItem(entry.url, { format: entry.format, title: entry.title, thumb: entry.thumbUrl })]),
    copy: (entry) => {
      api.clipboardWrite(entry.url);
      lastClip.current = entry.url; // não oferece de volta o que acabou de copiar
      setNotice({ text: 'Link copiado.' });
      setTimeout(() => setNotice((n) => (n?.text === 'Link copiado.' ? null : n)), 2000);
    },
    forget: (entry) => {
      if (entry.uid) api.historyRemove(entry.uid).then(refreshHistory);
      setItems((list) => list.filter((it) => it.uid !== entry.uid));
    },
  };

  /* ---------- A lista: Agora + concluídos por dia ---------- */
  const active = items.filter((it) => PENDING.includes(it.phase));
  const query = search ? normalize(search.trim()) : '';
  const matches = (title, url) => !query || normalize(`${title || ''} ${url}`).includes(query);
  // O histórico só muda quando algo termina ou se busca: não refazer a cada passo do andamento.
  // A busca procura nos 1.000 guardados; sem busca, a lista mostra os 300 mais recentes.
  const historyUids = useMemo(() => new Set(history.map((h) => h.uid)), [history]);
  const historyRows = useMemo(
    () =>
      (query ? history.filter((h) => normalize(`${h.title || ''} ${h.url}`).includes(query)) : history)
        .slice(0, HISTORY_SHOWN)
        .map((h) => ({ type: 'history', at: h.at, entry: h })),
    [history, query],
  );
  const concluded = [
    // Terminou agora e o histórico ainda não chegou: mostra pelo item (some quando o histórico chega).
    ...items
      .filter((it) => it.phase === 'done' && !historyUids.has(it.uid))
      .map((it) => ({
        type: 'history',
        at: it.finishedAt || Date.now(),
        entry: { uid: it.uid, url: it.url, title: it.title, format: it.format, files: it.files, at: it.finishedAt || Date.now(), thumbUrl: it.thumb, site: it.site },
      })),
    ...items.filter((it) => it.phase === 'error' || it.phase === 'cancelled').map((it) => ({ type: 'item', at: it.finishedAt || Date.now(), item: it })),
  ]
    .filter((r) => (r.type === 'item' ? matches(r.item.title, r.item.url) : matches(r.entry.title, r.entry.url)))
    .concat(historyRows)
    .sort((a, b) => b.at - a.at);
  const speed = active.reduce((sum, it) => sum + (it.phase === 'download' && it.progress?.speed ? it.progress.speed : 0), 0);
  const canPause = items.some((it) => it.phase === 'queued' || (ACTIVE.includes(it.phase) && !it.pausing));
  const canResume = items.some((it) => it.phase === 'paused');
  const hasFailed = items.some((it) => ['error', 'cancelled', 'done'].includes(it.phase));

  const status =
    tool.state === 'installing'
      ? { tone: 'busy', text: 'Instalando o yt-dlp (só na primeira vez)…' }
      : tool.state === 'error'
        ? { tone: 'danger', text: 'Não foi possível baixar o yt-dlp.', actions: [{ label: 'Tentar de novo', run: () => api.retryTool() }] }
        : !settingsOpen && loginState.state === 'waiting'
          ? { tone: 'busy', text: `Entre nas contas na janela do ${loginState.browser || 'navegador'} e feche-a ao terminar.` }
          : !settingsOpen && loginState.state === 'checking'
            ? { tone: 'busy', text: 'Verificando o login…' }
            : null;
  const dismissible = notice && {
    ...notice,
    actions: (notice.actions || []).map((a) => ({ ...a, run: () => { setNotice(null); a.run(); } })),
  };

  const empty = !text.trim() && items.length === 0 && history.length === 0;
  const bar = (
    <LinkBar
      inputRef={inputRef}
      text={text}
      setText={(v) => {
        setText(v);
        if (inputError) setInputError('');
      }}
      count={valid.length}
      source={single ? badgeOf(single) : null}
      onSubmit={submit}
      onPasteLinks={onPasteLinks}
      invalid={Boolean(inputError)}
    />
  );

  return (
    <div className="relative flex h-full flex-col bg-bg-base">
      <TitleBar
        ref={settingsButton}
        update={update}
        busy={items.some((it) => ACTIVE.includes(it.phase))}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((v) => !v)}
      />

      {empty ? (
        <main className="flex min-h-0 flex-1 flex-col" inert={settingsOpen}>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-20 pb-18">
            <Mark size={44} />
            <h1 className="mt-5 font-display text-title font-semibold">Cole um link</h1>
            <p className="mt-1 text-center text-text-secondary">Vídeos e áudios de quase todo site, ou qualquer arquivo.</p>
            <div className="mt-6 w-full">{bar}</div>
            {status && (
              <div className="mt-3 w-full">
                <Banner notice={status} />
              </div>
            )}
            {clipOffer && !status && (
              <div className="mt-3">
                <ClipChip urls={clipOffer} onPaste={pasteOffer} />
              </div>
            )}
          </div>
          <p className="flex h-12 shrink-0 items-center justify-center gap-2 text-minor text-text-tertiary">
            <span>Até 3 ao mesmo tempo</span>
            <span aria-hidden>·</span>
            <span>Retoma se a internet cair</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`size-1.5 rounded-full ${prefs?.extension?.connected ? 'bg-success-fg' : 'bg-text-tertiary'}`} />
              {prefs?.extension?.connected ? 'Extensão do Chrome conectada' : 'Extensão do Chrome não conectada'}
            </span>
          </p>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col" inert={settingsOpen}>
          <div className="flex shrink-0 flex-col gap-2 px-6 pt-2">
            {bar}
            {inputError && (
              <p id="link-error" role="alert" className="text-minor text-danger-fg">
                {inputError}
              </p>
            )}
            {status && <Banner notice={status} />}
            {dismissible && <Banner notice={dismissible} onDismiss={() => setNotice(null)} />}
            {mode === 'single' && (
              <PreviewCard
                url={single}
                kind={singleKind}
                preview={previews[single]}
                already={singleKind !== 'playlist' && !(singleKind === 'ambiguous' && playlistChoice === 'playlist') ? already[historyKey(single, fmtFor(single))] : null}
                pending={singleKind !== 'playlist' && isPending(single, fmtFor(single))}
                playlistChoice={playlistChoice}
                setPlaylistChoice={setPlaylistChoice}
                format={format}
                setFormat={setFormat}
                maxHeight={maxHeight}
                setMaxHeight={setMaxHeight}
                bitrate={bitrate}
                compat={compat}
                folder={format === 'video' ? folderVideo : folderAudio}
                fileFolder={prefs?.fileFolder}
                onChooseFolder={chooseFolder}
                onSubmit={submit}
                disabled={tool.state === 'error' && singleKind !== 'file'}
              />
            )}
            {mode === 'batch' && (
              <BatchCard
                rows={batchRows}
                onToggle={(url) =>
                  setIncluded((cur) => {
                    const next = new Set(cur);
                    if (next.has(url)) next.delete(url);
                    else next.add(url);
                    return next;
                  })
                }
                format={format}
                setFormat={setFormat}
                maxHeight={maxHeight}
                setMaxHeight={setMaxHeight}
                folder={format === 'video' ? folderVideo : folderAudio}
                fileFolder={prefs?.fileFolder}
                onChooseFolder={chooseFolder}
                onSubmit={submit}
                disabled={tool.state === 'error'}
              />
            )}
            {mode === 'empty' && clipOffer && (
              <div className="flex">
                <ClipChip urls={clipOffer} onPaste={pasteOffer} />
              </div>
            )}
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-focus-inset>
            <DownloadList
              active={active}
              concluded={concluded}
              speed={speed}
              canPause={canPause}
              canResume={canResume}
              onPauseAll={pauseAll}
              onResumeAll={resumeAll}
              rowActions={rowActions}
              places={placesReady}
              search={search}
              setSearch={setSearch}
              hasFailed={hasFailed}
              onClearFailed={clearFailed}
              onClearHistory={confirmClearHistory}
              hasHistory={history.length > 0}
            />
            {!active.length && !concluded.length && search === null && (
              <p className="px-3 text-body text-text-tertiary">O que você baixar aparece aqui.</p>
            )}
          </div>
        </main>
      )}

      {settingsOpen && (
        <Settings
          onClose={() => {
            setSettingsOpen(false);
            settingsButton.current?.focus();
          }}
          prefs={prefs}
          setPrefs={setPrefs}
          folderAudio={folderAudio}
          folderVideo={folderVideo}
          onChooseFolder={chooseFolder}
          bitrate={bitrate}
          setBitrate={setBitrate}
          compat={compat}
          setCompat={setCompat}
          login={loginState}
          loggedIn={loggedIn}
          onLogin={() => login()}
          onLogout={logout}
          update={update}
          busy={items.some((it) => ACTIVE.includes(it.phase))}
        />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-modal flex items-center justify-center bg-scrim-strong">
          <p className="flex items-center gap-2 rounded-overlay border border-border-default bg-bg-card px-4 py-3 font-display text-subtitle text-text-primary shadow-overlay">
            <Download size={20} aria-hidden />
            Solte para baixar
          </p>
        </div>
      )}
    </div>
  );
}
