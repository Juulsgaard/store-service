import {CacheAdapter, CacheItemData, CacheTransactionAdapter} from "./caching-adapter";

export class CacheDatabaseContext {
  constructor(private adapter: CacheAdapter, private databaseId: string) {
  }

  private initialising?: Promise<void>;

  async init(): Promise<void> {
    if (this.initialising) return await this.initialising;
    this.initialising = this._init();
    return await this.initialising;
  }

  private async _init() {
    await this.adapter.createDatabase(this.databaseId);
  }

  getChunk<TChunk>(chunkId: string) {
    return new CacheChunkContext<TChunk>(this.adapter, this.databaseId, chunkId, this);
  }
}

export class CacheChunkContext<TChunk> {
  constructor(private adapter: CacheAdapter, private databaseId: string, private chunkId: string, private database: CacheDatabaseContext) {
  }

  private initialising?: Promise<void>;

  async init(version: number): Promise<void> {
    if (this.initialising) return await this.initialising;
    this.initialising = this._init(version);
    return await this.initialising;
  }

  private async _init(version: number) {
    await this.database.init();

    const transaction = new CacheChunkTransaction<TChunk>(
      await this.adapter.startTransaction(this.databaseId, this.chunkId, false)
    );

    try {
      await transaction.initChunk(version);
      await transaction.commit();
    } finally {
      await transaction.dispose();
    }
  }

  async startTransaction(readonly: boolean) {
    if (!this.initialising) throw Error('Chunk has not been initialised');
    await this.initialising;

    return new CacheChunkTransaction<TChunk>(
      await this.adapter.startTransaction(this.databaseId, this.chunkId, readonly)
    );
  }

}

class CacheChunkTransaction<TChunk> {

  private changes = false;

  constructor(private adapter: CacheTransactionAdapter) {
  }

  async initChunk(version: number) {
    const currentVersion = await this.adapter.getChunkVersion();
    if (currentVersion === version) return;

    if (version !== undefined) await this.adapter.deleteChunk();
    await this.adapter.createChunk(version);
  }

  //<editor-fold desc="Values">
  async readValue(id: string): Promise<CacheItemData<TChunk>|undefined> {
    return await this.adapter.readValue<TChunk>(id);
  }

  async addValue(id: string, value: TChunk) {
    await this.adapter.addValue(id, value);
    this.changes = true;
  }

  async updateValue(id: string, value: TChunk) {
    await this.adapter.updateValue(id, value);
    this.changes = true;
  }

  async deleteValue(id: string) {
    await this.adapter.deleteValue(id);
    this.changes = true;
  }
  //</editor-fold>

  //<editor-fold desc="Transaction state">
  async commit() {
    await this.adapter.commit();
    this.changes = false;
  }

  async revert() {
    await this.adapter.revert();
    this.changes = false;
  }

  async dispose() {
    if (!this.changes) return;
    await this.revert();
  }
  //</editor-fold>
}
