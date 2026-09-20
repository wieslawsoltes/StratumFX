import { Engine, GraphStore, createDocument, createNode, applyOperations, validateDocument, uuid } from '../packages/core/src/graph.js';
import { defaultRegistry } from '../packages/core/src/nodes.js';
import { sampleKeys, evaluateExpression } from '../packages/core/src/expression.js';
import { Mesh, realize, exportOBJ, exportSTL, importOBJ } from '../packages/geometry/src/mesh.js';
import { transformPoint, clamp } from '../packages/geometry/src/math.js';
import { Viewport } from '../packages/renderer/src/renderer.js';
import { NodeEditor, categoryColors } from '../packages/controls/src/node-editor.js';
import { ParameterEditor } from '../packages/controls/src/parameter-editor.js';
import { Timeline } from '../packages/controls/src/timeline.js';
import { ProjectDatabase } from '../packages/collaboration/src/storage.js';
import { CollaborationClient } from '../packages/collaboration/src/client.js';
import { CookService } from './cook-service.js';
import { preset, presetList } from './presets.js';
const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), fmt = n => new Intl.NumberFormat().format(n), db = new ProjectDatabase(), cookService = new CookService(), params = new URLSearchParams(location.search);
let initial = preset(params.get('preset') || 'basalt');
if (!params.has('fresh') && !params.has('preset')) {
    try {
        const saved = await db.get(localStorage.getItem('stratum-active'));
        if (saved)
            initial = validateDocument(saved);
    }
    catch { }
}
const store = new GraphStore(initial), collab = new CollaborationClient(store), graph = $('graph'), inspector = $('parameters'), timeline = $('timeline');
graph.registry = defaultRegistry;
let selection = new Set(initial.nodes.find(n => n.id === 'copy') ? ['copy'] : initial.nodes.length ? [initial.nodes.at(-1).id] : []), frame = initial.start, currentMesh = new Mesh(), stats = null, activeBottom = 'network', sheetMode = 'points', sheetPage = 0, shelfCategory = 'Create', cookBusy = false, cookQueued = null, cookVersion = 0, saveTimer = null, tool = 'orbit', viewport = null, playingLast = 0, playingAccumulator = 0, addPosition = null, operatorIndex = 0, filteredOperators = [], activePane = 'viewport', gizmoDrag = null, recentActivity = [];
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, error ? 6500 : 3000); }
function status(message) { $('status-message').textContent = message; }
function run(fn) { try {
    const r = fn();
    if (r && typeof r.catch === 'function')
        r.catch(e => { toast(e.message, true); status(e.message); });
    return r;
}
catch (e) {
    toast(e.message, true);
    status(e.message);
} }
function editable() { if (collab.projectId && collab.role === 'viewer')
    throw Error('This team project is read-only for your account.'); }
function commit(ops, label) { editable(); store.commit(ops, label); }
function selectedNode() { return store.document.nodes.find(n => selection.has(n.id)); }
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function filename(extension) { return store.document.title.replace(/[^\w\-. ]/g, '').replace(/\s+/g, '-').toLowerCase() + extension; }
function showDialog(title, html, wide = false) { $('dialog-title').textContent = title; $('dialog-content').innerHTML = html; $('dialog').classList.toggle('wide', wide); if (!$('dialog').open)
    $('dialog').showModal(); }
function closeDialog() { $('dialog').close(); }
function setSelection(ids) { selection = new Set(ids.filter(id => store.document.nodes.some(n => n.id === id))); graph.select(selection); drawInspector(); drawTree(); drawAnimation(); $('selection-count').textContent = selection.size ? `${selection.size} selected` : 'No selection'; updateGizmo(); }
function drawInspector() { const n = selectedNode(); inspector.isOutput = n?.id === store.document.outputId; const values = Object.fromEntries(Object.entries(n?.keyframes || {}).filter(([, keys]) => keys.length).map(([key, keys]) => [key, sampleKeys(keys, frame, n.params[key])])); inspector.setData(n, n ? defaultRegistry.get(n.type) : null, frame, values); }
function drawTree() { const filter = $('tree-search').value.toLowerCase(), nodes = store.document.nodes.filter(n => n.name.toLowerCase().includes(filter) || n.type.includes(filter)); $('scene-tree').innerHTML = `<div class="tree-root">⌄ &nbsp;◈ &nbsp; scene <span class="muted">/ geometry</span></div>` + nodes.map(n => { const d = defaultRegistry.get(n.type); return `<div class="tree-row ${selection.has(n.id) ? 'selected' : ''}" data-node="${esc(n.id)}" role="treeitem" tabindex="0" aria-selected="${selection.has(n.id)}"><span class="tree-icon" style="color:${categoryColors[d.category]}">${esc(d.icon)}</span><span class="node-name">${esc(n.name)}</span><span class="node-type">${esc(n.type)}</span><button class="eye ${store.document.outputId === n.id ? 'on' : ''}" data-display="${esc(n.id)}" title="Set display node">◉</button></div>`; }).join(''); $('tree-count').textContent = store.document.nodes.length + ' nodes'; }
function timelineKeys() { return store.document.nodes.filter(n => selection.has(n.id)).flatMap(n => Object.values(n.keyframes || {}).flat()); }
function drawDocument() { const d = store.document; frame = clamp(frame, d.start, d.end); selection = new Set([...selection].filter(id => d.nodes.some(n => n.id === id))); $('selection-count').textContent = selection.size ? `${selection.size} selected` : 'No selection'; document.title = d.title + ' — Stratum FX'; $('project-title').textContent = d.title; $('scene-name').textContent = d.title; $('output-path').textContent = d.nodes.find(n => n.id === d.outputId)?.name || 'No output'; $('node-count').textContent = d.nodes.length + ' nodes'; graph.document = d; graph.select(selection); drawInspector(); drawTree(); timeline.configure({ start: d.start, end: d.end, fps: d.fps, frame, keys: timelineKeys() }); drawAnimation(); updateGizmo(); }
async function saveLocal(notify = false) { await db.save(store.document); localStorage.setItem('stratum-active', store.document.id); $('save-status').textContent = 'Saved on this device'; if (notify)
    toast('Project saved locally.'); }
store.addEventListener('change', e => { drawDocument(); if (!e.detail.ops || e.detail.ops.some(op => op.kind !== 'title' && (op.kind !== 'field' || op.key === 'bypass')))
    requestCook(); clearTimeout(saveTimer); $('save-status').textContent = 'Saving…'; saveTimer = setTimeout(() => saveLocal().catch(err => { toast('Autosave failed. Export the project to protect your work. ' + err.message, true); $('save-status').textContent = 'Not saved — export project'; }), 500); if (e.detail.local)
    status(e.detail.label + ' · procedural graph updated'); });
function requestCook(document = store.document) { const job = { document: structuredClone(document), frame, version: ++cookVersion }; cookQueued = job; if (!cookBusy)
    pumpCook(); }
async function pumpCook() { if (!viewport || cookBusy || !cookQueued)
    return; const job = cookQueued; cookQueued = null; cookBusy = true; $('scene-cook-state').textContent = 'Cooking…'; try {
    const result = await cookService.cook(job.document, job.frame);
    if (job.version === cookVersion || !cookQueued) {
        currentMesh = result.mesh;
        stats = result.stats;
        viewport.setMesh(currentMesh);
        $('viewport-error').hidden = true;
        $('geometry-stats').textContent = `${fmt(currentMesh.triangleCount * currentMesh.instanceCount)} triangles · ${fmt(currentMesh.instanceCount)} instance${currentMesh.instanceCount === 1 ? '' : 's'}`;
        $('cook-stats').textContent = `${stats.ms.toFixed(1)} ms cook`;
        $('memory-status').textContent = `${(stats.bytes / 1048576).toFixed(1)} MiB cache`;
        $('scene-cook-state').textContent = 'Automatic cooking';
        $('render-label').textContent = viewport.renderer.kind === 'WebGPU' ? 'PBR · SHADOWS · MSAA 4×' : viewport.renderer.kind.startsWith('WebGL') ? 'PBR · WEBGL2 FALLBACK' : 'SOFTWARE PREVIEW · CPU RASTER';
        if (activeBottom === 'spreadsheet')
            drawSpreadsheet();
        if (activeBottom === 'performance')
            drawPerformance();
        updateGizmo();
    }
}
catch (e) {
    $('viewport-error').hidden = false;
    $('viewport-error').textContent = e.message + ' · Showing last successful geometry.';
    $('scene-cook-state').textContent = 'Cook error';
    status(e.message);
}
finally {
    cookBusy = false;
    if (cookQueued)
        pumpCook();
} }
function setFrame(value) { if (!Number.isFinite(value))
    return; frame = clamp(Math.round(value), store.document.start, store.document.end); timeline.setFrame(frame); requestCook(); if (!timeline.playing) {
    drawInspector();
    drawAnimation();
} }
function frameScene() { viewport?.frame(); updateGizmo(); }
async function loadProject(doc, { checkpointCurrent = true } = {}) { validateDocument(doc); if (collab.pending.length && !confirm('This project has unsent collaborative edits. They are saved in the local queue. Leave this project?'))
    return; if (checkpointCurrent)
    await saveLocal().catch(() => toast('Local storage is unavailable. Use File → Export project to save.', true)); collab.disconnect(); timeline.playing = false; collab.pending = []; frame = doc.start; selection = new Set(doc.nodes.length ? [doc.nodes.at(-1).id] : []); cookService.clear(); store.replace(doc); $('scene-label').textContent = 'PROCEDURAL WORKSPACE'; $('scene-description').textContent = 'A scene, written in nodes.'; await saveLocal().catch(() => { }); requestAnimationFrame(() => graph.frame()); let version = cookVersion; const wait = () => { if (cookBusy || cookQueued)
    requestAnimationFrame(wait);
else
    frameScene(); }; requestAnimationFrame(wait); closeDialog(); }
async function openPreset(id) { const d = preset(id); await loadProject(d); const info = presetList.find(p => p.id === id); $('scene-label').textContent = info?.type.toUpperCase() || 'NEW WORKSPACE'; $('scene-description').textContent = info?.description || 'Start with a node.'; if (['cloth', 'rigid'].includes(id))
    setFrame(id === 'cloth' ? 54 : 75); }
function addNode(type, position = addPosition) { editable(); const def = defaultRegistry.get(type), selected = [...selection], prior = selectedNode(), count = store.document.nodes.filter(n => n.type === type).length + 1; const n = createNode(type, { name: type + count, x: position?.x ?? (prior ? prior.x + 210 : 80), y: position?.y ?? (prior ? prior.y + 95 : 50) }); if (def.inputs) {
    const sources = selected.length ? selected : store.document.outputId ? [store.document.outputId] : [];
    n.inputs = sources.slice(0, def.inputs);
    while (n.inputs.length < def.inputs)
        n.inputs.push(null);
} commit([{ kind: 'add', node: n }, { kind: 'output', nodeId: n.id }], 'Add ' + def.label); setSelection([n.id]); addPosition = null; return n; }
function deleteNodes(ids = [...selection]) { if (!ids.length)
    return; commit(ids.map(nodeId => ({ kind: 'remove', nodeId })), 'Delete nodes'); setSelection([]); }
function duplicateNodes(ids = [...selection]) { if (!ids.length)
    return; const mapping = new Map(ids.map(id => [id, uuid()])), nodes = store.document.nodes.filter(n => mapping.has(n.id)).map(n => ({ ...structuredClone(n), id: mapping.get(n.id), name: n.name + '_copy', x: n.x + 38, y: n.y + 58, inputs: n.inputs.map(id => mapping.get(id) || id) })); commit(nodes.map(node => ({ kind: 'add', node })), 'Duplicate nodes'); setSelection(nodes.map(n => n.id)); }
function drawShelf() { const categories = ['Create', 'Modify', 'Populate', 'Terrain', 'Simulation', 'Material', 'Utility', 'Import']; $('shelf-tabs').innerHTML = categories.map(c => `<button data-category="${c}" class="${c === shelfCategory ? 'active' : ''}">${c === 'Material' ? 'Materials' : c}</button>`).join(''); let nodes = defaultRegistry.list().filter(d => d.category === shelfCategory); if (shelfCategory === 'Create')
    nodes = [...nodes, ...['transform', 'noise', 'scatter', 'copy', 'color', 'output'].map(t => defaultRegistry.get(t))]; $('shelf-tools').innerHTML = nodes.map((d, i) => `${shelfCategory === 'Create' && i === 6 ? '<span class="shelf-separator"></span>' : ''}<button data-type="${d.type}" title="${esc(d.label)} · ${d.inputs} input(s)"><span class="tool-icon" style="color:${categoryColors[d.category]}">${esc(d.icon)}</span><span>${esc(d.label.replace(' on surface', '').replace(' / color', '').replace('Attribute ', '').replace(' to points', ''))}</span></button>`).join(''); }
function setBottom(name) { activeBottom = name; document.querySelectorAll('[data-bottomtab]').forEach(b => b.classList.toggle('active', b.dataset.bottomtab === name)); for (const [id, key] of [['graph', 'network'], ['spreadsheet', 'spreadsheet'], ['animation', 'animation'], ['performance', 'performance']])
    $(id).hidden = name !== key; if (name === 'spreadsheet')
    drawSpreadsheet(); if (name === 'animation')
    drawAnimation(); if (name === 'performance')
    drawPerformance(); }
function drawSpreadsheet() { const m = currentMesh, count = sheetMode === 'instances' ? m.instanceCount : sheetMode === 'triangles' ? m.triangleCount : m.vertexCount; sheetPage = Math.min(sheetPage, Math.max(0, Math.ceil(count / 80) - 1)); const start = sheetPage * 80, end = Math.min(count, start + 80); let headers, rows = []; if (sheetMode === 'points') {
    headers = ['Point', 'P.x', 'P.y', 'P.z', 'N.x', 'N.y', 'N.z', 'Cd.r', 'Cd.g', 'Cd.b'];
    for (let i = start; i < end; i++)
        rows.push([i, ...m.positions.subarray(i * 3, i * 3 + 3), ...m.normals.subarray(i * 3, i * 3 + 3), ...m.colors.subarray(i * 3, i * 3 + 3)]);
}
else if (sheetMode === 'instances') {
    headers = ['Instance', 'Translate X', 'Translate Y', 'Translate Z', 'Scale X', 'Scale Y', 'Scale Z', 'Tint R', 'Tint G', 'Tint B'];
    for (let i = start; i < end; i++) {
        const a = m.instances.subarray(i * 20, i * 20 + 20);
        rows.push([i, a[12], a[13], a[14], Math.hypot(a[0], a[1], a[2]), Math.hypot(a[4], a[5], a[6]), Math.hypot(a[8], a[9], a[10]), a[16], a[17], a[18]]);
    }
}
else {
    headers = ['Triangle', 'Vertex 0', 'Vertex 1', 'Vertex 2'];
    for (let i = start; i < end; i++)
        rows.push([i, ...m.indices.subarray(i * 3, i * 3 + 3)]);
} $('spreadsheet').innerHTML = `<div class="data-toolbar"><button data-sheet="points" class="${sheetMode === 'points' ? 'active' : ''}">Base points</button><button data-sheet="instances" class="${sheetMode === 'instances' ? 'active' : ''}">Instances</button><button data-sheet="triangles" class="${sheetMode === 'triangles' ? 'active' : ''}">Triangles</button><span>${fmt(count)} records</span><span class="spacer"></span><button data-page="-1" ${sheetPage === 0 ? 'disabled' : ''}>‹</button><span>${sheetPage + 1} / ${Math.max(1, Math.ceil(count / 80))}</span><button data-page="1" ${end >= count ? 'disabled' : ''}>›</button><button id="csv-export">CSV ↗</button></div><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td>${i === 0 || sheetMode === 'triangles' ? v : v.toFixed(4)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
function exportCSV() { const m = currentMesh, lines = ['point,P.x,P.y,P.z,N.x,N.y,N.z,Cd.r,Cd.g,Cd.b']; for (let i = 0; i < m.vertexCount; i++)
    lines.push([i, ...m.positions.subarray(i * 3, i * 3 + 3), ...m.normals.subarray(i * 3, i * 3 + 3), ...m.colors.subarray(i * 3, i * 3 + 3)].join(',')); download(new Blob([lines.join('\n')], { type: 'text/csv' }), filename('-points.csv')); }
function drawPerformance() { if (!stats) {
    $('performance').innerHTML = '<div class="empty-data">Cook a scene to inspect measured operator timings.</div>';
    return;
} const max = Math.max(.001, ...stats.timings.map(t => t.ms)); $('performance').innerHTML = `<div class="data-toolbar"><span>CPU node cook: <b>${stats.ms.toFixed(2)} ms</b></span><span>${stats.cooked} evaluated · ${stats.cached} cache hits</span><span class="spacer"></span><span>${cookService.worker ? 'Worker isolated' : 'Main-thread fallback'}</span></div><table><thead><tr><th>Operator</th><th>Time (ms)</th><th>Relative cost</th></tr></thead><tbody>${stats.timings.map(t => `<tr><td>${esc(t.name)}</td><td>${t.ms.toFixed(3)}</td><td><i class="perf-bar" style="width:${Math.max(1, t.ms / max * 230)}px"></i></td></tr>`).join('')}</tbody></table>${!stats.timings.length ? '<div class="empty-data">All dependencies were served from the geometry cache.</div>' : ''}`; }
function drawAnimation() { const entries = store.document.nodes.flatMap(n => Object.entries(n.keyframes || {}).flatMap(([key, keys]) => keys.map((k, index) => ({ n, key, k, index })))); $('animation').innerHTML = `<div class="data-toolbar"><span>${entries.length} keys · linear and step interpolation</span><span class="spacer"></span><span>◆ in the parameter pane adds a key at frame ${frame}</span></div>${entries.length ? `<table><thead><tr><th>Node / channel</th><th>Frame</th><th>Value</th><th>Interpolation</th><th></th></tr></thead><tbody>${entries.map(({ n, key, k, index }) => `<tr data-node="${n.id}" data-key="${key}" data-index="${index}"><td>${esc(n.name)} / ${key}</td><td><input data-anim="frame" type="number" value="${k.frame}"></td><td><input data-anim="value" type="number" step="any" value="${k.value}"></td><td><select data-anim="interpolation"><option ${k.interpolation !== 'step' ? 'selected' : ''}>linear</option><option ${k.interpolation === 'step' ? 'selected' : ''}>step</option></select></td><td><button data-delete-key title="Remove keyframe">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-data">No keyed channels yet.<br>Click the diamond beside a numeric parameter, move to another frame, change the value, and add another key.<br>Vector fields also support time expressions, such as <code>=sin(t) * 30</code>.</div>'}`; }
function addKey(key, remove = false) { const n = selectedNode(); if (!n)
    return; const sampled = sampleKeys(n.keyframes?.[key], frame, n.params[key]), value = typeof sampled === 'string' ? evaluateExpression(sampled, { t: (frame - 1) / store.document.fps, f: frame }) : sampled; const keys = [...(n.keyframes?.[key] || [])].filter(k => k.frame !== frame); if (!remove)
    keys.push({ frame, value, interpolation: 'linear' }); keys.sort((a, b) => a.frame - b.frame); commit([{ kind: 'keys', nodeId: n.id, key, value: keys }], 'Set keyframe'); toast(`Keyframe ${remove ? 'removed' : 'set'}: ${n.name}.${key} at frame ${frame}`); }
function openPalette(position = null) { addPosition = position; operatorIndex = 0; $('operator-search').value = ''; drawOperators(); $('palette').showModal(); $('operator-search').focus(); }
function drawOperators() { const q = $('operator-search').value.toLowerCase(); filteredOperators = defaultRegistry.list().filter(d => (d.type + ' ' + d.label + ' ' + d.category).toLowerCase().includes(q)); operatorIndex = clamp(operatorIndex, 0, Math.max(0, filteredOperators.length - 1)); $('operator-results').innerHTML = filteredOperators.map((d, i) => `<button class="operator-result ${i === operatorIndex ? 'selected' : ''}" data-index="${i}"><span class="op-icon" style="color:${categoryColors[d.category]}">${esc(d.icon)}</span><span><strong>${esc(d.label)}</strong><small>${esc(d.category)} · ${d.inputs === 0 ? 'generator' : d.inputs + ' input' + (d.inputs > 1 ? 's' : '')}</small></span>${i === operatorIndex ? '<kbd>↵</kbd>' : ''}</button>`).join('') || '<div class="empty-data">No matching operators</div>'; $('operator-results').querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); }
async function projectDialog() { const records = await db.list().catch(() => []); showDialog('Projects & examples', `<p class="lead">Build a procedural scene from a working example, or open a locally saved project.</p><div class="preset-grid">${presetList.map(p => `<button class="preset-card" data-preset="${p.id}"><div class="preset-art">${p.icon}</div><strong>${p.name}</strong><small>${p.type}</small><p>${p.description}</p></button>`).join('')}</div><div class="modal-actions"><button class="btn" id="new-project">＋ Blank scene</button><button class="btn" id="import-project">Import project / OBJ</button></div><div class="section-title">On this device</div>${records.length ? records.map(p => `<div class="saved-project"><div><b>${esc(p.title)}</b><span>${new Date(p.updated).toLocaleString()} · ${p.document.nodes.length} nodes</span></div><button class="btn" data-open-project="${esc(p.id)}">Open</button></div>`).join('') : '<p>No saved projects yet. Your current scene is automatically saved after edits.</p>'}`, true); $('dialog-content').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => run(() => openPreset(b.dataset.preset))); $('new-project').onclick = () => run(() => loadProject(preset('blank'))); $('import-project').onclick = () => $('import-file').click(); $('dialog-content').querySelectorAll('[data-open-project]').forEach(b => b.onclick = () => run(async () => loadProject(await db.get(b.dataset.openProject)))); }
async function saveCheckpoint() { const label = prompt('Checkpoint name', `${store.document.title} · frame ${frame}`); if (!label)
    return; if (collab.projectId)
    await collab.checkpoint(label);
else
    await db.checkpoint(store.document, label); toast('Checkpoint saved.'); }
async function checkpointDialog() { const shared = !!collab.projectId, records = shared ? (await collab.checkpoints()).checkpoints : await db.checkpoints(store.document.id); showDialog('Project history', `<p class="lead">${shared ? 'Shared SQLite checkpoints. Only the owner can restore a shared scene.' : 'Local IndexedDB checkpoints. Restoring creates a new editable scene state.'}</p><button class="btn primary" id="make-checkpoint">Save checkpoint</button>${records.map(r => `<div class="saved-project"><div><b>${esc(r.label)}</b><span>${new Date(r.created).toLocaleString()}${shared ? ' · revision ' + r.revision : ''}</span></div><button class="btn" data-restore="${r.id}">Restore</button></div>`).join('') || '<p>No checkpoints yet.</p>'}`); $('make-checkpoint').onclick = () => run(async () => { await saveCheckpoint(); await checkpointDialog(); }); $('dialog-content').querySelectorAll('[data-restore]').forEach(b => b.onclick = () => run(async () => { if (!confirm('Restore this checkpoint? Current edits will be saved as a safety checkpoint first.'))
    return; if (shared) {
    await collab.checkpoint('Before restore ' + new Date().toISOString());
    await collab.restore(b.dataset.restore);
    await collab.resync();
}
else {
    await db.checkpoint(store.document, 'Before restore ' + new Date().toISOString());
    store.replace(records.find(r => r.id === b.dataset.restore).document);
} closeDialog(); toast('Checkpoint restored.'); })); }
async function renderDialog() { const canvas = viewport.canvas; showDialog('Render / viewport capture', `<p class="lead">Capture the current camera with the real-time raster renderer. This is not a path tracer.</p><div class="stat-grid"><div class="stat-card"><b>${viewport.renderer.kind}</b><span>Active graphics backend</span></div><div class="stat-card"><b>${canvas.width} × ${canvas.height}</b><span>Current output pixels</span></div><div class="stat-card"><b>${fmt(currentMesh.triangleCount * currentMesh.instanceCount)}</b><span>Rendered triangles</span></div></div><div class="render-settings"><label for="render-exposure">Exposure</label><input id="render-exposure" type="range" min=".2" max="3" step=".05" value="${viewport.options.exposure}"><span>Ground plane</span><label><input type="checkbox" id="render-floor" ${viewport.options.floor !== false ? 'checked' : ''}> Show shadow receiver</label><span>Grid</span><label><input type="checkbox" id="render-grid" ${viewport.options.grid ? 'checked' : ''}> Draw world grid</label><span>Shading</span><span>${viewport.renderer.kind === 'WebGPU' ? 'GGX / Schlick · three analytic lights · 1536² PCF shadows · 4× MSAA' : 'GGX / Schlick · analytic lighting · hardware antialiasing; no shadow map'}</span></div><div class="modal-actions"><button class="btn primary" id="export-png">Export PNG</button><button class="btn" id="export-obj">Export OBJ</button><button class="btn" id="export-stl">Export STL</button></div>`); $('render-exposure').oninput = e => { viewport.options.exposure = +e.target.value; viewport.invalidate(); }; $('render-floor').onchange = e => { viewport.options.floor = e.target.checked; viewport.invalidate(); }; $('render-grid').onchange = e => { viewport.options.grid = e.target.checked; viewport.invalidate(); }; $('export-png').onclick = () => run(exportPNG); $('export-obj').onclick = () => run(() => download(new Blob([exportOBJ(currentMesh)], { type: 'text/plain' }), filename('.obj'))); $('export-stl').onclick = () => run(() => download(new Blob([exportSTL(currentMesh)], { type: 'model/stl' }), filename('.stl'))); }
async function exportPNG() { const image = await viewport.snapshot(); download(image, filename('-frame-' + frame + '.png')); toast('PNG rendered and exported.'); }
function aboutDialog() { showDialog('Stratum FX / procedural studio', `<p class="lead">An independently implemented, plain JavaScript procedural 3D workspace. Version 0.1.0.</p><div class="stat-grid"><div class="stat-card"><b>${defaultRegistry.list().length}</b><span>Functional procedural operators</span></div><div class="stat-card"><b>5</b><span>Standalone reusable packages</span></div><div class="stat-card"><b>0</b><span>Runtime npm dependencies</span></div></div><h3>Core packages</h3><p><code>@stratum-fx/core</code> · <code>@stratum-fx/geometry</code> · <code>@stratum-fx/renderer</code> · <code>@stratum-fx/controls</code> · <code>@stratum-fx/collaboration</code></p><h3>Implemented scope</h3><p>Procedural mesh modeling, instancing, deformation, safe point expressions, linear/step animation, ballistic particles, position-based cloth, rigid spheres, PBR viewport rendering, OBJ/STL geometry export, local projects and live team editing with SQLite persistence.</p><div class="notice">This release is not a complete Houdini replacement. Native HIP/HDA/VEX compatibility, sparse volumes, fluid/pyro solvers, character rigging, USD/Solaris, compositing, path tracing, distributed jobs, enterprise administration, and production qualification are not implemented.</div><p>All branding, interface artwork and geometry are original. No proprietary application code or assets are included.</p>`); }
function shortcutsDialog() { showDialog('Keyboard & navigation', `<div class="render-settings"><b>Tab</b><span>Search and create an operator</span><b>Ctrl / ⌘ S</b><span>Save this project locally</span><b>Ctrl / ⌘ Z</b><span>Undo a local operation</span><b>Ctrl / ⌘ Shift Z</b><span>Redo</span><b>Ctrl / ⌘ D</b><span>Duplicate selected nodes</span><b>Delete</b><span>Delete selected graph nodes</span><b>Space</b><span>Play / pause timeline</span><b>← / →</b><span>Previous / next frame</span><b>F</b><span>Frame the active viewport or graph</span><b>G</b><span>Toggle viewport grid</span><b>Q / W / E / R</b><span>Select / translate / rotate / scale</span><b>Left drag</b><span>Orbit viewport; move nodes in the network</span><b>Right drag</b><span>Pan viewport; use middle drag to pan the graph</span><b>Scroll</b><span>Dolly camera or zoom the network</span><b>Shift-click / drag</b><span>Add nodes to selection / marquee select</span><b>Alt-click input</b><span>Disconnect a wire</span><b>Double-click wire</b><span>Disconnect its destination input</span><b>Double-click node</b><span>Set viewport display output</span></div>`); }
async function collaborationDialog(tab = 'session') {
    let available = true;
    try {
        await collab.session();
    }
    catch {
        available = false;
    }
    if (!available) {
        showDialog('Collaboration', `<div class="notice">This copy is running as a static or standalone app. Live collaboration requires the included Node + SQLite server.</div><h3>Start the backend</h3><pre>node server/index.js</pre><p>Then open the server’s <code>/app/</code> route. Local projects, the editor and rendering work without the server.</p><p>The backend includes password-based accounts, project ownership, editor/viewer roles, invitations, live presence, field-level edit merging, and checkpoints. No external service or API key is required.</p>`);
        return;
    }
    if (!collab.user) {
        showDialog('Connect your workspace', `<p class="lead">Sign in to the local Stratum server to create shared projects and work together live.</p><form id="auth-form"><div class="form-grid"><label>Username<input id="auth-name" required minlength="3" maxlength="40" autocomplete="username" placeholder="your.name"></label><label>Password<input id="auth-password" type="password" required minlength="10" maxlength="256" autocomplete="current-password" placeholder="At least 10 characters"></label></div><div class="form-error" id="auth-error"></div><div class="modal-actions"><button class="btn primary" type="submit">Sign in</button><button class="btn" id="register-user" type="button">Create account</button></div></form><div class="notice">Accounts are stored on this server. Use HTTPS before exposing it to the internet. This release has no email verification, password recovery or enterprise identity integration.</div>`);
        const auth = async (register) => { try {
            $('auth-error').textContent = '';
            const n = $('auth-name').value, p = $('auth-password').value;
            if (register)
                await collab.register(n, p);
            else
                await collab.login(n, p);
            $('user-avatar').textContent = collab.user.name[0].toUpperCase();
            await collaborationDialog();
        }
        catch (e) {
            $('auth-error').textContent = e.message;
        } };
        $('auth-form').onsubmit = e => { e.preventDefault(); auth(false); };
        $('register-user').onclick = () => auth(true);
        return;
    }
    const projects = (await collab.projects()).projects;
    let content = `<div class="collab-tabs"><button data-teamtab="session" class="${tab === 'session' ? 'active' : ''}">Session</button><button data-teamtab="members" class="${tab === 'members' ? 'active' : ''}">Members</button><button data-teamtab="activity" class="${tab === 'activity' ? 'active' : ''}">Activity</button><button data-teamtab="history">Checkpoints</button></div><p class="lead">Signed in as <b>${esc(collab.user.name)}</b>${collab.projectId ? ` · ${esc(collab.role)} · revision ${collab.revision}` : ''}</p>`;
    if (tab === 'members' && collab.projectId) {
        const members = (await collab.members()).members;
        content += members.map(m => `<div class="saved-project"><b>${esc(m.name)}</b>${collab.role === 'owner' && m.role !== 'owner' ? `<select data-member="${m.id}"><option ${m.role === 'editor' ? 'selected' : ''}>editor</option><option ${m.role === 'viewer' ? 'selected' : ''}>viewer</option></select>` : `<span>${m.role}</span>`}</div>`).join('');
    }
    else if (tab === 'activity') {
        content += `<div class="notice">Edits are ordered by the server. Changes to different parameter fields merge independently; competing edits to the same field use last-server-accepted value. This is not a CRDT.</div>${recentActivity.length ? recentActivity.slice(-30).reverse().map(a => `<div class="saved-project"><div>${esc(a)}<span>Current session activity</span></div></div>`).join('') : '<p>No remote activity recorded in this session.</p>'}${collab.rejected.length ? '<button class="btn" id="export-conflicts">Export rejected edits</button>' : ''}`;
    }
    else if (collab.projectId) {
        content += `<div class="notice success">Live project: ${esc(store.document.title)}<br>${collab.status} · ${collab.pending.length} queued edits · role: ${collab.role}</div><div id="presence-list"></div><h3>Invite a teammate</h3>${collab.role === 'owner' ? `<div class="invite-row"><select id="invite-role"><option>editor</option><option>viewer</option></select><button class="btn" id="make-invite">Create invitation</button></div><div id="invite-result"></div>` : '<p>The project owner can create invitations and manage roles.</p>'}<div class="modal-actions"><button class="btn" id="disconnect-project">Continue locally</button><button class="btn" id="team-checkpoint">Save shared checkpoint</button></div>`;
    }
    else
        content += '<div class="notice">No shared project is connected. Publish the current scene or open an existing team project.</div>';
    content += `<div class="section-title">Team projects</div>${projects.map(p => `<div class="saved-project"><div><b>${esc(p.title)}</b><span>${p.role} · revision ${p.revision}</span></div><button class="btn" data-team-project="${p.id}">Open live</button></div>`).join('') || '<p>No shared projects yet.</p>'}<div class="modal-actions"><button class="btn primary" id="publish-project">Publish current scene</button><button class="btn" id="logout">Sign out</button></div><hr><h3>Join with an invitation</h3><form id="join-form" class="invite-row"><input id="join-code" placeholder="Paste invitation code" required><button class="btn" type="submit">Join project</button></form><div class="form-error" id="team-error"></div>`;
    showDialog('Team workspace', content);
    $('dialog-content').querySelectorAll('[data-teamtab]').forEach(b => b.onclick = () => run(() => b.dataset.teamtab === 'history' ? checkpointDialog() : collaborationDialog(b.dataset.teamtab)));
    $('dialog-content').querySelectorAll('[data-team-project]').forEach(b => b.onclick = () => run(async () => { await saveLocal(); await collab.connect(b.dataset.teamProject); closeDialog(); setSelection([]); requestCook(); setTimeout(frameScene, 300); }));
    $('publish-project').onclick = () => run(async () => { await saveLocal(); await collab.create(store.document); toast('Live project created.'); await collaborationDialog(); });
    $('logout').onclick = () => run(async () => { await collab.logout(); $('user-avatar').textContent = 'S'; await collaborationDialog(); });
    $('join-form').onsubmit = e => { e.preventDefault(); run(async () => { await saveLocal(); await collab.join($('join-code').value); await collaborationDialog(); setTimeout(frameScene, 300); }); };
    $('dialog-content').querySelectorAll('[data-member]').forEach(s => s.onchange = () => run(async () => { await collab.setRole(s.dataset.member, s.value); toast('Member role updated.'); }));
    if ($('make-invite'))
        $('make-invite').onclick = () => run(async () => { const invite = await collab.invitation($('invite-role').value); $('invite-result').innerHTML = `<div class="invite-row" style="margin-top:12px"><input id="invite-code" readonly value="${esc(invite.code)}"><button class="btn" id="copy-invite">Copy</button></div><p class="small">${invite.role} access · expires ${new Date(invite.expires).toLocaleDateString()}</p>`; $('copy-invite').onclick = () => run(async () => { try {
            await navigator.clipboard.writeText(invite.code);
            toast('Invitation code copied.');
        }
        catch {
            $('invite-code').select();
            toast('Select and copy the invitation code.');
        } }); });
    if ($('disconnect-project'))
        $('disconnect-project').onclick = () => run(() => { if (collab.pending.length && !confirm('Queued edits remain saved for this shared project. Continue locally?'))
            return; collab.disconnect(); collaborationDialog(); });
    if ($('team-checkpoint'))
        $('team-checkpoint').onclick = () => run(saveCheckpoint);
    if ($('export-conflicts'))
        $('export-conflicts').onclick = () => download(new Blob([JSON.stringify(collab.rejected, null, 2)], { type: 'application/json' }), 'stratum-rejected-edits.json');
    drawPresence();
}
let presentUsers = [];
function drawPresence() { if ($('presence-list'))
    $('presence-list').innerHTML = presentUsers.length ? presentUsers.map(u => `<span class="presence-chip"><span class="live-dot"></span>${esc(u.name)} · ${u.role}</span>`).join('') : '<p class="small muted">You are the only connected participant.</p>'; }
collab.addEventListener('status', e => { $('backend-status').textContent = collab.projectId ? e.detail.toUpperCase() : 'LOCAL'; $('share-btn').classList.toggle('active', e.detail === 'online'); });
collab.addEventListener('presence', e => { presentUsers = e.detail; graph.presence = presentUsers; graph.drawPresence(); drawPresence(); });
collab.addEventListener('queue', e => { $('pending-status').textContent = e.detail ? `${e.detail} queued edit(s)` : ''; });
collab.addEventListener('error', e => toast(e.detail, true));
collab.addEventListener('conflict', e => { toast('Edit conflict: ' + e.detail.error + '. Rejected edits remain recoverable in the collaboration queue export.', true); recentActivity.push('Conflict: ' + e.detail.error); });
collab.addEventListener('activity', e => { recentActivity.push(`${e.detail.user} updated ${e.detail.ops?.length || 0} field(s) · revision ${e.detail.revision}`); if (recentActivity.length > 100)
    recentActivity.shift(); });
function setTool(name) { tool = name; if (['translate', 'rotate', 'scale'].includes(name) && selectedNode()?.type !== 'transform')
    run(() => addNode('transform')); viewport.options.tool = name === 'orbit' ? 'orbit' : 'select'; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === name)); $('view-hint').textContent = name === 'orbit' ? 'LMB orbit · RMB pan · scroll dolly' : name === 'select' ? 'Click geometry to inspect · Alt-drag orbit' : 'Drag an axis handle · Alt-drag orbit'; updateGizmo(); }
function updateGizmo() { const svg = $('gizmo'), n = selectedNode(); if (!viewport || !['translate', 'rotate', 'scale'].includes(tool) || n?.type !== 'transform' || !viewport.bounds) {
    svg.innerHTML = '';
    return;
} const rect = viewport.canvas.getBoundingClientRect(), vp = viewport.camera.matrix(rect.width / rect.height, viewport.renderer.kind === 'WebGPU'), center = viewport.bounds.center, len = Math.max(.5, viewport.bounds.radius * .3), project = p => { const q = transformPoint(vp, p); return { x: (q[0] + 1) * .5 * rect.width, y: (1 - q[1]) * .5 * rect.height }; }, origin = project(center); const colors = ['#d99477', '#95c18d', '#87b4dd']; svg.innerHTML = [0, 1, 2].map(axis => { const p = [...center]; p[axis] += len; const end = project(p); return `<g><line data-axis="${axis}" x1="${origin.x}" y1="${origin.y}" x2="${end.x}" y2="${end.y}" stroke="${colors[axis]}"/><circle data-axis="${axis}" cx="${end.x}" cy="${end.y}" r="5" stroke="${colors[axis]}"/><text x="${end.x + 8}" y="${end.y + 3}" fill="${colors[axis]}">${'XYZ'[axis]}</text></g>`; }).join(''); svg.gizmoData = { origin, center, len, vp, rect }; }
$('gizmo').addEventListener('pointerdown', e => { const axis = e.target.dataset.axis; if (axis === undefined)
    return; run(() => { editable(); e.preventDefault(); e.stopPropagation(); const n = selectedNode(), field = tool === 'translate' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale', values = n.params[field].map(v => typeof v === 'number' ? v : evaluateExpression(v, { f: frame, t: (frame - 1) / store.document.fps })), data = $('gizmo').gizmoData, p = [...data.center]; p[+axis] += data.len; const q = transformPoint(data.vp, p), end = { x: (q[0] + 1) * .5 * data.rect.width, y: (1 - q[1]) * .5 * data.rect.height }, dx = end.x - data.origin.x, dy = end.y - data.origin.y; gizmoDrag = { nodeId: n.id, field, axis: +axis, values, x: e.clientX, y: e.clientY, dx, dy, screenLength: Math.hypot(dx, dy) || 1, worldLength: data.len }; $('gizmo').setPointerCapture(e.pointerId); }); });
$('gizmo').addEventListener('pointermove', e => { if (!gizmoDrag)
    return; const d = gizmoDrag, delta = ((e.clientX - d.x) * d.dx + (e.clientY - d.y) * d.dy) / d.screenLength, values = [...d.values]; values[d.axis] = d.field === 'translate' ? d.values[d.axis] + delta / d.screenLength * d.worldLength : d.field === 'rotate' ? d.values[d.axis] + delta * .8 : Math.max(.001, d.values[d.axis] + delta * .01); d.preview = values; run(() => requestCook(applyOperations(store.document, [{ kind: 'param', nodeId: d.nodeId, key: d.field, value: values }]))); });
$('gizmo').addEventListener('pointerup', () => { if (!gizmoDrag)
    return; const d = gizmoDrag; gizmoDrag = null; if (d.preview)
    run(() => commit([{ kind: 'param', nodeId: d.nodeId, key: d.field, value: d.preview }], 'Manipulate ' + d.field)); });
$('gizmo').addEventListener('pointercancel', () => { gizmoDrag = null; requestCook(); });
const menus = { File: [['New scene', 'Ctrl N', () => loadProject(preset('blank'))], ['Open projects & examples', 'Ctrl O', projectDialog], ['Import project / OBJ', '', () => $('import-file').click()], null, ['Save locally', 'Ctrl S', () => saveLocal(true)], ['Save checkpoint', '', saveCheckpoint], ['Project history', '', checkpointDialog], null, ['Export Stratum project', '', () => download(new Blob([JSON.stringify(store.document, null, 2)], { type: 'application/json' }), filename('.stratum.json'))], ['Export geometry · OBJ', '', () => download(new Blob([exportOBJ(currentMesh)], { type: 'text/plain' }), filename('.obj'))], ['Export geometry · STL', '', () => download(new Blob([exportSTL(currentMesh)]), filename('.stl'))]], Edit: [['Undo', 'Ctrl Z', () => { editable(); store.undo(); }], ['Redo', 'Ctrl Shift Z', () => { editable(); store.redo(); }], null, ['Duplicate nodes', 'Ctrl D', () => duplicateNodes()], ['Delete nodes', 'Delete', () => deleteNodes()], ['Rename project', '', () => { const name = prompt('Project name', store.document.title); if (name)
                commit([{ kind: 'title', value: name }], 'Rename project'); }]], View: [['Frame geometry', 'F', frameScene], ['Frame network', '', () => graph.frame()], ['Perspective', '', () => viewport.view('perspective')], ['Top view', '', () => viewport.view('top')], ['Front view', '', () => viewport.view('front')], ['Right view', '', () => viewport.view('right')], null, ['Toggle grid', 'G', () => toggleGrid()], ['Toggle theme', '', () => toggleTheme()], ['Reset workspace layout', '', () => { document.documentElement.style.removeProperty('--sidebar'); document.documentElement.style.removeProperty('--viewport-ratio'); $('desktop').classList.remove('maximized'); graph.frame(); }]], Nodes: [['Add operator', 'Tab', () => openPalette()], ['Auto-layout network', '', () => graph.autoLayout()], ['Display selected', '', () => selectedNode() && commit([{ kind: 'output', nodeId: selectedNode().id }], 'Set display output')], ['Bypass selected', '', () => selectedNode() && commit([{ kind: 'field', nodeId: selectedNode().id, key: 'bypass', value: !selectedNode().bypass }], 'Toggle bypass')], ['Recook all nodes', '', () => { cookService.clear(); requestCook(); }]], Render: [['Render settings', '', renderDialog], ['Capture PNG', '', exportPNG]], Help: [['Keyboard & navigation', '', shortcutsDialog], ['About / supported features', '', aboutDialog], ['Selected operator', '', () => nodeHelp()]] };
function showMenu(name, button) { const list = menus[name]; $('dropdown').innerHTML = list.map((item, i) => item ? `<button data-menuindex="${i}"><span>${item[0]}</span><small>${item[1]}</small></button>` : '<div class="separator"></div>').join(''); const r = button.getBoundingClientRect(); $('dropdown').style.left = r.left + 'px'; $('dropdown').style.top = r.bottom + 'px'; $('dropdown').hidden = false; $('dropdown').querySelectorAll('[data-menuindex]').forEach(b => b.onclick = () => { $('dropdown').hidden = true; run(list[+b.dataset.menuindex][2]); }); }
function toggleGrid() { viewport.options.grid = !viewport.options.grid; $('toggle-grid').classList.toggle('active', viewport.options.grid); viewport.invalidate(); }
function toggleTheme() { document.body.classList.toggle('theme-light'); try {
    localStorage.setItem('stratum-theme', document.body.classList.contains('theme-light') ? 'light' : 'dark');
}
catch { } }
function nodeHelp() { const n = selectedNode(); if (!n)
    return toast('Select a node first.'); const d = defaultRegistry.get(n.type); showDialog(d.label, `<p class="lead">${esc(d.category)} operator · ${d.inputs} input(s) · internal type: <code>${esc(d.type)}</code></p>${Object.entries(d.params).map(([k, s]) => `<div class="saved-project"><div><b>${esc(s.label)}</b><span><code>${k}</code> · ${s.type}${s.type === 'number' ? ` · range ${s.min} to ${s.max}` : ''}</span></div><code>${esc(JSON.stringify(s.default))}</code></div>`).join('')}<p>Connect upstream geometry to every required input, then enable this node’s cyan display flag to see its output.</p>${n.type === 'wrangle' ? '<div class="notice">Safe scalar expressions only. Variables: x, y, z, i, t, f, pi. Functions include sin, cos, abs, sqrt, pow, min, max, clamp, lerp, noise and fbm. No JavaScript or VEX execution.</div>' : ''}`); }
$('menus').onclick = e => { const b = e.target.closest('[data-menu]'); if (b)
    showMenu(b.dataset.menu, b); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('#dropdown') && !e.target.closest('#menus'))
    $('dropdown').hidden = true; });
$('shelf-tabs').onclick = e => { const b = e.target.closest('[data-category]'); if (b) {
    shelfCategory = b.dataset.category;
    drawShelf();
} };
$('shelf-tools').onclick = e => { const b = e.target.closest('[data-type]'); if (b)
    run(() => b.dataset.type === 'obj' ? $('import-file').click() : addNode(b.dataset.type)); };
$('scene-tree').onclick = e => { const display = e.target.closest('[data-display]'); if (display)
    return run(() => commit([{ kind: 'output', nodeId: display.dataset.display }], 'Set display output')); const row = e.target.closest('[data-node]'); if (row)
    setSelection(e.shiftKey ? [...selection, row.dataset.node] : [row.dataset.node]); };
$('scene-tree').addEventListener('keydown', e => { if (e.key === 'Enter') {
    const row = e.target.closest('[data-node]');
    if (row)
        setSelection([row.dataset.node]);
} });
$('tree-search').oninput = drawTree;
graph.addEventListener('nodes-select', e => setSelection(e.detail));
graph.addEventListener('nodes-move', e => run(() => commit(e.detail.flatMap(n => [{ kind: 'field', nodeId: n.id, key: 'x', value: n.x }, { kind: 'field', nodeId: n.id, key: 'y', value: n.y }]), 'Move nodes')));
graph.addEventListener('nodes-connect', e => run(() => commit([{ kind: 'connect', ...e.detail }], 'Connect nodes')));
graph.addEventListener('node-display', e => run(() => commit([{ kind: 'output', nodeId: e.detail.id }], 'Set display output')));
graph.addEventListener('nodes-delete', e => run(() => deleteNodes(e.detail)));
graph.addEventListener('nodes-duplicate', e => run(() => duplicateNodes(e.detail)));
graph.addEventListener('request-add', e => openPalette(e.detail));
graph.addEventListener('graph-pointer', e => collab.presence(e.detail));
graph.addEventListener('mouseenter', () => activePane = 'network');
$('viewport').addEventListener('mouseenter', () => activePane = 'viewport');
inspector.addEventListener('parameter-change', e => run(() => { const n = selectedNode(); if (n) {
    const ops = [{ kind: 'param', nodeId: n.id, ...e.detail }], { key, value } = e.detail;
    if (n.keyframes?.[key]?.length) {
        const keys = n.keyframes[key].filter(k => k.frame !== frame);
        keys.push({ frame, value: typeof value === 'string' ? evaluateExpression(value, { t: (frame - 1) / store.document.fps, f: frame }) : value, interpolation: 'linear' });
        keys.sort((a, b) => a.frame - b.frame);
        ops.push({ kind: 'keys', nodeId: n.id, key, value: keys });
    }
    commit(ops, 'Edit ' + e.detail.key);
} }));
inspector.addEventListener('parameter-keyframe', e => run(() => addKey(e.detail.key, e.detail.remove)));
inspector.addEventListener('node-rename', e => run(() => commit([{ kind: 'field', nodeId: selectedNode().id, key: 'name', value: e.detail.value }], 'Rename node')));
inspector.addEventListener('node-bypass', e => run(() => commit([{ kind: 'field', nodeId: selectedNode().id, key: 'bypass', value: e.detail.value }], 'Toggle bypass')));
inspector.addEventListener('node-display', e => run(() => commit([{ kind: 'output', nodeId: e.detail.id }], 'Set display output')));
timeline.addEventListener('frame-change', e => setFrame(e.detail.frame));
timeline.addEventListener('timeline-change', e => run(() => commit([{ kind: 'timeline', ...e.detail }], 'Edit timeline')));
timeline.addEventListener('play-change', () => { playingLast = performance.now(); playingAccumulator = 0; });
$('operator-search').oninput = () => { operatorIndex = 0; drawOperators(); };
$('operator-results').onclick = e => { const b = e.target.closest('[data-index]'); if (b) {
    const d = filteredOperators[+b.dataset.index];
    $('palette').close();
    run(() => addNode(d.type));
} };
$('palette').addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    operatorIndex += e.key === 'ArrowDown' ? 1 : -1;
    drawOperators();
} if (e.key === 'Enter' && filteredOperators[operatorIndex]) {
    e.preventDefault();
    $('palette').close();
    run(() => addNode(filteredOperators[operatorIndex].type));
} });
$('spreadsheet').onclick = e => { const sheet = e.target.closest('[data-sheet]'), page = e.target.closest('[data-page]'); if (sheet) {
    sheetMode = sheet.dataset.sheet;
    sheetPage = 0;
    drawSpreadsheet();
} if (page) {
    sheetPage += +page.dataset.page;
    drawSpreadsheet();
} if (e.target.id === 'csv-export')
    exportCSV(); };
$('animation').addEventListener('change', e => { const tr = e.target.closest('tr[data-node]'); if (!tr || !e.target.dataset.anim)
    return; run(() => { const n = store.document.nodes.find(n => n.id === tr.dataset.node), keys = structuredClone(n.keyframes[tr.dataset.key]), field = e.target.dataset.anim; keys[+tr.dataset.index][field] = field === 'interpolation' ? e.target.value : +e.target.value; keys.sort((a, b) => a.frame - b.frame); commit([{ kind: 'keys', nodeId: n.id, key: tr.dataset.key, value: keys }], 'Edit keyframe'); }); });
$('animation').onclick = e => { if (!e.target.hasAttribute('data-delete-key'))
    return; const tr = e.target.closest('tr'); run(() => { const n = store.document.nodes.find(n => n.id === tr.dataset.node), keys = structuredClone(n.keyframes[tr.dataset.key]); keys.splice(+tr.dataset.index, 1); commit([{ kind: 'keys', nodeId: n.id, key: tr.dataset.key, value: keys }], 'Delete keyframe'); }); };
$('import-file').onchange = e => run(async () => { const file = e.target.files[0]; if (!file)
    return; if (file.size > 24000000)
    throw Error('Import exceeds the 24 MB file limit.'); const text = await file.text(); if (file.name.toLowerCase().endsWith('.obj')) {
    const mesh = importOBJ(text);
    if (!mesh.vertexCount)
        throw Error('OBJ contains no geometry');
    const n = createNode('obj', { name: file.name.replace(/\.obj$/i, '').slice(0, 100), x: 100, y: 70, params: { source: text } });
    commit([{ kind: 'add', node: n }, { kind: 'output', nodeId: n.id }], 'Import OBJ');
    setSelection([n.id]);
    requestAnimationFrame(() => graph.frame());
    setTimeout(frameScene, 400);
}
else {
    const d = JSON.parse(text);
    await loadProject(d);
} e.target.value = ''; closeDialog(); toast('Imported ' + file.name); });
$('dialog-close').onclick = closeDialog;
for (const id of ['dialog', 'palette'])
    $(id).addEventListener('click', e => { if (e.target === $(id)) {
        const r = $(id).getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            $(id).close();
    } });
$('save-btn').onclick = () => run(() => saveLocal(true));
$('theme-btn').onclick = toggleTheme;
$('projects-btn').onclick = () => run(projectDialog);
$('share-btn').onclick = () => run(() => collaborationDialog());
$('user-avatar').onclick = () => run(() => collaborationDialog());
$('project-title').onclick = () => run(menus.Edit.at(-1)[2]);
for (const id of ['command-btn', 'add-node-btn', 'add-view-node'])
    $(id).onclick = () => openPalette();
$('frame-scene').onclick = frameScene;
$('frame-nodes').onclick = () => graph.frame();
$('layout-nodes').onclick = () => run(() => graph.autoLayout());
$('toggle-grid').onclick = toggleGrid;
$('capture-btn').onclick = () => run(renderDialog);
$('quick-png').onclick = () => run(exportPNG);
$('inline-exposure').oninput = e => { viewport.options.exposure = +e.target.value; viewport.invalidate(); };
$('camera-view').onchange = e => { viewport.view(e.target.value); $('view-label').textContent = e.target.value === 'perspective' ? 'persp' : e.target.value; updateGizmo(); };
$('shading-mode').onchange = e => { viewport.options.mode = e.target.value; viewport.invalidate(); };
$('maximize-view').onclick = () => { $('desktop').classList.toggle('maximized'); setTimeout(() => graph.frame(), 30); };
$('recook-btn').onclick = () => { cookService.clear(); requestCook(); };
$('help-node').onclick = nodeHelp;
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => run(() => setTool(b.dataset.tool)));
document.querySelectorAll('.axis-widget [data-axis]').forEach(b => b.onclick = () => { viewport.view(b.dataset.axis); $('camera-view').value = b.dataset.axis; updateGizmo(); });
document.querySelectorAll('[data-bottomtab]').forEach(b => b.onclick = () => setBottom(b.dataset.bottomtab));
document.querySelectorAll('[data-viewtab]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-viewtab]').forEach(x => x.classList.toggle('active', x === b)); $('render-controls').hidden = b.dataset.viewtab !== 'render'; });
document.querySelectorAll('[data-workspace]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-workspace]').forEach(x => x.classList.toggle('active', x === b)); shelfCategory = b.dataset.workspace === 'Geometry' ? 'Create' : b.dataset.workspace === 'Simulation' ? 'Simulation' : 'Material'; drawShelf(); if (b.dataset.workspace === 'Look development') {
    $('render-controls').hidden = false;
    setBottom('performance');
}
else {
    $('render-controls').hidden = true;
    setBottom('network');
} });
function split(id, axis) { let drag = false; const e = $(id); e.onpointerdown = event => { drag = true; e.setPointerCapture(event.pointerId); document.body.style.userSelect = 'none'; }; e.onpointermove = event => { if (!drag)
    return; if (axis === 'x') {
    const width = clamp(window.innerWidth - event.clientX - 5, 250, 500);
    document.documentElement.style.setProperty('--sidebar', width + 'px');
}
else {
    const rect = $('desktop').getBoundingClientRect(), ratio = clamp((event.clientY - rect.top) / rect.height * 100, 30, 78);
    document.documentElement.style.setProperty('--viewport-ratio', ratio + '%');
} }; e.onpointerup = () => { drag = false; document.body.style.userSelect = ''; }; e.onpointercancel = e.onpointerup; }
split('v-splitter', 'x');
split('h-splitter', 'y');
function textFocus() { let e = document.activeElement; while (e?.shadowRoot?.activeElement)
    e = e.shadowRoot.activeElement; return e && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) || e.isContentEditable); }
document.addEventListener('keydown', e => { if (e.defaultPrevented || $('dialog').open || $('palette').open || textFocus())
    return; const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(); if (mod && ['s', 'o', 'n', 'z', 'y', 'd'].includes(key)) {
    e.preventDefault();
    run(() => { if (key === 's')
        return saveLocal(true); if (key === 'o')
        return projectDialog(); if (key === 'n')
        return loadProject(preset('blank')); if (key === 'd')
        return duplicateNodes(); editable(); if (key === 'z' && !e.shiftKey)
        store.undo();
    else
        store.redo(); });
    return;
} if (e.key === 'Tab') {
    e.preventDefault();
    openPalette();
} if (e.key === ' ') {
    e.preventDefault();
    timeline.toggle();
} if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setFrame(frame - 1);
} if (e.key === 'ArrowRight') {
    e.preventDefault();
    setFrame(frame + 1);
} if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    run(() => deleteNodes());
} if (key === 'f') {
    e.preventDefault();
    if (activePane === 'network')
        graph.frame();
    else
        frameScene();
} if (key === 'g')
    toggleGrid(); if (['q', 'w', 'e', 'r'].includes(key))
    run(() => setTool({ q: 'select', w: 'translate', e: 'rotate', r: 'scale' }[key])); });
window.addEventListener('beforeunload', e => { if (collab.pending.length) {
    e.preventDefault();
    e.returnValue = 'Unsent collaborative edits are saved in your local queue.';
} });
try {
    if (localStorage.getItem('stratum-theme') === 'light')
        document.body.classList.add('theme-light');
}
catch { }
drawShelf();
drawDocument();
try {
    viewport = await new Viewport($('canvas'), { backend: params.get('renderer') === 'webgl2' ? 'webgl2' : undefined }).init();
    $('renderer-badge').textContent = viewport.renderer.kind;
    if (viewport.renderer.kind === 'Software preview')
        $('shading-mode').options[0].textContent = 'Lit preview';
    $('renderer-badge').title = viewport.fallbackReason || 'Native WebGPU raster renderer';
    viewport.addEventListener('error', e => { toast(e.detail, true); $('renderer-badge').textContent = 'GPU error'; });
    viewport.addEventListener('pick', e => { const hit = e.detail; if (hit) {
        status(`Picked instance ${hit.instance} · triangle ${hit.triangle} · world [${hit.point.map(x => x.toFixed(3)).join(', ')}]`);
    }
    else
        status('No geometry under cursor'); });
    viewport.addEventListener('invalidate', () => requestAnimationFrame(updateGizmo));
    requestCook();
    const ready = () => { if (cookBusy || cookQueued)
        return requestAnimationFrame(ready); frameScene(); graph.frame(); status(`${defaultRegistry.list().length} operators ready · ${viewport.renderer.kind} · local workspace`); };
    requestAnimationFrame(ready);
}
catch (e) {
    $('viewport-error').hidden = false;
    $('viewport-error').textContent = 'Renderer initialization failed: ' + e.message;
    $('renderer-badge').textContent = 'Renderer unavailable';
    toast(e.message, true);
}
function animate(now) { if (timeline.playing && viewport) {
    const dt = Math.min(.15, (now - (playingLast || now)) / 1000);
    playingLast = now;
    playingAccumulator += dt;
    const step = 1 / store.document.fps;
    if (playingAccumulator >= step) {
        const count = Math.floor(playingAccumulator / step);
        playingAccumulator -= count * step;
        let next = frame + count;
        if (next > store.document.end) {
            if (timeline.loop)
                next = store.document.start + (next - store.document.start) % (store.document.end - store.document.start + 1);
            else {
                next = store.document.end;
                timeline.toggle();
            }
        }
        setFrame(next);
    }
}
else
    playingLast = now; requestAnimationFrame(animate); }
requestAnimationFrame(animate);
window.stratum = { store, registry: defaultRegistry, db, collaboration: collab, get viewport() { return viewport; }, get mesh() { return currentMesh; }, get stats() { return stats; }, get frame() { return frame; }, get cooking() { return cookBusy || !!cookQueued; }, get selection() { return [...selection]; }, setFrame, addNode, loadPreset: openPreset, setSelection, requestCook, exportPNG, save: saveLocal };
