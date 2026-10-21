import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DownloadDialog from './DownloadDialog.jsx';
import './index.css';

// Tema e portão de movimento seguem o Windows (diretriz §4 e §9).
const root = document.documentElement;
const dark = matchMedia('(prefers-color-scheme: dark)');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const sync = () => {
  root.dataset.theme = dark.matches ? 'dark' : 'light';
  root.dataset.animations = String(!reduce.matches);
};
sync();
dark.addEventListener('change', sync);
reduce.addEventListener('change', sync);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Janelas do acelerador (#ask, #progress) usam a mesma página; a principal não tem hash. */}
    {location.hash === '#ask' || location.hash === '#progress' ? <DownloadDialog kind={location.hash.slice(1)} /> : <App />}
  </StrictMode>,
);
