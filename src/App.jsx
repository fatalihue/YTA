import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FolderOpen, Loader2, Puzzle } from 'lucide-react';
import { Button, Field, IconButton, SegmentedControl } from './ui.jsx';
import { QueueItem } from './QueueItem.jsx';

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
// Itens processados ao mesmo tempo: sobrepõe as consultas ao YouTube e usa mais núcleos na conversão.
const PARALLEL = 3;

/** ID do vídeo, para não enfileirar o mesmo vídeo duas vezes. */
function videoKey(url) {
  const ig = url.match(/instagram\.com\/(?:p|reels?|tv)\/([\w-]+)/i);
  if (ig) return `ig:${ig[1]}`;
  const m = YOUTUBE.test(url) && url.match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/);
  return m ? m[1] : url.replace(/#.*$/, '');
}

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
  const [notice, setNotice] = useState('');
  const [folder, setFolder] = useState(() => load('folder', ''));
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
  const running = useRef(new Set()); // ids em andamento
  // Valores atuais para os pedidos da extensão (o assinante é criado uma vez só).
  const settingsRef = useRef({});
  const itemsRef = useRef([]);
  settingsRef.current = { folder, format, bitrate, maxHeight, compat };
  itemsRef.current = items;

  const patch = (id, change) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...(typeof change === 'function' ? change(it) : change) } : it)));

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
    // Pedido da extensão (botão no vídeo ou yta://): entra na mesma fila, com a pasta atual.
    const offExternal = api.onExternalAdd((req) => {
      const s = settingsRef.current;
      const url = String(req.url || '').trim();
      if (!SUPPORTED(url)) {
        api.externalAdded({ reqId: req.reqId, ok: false, error: 'O YTA ainda não baixa deste site.' });
        return;
      }
      const fmt = ['m4a', 'opus', 'mp3', 'video'].includes(req.format) ? req.format : s.format;
      const key = `${fmt}:${videoKey(url)}`;
      const same = itemsRef.current.find(
        (it) => (it.phase === 'queued' || ACTIVE.includes(it.phase)) && `${it.format}:${videoKey(it.url)}` === key,
      );
      if (same) {
        api.externalAdded({ reqId: req.reqId, ok: true, id: same.id, existing: true });
        return;
      }
      const item = {
        id: nextId++, url, folder: s.folder, format: fmt,
        bitrate: Number(req.bitrate) || s.bitrate,
        maxHeight: fmt === 'video' ? (req.maxHeight === undefined ? s.maxHeight : req.maxHeight) : null,
        compat: fmt === 'video' && (req.compat === undefined ? s.compat : Boolean(req.compat)),
        // Da extensão: arquivo de vídeo que a página tocava (plano B), a página e o título dela.
        mediaUrl: req.mediaUrl || null, referer: req.referer || null, pageTitle: req.title || null,
        phase: 'queued', title: null, progress: {},
      };
      itemsRef.current = [...itemsRef.current, item];
      setItems((list) => [...list, item]);
      api.externalAdded({ reqId: req.reqId, ok: true, id: item.id });
    });
    api.rendererReady();
    // Pasta salva que sumiu volta para a pasta Música.
    (async () => {
      const saved = load('folder', '');
      if (!saved || !(await api.folderExists(saved))) setFolder(await api.defaultFolder());
    })();
    return () => {
      offTool();
      offJob();
      offExternal();
      offUpdate();
      offLogin();
    };
  }, []);

  // Estado resumido de cada item para o processo principal: é de onde a extensão lê o andamento.
  const reportTimer = useRef(null);
  useEffect(() => {
    if (reportTimer.current) return; // já há um envio marcado; ele lê a fila mais recente
    reportTimer.current = setTimeout(() => {
      reportTimer.current = null;
      api.reportItems(
        itemsRef.current.map((it) => ({
          id: it.id, url: it.url, title: it.title, format: it.format, phase: it.phase,
          part: it.progress?.part || null, percent: it.progress?.percent ?? null,
          copy: it.progress?.copy ?? null, file: it.file || null, error: it.error || null,
        })),
      );
    }, 250);
  }, [items]);

  useEffect(() => save('folder', folder), [folder]);
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
      const { id, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, pageTitle } = item;
      api
        .run({ id, url, folder: dir, format: fmt, bitrate: kbps, maxHeight: cap, compat: h264, mediaUrl, referer, title: pageTitle })
        .catch((err) => ({ ok: false, error: `Erro interno do YTA: ${err?.message || err}` }))
        .then((r) => {
          running.current.delete(item.id);
          if (r.ok) patch(item.id, { phase: 'done', file: r.file, files: r.files || [r.file], retry: null });
          else if (r.cancelled) patch(item.id, { phase: 'cancelled', retry: null });
          else patch(item.id, { phase: 'error', error: r.error, needsLogin: Boolean(r.needsLogin), retry: null });
        });
    }
  }, [items, tool.state]);

  const validLinks = links.split(/\s+/).filter((l) => SUPPORTED(l));
  const singleLink = validLinks.length === 1 ? validLinks[0] : null;

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
    if (picked) setFolder(picked);
  }

  function enqueue(e) {
    e?.preventDefault();
    const lines = links.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      setLinksError('Cole ao menos um link.');
      return;
    }
    const valid = [];
    const invalid = [];
    for (const l of lines) (SUPPORTED(l) ? valid : invalid).push(l);

    const pending = new Set(
      items.filter((it) => it.phase === 'queued' || ACTIVE.includes(it.phase)).map((it) => `${it.format}:${videoKey(it.url)}`),
    );
    let repeated = 0;
    const fresh = [];
    for (const url of valid) {
      const key = `${format}:${videoKey(url)}`;
      if (pending.has(key)) repeated++;
      else {
        pending.add(key);
        fresh.push({
          id: nextId++, url, folder, format, bitrate,
          maxHeight: format === 'video' ? maxHeight : null,
          compat: format === 'video' && compat,
          phase: 'queued', title: null, progress: {},
        });
      }
    }
    setItems((list) => [...list, ...fresh]);
    // O que não deu para enfileirar fica no campo, para corrigir.
    setLinks(invalid.join('\n'));
    setLinksError(
      invalid.length === 1 ? 'Esta linha não é um link (comece com https://).'
      : invalid.length > 1 ? `${invalid.length} linhas não são links (comece com https://).`
      : '',
    );
    setNotice(repeated === 1 ? '1 link já estava na fila.' : repeated > 1 ? `${repeated} links já estavam na fila.` : '');
  }

  function cancel(item) {
    if (item.phase === 'queued') setItems((list) => list.filter((it) => it.id !== item.id));
    else api.cancel(item.id);
  }
  const retry = (item) => patch(item.id, { phase: 'queued', progress: {}, error: null, needsLogin: false });

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
  const clearFinished = () => setItems((list) => list.filter((it) => it.phase === 'queued' || ACTIVE.includes(it.phase)));

  const finished = items.filter((it) => ['done', 'error', 'cancelled'].includes(it.phase)).length;
  const done = items.filter((it) => it.phase === 'done').length;
  const noun = format === 'video' ? ['vídeo', 'vídeos'] : ['áudio', 'áudios'];

  return (
    <main className="flex h-full flex-col bg-bg-base">
      <form onSubmit={enqueue} className="flex shrink-0 flex-col gap-3 p-6 pb-4" noValidate>
        <Field label="Links de vídeo" hint={notice || 'YouTube, Instagram e a maioria dos sites. Um por linha; Ctrl+Enter adiciona.'} error={linksError}>
          {({ id, describedBy, invalid }) => (
            <textarea
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
              onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && enqueue(e)}
              onChange={(e) => {
                setLinks(e.target.value);
                if (linksError) setLinksError('');
                if (notice) setNotice('');
              }}
            />
          )}
        </Field>

        <Field label="Salvar em">
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

      <section aria-labelledby="queue-title" className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
        <header className="flex h-band shrink-0 items-center gap-3 px-6">
          <h2 id="queue-title" className="label-micro text-text-tertiary">
            Fila
          </h2>
          {items.length > 0 && (
            <span className="text-minor text-text-tertiary tabular-nums">
              {done} de {items.length} {items.length === 1 ? 'salvo' : 'salvos'}
            </span>
          )}
          <span className="flex-1" />
          <UpdateNotice update={update} busy={items.some((it) => ACTIVE.includes(it.phase))} />
          <IconButton label="Extensão do navegador" onClick={() => api.extensionHelp()}>
            <Puzzle size={16} aria-hidden />
          </IconButton>
          <Button variant="ghost" className="h-7 shrink-0" disabled={!finished} onClick={clearFinished}>
            Limpar concluídos
          </Button>
        </header>
        {items.length === 0 ? (
          <p className="px-6 text-body text-text-tertiary">Os links adicionados aparecem aqui, até 3 ao mesmo tempo.</p>
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
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatHint(format, { probe, probing, multiple }) {
  if (format === 'm4a') return 'Áudio AAC original, sem perda. Toca em praticamente tudo.';
  if (format === 'opus') return 'Áudio Opus original: melhor qualidade e menor arquivo. Pode não tocar no iPhone.';
  if (format === 'mp3') return 'Convertido do original; 256 kbps compensa a perda. Toca em qualquer aparelho.';
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

/** Login do YouTube/Instagram (só usado quando o site exige). Fica no canto, calado. */
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
