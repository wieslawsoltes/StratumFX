import { Mesh } from './mesh.js';
import { fbm, clamp, hexColor, lerp } from './math.js';
export function box(size = [1, 1, 1]) { const p = [], idx = [], uv = [], faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]]; for (const [n, u, v] of faces) {
    const o = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let k = 0; k < 3; k++)
            p.push((n[k] + u[k] * a + v[k] * b) * size[k] / 2);
        uv.push((a + 1) / 2, (b + 1) / 2);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
} return new Mesh(p, idx, { uvs: uv }); }
export function sphere(radius = 1, segments = 32, rings = 20) { const p = [], idx = [], uv = []; for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= segments; i++) {
        const t = j / rings * Math.PI, a = i / segments * Math.PI * 2;
        p.push(Math.sin(t) * Math.cos(a) * radius, Math.cos(t) * radius, Math.sin(t) * Math.sin(a) * radius);
        uv.push(i / segments, j / rings);
    } for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i, b = a + segments + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
    } return new Mesh(p, idx, { normals: p.map(v => v / (radius || 1)), uvs: uv }); }
export function grid(width = 10, depth = 10, rows = 40, cols = 40) { const p = [], idx = [], uv = []; for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
        p.push((i / cols - .5) * width, 0, (j / rows - .5) * depth);
        uv.push(i / cols, j / rows);
    } for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + cols + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
    } return new Mesh(p, idx, { uvs: uv }); }
export function torus(radius = 2, tube = .45, segments = 80, sides = 16) { const p = [], idx = [], uv = []; for (let j = 0; j <= segments; j++)
    for (let i = 0; i <= sides; i++) {
        const a = j / segments * Math.PI * 2, b = i / sides * Math.PI * 2;
        p.push((radius + tube * Math.cos(b)) * Math.cos(a), tube * Math.sin(b), (radius + tube * Math.cos(b)) * Math.sin(a));
        uv.push(j / segments, i / sides);
    } for (let j = 0; j < segments; j++)
    for (let i = 0; i < sides; i++) {
        const a = j * (sides + 1) + i, b = a + sides + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
    } return new Mesh(p, idx, { uvs: uv }); }
export function cylinder(radius = .5, height = 1, segments = 24, topRadius = radius) { const p = [], idx = [], uv = []; for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI * 2;
    for (let j = 0; j < 2; j++) {
        const r = j ? topRadius : radius;
        p.push(Math.cos(a) * r, j * height, Math.sin(a) * r);
        uv.push(i / segments, j);
    }
} for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
} for (let top = 0; top < 2; top++) {
    const start = p.length / 3;
    p.push(0, top * height, 0);
    uv.push(.5, .5);
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2, r = top ? topRadius : radius;
        p.push(Math.cos(a) * r, top * height, Math.sin(a) * r);
        uv.push(Math.cos(a) * .5 + .5, Math.sin(a) * .5 + .5);
    }
    for (let i = 0; i < segments; i++)
        if (top)
            idx.push(start, start + i + 2, start + i + 1);
        else
            idx.push(start, start + i + 1, start + i + 2);
} return new Mesh(p, idx, { uvs: uv }); }
export function terrain({ size = 12, resolution = 64, height = 2, frequency = .35, octaves = 5, seed = 42, island = true } = {}) { const m = grid(size, size, resolution, resolution), low = hexColor('#294e50'), high = hexColor('#b8bb96'); for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], z = m.positions[i + 2], rad = Math.hypot(x, z) / (size * .51), falloff = island ? Math.max(0, 1 - Math.pow(rad, 3)) : 1;
    const y = (fbm(x * frequency, z * frequency, 0, octaves, seed) * .65 + .4) * height * falloff + (island ? -.35 : 0);
    m.positions[i + 1] = y;
    const t = clamp((y + .2) / Math.max(.01, height), 0, 1);
    for (let k = 0; k < 3; k++)
        m.colors[i + k] = lerp(low[k], high[k], t);
} return m.computeNormals(); }
export function helix({ radius = 2, height = 4, turns = 3, tube = .12, segments = 180, sides = 8 } = {}) { const p = [], idx = []; for (let j = 0; j <= segments; j++) {
    const a = j / segments * Math.PI * 2 * turns;
    for (let i = 0; i <= sides; i++) {
        const b = i / sides * Math.PI * 2;
        p.push((radius + tube * Math.cos(b)) * Math.cos(a), j / segments * height + tube * Math.sin(b), (radius + tube * Math.cos(b)) * Math.sin(a));
    }
} for (let j = 0; j < segments; j++)
    for (let i = 0; i < sides; i++) {
        const a = j * (sides + 1) + i, b = a + sides + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
    } return new Mesh(p, idx); }
