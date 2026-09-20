import { identity, compose, multiply, transformPoint, cross, vsub, normalize, random, clamp } from './math.js';
export const MAX_VERTICES = 1500000;
export const MAX_INSTANCES = 20000;
/** Geometry is a typed-array mesh plus optional 4x4 transforms + RGBA instance tints (stride 20 floats). */
export class Mesh {
    constructor(positions = [], indices = [], options = {}) {
        this.positions = new Float32Array(positions);
        for (let i = 0; i < indices.length; i++) {
            if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] > 0xffffffff)
                throw Error('Triangle indices must be unsigned integers');
        }
        this.indices = new Uint32Array(indices);
        if (this.positions.length % 3 || this.indices.length % 3 || this.positions.length / 3 > MAX_VERTICES)
            throw Error('Invalid vertex count or geometry budget exceeded');
        for (const i of this.indices)
            if (i >= this.positions.length / 3)
                throw Error('Index outside vertex range');
        this.normals = options.normals ? new Float32Array(options.normals) : new Float32Array(this.positions.length);
        this.colors = options.colors ? new Float32Array(options.colors) : new Float32Array(this.positions.length).fill(.68);
        this.uvs = options.uvs ? new Float32Array(options.uvs) : new Float32Array(this.positions.length / 3 * 2);
        this.instances = options.instances ? new Float32Array(options.instances) : new Float32Array([...identity(), 1, 1, 1, 1]);
        this.material = { roughness: .43, metallic: .15, ...options.material };
        this.attributes = options.attributes ? structuredClone(options.attributes) : {};
        if (this.normals.length !== this.positions.length || this.colors.length !== this.positions.length || this.instances.length % 20 || this.instances.length / 20 > MAX_INSTANCES)
            throw Error('Invalid geometry attributes');
        if (this.uvs.length !== this.vertexCount * 2)
            throw Error('Invalid UV count');
        for (const values of [this.positions, this.normals, this.colors, this.uvs, this.instances])
            for (const value of values)
                if (!Number.isFinite(value))
                    throw Error('Non-finite geometry data');
        for (const key of ['roughness', 'metallic'])
            if (!Number.isFinite(this.material[key]) || this.material[key] < 0 || this.material[key] > 1)
                throw Error('Invalid material property');
        if (!options.normals && this.indices.length)
            this.computeNormals();
    }
    get vertexCount() { return this.positions.length / 3; }
    get triangleCount() { return this.indices.length / 3; }
    get instanceCount() { return this.instances.length / 20; }
    clone() { return new Mesh(this.positions, this.indices, this); }
    computeNormals() {
        const p = this.positions, n = this.normals;
        n.fill(0);
        for (let i = 0; i < this.indices.length; i += 3) {
            const a = this.indices[i] * 3, b = this.indices[i + 1] * 3, c = this.indices[i + 2] * 3;
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const j of [a, b, c]) {
                n[j] += nx;
                n[j + 1] += ny;
                n[j + 2] += nz;
            }
        }
        for (let i = 0; i < n.length; i += 3) {
            const d = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
            if (!Number.isFinite(d)) throw Error('Geometry exceeds normal computation range');
            n[i] /= d;
            n[i + 1] /= d;
            n[i + 2] /= d;
        }
        return this;
    }
    bounds() { let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < this.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], this.positions[i + k]);
            max[k] = Math.max(max[k], this.positions[i + k]);
        } if (!this.vertexCount || !this.instanceCount)
        return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 }; let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let j = 0; j < this.instances.length; j += 20)
        for (let i = 0; i < 8; i++) {
            const p = transformPoint(this.instances.subarray(j, j + 16), [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
            for (let k = 0; k < 3; k++) {
                lo[k] = Math.min(lo[k], p[k]);
                hi[k] = Math.max(hi[k], p[k]);
            }
        } return { min: lo, max: hi, center: lo.map((x, k) => (x + hi[k]) / 2), radius: Math.hypot(...hi.map((x, k) => x - lo[k])) / 2 }; }
}
export function realize(mesh) { if (mesh.vertexCount * mesh.instanceCount > MAX_VERTICES)
    throw Error('Realized geometry exceeds 1.5M vertex safety budget. Reduce copies or resolution.'); const p = [], idx = [], col = [], uv = []; for (let j = 0; j < mesh.instances.length; j += 20) {
    const offset = p.length / 3, m = mesh.instances.subarray(j, j + 16);
    for (let i = 0; i < mesh.positions.length; i += 3) {
        p.push(...transformPoint(m, mesh.positions.subarray(i, i + 3)));
        col.push(mesh.colors[i] * mesh.instances[j + 16], mesh.colors[i + 1] * mesh.instances[j + 17], mesh.colors[i + 2] * mesh.instances[j + 18]);
    }
    for (const i of mesh.indices)
        idx.push(i + offset);
    for (const value of mesh.uvs)
        uv.push(value);
} return new Mesh(p, idx, { colors: col, uvs: uv, material: mesh.material }); }
export function merge(meshes) { const p = [], idx = [], col = [], uv = []; for (const source of meshes.filter(Boolean)) {
    const m = realize(source), off = p.length / 3;
    if (off + m.vertexCount > MAX_VERTICES)
        throw Error('Merged geometry exceeds budget');
    for (const v of m.positions)
        p.push(v);
    for (const i of m.indices)
        idx.push(i + off);
    for (const v of m.colors)
        col.push(v);
    for (const v of m.uvs)
        uv.push(v);
} return new Mesh(p, idx, { colors: col, uvs: uv, material: meshes[0]?.material }); }
export function transform(mesh, t, r, s) { const out = mesh.clone(), m = compose(t, r, s); for (let j = 0; j < out.instances.length; j += 20)
    out.instances.set(multiply(m, out.instances.subarray(j, j + 16)), j); return out; }
export function deform(mesh, fn) { const out = realize(mesh); for (let i = 0; i < out.positions.length; i += 3) {
    const p = fn(out.positions[i], out.positions[i + 1], out.positions[i + 2], i / 3);
    if (p.length !== 3 || p.some(v => !Number.isFinite(v)))
        throw Error('Deformation produced non-finite coordinates');
    out.positions.set(p, i);
} return out.computeNormals(); }
export function subdivide(mesh, iterations = 1) { let m = realize(mesh); for (let pass = 0; pass < clamp(iterations | 0, 0, 4); pass++) {
    const p = Array.from(m.positions), c = Array.from(m.colors), uv = Array.from(m.uvs), idx = [], edges = new Map();
    const mid = (a, b) => { const key = a < b ? `${a},${b}` : `${b},${a}`; if (edges.has(key))
        return edges.get(key); const n = p.length / 3; if (n >= MAX_VERTICES)
        throw Error('Subdivision exceeds geometry budget'); for (let k = 0; k < 3; k++) {
        p.push((m.positions[a * 3 + k] + m.positions[b * 3 + k]) * .5);
        c.push((m.colors[a * 3 + k] + m.colors[b * 3 + k]) * .5);
    } for (let k = 0; k < 2; k++)
        uv.push((m.uvs[a * 2 + k] + m.uvs[b * 2 + k]) * .5); edges.set(key, n); return n; };
    for (let i = 0; i < m.indices.length; i += 3) {
        const [a, b, c] = m.indices.subarray(i, i + 3), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    m = new Mesh(p, idx, { colors: c, uvs: uv, material: m.material });
} return m; }
export function smooth(mesh, iterations = 2, amount = .5) { const out = realize(mesh), neighbors = Array.from({ length: out.vertexCount }, () => new Set()); for (let i = 0; i < out.indices.length; i += 3) {
    const [a, b, c] = out.indices.subarray(i, i + 3);
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
} for (let it = 0; it < iterations; it++) {
    const p = new Float32Array(out.positions);
    for (let i = 0; i < out.vertexCount; i++) {
        const ns = neighbors[i];
        if (!ns.size)
            continue;
        for (let k = 0; k < 3; k++) {
            let sum = 0;
            for (const j of ns)
                sum += p[j * 3 + k];
            out.positions[i * 3 + k] = p[i * 3 + k] * (1 - amount) + sum / ns.size * amount;
        }
    }
} return out.computeNormals(); }
export function scatter(mesh, count = 100, seed = 1, minHeight = -1000) { const m = realize(mesh), rng = random(seed), cdf = [], tri = []; let area = 0; for (let i = 0; i < m.indices.length; i += 3) {
    const ids = m.indices.subarray(i, i + 3), a = m.positions.subarray(ids[0] * 3, ids[0] * 3 + 3), b = m.positions.subarray(ids[1] * 3, ids[1] * 3 + 3), c = m.positions.subarray(ids[2] * 3, ids[2] * 3 + 3);
    if ((a[1] + b[1] + c[1]) / 3 < minHeight)
        continue;
    area += Math.hypot(...cross(vsub(b, a), vsub(c, a))) / 2;
    cdf.push(area);
    tri.push(ids);
} if (!area)
    throw Error('Scatter needs a nonzero surface area above its minimum height'); const p = []; for (let i = 0; i < count; i++) {
    const q = rng() * area;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cdf[mid] < q)
            lo = mid + 1;
        else
            hi = mid;
    }
    const ids = tri[lo], s = Math.sqrt(rng()), u = 1 - s, v = s * (1 - rng()), w = 1 - u - v;
    for (let k = 0; k < 3; k++)
        p.push(m.positions[ids[0] * 3 + k] * u + m.positions[ids[1] * 3 + k] * v + m.positions[ids[2] * 3 + k] * w);
} return new Mesh(p, []); }
export function copyToPoints(source, points, { scale = 1, variation = .3, seed = 1, rotate = true } = {}) { const src = realize(source), pts = realize(points), rng = random(seed); if (pts.vertexCount > MAX_INSTANCES)
    throw Error('Copy count exceeds 20,000 instance budget'); const inst = new Float32Array(pts.vertexCount * 20); for (let i = 0; i < pts.vertexCount; i++) {
    const s = Math.max(.001, scale * (1 + (rng() * 2 - 1) * variation)), m = compose(Array.from(pts.positions.subarray(i * 3, i * 3 + 3)), [0, rotate ? rng() * 360 : 0, 0], [s, s * (1 + (rng() * 2 - 1) * variation * .52), s]);
    inst.set(m, i * 20);
    const tint = 1 + (rng() * 2 - 1) * variation * .4;
    inst.set([tint, tint, tint, 1], i * 20 + 16);
} src.instances = inst; return src; }
export function exportOBJ(mesh) { const m = realize(mesh), lines = ['# Stratum FX geometry; meters; right-handed Y-up']; for (let i = 0; i < m.positions.length; i += 3)
    lines.push(`v ${Array.from(m.positions.subarray(i, i + 3)).join(' ')}`); for (let i = 0; i < m.normals.length; i += 3)
    lines.push(`vn ${Array.from(m.normals.subarray(i, i + 3)).join(' ')}`); for (let i = 0; i < m.uvs.length; i += 2)
    lines.push(`vt ${m.uvs[i]} ${m.uvs[i + 1]}`); for (let i = 0; i < m.indices.length; i += 3)
    lines.push('f ' + Array.from(m.indices.subarray(i, i + 3), v => `${v + 1}/${v + 1}/${v + 1}`).join(' ')); return lines.join('\n'); }
export function importOBJ(text) {
    if (text.length > 24000000)
        throw Error('OBJ exceeds 24 MB import budget');
    const p = [], uv = [], norm = [], out = [], outuv = [], outn = [], idx = [], map = new Map();
    let hasNormals = true;
    const index = (s, len) => { const n = Number(s); if (!Number.isInteger(n) || n === 0)
        throw Error('Invalid OBJ index'); const i = n > 0 ? n - 1 : len + n; if (i < 0 || i >= len)
        throw Error('OBJ index out of bounds'); return i; };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        if (!line)
            continue;
        const [type, ...v] = line.split(/\s+/);
        if (type === 'v' || type === 'vn') {
            if (v.length < 3 || v.slice(0, 3).some(x => !Number.isFinite(+x)))
                throw Error('Invalid OBJ coordinates');
            (type === 'v' ? p : norm).push(v.slice(0, 3).map(Number));
        }
        else if (type === 'vt') {
            if (!v.length || v.slice(0, 2).some(x => !Number.isFinite(+x)))
                throw Error('Invalid OBJ UV coordinates');
            uv.push([+v[0], +(v[1] || 0)]);
        }
        else if (type === 'f') {
            if (v.length < 3)
                throw Error('Invalid OBJ face');
            const face = v.map(s => { const [a, b, c] = s.split('/'), pi = index(a, p.length), ui = b ? index(b, uv.length) : -1, ni = c ? index(c, norm.length) : -1, key = `${pi}/${ui}/${ni}`; if (!map.has(key)) {
                map.set(key, out.length / 3);
                out.push(...p[pi]);
                outuv.push(...(uv[ui] || [0, 0]));
                outn.push(...(norm[ni] || [0, 0, 0]));
                if (ni < 0)
                    hasNormals = false;
            } return map.get(key); });
            for (let i = 1; i < face.length - 1; i++)
                idx.push(face[0], face[i], face[i + 1]);
        }
    }
    if (!out.length && p.length) {
        for (const v of p)
            out.push(...v);
        return new Mesh(out, []);
    }
    return new Mesh(out, idx, { uvs: outuv, ...(hasNormals ? { normals: outn } : {}) });
}
export function exportSTL(mesh) { const m = realize(mesh), buf = new ArrayBuffer(84 + m.triangleCount * 50), d = new DataView(buf); d.setUint32(80, m.triangleCount, true); for (let t = 0; t < m.triangleCount; t++) {
    const ids = m.indices.subarray(t * 3, t * 3 + 3), a = m.positions.subarray(ids[0] * 3, ids[0] * 3 + 3), b = m.positions.subarray(ids[1] * 3, ids[1] * 3 + 3), c = m.positions.subarray(ids[2] * 3, ids[2] * 3 + 3), n = normalize(cross(vsub(b, a), vsub(c, a)));
    [...n, ...a, ...b, ...c].forEach((v, k) => d.setFloat32(84 + t * 50 + k * 4, v, true));
} return buf; }
