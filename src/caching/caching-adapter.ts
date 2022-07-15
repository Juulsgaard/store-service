
export interface CacheItemData<TData> {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  data: TData;
}

export interface CacheAdapter {

  createDatabase(id: string): Promise<boolean>;

  deleteDatabase(id: string): Promise<boolean>;

  startTransaction(databaseId: string, readonly: boolean): Promise<CacheTransactionAdapter>;
}

export interface CacheTransactionAdapter {

  get readonly(): boolean;

  getChunkVersion(chunkId: string): Promise<number | undefined>;

  createChunk(chunkId: string, version: number): Promise<boolean>;

  deleteChunk(chunkId: string): Promise<boolean>;


  addValue<TData>(chunkId: string, id: string, data: TData): Promise<void>;

  updateValue<TData>(chunkId: string, id: string, data: TData): Promise<void>;

  deleteValue(chunkId: string, id: string): Promise<void>;

  readValue<TData>(chunkId: string, id: string): Promise<CacheItemData<TData> | undefined>;

  readAllValues<TData>(chunkId: string): Promise<CacheItemData<TData>[]>;

  commit(): Promise<void>;
  revert(): Promise<void>;
  dispose(): Promise<void>;
}
