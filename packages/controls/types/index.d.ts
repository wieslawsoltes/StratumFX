export interface GraphNode {id: string; type: string; name: string; x: number; y: number; inputs: (string|null)[]; params: Record<string, any>; keyframes?: Record<string, any[]>; bypass: boolean;}
export interface GraphDocument {nodes: GraphNode[]; outputId: string|null;}
export interface OperatorDefinition {type?: string; label: string; category?: string; icon?: string; inputs?: number; params?: Record<string, any>;}
export declare const categoryColors: Record<string, string>;
export declare class NodeEditor extends HTMLElement {
  document: GraphDocument; registry: {list(): OperatorDefinition[]}; selected: Set<string>;
  pan: {x: number; y: number}; zoom: number; presence: {name: string; x: number|null; y: number|null}[];
  select(ids: Iterable<string>): void; frame(): void; autoLayout(): void; draw(): void; drawPresence(): void;
}
export declare class ParameterEditor extends HTMLElement {
  node: GraphNode|null; definition: OperatorDefinition|null; frame: number; isOutput: boolean;
  setData(node: GraphNode|null, definition: OperatorDefinition|null, frame?: number, evaluatedValues?: Record<string, any>): void;
  draw(): void;
}
export declare class Timeline extends HTMLElement {
  start: number; end: number; fps: number; frame: number; playing: boolean; loop: boolean; keys: {frame: number; value: number}[];
  configure(options: {start: number; end: number; fps: number; frame: number; keys?: {frame: number; value: number}[]}): void;
  setFrame(frame: number, notify?: boolean): void; toggle(): void; draw(): void;
}
declare global {
  interface HTMLElementTagNameMap {'stratum-node-editor': NodeEditor; 'stratum-parameter-editor': ParameterEditor; 'stratum-timeline': Timeline;}
}
