import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Clipboard, Download, FolderOpen, Link2, Loader2, X } from 'lucide-react';
import { Button, IconButton, LinkButton, Menu, PillGroup, SegmentedControl } from './ui.jsx';
import { Thumb } from './DownloadList.jsx';
import { bytes, dayLabel, duration, folderName, shortUrl, timeLabel } from './labels.js';

/*
 * O topo do app (2.0): uma barra para o link e, embaixo, o que ele é — a prévia (título, duração,
 * formato, tamanho, pasta, Baixar) ou a lista curta de vários links. Substitui o formulário antigo
 * (campo de várias linhas, pasta, formato e qualidade sempre à vista).
 */

const AUDIO = [
  { value: 'm4a', label: 'M4A' },
  { value: 'opus', label: 'Opus' },
  { value: 'mp3', label: 'MP3' },
];
// Tetos de resolução quando a prévia não disse quais o vídeo tem.
const VIDEO_CAPS = [2160, 1440, 1080, 720, 480, 360];

/** Só mostra o "carregando" depois de ~200 ms (diretriz §3): consultas rápidas não piscam. */
function useDelayed(on, ms = 200) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return setLate(false);
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return late;
}

/** A barra do link. Com vários links colados, mostra quantos e aceita colar mais. */
export function LinkBar({ inputRef, text, setText, count, source, onSubmit, onPasteLinks, invalid }) {
  const batch = count > 1;
  return (
    <div
      data-focus-within-quiet
      className={`flex h-bar shrink-0 items-center gap-3 rounded-card border bg-bg-card pl-4 pr-2 ${invalid ? 'border-danger' : 'border-border-strong'}`}
    >
      <Link2 size={18} aria-hidden className="shrink-0 text-text-tertiary" />
      {batch && <span className="shrink-0 text-subtitle">{count} links colados</span>}
      <label htmlFor="link" className="sr-only">
        Link
      </label>
      <input
        id="link"
        ref={inputRef}
        type="text"
        autoFocus
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'link-error' : undefined}
        placeholder={batch ? 'Cole mais links ou pressione Enter' : 'Cole ou arraste um link'}
        value={batch ? '' : text}
        onChange={(e) => !batch && setText(e.target.value)}
        onPaste={(e) => onPasteLinks(e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape' && text) {
            e.preventDefault();
            setText('');
          }
        }}
        className={`h-full min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-tertiary ${
          text && !batch ? 'font-mono text-body' : 'text-subtitle'
        }`}
        data-focus-quiet
      />
      {source && !batch && <span className="shrink-0 text-minor text-text-tertiary">{source}</span>}
      {text ? (
        <IconButton label="Limpar" onClick={() => setText('')}>
          <X size={16} aria-hidden />
        </IconButton>
      ) : (
        <span aria-hidden className="flex shrink-0 gap-1 pr-1">
          <kbd className="rounded-thumb border border-border-strong px-1.5 font-sans text-caption leading-5 text-text-secondary">Ctrl</kbd>
          <kbd className="rounded-thumb border border-border-strong px-1.5 font-sans text-caption leading-5 text-text-secondary">V</kbd>
        </span>
      )}
    </div>
  );
}

/** Linha de aviso embaixo da barra (playlist pulada, link repetido, instalando o yt-dlp…). */
export function Banner({ notice, onDismiss }) {
  const tone = notice.tone || 'info';
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className="flex min-h-9 items-center gap-2 rounded-control border border-border-default bg-bg-card py-1.5 pl-3 pr-1 text-minor"
    >
      {tone === 'busy' && <Loader2 size={14} aria-hidden className="shrink-0 text-text-secondary motion-ok:animate-spin" />}
      {tone === 'danger' && <AlertCircle size={14} aria-hidden className="shrink-0 text-danger-fg" />}
      <span className={`min-w-0 flex-1 ${tone === 'danger' ? 'text-danger-fg' : 'text-text-secondary'}`}>{notice.text}</span>
      {(notice.actions || []).map((a) => (
        <Button key={a.label} variant="ghost" size="sm" onClick={a.run}>
          {a.label}
        </Button>
      ))}
      {onDismiss && (
        <IconButton size="sm" label="Dispensar aviso" onClick={onDismiss}>
          <X size={14} aria-hidden />
        </IconButton>
      )}
    </div>
  );
}

/** "Link copiado: … · Colar" (ao voltar para a janela com um link na área de transferência). */
export function ClipChip({ urls, onPaste }) {
  return (
    <div className="flex h-9 max-w-full items-center gap-2 rounded-control border border-border-default bg-bg-card pl-3 pr-1">
      <Clipboard size={14} aria-hidden className="shrink-0 text-text-tertiary" />
      <span className="shrink-0 text-minor text-text-secondary">{urls.length === 1 ? 'Link copiado:' : `${urls.length} links copiados:`}</span>
      <span className="min-w-0 truncate font-mono text-minor text-text-primary">{shortUrl(urls[0])}</span>
      <Button size="sm" onClick={onPaste}>
        Colar
      </Button>
    </div>
  );
}

/** Tamanho estimado no formato escolhido (o que o site informa, ou taxa × duração). */
function estimate({ format, bitrate, maxHeight, data }) {
  if (!data) return null;
  if (format === 'm4a') return data.sizes?.m4a ?? data.sizes?.opus ?? null;
  if (format === 'opus') return data.sizes?.opus ?? data.sizes?.m4a ?? null;
  if (format === 'mp3') return data.duration ? (data.duration * bitrate * 1000) / 8 : null;
  const hs = data.heights || [];
  const h = maxHeight ? hs.find((x) => x <= maxHeight) : hs[0];
  return h ? data.videoSizes?.[h] ?? null : null;
}

function formatHint({ format, bitrate, maxHeight, compat, data }) {
  const size = data && (data.count || 1) === 1 ? bytes(estimate({ format, bitrate, maxHeight, data })) : null;
  const base =
    format === 'm4a' ? 'AAC original, sem conversão'
    : format === 'opus' ? 'Opus original, sem conversão'
    : format === 'mp3' ? `MP3 ${bitrate} kbps (convertido)`
    : `MP4 ${maxHeight ? `até ${maxHeight}p` : data?.heights?.[0] ? `${data.heights[0]}p` : 'na melhor resolução'} com o melhor áudio${compat ? ', em H.264' : ''}`;
  return size ? `${base} · ~${size}` : base;
}

/** Pílulas de formato + menu de resolução do vídeo. */
function FormatPicker({ format, setFormat, maxHeight, setMaxHeight, heights, videoSizes }) {
  const video = format === 'video';
  const list = heights?.length ? heights.filter((h) => h <= 4320) : VIDEO_CAPS;
  const exact = Boolean(heights?.length);
  return (
    <PillGroup label="Formato" options={AUDIO} value={video ? null : format} onChange={setFormat}>
      <Menu
        label="Resolução do vídeo"
        align="start"
        width={200}
        items={[
          { heading: 'Vídeo (MP4)' },
          {
            label: 'Melhor',
            hint: exact ? `${list[0]}p` : undefined,
            checked: video && !maxHeight,
            onSelect: () => {
              setFormat('video');
              setMaxHeight(null);
            },
          },
          ...list.slice(exact ? 1 : 0).map((h) => ({
            label: exact ? `${h}p` : `Até ${h}p`,
            hint: exact && videoSizes?.[h] ? bytes(videoSizes[h]) : undefined,
            checked: video && maxHeight === h,
            onSelect: () => {
              setFormat('video');
              setMaxHeight(h);
            },
          })),
        ]}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            className={
              'inline-flex h-8 items-center gap-1 rounded-control border pl-3 pr-2 text-body motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
              (video
                ? 'border-border-strong bg-bg-elevated font-medium text-text-primary'
                : 'border-transparent text-text-secondary hover:bg-wash-hover hover:text-text-primary')
            }
          >
            {video && maxHeight ? `Vídeo ${maxHeight}p` : 'Vídeo'}
            <ChevronDown size={14} aria-hidden />
          </button>
        )}
      />
    </PillGroup>
  );
}

function CardFooter({ hint, hintTone, folderLabel, folderPath, onChooseFolder, action, disabled, extra }) {
  return (
    <div className="flex items-center gap-2 border-t border-border-subtle pt-4">
      <p className={`min-w-0 flex-1 truncate text-minor ${hintTone === 'danger' ? 'text-danger-fg' : 'text-text-tertiary'}`}>
        {hint}
        {extra}
      </p>
      <span className="shrink-0 text-minor text-text-tertiary">Salvar em</span>
      <FolderButton label={folderLabel} path={folderPath} onClick={onChooseFolder} />
      <Button type="submit" variant="primary" disabled={disabled}>
        <Download size={16} aria-hidden />
        {action}
      </Button>
    </div>
  );
}

function FolderButton({ label, path, onClick }) {
  return (
    <Button variant="ghost" onClick={onClick} aria-label={`Salvar em ${path || label}. Trocar a pasta`}>
      <FolderOpen size={14} aria-hidden className="text-text-secondary" />
      <span className="max-w-32 truncate font-normal">{label}</span>
    </Button>
  );
}

/** Prévia de um link. kind: video | ambiguous | playlist | file. */
export function PreviewCard({
  url, kind, preview, already, pending, playlistChoice, setPlaylistChoice,
  format, setFormat, maxHeight, setMaxHeight, bitrate, compat,
  folder, fileFolder, onChooseFolder, onSubmit, disabled,
}) {
  const loading = preview?.state === 'loading';
  const late = useDelayed(loading);
  const data = preview?.state === 'ok' ? preview.data : null;
  const failed = preview?.state === 'error';
  const file = kind === 'file';
  const playlist = kind === 'playlist' || (kind === 'ambiguous' && playlistChoice === 'playlist');

  const title = data?.title || data?.name || (late ? null : shortUrl(url));
  const meta = file
    ? [data?.host, bytes(data?.size)].filter(Boolean).join(' · ')
    : kind === 'playlist'
      ? ['Playlist', data?.count ? `${data.count} ${data.count === 1 ? 'vídeo' : 'vídeos'}` : null, data?.uploader].filter(Boolean).join(' · ')
      : [data?.uploader, data?.site, data?.count > 1 ? `${data.count} itens` : null].filter(Boolean).join(' · ');

  let hint;
  let hintTone;
  if (failed) {
    hint = `${preview.error || 'Não deu para ler este link.'} Dá para tentar baixar assim mesmo.`;
    hintTone = 'danger';
  } else if (file) {
    hint = !data ? 'Arquivo direto: vai pelo acelerador' : data.ranges ? 'Baixa em até 8 conexões' : 'O servidor não aceita pedaços: baixa numa conexão';
  } else if (already) {
    hint = `Já baixado ${dayLabel(already.at).toLowerCase() === 'hoje' ? 'hoje' : dayLabel(already.at) === 'Ontem' ? 'ontem' : `em ${dayLabel(already.at)}`}, às ${timeLabel(already.at)}`;
  } else if (playlist) {
    hint = 'Numerados, numa pasta com o nome da playlist';
  } else {
    hint = formatHint({ format, bitrate, maxHeight, compat, data });
  }

  const count = kind === 'playlist' ? data?.count : null;
  const action = pending
    ? 'Já está na fila'
    : already && !playlist
      ? 'Baixar de novo'
      : playlist
        ? count
          ? `Baixar ${count}`
          : 'Baixar a playlist'
        : 'Baixar';

  return (
    <form
      aria-label="Prévia do link"
      className="flex flex-col gap-4 rounded-card border border-border-default bg-bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex min-w-0 gap-4">
        <div className="relative shrink-0">
          {loading && late ? (
            <span aria-hidden className="block h-20 w-36 rounded-control bg-bg-elevated motion-ok:animate-pulse" />
          ) : (
            <Thumb large src={data?.thumbnail} kind={file ? 'file' : kind === 'playlist' ? 'playlist' : format === 'video' ? 'video' : 'audio'} name={data?.name || url} />
          )}
          {data?.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-thumb bg-bg-base px-1.5 text-caption text-text-primary tabular-nums">{duration(data.duration)}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {title ? (
            <p className={`truncate font-semibold ${file ? 'font-mono text-body' : 'font-display text-subtitle'}`}>{title}</p>
          ) : (
            <span aria-hidden className="mt-0.5 block h-4 w-3/4 rounded-thumb bg-bg-elevated motion-ok:animate-pulse" />
          )}
          <p className="mt-1 truncate text-minor text-text-secondary">
            {meta || (loading ? (late ? 'Lendo o link…' : ' ') : failed ? shortUrl(url) : ' ')}
          </p>
          {!file && (
            <div className="mt-auto pt-3">
              <FormatPicker
                format={format}
                setFormat={setFormat}
                maxHeight={maxHeight}
                setMaxHeight={setMaxHeight}
                heights={data?.heights}
                videoSizes={data?.videoSizes}
              />
            </div>
          )}
        </div>
      </div>

      {kind === 'ambiguous' && (
        <div className="flex items-center gap-3">
          <span className="text-minor text-text-secondary">Este vídeo é de uma playlist.</span>
          <SegmentedControl
            size="sm"
            label="O que baixar"
            options={[
              { value: 'video', label: 'Só o vídeo' },
              { value: 'playlist', label: 'A playlist inteira' },
            ]}
            value={playlistChoice}
            onChange={setPlaylistChoice}
          />
        </div>
      )}

      <CardFooter
        hint={hint}
        hintTone={hintTone}
        folderLabel={folderName(file ? fileFolder : folder)}
        folderPath={file ? fileFolder : folder}
        onChooseFolder={() => onChooseFolder(file ? 'file' : format === 'video' ? 'video' : 'audio')}
        action={action}
        disabled={disabled || pending}
      />
    </form>
  );
}

/** Vários links: a lista curta, os já baixados de fora (com "Incluir") e um formato para os vídeos. */
export function BatchCard({ rows, onToggle, format, setFormat, maxHeight, setMaxHeight, folder, fileFolder, onChooseFolder, onSubmit, disabled }) {
  const take = rows.filter((r) => !r.pending && (!r.already || r.included));
  const counts = {};
  for (const r of rows) counts[r.badge] = (counts[r.badge] || 0) + 1;
  const summary = Object.entries(counts)
    .map(([badge, n]) => (badge === 'Arquivo' ? `${n} ${n === 1 ? 'arquivo' : 'arquivos'}` : badge === 'Playlist' ? `${n} ${n === 1 ? 'playlist' : 'playlists'}` : `${n} do ${badge}`))
    .join(' · ');
  const onlyFiles = rows.every((r) => r.kind === 'file');
  const out = rows.filter((r) => r.already && !r.included).length + rows.filter((r) => r.pending).length;
  const notes = [
    rows.some((r) => r.kind === 'file') && !onlyFiles ? `${rows.filter((r) => r.kind === 'file').length === 1 ? 'O arquivo vai' : 'Os arquivos vão'} para ${folderName(fileFolder)}` : null,
    out ? `${out} ${out === 1 ? 'fica' : 'ficam'} de fora` : null,
  ].filter(Boolean);

  return (
    <form
      aria-label="Links colados"
      className="flex flex-col gap-3 rounded-card border border-border-default bg-bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-baseline gap-3">
        <p className="font-display text-subtitle font-semibold">{rows.length} links</p>
        <p className="min-w-0 truncate text-minor text-text-secondary">{summary}</p>
      </div>
      <ul className="flex max-h-56 flex-col overflow-y-auto border-y border-border-subtle">
        {rows.map((r) => (
          <li key={r.url} className="flex h-9 shrink-0 items-center gap-3 border-t border-border-subtle first:border-t-0">
            <span className="w-18 shrink-0 truncate rounded-thumb bg-bg-elevated px-1.5 text-center text-caption leading-5 text-text-secondary">{r.badge}</span>
            <span className={`min-w-0 flex-1 truncate ${r.title ? '' : 'font-mono text-minor'} ${r.already && !r.included ? 'text-text-tertiary' : ''}`}>
              {r.title || shortUrl(r.url)}
            </span>
            {r.pending ? (
              <span className="shrink-0 text-minor text-text-tertiary">Já na fila</span>
            ) : r.already ? (
              <>
                <span className="inline-flex shrink-0 items-center gap-1 text-minor text-success-fg">
                  <Check size={12} aria-hidden />
                  Já baixado
                </span>
                <LinkButton className="text-minor" onClick={() => onToggle(r.url)}>
                  {r.included ? 'Deixar de fora' : 'Incluir'}
                </LinkButton>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {!onlyFiles && (
        <div className="flex items-center gap-3">
          <span className="text-minor text-text-secondary">Vídeos em</span>
          <FormatPicker format={format} setFormat={setFormat} maxHeight={maxHeight} setMaxHeight={setMaxHeight} />
        </div>
      )}
      <CardFooter
        hint={notes.join(' · ') || (onlyFiles ? 'Vão pelo acelerador, em até 8 conexões' : formatHint({ format, bitrate: 256, maxHeight, compat: false, data: null }))}
        folderLabel={folderName(onlyFiles ? fileFolder : folder)}
        folderPath={onlyFiles ? fileFolder : folder}
        onChooseFolder={() => onChooseFolder(onlyFiles ? 'file' : format === 'video' ? 'video' : 'audio')}
        action={take.length ? `Baixar ${take.length}` : 'Baixar'}
        disabled={disabled || !take.length}
      />
    </form>
  );
}
