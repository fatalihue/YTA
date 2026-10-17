import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded text-body font-medium select-none ' +
  'motion-ok:transition-[transform,background-color] motion-ok:duration-(--motion-fast) ' +
  'motion-ok:active:enabled:scale-[0.98] disabled:cursor-default';

const buttonVariants = {
  primary:
    'bg-accent-solid text-accent-ink hover:enabled:bg-accent-solid-hover disabled:bg-bg-elevated disabled:text-text-disabled',
  secondary:
    'bg-bg-card text-text-primary border border-border-default hover:enabled:bg-bg-elevated hover:enabled:border-border-strong disabled:text-text-disabled',
  ghost: 'text-text-secondary hover:enabled:bg-wash-hover hover:enabled:text-text-primary disabled:text-text-disabled',
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]} ${className}`} {...props} />;
}

/** Botão só de ícone: aria-label sempre, e o mesmo texto como tooltip no hover/foco. */
export function IconButton({ label, children, className = '', ...props }) {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = () => {
    const r = ref.current.getBoundingClientRect();
    // Perto da borda direita, alinha pela direita para não sair da janela.
    const nearRight = r.right > window.innerWidth - 96;
    setTip({ x: r.left + r.width / 2, right: nearRight ? window.innerWidth - r.right : null, y: r.top - 6 });
  };
  const hide = () => setTip(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={(e) => e.target.matches(':focus-visible') && show()}
        onBlur={hide}
        onClickCapture={hide}
        className={
          'inline-flex size-7 shrink-0 items-center justify-center rounded text-text-icon ' +
          'hover:enabled:bg-wash-hover hover:enabled:text-text-primary disabled:text-text-disabled ' +
          'motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
          className
        }
        {...props}
      >
        {children}
      </button>
      {tip &&
        createPortal(
          <div
            role="presentation"
            className={`tooltip-surface fixed z-tooltip -translate-y-full ${tip.right === null ? '-translate-x-1/2' : ''}`}
            style={tip.right === null ? { left: tip.x, top: tip.y } : { right: tip.right, top: tip.y }}
          >
            {label}
          </div>,
          document.body,
        )}
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
          <p id={hintId} className="text-caption font-small text-text-tertiary">
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
    <p id={id} role={message ? 'alert' : undefined} className="min-h-4 text-caption font-small text-danger-fg">
      {message}
    </p>
  );
}

/** Escolha única entre 2–5 opções, com setas do teclado (uma parada de Tab). */
export function SegmentedControl({ options, value, onChange, labelId, disabled }) {
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
      className="flex h-8 p-0.5 gap-0.5 rounded bg-bg-input border border-border-default"
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
              'flex-1 rounded-sm text-body tabular-nums disabled:cursor-default ' +
              'motion-ok:transition-colors motion-ok:duration-(--motion-fast) ' +
              (selected
                ? 'bg-bg-elevated text-text-primary font-medium shadow-[inset_0_0_0_1px_var(--color-border-strong)]'
                : 'text-text-secondary hover:enabled:bg-wash-hover hover:enabled:text-text-primary')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
