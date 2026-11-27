import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Pause, Play, RotateCw } from 'lucide-react';
import { Button, Mark } from './ui.jsx';
import { Thumb } from './DownloadList.jsx';
import { ACTIVE, bytes, decimal, duration, FORMAT_LABEL, phaseText, ytThumb } from './labels.js';

/*
 * Janelas pequenas do acelerador (como as do IDM, sem o resto):
 * - "ask": o YTA assumiu um download do navegador — nome, pasta, lembrar a pasta, baixar/cancelar;
 * - "progress": andamento de um item que veio do navegador (download capturado ou botão do vídeo):
 *   baixando → pausado → concluído/erro, na mesma janela, com as ações da fila (Pausar, Cancelar…).
 * Cada uma é uma janela própria do Electron; a altura segue o conteúdo (dialogFit). A faixa de
 * título é do app (os 3 botões do Windows ficam por cima, à direita).
 */
const api = window.yta;

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

function TitleStrip({ children }) {
  return (
    <div className="drag-region flex h-titlebar-sm items-center gap-2 pl-3.5 pr-caption">
      <Mark size={16} />
      <span className="min-w-0 truncate text-minor text-text-secondary">{children}</span>
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-minor text-text-secondary">
      <input type="checkbox" className="size-4 accent-ink" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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

  const meta = [bytes(data.size), data.host, 'baixa em até 8 conexões'].filter(Boolean).join(' · ');
  return (
    <>
      <TitleStrip>Baixar arquivo</TitleStrip>
      <form onSubmit={submit} className="flex flex-col" noValidate>
        <div className="flex flex-col gap-5 px-6 pb-5 pt-4">
          <div className="flex items-start gap-3.5">
            <Thumb kind="file" name={name || data.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="nome-arquivo" className="sr-only">
                Nome do arquivo
              </label>
              <input
                id="nome-arquivo"
                ref={nameRef}
                className="input-field h-9 font-mono text-minor"
                data-focus-quiet
                spellCheck={false}
                autoComplete="off"
                value={name}
                aria-describedby="nome-dica"
                onChange={(e) => setName(e.target.value)}
              />
              <p id="nome-dica" className="truncate text-minor text-text-tertiary tabular-nums">
                {taken ? `Já existe; vai salvar como “${taken}”.` : meta}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="salvar-em" className="text-minor text-text-secondary">
              Salvar em
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                aria-labelledby="salvar-em"
                onClick={choose}
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-border-strong bg-bg-input px-2.5 text-left"
              >
                <FolderOpen size={16} aria-hidden className="shrink-0 text-text-tertiary" />
                <span className="min-w-0 truncate font-mono text-minor" dir="rtl">
                  <bdi>{folder}</bdi>
                </span>
              </button>
              <Button className="h-9" onClick={choose}>
                Alterar…
              </Button>
            </div>
            <div className="mt-1.5">
              <Check checked={remember} onChange={setRemember}>
                Lembrar esta pasta
              </Check>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border-subtle px-6 pb-4 pt-3.5">
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
    </>
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
  const title =
    it.phase === 'done' ? `Concluído · ${name}` : it.phase === 'error' ? `Falhou · ${name}` : it.phase === 'paused' ? `Pausado · ${name}` : `${Math.floor(percent || 0)}% · ${name}`;

  return (
    <>
      <TitleStrip>{title}</TitleStrip>
      <div className="flex flex-col gap-4 px-6 pb-5 pt-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Thumb src={it.thumb || ytThumb(it.url)} kind={file ? 'file' : it.format === 'video' ? 'video' : 'audio'} name={name} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className={`truncate ${file ? 'font-mono text-minor leading-[inherit]' : ''}`}>{name}</p>
            <p className="truncate text-minor text-text-tertiary" aria-live="polite">
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
          </div>
          <span
            className={`shrink-0 font-display tabular-nums ${
              it.phase === 'done'
                ? 'text-body font-medium text-success-fg'
                : it.phase === 'error'
                  ? 'text-body font-medium text-danger-fg'
                  : `text-title font-semibold ${it.phase === 'paused' ? 'text-text-secondary' : ''}`
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
          className="h-1 overflow-hidden rounded-full bg-track"
        >
          <div
            className={`h-full origin-left motion-ok:transition-transform motion-ok:duration-(--motion-base) ${
              it.phase === 'done' ? 'bg-success-fg' : it.phase === 'paused' || it.phase === 'error' ? 'bg-text-tertiary' : 'bg-accent-solid'
            }`}
            style={{ transform: `scaleX(${(percent || 0) / 100})` }}
          />
        </div>
        {it.phase === 'error' ? (
          <p className="text-minor text-danger-fg" role="alert">
            {it.error || 'O download falhou.'}
          </p>
        ) : (
          <div className="grid grid-cols-[3fr_2fr_2fr_2fr] gap-3">
            {cells.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <span className="label-micro text-text-tertiary">{label}</span>
                <span className={`truncate tabular-nums ${value === dash || value === 'Pausado' ? 'text-text-secondary' : 'text-text-primary'}`}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-6 pb-4 pt-3.5">
        <Check
          checked={dontShow}
          onChange={(v) => {
            setDontShow(v); // vale na hora; religa nos Ajustes, na bandeja ou no popup da extensão
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
    </>
  );
}
