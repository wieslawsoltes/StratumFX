import { multiply, transformPoint, invert, normalize, vsub, cross, dot } from '../../geometry/src/math.js';
/** Depth-buffered CPU preview for browsers without a usable GPU. Not a WebGPU emulator. */
export class SoftwareRenderer {
    constructor(canvas) { this.canvas = canvas; this.kind = 'Software preview'; this.context = canvas.getContext('2d', { alpha: false }); if (!this.context)
        throw Error('No canvas rendering backend is available'); }
    async init() { return this; }
    setMesh(mesh) { this.mesh = mesh; }
    render(camera, options = {}) {
        const canvas = this.canvas, scale = Math.min(1, 1000 / Math.max(1, canvas.clientWidth), 650 / Math.max(1, canvas.clientHeight));
        const width = Math.max(1, Math.round(canvas.clientWidth * scale)), height = Math.max(1, Math.round(canvas.clientHeight * scale));
        if (canvas.width !== width || canvas.height !== height || !this.image) {
            canvas.width = width;
            canvas.height = height;
            this.image = this.context.createImageData(width, height);
            this.depth = new Float32Array(width * height);
            this.floorMask = new Uint8Array(width * height);
        }
        const data = this.image.data, depth = this.depth, mask = this.floorMask, vp = camera.matrix(width / height, false), ivp = invert(vp), eye = camera.eye;
        const floorY = options.floorY ?? Math.min(0, (options.bounds?.min[1] ?? 0) - .03), exposure = options.exposure ?? 1;
        depth.fill(Infinity);
        mask.fill(0);
        // Ray/plane intersection gives a correctly projected infinite floor and world-space grid.
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const k = y * width + x, o = k * 4;
                let r = 23, g = 28, b = 33;
                if (options.floor !== false) {
                    const sx = (x + .5) / width * 2 - 1, sy = 1 - (y + .5) / height * 2;
                    const aw = ivp[3] * sx + ivp[7] * sy - ivp[11] + ivp[15], bw = ivp[3] * sx + ivp[7] * sy + ivp[11] + ivp[15];
                    const ax = (ivp[0] * sx + ivp[4] * sy - ivp[8] + ivp[12]) / aw, ay = (ivp[1] * sx + ivp[5] * sy - ivp[9] + ivp[13]) / aw, az = (ivp[2] * sx + ivp[6] * sy - ivp[10] + ivp[14]) / aw;
                    const bx = (ivp[0] * sx + ivp[4] * sy + ivp[8] + ivp[12]) / bw, by = (ivp[1] * sx + ivp[5] * sy + ivp[9] + ivp[13]) / bw, bz = (ivp[2] * sx + ivp[6] * sy + ivp[10] + ivp[14]) / bw;
                    const t = (floorY - ay) / (by - ay);
                    if (t > 0 && t < 1) {
                        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, dist = Math.hypot(px - camera.target[0], pz - camera.target[2]);
                        const fog = Math.exp(-dist / 100), worldPixel = Math.max(.012, camera.distance / height * .5);
                        let grid = 0;
                        if (options.grid !== false) {
                            const minor = Math.min(Math.abs(px - Math.round(px)), Math.abs(pz - Math.round(pz)));
                            grid = Math.max(0, 1 - minor / worldPixel) * 8;
                        }
                        r = 23 + 12 * fog + grid;
                        g = 28 + 13 * fog + grid;
                        b = 33 + 13 * fog + grid;
                        if (options.grid !== false && Math.abs(pz) < worldPixel) {
                            r += 22 * fog;
                            g -= 2 * fog;
                        }
                        if (options.grid !== false && Math.abs(px) < worldPixel) {
                            g += 8 * fog;
                            b += 19 * fog;
                        }
                        const pw = vp[3] * px + vp[7] * floorY + vp[11] * pz + vp[15];
                        depth[k] = (vp[2] * px + vp[6] * floorY + vp[10] * pz + vp[14]) / pw;
                        mask[k] = 1;
                    }
                }
                data[o] = r;
                data[o + 1] = g;
                data[o + 2] = b;
                data[o + 3] = 255;
            }
        const mesh = this.mesh;
        if (mesh?.indices.length && mesh.instanceCount) {
            const positions = mesh.positions, normals = mesh.normals, colors = mesh.colors, indices = mesh.indices, instances = mesh.instances;
            const screen = new Float32Array(mesh.vertexCount * 8), shadow = new Float32Array(mesh.vertexCount * 8), world = new Float32Array(mesh.vertexCount * 3), sun = normalize([.5, .9, .4]);
            const project = (a, x, y, z, offset) => { const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; a[offset] = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * width * .5 + width * .5; a[offset + 1] = height * .5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * height * .5; a[offset + 2] = (vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / w; a[offset + 3] = w > 0 ? 1 / w : -1; };
            // Rasterizer interpolates depth linearly and color with perspective correction.
            const triangle = (vertices, ia, ib, ic, isShadow = false) => {
                const a = ia * 8, b = ib * 8, c = ic * 8;
                if (vertices[a + 3] <= 0 || vertices[b + 3] <= 0 || vertices[c + 3] <= 0)
                    return;
                const ax = vertices[a], ay = vertices[a + 1], bx = vertices[b], by = vertices[b + 1], cx = vertices[c], cy = vertices[c + 1];
                const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                if (Math.abs(area) < .02)
                    return;
                const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx))), minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
                const inv = 1 / area, dawdx = (by - cy) * inv, dawdy = (cx - bx) * inv, dbwdx = (cy - ay) * inv, dbwdy = (ax - cx) * inv;
                let ar = ((bx - minX - .5) * (cy - minY - .5) - (by - minY - .5) * (cx - minX - .5)) * inv, br = ((cx - minX - .5) * (ay - minY - .5) - (cy - minY - .5) * (ax - minX - .5)) * inv;
                for (let y = minY; y <= maxY; y++, ar += dawdy, br += dbwdy) {
                    let wa = ar, wb = br;
                    for (let x = minX; x <= maxX; x++, wa += dawdx, wb += dbwdx) {
                        const wc = 1 - wa - wb;
                        if (wa < -.001 || wb < -.001 || wc < -.001)
                            continue;
                        const k = y * width + x, offset = k * 4, z = wa * vertices[a + 2] + wb * vertices[b + 2] + wc * vertices[c + 2];
                        if (isShadow) {
                            if (mask[k] === 1 && Math.abs(z - depth[k]) < .0005) {
                                data[offset] *= .60;
                                data[offset + 1] *= .63;
                                data[offset + 2] *= .67;
                                mask[k] = 2;
                            }
                            continue;
                        }
                        if (z >= depth[k] || z < -1 || z > 1)
                            continue;
                        const edge = Math.min(wa, wb, wc);
                        if (options.mode === 'wire' && edge > .025)
                            continue;
                        const w = wa * vertices[a + 3] + wb * vertices[b + 3] + wc * vertices[c + 3];
                        depth[k] = z;
                        mask[k] = 0;
                        for (let channel = 0; channel < 3; channel++)
                            data[offset + channel] = (wa * vertices[a + 4 + channel] * vertices[a + 3] + wb * vertices[b + 4 + channel] * vertices[b + 3] + wc * vertices[c + 4 + channel] * vertices[c + 3]) / w;
                    }
                }
            };
            const transformInstance = (instance, shadowsOnly) => {
                const o = instance * 20, m = instances.subarray(o, o + 16);
                let nm;
                try {
                    nm = invert(m);
                }
                catch {
                    return;
                }
                for (let i = 0; i < mesh.vertexCount; i++) {
                    const p = i * 3, s = i * 8, px = positions[p], py = positions[p + 1], pz = positions[p + 2];
                    const x = m[0] * px + m[4] * py + m[8] * pz + m[12], y = m[1] * px + m[5] * py + m[9] * pz + m[13], z = m[2] * px + m[6] * py + m[10] * pz + m[14];
                    if (shadowsOnly) {
                        const t = Math.max(0, (y - floorY) / sun[1]);
                        project(shadow, x - sun[0] * t, floorY, z - sun[2] * t, s);
                        continue;
                    }
                    project(screen, x, y, z, s);
                    let nx = nm[0] * normals[p] + nm[1] * normals[p + 1] + nm[2] * normals[p + 2], ny = nm[4] * normals[p] + nm[5] * normals[p + 1] + nm[6] * normals[p + 2], nz = nm[8] * normals[p] + nm[9] * normals[p + 1] + nm[10] * normals[p + 2];
                    const nl = Math.hypot(nx, ny, nz) || 1;
                    nx /= nl;
                    ny /= nl;
                    nz /= nl;
                    const view = normalize([eye[0] - x, eye[1] - y, eye[2] - z]);
                    if (nx * view[0] + ny * view[1] + nz * view[2] < 0) {
                        nx = -nx;
                        ny = -ny;
                        nz = -nz;
                    }
                    const diffuse = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]);
                    const h = normalize([view[0] + sun[0], view[1] + sun[1], view[2] + sun[2]]), spec = Math.pow(Math.max(0, nx * h[0] + ny * h[1] + nz * h[2]), 8 + 110 * (1 - (mesh.material.roughness ?? .4))) * (mesh.material.metallic ?? .2) * 1.5;
                    const ambient = .19 + Math.max(0, ny) * .24 + Math.max(0, -nx * .8 + nz * .6) * .15;
                    for (let k = 0; k < 3; k++) {
                        let c = colors[p + k] * instances[o + 16 + k];
                        if (options.mode === 'normals')
                            c = [nx, ny, nz][k] * .5 + .5;
                        else if (options.mode !== 'unlit') {
                            c = Math.pow(Math.max(0, c), 2.2) * (ambient + diffuse * 1.5) + spec * [1, .88, .67][k];
                            c = 1 - Math.exp(-c * exposure);
                            c = Math.pow(Math.max(0, c), 1 / 2.2);
                        }
                        if (options.selectedInstance === instance)
                            c = c * .7 + [1, .66, .23][k] * .3;
                        screen[s + 4 + k] = Math.min(255, Math.max(0, c * 255));
                    }
                }
                for (let i = 0; i < indices.length; i += 3)
                    triangle(shadowsOnly ? shadow : screen, indices[i], indices[i + 1], indices[i + 2], shadowsOnly);
            };
            if (options.floor !== false)
                for (let i = 0; i < mesh.instanceCount; i++)
                    transformInstance(i, true);
            for (let i = 0; i < mesh.instanceCount; i++)
                transformInstance(i, false);
        }
        this.context.putImageData(this.image, 0, 0);
    }
    destroy() { this.mesh = null; this.image = null; this.depth = null; this.floorMask = null; }
}
