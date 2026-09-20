import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const data = path.resolve(process.env.DATA_DIR || '.data'), target = path.resolve(process.argv[2] || `backups/stratum-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
await mkdir(path.dirname(target), { recursive: true });
const db = new DatabaseSync(path.join(data, 'stratum.sqlite'));
try {
    db.exec('PRAGMA busy_timeout=10000');
    db.prepare('VACUUM INTO ?').run(target);
    console.log(`Consistent SQLite backup written to ${target}`);
}
finally {
    db.close();
}
