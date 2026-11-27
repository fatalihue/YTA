// Textos e formatos compartilhados pela lista (App) e pelas janelas de download (DownloadDialog).

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export { decimal };

/** 1,2 GB · 48,6 MB · 820 KB; null quando não há número. */
export function bytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n < 1024 * 1024) return `${integer.format(Math.max(1, n / 1024))} KB`;
  if (n < 1024 ** 3) return `${decimal.format(n / 1024 / 1024)} MB`;
  return `${decimal.format(n / 1024 ** 3)} GB`;
}

/** 0:42 · 12:03 · 2:01:13 */
export function duration(s) {
  if (s === null || s === undefined || !Number.isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export const FORMAT_LABEL = { m4a: 'M4A', opus: 'Opus', mp3: 'MP3', video: 'Vídeo', file: 'Arquivo' };
export const ACTIVE = ['preparing', 'download', 'convert'];
export const PENDING = ['queued', 'listing', 'paused', ...ACTIVE];

/** O que está acontecendo com o item, em palavras (lista e janela de andamento usam as mesmas). */
export function phaseText(it) {
  const r = it.retry;
  if (it.pausing && ACTIVE.includes(it.phase)) return 'Pausando…';
  switch (it.phase) {
    case 'queued':
      return 'Na fila';
    case 'listing':
      return 'Lendo a playlist…';
    case 'preparing':
      if (it.kind === 'file') return 'Conectando…';
      if (r === 'browser' || r?.browser) return 'Buscando com o login do YTA…';
      if (r?.media) return 'Página não reconhecida; baixando o vídeo que ela tocava…';
      if (r?.login) return 'O site pediu login; tentando com a sua conta…';
      if (r?.attempt) return `A conexão caiu, retomando (tentativa ${r.attempt} de ${r.max})…`;
      if (r) return 'Tentando de novo…';
      return 'Buscando o vídeo…';
    case 'download': {
      const part = it.part ?? it.progress?.part;
      return part === 'video' ? 'Baixando vídeo' : part === 'audio' ? 'Baixando áudio' : 'Baixando';
    }
    case 'convert': {
      const copy = it.copy ?? it.progress?.copy;
      if (it.format === 'video') return copy === false ? 'Convertendo para H.264' : 'Juntando vídeo e áudio';
      return copy ? 'Finalizando' : `Convertendo para ${FORMAT_LABEL[it.format] || it.format}`;
    }
    case 'paused':
      return 'Pausado';
    case 'done':
      return 'Salvo';
    case 'error':
      return 'Falhou';
    case 'cancelled':
      return 'Cancelado';
    default:
      return '';
  }
}

/**
 * "Hoje", "Ontem" ou "12 de nov." (com o ano se for outro). A lista agrupa centenas de itens a cada
 * passo do andamento: o rótulo de cada dia é calculado uma vez (o cache vira com a data de hoje).
 */
const dayCache = new Map();
let cacheToday = 0;
const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
export function dayLabel(at) {
  const today = startOfDay(Date.now());
  if (today !== cacheToday) {
    dayCache.clear();
    cacheToday = today;
  }
  const day = startOfDay(at);
  let label = dayCache.get(day);
  if (label === undefined) {
    const diff = Math.round((today - day) / 86_400_000);
    const d = new Date(day);
    label =
      diff === 0 ? 'Hoje'
      : diff === 1 ? 'Ontem'
      : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date(today).getFullYear() ? {} : { year: 'numeric' }) });
    dayCache.set(day, label);
  }
  return label;
}
export const timeLabel = (at) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const shortUrl = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/, '');

/** "YouTube", "Instagram" ou o domínio ("github.com"). */
export function siteLabel(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'YouTube';
  if (/(^|\.)instagram\.com$/.test(host)) return 'Instagram';
  return host;
}

/** Miniatura do YouTube a partir do link (fixa; vale também para itens antigos do histórico). */
export function ytThumb(url) {
  const m = /(?:youtube\.com|youtu\.be)/i.test(url || '') && String(url).match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : null;
}

/** Caminho do Windows → endereço file:/// que a página consegue carregar. */
export function fileUrl(p) {
  if (!p) return null;
  return encodeURI(`file:///${String(p).replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

/** "ZIP", "EXE"… para a miniatura de um arquivo. */
export function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').replace(/[?#].*$/, ''));
  return m ? m[1].toUpperCase() : 'ARQ';
}

/* As pastas do Windows com nome em português (a pasta "Music" aparece como "Música" no Explorer). */
const places = new Map();
const placeKey = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
export function setPlaces({ music, videos, downloads } = {}) {
  if (music) places.set(placeKey(music), 'Música');
  if (videos) places.set(placeKey(videos), 'Vídeos');
  if (downloads) places.set(placeKey(downloads), 'Downloads');
}
/** Nome curto de uma pasta ("C:\Users\Admin\Music" → "Música"; outras: a última parte). */
export const folderName = (p) => places.get(placeKey(p)) || String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
