export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;
export interface Bounds {min: Vec3; max: Vec3; center: Vec3; radius: number;}
export interface Material {roughness: number; metallic: number;}
export interface MeshOptions {
  normals?: ArrayLike<number>; colors?: ArrayLike<number>; uvs?: ArrayLike<number>;
  /** Column-major mat4 followed by RGBA; 20 floats per instance. */
  instances?: ArrayLike<number>; material?: Partial<Material>; attributes?: Record<string, unknown>;
}
export declare const MAX_VERTICES: number;
export declare const MAX_INSTANCES: number;
export declare class Mesh {
  constructor(positions?: ArrayLike<number>, indices?: ArrayLike<number>, options?: MeshOptions);
  positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array;
  indices: Uint32Array; instances: Float32Array; material: Material; attributes: Record<string, unknown>;
  readonly vertexCount: number; readonly triangleCount: number; readonly instanceCount: number;
  clone(): Mesh; computeNormals(): this; bounds(): Bounds;
}
export declare function realize(mesh: Mesh): Mesh;
export declare function merge(meshes: Mesh[]): Mesh;
export declare function transform(mesh: Mesh, translation: Vec3, rotation: Vec3, scale: Vec3): Mesh;
export declare function deform(mesh: Mesh, fn: (x: number, y: number, z: number, index: number) => Vec3): Mesh;
export declare function subdivide(mesh: Mesh, iterations?: number): Mesh;
export declare function smooth(mesh: Mesh, iterations?: number, amount?: number): Mesh;
export declare function scatter(mesh: Mesh, count?: number, seed?: number, minimumHeight?: number): Mesh;
export interface CopyOptions {scale?: number; variation?: number; seed?: number; rotate?: boolean;}
export declare function copyToPoints(source: Mesh, points: Mesh, options?: CopyOptions): Mesh;
export declare function importOBJ(text: string): Mesh;
export declare function exportOBJ(mesh: Mesh): string;
export declare function exportSTL(mesh: Mesh): ArrayBuffer;
export declare function box(size?: Vec3): Mesh;
export declare function sphere(radius?: number, segments?: number, rings?: number): Mesh;
export declare function grid(width?: number, depth?: number, rows?: number, columns?: number): Mesh;
export declare function torus(radius?: number, tube?: number, segments?: number, sides?: number): Mesh;
export declare function cylinder(radius?: number, height?: number, segments?: number, topRadius?: number): Mesh;
export interface TerrainOptions {size?: number; resolution?: number; height?: number; frequency?: number; octaves?: number; seed?: number; island?: boolean;}
export declare function terrain(options?: TerrainOptions): Mesh;
export interface HelixOptions {radius?: number; height?: number; turns?: number; tube?: number; segments?: number; sides?: number;}
export declare function helix(options?: HelixOptions): Mesh;
export interface ParticleOptions {count?: number; seed?: number; speed?: number; spread?: number; gravity?: number; lifetime?: number; size?: number;}
export declare function particles(options: ParticleOptions, time: number): Mesh;
export interface ClothOptions {resolution?: number; width?: number; height?: number; wind?: number; gravity?: number; damping?: number; iterations?: number; collider?: number;}
export declare class ClothSolver {constructor(options?: ClothOptions); at(seconds: number): Mesh; step(): void; stepIndex: number; mesh: Mesh; rest: Float32Array;}
export interface RigidOptions {count?: number; seed?: number; radius?: number; gravity?: number; restitution?: number;}
export declare class RigidSolver {constructor(options?: RigidOptions); at(seconds: number): Mesh; step(): void; stepIndex: number; positions: Float32Array; velocities: Float32Array;}
export declare function clamp(value: number, min: number, max: number): number;
export declare function lerp(a: number, b: number, t: number): number;
export declare function vadd(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export declare function vsub(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export declare function vscale(a: ArrayLike<number>, scalar: number): Vec3;
export declare function cross(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export declare function dot(a: ArrayLike<number>, b: ArrayLike<number>): number;
export declare function length(a: ArrayLike<number>): number;
export declare function normalize(a: ArrayLike<number>): Vec3;
export declare function identity(): Mat4;
export declare function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4;
export declare function transformPoint(matrix: ArrayLike<number>, position: ArrayLike<number>): Vec3;
export declare function compose(translation?: ArrayLike<number>, rotationDegrees?: ArrayLike<number>, scale?: ArrayLike<number>): Mat4;
export declare function lookAt(eye: ArrayLike<number>, target: ArrayLike<number>, up?: ArrayLike<number>): Mat4;
export declare function perspective(fovRadians: number, aspect: number, near: number, far: number, webgpu?: boolean): Mat4;
export declare function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number, webgpu?: boolean): Mat4;
export declare function invert(matrix: ArrayLike<number>): Mat4;
export declare function random(seed?: number): () => number;
export declare function hash3(x: number, y: number, z: number, seed?: number): number;
export declare function noise(x: number, y: number, z: number, seed?: number): number;
export declare function fbm(x: number, y: number, z: number, octaves?: number, seed?: number): number;
export declare function hexColor(hex: string): Vec3;
