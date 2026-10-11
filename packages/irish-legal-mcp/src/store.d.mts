import type { Backend, CoreIndex, Repository } from './types.mjs';
export class FileBackend implements Backend {
  constructor(path: string);
  readIndex(): Promise<{ index: CoreIndex; revision: string | null }>;
  writeIndex(index: CoreIndex, revision: string | null): Promise<void>;
  writeSnapshot(key: string, text: string): Promise<void>;
  readSnapshot(key: string): Promise<string>;
}
export interface ObjectStore {
  get(key: string): Promise<{ text: string; etag: string } | null>;
  put(key: string, text: string, condition: { ifMatch?: string; ifNoneMatch?: string }): Promise<unknown>;
}
export class ObjectBackend extends FileBackend { constructor(objects: ObjectStore) }
export function createRepository(backend: Backend): Repository;
