import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
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
    <App />
  </StrictMode>,
);
