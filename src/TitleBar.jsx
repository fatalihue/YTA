import { forwardRef } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { Button, IconButton, Mark } from './ui.jsx';

const api = window.yta;

/**
 * Barra de título do app (a do Windows foi escondida: titleBarStyle "hidden"). A faixa arrasta a
 * janela; à direita ficam os 3 botões do Windows (titleBarOverlay), por isso o recuo pr-caption.
 * Aqui moram só a marca, o aviso de atualização e o botão de Ajustes.
 */
export const TitleBar = forwardRef(function TitleBar({ update, busy, onSettings, settingsOpen }, settingsRef) {
  return (
    <header className="drag-region flex h-titlebar shrink-0 items-center gap-2 pl-4 pr-caption">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Mark size={22} />
        <span className="text-body font-semibold">YTA</span>
      </div>
      <UpdateChip update={update} busy={busy} />
      <IconButton ref={settingsRef} label="Ajustes" className="no-drag" aria-expanded={settingsOpen} onClick={onSettings}>
        <SlidersHorizontal size={16} aria-hidden />
      </IconButton>
    </header>
  );
});

/** Atualização automática: baixa sozinha; pronta, oferece reiniciar (com downloads, instala ao fechar). */
function UpdateChip({ update, busy }) {
  if (update.state === 'downloading')
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-minor text-text-tertiary" aria-live="polite">
        <Loader2 size={12} className="shrink-0 motion-ok:animate-spin" aria-hidden />
        <span className="truncate tabular-nums">Atualizando… {Math.floor(update.percent || 0)}%</span>
      </span>
    );
  if (update.state !== 'ready') return null;
  if (busy)
    return (
      <span className="truncate text-minor text-text-secondary" aria-live="polite">
        Versão {update.version} pronta · instala ao fechar
      </span>
    );
  return (
    <Button size="sm" className="no-drag" onClick={() => api.installUpdate()}>
      Versão {update.version} pronta · Reiniciar
    </Button>
  );
}
