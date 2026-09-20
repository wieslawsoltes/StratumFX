import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bundle } from './bundle.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const names = ['geometry', 'core', 'renderer', 'controls', 'collaboration'];
for (const name of names) {
    const dir = path.join(root, 'packages', name);
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    const esm = await bundle(path.join(dir, 'src/index.js'), { format: 'esm' });
    await writeFile(path.join(dir, 'dist/index.js'), esm.code);
    const standalone = await bundle(path.join(dir, 'src/index.js'), { globalName: 'Stratum' + name[0].toUpperCase() + name.slice(1) });
    await writeFile(path.join(dir, 'dist/standalone.js'), standalone.code);
}
const coreWorker = await bundle(path.join(root, 'packages/core/src/cook-worker.js'));
await writeFile(path.join(root, 'packages/core/dist/worker.js'), coreWorker.code);
for (const dir of ['app', 'packages', 'site', 'examples', 'docs'])
    await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
let html = await readFile(path.join(root, 'app/index.html'), 'utf8'), css = await readFile(path.join(root, 'app/style.css'), 'utf8');
const worker = await bundle(path.join(root, 'packages/core/src/cook-worker.js')), app = await bundle(path.join(root, 'app/main.js'));
const script = `globalThis.STRATUM_WORKER_SOURCE=${JSON.stringify(worker.code)};\n${app.code}`;
html = html.replace('class="brand" href="../"', 'class="brand" href="#"');
html = html.replace(/<link rel="icon"[^>]+>/, '').replace('<link rel="stylesheet" href="./style.css">', () => '<style>' + css + '</style>').replace('<script type="module" src="./main.js"></script>', () => '<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
await writeFile(path.join(out, 'StratumFX.html'), html);
await writeFile(path.join(out, 'app.bundle.js'), app.code);
await writeFile(path.join(out, 'worker.bundle.js'), worker.code);
try {
    await cp(path.join(root, 'site/index.html'), path.join(out, 'index.html'));
}
catch { }
await writeFile(path.join(out, '.nojekyll'), '');
try {
    await cp(path.join(root, 'artifacts/packages'), path.join(out, 'downloads'), { recursive: true });
}
catch { }
console.log(`Built five reusable packages and standalone app (${Math.round(Buffer.byteLength(html) / 1024)} KiB). Static site: dist/`);
