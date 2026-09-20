import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from '../packages/geometry/src/math.js';
import { Mesh, realize, merge, transform, subdivide, smooth, scatter, copyToPoints, importOBJ, exportOBJ, exportSTL, deform } from '../packages/geometry/src/mesh.js';
import { box, sphere, torus, grid, cylinder, helix, terrain } from '../packages/geometry/src/primitives.js';
import { ClothSolver, RigidSolver, particles } from '../packages/geometry/src/simulation.js';
import { MeshBVH } from '../packages/renderer/src/bvh.js';
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const finite = mesh => { for (const array of [mesh.positions, mesh.normals, mesh.colors, mesh.uvs, mesh.instances])
    assert.ok(array.every(Number.isFinite)); for (const i of mesh.indices)
    assert.ok(i < mesh.vertexCount); };
for (const [name, make] of Object.entries({ box: () => box(), sphere: () => sphere(), torus: () => torus(), grid: () => grid(), cylinder: () => cylinder(), helix: () => helix({}), terrain: () => terrain({}) }))
    test(`${name}: finite indexed geometry and normals`, () => { const mesh = make(); finite(mesh); assert.ok(mesh.vertexCount > 3); assert.ok(mesh.triangleCount > 0); for (let i = 0; i < mesh.normals.length; i += 3) {
        const n = Math.hypot(...mesh.normals.subarray(i, i + 3));
        assert.ok(n < 1e-5 || Math.abs(n - 1) < 1e-5);
    } assert.ok(mesh.bounds().radius > 0); });
test('matrix inversion reverses translated rotated nonuniform scale', () => { const m = math.compose([2, -3, 4], [18, 43, 72], [2, 3, .4]), p = [7, 4, 2], back = math.transformPoint(math.invert(m), math.transformPoint(m, p)); p.forEach((v, i) => close(v, back[i])); });
test('matrix product identity and singular inversion rejection', () => { const m = math.compose([1, 2, 3], [22, 14, 55], [3, 2, 7]), result = math.multiply(m, math.invert(m)); math.identity().forEach((v, i) => close(v, result[i])); assert.throws(() => math.invert(new Float32Array(16))); });
test('seeded RNG and fBm are reproducible', () => { const a = math.random(14), b = math.random(14); for (let i = 0; i < 100; i++)
    assert.equal(a(), b()); assert.equal(math.fbm(1, 2, 3, 5, 4), math.fbm(1, 2, 3, 5, 4)); });
test('invalid mesh indices, finite values and UVs are rejected', () => { assert.throws(() => new Mesh([0, 0, 0], [1, 1, 1])); assert.throws(() => new Mesh([0, 0, 0], [0])); assert.throws(() => new Mesh([NaN, 0, 0], [])); assert.throws(() => new Mesh([0, 0, 0], [], { uvs: [1] })); assert.throws(() => new Mesh([0, 0, 0], [], { material: { roughness: -1 } })); });
test('clone does not alias geometry buffers', () => { const original = box(), copy = original.clone(); copy.positions[0] = 20; copy.instances[12] = 50; assert.notEqual(original.positions[0], copy.positions[0]); assert.notEqual(original.instances[12], copy.instances[12]); });
test('transforms stay instanced until realization', () => { const b = box([2, 2, 2]), m = transform(b, [3, 0, 0], [0, 0, 0], [2, 1, 1]); assert.deepEqual(m.positions, b.positions); close(m.bounds().min[0], 1); close(m.bounds().max[0], 5); close(realize(m).positions[0], b.positions[0] * 2 + 3); });
test('copy zero variation keeps exact unit transforms and material', () => { const a = copyToPoints(box(), new Mesh([1, 0, 0, 4, 0, 0], []), { variation: 0, rotate: false }); assert.equal(a.instanceCount, 2); close(a.instances[0], 1); close(a.instances[5], 1); close(a.instances[10], 1); assert.equal(realize(a).vertexCount, 48); });
test('zero instances have finite empty bounds', () => { const m = copyToPoints(box(), new Mesh([], [])); assert.equal(m.instanceCount, 0); assert.deepEqual(m.bounds().center, [0, 0, 0]); });
test('merging applies transforms and offsets indices', () => { const a = box(), b = transform(box(), [10, 0, 0], [0, 0, 0], [1, 1, 1]), m = merge([a, b]); assert.equal(m.vertexCount, 48); assert.equal(m.triangleCount, 24); close(m.bounds().max[0], 10.5); });
test('linear triangle subdivision quadruples topology', () => { const a = box(), b = subdivide(a, 2); assert.equal(b.triangleCount, a.triangleCount * 16); finite(b); });
test('smoothing preserves index topology', () => { const a = sphere(1, 10, 8), b = smooth(a, 3, .6); assert.deepEqual(a.indices, b.indices); finite(b); });
test('surface scattering is deterministic and constrained to a grid', () => { const a = scatter(grid(8, 6, 2, 2), 150, 62), b = scatter(grid(8, 6, 2, 2), 150, 62); assert.deepEqual(a.positions, b.positions); for (let i = 0; i < a.vertexCount; i++) {
    close(a.positions[i * 3 + 1], 0);
    assert.ok(Math.abs(a.positions[i * 3]) <= 4);
    assert.ok(Math.abs(a.positions[i * 3 + 2]) <= 3);
} });
test('degenerate scatter and non-finite deform fail explicitly', () => { assert.throws(() => scatter(new Mesh(), 5)); assert.throws(() => deform(box(), () => [NaN, 1, 2])); });
test('OBJ roundtrip preserves triangle positions and triangle count', () => { const a = transform(torus(2, .3, 20, 6), [1, 2, 3], [0, 0, 0], [1, 1, 1]), b = importOBJ(exportOBJ(a)); assert.equal(a.triangleCount, b.triangleCount); const x = a.bounds(), y = b.bounds(); x.min.forEach((v, i) => close(v, y.min[i])); finite(b); });
test('OBJ accepts negative polygon indices and rejects invalid references', () => { const a = importOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1'); assert.equal(a.triangleCount, 2); assert.throws(() => importOBJ('v 0 0 0\nf 1 2 3')); assert.throws(() => importOBJ('vt no 2')); });
test('binary STL has correct triangle count and byte length', () => { const mesh = box(), data = exportSTL(mesh); assert.equal(data.byteLength, 84 + 50 * 12); assert.equal(new DataView(data).getUint32(80, true), 12); });
test('BVH returns closest transformed instance and exact point', () => { const mesh = copyToPoints(box([2, 2, 2]), new Mesh([0, 0, 0, 5, 0, 0], []), { variation: 0, rotate: false }); const bvh = new MeshBVH(mesh), hit = bvh.raycast([5, 0, 10], [0, 0, -1]); assert.equal(hit.instance, 1); close(hit.distance, 9); close(hit.point[2], 1); assert.equal(bvh.raycast([50, 0, 10], [0, 0, -1]), null); });
test('BVH safely skips singular instances', () => { const mesh = transform(box(), [0, 0, 0], [0, 0, 0], [0, 0, 0]); assert.equal(new MeshBVH(mesh).raycast([0, 0, 10], [0, 0, -1]), null); });
test('cloth pins remain fixed and backward seek recomputes deterministically', () => { const p = { resolution: 8, iterations: 5, wind: 3 }, a = new ClothSolver(p), at1 = a.at(.5); a.at(1); const backward = a.at(.5); assert.deepEqual(at1.positions, backward.positions); assert.deepEqual(backward.positions.slice(0, 3), a.rest.slice(0, 3)); finite(backward); });
test('rigid sphere seek is reproducible and render radii match collision radii', () => { const p = { count: 12, seed: 14, radius: .2 }, a = new RigidSolver(p), m = a.at(.6); a.at(1); const b = a.at(.6); assert.deepEqual(m.instances, b.instances); assert.equal(b.instances[0], 1); assert.equal(b.instances[5], 1); finite(b); });
test('particle emitter is seed/frame deterministic', () => { const p = { count: 60, seed: 6 }, a = particles(p, 2), b = particles(p, 2); assert.deepEqual(a.instances, b.instances); finite(a); });
test('realization handles UV buffers larger than JavaScript argument limit', () => { const mesh = grid(1, 1, 255, 255), m = realize(mesh); assert.equal(m.uvs.length, 131072); finite(m); });
test('Mesh rejects fractional or non-finite raw triangle indices before uint conversion', () => {
    for (const index of [.5, NaN, Infinity, -1, 0x100000000]) {
        assert.throws(() => new Mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, index, 2]), /indices/);
    }
});

test('Mesh rejects normal accumulation overflow instead of returning NaN normals', () => {
    assert.throws(() => new Mesh([0,0,0,1e20,0,0,0,1e20,0],[0,1,2]), /normal computation range/);
});
