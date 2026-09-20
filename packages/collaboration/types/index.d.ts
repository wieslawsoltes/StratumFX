export interface ProjectDocument {id: string; title: string; [key: string]: any;}
export interface ProjectRecord {id: string; title: string; document: ProjectDocument; updated: number;}
export interface Checkpoint {id: string; projectId?: string; label: string; created: number; document?: ProjectDocument; revision?: number;}
export declare class ProjectDatabase {
  constructor(name?: string); open(): Promise<IDBDatabase>;
  save(document: ProjectDocument): Promise<IDBValidKey>; list(): Promise<ProjectRecord[]>;
  get(id: string): Promise<ProjectDocument|undefined>; delete(id: string): Promise<void>;
  checkpoint(document: ProjectDocument, label?: string): Promise<IDBValidKey>; checkpoints(projectId: string): Promise<Checkpoint[]>;
}
export interface User {id: string; name: string;}
export type Role = 'owner'|'editor'|'viewer';
export interface PendingBatch {id: string; ops: any[]; created: number; error?: string;}
export interface CompatibleStore extends EventTarget {document: ProjectDocument; registry: any; replace(document: any, remote?: boolean): void;}
export declare class CollaborationClient extends EventTarget {
  constructor(store: CompatibleStore, options?: {baseURL?: string});
  user: User|null; role: Role|null; projectId: string|null; clientId: string; revision: number;
  pending: PendingBatch[]; rejected: PendingBatch[]; status: 'offline'|'connecting'|'online'|'reconnecting';
  session(): Promise<{user: User|null}>; register(name: string, password: string): Promise<{user: User}>;
  login(name: string, password: string): Promise<{user: User}>; logout(): Promise<void>;
  projects(): Promise<{projects: {id: string; title: string; role: Role; revision: number; updated: number}[]}>;
  create(document: ProjectDocument): Promise<{id: string; revision: number}>; join(code: string): Promise<{id: string}>;
  connect(projectId: string): Promise<void>; disconnect(): void; destroy(): void; resync(): Promise<void>;
  presence(point: {x: number; y: number}): void;
  invitation(role?: 'editor'|'viewer'): Promise<{code: string; role: Role; expires: number}>;
  members(): Promise<{members: (User & {role: Role})[]}>; setRole(userId: string, role: 'editor'|'viewer'): Promise<{ok: true}>;
  checkpoint(label: string): Promise<{id: string}>; checkpoints(): Promise<{checkpoints: Checkpoint[]}>;
  restore(id: string): Promise<{document: ProjectDocument; revision: number}>;
}
