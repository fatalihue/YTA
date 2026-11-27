import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium select-none whitespace-nowrap ' +
  'motion-ok:transition-[transform,background-color] motion-ok:duration-(--motion-fast) ' +
  'motion-ok:active:enabled:scale-[0.98] disabled:cursor-default';

const buttonSizes = {
  md: 'h-8 px-3 text-body',
  sm: 'h-7 px-2.5 text-minor',
  // Dentro de uma linha de texto de 16 px (ex.: "Retomar" na linha de um item); o call site
  // acrescenta -my-1 para não aumentar a linha.
  xs: 'h-6 px-1.5 text-minor',
};

const buttonVariants = {
  // A ação principal é a TINTA (branco no escuro, quase preto no claro); o azul fica para o progresso.
  primary: 'bg-ink text-ink-fg hover:enabled:bg-ink-hover disabled:bg-bg-elevated disabled:text-text-disabled',
  secondary:
    'bg-bg-elevated text-text-primary border border-border-default hover:enabled:border-border-strong disabled:text-text-disabled',
  ghost: 'text-text-primary hover:enabled:bg-wash-hover disabled:text-text-disabled',
  quiet: 'text-text-secondary hover:enabled:bg-wash-hover hover:enabled:text-text-primary disabled:text-text-disabled',
  // Ação destrutiva em texto (ex.: confirmar uma limpeza): o vermelho só no rótulo.
  destructiveText: 'text-danger-fg hover:enabled:bg-wash-hover disabled:text-text-disabled',
};

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }) {
  return <button type={type} className={`${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`} {...props} />;
}

/** Dica flutuante (portal): para botões só de ícone e textos cortados. Nunca `title=`. */
function useTooltip(label) {
  const [tip, setTip] = useState(null);
  const show = (el) => {
    if (!label || !el) return;
    const r = el.getBoundingClientRect();
    // Perto da borda direita, alinha pela direita para não sair da janela.
    const nearRight = r.right > window.innerWidth - 120;
    // Sem espaço em cima (a barra de título tem 44 px e os botões do Windows desenham por cima
    // dela; a dica tem ~24): embaixo.
    const below = r.top < 80;
    setTip({ x: r.left + r.width / 2, right: nearRight ? window.innerWidth - r.right : null, y: below ? r.bottom + 6 : r.top - 6, below });
  };
  const hide = () => setTip(null);
  const node =
    tip &&
    createPortal(
      <div
        role="presentation"
        className={`tooltip-surface fixed z-tooltip ${tip.below ? '' : '-translate-y-full'} ${tip.right === null ? '-translate-x-1/2' : ''}`}
        style={tip.right === null ? { left: tip.x, top: tip.y } : { right: tip.right, top: tip.y }}
      >
        {label}
      </div>,
      document.body,
    );
  return { show, hide, node };
}

/** Botão só de ícone: aria-label sempre, e o mesmo texto como tooltip no hover/foco. */
export function IconButton({ label, children, size = 'md', className = '', ref: outerRef, ...props }) {
  const ref = useRef(null);
  const tip = useTooltip(label);
  // A ref de fora (menu, devolver o foco) e a nossa (posição da dica) apontam para o mesmo botão.
  const setRef = (el) => {
    ref.current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef) outerRef.current = el;
  };
  return (
    <>
      <button
        ref={setRef}
        type="button"
        aria-label={label}
        onMouseEnter={() => tip.show(ref.current)}
        onMouseLeave={tip.hide}
        onFocus={(e) => e.target.matches(':focus-visible') && tip.show(ref.current)}
        onBlur={tip.hide}
        onClickCapture={tip.hide}
        className={
          `inline-flex ${size === 'sm' ? 'size-7' : 'size-8'} shrink-0 items-center justify-center rounded-control text-text-icon ` +
          'hover:enabled:bg-wash-hover hover:enabled:text-text-primary disabled:text-text-disabled ' +
          'motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
          className
        }
        {...props}
      >
        {children}
      </button>
      {tip.node}
    </>
  );
}

/** Rótulo ligado ao controle; `children` recebe o id a usar no controle. */
export function Field({ label, hint, error, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // A linha de erro só existe nos campos que validam. Com dica, o erro ocupa o lugar dela
  // (mesma linha, sem salto de layout); sem dica, a linha fica reservada.
  const validates = error !== undefined;
  const showError = validates && (Boolean(error) || !hint);
  const describedBy = (showError ? errorId : hint ? hintId : '') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} id={`${id}-label`} className="text-minor font-medium text-text-secondary">
        {label}
      </label>
      {children({ id, labelId: `${id}-label`, describedBy, invalid: Boolean(error) })}
      {showError ? (
        <FieldError id={errorId} message={error} />
      ) : (
        hint && (
          <p id={hintId} className="text-minor text-text-tertiary">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Sempre montado (sem salto de layout quando aparece). */
export function FieldError({ id, message }) {
  return (
    <p id={id} role={message ? 'alert' : undefined} className="min-h-4 text-minor text-danger-fg">
      {message}
    </p>
  );
}

/** Escolha única entre 2–5 opções, com setas do teclado (uma parada de Tab). */
export function SegmentedControl({ options, value, onChange, labelId, label, disabled, size = 'md' }) {
  const refs = useRef([]);
  const index = options.findIndex((o) => o.value === value);

  function onKeyDown(e) {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(last, index + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : label}
      className={`inline-flex ${size === 'sm' ? 'h-7' : 'h-8'} gap-0.5 rounded-control border border-border-default p-0.5`}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={
              `rounded-inner px-2.5 ${size === 'sm' ? 'text-minor' : 'text-body'} tabular-nums disabled:cursor-default ` +
              'motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
              (selected ? 'bg-bg-elevated font-medium text-text-primary' : 'text-text-secondary hover:enabled:text-text-primary')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pílulas de escolha (formato na prévia): radiogroup com setas. A marcada tem fundo e borda
 * (dois canais); as outras são só texto. `extra` entra depois da última (ex.: menu de resolução).
 */
export function PillGroup({ options, value, onChange, label, children }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  function onKeyDown(e) {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' ? Math.min(last, index + 1) : e.key === 'ArrowLeft' ? Math.max(0, index - 1) : null;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={selected}
            // Nenhuma escolhida (ex.: "Vídeo" no menu ao lado): a primeira recebe o Tab.
            tabIndex={selected || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={
              'h-8 rounded-control border px-3 text-body motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
              (selected
                ? 'border-border-strong bg-bg-elevated font-medium text-text-primary'
                : 'border-transparent text-text-secondary hover:bg-wash-hover hover:text-text-primary')
            }
          >
            {o.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** Interruptor liga/desliga: dois canais (preenchimento e posição da bolinha). */
export function Switch({ checked, onChange, label, labelledBy, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative h-5 w-8.5 shrink-0 rounded-full border disabled:opacity-50 ' +
        (checked ? 'border-ink bg-ink' : 'border-border-strong bg-transparent')
      }
    >
      <span
        aria-hidden
        className={
          'absolute left-0.5 top-0.5 size-3.5 rounded-full motion-ok:transition-transform motion-ok:duration-(--motion-base) ' +
          (checked ? 'translate-x-3.5 bg-ink-fg' : 'translate-x-0 bg-text-secondary')
        }
      />
    </button>
  );
}

/** Ação em forma de link dentro de uma linha de texto (não aumenta a altura da linha). */
export function LinkButton({ className = '', ...props }) {
  return (
    <button
      type="button"
      className={`shrink-0 rounded-sm font-medium text-text-primary underline-offset-2 hover:underline ${className}`}
      {...props}
    />
  );
}

/**
 * Menu que nasce do gatilho, num portal (não é cortado por listas roláveis). Abre por clique e
 * teclado; ↑/↓ andam, Enter escolhe, Esc fecha e devolve o foco ao gatilho.
 * items: [{ label, onSelect, checked, hint, disabled, danger } | { heading } | { separator }]
 * trigger(props): o botão — receba `props` (ref, aria e onClick).
 */
export function Menu({ trigger, items, align = 'end', width = 220, label }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - r.bottom;
    setPos({ left, top: r.bottom + 4, up: spaceBelow < 220 && r.top > spaceBelow, bottom: window.innerHeight - r.top + 4 });
  }, [open, align, width]);
  // O menu só existe depois que a posição foi medida (efeito de layout acima): focar ali, não na
  // primeira passada (na 1ª abertura de cada menu o foco ficava no gatilho e as setas não andavam).
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector('[role^="menuitem"]:not([disabled])')?.focus();
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) close(false);
    };
    const away = () => close(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, [open]);

  function onKeyDown(e) {
    const all = [...menuRef.current.querySelectorAll('[role^="menuitem"]:not([disabled])')];
    const at = all.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      all[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  return (
    <>
      {trigger({
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => setOpen((v) => !v),
      })}
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="menu-surface fixed z-dropdown flex flex-col p-1.5"
            style={{ left: pos.left, width, ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }) }}
          >
            {items.map((it, i) =>
              it.separator ? (
                <span key={i} role="separator" className="mx-1 my-1.5 h-px bg-border-subtle" />
              ) : it.heading ? (
                <span key={i} className="label-micro px-2.5 pb-1 pt-2 text-text-tertiary">
                  {it.heading}
                </span>
              ) : (
                <button
                  key={i}
                  type="button"
                  role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={it.checked === undefined ? undefined : it.checked}
                  disabled={it.disabled}
                  onClick={() => {
                    close();
                    it.onSelect?.();
                  }}
                  className={`menu-item ${it.danger ? 'text-danger-fg' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-minor text-text-tertiary tabular-nums">{it.hint}</span>}
                  {it.checked !== undefined && (
                    <Check size={14} aria-hidden className={`shrink-0 ${it.checked ? 'text-text-primary' : 'invisible'}`} />
                  )}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Marca do YTA: quadrado de tinta com a seta de baixar. */
export function Mark({ size = 22 }) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-ink text-ink-fg"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11" />
        <path d="m7 10 5 5 5-5" />
        <path d="M6 20h12" />
      </svg>
    </span>
  );
}
