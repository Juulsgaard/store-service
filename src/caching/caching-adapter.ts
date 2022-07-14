
export interface CacheItemData<TData> {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  data: TData;
}

export interface CacheAdapter {

  createDatabase(id: string): Promise<boolean>;

  deleteDatabase(id: string): Promise<boolean>;

  startTransaction(databaseId: string, chunkId: string, readonly: boolean): Promise<CacheTransactionAdapter>;
}

export interface CacheTransactionAdapter {

  get readonly(): boolean;

  getChunkVersion(): Promise<number | undefined>;

  createChunk(version: number): Promise<boolean>;

  deleteChunk(): Promise<boolean>;


  addValue<TData>(id: string, data: TData): Promise<void>;

  updateValue<TData>(id: string, data: TData): Promise<void>;

  deleteValue(id: string): Promise<void>;

  readValue<TData>(id: string): Promise<CacheItemData<TData> | undefined>;

  readAllValues<TData>(): Promise<CacheItemData<TData>[]>;

  commit(): Promise<void>;
  revert(): Promise<void>;
  dispose(): Promise<void>;
}
