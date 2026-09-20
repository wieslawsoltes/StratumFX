import { identity, compose, multiply, lookAt, perspective, orthographic, invert, transformPoint, normalize, vsub, vadd, vscale, cross, clamp } from '../../geometry/src/math.js';
import { Mesh, copyToPoints } from '../../geometry/src/mesh.js';
import { sphere, grid } from '../../geometry/src/primitives.js';
import { meshWGSL, glVertex, glFragment } from './shaders.js';
import { MeshBVH } from './bvh.js';
import { SoftwareRenderer } from './software.js';
const layout = [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x3' }] }, { arrayStride: 80, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map((k) => ({ shaderLocation: k + 3, offset: k * 16, format: 'float32x4' })) }];
function interleave(mesh) { const out = new Float32Array(mesh.vertexCount * 9); for (let i = 0; i < mesh.vertexCount; i++) {
    out.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 9);
    out.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3);
    out.set(mesh.colors.subarray(i * 3, i * 3 + 3), i * 9 + 6);
} return out; }
function edgeIndices(mesh) { const edges = new Set(), out = []; for (let i = 0; i < mesh.indices.length; i += 3)
    for (const [a, b] of [[mesh.indices[i], mesh.indices[i + 1]], [mesh.indices[i + 1], mesh.indices[i + 2]], [mesh.indices[i + 2], mesh.indices[i]]]) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!edges.has(key)) {
            edges.add(key);
            out.push(a, b);
        }
    } return new Uint32Array(out); }
export class OrbitCamera {
    constructor() { this.target = [0, 1, 0]; this.distance = 16; this.yaw = .8; this.pitch = .48; this.orthographic = false; this.fov = 42 * Math.PI / 180; }
    get eye() { const cp = Math.cos(this.pitch); return vadd(this.target, [Math.sin(this.yaw) * cp * this.distance, Math.sin(this.pitch) * this.distance, Math.cos(this.yaw) * cp * this.distance]); }
    matrix(aspect, webgpu = true) { const s = this.distance * .38; return multiply(this.orthographic ? orthographic(-s * aspect, s * aspect, -s, s, .01, 2000, webgpu) : perspective(this.fov, aspect, .03, 2000, webgpu), lookAt(this.eye, this.target)); }
    frame(bounds) { this.target = [...bounds.center]; this.distance = clamp(bounds.radius * 2.25, 2, 1000); }
    pan(dx, dy) { const f = normalize(vsub(this.target, this.eye)), right = normalize(cross(f, [0, 1, 0])), up = cross(right, f); this.target = vadd(this.target, vadd(vscale(right, -dx * this.distance * .0015), vscale(up, dy * this.distance * .0015))); }
}
export class WebGPURenderer {
    constructor(canvas) { this.canvas = canvas; this.kind = 'WebGPU'; this.uniformData = new Float32Array(48); this.error = null; }
    async init() {
        if (!navigator.gpu)
            throw Error('WebGPU is unavailable');
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!this.adapter)
            throw Error('No WebGPU adapter');
        this.device = await this.adapter.requestDevice();
        const d = this.device;
        this.device.lost.then(info => { this.error = 'GPU device lost: ' + info.message; this.onError?.(this.error); });
        d.addEventListener('uncapturederror', e => { this.error = e.error.message; this.onError?.(this.error); });
        this.context = this.canvas.getContext('webgpu');
        if (!this.context)
            throw Error('Cannot create WebGPU canvas');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
        const shader = d.createShaderModule({ code: meshWGSL, label: 'Stratum PBR + PCF' });
        const info = await shader.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error');
        if (errors.length)
            throw Error(errors.map(e => `${e.lineNum}: ${e.message}`).join('\n'));
        this.uniform = d.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.shadow = d.createTexture({ size: [1536, 1536], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.shadowView = this.shadow.createView();
        const bgl = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }] });
        this.bind = d.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: this.shadowView }, { binding: 2, resource: d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' }) }] });
        const pl = d.createPipelineLayout({ bindGroupLayouts: [bgl] }), base = { layout: pl, vertex: { module: shader, entryPoint: 'vs', buffers: layout }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 } };
        this.pipeline = await d.createRenderPipelineAsync(base);
        this.wirePipeline = await d.createRenderPipelineAsync({ ...base, fragment: { module: shader, entryPoint: 'wireFS', targets: [{ format: this.format }] }, primitive: { topology: 'line-list' }, depthStencil: { ...base.depthStencil, depthCompare: 'less-equal' } });
        this.floorPipeline = await d.createRenderPipelineAsync({ ...base, vertex: { module: shader, entryPoint: 'floorVS' }, fragment: { module: shader, entryPoint: 'floorFS', targets: [{ format: this.format }] } });
        const sbgl = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
        this.shadowBind = d.createBindGroup({ layout: sbgl, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
        this.shadowPipeline = await d.createRenderPipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [sbgl] }), vertex: { module: shader, entryPoint: 'shadowVS', buffers: layout }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } });
        return this;
    }
    buffer(array, usage) { const b = this.device.createBuffer({ size: Math.max(4, (array.byteLength + 3) & ~3), usage: usage | GPUBufferUsage.COPY_DST }); if (array.byteLength)
        this.device.queue.writeBuffer(b, 0, array); return b; }
    setMesh(mesh) { for (const b of this.buffers || [])
        b.destroy(); this.mesh = mesh; this.vertices = this.buffer(interleave(mesh), GPUBufferUsage.VERTEX); this.indices = this.buffer(mesh.indices, GPUBufferUsage.INDEX); this.instances = this.buffer(mesh.instances, GPUBufferUsage.VERTEX); this.edgesData = null; this.edges = null; this.buffers = [this.vertices, this.indices, this.instances]; }
    resize() { const w = Math.max(1, Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))), h = Math.max(1, Math.round(this.canvas.clientHeight * Math.min(devicePixelRatio || 1, 2))); if (this.canvas.width === w && this.canvas.height === h && this.depth)
        return; this.canvas.width = w; this.canvas.height = h; this.depth?.destroy(); this.msaa?.destroy(); this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }); this.msaa = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }); }
    render(camera, options = {}) { if (this.error)
        return; this.resize(); const mesh = this.mesh, bounds = options.bounds || mesh?.bounds() || { center: [0, 0, 0], radius: 5, min: [0, 0, 0] }, center = bounds.center, r = Math.max(bounds.radius * 1.1, 3), sun = [.5, .9, .4], lightPos = vadd(center, vscale(normalize(sun), r * 3)), lightVP = multiply(orthographic(-r * 1.4, r * 1.4, -r * 1.4, r * 1.4, .1, r * 7, true), lookAt(lightPos, center)); this.uniformData.set(camera.matrix(this.canvas.width / this.canvas.height, true), 0); this.uniformData.set(lightVP, 16); this.uniformData.set([...camera.eye, 1], 32); this.uniformData.set([mesh?.material.roughness ?? .4, mesh?.material.metallic ?? .2, options.exposure ?? 1, options.mode === 'normals' ? 1 : options.mode === 'unlit' ? 2 : 0], 36); this.uniformData.set([...sun, 1], 40); this.uniformData.set([options.floorY ?? Math.min(0, bounds.min[1] - .03), options.grid === false ? 0 : 1, 0, (options.selectedInstance ?? -1) + 1], 44); this.device.queue.writeBuffer(this.uniform, 0, this.uniformData); const encoder = this.device.createCommandEncoder(); const sp = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }); if (mesh?.indices.length && mesh.instanceCount) {
        sp.setPipeline(this.shadowPipeline);
        sp.setBindGroup(0, this.shadowBind);
        sp.setVertexBuffer(0, this.vertices);
        sp.setVertexBuffer(1, this.instances);
        sp.setIndexBuffer(this.indices, 'uint32');
        sp.drawIndexed(mesh.indices.length, mesh.instanceCount);
    } sp.end(); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: { r: .073, g: .086, b: .101, a: 1 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } }); pass.setBindGroup(0, this.bind); if (options.floor !== false) {
        pass.setPipeline(this.floorPipeline);
        pass.draw(6);
    } if (mesh?.indices.length && mesh.instanceCount) {
        pass.setPipeline(options.mode === 'wire' ? this.wirePipeline : this.pipeline);
        pass.setVertexBuffer(0, this.vertices);
        pass.setVertexBuffer(1, this.instances);
        if (options.mode === 'wire') {
            if (!this.edges) {
                this.edgesData = edgeIndices(mesh);
                this.edges = this.buffer(this.edgesData, GPUBufferUsage.INDEX);
                this.buffers.push(this.edges);
            }
            pass.setIndexBuffer(this.edges, 'uint32');
            pass.drawIndexed(this.edgesData.length, mesh.instanceCount);
        }
        else {
            pass.setIndexBuffer(this.indices, 'uint32');
            pass.drawIndexed(mesh.indices.length, mesh.instanceCount);
        }
    } pass.end(); this.device.queue.submit([encoder.finish()]); }
    destroy() { for (const b of this.buffers || [])
        b.destroy(); this.depth?.destroy(); this.msaa?.destroy(); this.shadow?.destroy(); this.uniform?.destroy(); this.device?.destroy(); }
}
export class WebGLRenderer {
    constructor(canvas) { this.canvas = canvas; this.kind = 'WebGL2 fallback'; this.gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }); if (!this.gl)
        throw Error('Neither WebGPU nor WebGL2 is available'); }
    async init() { const g = this.gl, compile = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS))
        throw Error(g.getShaderInfoLog(s)); return s; }; this.program = g.createProgram(); const vs = compile(g.VERTEX_SHADER, glVertex), fs = compile(g.FRAGMENT_SHADER, glFragment); g.attachShader(this.program, vs); g.attachShader(this.program, fs); g.linkProgram(this.program); if (!g.getProgramParameter(this.program, g.LINK_STATUS))
        throw Error(g.getProgramInfoLog(this.program)); g.deleteShader(vs); g.deleteShader(fs); this.locations = Object.fromEntries(['vp', 'eye', 'material', 'floorMode', 'showGrid'].map(k => [k, g.getUniformLocation(this.program, k)])); this.floorMesh = grid(200, 200, 1, 1); this.floorBuffers = this.upload(this.floorMesh); return this; }
    upload(mesh) { const g = this.gl, vao = g.createVertexArray(); g.bindVertexArray(vao); const bufs = []; function buffer(target, data) { const b = g.createBuffer(); bufs.push(b); g.bindBuffer(target, b); g.bufferData(target, data, g.STATIC_DRAW); return b; } buffer(g.ARRAY_BUFFER, interleave(mesh)); for (let i = 0; i < 3; i++) {
        g.enableVertexAttribArray(i);
        g.vertexAttribPointer(i, 3, g.FLOAT, false, 36, i * 12);
    } buffer(g.ARRAY_BUFFER, mesh.instances); for (let i = 0; i < 5; i++) {
        g.enableVertexAttribArray(i + 3);
        g.vertexAttribPointer(i + 3, 4, g.FLOAT, false, 80, i * 16);
        g.vertexAttribDivisor(i + 3, 1);
    } buffer(g.ELEMENT_ARRAY_BUFFER, mesh.indices); g.bindVertexArray(null); return { vao, bufs, count: mesh.indices.length, instances: mesh.instanceCount }; }
    disposeBuffers(b) { if (!b)
        return; for (const x of b.bufs)
        this.gl.deleteBuffer(x); this.gl.deleteVertexArray(b.vao); }
    setMesh(mesh) { this.disposeBuffers(this.data); this.disposeBuffers(this.wireData); this.wireData = null; this.mesh = mesh; this.data = this.upload(mesh); }
    render(camera, o = {}) { const g = this.gl, w = Math.max(1, Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))), h = Math.max(1, Math.round(this.canvas.clientHeight * Math.min(devicePixelRatio || 1, 2))); if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
    } g.viewport(0, 0, w, h); g.clearColor(.073, .086, .101, 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT); g.enable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.useProgram(this.program); g.uniformMatrix4fv(this.locations.vp, false, camera.matrix(w / h, false)); g.uniform3fv(this.locations.eye, camera.eye); g.uniform4fv(this.locations.material, [this.mesh?.material.roughness ?? .4, this.mesh?.material.metallic ?? .2, o.exposure ?? 1, o.mode === 'normals' ? 1 : o.mode === 'unlit' ? 2 : 0]); g.uniform1f(this.locations.showGrid, o.grid === false ? 0 : 1); if (o.floor !== false) {
        const y = o.floorY ?? Math.min(0, o.bounds?.min[1] - .03 || 0);
        this.floorMesh.instances[13] = y;
        g.bindBuffer(g.ARRAY_BUFFER, this.floorBuffers.bufs[1]);
        g.bufferSubData(g.ARRAY_BUFFER, 0, this.floorMesh.instances);
        g.uniform1f(this.locations.floorMode, 1);
        g.bindVertexArray(this.floorBuffers.vao);
        g.drawElementsInstanced(g.TRIANGLES, 6, g.UNSIGNED_INT, 0, 1);
    } g.uniform1f(this.locations.floorMode, 0); if (this.data) {
        if (o.mode === 'wire') {
            if (!this.wireData)
                this.wireData = this.upload({ ...this.mesh, indices: edgeIndices(this.mesh), vertexCount: this.mesh.vertexCount, instanceCount: this.mesh.instanceCount });
            g.bindVertexArray(this.wireData.vao);
            g.drawElementsInstanced(g.LINES, this.wireData.count, g.UNSIGNED_INT, 0, this.wireData.instances);
        }
        else {
            g.bindVertexArray(this.data.vao);
            g.drawElementsInstanced(g.TRIANGLES, this.data.count, g.UNSIGNED_INT, 0, this.data.instances);
        }
    } g.bindVertexArray(null); }
    destroy() { this.disposeBuffers(this.data); this.disposeBuffers(this.wireData); this.disposeBuffers(this.floorBuffers); this.gl.deleteProgram(this.program); }
}
export class Viewport extends EventTarget {
    constructor(canvas, options = {}) { super(); this.canvas = canvas; this.camera = new OrbitCamera(); this.options = { mode: 'shaded', grid: true, exposure: 1, ...options }; this.dirty = true; this.frames = 0; this.fps = 0; this.lastFps = performance.now(); this.abort = new AbortController(); }
    async init() { let reason = ''; if (this.options.backend !== 'webgl2') {
        try {
            this.renderer = await new WebGPURenderer(this.canvas).init();
        }
        catch (e) {
            reason = e.message;
            if (this.canvas.getContext('webgpu')) {
                const replacement = this.canvas.cloneNode();
                this.canvas.replaceWith(replacement);
                this.canvas = replacement;
            }
        }
    } if (!this.renderer) {
        try {
            this.renderer = await new WebGLRenderer(this.canvas).init();
        }
        catch (e) {
            reason += (reason ? '; ' : '') + e.message;
            const replacement = this.canvas.cloneNode();
            this.canvas.replaceWith(replacement);
            this.canvas = replacement;
            this.renderer = await new SoftwareRenderer(this.canvas).init();
        }
    } this.fallbackReason = reason; this.renderer.onError = e => this.dispatchEvent(new CustomEvent('error', { detail: e })); this.bindCamera(); this.resizeObserver = new ResizeObserver(() => this.invalidate()); this.resizeObserver.observe(this.canvas); const tick = () => { if (this.disposed)
        return; if (this.dirty) {
        this.renderer.render(this.camera, this.options);
        this.dirty = false;
        this.frames++;
    } const now = performance.now(); if (now - this.lastFps > 1000) {
        this.fps = Math.round(this.frames * 1000 / (now - this.lastFps));
        this.frames = 0;
        this.lastFps = now;
    } this.raf = requestAnimationFrame(tick); }; tick(); return this; }
    bindCamera() { const c = this.canvas, signal = this.abort.signal; let drag = null; c.addEventListener('contextmenu', e => e.preventDefault(), { signal }); c.addEventListener('pointerdown', e => { if (e.button > 2)
        return; c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, shift: e.shiftKey }; }, { signal }); c.addEventListener('pointermove', e => { if (!drag)
        return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (drag.button === 1 || drag.button === 2 || drag.shift)
        this.camera.pan(dx, dy);
    else if (this.options.tool !== 'select' || e.altKey) {
        this.camera.yaw -= dx * .007;
        this.camera.pitch = clamp(this.camera.pitch + dy * .007, -1.5, 1.5);
    } drag.x = e.clientX; drag.y = e.clientY; this.invalidate(); }, { signal }); c.addEventListener('pointerup', e => { if (drag && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4 && drag.button === 0) {
        const hit = this.pick(e.clientX, e.clientY);
        this.options.selectedInstance = hit?.instance ?? -1;
        this.dispatchEvent(new CustomEvent('pick', { detail: hit }));
        this.invalidate();
    } drag = null; }, { signal }); c.addEventListener('pointercancel', () => drag = null, { signal }); c.addEventListener('wheel', e => { e.preventDefault(); this.camera.distance = clamp(this.camera.distance * Math.exp(e.deltaY * .001), .15, 1500); this.invalidate(); }, { passive: false, signal }); }
    setMesh(mesh) { this.sourceMesh = mesh; const display = !mesh.indices.length && mesh.vertexCount ? copyToPoints(sphere(.035, 6, 4), mesh, { scale: 1, variation: 0, rotate: false }) : mesh; this.renderer.setMesh(display); this.bounds = display.bounds(); this.options.bounds = this.bounds; this.bvh = null; this.invalidate(); }
    invalidate() { this.dirty = true; this.dispatchEvent(new Event('invalidate')); }
    frame() { if (this.bounds)
        this.camera.frame(this.bounds); this.invalidate(); }
    view(name) { if (name === 'perspective') {
        this.camera.orthographic = false;
        this.camera.yaw = .8;
        this.camera.pitch = .48;
    }
    else {
        this.camera.orthographic = true;
        if (name === 'top') {
            this.camera.pitch = 1.569;
            this.camera.yaw = 0;
        }
        if (name === 'front') {
            this.camera.pitch = 0;
            this.camera.yaw = 0;
        }
        if (name === 'right') {
            this.camera.pitch = 0;
            this.camera.yaw = Math.PI / 2;
        }
    } this.invalidate(); }
    pick(x, y) { if (!this.renderer.mesh?.indices.length)
        return null; const r = this.canvas.getBoundingClientRect(), mx = (x - r.left) / r.width * 2 - 1, my = 1 - (y - r.top) / r.height * 2, m = invert(this.camera.matrix(r.width / r.height, this.renderer.kind === 'WebGPU')), near = transformPoint(m, [mx, my, this.renderer.kind === 'WebGPU' ? 0 : -1]), far = transformPoint(m, [mx, my, 1]); this.bvh ||= new MeshBVH(this.renderer.mesh); return this.bvh.raycast(near, normalize(vsub(far, near))); }
    async snapshot() { this.renderer.render(this.camera, this.options); return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Image capture failed')), 'image/png')); }
    destroy() { this.disposed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.resizeObserver?.disconnect(); this.renderer.destroy(); }
}
