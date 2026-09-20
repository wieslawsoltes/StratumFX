import { Mesh, deform, transform, merge, realize, subdivide, smooth, scatter, copyToPoints, importOBJ } from '../../geometry/src/mesh.js';
import { box, sphere, grid, torus, cylinder, terrain, helix } from '../../geometry/src/primitives.js';
import { particles, ClothSolver, RigidSolver } from '../../geometry/src/simulation.js';
import { fbm, hexColor, clamp, lerp } from '../../geometry/src/math.js';
import { compileExpression } from './expression.js';
const num = (label, value, min = -100, max = 100, step = .1) => ({ type: 'number', label, default: value, min, max, step });
const vec = (label, value) => ({ type: 'vector', label, default: value, min: -10000, max: 10000, step: .1 });
const bool = (label, value) => ({ type: 'boolean', label, default: value });
const color = (label, value) => ({ type: 'color', label, default: value });
const text = (label, value) => ({ type: 'text', label, default: value });
const enumeration = (label, value, options) => ({ type: 'enum', label, default: value, options });
export class NodeRegistry {
    constructor() { this.definitions = new Map(); }
    register(type, definition) { if (!/^[a-z][a-z0-9_]*$/i.test(type) || this.definitions.has(type))
        throw Error('Invalid or duplicate node type'); if (typeof definition.cook !== 'function')
        throw Error('Node requires a cook function'); this.definitions.set(type, { type, category: 'Utility', icon: '◇', inputs: 1, params: {}, ...definition }); return this; }
    get(type) { const d = this.definitions.get(type); if (!d)
        throw Error(`Unsupported node type: ${type}`); return d; }
    list() { return [...this.definitions.values()]; }
    defaults(type) { return Object.fromEntries(Object.entries(this.get(type).params).map(([k, v]) => [k, structuredClone(v.default)])); }
}
export function createRegistry() {
    const r = new NodeRegistry();
    const add = (type, label, category, icon, inputs, params, cook, extra = {}) => r.register(type, { label, category, icon, inputs, params, cook, ...extra });
    add('box', 'Box', 'Create', '▣', 0, { size: vec('Size', [1, 1, 1]) }, (p) => box(p.size));
    add('sphere', 'Sphere', 'Create', '◉', 0, { radius: num('Radius', 1, .01, 100), segments: num('Columns', 32, 6, 160, 1), rings: num('Rows', 20, 4, 100, 1) }, p => sphere(p.radius, p.segments | 0, p.rings | 0));
    add('grid', 'Grid', 'Create', '▦', 0, { width: num('Width', 10, .01, 200), depth: num('Depth', 10, .01, 200), rows: num('Rows', 24, 1, 256, 1), columns: num('Columns', 24, 1, 256, 1) }, p => grid(p.width, p.depth, p.rows | 0, p.columns | 0));
    add('torus', 'Torus', 'Create', '◎', 0, { radius: num('Major radius', 2, .01, 100), tube: num('Minor radius', .45, .01, 20), segments: num('Segments', 80, 8, 256, 1), sides: num('Cross section', 16, 3, 64, 1) }, p => torus(p.radius, p.tube, p.segments | 0, p.sides | 0));
    add('cylinder', 'Cylinder', 'Create', '▥', 0, { radius: num('Bottom radius', .5, .01, 100), topRadius: num('Top radius', .5, 0, 100), height: num('Height', 1, .01, 100), segments: num('Sides', 24, 3, 128, 1) }, p => cylinder(p.radius, p.height, p.segments | 0, p.topRadius));
    add('helix', 'Helix sweep', 'Create', '〰', 0, { radius: num('Radius', 2, .01, 100), height: num('Height', 4, 0, 100), turns: num('Turns', 3, .1, 20), tube: num('Tube radius', .12, .005, 2), segments: num('Segments', 180, 12, 800, 1), sides: num('Cross section', 8, 3, 32, 1) }, p => helix(p));
    add('terrain', 'Heightfield', 'Terrain', '▱', 0, { size: num('Size', 12, 1, 200), resolution: num('Resolution', 64, 4, 256, 1), height: num('Height', 2, 0, 30), frequency: num('Frequency', .35, .01, 5, .01), octaves: num('Octaves', 5, 1, 8, 1), seed: num('Seed', 42, 0, 100000, 1), island: bool('Island falloff', true) }, p => terrain(p));
    add('transform', 'Transform', 'Modify', '✥', 1, { translate: vec('Translate', [0, 0, 0]), rotate: vec('Rotate', [0, 0, 0]), scale: vec('Scale', [1, 1, 1]) }, (p, [m]) => transform(m, p.translate, p.rotate, p.scale));
    add('noise', 'Attribute noise', 'Modify', '≈', 1, { amplitude: num('Amplitude', .4, 0, 20), frequency: num('Frequency', 1, .01, 20), octaves: num('Octaves', 4, 1, 8, 1), seed: num('Seed', 5, 0, 10000, 1), axis: enumeration('Displacement', 'normal', ['normal', 'y', 'all']), speed: num('Animation speed', 0, -10, 10) }, (p, [m], ctx) => { const src = realize(m); return deform(src, (x, y, z, i) => { const n = fbm(x * p.frequency, y * p.frequency, z * p.frequency + ctx.time * p.speed, p.octaves, p.seed) * p.amplitude; if (p.axis === 'y')
        return [x, y + n, z]; if (p.axis === 'normal')
        return [x + src.normals[i * 3] * n, y + src.normals[i * 3 + 1] * n, z + src.normals[i * 3 + 2] * n]; return [x + n, y + fbm(x + 17, y, z + ctx.time * p.speed, p.octaves, p.seed) * p.amplitude, z + fbm(x, y + 31, z, p.octaves, p.seed) * p.amplitude]; }); }, { timeDependent: p => p.speed !== 0 });
    add('twist', 'Twist', 'Modify', '⤨', 1, { angle: num('Degrees per unit', 45, -360, 360, 1), axis: enumeration('Axis', 'y', ['x', 'y', 'z']) }, (p, [m]) => deform(m, (x, y, z) => { const v = [x, y, z], a = 'xyz'.indexOf(p.axis), b = (a + 1) % 3, c = (a + 2) % 3, t = v[a] * p.angle * Math.PI / 180, co = Math.cos(t), s = Math.sin(t), u = v[b]; v[b] = u * co - v[c] * s; v[c] = u * s + v[c] * co; return v; }));
    add('taper', 'Taper', 'Modify', '△', 1, { amount: num('Amount', .25, -2, 2, .01) }, (p, [m]) => deform(m, (x, y, z) => [x * Math.max(.01, 1 + y * p.amount), y, z * Math.max(.01, 1 + y * p.amount)]));
    add('subdivide', 'Subdivide triangles', 'Modify', '▧', 1, { iterations: num('Iterations', 1, 0, 4, 1) }, (p, [m]) => subdivide(m, p.iterations));
    add('smooth', 'Laplacian smooth', 'Modify', '∿', 1, { iterations: num('Iterations', 3, 0, 30, 1), amount: num('Strength', .5, 0, 1, .01) }, (p, [m]) => smooth(m, p.iterations, p.amount));
    add('normals', 'Recompute normals', 'Modify', '↗', 1, {}, (p, [m]) => realize(m).computeNormals());
    add('color', 'Material / color', 'Material', '◈', 1, { color: color('Base color', '#c7a66b'), secondary: color('High color', '#eee2c4'), mode: enumeration('Color mode', 'solid', ['solid', 'height']), roughness: num('Roughness', .4, .04, 1, .01), metallic: num('Metallic', .35, 0, 1, .01) }, (p, [m]) => { const out = m.clone(), a = hexColor(p.color), b = hexColor(p.secondary), ys = []; for (let i = 1; i < out.positions.length; i += 3)
        ys.push(out.positions[i]); let lo = Infinity, hi = -Infinity; for (const y of ys) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
    } for (let i = 0; i < out.positions.length; i += 3) {
        const t = p.mode === 'height' ? (out.positions[i + 1] - lo) / (hi - lo || 1) : 0;
        for (let k = 0; k < 3; k++)
            out.colors[i + k] = lerp(a[k], b[k], t);
    } out.material = { roughness: p.roughness, metallic: p.metallic }; return out; });
    add('scatter', 'Scatter on surface', 'Populate', '⁙', 1, { count: num('Point count', 240, 1, 20000, 1), seed: num('Seed', 12, 0, 100000, 1), minHeight: num('Minimum height', -100, -100, 100) }, (p, [m]) => scatter(m, p.count | 0, p.seed, p.minHeight));
    add('copy', 'Copy to points', 'Populate', '⠿', 2, { scale: num('Scale', 1, .001, 100, .01), variation: num('Scale variation', .45, 0, .99, .01), seed: num('Seed', 8, 0, 100000, 1), rotate: bool('Random Y rotation', true) }, (p, [m, pts]) => copyToPoints(m, pts, p));
    add('merge', 'Merge', 'Utility', '⋈', 4, {}, (p, ms) => merge(ms), { optionalInputs: true });
    add('switch', 'Switch', 'Utility', '⇄', 2, { input: num('Input', 0, 0, 1, 1) }, (p, ms) => ms[p.input | 0]);
    add('output', 'Output', 'Utility', '⬡', 1, {}, (p, [m]) => m);
    add('null', 'Null', 'Utility', '◇', 1, {}, (p, [m]) => m);
    add('realize', 'Realize instances', 'Utility', '▦', 1, {}, (p, [m]) => realize(m));
    add('wrangle', 'Point expressions', 'Modify', 'ƒ', 1, { x: text('X expression', 'x'), y: text('Y expression', 'y + sin(x * 2 + t) * 0.3'), z: text('Z expression', 'z') }, (p, [m], ctx) => { const fn = [p.x, p.y, p.z].map(compileExpression), env = { t: ctx.time, f: ctx.frame }; return deform(m, (x, y, z, i) => { Object.assign(env, { x, y, z, i }); return fn.map(f => f(env)); }); }, { timeDependent: true });
    add('particles', 'Particle emitter', 'Simulation', '✺', 0, { count: num('Particles', 1200, 10, 10000, 1), seed: num('Seed', 8, 0, 10000, 1), speed: num('Launch speed', 7, .1, 30), spread: num('Spread', 2.5, 0, 10), gravity: num('Gravity', 9.81, .1, 30, .01), lifetime: num('Lifetime', 3.5, .1, 20), size: num('Particle radius', .045, .005, 1, .005) }, (p, ms, ctx) => particles(p, ctx.time), { timeDependent: true });
    add('cloth', 'Cloth solver', 'Simulation', '⚑', 0, { resolution: num('Resolution', 20, 4, 45, 1), width: num('Width', 5, .1, 20), height: num('Height', 4, .1, 20), wind: num('Wind', 1.8, 0, 20), gravity: num('Gravity', 9.81, 0, 30, .01), damping: num('Velocity damping', .99, .8, 1, .001), iterations: num('Constraint iterations', 7, 1, 20, 1), collider: num('Collider radius', 1.2, 0, 4) }, (p, ms, ctx) => { const key = JSON.stringify(p); if (ctx.state.key !== key) {
        ctx.state.key = key;
        ctx.state.solver = new ClothSolver(p);
    } return ctx.state.solver.at(ctx.time); }, { timeDependent: true });
    add('rigid', 'Rigid spheres', 'Simulation', '⠶', 0, { count: num('Body count', 90, 1, 700, 1), seed: num('Seed', 1, 0, 10000, 1), radius: num('Radius', .18, .03, 1, .01), gravity: num('Gravity', 9.81, .1, 30, .01), restitution: num('Restitution', .5, 0, 1, .01) }, (p, ms, ctx) => { const key = JSON.stringify(p); if (ctx.state.key !== key) {
        ctx.state.key = key;
        ctx.state.solver = new RigidSolver(p);
    } return ctx.state.solver.at(ctx.time); }, { timeDependent: true });
    add('obj', 'OBJ geometry', 'Import', '↥', 0, { source: { ...text('OBJ source', ''), maxLength: 24000000 } }, p => importOBJ(p.source));
    return r;
}
export const defaultRegistry = createRegistry();
