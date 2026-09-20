export type ParameterValue = number | string | boolean | (number | string)[];
export interface Keyframe {frame: number; value: number; interpolation?: 'linear' | 'step';}
export interface NodeRecord {
  id: string; type: string; name: string; x: number; y: number; inputs: (string | null)[];
  params: Record<string, ParameterValue>; keyframes: Record<string, Keyframe[]>; bypass: boolean;
}
export interface SceneDocument {
  schemaVersion: 1; id: string; title: string; nodes: NodeRecord[]; outputId: string | null;
  start: number; end: number; fps: number;
}
export interface MeshLike {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array;
  indices: Uint32Array; instances: Float32Array; material: {roughness: number; metallic: number};
  attributes: Record<string, unknown>; readonly vertexCount: number; readonly triangleCount: number; readonly instanceCount: number;
  clone(): MeshLike; computeNormals(): MeshLike;
  bounds(): {min: number[]; max: number[]; center: number[]; radius: number;};
}
export interface ParameterSpec {
  type: 'number' | 'vector' | 'boolean' | 'enum' | 'color' | 'text'; label: string; default: ParameterValue;
  min?: number; max?: number; step?: number; options?: string[]; maxLength?: number;
}
export interface CookContext {frame: number; time: number; state: Record<string, any>; engine: Engine;}
export interface NodeDefinition {
  type?: string; label: string; category?: string; icon?: string; inputs?: number;
  params?: Record<string, ParameterSpec>; optionalInputs?: boolean;
  timeDependent?: boolean | ((params: Record<string, any>) => boolean);
  cook(params: Record<string, any>, inputs: (MeshLike | null)[], context: CookContext): MeshLike;
}
export declare class NodeRegistry {
  register(type: string, definition: NodeDefinition): this;
  get(type: string): NodeDefinition & {type: string; inputs: number; params: Record<string, ParameterSpec>};
  list(): ReturnType<NodeRegistry['get']>[]; defaults(type: string): Record<string, ParameterValue>;
}
export declare function createRegistry(): NodeRegistry;
export declare const defaultRegistry: NodeRegistry;
export declare function uuid(): string;
export declare function createNode(type: string, options?: Partial<NodeRecord>, registry?: NodeRegistry): NodeRecord;
export declare function createDocument(title?: string): SceneDocument;
export declare function validateDocument(document: unknown, registry?: NodeRegistry): SceneDocument;
export interface CookStats {ms: number; cached: number; cooked: number; bytes: number; timings: {id: string; name: string; ms: number;}[];}
export declare class Engine {
  constructor(registry?: NodeRegistry); registry: NodeRegistry;
  cook(document: SceneDocument, frame?: number, outputId?: string | null): {mesh: MeshLike; stats: CookStats};
  clear(): void;
}
export type Operation =
  | {kind: 'add'; node: NodeRecord} | {kind: 'remove'; nodeId: string}
  | {kind: 'param'; nodeId: string; key: string; value: ParameterValue}
  | {kind: 'field'; nodeId: string; key: 'name'|'x'|'y'|'bypass'; value: string|number|boolean}
  | {kind: 'connect'; nodeId: string; slot: number; sourceId: string|null}
  | {kind: 'output'; nodeId: string|null} | {kind: 'title'; value: string}
  | {kind: 'timeline'; key: 'start'|'end'|'fps'; value: number}
  | {kind: 'keys'; nodeId: string; key: string; value: Keyframe[]};
export declare function applyOperations(document: SceneDocument, operations: Operation[], registry?: NodeRegistry): SceneDocument;
export declare function diffDocuments(before: SceneDocument, after: SceneDocument): Operation[];
export declare class GraphStore extends EventTarget {
  constructor(document?: SceneDocument, registry?: NodeRegistry);
  document: SceneDocument; registry: NodeRegistry;
  history: {undo: Operation[]; redo: Operation[]; label: string}[]; future: GraphStore['history'];
  commit(operations: Operation[], label?: string, record?: boolean): void;
  replace(document: SceneDocument, remote?: boolean): void; undo(): void; redo(): void;
}
export declare function compileExpression(source: string): (environment?: Record<string, number>) => number;
export declare function evaluateExpression(source: string, environment?: Record<string, number>): number;
export declare function sampleKeys(keys: Keyframe[] | undefined, frame: number, fallback: number|string): number|string;
