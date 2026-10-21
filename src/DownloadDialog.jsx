import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FolderOpen, Pause, Play, RotateCw } from 'lucide-react';
import { Button, Field } from './ui.jsx';

/*
 * Janelas pequenas do acelerador (como as do IDM, sem o resto):
 * - "ask": o YTA assumiu um download do navegador — nome, pasta, lembrar a pasta, baixar/cancelar;
 * - "progress": andamento de um item que veio do navegador (download capturado ou botão do vídeo):
 *   baixando → pausado → concluído/erro, na mesma janela, com as ações da fila (Pausar, Cancelar…).
 * Cada uma é uma janela própria do Electron; a altura segue o conteúdo (dialogFit).
 */
const api = window.yta;

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function bytes(n) {
  if (!n) return null;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${decimal.format(n / 1024 / 1024)} MB`;
  return `${decimal.format(n / 1024 ** 3)} GB`;
}
function duration(s) {
  if (s === null || s === undefined) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
const ACTIVE = ['preparing', 'download', 'convert'];
const FORMAT_LABEL = { m4a: 'M4A', opus: 'Opus', mp3: 'MP3', video: 'MP4' };

/** O que está acontecendo, nas palavras da fila (QueueItem). */
function phaseText(it) {
  if (it.pausing && ACTIVE.includes(it.phase)) return 'Pausando…';
  switch (it.phase) {
    case 'queued':
      return 'Na fila';
    case 'preparing':
      return it.kind === 'file' ? 'Conectando…' : it.retry ? 'Tentando de novo…' : 'Buscando o vídeo…';
    case 'download':
      return it.part === 'video' ? 'Baixando vídeo' : it.part === 'audio' ? 'Baixando áudio' : 'Baixando';
    case 'convert':
      if (it.format === 'video') return it.copy === false ? 'Convertendo para H.264' : 'Juntando vídeo e áudio';
      return it.copy ? 'Finalizando' : `Convertendo para ${FORMAT_LABEL[it.format] || it.format}`;
    case 'paused':
      return 'Pausado';
    case 'done':
      return 'Concluído';
    case 'error':
      return 'Falhou';
    default:
      return '';
  }
}

export default function DownloadDialog({ kind }) {
  const [data, setData] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    api.dialogData().then(setData);
  }, []);
  // A janela nasce escondida e só aparece com a altura certa.
  useLayoutEffect(() => {
    document.documentElement.style.overflow = 'hidden'; // a janela já tem a altura do conteúdo
    if (data && ref.current) api.dialogFit(Math.ceil(ref.current.getBoundingClientRect().height));
  });
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && api.dialogAnswer({ action: 'cancel' });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!data) return null;
  return (
    <div ref={ref} className="bg-bg-base">
      {kind === 'ask' ? <Ask data={data} /> : <Progress data={data} />}
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-minor text-text-secondary">
      <input type="checkbox" className="size-3.5 accent-accent-solid" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Ask({ data }) {
  const [name, setName] = useState(data.name || '');
  const [folder, setFolder] = useState(data.folder);
  const [remember, setRemember] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const [taken, setTaken] = useState(null); // nome que vai sair se este já existir
  const nameRef = useRef(null);
  const folderRef = useRef(null);
  // Caminho longo: mostra o fim (o nome da pasta), não o começo (C:\Users\…).
  useEffect(() => {
    if (folderRef.current) folderRef.current.scrollLeft = folderRef.current.scrollWidth;
  }, [folder]);

  useEffect(() => {
    // Seleciona o nome sem a extensão (renomear é o caso comum; a extensão fica).
    const el = nameRef.current;
    const dot = name.lastIndexOf('.');
    el?.focus();
    el?.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      if (name.trim()) api.dialogNameFree(folder, name.trim()).then((r) => live && setTaken(r?.free === false ? r.next : null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, folder]);

  async function choose() {
    const picked = await api.pickFolder(folder);
    if (picked) setFolder(picked);
  }
  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    api.dialogAnswer({ action: 'download', name: name.trim(), folder, remember, dontAsk });
  }

  const meta = [bytes(data.size), data.host].filter(Boolean).join(' · ');
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5" noValidate>
      <Field label="Nome do arquivo" hint={taken ? `Já existe; vai salvar como “${taken}”.` : meta}>
        {({ id, describedBy }) => (
          <input
            ref={nameRef}
            id={id}
            className="input-field"
            data-focus-quiet
            spellCheck={false}
            autoComplete="off"
            value={name}
            aria-describedby={describedBy}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-col gap-2">
        <Field label="Salvar em">
          {({ id }) => (
            <div className="flex gap-2">
              <input ref={folderRef} id={id} className="input-field min-w-0 font-mono text-text-secondary" data-focus-quiet readOnly value={folder} onDoubleClick={choose} />
              <Button onClick={choose} className="shrink-0">
                <FolderOpen size={16} aria-hidden />
                Escolher…
              </Button>
            </div>
          )}
        </Field>
        <Check checked={remember} onChange={setRemember}>
          Lembrar esta pasta
        </Check>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle pt-4">
        <Check checked={dontAsk} onChange={setDontAsk}>
          Não perguntar de novo
        </Check>
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => api.dialogAnswer({ action: 'cancel' })}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          <Download size={16} aria-hidden />
          Baixar
        </Button>
      </div>
    </form>
  );
}

function Progress({ data }) {
  const [it, setIt] = useState(data);
  const [dontShow, setDontShow] = useState(false);
  // O que a janela acumula por conta própria: tamanho de cada parte baixada (vídeo e áudio vêm
  // separados), o último percentual (pausado) e o tempo ativo (média e duração no fim).
  const track = useRef({ sizes: {}, got: {}, conns: 0, percent: 0, active: 0, at: 0, phase: null });
  useEffect(
    () =>
      api.onProgressUpdate((next) => {
        const t = track.current;
        const now = Date.now();
        if (t.at && ACTIVE.includes(t.phase)) t.active += now - t.at;
        t.at = now;
        t.phase = next.phase;
        if (next.phase === 'download') {
          const part = next.part || 'main';
          if (next.size) t.sizes[part] = next.size;
          if (next.done != null) t.got[part] = next.done;
          if (next.conns > t.conns) t.conns = next.conns;
        }
        if (ACTIVE.includes(next.phase) && next.percent != null) t.percent = next.percent;
        setIt(next);
      }),
    [],
  );

  const t = track.current;
  const file = it.kind === 'file';
  const name = it.title || it.url;
  const active = ACTIVE.includes(it.phase);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0) || null;
  const downloaded = sum(t.sizes);
  const got = sum(t.got); // pausado: o que já veio, não o tamanho
  const last = file
    ? ['Conexões', it.phase === 'download' && it.conns > 0 ? String(it.conns) : it.phase === 'done' && t.conns ? String(t.conns) : '—']
    : ['Formato', it.format === 'video' ? (it.height ? `${it.height}p · MP4` : 'MP4') : FORMAT_LABEL[it.format] || '—'];
  const dash = '—';
  const cells =
    it.phase === 'download'
      ? [
          ['Baixado', it.done != null && it.size ? `${bytes(it.done)} de ${bytes(it.size)}` : bytes(it.done) || dash],
          ['Velocidade', it.speed ? `${bytes(it.speed)}/s` : dash],
          ['Restante', it.eta != null ? duration(it.eta) : dash],
          last,
        ]
      : it.phase === 'convert'
        ? [
            ['Baixado', bytes(downloaded) || dash],
            ['Velocidade', !it.copy && it.speed ? `${decimal.format(it.speed)}× o tempo real` : dash],
            ['Restante', it.eta != null ? duration(Math.ceil(it.eta)) : dash],
            last,
          ]
        : it.phase === 'paused'
          ? [['Baixado', got && downloaded ? `${bytes(got)} de ${bytes(downloaded)}` : bytes(got) || dash], ['Velocidade', 'Pausado'], ['Restante', dash], last]
          : it.phase === 'done'
            ? [
                ['Tamanho', bytes(it.doneSize) || dash],
                ['Média', it.doneSize && t.active > 1000 ? `${bytes(it.doneSize / (t.active / 1000))}/s` : dash],
                ['Tempo', t.active > 0 ? duration(Math.max(1, t.active / 1000)) : dash],
                last,
              ]
            : [['Baixado', dash], ['Velocidade', dash], ['Restante', dash], last];
  const percent = it.phase === 'done' ? 100 : active && it.percent != null ? it.percent : t.percent;
  const many = (it.files?.length || 0) > 1;
  const act = (action) => api.itemAction(action);
  const hide = () => api.dialogAnswer({ action: 'close' });

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex min-w-0 items-center gap-3">
        {it.phase === 'done' && <CheckCircle2 size={16} aria-hidden className="shrink-0 text-success-fg" />}
        {it.phase === 'error' && <AlertCircle size={16} aria-hidden className="shrink-0 text-danger-fg" />}
        <p className={`min-w-0 flex-1 truncate text-body text-text-primary ${file ? 'font-mono' : ''}`}>{name}</p>
        <span
          className={`shrink-0 text-body font-medium tabular-nums ${
            it.phase === 'done' ? 'text-success-fg' : it.phase === 'error' ? 'text-danger-fg' : it.phase === 'paused' ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {it.phase === 'done' ? 'Concluído' : it.phase === 'error' ? 'Falhou' : `${Math.floor(percent || 0)}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={phaseText(it)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent || 0)}
        className="h-1.5 overflow-hidden rounded-full bg-bg-elevated"
      >
        <div
          className={`h-full origin-left motion-ok:transition-transform motion-ok:duration-(--motion-base) ${
            it.phase === 'done' ? 'bg-success-fg' : it.phase === 'paused' || it.phase === 'error' ? 'bg-text-tertiary' : 'bg-accent-solid'
          }`}
          style={{ transform: `scaleX(${(percent || 0) / 100})` }}
        />
      </div>
      <p className="truncate text-caption text-text-tertiary" aria-live="polite">
        {it.phase !== 'done' && it.phase !== 'error' && (
          <>
            <span className="text-text-secondary">{phaseText(it)}</span>
            <span aria-hidden> · </span>
          </>
        )}
        {it.host}
        {it.folder && (
          <>
            <span aria-hidden> → </span>
            <span className="font-mono">{it.folder}</span>
          </>
        )}
      </p>
      {it.phase === 'error' ? (
        <p className="text-minor text-danger-fg" role="alert">
          {it.error || 'O download falhou.'}
        </p>
      ) : (
        <div className="grid grid-cols-[3fr_2fr_2fr_2fr] gap-3">
          {cells.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <span className="label-micro text-text-tertiary">{label}</span>
              <span className={`truncate text-body tabular-nums ${value === dash || value === 'Pausado' ? 'text-text-secondary' : 'text-text-primary'}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border-subtle pt-4">
        <Check
          checked={dontShow}
          onChange={(v) => {
            setDontShow(v); // vale na hora; religa na bandeja ou no popup da extensão
            api.setDownloadPrefs({ showProgress: !v });
          }}
        >
          Não mostrar esta janela
        </Check>
        <span className="flex-1" />
        {it.phase === 'done' ? (
          <>
            <Button variant="ghost" onClick={hide}>
              Fechar
            </Button>
            <Button
              onClick={() => {
                api.reveal(it.file);
                hide();
              }}
            >
              <FolderOpen size={16} aria-hidden />
              Abrir pasta
            </Button>
            {!many && (
              <Button
                variant="primary"
                onClick={() => {
                  api.openFile(it.file);
                  hide();
                }}
              >
                Abrir
              </Button>
            )}
          </>
        ) : it.phase === 'error' ? (
          <>
            <Button variant="ghost" onClick={hide}>
              Fechar
            </Button>
            <Button variant="primary" onClick={() => act('retry')}>
              <RotateCw size={16} aria-hidden />
              Tentar de novo
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => act('cancel')}>
              Cancelar
            </Button>
            {it.phase === 'paused' ? (
              <Button variant="primary" onClick={() => act('resume')}>
                <Play size={16} aria-hidden />
                Retomar
              </Button>
            ) : (
              <Button disabled={it.pausing} onClick={() => act('pause')}>
                <Pause size={16} aria-hidden />
                Pausar
              </Button>
            )}
            <Button onClick={hide}>Esconder</Button>
          </>
        )}
      </div>
    </div>
  );
}
