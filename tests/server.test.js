import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDocument, createNode } from '../packages/core/src/graph.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
test('SQLite / HTTP / live collaboration integration', { timeout: 30000 }, async (t) => {
    const data = await mkdtemp(path.join(tmpdir(), 'stratum-test-')), port = await freePort(), base = `http://127.0.0.1:${port}`;
    let child, logs = '';
    async function start() { child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b); for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(base + '/api/health')).ok)
                return;
        }
        catch { }
        if (child.exitCode !== null)
            throw Error(logs);
        await delay(30);
    } throw Error('Server did not start: ' + logs); }
    async function stop() { if (!child || child.exitCode !== null)
        return; child.kill('SIGTERM'); await once(child, 'exit'); }
    t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
    await start();
    const clients = { owner: {}, editor: {}, viewer: {}, outsider: {} };
    async function request(who, url, method = 'GET', body, headers = {}) { const client = clients[who] || {}, response = await fetch(base + url, { method, headers: { ...(client.cookie ? { cookie: client.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); const cookie = response.headers.get('set-cookie'); if (cookie)
        client.cookie = cookie.split(';')[0]; let value; const text = await response.text(); try {
        value = JSON.parse(text);
    }
    catch {
        value = text;
    } return { status: response.status, data: value, headers: response.headers }; }
    await t.test('malformed protocol-relative request URL is rejected without terminating server', async () => {
        const bad = await request('outsider', '//%'); assert.equal(bad.status, 400);
        const health = await request('outsider', '/api/health'); assert.equal(health.status, 200);
    });
    const password = 'A-test-password-3862';
    let projectId, checkpointId, editorId, stream, reader, readBuffer = '', events = [], revision = 0;
    async function eventOf(type) { const end = Date.now() + 5000; while (Date.now() < end) {
        const index = events.findIndex(e => e.type === type);
        if (index >= 0)
            return events.splice(index, 1)[0];
        const result = await Promise.race([reader.read(), delay(4500).then(() => { throw Error('SSE event timeout ' + type); })]);
        if (result.done)
            throw Error('SSE ended');
        readBuffer += new TextDecoder().decode(result.value);
        let split;
        while ((split = readBuffer.indexOf('\n\n')) >= 0) {
            const block = readBuffer.slice(0, split);
            readBuffer = readBuffer.slice(split + 2);
            for (const line of block.split('\n'))
                if (line.startsWith('data: '))
                    events.push(JSON.parse(line.slice(6)));
        }
    } throw Error('No ' + type + ' event'); }
    await t.test('health and static app are served with security headers', async () => { const health = await request('outsider', '/api/health'); assert.equal(health.status, 200); assert.equal(health.data.ok, true); const app = await request('outsider', '/app/'); assert.equal(app.status, 200); assert.ok(app.data.includes('Stratum FX')); assert.equal(app.headers.get('x-content-type-options'), 'nosniff'); assert.ok(app.headers.get('content-security-policy').includes("object-src 'none'")); });
    await t.test('private files and dot paths are not served', async () => { for (const target of ['/server/index.js', '/.data/stratum.sqlite', '/app/%2e%2e%2f.data/stratum.sqlite', '/package.json'])
        assert.notEqual((await request('outsider', target)).status, 200); });
    await t.test('registration issues HttpOnly SameSite cookies and distinct accounts', async () => { for (const who of ['owner', 'editor', 'viewer']) {
        const result = await request(who, '/api/register', 'POST', { name: 'test_' + who, password });
        assert.equal(result.status, 201);
        assert.ok(result.headers.get('set-cookie').includes('HttpOnly'));
        assert.ok(result.headers.get('set-cookie').includes('SameSite=Strict'));
        if (who === 'editor')
            editorId = result.data.user.id;
    } });
    await t.test('malformed authentication bodies and weak credentials are rejected', async () => { assert.equal((await request('outsider', '/api/register', 'POST', null)).status, 400); assert.equal((await request('outsider', '/api/register', 'POST', { name: 'bad', password: 'short' })).status, 400); assert.equal((await request('outsider', '/api/login', 'POST', { name: 'test_owner', password: 'incorrect-password' })).status, 401); });
    await t.test('unauthenticated and cross-origin writes are denied', async () => { assert.equal((await request('outsider', '/api/projects')).status, 401); assert.equal((await request('owner', '/api/projects', 'POST', {}, { origin: 'https://untrusted.invalid' })).status, 403); });
    await t.test('owner creates a persisted project; nonmember cannot access it', async () => { const document = createDocument(); document.nodes = [createNode('box', { id: 'base' }), createNode('transform', { id: 'move', inputs: ['base'] })]; document.title = 'Shared scene'; document.outputId = 'move'; const r = await request('owner', '/api/projects', 'POST', { document }); assert.equal(r.status, 201); projectId = r.data.id; assert.equal((await request('editor', `/api/projects/${projectId}`)).status, 404); const state = await request('owner', `/api/projects/${projectId}`); assert.equal(state.data.role, 'owner'); assert.equal(state.data.document.nodes.length, 2); });
    await t.test('editor and viewer invitations grant exactly their assigned roles', async () => { for (const role of ['editor', 'viewer']) {
        const invite = await request('owner', `/api/projects/${projectId}/invite`, 'POST', { role });
        assert.equal(invite.status, 200);
        assert.ok(invite.data.code.length >= 24);
        assert.equal((await request(role, '/api/join', 'POST', { code: invite.data.code })).status, 200);
        assert.equal((await request(role, `/api/projects/${projectId}`)).data.role, role);
    } assert.equal((await request('editor', `/api/projects/${projectId}/invite`, 'POST', { role: 'editor' })).status, 403); });
    await t.test('SSE establishes a real initial state and authenticated presence', async () => { stream = new AbortController(); const r = await fetch(`${base}/api/projects/${projectId}/events?client=test_client_owner`, { headers: { cookie: clients.owner.cookie }, signal: stream.signal }); assert.equal(r.status, 200); assert.ok(r.headers.get('content-type').startsWith('text/event-stream')); reader = r.body.getReader(); const state = await eventOf('state'); assert.equal(state.revision, 0); const presence = await eventOf('presence'); assert.equal(presence.users[0].name, 'test_owner'); });
    await t.test('concurrent independent edits merge and are streamed to another client', async () => { const [a, b] = await Promise.all([request('owner', `/api/projects/${projectId}/operations`, 'POST', { id: randomUUID(), ops: [{ kind: 'title', value: 'Concurrent scene' }] }), request('editor', `/api/projects/${projectId}/operations`, 'POST', { id: randomUUID(), ops: [{ kind: 'param', nodeId: 'move', key: 'translate', value: [2, 3, 4] }] })]); assert.equal(a.status, 200); assert.equal(b.status, 200); const state = (await request('viewer', `/api/projects/${projectId}`)).data; assert.equal(state.revision, 2); assert.equal(state.document.title, 'Concurrent scene'); assert.deepEqual(state.document.nodes[1].params.translate, [2, 3, 4]); const c1 = await eventOf('commit'), c2 = await eventOf('commit'); assert.deepEqual([c1.revision, c2.revision], [1, 2]); revision = state.revision; });
    await t.test('viewer cannot mutate operations, checkpoints or members', async () => { for (const [suffix, body, method] of [['operations', { id: randomUUID(), ops: [{ kind: 'title', value: 'Unauthorized' }] }, 'POST'], ['checkpoints', { label: 'Unauthorized' }, 'POST'], ['members', { userId: editorId, role: 'viewer' }, 'PATCH']])
        assert.equal((await request('viewer', `/api/projects/${projectId}/${suffix}`, method, body)).status, 403); });
    await t.test('operation IDs make retries idempotent', async () => { const batch = { id: randomUUID(), ops: [{ kind: 'title', value: 'Idempotent scene' }] }; const a = await request('editor', `/api/projects/${projectId}/operations`, 'POST', batch), b = await request('editor', `/api/projects/${projectId}/operations`, 'POST', batch); assert.equal(a.status, 200); assert.equal(a.data.revision, b.data.revision); revision = a.data.revision; });
    await t.test('cycle and invalid batches roll back without revision changes', async () => { const before = (await request('owner', `/api/projects/${projectId}`)).data; const r = await request('editor', `/api/projects/${projectId}/operations`, 'POST', { id: randomUUID(), ops: [{ kind: 'title', value: 'Must roll back' }, { kind: 'connect', nodeId: 'move', slot: 0, sourceId: 'move' }] }); assert.equal(r.status, 400); const after = (await request('owner', `/api/projects/${projectId}`)).data; assert.equal(after.revision, before.revision); assert.deepEqual(after.document, before.document); });
    await t.test('cursor updates propagate over SSE with the actual account identity', async () => { await request('owner', `/api/projects/${projectId}/presence`, 'POST', { clientId: 'test_client_owner', x: 134, y: 250 }); const event = await eventOf('presence'); assert.equal(event.users[0].x, 134); assert.equal(event.users[0].name, 'test_owner'); });
    await t.test('checkpoint creation, listing and owner restoration are persisted revisions', async () => { const result = await request('editor', `/api/projects/${projectId}/checkpoints`, 'POST', { label: 'Before revision' }); assert.equal(result.status, 201); checkpointId = result.data.id; assert.ok((await request('viewer', `/api/projects/${projectId}/checkpoints`)).data.checkpoints.some(x => x.id === checkpointId)); await request('editor', `/api/projects/${projectId}/operations`, 'POST', { id: randomUUID(), ops: [{ kind: 'title', value: 'After checkpoint' }] }); assert.equal((await request('editor', `/api/projects/${projectId}/checkpoints/${checkpointId}/restore`, 'POST', {})).status, 403); const restored = await request('owner', `/api/projects/${projectId}/checkpoints/${checkpointId}/restore`, 'POST', {}); assert.equal(restored.status, 200); assert.equal(restored.data.document.title, 'Idempotent scene'); assert.ok(restored.data.revision > revision); revision = restored.data.revision; });
    await t.test('role changes immediately enforce server-side permissions', async () => { assert.equal((await request('owner', `/api/projects/${projectId}/members`, 'PATCH', { userId: editorId, role: 'viewer' })).status, 200); assert.equal((await request('editor', `/api/projects/${projectId}/operations`, 'POST', { id: randomUUID(), ops: [] })).status, 403); assert.equal((await request('owner', `/api/projects/${projectId}/members`, 'PATCH', { userId: editorId, role: 'editor' })).status, 200); });
    await t.test('audit log is owner-only and includes committed operations', async () => { assert.equal((await request('viewer', `/api/projects/${projectId}/audit`)).status, 403); const audit = await request('owner', `/api/projects/${projectId}/audit`); assert.equal(audit.status, 200); assert.equal(audit.data.operations.length, revision); });
    await t.test('SQLite project, membership, checkpoints and session survive restart', async () => { stream.abort(); await reader.cancel().catch(() => { }); await stop(); await start(); const state = await request('owner', `/api/projects/${projectId}`); assert.equal(state.status, 200); assert.equal(state.data.revision, revision); assert.equal(state.data.document.title, 'Idempotent scene'); assert.equal((await request('editor', `/api/projects/${projectId}`)).data.role, 'editor'); assert.ok((await request('owner', `/api/projects/${projectId}/checkpoints`)).data.checkpoints.some(x => x.id === checkpointId)); });
    await t.test('logout invalidates the previously issued session token', async () => { const cookie = clients.owner.cookie; assert.equal((await request('owner', '/api/logout', 'POST', {})).status, 200); assert.equal((await request('outsider', '/api/projects', 'GET', undefined, { cookie })).status, 401); });
});
