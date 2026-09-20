import test from 'node:test';
import assert from 'node:assert/strict';
import { CollaborationClient } from '../packages/collaboration/src/client.js';
import { GraphStore, createDocument, createNode } from '../packages/core/src/graph.js';

function document(title) { const d = createDocument(title); const n = createNode('box'); d.nodes = [n]; d.outputId = n.id; return d; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const state = (title, revision = 0) => ({ document: document(title), revision, role: 'editor' });

// Transport is deliberately mocked here to order race conditions. HTTP/SSE is tested separately in server.test.js.
test('Switching projects ignores a stale resync result', async () => {
    const store = new GraphStore(document('Local')), client = new CollaborationClient(store), pending = deferred();
    client.projectId = 'old'; client.authoritative = store.document; client.request = () => pending.promise;
    const operation = client.resync(); client.disconnect(); client.projectId = 'new'; client.authoritative = document('New');
    pending.resolve(state('Stale', 99)); await operation;
    assert.equal(client.authoritative.title, 'New'); assert.equal(client.projectId, 'new'); client.destroy();
});
test('Disconnect ignores a late connection fetch', async () => {
    const store = new GraphStore(document('Local')), client = new CollaborationClient(store), pending = deferred();
    client.request = () => pending.promise;
    const connecting = client.connect('old'); client.disconnect(); pending.resolve(state('Old')); await connecting;
    assert.equal(client.projectId, null); assert.equal(client.status, 'offline'); assert.equal(store.document.title, 'Local'); client.destroy();
});
test('Stale operation completion cannot clear a newer in-flight request', async () => {
    const store = new GraphStore(document('Local')), client = new CollaborationClient(store), pending = deferred();
    client.projectId = 'old'; client.role = 'editor'; client.pending = [{id:'batch',ops:[],created:0}]; client.request = () => pending.promise;
    const posting = client.pump(); client.disconnect(); client.projectId = 'new'; client.inFlight = true;
    pending.resolve(state('Old', 2)); await posting;
    assert.equal(client.inFlight, true); assert.equal(client.projectId, 'new'); client.destroy();
});
test('Viewer edits are rolled back against the authoritative graph', () => {
    const d = document('Read only'), store = new GraphStore(d), client = new CollaborationClient(store);
    client.projectId = 'p'; client.role = 'viewer'; client.authoritative = structuredClone(d);
    let message; client.addEventListener('error', e => message = e.detail);
    store.commit([{kind:'title',value:'Forbidden'}]);
    assert.equal(store.document.title, 'Read only'); assert.equal(client.pending.length, 0); assert.match(message,/read-only/); client.destroy();
});
