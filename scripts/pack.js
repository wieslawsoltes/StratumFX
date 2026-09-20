import { mkdir, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts/packages');
await mkdir(output, { recursive: true });
for (const name of ['geometry', 'core', 'renderer', 'controls', 'collaboration']) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--pack-destination', output], { cwd: path.join(root, 'packages', name), stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0)
        throw Error(`Packaging failed: ${name}`);
}
await cp(output, path.join(root, 'dist/downloads'), { recursive: true });
console.log('Five local-installable archives written to artifacts/packages and dist/downloads.');
