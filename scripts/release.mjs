// Publica uma versão: gera o instalador e cria a release no GitHub com o que o
// atualizador automático lê (latest.yml + instalador + blockmap).
//
// Uso:
//   npm version patch            (ou minor/major: sobe a versão, faz commit e cria a tag)
//   npm run release -- "- Novidade 1" "- Novidade 2"   (notas opcionais; sem elas, o GitHub gera)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Sem shell (argumentos com espaço chegam inteiros); só o npm, que é um .cmd no Windows, precisa dele.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: cmd === 'npm' && process.platform === 'win32' });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;

if (out('git', ['status', '--porcelain'])) fail('Há alterações sem commit. Faça o commit antes de publicar.');
if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('Publique a partir do branch main.');
try {
  out('gh', ['release', 'view', tag, '-R', 'fatalihue/YTA']);
  fail(`A release ${tag} já existe. Suba a versão com "npm version patch".`);
} catch (e) {
  if (e.status === undefined) throw e; // gh ausente
}

console.log(`\n▶ Gerando o instalador ${version}…`);
run('npm', ['run', 'dist']);

const files = [`release/YTA-Setup-${version}.exe`, `release/YTA-Setup-${version}.exe.blockmap`, 'release/latest.yml'];
for (const f of files) if (!existsSync(f)) fail(`Arquivo esperado não foi gerado: ${f}`);
if (!readFileSync('release/latest.yml', 'utf8').includes(`version: ${version}`)) fail('latest.yml não corresponde à versão.');

console.log(`\n▶ Enviando o código e a tag ${tag}…`);
if (!out('git', ['tag', '--list', tag])) run('git', ['tag', tag]);
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

const notes = process.argv.slice(2).join('\n');
console.log(`\n▶ Publicando a release ${tag}…`);
run('gh', [
  'release', 'create', tag, ...files,
  '-R', 'fatalihue/YTA',
  '--title', `YTA ${version}`,
  '--latest', // o atualizador lê releases/latest/download: a nova versão TEM de ser a "latest"
  ...(notes ? ['--notes', notes] : ['--generate-notes']),
]);
console.log(`\n✔ YTA ${version} publicado. Os apps instalados se atualizam na próxima abertura.`);
