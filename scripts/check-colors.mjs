// Gate da diretriz §1: cor literal só no arquivo de tokens (src/index.css).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|bg-black\/|bg-white\//;
const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?|css)$/.test(name) && p !== join('src', 'index.css')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (LITERAL.test(line)) hits.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
})('src');
if (hits.length) {
  console.error('Cor literal fora dos tokens:\n' + hits.join('\n'));
  process.exit(1);
}
