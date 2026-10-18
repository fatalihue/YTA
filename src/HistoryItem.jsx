import { memo } from 'react';
import { CheckCircle2, CircleOff, FolderOpen, RotateCw, Trash2 } from 'lucide-react';
import { IconButton } from './ui.jsx';

const when = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const FORMAT_LABEL = { m4a: 'M4A', opus: 'Opus', mp3: 'MP3', video: 'Vídeo' };

/** Um download já feito: abrir a pasta, baixar de novo ou tirar do histórico. */
function HistoryItemView({ entry, onReveal, onAgain, onRemove }) {
  const files = entry.files || [];
  const name = files.length > 1 ? `${files.length} arquivos` : (files[0] || '').split(/[\\/]/).pop();
  return (
    <li className="flex min-w-0 gap-3 rounded px-3 py-2 hover:bg-wash-hover">
      {entry.exists ? (
        <CheckCircle2 size={16} aria-hidden className="mt-px shrink-0 text-success-fg" />
      ) : (
        <CircleOff size={16} aria-hidden className="mt-px shrink-0 text-text-tertiary" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={`truncate text-body ${entry.title ? 'text-text-primary' : 'font-mono text-text-secondary'}`}>
          {entry.title || entry.url}
        </p>
        <p className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap text-minor text-text-secondary">
          <span>{FORMAT_LABEL[entry.format] || entry.format}</span>
          <span aria-hidden className="text-text-tertiary">·</span>
          <span className="tabular-nums">{when.format(entry.at)}</span>
          <span aria-hidden className="text-text-tertiary">·</span>
          {entry.exists ? (
            <span className={`min-w-0 truncate ${files.length > 1 ? '' : 'font-mono'}`}>{name}</span>
          ) : (
            <span className="min-w-0 truncate text-text-tertiary">o arquivo não está mais na pasta</span>
          )}
        </p>
      </div>
      <div className="-my-0.5 flex shrink-0 items-start gap-0.5">
        <IconButton label={entry.exists ? 'Mostrar na pasta' : 'Arquivo não encontrado'} disabled={!entry.exists} onClick={onReveal}>
          <FolderOpen size={16} aria-hidden />
        </IconButton>
        <IconButton label="Baixar de novo" onClick={onAgain}>
          <RotateCw size={16} aria-hidden />
        </IconButton>
        <IconButton label="Tirar do histórico" onClick={onRemove}>
          <Trash2 size={16} aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}

// Callbacks recriados a cada render, mas só dependem da própria entrada (ver QueueItem).
export const HistoryItem = memo(HistoryItemView, (a, b) => a.entry === b.entry);
