import { memo, useEffect, useRef, useState } from 'react';
import { AlertCircle, CircleSlash, Film, FolderOpen, ListVideo, MoreHorizontal, Music, Pause, Play, RotateCw, Search, X } from 'lucide-react';
import { Button, IconButton, Menu } from './ui.jsx';
import { ACTIVE, bytes, dayLabel, decimal, duration, extOf, fileUrl, FORMAT_LABEL, folderName, phaseText, shortUrl, siteLabel, timeLabel, ytThumb } from './labels.js';

/*
 * A lista única (2.0): "Agora" (o que vai baixar ou está baixando) e, embaixo, o que terminou,
 * agrupado por dia — o histórico e as falhas desta sessão juntos, mais novos em cima. Substitui as
 * abas Fila/Baixados. Ações da linha aparecem no hover E no foco (teclado alcança).
 */

/** Miniatura: a imagem do vídeo; sem ela (ou se não carregar), um ladrilho com o tipo. */
export function Thumb({ src, kind, name, large = false, dim = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const box = large ? 'h-20 w-36 rounded-control' : 'h-9 w-16 rounded-thumb';
  if (src && !failed)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className={`${box} shrink-0 bg-bg-elevated object-cover ${dim ? 'opacity-50' : ''}`}
      />
    );
  const icon = large ? 22 : 16;
  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center border border-border-default bg-bg-elevated text-text-secondary ${dim ? 'opacity-60' : ''}`}
    >
      {kind === 'file' ? (
        <span className="text-caption font-semibold tracking-wide">{extOf(name)}</span>
      ) : kind === 'playlist' ? (
        <ListVideo size={icon} strokeWidth={1.5} />
      ) : kind === 'error' ? (
        <AlertCircle size={icon} strokeWidth={1.75} className="text-danger-fg" />
      ) : kind === 'cancelled' ? (
        <CircleSlash size={icon} strokeWidth={1.5} />
      ) : kind === 'video' ? (
        <Film size={icon} strokeWidth={1.5} />
      ) : (
        <Music size={icon} strokeWidth={1.5} />
      )}
    </span>
  );
}

const thumbKind = (format, kind) => (kind === 'file' || format === 'file' ? 'file' : kind === 'playlist' ? 'playlist' : format === 'video' ? 'video' : 'audio');

function Bar({ percent, tone = 'live' }) {
  return (
    <div aria-hidden className="h-0.5 overflow-hidden rounded-full bg-track">
      <div
        className={`h-full origin-left motion-ok:transition-transform motion-ok:duration-(--motion-base) ${tone === 'live' ? 'bg-accent-solid' : 'bg-text-tertiary'}`}
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, percent || 0)) / 100})` }}
      />
    </div>
  );
}

/**
 * Ações que aparecem no hover/foco da linha, no mesmo lugar do texto de repouso (hora, %).
 * `inline`: dentro de uma linha de texto (o % do item baixando) — os botões de 28 px não
 * aumentam a linha e o último ícone alinha com a borda do texto.
 */
function Swap({ rest, actions, inline = false }) {
  return (
    <div className="grid shrink-0 items-center justify-items-end">
      {rest && (
        <div className="col-start-1 row-start-1 motion-ok:transition-opacity motion-ok:duration-(--motion-fast) group-hover:opacity-0 group-focus-within:opacity-0">
          {rest}
        </div>
      )}
      <div
        className={`col-start-1 row-start-1 flex items-center gap-0.5 opacity-0 motion-ok:transition-opacity motion-ok:duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 ${inline ? '-my-1.5 -mr-1.5' : ''}`}
      >
        {actions}
      </div>
    </div>
  );
}

const rowClass = 'group flex min-w-0 items-center gap-3 rounded-control px-3 py-2 hover:bg-bg-card focus-within:bg-bg-card';

/* ---------- Em andamento (fila) ---------- */
export const ActiveRow = memo(
  function ActiveRow({ item, onPause, onResume, onCancel }) {
    const p = item.progress || {};
    const file = item.kind === 'file';
    const site = item.site || siteLabel(item.url);
    const paused = item.phase === 'paused';
    const moving = item.phase === 'download' || item.phase === 'convert';
    const phase = phaseText(item);
    const left = [];
    const right = [];
    if (item.phase === 'download') {
      left.push(site);
      if (phase !== 'Baixando') left.push(phase);
      if (p.done != null) left.push(p.size ? `${bytes(p.done)} de ${bytes(p.size)}` : bytes(p.done));
      if (file && p.conns > 1) left.push(`${p.conns} conexões`);
      if (p.speed) right.push(`${bytes(p.speed)}/s`);
      if (p.eta != null && p.percent < 100) right.push(duration(p.eta));
    } else if (item.phase === 'convert') {
      left.push(phase);
      if (p.speed && !p.copy) right.push(`${decimal.format(p.speed)}× o tempo real`);
      if (p.eta != null && p.percent < 100) right.push(duration(Math.ceil(p.eta)));
    } else if (paused) {
      left.push('Pausado');
      if (p.done != null && p.size) left.push(`${bytes(p.done)} de ${bytes(p.size)}`);
      left.push('continua de onde parou');
    } else {
      left.push(phase);
    }
    // Pausado mantém o % e a barra onde parou, apagados (sem progresso — pausado antes de começar
    // ou fila restaurada — nem um nem outro).
    const percent = moving || paused ? p.percent : null;
    const canPause = ACTIVE.includes(item.phase) && !item.pausing;
    return (
      <li className={rowClass}>
        <Thumb src={item.thumb || ytThumb(item.url)} kind={thumbKind(item.format, item.kind)} name={item.fileName || item.title || item.url} dim={paused} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-3">
            <p className={`min-w-0 flex-1 truncate ${file ? 'font-mono text-minor leading-[inherit]' : ''} ${paused ? 'text-text-secondary' : ''}`}>
              {item.title || shortUrl(item.url)}
            </p>
            {/* O % dá lugar a Pausar/Cancelar no hover e no foco: a linha usa a largura toda. */}
            <Swap
              inline
              rest={percent != null && <span className={`font-medium tabular-nums ${paused ? 'text-text-tertiary' : ''}`}>{Math.floor(percent)}%</span>}
              actions={
                <>
                  {canPause && (
                    <IconButton size="sm" label="Pausar" onClick={() => onPause(item)}>
                      <Pause size={14} aria-hidden />
                    </IconButton>
                  )}
                  <IconButton size="sm" label={ACTIVE.includes(item.phase) ? 'Cancelar' : 'Tirar da fila'} onClick={() => onCancel(item)}>
                    <X size={14} aria-hidden />
                  </IconButton>
                </>
              }
            />
          </div>
          {(moving || (paused && percent != null)) && <Bar percent={percent} tone={paused ? 'rest' : 'live'} />}
          {/* Sem aria-live: bytes e velocidade mudam várias vezes por segundo (o leitor de tela não
              pararia de falar). O fim (falhou) é anunciado pela linha de falha. */}
          <div className="flex min-w-0 items-center gap-3 text-minor text-text-secondary">
            <span className="min-w-0 flex-1 truncate tabular-nums">{left.filter(Boolean).join(' · ')}</span>
            {paused ? (
              <Button variant="ghost" size="xs" className="-my-1 -mr-1.5" onClick={() => onResume(item)}>
                <Play size={12} aria-hidden fill="currentColor" />
                Retomar
              </Button>
            ) : (
              right.length > 0 && <span className="shrink-0 text-text-tertiary tabular-nums">{right.join(' · ')}</span>
            )}
          </div>
        </div>
      </li>
    );
  },
  (a, b) => a.item === b.item,
);

/* ---------- Falhou / cancelado (desta sessão) ---------- */
export const FailedRow = memo(
  function FailedRow({ item, onRetry, onLogin, onRemove }) {
    const error = item.phase === 'error';
    return (
      <li className={rowClass}>
        <Thumb kind={error ? 'error' : 'cancelled'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={`truncate ${item.kind === 'file' ? 'font-mono text-minor leading-[inherit]' : ''}`}>{item.title || shortUrl(item.url)}</p>
          <p className={`line-clamp-2 text-minor ${error ? 'text-danger-fg' : 'text-text-secondary'}`} role={error ? 'alert' : undefined}>
            {error ? item.error || 'O download falhou.' : 'Cancelado'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {item.needsLogin ? (
            <Button variant="ghost" size="sm" onClick={() => onLogin(item)}>
              Entrar e tentar de novo
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onRetry(item)}>
              <RotateCw size={12} aria-hidden />
              {error ? 'Tentar de novo' : 'Baixar de novo'}
            </Button>
          )}
          <IconButton size="sm" label="Tirar da lista" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(item)}>
            <X size={14} aria-hidden />
          </IconButton>
        </div>
      </li>
    );
  },
  (a, b) => a.item === b.item,
);

/* ---------- Concluído (histórico, ou item que acabou de terminar) ---------- */
export const DoneRow = memo(
  function DoneRow({ entry, onReveal, onOpen, onAgain, onCopy, onForget, places }) { // eslint-disable-line no-unused-vars
    const files = entry.files || [];
    const exists = entry.exists !== false;
    const file = entry.format === 'file';
    const site = entry.site || siteLabel(entry.url);
    const meta = exists
      ? [site, FORMAT_LABEL[entry.format], files.length > 1 ? `${files.length} arquivos` : null, bytes(entry.size), files[0] ? folderName(files[0].replace(/[\\/][^\\/]*$/, '')) : null]
          .filter(Boolean)
          .join(' · ')
      : 'O arquivo não está mais na pasta';
    return (
      <li className={`${rowClass} cursor-default`} onDoubleClick={() => exists && onOpen(entry)}>
        <Thumb
          src={entry.thumb ? fileUrl(entry.thumb) : entry.thumbUrl || ytThumb(entry.url)}
          kind={thumbKind(entry.format)}
          name={entry.title || files[0]}
          dim={!exists}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={`truncate ${file ? 'font-mono text-minor leading-[inherit]' : ''} ${exists ? '' : 'text-text-secondary'}`}>{entry.title || shortUrl(entry.url)}</p>
          <p className="truncate text-minor text-text-secondary tabular-nums">{meta}</p>
        </div>
        <Swap
          rest={<span className="text-minor text-text-tertiary tabular-nums">{timeLabel(entry.at)}</span>}
          actions={
            <>
              {exists && (
                <IconButton size="sm" label="Mostrar na pasta" onClick={() => onReveal(entry)}>
                  <FolderOpen size={14} aria-hidden />
                </IconButton>
              )}
              <Menu
                label="Ações do item"
                width={200}
                items={[
                  ...(exists && files.length === 1 ? [{ label: 'Abrir', onSelect: () => onOpen(entry) }] : []),
                  { label: 'Baixar de novo', onSelect: () => onAgain(entry) },
                  { label: 'Copiar link', onSelect: () => onCopy(entry) },
                  { separator: true },
                  { label: 'Tirar da lista', onSelect: () => onForget(entry) },
                ]}
                trigger={(props) => (
                  <IconButton size="sm" label="Mais ações" {...props}>
                    <MoreHorizontal size={14} aria-hidden />
                  </IconButton>
                )}
              />
            </>
          }
        />
      </li>
    );
  },
  // places: os nomes em português das pastas (Música, Vídeos) chegaram depois da lista.
  (a, b) => a.entry === b.entry && a.places === b.places,
);

function SectionHeader({ label, children }) {
  return (
    <div className="flex h-band items-center gap-1 px-3">
      <h2 className="label-micro text-text-tertiary">{label}</h2>
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** Busca nos concluídos: abre no cabeçalho da primeira data; Esc limpa e fecha. */
function SearchField({ value, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex items-center gap-1">
      <label htmlFor="busca" className="sr-only">
        Buscar nos baixados
      </label>
      <div className="flex h-7 w-56 items-center gap-1.5 rounded-control border border-border-strong bg-bg-input px-2" data-focus-within-quiet>
        <Search size={12} aria-hidden className="shrink-0 text-text-tertiary" />
        <input
          id="busca"
          ref={ref}
          type="search"
          value={value}
          placeholder="Buscar nos baixados"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          className="min-w-0 flex-1 bg-transparent text-minor text-text-primary outline-none placeholder:text-text-tertiary"
          data-focus-quiet
        />
      </div>
      <IconButton size="sm" label="Fechar busca" onClick={onClose}>
        <X size={14} aria-hidden />
      </IconButton>
    </div>
  );
}

export function DownloadList({ active, concluded, speed, canPause, canResume, onPauseAll, onResumeAll, rowActions, search, setSearch, hasFailed, onClearFailed, onClearHistory, hasHistory, places }) {
  // Concluídos por dia, na ordem (mais novo em cima).
  const groups = [];
  for (const row of concluded) {
    const label = dayLabel(row.at);
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1).rows.push(row);
  }
  const searching = search !== null;
  const concludedTools = (
    <>
      {searching ? (
        <SearchField value={search} onChange={setSearch} onClose={() => setSearch(null)} />
      ) : (
        <IconButton size="sm" label="Buscar nos baixados" onClick={() => setSearch('')}>
          <Search size={14} aria-hidden />
        </IconButton>
      )}
      <Menu
        label="Ações da lista"
        width={220}
        items={[
          { label: 'Limpar falhas e cancelados', disabled: !hasFailed, onSelect: onClearFailed },
          { label: 'Limpar o histórico…', disabled: !hasHistory, onSelect: onClearHistory },
        ]}
        trigger={(props) => (
          <IconButton size="sm" label="Mais ações da lista" {...props}>
            <MoreHorizontal size={14} aria-hidden />
          </IconButton>
        )}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 && (
        <section aria-label="Agora">
          <SectionHeader label="Agora">
            {speed > 0 && <span className="mr-1 text-minor text-text-secondary tabular-nums">{bytes(speed)}/s</span>}
            {canResume && (
              <IconButton size="sm" label="Retomar tudo" onClick={onResumeAll}>
                <Play size={14} aria-hidden />
              </IconButton>
            )}
            {canPause && (
              <IconButton size="sm" label="Pausar tudo" onClick={onPauseAll}>
                <Pause size={14} aria-hidden />
              </IconButton>
            )}
          </SectionHeader>
          <ul className="flex flex-col">
            {active.map((item) => (
              <ActiveRow key={item.id} item={item} onPause={rowActions.pause} onResume={rowActions.resume} onCancel={rowActions.cancel} />
            ))}
          </ul>
        </section>
      )}

      {(groups.length > 0 || searching) && (
        <div className="flex flex-col gap-2">
          {groups.length === 0 && (
            <>
              <SectionHeader label="Baixados">{concludedTools}</SectionHeader>
              <p className="px-3 text-body text-text-tertiary">Nada encontrado.</p>
            </>
          )}
          {groups.map((g, i) => (
            <section key={g.label} aria-label={g.label}>
              <SectionHeader label={g.label}>{i === 0 && concludedTools}</SectionHeader>
              <ul className="flex flex-col">
                {g.rows.map((row) =>
                  row.type === 'history' ? (
                    <DoneRow
                      key={`h-${row.entry.uid}-${row.entry.at}`}
                      entry={row.entry}
                      onReveal={rowActions.reveal}
                      onOpen={rowActions.open}
                      onAgain={rowActions.again}
                      onCopy={rowActions.copy}
                      onForget={rowActions.forget}
                      places={places}
                    />
                  ) : (
                    <FailedRow key={`q-${row.item.id}`} item={row.item} onRetry={rowActions.retry} onLogin={rowActions.login} onRemove={rowActions.remove} />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
