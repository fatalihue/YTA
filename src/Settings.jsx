import { useEffect, useId, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button, IconButton, SegmentedControl, Switch } from './ui.jsx';

const api = window.yta;

const MP3_QUALITIES = [
  { value: 128, label: '128' },
  { value: 192, label: '192' },
  { value: 256, label: '256' },
  { value: 320, label: '320' },
];

/*
 * Ajustes (2.0): painel por cima da lista, à direita. Junta o que antes ficava espalhado pela tela
 * (pasta, login, extensão, qualidade do MP3) e o que só existia na bandeja ou no popup da extensão
 * (as chaves dos downloads do navegador, iniciar com o Windows). Esc fecha; o foco fica no painel.
 */
export function Settings({
  onClose, prefs, setPrefs, folderAudio, folderVideo, onChooseFolder, bitrate, setBitrate, compat, setCompat,
  login, loggedIn, onLogin, onLogout, update, busy,
}) {
  const panelRef = useRef(null);
  // O foco vai para o PAINEL (não para o X): sem anel nem dica piscando ao abrir; o Tab segue dali.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    // Foco preso no painel (diretriz §2: diálogo).
    const all = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
    const first = all[0];
    const last = all.at(-1);
    if (document.activeElement === panelRef.current) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const sites = login.sites || {};
  const busyLogin = login.state === 'waiting' || login.state === 'checking';
  return (
    <div className="absolute inset-x-0 bottom-0 top-titlebar z-modal">
      <div aria-hidden className="absolute inset-0 bg-scrim-strong" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajustes-titulo"
        tabIndex={-1}
        data-focus-anchor
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 right-0 flex w-98 max-w-full flex-col border-l border-border-default bg-bg-surface shadow-dialog"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 pl-6 pr-3">
          <h2 id="ajustes-titulo" className="flex-1 font-display text-subtitle font-semibold">
            Ajustes
          </h2>
          <IconButton label="Fechar ajustes" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4" data-focus-inset>
          <Section title="Pastas">
            <FolderRow label="Áudio" path={folderAudio} onChange={() => onChooseFolder('audio')} />
            <FolderRow label="Vídeo" path={folderVideo} onChange={() => onChooseFolder('video')} />
            <FolderRow label="Arquivos" path={prefs?.fileFolder} onChange={() => onChooseFolder('file')} />
          </Section>

          <Section title="Formato">
            <Row label="MP3">
              <SegmentedControl size="sm" label="Qualidade do MP3, em kbps" options={MP3_QUALITIES} value={bitrate} onChange={setBitrate} />
              <span className="text-minor text-text-tertiary">kbps</span>
            </Row>
            <SwitchRow
              label="Converter vídeo para H.264 se preciso"
              hint="Para o WhatsApp; o que já é H.264 não muda"
              checked={compat}
              onChange={setCompat}
            />
          </Section>

          <Section title="Contas">
            <StatusRow label="YouTube" on={Boolean(loggedIn && sites.youtube)} onText="Conectado" offText="Não conectado" />
            <StatusRow label="Instagram" on={Boolean(loggedIn && sites.instagram)} onText="Conectado" offText="Não conectado" />
            {busyLogin ? (
              <p className="flex min-h-9 items-center gap-1.5 text-minor text-text-secondary" aria-live="polite">
                <Loader2 size={12} aria-hidden className="shrink-0 motion-ok:animate-spin" />
                {login.state === 'waiting'
                  ? `Entre nas contas na janela do ${login.browser || 'navegador'} e feche-a ao terminar.`
                  : 'Verificando o login…'}
              </p>
            ) : (
              <div className="flex min-h-9 items-center gap-1">
                <Button variant="ghost" size="sm" className="-ml-2.5" onClick={onLogin}>
                  {loggedIn ? 'Entrar em outro site…' : 'Entrar em sites…'}
                </Button>
                {loggedIn && (
                  <Button variant="quiet" size="sm" onClick={onLogout}>
                    Sair de todos
                  </Button>
                )}
              </div>
            )}
            {login.error && (
              <p className="text-minor text-danger-fg" role="alert">
                {login.error}
              </p>
            )}
          </Section>

          <Section title="Navegador">
            <StatusRow
              label="Extensão"
              on={Boolean(prefs?.extension?.connected)}
              onText="Conectada"
              offText="Não conectada"
              action={
                <Button variant="ghost" size="sm" onClick={() => api.extensionHelp()}>
                  {prefs?.extension?.connected ? 'Instruções…' : 'Conectar…'}
                </Button>
              }
            />
            <SwitchRow
              label="Acelerar downloads"
              hint="Arquivos de 1 MB ou mais, em até 8 conexões"
              checked={prefs?.capture ?? true}
              onChange={(v) => setPrefs({ capture: v })}
            />
            <SwitchRow label="Perguntar onde salvar" checked={prefs?.askSave ?? true} onChange={(v) => setPrefs({ askSave: v })} />
            <SwitchRow label="Mostrar janela de andamento" checked={prefs?.showProgress ?? true} onChange={(v) => setPrefs({ showProgress: v })} />
          </Section>

          <Section title="Sistema">
            <SwitchRow
              label="Iniciar com o Windows"
              hint={prefs?.autostart?.available ? 'Abre na bandeja, para a extensão sempre achar o YTA' : 'Só no app instalado'}
              checked={Boolean(prefs?.autostart?.on)}
              disabled={!prefs?.autostart?.available}
              onChange={(v) => setPrefs({ autostart: v })}
            />
            <div className="flex min-h-9 items-center gap-2 text-minor text-text-tertiary">
              <span className="tabular-nums">Versão {prefs?.version}</span>
              <span aria-hidden>·</span>
              {update.state === 'ready' && busy ? (
                <span>versão {update.version} pronta · instala ao fechar</span>
              ) : update.state === 'ready' ? (
                <>
                  <span>versão {update.version} pronta</span>
                  <Button variant="ghost" size="sm" onClick={() => api.installUpdate()}>
                    Reiniciar e atualizar
                  </Button>
                </>
              ) : update.state === 'downloading' ? (
                <span className="tabular-nums">baixando a versão {update.version}… {Math.floor(update.percent || 0)}%</span>
              ) : (
                <span>atualiza sozinho</span>
              )}
            </div>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col">
      <h3 className="label-micro mb-1 text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <span className="w-16 shrink-0 text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function FolderRow({ label, path, onChange }) {
  return (
    <Row label={label}>
      <span className="min-w-0 flex-1 truncate font-mono text-minor" dir="rtl">
        {/* rtl: caminho longo mostra o fim (a pasta), não o começo (C:\Users\…) */}
        <bdi>{path || '—'}</bdi>
      </span>
      <Button variant="ghost" size="sm" aria-label={`Alterar a pasta de ${label.toLowerCase()}`} onClick={onChange}>
        Alterar…
      </Button>
    </Row>
  );
}

function StatusRow({ label, on, onText, offText, action }) {
  return (
    <Row label={label}>
      <span className="inline-flex flex-1 items-center gap-1.5">
        <span aria-hidden className={`size-1.5 rounded-full ${on ? 'bg-success-fg' : 'bg-text-tertiary'}`} />
        <span className={on ? 'text-text-primary' : 'text-text-secondary'}>{on ? onText : offText}</span>
      </span>
      {action}
    </Row>
  );
}

function SwitchRow({ label, hint, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 ${hint ? 'min-h-11 py-1' : 'min-h-9'}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={id} className={disabled ? 'text-text-disabled' : undefined}>
          {label}
        </span>
        {hint && <span className="text-minor text-text-tertiary">{hint}</span>}
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={id} disabled={disabled} />
    </div>
  );
}
