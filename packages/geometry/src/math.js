/** Column-major, right-handed math. Matrices multiply column vectors. */
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => vscale(a, 1 / (length(a) || 1));
export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let row = 0; row < 4; row++)
            for (let k = 0; k < 4; k++)
                r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
    return r;
}
export function transformPoint(m, p) { const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1; return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w, (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w]; }
export function compose(t = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    const [x, y, z] = r.map(a => a * Math.PI / 180), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    return new Float32Array([(cy * cz) * s[0], (cy * sz) * s[0], -sy * s[0], 0, (sx * sy * cz - cx * sz) * s[1], (sx * sy * sz + cx * cz) * s[1], sx * cy * s[1], 0, (cx * sy * cz + sx * sz) * s[2], (cx * sy * sz - sx * cz) * s[2], cx * cy * s[2], 0, ...t, 1]);
}
export function lookAt(eye, target, up = [0, 1, 0]) { const z = normalize(vsub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]); }
export function perspective(fov, aspect, near = .05, far = 1000, webgpu = true) { const f = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = f / aspect; m[5] = f; m[10] = webgpu ? far / (near - far) : (far + near) / (near - far); m[11] = -1; m[14] = webgpu ? near * far / (near - far) : 2 * near * far / (near - far); return m; }
export function orthographic(l, r, b, t, n, f, webgpu = true) { const m = identity(); m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = (webgpu ? 1 : 2) / (n - f); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = webgpu ? n / (n - f) : (f + n) / (n - f); return m; }
export function invert(a) {
    const v = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? a[c * 4 + r] : +(c - 4 === r)));
    for (let c = 0; c < 4; c++) {
        let pivot = c;
        for (let r = c + 1; r < 4; r++)
            if (Math.abs(v[r][c]) > Math.abs(v[pivot][c]))
                pivot = r;
        if (Math.abs(v[pivot][c]) < 1e-12)
            throw Error('Singular matrix');
        [v[c], v[pivot]] = [v[pivot], v[c]];
        const d = v[c][c];
        v[c] = v[c].map(x => x / d);
        for (let r = 0; r < 4; r++)
            if (r !== c) {
                const f = v[r][c];
                v[r] = v[r].map((x, k) => x - f * v[c][k]);
            }
    }
    return new Float32Array(Array.from({ length: 16 }, (_, i) => v[i % 4][4 + Math.floor(i / 4)]));
}
export function random(seed = 1) { let a = seed | 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function hash3(x, y, z, seed = 0) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1; }
export function noise(x, y, z = 0, seed = 0) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), smooth = t => t * t * t * (t * (t * 6 - 15) + 10), u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz); let ns = []; for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
        ns.push(lerp(hash3(ix, iy + j, iz + k, seed), hash3(ix + 1, iy + j, iz + k, seed), u)); return lerp(lerp(ns[0], ns[1], v), lerp(ns[2], ns[3], v), w); }
export function fbm(x, y, z = 0, octaves = 4, seed = 0) { let value = 0, a = .5, n = 0; for (let i = 0; i < octaves; i++) {
    value += noise(x, y, z, seed + i) * a;
    n += a;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    a *= .5;
} return value / (n || 1); }
export function hexColor(s) { if (!/^#[\da-f]{6}$/i.test(s))
    return [.5, .65, .7]; return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255); }
