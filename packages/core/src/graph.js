import { defaultRegistry } from './nodes.js';
import { Mesh } from '../../geometry/src/mesh.js';
import { evaluateExpression, sampleKeys } from './expression.js';
import { clamp } from '../../geometry/src/math.js';
export const uuid = () => globalThis.crypto?.randomUUID?.() || 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export function createNode(type, options = {}, registry = defaultRegistry) { return { id: uuid(), type, name: type + '1', x: 100, y: 100, inputs: [], params: registry.defaults(type), keyframes: {}, bypass: false, ...structuredClone(options) }; }
export function createDocument(title = 'Untitled scene') { return { schemaVersion: 1, id: uuid(), title, nodes: [], outputId: null, start: 1, end: 240, fps: 24 }; }
export function validateDocument(doc, registry = defaultRegistry) {
    if (!doc || doc.schemaVersion !== 1 || typeof doc.id !== 'string' || typeof doc.title !== 'string' || doc.title.length > 200 || !Array.isArray(doc.nodes) || doc.nodes.length > 500)
        throw Error('Invalid project document');
    if (!Number.isFinite(doc.fps) || doc.fps < 1 || doc.fps > 240 || !Number.isInteger(doc.start) || !Number.isInteger(doc.end) || doc.start < 0 || doc.end < doc.start || doc.end > 100000)
        throw Error('Invalid timeline range');
    const ids = new Set();
    for (const n of doc.nodes) {
        if (!n || typeof n.id !== 'string' || n.id.length > 120 || ids.has(n.id))
            throw Error('Invalid or duplicate node ID');
        ids.add(n.id);
        const def = registry.get(n.type);
        if (typeof n.name !== 'string' || n.name.length > 100 || !Number.isFinite(n.x) || !Number.isFinite(n.y) || Math.abs(n.x) > 100000 || Math.abs(n.y) > 100000 || !Array.isArray(n.inputs) || n.inputs.length > def.inputs)
            throw Error('Invalid node');
        if (typeof n.bypass !== 'boolean')
            throw Error('Invalid bypass flag');
        if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params))
            throw Error('Invalid parameters');
        for (const [key, value] of Object.entries(n.params)) {
            const spec = def.params[key];
            if (!Object.hasOwn(def.params, key))
                throw Error(`Unsupported parameter ${key}`);
            if (spec.type === 'number') {
                if (typeof value === 'string' && value.startsWith('=')) {
                    if (value.length > 1024)
                        throw Error('Expression too long');
                }
                else if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max)
                    throw Error(`${spec.label} outside supported range`);
            }
            else if (spec.type === 'vector') {
                if (!Array.isArray(value) || value.length !== 3 || value.some(v => !(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000) && !(typeof v === 'string' && v.startsWith('=') && v.length <= 1024)))
                    throw Error('Invalid vector');
            }
            else if (spec.type === 'boolean' && typeof value !== 'boolean')
                throw Error('Invalid boolean');
            else if (spec.type === 'enum' && !spec.options.includes(value))
                throw Error('Invalid enum');
            else if (spec.type === 'color' && !/^#[\da-f]{6}$/i.test(value))
                throw Error('Invalid color');
            else if (spec.type === 'text' && (typeof value !== 'string' || value.length > (spec.maxLength || 4096)))
                throw Error('Invalid text');
        }
        if (n.keyframes) {
            for (const [key, keys] of Object.entries(n.keyframes)) {
                if (!Object.hasOwn(def.params, key) || def.params[key].type !== 'number' || !Array.isArray(keys) || keys.length > 2000)
                    throw Error('Invalid animation channel');
                for (const k of keys)
                    if (!Number.isFinite(k.frame) || !Number.isFinite(k.value) || k.value < def.params[key].min || k.value > def.params[key].max || !['linear', 'step', undefined].includes(k.interpolation))
                        throw Error('Invalid keyframe');
            }
        }
    }
    const nodes = new Map(doc.nodes.map(n => [n.id, n]));
    for (const n of doc.nodes)
        for (const input of n.inputs)
            if (input !== null && input !== undefined && !ids.has(input))
                throw Error('Connection references missing node');
    if (doc.outputId !== null && !ids.has(doc.outputId))
        throw Error('Display node missing');
    const active = new Set(), done = new Set();
    function visit(id) { if (done.has(id))
        return; if (active.has(id))
        throw Error('Connection would create a cycle'); active.add(id); for (const i of nodes.get(id).inputs)
        if (i)
            visit(i); active.delete(id); done.add(id); }
    for (const n of doc.nodes)
        visit(n.id);
    return doc;
}
export class Engine {
    constructor(registry = defaultRegistry) { this.registry = registry; this.cache = new Map(); this.states = new Map(); this.serial = 0; }
    clear() { this.cache.clear(); this.states.clear(); }
    cook(doc, frame = 1, outputId = doc.outputId) {
        if (!Number.isFinite(frame) || frame < 0 || frame > 100000)
            throw Error('Invalid frame');
        validateDocument(doc, this.registry);
        const start = performance.now(), nodes = new Map(doc.nodes.map(n => [n.id, n])), active = new Set(), timings = [], env = { f: frame, t: (frame - 1) / doc.fps }, self = this;
        let hits = 0;
        function visit(id) {
            if (!id)
                throw Error('Connect an input to cook this node');
            const n = nodes.get(id);
            if (!n)
                throw Error('Node does not exist');
            if (active.has(id))
                throw Error('Dependency cycle');
            active.add(id);
            const def = self.registry.get(n.type);
            let inputIds = Array.from({ length: def.inputs }, (_, i) => n.inputs[i] || null);
            if (def.optionalInputs)
                inputIds = inputIds.filter(Boolean);
            const inputs = inputIds.map(i => i ? visit(i) : null);
            if (!def.optionalInputs && inputs.some(m => !m))
                throw Error(`${n.name}: connect all ${def.inputs} input(s)`);
            const p = { ...self.registry.defaults(n.type), ...n.params };
            for (const [key, value] of Object.entries(p)) {
                const evaluate = v => typeof v === 'string' && v.startsWith('=') ? evaluateExpression(v, env) : v;
                p[key] = Array.isArray(value) ? value.map(evaluate) : def.params[key]?.type === 'number' ? evaluate(sampleKeys(n.keyframes?.[key], frame, value)) : value;
                if (def.params[key]?.type === 'number')
                    p[key] = clamp(p[key], def.params[key].min, def.params[key].max);
            }
            const signature = JSON.stringify([n.type, p, n.bypass, inputs.map(i => i?.version), (typeof def.timeDependent === 'function' ? def.timeDependent(p) : def.timeDependent) ? [frame, env.t] : null]);
            const cached = self.cache.get(id);
            active.delete(id);
            if (cached?.signature === signature) {
                hits++;
                return cached;
            }
            const t = performance.now();
            if (!self.states.has(id))
                self.states.set(id, {});
            let mesh;
            try {
                mesh = n.bypass && inputs[0] ? inputs[0].mesh : def.cook(p, inputs.map(i => i?.mesh), { frame, time: env.t, state: self.states.get(id), engine: self });
            }
            catch (e) {
                throw Error(`${n.name}: ${e.message}`);
            }
            if (!mesh || !(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint32Array) || typeof mesh.clone !== 'function' || typeof mesh.bounds !== 'function')
                throw Error(`${n.name}: node did not produce geometry`);
            const result = { mesh, signature, version: ++self.serial };
            self.cache.set(id, result);
            timings.push({ id, name: n.name, ms: performance.now() - t });
            return result;
        }
        const mesh = outputId ? visit(outputId).mesh : new Mesh();
        for (const id of this.cache.keys())
            if (!nodes.has(id)) {
                this.cache.delete(id);
                this.states.delete(id);
            }
        let bytes = 0;
        for (const c of this.cache.values())
            bytes += c.mesh.positions.byteLength + c.mesh.normals.byteLength + c.mesh.colors.byteLength + c.mesh.uvs.byteLength + c.mesh.indices.byteLength + c.mesh.instances.byteLength;
        if (bytes > 192 * 1024 * 1024) {
            const keep = this.cache.get(outputId);
            this.cache.clear();
            if (keep)
                this.cache.set(outputId, keep);
        }
        return { mesh, stats: { ms: performance.now() - start, cached: hits, cooked: timings.length, bytes, timings } };
    }
}
const editable = new Set(['name', 'x', 'y', 'bypass']);
export function applyOperations(document, operations, registry = defaultRegistry) {
    if (!Array.isArray(operations) || operations.length > 1000)
        throw Error('Invalid operation batch');
    const d = structuredClone(document);
    for (const op of operations) {
        if (!op || typeof op.kind !== 'string')
            throw Error('Invalid operation');
        const n = d.nodes.find(n => n.id === op.nodeId);
        switch (op.kind) {
            case 'add': {
                if (d.nodes.some(n => n.id === op.node.id))
                    throw Error('Node ID already exists');
                d.nodes.push(structuredClone(op.node));
                break;
            }
            case 'remove': {
                d.nodes = d.nodes.filter(n => n.id !== op.nodeId);
                for (const q of d.nodes)
                    q.inputs = q.inputs.map(id => id === op.nodeId ? null : id);
                if (d.outputId === op.nodeId)
                    d.outputId = d.nodes.at(-1)?.id || null;
                break;
            }
            case 'param':
                if (!n)
                    throw Error('Node was deleted');
                if (!Object.hasOwn(registry.get(n.type).params, op.key))
                    throw Error('Unknown parameter');
                n.params[op.key] = structuredClone(op.value);
                break;
            case 'field':
                if (!n)
                    throw Error('Node was deleted');
                if (!editable.has(op.key))
                    throw Error('Unsupported node field');
                n[op.key] = structuredClone(op.value);
                break;
            case 'connect':
                if (!n)
                    throw Error('Node was deleted');
                if (!Number.isInteger(op.slot) || op.slot < 0 || op.slot >= registry.get(n.type).inputs)
                    throw Error('Invalid input slot');
                while (n.inputs.length <= op.slot)
                    n.inputs.push(null);
                n.inputs[op.slot] = op.sourceId || null;
                break;
            case 'output':
                d.outputId = op.nodeId;
                break;
            case 'title':
                d.title = op.value;
                break;
            case 'timeline':
                if (!['start', 'end', 'fps'].includes(op.key))
                    throw Error('Invalid timeline field');
                d[op.key] = op.value;
                break;
            case 'keys':
                if (!n)
                    throw Error('Node was deleted');
                n.keyframes ||= {};
                if (!Object.hasOwn(registry.get(n.type).params, op.key))
                    throw Error('Invalid animation key');
                n.keyframes[op.key] = structuredClone(op.value);
                break;
            default: throw Error('Unsupported operation ' + op.kind);
        }
    }
    return validateDocument(d, registry);
}
/** Diff documents into compensating operations. Preserves changes to unrelated remote fields. */
export function diffDocuments(before, after) { const ops = [], a = new Map(before.nodes.map(n => [n.id, n])), b = new Map(after.nodes.map(n => [n.id, n])); for (const n of before.nodes)
    if (!b.has(n.id))
        ops.push({ kind: 'remove', nodeId: n.id }); for (const n of after.nodes)
    if (!a.has(n.id))
        ops.push({ kind: 'add', node: n }); for (const n of after.nodes) {
    const old = a.get(n.id);
    if (!old)
        continue;
    for (const key of editable)
        if (JSON.stringify(old[key]) !== JSON.stringify(n[key]))
            ops.push({ kind: 'field', nodeId: n.id, key, value: n[key] });
    for (const [key, value] of Object.entries(n.params))
        if (JSON.stringify(old.params[key]) !== JSON.stringify(value))
            ops.push({ kind: 'param', nodeId: n.id, key, value });
    for (let slot = 0; slot < Math.max(n.inputs.length, old.inputs.length); slot++)
        if ((n.inputs[slot] || null) !== (old.inputs[slot] || null))
            ops.push({ kind: 'connect', nodeId: n.id, slot, sourceId: n.inputs[slot] || null });
    for (const key of new Set([...Object.keys(old.keyframes || {}), ...Object.keys(n.keyframes || {})]))
        if (JSON.stringify(old.keyframes?.[key] || []) !== JSON.stringify(n.keyframes?.[key] || []))
            ops.push({ kind: 'keys', nodeId: n.id, key, value: n.keyframes?.[key] || [] });
} if (before.outputId !== after.outputId)
    ops.push({ kind: 'output', nodeId: after.outputId }); if (before.title !== after.title)
    ops.push({ kind: 'title', value: after.title }); for (const key of ['start', 'end', 'fps'])
    if (before[key] !== after[key])
        ops.push({ kind: 'timeline', key, value: after[key] }); return ops; }
export class GraphStore extends EventTarget {
    constructor(document = createDocument(), registry = defaultRegistry) { super(); this.registry = registry; this.document = validateDocument(structuredClone(document), registry); this.history = []; this.future = []; }
    commit(ops, label = 'Edit', record = true) { const before = this.document, next = applyOperations(before, ops, this.registry); if (record) {
        this.history.push({ undo: diffDocuments(next, before), redo: ops, label });
        if (this.history.length > 100)
            this.history.shift();
        this.future = [];
    } this.document = next; this.dispatchEvent(new CustomEvent('change', { detail: { ops, label, local: true } })); }
    replace(document, remote = false) { this.document = validateDocument(structuredClone(document), this.registry); if (!remote) {
        this.history = [];
        this.future = [];
    } this.dispatchEvent(new CustomEvent('change', { detail: { remote, local: false } })); }
    undo() { const h = this.history.pop(); if (!h)
        return; try {
        this.commit(h.undo, 'Undo ' + h.label, false);
        this.future.push(h);
    }
    catch (e) {
        this.history.push(h);
        throw e;
    } }
    redo() { const h = this.future.pop(); if (!h)
        return; try {
        this.commit(h.redo, 'Redo ' + h.label, false);
        this.history.push(h);
    }
    catch (e) {
        this.future.push(h);
        throw e;
    } }
}
