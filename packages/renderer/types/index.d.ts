export interface Bounds {min: number[]; max: number[]; center: number[]; radius: number;}
export interface Geometry {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; indices: Uint32Array; instances: Float32Array;
  material: {roughness: number; metallic: number}; readonly vertexCount: number; readonly instanceCount: number; readonly triangleCount: number;
  clone(): Geometry; bounds(): Bounds;
}
export interface RenderOptions {
  backend?: 'webgpu'|'webgl2'; mode?: 'shaded'|'wire'|'normals'|'unlit'; grid?: boolean; floor?: boolean;
  floorY?: number; exposure?: number; selectedInstance?: number; tool?: 'orbit'|'select'; bounds?: Bounds;
}
export declare class OrbitCamera {
  target: number[]; distance: number; yaw: number; pitch: number; orthographic: boolean; fov: number;
  readonly eye: number[]; matrix(aspect: number, webgpu?: boolean): Float32Array;
  frame(bounds: Bounds): void; pan(dx: number, dy: number): void;
}
export interface Renderer {
  canvas: HTMLCanvasElement; kind: string; mesh?: Geometry; error?: string|null;
  init(): Promise<Renderer>; setMesh(mesh: Geometry): void;
  render(camera: OrbitCamera, options?: RenderOptions): void; destroy(): void;
}
export declare class WebGPURenderer implements Renderer {
  constructor(canvas: HTMLCanvasElement); canvas: HTMLCanvasElement; kind: string; mesh?: Geometry; error: string|null;
  init(): Promise<this>; setMesh(mesh: Geometry): void; resize(): void; render(camera: OrbitCamera, options?: RenderOptions): void; destroy(): void;
}
export declare class WebGLRenderer implements Renderer {
  constructor(canvas: HTMLCanvasElement); canvas: HTMLCanvasElement; kind: string; mesh?: Geometry;
  init(): Promise<this>; setMesh(mesh: Geometry): void; render(camera: OrbitCamera, options?: RenderOptions): void; destroy(): void;
}
export declare class SoftwareRenderer implements Renderer {
  constructor(canvas: HTMLCanvasElement); canvas: HTMLCanvasElement; kind: string; mesh?: Geometry;
  init(): Promise<this>; setMesh(mesh: Geometry): void; render(camera: OrbitCamera, options?: RenderOptions): void; destroy(): void;
}
export interface PickResult {point: number[]; distance: number; triangle: number; instance: number; barycentric: number[];}
export declare class MeshBVH {constructor(mesh: Geometry); raycast(origin: number[], direction: number[]): PickResult|null;}
export declare class Viewport extends EventTarget {
  constructor(canvas: HTMLCanvasElement, options?: RenderOptions); canvas: HTMLCanvasElement; camera: OrbitCamera;
  renderer: Renderer; options: RenderOptions; bounds?: Bounds; fallbackReason: string; fps: number;
  init(): Promise<this>; setMesh(mesh: Geometry): void; invalidate(): void; frame(): void;
  view(name: 'perspective'|'top'|'front'|'right'): void; pick(clientX: number, clientY: number): PickResult|null;
  snapshot(): Promise<Blob>; destroy(): void;
}
