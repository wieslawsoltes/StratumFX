import { applyOperations, uuid } from '../../core/src/graph.js';
/** Server-ordered operation replication over SSE + JSON POST. Field-level merging, not a CRDT. */
export class CollaborationClient extends EventTarget {
    constructor(store, { baseURL = '' } = {}) { super(); this.store = store; this.baseURL = baseURL; this.clientId = uuid(); this.pending = []; this.rejected = []; this.user = null; this.role = null; this.projectId = null; this.revision = 0; this.status = 'offline'; this.inFlight = false; this.retryDelay = 1000; this.epoch = 0; this.listener = e => { if (e.detail.local && this.projectId) {
        if (this.role === 'viewer') {
            this.reconcile();
            this.emit('error', 'This project is read-only for your account.');
            return;
        }
        this.pending.push({ id: uuid(), ops: e.detail.ops, created: Date.now() });
        try {
            this.persist();
        }
        catch (error) {
            this.emit('error', 'Offline queue could not be saved. Keep this tab open and export the scene. ' + error.message);
        }
        this.emit('queue', this.pending.length);
        this.pump();
    } }; store.addEventListener('change', this.listener); }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    async request(path, body, method = body ? 'POST' : 'GET') { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000); try {
        const r = await fetch(this.baseURL + '/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
        const text = await r.text();
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw Error('Collaboration backend is not running. Launch the Node server to use team projects.');
        }
        if (!r.ok) {
            const error = Error(data.error || `Request failed (${r.status})`);
            error.status = r.status;
            throw error;
        }
        return data;
    }
    finally {
        clearTimeout(timer);
    } }
    async session() { const result = await this.request('/session'); this.user = result.user; return result; }
    async register(name, password) { const r = await this.request('/register', { name, password }); this.user = r.user; return r; }
    async login(name, password) { const r = await this.request('/login', { name, password }); this.user = r.user; return r; }
    async logout() { this.disconnect(); await this.request('/logout', {}); this.user = null; }
    projects() { return this.request('/projects'); }
    async create(document) { const result = await this.request('/projects', { document }); await this.connect(result.id); return result; }
    async join(code) { const result = await this.request('/join', { code }); await this.connect(result.id); return result; }
    key() { return `stratum-queue:${this.user?.id}:${this.projectId}`; }
    persist() { if (this.projectId)
        localStorage.setItem(this.key(), JSON.stringify(this.pending)); }
    async connect(id) { this.disconnect(); const epoch = this.epoch; const state = await this.request('/projects/' + encodeURIComponent(id)); if (epoch !== this.epoch)
        return; this.store.history = []; this.store.future = []; this.projectId = id; this.role = state.role; this.authoritative = state.document; this.revision = state.revision; try {
        this.pending = JSON.parse(localStorage.getItem(this.key()) || '[]');
        if (!Array.isArray(this.pending))
            this.pending = [];
    }
    catch {
        this.pending = [];
    } this.reconcile(); this.status = 'connecting'; this.emit('status', this.status); this.events = new EventSource(this.baseURL + `/api/projects/${encodeURIComponent(id)}/events?client=${this.clientId}`, { withCredentials: true }); this.events.onopen = () => { if (epoch !== this.epoch)
        return; this.status = 'online'; this.retryDelay = 1000; this.emit('status', this.status); this.pump(); }; this.events.onerror = () => { if (epoch !== this.epoch)
        return; this.status = 'reconnecting'; this.emit('status', this.status); }; this.events.addEventListener('message', e => { if (epoch !== this.epoch)
        return; try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
            if (msg.revision >= this.revision) {
                this.authoritative = msg.document;
                this.revision = msg.revision;
                this.role = msg.role;
                this.reconcile();
            }
            this.pump();
        }
        else if (msg.type === 'commit') {
            this.emit('activity', msg);
            const index = this.pending.findIndex(p => p.id === msg.id);
            if (index >= 0) {
                this.pending.splice(index, 1);
                this.persist();
            }
            if (msg.revision === this.revision + 1) {
                this.authoritative = applyOperations(this.authoritative, msg.ops, this.store.registry);
                this.revision = msg.revision;
                this.reconcile();
            }
            else if (msg.revision > this.revision + 1)
                this.resync();
            this.emit('queue', this.pending.length);
        }
        else if (msg.type === 'presence')
            this.emit('presence', msg.users.filter(p => p.clientId !== this.clientId));
        else if (msg.type === 'membership')
            this.resync();
    }
    catch (error) {
        this.emit('error', error.message);
        this.resync();
    } }); this.emit('connected', { id, role: this.role }); }
    async resync() { if (!this.projectId)
        return; const epoch = this.epoch, project = this.projectId; try {
        const state = await this.request('/projects/' + project);
        if (epoch !== this.epoch)
            return;
        if (state.revision >= this.revision) {
            this.authoritative = state.document;
            this.revision = state.revision;
            this.role = state.role;
            this.reconcile();
        }
    }
    catch (e) {
        if (epoch === this.epoch)
            this.emit('error', e.message);
    } }
    reconcile() { if (!this.authoritative)
        return; let doc = this.authoritative; for (const batch of this.pending) {
        try {
            doc = applyOperations(doc, batch.ops, this.store.registry);
        }
        catch (e) {
            this.emit('conflict', { batch, error: e.message });
        }
    } this.store.replace(doc, true); }
    async pump() { if (this.inFlight || !this.projectId || !this.pending.length || this.role === 'viewer')
        return; this.inFlight = true; const batch = this.pending[0], project = this.projectId, epoch = this.epoch; try {
        const state = await this.request(`/projects/${project}/operations`, { id: batch.id, ops: batch.ops });
        if (epoch !== this.epoch)
            return;
        this.pending = this.pending.filter(p => p.id !== batch.id);
        if (state.revision >= this.revision) {
            this.authoritative = state.document;
            this.revision = state.revision;
        }
        this.persist();
        this.reconcile();
        this.retryDelay = 1000;
    }
    catch (error) {
        if (epoch !== this.epoch)
            return;
        if (error.status && error.status < 500 && error.status !== 429 && error.status !== 401) {
            this.pending = this.pending.filter(p => p.id !== batch.id);
            this.rejected.push({ ...batch, error: error.message });
            try {
                localStorage.setItem(`stratum-rejected:${project}`, JSON.stringify(this.rejected));
                this.persist();
            }
            catch { }
            this.emit('conflict', { batch, error: error.message });
            this.reconcile();
        }
        else {
            this.status = 'reconnecting';
            this.emit('status', this.status);
            clearTimeout(this.retry);
            this.retry = setTimeout(() => this.pump(), this.retryDelay);
            this.retryDelay = Math.min(this.retryDelay * 2, 30000);
            this.inFlight = false;
            return;
        }
    }
    finally {
        if (epoch === this.epoch) {
            this.inFlight = false;
            this.emit('queue', this.pending.length);
        }
    } if (epoch === this.epoch && this.pending.length)
        queueMicrotask(() => this.pump()); }
    presence(point) { if (!this.projectId || this.status !== 'online')
        return; const now = Date.now(); if (now - (this.lastPresence || 0) < 100)
        return; this.lastPresence = now; this.request(`/projects/${this.projectId}/presence`, { clientId: this.clientId, x: point.x, y: point.y }).catch(() => { }); }
    invitation(role = 'editor') { return this.request(`/projects/${this.projectId}/invite`, { role }); }
    members() { return this.request(`/projects/${this.projectId}/members`); }
    setRole(userId, role) { return this.request(`/projects/${this.projectId}/members`, { userId, role }, 'PATCH'); }
    checkpoint(label) { return this.request(`/projects/${this.projectId}/checkpoints`, { label }); }
    checkpoints() { return this.request(`/projects/${this.projectId}/checkpoints`); }
    restore(id) { return this.request(`/projects/${this.projectId}/checkpoints/${id}/restore`, {}); }
    disconnect() { this.epoch++; this.inFlight = false; this.authoritative = null; if (this.projectId) {
        try {
            this.persist();
        }
        catch { }
    } this.events?.close(); this.events = null; clearTimeout(this.retry); this.projectId = null; this.role = null; this.pending = []; this.status = 'offline'; this.emit('status', this.status); this.emit('presence', []); }
    destroy() { this.disconnect(); this.store.removeEventListener('change', this.listener); }
}
