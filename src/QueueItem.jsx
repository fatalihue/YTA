import { AlertCircle, CheckCircle2, CircleSlash, Clock, FolderOpen, Loader2, RotateCw, Trash2, X } from 'lucide-react';
import { Button, IconButton } from './ui.jsx';

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function bytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024 * 1024) return `${integer.format(n / 1024)} KB`;
  return `${decimal.format(n / 1024 / 1024)} MB`;
}

function duration(s) {
  if (s === null || s === undefined) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const PHASE = {
  queued: { icon: Clock, text: 'Na fila', tone: 'text-text-tertiary' },
  preparing: { icon: Loader2, text: 'Buscando o vídeo…', tone: 'text-text-tertiary', spin: true },
  download: { icon: Loader2, text: 'Baixando', tone: 'text-accent', spin: true },
  convert: { icon: Loader2, text: 'Convertendo', tone: 'text-accent', spin: true },
  done: { icon: CheckCircle2, text: 'Salvo', tone: 'text-success-fg' },
  error: { icon: AlertCircle, text: 'Falhou', tone: 'text-danger-fg' },
  cancelled: { icon: CircleSlash, text: 'Cancelado', tone: 'text-text-tertiary' },
};

/** Partes da linha de detalhe; cada uma com números tabulares. */
function details(item) {
  const p = item.progress || {};
  if (item.phase === 'download') {
    const parts = [];
    if (p.percent !== null && p.percent !== undefined) parts.push(`${Math.floor(p.percent)}%`);
    if (p.done !== null && p.done !== undefined) parts.push(p.size ? `${bytes(p.done)} de ${bytes(p.size)}` : bytes(p.done));
    if (p.speed) parts.push(`${bytes(p.speed)}/s`);
    if (p.eta !== null && p.eta !== undefined && p.percent < 100) parts.push(`${duration(p.eta)} restante`);
    return parts;
  }
  if (item.phase === 'convert') {
    const parts = [];
    if (p.percent !== null && p.percent !== undefined) parts.push(`${Math.floor(p.percent)}%`);
    // Na cópia sem conversão a velocidade (milhares de ×) não diz nada.
    if (p.speed && !p.copy) parts.push(`${decimal.format(p.speed)}× o tempo real`);
    if (p.eta !== null && p.eta !== undefined && p.percent < 100) parts.push(`${duration(Math.ceil(p.eta))} restante`);
    return parts;
  }
  return [];
}

export function QueueItem({ item, onCancel, onRetry, onRemove, onReveal, onLogin }) {
  const base = PHASE[item.phase];
  // Formato original só troca a embalagem; MP3 (ou fallback sem o codec) converte de fato.
  const phase =
    item.phase === 'preparing' && item.retry?.login
      ? { ...base, text: 'O YouTube pediu verificação; tentando com o login…' }
      : item.phase === 'preparing' && item.retry
      ? { ...base, text: `A conexão caiu, retomando (tentativa ${item.retry.attempt} de ${item.retry.max})…` }
      : item.phase === 'download' && item.progress?.part
      ? { ...base, text: item.progress.part === 'video' ? 'Baixando vídeo' : 'Baixando áudio' }
      : item.phase === 'convert'
      ? {
          ...base,
          text:
            item.format === 'video' ? (item.progress?.copy === false ? 'Convertendo para H.264' : 'Juntando vídeo e áudio')
            : item.progress?.copy ? 'Finalizando'
            : `Convertendo para ${item.format === 'opus' ? 'Opus' : item.format.toUpperCase()}`,
        }
      : base;
  const Icon = phase.icon;
  const active = ['preparing', 'download', 'convert'].includes(item.phase);
  const percent = item.progress?.percent;
  const many = item.phase === 'done' && item.files?.length > 1;
  const name = item.phase === 'done' && item.file ? (many ? `${item.files.length} arquivos` : item.file.split(/[\\/]/).pop()) : null;
  const parts = details(item);
  // Resolução que o vídeo realmente saiu (pode ser menor que o teto escolhido).
  if (item.format === 'video' && item.height && (item.phase === 'done' || item.progress?.part === 'video')) parts.unshift(`${item.height}p`);

  return (
    <li className="flex min-w-0 gap-3 rounded px-3 py-2 hover:bg-wash-hover">
      <Icon
        size={16}
        aria-hidden
        className={`mt-px shrink-0 ${phase.tone} ${phase.spin ? 'animate-spin' : ''}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={`truncate text-body ${item.title ? 'text-text-primary' : 'font-mono text-text-secondary'}`}>
          {item.title || item.url}
        </p>

        {(item.phase === 'download' || item.phase === 'convert') && (
          <div
            role="progressbar"
            aria-label={phase.text}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent === null || percent === undefined ? undefined : Math.floor(percent)}
            className="h-1 overflow-hidden rounded-full bg-bg-elevated"
          >
            <div
              className="h-full origin-left bg-accent-solid motion-ok:transition-transform motion-ok:duration-(--motion-base)"
              style={{ transform: `scaleX(${(percent ?? 0) / 100})` }}
            />
          </div>
        )}

        <p className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap text-minor text-text-secondary">
          <span className={item.phase === 'error' ? 'text-danger-fg' : undefined}>
            {phase.text}
          </span>
          {parts.map((part, i) => (
            <span key={i} className="tabular-nums">
              <span aria-hidden className="text-text-tertiary">
                ·{' '}
              </span>
              {part}
            </span>
          ))}
          {name && (
            <span className="min-w-0 truncate">
              <span aria-hidden className="text-text-tertiary">
                ·{' '}
              </span>
              <span className={many ? undefined : 'font-mono'}>{name}</span>
            </span>
          )}
        </p>
        {item.phase === 'error' && (
          <p className="flex min-w-0 items-center gap-2 text-minor text-text-secondary">
            <span className="min-w-0">{item.error}</span>
            {item.needsLogin && (
              <Button variant="ghost" className="-my-1.5 h-7 shrink-0 px-2" onClick={onLogin}>
                Entrar e tentar de novo
              </Button>
            )}
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {item.phase === 'done' || item.phase === 'error' || item.phase === 'cancelled'
            ? `${phase.text}: ${item.title || item.url}`
            : ''}
        </span>
      </div>

      <div className="-my-0.5 flex shrink-0 items-start gap-0.5">
        {item.phase === 'done' && (
          <IconButton label="Mostrar na pasta" onClick={onReveal}>
            <FolderOpen size={16} aria-hidden />
          </IconButton>
        )}
        {(item.phase === 'error' || item.phase === 'cancelled') && (
          <>
            <IconButton label="Tentar de novo" onClick={onRetry}>
              <RotateCw size={16} aria-hidden />
            </IconButton>
            <IconButton label="Tirar da fila" onClick={onRemove}>
              <Trash2 size={16} aria-hidden />
            </IconButton>
          </>
        )}
        {item.phase === 'queued' && (
          <IconButton label="Tirar da fila" onClick={onCancel}>
            <X size={16} aria-hidden />
          </IconButton>
        )}
        {active && (
          <IconButton label="Cancelar" onClick={onCancel}>
            <X size={16} aria-hidden />
          </IconButton>
        )}
      </div>
    </li>
  );
}
