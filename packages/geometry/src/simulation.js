import { grid, sphere, box } from './primitives.js';
import { Mesh, copyToPoints } from './mesh.js';
import { random, compose, clamp } from './math.js';
/** Deterministic ballistic emitter. Plane impacts preserve restitution; this is not a fluid solver. */
export function particles({ count = 1600, seed = 8, speed = 7, spread = 2.5, gravity = 9.81, lifetime = 3.5, size = .045 }, time) { const rng = random(seed), p = [], v = []; for (let i = 0; i < count; i++) {
    const phase = rng() * lifetime, angle = rng() * Math.PI * 2, r = rng() * spread, vy = speed * (.7 + rng() * .6), age = ((time + phase) % lifetime + lifetime) % lifetime;
    let y = vy * age - .5 * gravity * age * age;
    const hit = 2 * vy / gravity;
    if (age > hit) {
        const a = age - hit;
        y = vy * .4 * a - .5 * gravity * a * a;
    }
    p.push(Math.cos(angle) * r * age, Math.max(size, y), Math.sin(angle) * r * age);
    v.push(Math.cos(angle) * r, vy - gravity * age, Math.sin(angle) * r);
} const pts = new Mesh(p, [], { attributes: { velocity: v } }), mesh = copyToPoints(sphere(size, 6, 4), pts, { scale: 1, variation: .45, seed }); mesh.colors.fill(1); mesh.material = { roughness: .25, metallic: .5 }; for (let i = 0; i < mesh.instances.length; i += 20) {
    const y = mesh.instances[i + 13];
    mesh.instances.set([.28 + y * .11, .58 + y * .035, .72 - y * .04, 1], i + 16);
} return mesh; }
/** Position-based cloth: Verlet integration, structural/shear constraints, floor + spherical collider. */
export class ClothSolver {
    constructor({ resolution = 20, width = 5, height = 4, wind = 1.8, gravity = 9.81, damping = .99, iterations = 7, collider = 1.2 } = {}) { this.params = { resolution, width, height, wind, gravity, damping, iterations, collider }; this.mesh = grid(width, height, resolution, resolution); const p = this.mesh.positions; for (let i = 0; i < p.length; i += 3) {
        p[i + 1] = height + 1 - (p[i + 2] + height / 2);
        p[i + 2] = 0;
    } this.previous = new Float32Array(p); this.rest = new Float32Array(p); this.constraints = []; const n = resolution + 1; const add = (a, b) => { const d = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]); this.constraints.push([a, b, d]); }; for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const a = y * n + x;
            if (x + 1 < n)
                add(a, a + 1);
            if (y + 1 < n)
                add(a, a + n);
            if (x + 1 < n && y + 1 < n) {
                add(a, a + n + 1);
                add(a + 1, a + n);
            }
            if (x + 2 < n)
                add(a, a + 2);
            if (y + 2 < n)
                add(a, a + n * 2);
        } this.stepIndex = 0; }
    pinned(i) { return i === 0 || i === this.params.resolution; }
    step() { const { gravity, wind, damping, iterations, collider } = this.params, p = this.mesh.positions, dt = 1 / 60, t = this.stepIndex * dt; for (let i = 0; i < p.length; i += 3) {
        if (this.pinned(i / 3))
            continue;
        const old = [p[i], p[i + 1], p[i + 2]];
        p[i] += (p[i] - this.previous[i]) * damping + Math.sin(t * 2 + p[i + 1]) * wind * .15 * dt * dt;
        p[i + 1] += (p[i + 1] - this.previous[i + 1]) * damping - gravity * dt * dt;
        p[i + 2] += (p[i + 2] - this.previous[i + 2]) * damping + (Math.sin(t * 2.1 + p[i] * .7) + 1.2) * wind * dt * dt;
        this.previous.set(old, i);
    } for (let it = 0; it < iterations; it++) {
        for (const [a, b, rest] of this.constraints) {
            const ai = a * 3, bi = b * 3, dx = p[bi] - p[ai], dy = p[bi + 1] - p[ai + 1], dz = p[bi + 2] - p[ai + 2], d = Math.hypot(dx, dy, dz) || 1, wa = this.pinned(a) ? 0 : 1, wb = this.pinned(b) ? 0 : 1, f = (d - rest) / d / Math.max(1, wa + wb);
            for (let k = 0; k < 3; k++) {
                const delta = [dx, dy, dz][k] * f;
                p[ai + k] += delta * wa;
                p[bi + k] -= delta * wb;
            }
        }
        for (let i = 0; i < p.length; i += 3) {
            if (this.pinned(i / 3)) {
                p.set(this.rest.subarray(i, i + 3), i);
                continue;
            }
            p[i + 1] = Math.max(.04, p[i + 1]);
            const x = p[i], y = p[i + 1] - 1.6, z = p[i + 2] - .75, d = Math.hypot(x, y, z);
            if (collider > 0 && d < collider) {
                const s = collider / (d || 1);
                p[i] = x * s;
                p[i + 1] = 1.6 + y * s;
                p[i + 2] = .75 + z * s;
            }
        }
    } this.stepIndex++; }
    at(time) { const target = Math.min(900, Math.max(0, Math.round(time * 60))); if (target < this.stepIndex) {
        this.mesh.positions.set(this.rest);
        this.previous.set(this.rest);
        this.stepIndex = 0;
    } while (this.stepIndex < target)
        this.step(); return this.mesh.clone().computeNormals(); }
}
/** Discrete equal-mass sphere collision solver. Visual bodies and collision shapes are spheres. */
export class RigidSolver {
    constructor({ count = 80, seed = 1, radius = .18, gravity = 9.81, restitution = .5 } = {}) { this.params = { count, seed, radius, gravity, restitution }; this.positions = new Float32Array(count * 3); this.velocities = new Float32Array(count * 3); const rng = random(seed); for (let i = 0; i < count; i++) {
        this.positions.set([(rng() - .5) * 4, 2 + i * radius * .8, (rng() - .5) * 4], i * 3);
        this.velocities.set([(rng() - .5) * .5, 0, (rng() - .5) * .5], i * 3);
    } this.initial = new Float32Array(this.positions); this.initialV = new Float32Array(this.velocities); this.stepIndex = 0; }
    step() { const p = this.positions, v = this.velocities, { gravity, radius: r, restitution: e, count } = this.params, dt = 1 / 120; for (let i = 0; i < count; i++) {
        v[i * 3 + 1] -= gravity * dt;
        for (let k = 0; k < 3; k++)
            p[i * 3 + k] += v[i * 3 + k] * dt;
        if (p[i * 3 + 1] < r) {
            p[i * 3 + 1] = r;
            if (v[i * 3 + 1] < 0)
                v[i * 3 + 1] *= -e;
            v[i * 3] *= .98;
            v[i * 3 + 2] *= .98;
        }
    } const cells = new Map(), cell = 2 * r; for (let i = 0; i < count; i++) {
        const x = Math.floor(p[i * 3] / cell), y = Math.floor(p[i * 3 + 1] / cell), z = Math.floor(p[i * 3 + 2] / cell);
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                    for (const j of cells.get(`${x + dx},${y + dy},${z + dz}`) || []) {
                        const d = [p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]], len = Math.hypot(...d);
                        if (len > 0 && len < 2 * r) {
                            const n = d.map(x => x / len), over = (2 * r - len) * .5, rv = n.reduce((sum, x, k) => sum + x * (v[i * 3 + k] - v[j * 3 + k]), 0);
                            for (let k = 0; k < 3; k++) {
                                p[i * 3 + k] += n[k] * over;
                                p[j * 3 + k] -= n[k] * over;
                                if (rv < 0) {
                                    const impulse = -(1 + e) * rv * .5;
                                    v[i * 3 + k] += impulse * n[k];
                                    v[j * 3 + k] -= impulse * n[k];
                                }
                            }
                        }
                    }
                }
        const key = `${x},${y},${z}`;
        if (!cells.has(key))
            cells.set(key, []);
        cells.get(key).push(i);
    } this.stepIndex++; }
    at(time) {
        const target = clamp(Math.round(time * 120), 0, 2400);
        if (target < this.stepIndex) {
            this.positions.set(this.initial);
            this.velocities.set(this.initialV);
            this.stepIndex = 0;
        }
        while (this.stepIndex < target)
            this.step();
        const mesh = copyToPoints(sphere(this.params.radius, 12, 8), new Mesh(this.positions, []), { variation: 0, rotate: false, seed: this.params.seed }); // Uniform scale is required for collision/render agreement.
        for (let i = 0; i < mesh.instances.length; i += 20) {
            const t = Array.from(mesh.instances.subarray(i + 12, i + 15));
            mesh.instances.set(compose(t), i);
        }
        return mesh;
    }
}
