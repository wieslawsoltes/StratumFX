import { createDocument, createNode } from '../packages/core/src/graph.js';
function node(doc, id, type, name, x, y, params = {}, inputs = []) { const n = createNode(type, { id, name, x, y, inputs }); Object.assign(n.params, params); doc.nodes.push(n); return n; }
export function preset(kind = 'basalt') {
    const d = createDocument();
    if (kind === 'blank') {
        d.title = 'Untitled scene';
        return d;
    }
    if (kind === 'basalt') {
        d.title = 'Basalt Garden';
        node(d, 'height', 'terrain', 'island_heightfield', 0, 10, { size: 10.5, resolution: 54, height: 2.3, frequency: .45, seed: 31 });
        node(d, 'scatter', 'scatter', 'surface_scatter', 235, 10, { count: 1000, seed: 21, minHeight: -.24 }, ['height']);
        node(d, 'column', 'cylinder', 'hexagonal_column', 0, 115, { radius: .14, topRadius: .14, height: 1.7, segments: 6 });
        node(d, 'material', 'color', 'oxidized_alloy', 235, 115, { color: '#315951', secondary: '#e1c28b', mode: 'height', roughness: .38, metallic: .5 }, ['column']);
        node(d, 'copy', 'copy', 'instance_columns', 470, 65, { scale: 1, variation: .67, seed: 16 }, ['material', 'scatter']);
        node(d, 'out', 'output', 'OUT_GARDEN', 705, 65, {}, ['copy']);
        d.outputId = 'out';
    }
    else if (kind === 'lattice') {
        d.title = 'Kinetic Lattice';
        node(d, 'grid', 'grid', 'lattice_points', 50, 20, { width: 9, depth: 9, rows: 13, columns: 13 });
        node(d, 'wave', 'wrangle', 'wave_field', 50, 130, { x: 'x', y: 'sin(x * 0.7 + t) * cos(z * 0.7 + t * 0.5) * 1.4 + 2', z: 'z' }, ['grid']);
        node(d, 'torus', 'torus', 'ring_element', 300, 20, { radius: .22, tube: .065, segments: 28, sides: 10 });
        node(d, 'mat', 'color', 'brushed_gold', 300, 130, { color: '#d2a569', metallic: .72, roughness: .3 }, ['torus']);
        node(d, 'copy', 'copy', 'ring_lattice', 175, 240, { scale: 1, variation: .16, seed: 13 }, ['mat', 'wave']);
        node(d, 'out', 'output', 'OUT_LATTICE', 175, 345, {}, ['copy']);
        d.outputId = 'out';
    }
    else if (kind === 'terrain') {
        d.title = 'Highland Study';
        node(d, 'terrain', 'terrain', 'highland_heightfield', 100, 30, { size: 14, resolution: 110, height: 5.4, frequency: .29, seed: 83, island: false });
        node(d, 'mat', 'color', 'elevation_ramp', 100, 150, { color: '#243c42', secondary: '#cecaa8', mode: 'height', roughness: .77, metallic: .05 }, ['terrain']);
        node(d, 'out', 'output', 'OUT_HIGHLANDS', 100, 270, {}, ['mat']);
        d.outputId = 'out';
    }
    else if (kind === 'cloth') {
        d.title = 'Wind / Cloth Study';
        node(d, 'cloth', 'cloth', 'cloth_constraints', 40, 20, { wind: 5, collider: 1.2 });
        node(d, 'fabric', 'color', 'woven_copper', 40, 130, { color: '#b87650', secondary: '#d0a377', mode: 'height', roughness: .65, metallic: .15 }, ['cloth']);
        node(d, 'sphere', 'sphere', 'collision_sphere', 300, 20, { radius: 1.2, segments: 32, rings: 24 });
        node(d, 'move', 'transform', 'collider_position', 300, 130, { translate: [0, 1.6, .75] }, ['sphere']);
        node(d, 'merge', 'merge', 'cloth_and_collider', 170, 240, {}, ['fabric', 'move']);
        node(d, 'out', 'output', 'OUT_CLOTH', 170, 350, {}, ['merge']);
        d.outputId = 'out';
    }
    else if (kind === 'particles') {
        d.title = 'Particle Fountain';
        node(d, 'particles', 'particles', 'ballistic_emitter', 130, 30, { count: 2000, speed: 8, spread: 1.4, lifetime: 2.8 });
        node(d, 'out', 'output', 'OUT_PARTICLES', 130, 150, {}, ['particles']);
        d.outputId = 'out';
    }
    else if (kind === 'rigid') {
        d.title = 'Rigid Rain';
        node(d, 'bodies', 'rigid', 'sphere_dynamics', 130, 30, { count: 95, radius: .22, seed: 31, restitution: .54 });
        node(d, 'mat', 'color', 'anodized_bodies', 130, 150, { color: '#93b8bb', metallic: .7, roughness: .27 }, ['bodies']);
        node(d, 'out', 'output', 'OUT_DYNAMICS', 130, 270, {}, ['mat']);
        d.outputId = 'out';
    }
    else if (kind === 'sculpture') {
        d.title = 'Continuum Sculpture';
        node(d, 'helix', 'helix', 'swept_helix', 70, 20, { radius: 1.8, height: 4, turns: 5.5, tube: .21, segments: 280, sides: 12 });
        node(d, 'twist', 'twist', 'torsion_field', 70, 125, { angle: 30 }, ['helix']);
        node(d, 'noise', 'noise', 'surface_detail', 70, 230, { amplitude: .06, frequency: 7, octaves: 3, axis: 'normal' }, ['twist']);
        node(d, 'mat', 'color', 'satin_gold', 70, 335, { color: '#c3a577', secondary: '#eee1bf', mode: 'height', roughness: .32, metallic: .6 }, ['noise']);
        d.outputId = 'mat';
    }
    else
        throw Error('Unknown preset');
    return d;
}
export const presetList = [{ id: 'basalt', name: 'Basalt Garden', type: 'Procedural instancing', icon: '▥', description: '1,000 seeded columns across an island heightfield.' }, { id: 'lattice', name: 'Kinetic Lattice', type: 'Animated expressions', icon: '◎', description: 'A wave-driven field of instanced metallic rings.' }, { id: 'terrain', name: 'Highland Study', type: 'Heightfield modeling', icon: '▱', description: 'Fractal terrain with an elevation color ramp.' }, { id: 'cloth', name: 'Wind / Cloth Study', type: 'Position-based dynamics', icon: '⚑', description: 'Pinned fabric, wind, constraints and a sphere collider.' }, { id: 'particles', name: 'Particle Fountain', type: 'Ballistic particles', icon: '✺', description: 'Seekable seeded particles with ground impacts.' }, { id: 'rigid', name: 'Rigid Rain', type: 'Sphere collision dynamics', icon: '⠶', description: 'Gravity, sphere-to-sphere contacts and restitution.' }, { id: 'sculpture', name: 'Continuum Sculpture', type: 'Procedural modeling', icon: '〰', description: 'A swept helix with twist and surface noise.' }];
