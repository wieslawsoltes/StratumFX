import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCB, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { validateDocument, applyOperations } from '../packages/core/src/graph.js';
const scrypt = promisify(scryptCB), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '127.0.0.1', PORT = Number(process.env.PORT || 4173), DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.data'));
await mkdir(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'stratum.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,role TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS operations(id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL,revision INTEGER NOT NULL,operations TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(project_id,id));
CREATE INDEX IF NOT EXISTS operations_revision ON operations(project_id,revision);
CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,label TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created INTEGER NOT NULL);
`);
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
db.prepare('DELETE FROM invites WHERE expires < ?').run(Date.now());
const sessions = new Map(), clients = new Map(), limits = new Map();
const hash = s => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { const e = Error(message); e.status = status; throw e; };
function json(res, data, status = 200) { if (res.writableEnded)
    return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) { if (!req.headers['content-type']?.startsWith('application/json'))
    fail(415, 'Use application/json'); let size = 0, parts = []; for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024)
        fail(413, 'Request exceeds 4 MB collaboration limit');
    parts.push(chunk);
} try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(400, 'Invalid JSON body');
    return value;
}
catch {
    fail(400, 'Invalid JSON body');
} }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => { const i = s.indexOf('='); return i < 0 ? ['', ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; })); }
function user(req, required = true) { const raw = cookies(req).stratum_session; const row = raw ? db.prepare('SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(raw), Date.now()) : null; if (!row && required)
    fail(401, 'Sign in to access team projects'); return row || null; }
function member(projectId, userId, write = false, owner = false) { const row = db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(projectId, userId); if (!row)
    fail(404, 'Project not found or access denied'); if ((write && row.role === 'viewer') || (owner && row.role !== 'owner'))
    fail(403, 'This action requires ' + (owner ? 'owner' : 'editor') + ' access'); return row.role; }
function projectState(id, uid) { const role = member(id, uid), p = db.prepare('SELECT document,revision,title FROM projects WHERE id=?').get(id); return { id, document: JSON.parse(p.document), revision: p.revision, title: p.title, role }; }
function sessionCookie(res, token, maxAge = 604800) { res.setHeader('Set-Cookie', `stratum_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function signIn(res, userId) { const raw = randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(raw), userId, Date.now() + 604800000); sessionCookie(res, raw); }
function rate(req, group, max) { const key = group + ':' + req.socket.remoteAddress, now = Date.now(), entry = limits.get(key) || { count: 0, start: now }; if (now - entry.start > 60000) {
    entry.count = 0;
    entry.start = now;
} entry.count++; limits.set(key, entry); if (entry.count > max)
    fail(429, 'Too many requests; retry after a minute'); }
function send(client, event) { if (client.res.writableEnded || client.res.destroyed)
    return; const text = 'data: ' + JSON.stringify(event) + '\n\n'; if (client.res.writableLength > 4 * 1024 * 1024) {
    client.res.end();
    return;
} client.res.write(text); }
function broadcast(projectId, event) { for (const c of clients.get(projectId) || [])
    send(c, event); }
function broadcastPresence(id) { broadcast(id, { type: 'presence', users: [...(clients.get(id) || [])].map(c => ({ clientId: c.clientId, userId: c.user.id, name: c.user.name, x: c.x, y: c.y, role: c.role })) }); }
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try {
    const result = fn();
    db.exec('COMMIT');
    return result;
}
catch (e) {
    db.exec('ROLLBACK');
    throw e;
} }
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.zip': 'application/zip' };
async function staticFile(req, res, url) { if (!['GET', 'HEAD'].includes(req.method))
    fail(405, 'Method not allowed'); let pathname; try {
    pathname = decodeURIComponent(url.pathname);
}
catch {
    fail(400, 'Invalid URL');
} if (pathname === '/')
    pathname = '/site/index.html'; if (pathname === '/StratumFX.html')
    pathname = '/dist/StratumFX.html'; if (pathname.startsWith('/downloads/'))
    pathname = '/dist' + pathname; if (pathname === '/studio' || pathname === '/studio/') {
    res.writeHead(302, { Location: '../app/' });
    res.end();
    return;
} if (pathname.endsWith('/'))
    pathname += 'index.html'; const relative = pathname.slice(1), allowed = ['app/', 'packages/', 'site/', 'examples/', 'dist/', 'docs/']; if (!allowed.some(p => relative.startsWith(p)))
    fail(404, 'Not found'); const file = path.resolve(ROOT, relative); if (!file.startsWith(ROOT + path.sep) || relative.split('/').some(x => x.startsWith('.')))
    fail(403, 'Forbidden path'); let info; try {
    info = await stat(file);
}
catch {
    fail(404, 'Not found');
} if (!info.isFile())
    fail(404, 'Not found'); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' }); if (req.method === 'HEAD') {
    res.end();
    return;
} createReadStream(file).pipe(res); }
const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return json(res, {error:'Invalid request URL'}, 400); }
    try {
        if (!url.pathname.startsWith('/api/'))
            return await staticFile(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            const origin = req.headers.origin;
            if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}` && origin !== process.env.ALLOWED_ORIGIN)
                fail(403, 'Cross-origin requests are not permitted');
        }
        const route = url.pathname.slice(4);
        if (route === '/health' && req.method === 'GET')
            return json(res, { ok: true, service: 'Stratum FX', version: '0.1.0' });
        if (route === '/session' && req.method === 'GET')
            return json(res, { user: user(req, false) });
        if ((route === '/register' || route === '/login') && req.method === 'POST') {
            rate(req, 'auth', 12);
            const data = await body(req), name = String(data.name || '').trim().toLowerCase(), password = String(data.password || '');
            if (!/^[a-z0-9_.-]{3,40}$/.test(name))
                fail(400, 'Use a 3–40 character username: letters, digits, dot, dash or underscore');
            if (password.length < 10 || password.length > 256)
                fail(400, 'Password must contain 10–256 characters');
            if (route === '/register') {
                if (db.prepare('SELECT id FROM users WHERE name=?').get(name))
                    fail(409, 'Username is already registered');
                const id = randomUUID(), salt = randomBytes(16).toString('hex'), digest = await scrypt(password, salt, 64);
                try {
                    db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id, name, salt, digest.toString('hex'), Date.now());
                }
                catch {
                    fail(409, 'Username is already registered');
                }
                signIn(res, id);
                return json(res, { user: { id, name } }, 201);
            }
            const record = db.prepare('SELECT * FROM users WHERE name=?').get(name), digest = await scrypt(password, record?.salt || 'invalid-authentication-salt', 64);
            if (!record || !timingSafeEqual(digest, Buffer.from(record.password, 'hex')))
                fail(401, 'Incorrect username or password');
            signIn(res, record.id);
            return json(res, { user: { id: record.id, name: record.name } });
        }
        if (route === '/logout' && req.method === 'POST') {
            const token = cookies(req).stratum_session;
            if (token)
                db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
            sessionCookie(res, '', 0);
            return json(res, { ok: true });
        }
        const u = user(req);
        rate(req, 'api', 1800);
        if (route === '/projects' && req.method === 'GET') {
            const projects = db.prepare('SELECT p.id,p.title,p.revision,p.updated,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.updated DESC').all(u.id);
            return json(res, { projects });
        }
        if (route === '/projects' && req.method === 'POST') {
            const { document } = await body(req);
            validateDocument(document);
            const id = randomUUID();
            transaction(() => { db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(id, u.id, document.title, JSON.stringify(document), 0, Date.now()); db.prepare('INSERT INTO members VALUES(?,?,?)').run(id, u.id, 'owner'); });
            return json(res, { id, revision: 0 }, 201);
        }
        if (route === '/join' && req.method === 'POST') {
            rate(req, 'join', 30);
            const { code } = await body(req);
            if (typeof code !== 'string' || code.length > 100)
                fail(400, 'Invalid invitation');
            const invite = db.prepare('SELECT * FROM invites WHERE token=? AND expires>?').get(hash(code.trim()), Date.now());
            if (!invite)
                fail(404, 'Invitation is invalid or expired');
            db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)').run(invite.project_id, u.id, invite.role);
            broadcast(invite.project_id, { type: 'membership' });
            return json(res, { id: invite.project_id });
        }
        const match = route.match(/^\/projects\/([a-zA-Z0-9-]+)(.*)$/);
        if (!match)
            fail(404, 'Unknown API endpoint');
        const [, id, rest] = match, role = member(id, u.id);
        if (!rest && req.method === 'GET')
            return json(res, projectState(id, u.id));
        if (rest === '/events' && req.method === 'GET') {
            const existing = [...(clients.get(id) || [])].filter(c => c.user.id === u.id);
            if (existing.length >= 8)
                fail(429, 'Maximum 8 live sessions per account and project');
            const clientId = url.searchParams.get('client') || randomUUID();
            if (clientId.length > 120)
                fail(400, 'Invalid client ID');
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.write(': Stratum FX live channel\n\n');
            const c = { res, user: u, clientId, role, x: null, y: null };
            if (!clients.has(id))
                clients.set(id, new Set());
            clients.get(id).add(c);
            send(c, { type: 'state', ...projectState(id, u.id) });
            broadcastPresence(id);
            const token = hash(cookies(req).stratum_session || '');
            const timer = setInterval(() => { if (!db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?').get(token, Date.now())) {
                res.end();
                return;
            } res.write(': heartbeat\n\n'); }, 15000);
            req.on('close', () => { clearInterval(timer); clients.get(id)?.delete(c); if (!clients.get(id)?.size)
                clients.delete(id);
            else
                broadcastPresence(id); });
            return;
        }
        if (rest === '/presence' && req.method === 'POST') {
            const data = await body(req);
            if (!Number.isFinite(data.x) || !Number.isFinite(data.y) || Math.abs(data.x) > 100000 || Math.abs(data.y) > 100000)
                fail(400, 'Invalid cursor');
            for (const c of clients.get(id) || [])
                if (c.clientId === data.clientId && c.user.id === u.id) {
                    c.x = data.x;
                    c.y = data.y;
                }
            broadcastPresence(id);
            return json(res, { ok: true });
        }
        if (rest === '/operations' && req.method === 'POST') {
            member(id, u.id, true);
            const data = await body(req);
            if (typeof data.id !== 'string' || data.id.length > 120)
                fail(400, 'Operation ID is required');
            const duplicate = db.prepare('SELECT 1 FROM operations WHERE project_id=? AND id=?').get(id, data.id);
            if (duplicate)
                return json(res, projectState(id, u.id));
            const result = transaction(() => { const state = projectState(id, u.id), next = applyOperations(state.document, data.ops), revision = state.revision + 1; db.prepare('UPDATE projects SET document=?,title=?,revision=?,updated=? WHERE id=?').run(JSON.stringify(next), next.title, revision, Date.now(), id); db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(data.id, id, u.id, revision, JSON.stringify(data.ops), Date.now()); return { document: next, revision }; });
            broadcast(id, { type: 'commit', id: data.id, ops: data.ops, revision: result.revision, user: u.name });
            return json(res, result);
        }
        if (rest === '/invite' && req.method === 'POST') {
            member(id, u.id, false, true);
            const data = await body(req);
            if (!['viewer', 'editor'].includes(data.role))
                fail(400, 'Invitation role must be editor or viewer');
            const code = randomBytes(18).toString('base64url');
            db.prepare('INSERT INTO invites VALUES(?,?,?,?)').run(hash(code), id, data.role, Date.now() + 604800000);
            return json(res, { code, role: data.role, expires: Date.now() + 604800000 });
        }
        if (rest === '/members' && req.method === 'GET') {
            return json(res, { members: db.prepare('SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?').all(id) });
        }
        if (rest === '/members' && req.method === 'PATCH') {
            member(id, u.id, false, true);
            const data = await body(req);
            if (data.userId === u.id || !['viewer', 'editor'].includes(data.role))
                fail(400, 'Cannot change owner role');
            const result = db.prepare('UPDATE members SET role=? WHERE project_id=? AND user_id=? AND role<>?').run(data.role, id, data.userId, 'owner');
            if (!result.changes)
                fail(404, 'Member not found');
            for (const c of clients.get(id) || [])
                if (c.user.id === data.userId)
                    c.role = data.role;
            broadcast(id, { type: 'membership' });
            broadcastPresence(id);
            return json(res, { ok: true });
        }
        if (rest === '/checkpoints' && req.method === 'POST') {
            member(id, u.id, true);
            const data = await body(req);
            if (typeof data.label !== 'string' || data.label.length > 200)
                fail(400, 'Invalid checkpoint label');
            const p = projectState(id, u.id), cid = randomUUID();
            db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)').run(cid, id, data.label, JSON.stringify(p.document), p.revision, Date.now());
            return json(res, { id: cid }, 201);
        }
        if (rest === '/checkpoints' && req.method === 'GET')
            return json(res, { checkpoints: db.prepare('SELECT id,label,revision,created FROM checkpoints WHERE project_id=? ORDER BY created DESC').all(id) });
        const restore = rest.match(/^\/checkpoints\/([\w-]+)\/restore$/);
        if (restore && req.method === 'POST') {
            member(id, u.id, false, true);
            const saved = db.prepare('SELECT document FROM checkpoints WHERE id=? AND project_id=?').get(restore[1], id);
            if (!saved)
                fail(404, 'Checkpoint not found');
            const document = JSON.parse(saved.document);
            validateDocument(document);
            const revision = transaction(() => { const p = projectState(id, u.id), next = p.revision + 1; db.prepare('UPDATE projects SET document=?,title=?,revision=?,updated=? WHERE id=?').run(saved.document, document.title, next, Date.now(), id); db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(randomUUID(), id, u.id, next, JSON.stringify({ checkpoint: restore[1] }), Date.now()); return next; });
            for (const c of clients.get(id) || [])
                send(c, { type: 'state', ...projectState(id, c.user.id) });
            return json(res, { document, revision });
        }
        if (rest === '/audit' && req.method === 'GET') {
            member(id, u.id, false, true);
            return json(res, { operations: db.prepare('SELECT id,user_id,revision,operations,created FROM operations WHERE project_id=? ORDER BY revision DESC LIMIT 500').all(id) });
        }
        fail(404, 'Unknown API endpoint');
    }
    catch (error) {
        const status = error.status || ((error.message.includes('Invalid') || error.message.includes('Unsupported') || error.message.includes('cycle') || error.message.includes('deleted') || error.message.includes('parameter') || error.message.includes('range') || error.message.includes('node') || error.message.includes('Node')) ? 400 : 500);
        if (status === 500)
            console.error(error);
        if (!res.headersSent)
            json(res, { error: status === 500 ? 'Internal server error' : error.message }, status);
        else
            res.end();
    }
});
server.keepAliveTimeout = 65000;
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(PORT, HOST, () => console.log(`Stratum FX: http://${HOST}:${PORT}\nStudio: http://${HOST}:${PORT}/app/\nSQLite: ${DATA}`));
const cleanup = setInterval(() => { for (const [key, v] of limits)
    if (Date.now() - v.start > 120000)
        limits.delete(key); db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); }, 60000);
cleanup.unref();
function shutdown() { for (const set of clients.values())
    for (const c of set)
        c.res.end(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
