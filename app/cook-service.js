import { Engine } from '../packages/core/src/graph.js';
import { Mesh } from '../packages/geometry/src/mesh.js';
/** Worker isolation keeps node evaluation out of the input/render thread. */
export class CookService {
    constructor() { this.pending = new Map(); this.serial = 0; this.engine = new Engine(); try {
        const source = globalThis.STRATUM_WORKER_SOURCE;
        this.blob = source ? URL.createObjectURL(new Blob([source], { type: 'text/javascript' })) : null;
        this.worker = new Worker(this.blob || new URL('../packages/core/src/cook-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => { const job = this.pending.get(data.id); if (!job)
            return; this.pending.delete(data.id); if (data.error)
            job.reject(Error(data.error));
        else
            job.resolve({ mesh: new Mesh(data.mesh.positions, data.mesh.indices, data.mesh), stats: data.stats }); };
        this.worker.onerror = () => { this.worker.terminate(); this.worker = null; for (const job of this.pending.values()) {
            try {
                job.resolve(this.engine.cook(job.document, job.frame, job.outputId));
            }
            catch (e) {
                job.reject(e);
            }
        } this.pending.clear(); };
    }
    catch {
        this.worker = null;
    } }
    cook(document, frame, outputId = document.outputId) { if (!this.worker)
        return Promise.resolve().then(() => this.engine.cook(document, frame, outputId)); const id = ++this.serial; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, document, frame, outputId }); this.worker.postMessage({ id, document, frame, outputId }); }); }
    clear() { this.engine.clear(); this.worker?.postMessage({ type: 'clear' }); }
    destroy() { this.worker?.terminate(); if (this.blob)
        URL.revokeObjectURL(this.blob); for (const job of this.pending.values())
        job.reject(Error('Cook service disposed')); this.pending.clear(); }
}
