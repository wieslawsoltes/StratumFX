import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
async function scan(dir) { for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.data', 'artifacts', 'dist'].includes(item.name))
        continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory())
        await scan(file);
    else if (item.name.endsWith('.js')) {
        const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (r.status !== 0)
            throw Error(r.stderr);
        count++;
    }
} }
await scan(root);
console.log(`${count} JavaScript source files passed syntax checking.`);
