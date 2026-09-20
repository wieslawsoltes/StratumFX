const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STYLE = `:host{display:block;color:var(--text,#d3d7dc);font:11px system-ui}.head{display:flex;align-items:center;gap:10px;padding:17px 15px 13px;border-bottom:1px solid var(--border,#3b4149)}.icon{font-size:23px;color:#e4b565}.head strong{display:block;font-size:12px;font-weight:600}.head small{color:var(--muted,#929ba7);font-size:10px;display:block;margin-top:3px}.name{margin:13px 13px 8px;display:grid;grid-template-columns:75px 1fr;align-items:center;gap:8px}.toggles{display:flex;gap:17px;padding:4px 14px 13px;color:var(--muted,#a0a8b3)}.tabs{display:flex;padding:0 14px;border-bottom:1px solid var(--border,#3b4149);gap:22px}.tabs span{padding:9px 0;color:#e4b565;border-bottom:2px solid #e4b565}.section{padding:13px 14px 10px;color:var(--muted,#919aa4);font-size:9px;font-weight:600;letter-spacing:1px}.row{display:grid;grid-template-columns:96px 1fr 18px;gap:7px;padding:7px 13px;align-items:center}.row>label{color:var(--muted,#a7afb8);text-align:right;font-size:10px;line-height:1.35}.row input,.row select,.name input,.row textarea{width:100%;box-sizing:border-box;min-width:0;background:var(--input,#20252b);color:var(--text,#d9dde2);border:1px solid var(--border,#434952);border-radius:3px;height:26px;padding:3px 7px;font:11px ui-monospace,SFMono-Regular,monospace;outline:none}.row input:focus,.name input:focus,.row textarea:focus{border-color:#be975a;box-shadow:0 0 0 1px #be975a33}.vector{display:flex;gap:4px}.vector input{padding:3px 4px;text-align:center}.row input[type=range]{height:16px;padding:0;accent-color:#bd995f;border:0;background:transparent}.numeric{display:grid;grid-template-columns:1fr 75px;gap:8px;align-items:center}.row input[type=color]{padding:2px;max-width:48px}.colors{display:flex;align-items:center;gap:10px}.hex{color:var(--muted,#999);font:10px monospace}.key{border:0;background:none;color:#656e7b;padding:0;cursor:pointer;font-size:13px}.key.active{color:#e6b34f}.row textarea{min-height:70px;resize:vertical;padding:8px;font-size:10px}.help{margin:18px 14px;border-top:1px solid var(--border,#363d45);padding-top:14px;font-size:10px;line-height:1.7;color:var(--muted,#87919d)}.empty{padding:36px 20px;text-align:center;color:var(--muted,#87919d);line-height:1.8}.empty b{color:var(--text,#c7ced6);display:block}.anim{color:#74b398!important}.toggles input{accent-color:#d8ae67}`;
export class ParameterEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.frame = 1; this.shadowRoot.addEventListener('change', e => this.change(e)); this.shadowRoot.addEventListener('click', e => { const b = e.target.closest('[data-keyframe]'); if (b)
        this.emit('parameter-keyframe', { key: b.dataset.keyframe, remove: e.shiftKey }); }); }
    setData(node, definition, frame = 1, values = {}) { this.values = values; this.node = node; this.definition = definition; this.frame = frame; this.draw(); }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
    draw() { const n = this.node, d = this.definition; if (!n) {
        this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="empty"><b>Nothing selected</b>Select a node to inspect its parameters.<br>Every change updates the procedural recipe.</div>`;
        return;
    } let h = `<style>${STYLE}</style><div class="head"><span class="icon">${esc(d.icon)}</span><div><strong>${esc(d.label)}</strong><small>${esc(d.category)} · geometry operator</small></div></div><div class="name"><label>Node name</label><input data-name value="${esc(n.name)}" maxlength="100" aria-label="Node name"></div><div class="toggles"><label><input type="checkbox" data-bypass ${n.bypass ? 'checked' : ''}> Bypass</label><label><input type="checkbox" data-display ${this.isOutput ? 'checked' : ''}> Display output</label></div><div class="tabs"><span>Parameters</span></div><div class="section">${esc(d.category.toUpperCase())} SETTINGS</div>`; for (const [key, spec] of Object.entries(d.params)) {
        const v = this.values?.[key] ?? n.params[key] ?? spec.default, animated = !!n.keyframes?.[key]?.length;
        let field = '';
        const common = `data-param="${key}" aria-label="${esc(spec.label)}"`;
        if (spec.type === 'number') {
            const numeric = typeof v === 'number';
            field = `<div class="numeric"><input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${numeric ? v : spec.default}" ${common} data-slider title="${esc(spec.label)}"><input type="text" value="${esc(v)}" ${common} class="${animated ? 'anim' : ''}" title="Number or safe expression, e.g. =sin(t)*2"></div>`;
        }
        else if (spec.type === 'vector')
            field = `<div class="vector">${v.map((x, i) => `<input type="text" data-axis="${i}" ${common} value="${esc(x)}" title="${'XYZ'[i]}">`).join('')}</div>`;
        else if (spec.type === 'enum')
            field = `<select ${common}>${spec.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        else if (spec.type === 'boolean')
            field = `<input type="checkbox" ${common} ${v ? 'checked' : ''} style="width:15px">`;
        else if (spec.type === 'color')
            field = `<div class="colors"><input type="color" ${common} value="${v}"><span class="hex">${v.toUpperCase()}</span></div>`;
        else if (key === 'source')
            field = `<textarea ${common} spellcheck="false" placeholder="Paste OBJ vertices and faces">${esc(v)}</textarea>`;
        else
            field = `<input type="text" ${common} value="${esc(v)}" spellcheck="false">`;
        h += `<div class="row"><label>${esc(spec.label)}</label>${field}${spec.type === 'number' ? `<button class="key ${animated ? 'active' : ''}" data-keyframe="${key}" title="Set keyframe at frame ${this.frame}; Shift-click removes it">◆</button>` : '<span></span>'}</div>`;
    } h += `<div class="help">${d.inputs ? `Receives geometry from ${d.inputs} input${d.inputs > 1 ? 's' : ''}.` : 'Generates geometry procedurally.'}<br>Numeric fields accept <code>=sin(t) * 2</code>.<br><b>t</b> = seconds · <b>f</b> = frame · ◆ = keyframe${n.type === 'cloth' ? '<br>Cloth simulation range: 0–15 seconds.' : n.type === 'rigid' ? '<br>Rigid simulation range: 0–20 seconds.' : ''}</div>`; this.shadowRoot.innerHTML = h; }
    change(e) { const el = e.target; if (el.hasAttribute('data-name'))
        return this.emit('node-rename', { value: el.value }); if (el.hasAttribute('data-bypass'))
        return this.emit('node-bypass', { value: el.checked }); if (el.hasAttribute('data-display'))
        return this.emit('node-display', { id: el.checked ? this.node.id : null }); const key = el.dataset.param; if (!key)
        return; const spec = this.definition.params[key]; let value = spec.type === 'boolean' ? el.checked : el.value; if (spec.type === 'number')
        value = value.startsWith('=') ? value : Number(value); if (spec.type === 'vector') {
        value = [...this.node.params[key]];
        value[+el.dataset.axis] = el.value.startsWith('=') ? el.value : Number(el.value);
    } this.emit('parameter-change', { key, value }); }
}
if (!customElements.get('stratum-parameter-editor'))
    customElements.define('stratum-parameter-editor', ParameterEditor);
