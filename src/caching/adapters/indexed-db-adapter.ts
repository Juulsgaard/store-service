import {CacheAdapter, CacheItemData, CacheTransactionAdapter} from "../caching-adapter";

export class IndexedDbAdapter implements CacheAdapter {
  createDatabase(id: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteDatabase(id: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  startTransaction(databaseId: string, chunkId: string): Promise<CacheTransactionAdapter> {
    return Promise.resolve(new IndexedDbTransactionAdapter());
  }

}

class IndexedDbTransactionAdapter implements CacheTransactionAdapter {
  addValue<TData>(id: string, data: TData): Promise<void> {
    console.log('Add Value', data);
    return Promise.resolve(undefined);
  }

  commit(): Promise<void> {
    return Promise.resolve(undefined);
  }

  createChunk(version: number): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteChunk(): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteValue(id: string): Promise<void> {
    return Promise.resolve(undefined);
  }

  dispose(): Promise<void> {
    return Promise.resolve(undefined);
  }

  getChunkVersion(): Promise<number | undefined> {
    return Promise.resolve(undefined);
  }

  readValue<TData>(id: string): Promise<CacheItemData<TData> | undefined> {
    return Promise.resolve(undefined);
  }

  revert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  updateValue<TData>(id: string, data: TData): Promise<void> {
    return Promise.resolve(undefined);
  }

}
