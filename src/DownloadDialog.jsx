import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOpen } from 'lucide-react';
import { Button, Field } from './ui.jsx';

/*
 * Janelas pequenas do acelerador (como as do IDM, sem o resto):
 * - "ask": o YTA assumiu um download do navegador — nome, pasta, lembrar a pasta, baixar/cancelar;
 * - "done": terminou — abrir o arquivo ou a pasta.
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

export default function DownloadDialog({ kind }) {
  const [data, setData] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    api.dialogData().then(setData);
  }, []);
  // A janela nasce escondida e só aparece com a altura certa.
  useLayoutEffect(() => {
    if (data && ref.current) api.dialogFit(ref.current.offsetHeight);
  });
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && api.dialogAnswer({ action: 'cancel' });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!data) return null;
  return (
    <div ref={ref} className="bg-bg-base">
      {kind === 'ask' ? <Ask data={data} /> : <Done data={data} />}
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

function Done({ data }) {
  const [dontShow, setDontShow] = useState(false);
  const openRef = useRef(null);
  useEffect(() => openRef.current?.focus(), []);
  const close = () => api.dialogAnswer({ action: 'close' });
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex min-w-0 gap-3">
        <CheckCircle2 size={20} aria-hidden className="mt-0.5 shrink-0 text-success-fg" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-mono text-body text-text-primary">{data.name}</p>
          <p className="truncate text-minor text-text-secondary">
            <span className="tabular-nums">{bytes(data.size)}</span>
            <span aria-hidden className="text-text-tertiary"> · </span>
            <span className="font-mono">{data.folder}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle pt-4">
        <Check
          checked={dontShow}
          onChange={(v) => {
            setDontShow(v); // vale na hora (fechar pelo X ou Esc também conta)
            api.setDownloadPrefs({ showDone: !v });
          }}
        >
          Não mostrar ao concluir
        </Check>
        <span className="flex-1" />
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
        <Button
          onClick={() => {
            api.reveal(data.file);
            close();
          }}
        >
          <FolderOpen size={16} aria-hidden />
          Abrir pasta
        </Button>
        <Button
          ref={openRef}
          variant="primary"
          onClick={() => {
            api.openFile(data.file);
            close();
          }}
        >
          Abrir
        </Button>
      </div>
    </div>
  );
}
