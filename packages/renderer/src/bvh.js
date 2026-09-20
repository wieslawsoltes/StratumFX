import { invert, transformPoint, normalize, vsub, vadd, vscale, cross, dot } from '../../geometry/src/math.js';
function boxHit(origin, dir, min, max) { let lo = 0, hi = Infinity; for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
        if (origin[k] < min[k] || origin[k] > max[k])
            return false;
        continue;
    }
    let a = (min[k] - origin[k]) / dir[k], b = (max[k] - origin[k]) / dir[k];
    if (a > b)
        [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (hi < lo)
        return false;
} return true; }
export class MeshBVH {
    constructor(mesh) { this.mesh = mesh; const p = mesh.positions, indices = mesh.indices; const tris = Array.from({ length: indices.length / 3 }, (_, i) => i), centers = tris.map(t => [0, 1, 2].map(k => (p[indices[t * 3] * 3 + k] + p[indices[t * 3 + 1] * 3 + k] + p[indices[t * 3 + 2] * 3 + k]) / 3)); const build = ids => { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const t of ids)
        for (let v = 0; v < 3; v++)
            for (let k = 0; k < 3; k++) {
                const value = p[indices[t * 3 + v] * 3 + k];
                min[k] = Math.min(min[k], value);
                max[k] = Math.max(max[k], value);
            } const node = { min, max }; if (ids.length <= 12) {
        node.ids = ids;
        return node;
    } const extent = max.map((x, k) => x - min[k]), axis = extent.indexOf(Math.max(...extent)); ids.sort((a, b) => centers[a][axis] - centers[b][axis]); const mid = ids.length >>> 1; node.left = build(ids.slice(0, mid)); node.right = build(ids.slice(mid)); return node; }; this.root = tris.length ? build(tris) : null; this.inverses = []; for (let i = 0; i < mesh.instances.length; i += 20) {
        try {
            this.inverses.push(invert(mesh.instances.subarray(i, i + 16)));
        }
        catch {
            this.inverses.push(null);
        }
    } }
    raycast(origin, direction) { let best = null; const p = this.mesh.positions, idx = this.mesh.indices; for (let ins = 0; ins < this.inverses.length; ins++) {
        const inv = this.inverses[ins];
        if (!inv)
            continue;
        const o = transformPoint(inv, origin), d = normalize(vsub(transformPoint(inv, vadd(origin, direction)), o));
        const walk = node => { if (!node || !boxHit(o, d, node.min, node.max))
            return; if (node.ids) {
            for (const t of node.ids) {
                const a = Array.from(p.subarray(idx[t * 3] * 3, idx[t * 3] * 3 + 3)), b = Array.from(p.subarray(idx[t * 3 + 1] * 3, idx[t * 3 + 1] * 3 + 3)), c = Array.from(p.subarray(idx[t * 3 + 2] * 3, idx[t * 3 + 2] * 3 + 3)), e1 = vsub(b, a), e2 = vsub(c, a), h = cross(d, e2), det = dot(e1, h);
                if (Math.abs(det) < 1e-8)
                    continue;
                const f = 1 / det, s = vsub(o, a), u = f * dot(s, h);
                if (u < 0 || u > 1)
                    continue;
                const q = cross(s, e1), v = f * dot(d, q);
                if (v < 0 || u + v > 1)
                    continue;
                const distance = f * dot(e2, q);
                if (distance < 0)
                    continue;
                const point = transformPoint(this.mesh.instances.subarray(ins * 20, ins * 20 + 16), vadd(o, vscale(d, distance))), worldDist = Math.hypot(...vsub(point, origin));
                if (!best || worldDist < best.distance)
                    best = { distance: worldDist, point, triangle: t, instance: ins, barycentric: [1 - u - v, u, v] };
            }
        }
        else {
            walk(node.left);
            walk(node.right);
        } };
        walk(this.root);
    } return best; }
}
