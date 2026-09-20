/** IndexedDB project and checkpoint persistence. Does not store account credentials. */
export class ProjectDatabase {
    constructor(name = 'stratum-fx-v1') { this.name = name; this.ready = null; }
    open() { if (this.ready)
        return this.ready; this.ready = new Promise((resolve, reject) => { if (!globalThis.indexedDB)
        return reject(Error('IndexedDB is unavailable; export your project to save it.')); const request = indexedDB.open(this.name, 1); request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('projects', { keyPath: 'id' }); const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' }); snapshots.createIndex('project', 'projectId'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); return this.ready; }
    async transaction(store, mode, work) { const db = await this.open(); return new Promise((resolve, reject) => { const tx = db.transaction(store, mode); let result; try {
        const req = work(tx.objectStore(store));
        if (req)
            req.onsuccess = () => result = req.result;
    }
    catch (e) {
        reject(e);
        return;
    } tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Storage transaction aborted')); }); }
    save(document) { return this.transaction('projects', 'readwrite', s => s.put({ id: document.id, title: document.title, updated: Date.now(), document: structuredClone(document) })); }
    async list() { const records = await this.transaction('projects', 'readonly', s => s.getAll()); return records.sort((a, b) => b.updated - a.updated); }
    async get(id) { return (await this.transaction('projects', 'readonly', s => s.get(id)))?.document; }
    delete(id) { return this.transaction('projects', 'readwrite', s => s.delete(id)); }
    checkpoint(document, label = 'Checkpoint') { const id = crypto.randomUUID(); return this.transaction('snapshots', 'readwrite', s => s.put({ id, projectId: document.id, label, created: Date.now(), document: structuredClone(document) })); }
    async checkpoints(projectId) { const rows = await this.transaction('snapshots', 'readonly', s => s.index('project').getAll(projectId)); return rows.sort((a, b) => b.created - a.created); }
}
