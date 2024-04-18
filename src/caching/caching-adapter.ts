
export interface CacheItemData<TData> {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  data: TData;
}

export interface CacheAdapter {

  isAvailable(setError?: (error: string) => void): Promise<boolean>;

  createDatabase(id: string): Promise<boolean>;

  deleteDatabase(id: string): Promise<boolean>;

  startTransaction(databaseId: string, readonly: boolean): Promise<CacheTransactionAdapter>;
}

export interface CacheTransactionAdapter {

  get readonly(): boolean;

  getChunkVersion(chunkId: string): Promise<number | undefined>;

  createChunk(chunkId: string, version: number): Promise<boolean>;

  deleteChunk(chunkId: string): Promise<boolean>;


  addValue<TData>(chunkId: string, id: string, data: TData, tags: string[]): Promise<void>;

  updateValue<TData>(chunkId: string, id: string, data: TData): Promise<void>;

  updateValueAge<TData>(chunkId: string, id: string, newAge: Date): Promise<void>;

  deleteValue(chunkId: string, id: string): Promise<void>;
  deleteTag(tag: string): Promise<void>;

  readValue<TData>(chunkId: string, id: string): Promise<CacheItemData<TData> | undefined>;

  readValuesWithTag<TData>(chunkId: string, tag: string): Promise<CacheItemData<TData>[]>;
  readAllValues<TData>(chunkId: string): Promise<CacheItemData<TData>[]>;

  commit(): Promise<void>;
  revert(): Promise<void>;
  dispose(): Promise<void>;
}
