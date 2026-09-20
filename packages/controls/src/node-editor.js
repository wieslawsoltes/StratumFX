const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const categoryColors = { Create: '#6b9cc4', Terrain: '#70ac94', Modify: '#8c91be', Material: '#d5ac64', Populate: '#7abac0', Utility: '#99a5af', Simulation: '#c27b78', Import: '#aa8cb6' };
const STYLE = `:host{display:block;position:relative;height:100%;min-height:100px;overflow:hidden;user-select:none;background:var(--graph-bg,#191d22);color:var(--text,#d3d6da);font:12px system-ui}svg{width:100%;height:100%;display:block;touch-action:none;outline:none}.grid{opacity:.2}.node{cursor:grab}.body{fill:var(--node-bg,#353b43);stroke:#505861;stroke-width:1}.node.selected .body{stroke:#e7aa4c;stroke-width:2}.node.bypassed .body{stroke-dasharray:4 3;opacity:.45}.node text{pointer-events:none;fill:var(--text,#d3d6da)}.node .kind{fill:var(--muted,#98a1ac);font-size:9px}.port{fill:#20272d;stroke:#a9b2bd;stroke-width:1.2;cursor:crosshair}.port:hover{fill:#efb452;stroke:#efb452}.wire{fill:none;stroke:#8396a1;stroke-width:1.7;pointer-events:stroke;cursor:pointer}.wire:hover{stroke:#efb452;stroke-width:3}.display-flag{fill:#24788f;cursor:pointer}.display-flag.on{fill:#59bfd0}.temp{fill:none;stroke:#edb55f;stroke-width:2;stroke-dasharray:5 4;pointer-events:none}.note{fill:#d3b06c;opacity:.7;font:10px system-ui}.minimap{position:absolute;right:12px;bottom:13px;width:126px;height:73px;border:1px solid #46505a;background:#1e242bcc;border-radius:4px;pointer-events:none}.empty{position:absolute;inset:35% 0 auto;text-align:center;pointer-events:none;color:var(--muted,#89939d)}.empty b{display:block;color:var(--text,#d3d6da);margin-bottom:8px}.hint{position:absolute;left:14px;bottom:11px;pointer-events:none;color:#76818d;font-size:10px}.selection-box{fill:#e0ae5220;stroke:#e0ae52;stroke-width:1}.cursor text{font-size:10px;fill:#f8dea9}.cursor path{fill:#dca54f}.toolbar{position:absolute;top:9px;right:10px;display:flex;gap:3px}.toolbar button{background:#272e36;border:1px solid #424a53;color:#c5cbd2;border-radius:3px;padding:3px 7px;cursor:pointer}.toolbar button:hover{color:#efb452}`;
export class NodeEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._doc = { nodes: [], outputId: null }; this.definitions = new Map(); this.selected = new Set(); this.pan = { x: 70, y: 35 }; this.zoom = .88; this.presence = []; this.shadowRoot.innerHTML = `<style>${STYLE}</style><svg tabindex="0" role="application" aria-label="Procedural node graph"><defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#84909f"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)" class="grid"/><g id="world"></g><g id="overlay"></g></svg><div class="empty" hidden><b>Build something procedural.</b>Press Tab to add your first node.</div><div class="hint">TAB add node · drag ports to connect · F frame · wheel zoom</div><div class="toolbar"><button title="Frame all nodes (F)" data-command="frame">⌖</button><button title="Auto-layout" data-command="layout">☷</button></div><svg class="minimap" viewBox="0 0 200 115"></svg>`; this.svg = this.shadowRoot.querySelector('svg'); this.world = this.shadowRoot.getElementById('world'); this.overlay = this.shadowRoot.getElementById('overlay'); this.bind(); }
    set document(doc) { this._doc = doc; this.draw(); }
    get document() { return this._doc; }
    set registry(registry) { this.definitions = new Map(registry.list().map(d => [d.type, d])); this.draw(); }
    select(ids) { this.selected = new Set(ids); this.draw(); }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
    point(e) { const r = this.svg.getBoundingClientRect(); return { x: (e.clientX - r.left - this.pan.x) / this.zoom, y: (e.clientY - r.top - this.pan.y) / this.zoom }; }
    portPosition(node, slot, output = false) { const def = this.definitions.get(node.type); return { x: node.x + (output ? 80 : 160 * (slot + 1) / ((def?.inputs || 1) + 1)), y: node.y + (output ? 44 : 0) }; }
    wire(a, b) { return `M${a.x},${a.y} C${a.x},${a.y + Math.max(28, Math.abs(b.y - a.y) * .5)} ${b.x},${b.y - Math.max(28, Math.abs(b.y - a.y) * .5)} ${b.x},${b.y}`; }
    draw() { if (!this.world)
        return; const nodes = this._doc.nodes, map = new Map(nodes.map(n => [n.id, n])); this.world.setAttribute('transform', `translate(${this.pan.x},${this.pan.y}) scale(${this.zoom})`); let html = ''; for (const n of nodes)
        n.inputs.forEach((id, slot) => { if (!id || !map.has(id))
            return; const a = this.portPosition(map.get(id), 0, true), b = this.portPosition(n, slot); html += `<path class="wire" d="${this.wire(a, b)}" data-destination="${escapeHTML(n.id)}" data-slot="${slot}"><title>Double-click to disconnect</title></path>`; }); for (const n of nodes) {
        const d = this.definitions.get(n.type), c = categoryColors[d?.category] || '#99a5af';
        html += `<g class="node ${this.selected.has(n.id) ? 'selected' : ''} ${n.bypass ? 'bypassed' : ''}" data-node="${escapeHTML(n.id)}" transform="translate(${n.x},${n.y})"><rect class="body" width="160" height="44" rx="4"/><path d="M4 0 H156 Q160 0 160 4 V4 H0 V4 Q0 0 4 0" fill="${c}"/><rect x="1" y="5" width="33" height="38" rx="3" fill="${c}" opacity=".14"/><text x="17" y="29" text-anchor="middle" style="font-size:19px;fill:${c}">${escapeHTML(d?.icon || '◇')}</text><text x="42" y="22" font-size="11">${escapeHTML(n.name.length > 15 ? n.name.slice(0, 14) + '…' : n.name)}</text><text x="42" y="36" class="kind">${escapeHTML(d?.label || n.type)}</text><rect x="151" y="5" width="8" height="38" rx="2" class="display-flag ${this._doc.outputId === n.id ? 'on' : ''}" data-display="${escapeHTML(n.id)}"><title>Display this node</title></rect>`;
        for (let k = 0; k < (d?.inputs || 0); k++)
            html += `<circle class="port" cx="${160 * (k + 1) / (d.inputs + 1)}" cy="0" r="4" data-input="${escapeHTML(n.id)}" data-slot="${k}"><title>Input ${k + 1}${n.inputs[k] ? ' · Alt-click to disconnect' : ''}</title></circle>`;
        html += `<circle class="port" cx="80" cy="44" r="4" data-output="${escapeHTML(n.id)}"><title>Output · drag to connect</title></circle></g>`;
    } this.world.innerHTML = html; this.shadowRoot.querySelector('.empty').hidden = nodes.length > 0; this.drawMinimap(); this.drawPresence(); }
    drawMinimap() { const mini = this.shadowRoot.querySelector('.minimap'), nodes = this._doc.nodes; if (!nodes.length) {
        mini.innerHTML = '';
        return;
    } const minX = Math.min(...nodes.map(n => n.x)) - 40, minY = Math.min(...nodes.map(n => n.y)) - 40, maxX = Math.max(...nodes.map(n => n.x + 160)) + 40, maxY = Math.max(...nodes.map(n => n.y + 44)) + 40, s = Math.min(200 / (maxX - minX), 115 / (maxY - minY)); let h = nodes.map(n => `<rect x="${(n.x - minX) * s}" y="${(n.y - minY) * s}" width="${160 * s}" height="${44 * s}" rx="1" fill="${this.selected.has(n.id) ? '#dbaa56' : '#667984'}"/>`).join(''); const r = this.svg.getBoundingClientRect(); h += `<rect x="${(-this.pan.x / this.zoom - minX) * s}" y="${(-this.pan.y / this.zoom - minY) * s}" width="${r.width / this.zoom * s}" height="${r.height / this.zoom * s}" fill="none" stroke="#9cabb9" stroke-width="1"/>`; mini.innerHTML = h; }
    drawPresence() { this.overlay.innerHTML = this.presence.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => `<g class="cursor" transform="translate(${p.x * this.zoom + this.pan.x},${p.y * this.zoom + this.pan.y})"><path d="M0 0 L0 14 L4 10 L9 10 Z"/><text x="11" y="14">${escapeHTML(p.name)}</text></g>`).join(''); }
    frame() { const ns = this._doc.nodes; if (!ns.length) {
        this.pan = { x: 70, y: 35 };
        this.zoom = .9;
        this.draw();
        return;
    } const r = this.svg.getBoundingClientRect(), x = Math.min(...ns.map(n => n.x)), y = Math.min(...ns.map(n => n.y)), w = Math.max(...ns.map(n => n.x + 160)) - x, h = Math.max(...ns.map(n => n.y + 44)) - y; this.zoom = Math.max(.18, Math.min(1.1, (r.width - 90) / w, (r.height - 75) / h)); this.pan = { x: (r.width - w * this.zoom) / 2 - x * this.zoom, y: (r.height - h * this.zoom) / 2 - y * this.zoom - 5 }; this.draw(); }
    autoLayout() { const map = new Map(this._doc.nodes.map(n => [n.id, n])), levels = new Map(); const level = id => { if (levels.has(id))
        return levels.get(id); const n = map.get(id), v = Math.max(-1, ...n.inputs.filter(Boolean).map(level)) + 1; levels.set(id, v); return v; }; const rows = new Map(), moves = []; for (const n of this._doc.nodes) {
        const l = level(n.id), i = rows.get(l) || 0;
        rows.set(l, i + 1);
        moves.push({ id: n.id, x: 70 + i * 220, y: 40 + l * 104 });
    } this.emit('nodes-move', moves); requestAnimationFrame(() => this.frame()); }
    bind() { let drag = null; this.shadowRoot.querySelectorAll('[data-command]').forEach(b => b.onclick = () => b.dataset.command === 'frame' ? this.frame() : this.autoLayout()); this.svg.addEventListener('contextmenu', e => { e.preventDefault(); this.emit('request-add', this.point(e)); }); this.svg.addEventListener('pointerdown', e => { this.svg.focus(); const t = e.target, point = this.point(e), id = t.closest('[data-node]')?.dataset.node; if (t.dataset.display) {
        this.emit('node-display', { id: t.dataset.display });
        return;
    } if (t.dataset.input && e.altKey) {
        this.emit('nodes-connect', { sourceId: null, nodeId: t.dataset.input, slot: +t.dataset.slot });
        return;
    } if (t.dataset.output) {
        drag = { type: 'wire', id: t.dataset.output, from: this.portPosition(this._doc.nodes.find(n => n.id === t.dataset.output), 0, true) };
        this.svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
    } if (t.dataset.input)
        return; if (id && e.button === 0) {
        if (e.shiftKey) {
            if (this.selected.has(id))
                this.selected.delete(id);
            else
                this.selected.add(id);
        }
        else if (!this.selected.has(id))
            this.selected = new Set([id]);
        this.emit('nodes-select', [...this.selected]);
        drag = { type: 'node', point, positions: this._doc.nodes.filter(n => this.selected.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })), moved: false };
        this.draw();
    }
    else if (e.button === 1 || e.button === 2 || e.altKey) {
        drag = { type: 'pan', x: e.clientX, y: e.clientY, pan: { ...this.pan } };
    }
    else if (e.button === 0) {
        drag = { type: 'marquee', point, shift: e.shiftKey };
        if (!e.shiftKey) {
            this.selected.clear();
            this.emit('nodes-select', []);
            this.draw();
        }
    } if (drag && drag.type !== 'wire')
        this.svg.setPointerCapture(e.pointerId); }); this.svg.addEventListener('pointermove', e => { const p = this.point(e); this.emit('graph-pointer', p); if (!drag)
        return; if (drag.type === 'node') {
        const dx = p.x - drag.point.x, dy = p.y - drag.point.y;
        if (Math.hypot(dx, dy) > 2)
            drag.moved = true;
        this._doc = { ...this._doc, nodes: this._doc.nodes.map(n => { const pos = drag.positions.find(p => p.id === n.id); return pos ? { ...n, x: pos.x + dx, y: pos.y + dy } : n; }) };
        this.draw();
    }
    else if (drag.type === 'pan') {
        this.pan = { x: drag.pan.x + e.clientX - drag.x, y: drag.pan.y + e.clientY - drag.y };
        this.draw();
    }
    else if (drag.type === 'wire') {
        this.world.querySelector('.temp')?.remove();
        this.world.insertAdjacentHTML('beforeend', `<path class="temp" d="${this.wire(drag.from, p)}"/>`);
    }
    else if (drag.type === 'marquee') {
        const a = drag.point;
        this.world.querySelector('.selection-box')?.remove();
        this.world.insertAdjacentHTML('beforeend', `<rect class="selection-box" x="${Math.min(a.x, p.x)}" y="${Math.min(a.y, p.y)}" width="${Math.abs(a.x - p.x)}" height="${Math.abs(a.y - p.y)}"/>`);
    } }); const up = e => { if (!drag)
        return; if (drag.type === 'wire') {
        const t = this.shadowRoot.elementFromPoint(e.clientX, e.clientY);
        if (t?.dataset.input)
            this.emit('nodes-connect', { sourceId: drag.id, nodeId: t.dataset.input, slot: +t.dataset.slot });
        this.world.querySelector('.temp')?.remove();
    } if (drag.type === 'node' && drag.moved)
        this.emit('nodes-move', this._doc.nodes.filter(n => this.selected.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y }))); if (drag.type === 'marquee') {
        const p = this.point(e), a = drag.point;
        for (const n of this._doc.nodes)
            if (n.x + 160 >= Math.min(p.x, a.x) && n.x <= Math.max(p.x, a.x) && n.y + 44 >= Math.min(p.y, a.y) && n.y <= Math.max(p.y, a.y))
                this.selected.add(n.id);
        this.emit('nodes-select', [...this.selected]);
        this.draw();
    } drag = null; }; this.svg.addEventListener('pointerup', up); this.svg.addEventListener('pointercancel', () => { drag = null; this.draw(); }); this.svg.addEventListener('dblclick', e => { if (e.target.dataset.destination)
        this.emit('nodes-connect', { nodeId: e.target.dataset.destination, sourceId: null, slot: +e.target.dataset.slot });
    else {
        const id = e.target.closest('[data-node]')?.dataset.node;
        if (id)
            this.emit('node-display', { id });
        else
            this.emit('request-add', this.point(e));
    } }); this.svg.addEventListener('wheel', e => { e.preventDefault(); const p = this.point(e), r = this.svg.getBoundingClientRect(), z = Math.max(.15, Math.min(2, this.zoom * Math.exp(-e.deltaY * .001))); this.zoom = z; this.pan = { x: e.clientX - r.left - p.x * z, y: e.clientY - r.top - p.y * z }; this.draw(); }, { passive: false }); this.svg.addEventListener('keydown', e => { if (e.key === 'Tab') {
        e.preventDefault();
        this.emit('request-add', { x: 100, y: 100 });
    } if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.frame();
    } if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.emit('nodes-delete', [...this.selected]);
    } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.emit('nodes-duplicate', [...this.selected]);
    } }); }
}
if (!customElements.get('stratum-node-editor'))
    customElements.define('stratum-node-editor', NodeEditor);
