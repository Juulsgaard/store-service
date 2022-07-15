import {CacheAdapter, CacheItemData, CacheTransactionAdapter} from "./caching-adapter";
import {concatMap, EMPTY, from, Observable, of, Subject, Subscription} from "rxjs";

export class CacheDatabaseContext {

  private initialising?: Promise<void>;

  private transactionQueue?: Subject<CacheTransaction>;
  private transactionSub?: Subscription;

  constructor(private adapter: CacheAdapter, private databaseId: string) {
    this.setupQueue();
  }

  reset() {
    this.setupQueue();
  }

  private setupQueue() {
    this.transactionSub?.unsubscribe();
    this.transactionQueue?.complete();
    this.transactionQueue = new Subject();
    this.transactionSub = this.transactionQueue.pipe(
      concatMap(x => x.run())
    ).subscribe();
  }

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

  async useTransaction<TReturn>(use: (trx: CacheTransactionAdapter) => TReturn | Promise<TReturn>, readonly: boolean, cancel$?: Observable<void>): Promise<TReturn> {
    if (!this.initialising) throw Error('Database has not been initialised');
    await this.initialising;

    // Create a promise that resolves when the transaction has been dequeued and executed
    return await new Promise((resolve, reject) => {

      // Define the transaction action
      const action = new CacheTransaction(async () => {
        const trx = await this.adapter.startTransaction(this.databaseId, readonly)

        try {
          const result = await use(trx);
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          await trx.dispose();
        }
      });

      // Cancel transaction on cancel trigger
      cancel$?.subscribe(() => action.cancel());

      // Queue the transaction
      this.transactionQueue?.next(action);
    })
  }
}

/**
 * A cancelable transactional action
 */
class CacheTransaction {

  private cancelled = false;

  constructor(private action: () => Promise<void>|void) {
  }

  cancel() {
    this.cancelled = true;
  }

  run(): Observable<void> {
    if (this.cancelled) return EMPTY;
    const result = this.action();
    if (result instanceof Promise) return from(result);
    return of(result);
  }
}

export class CacheChunkContext<TChunk> {

  private initialising?: Promise<void>;
  private transactions = new Set<Subject<void>>();

  constructor(private adapter: CacheAdapter, private databaseId: string, private chunkId: string, private database: CacheDatabaseContext) {

  }

  reset() {
    // Trigger all transactions cancel triggers to remove them from the queue
    this.transactions.forEach(x => x.next());
    this.transactions.clear();
  }

  async init(version: number): Promise<void> {
    if (this.initialising) return await this.initialising;
    this.initialising = this._init(version);
    return await this.initialising;
  }

  private async _init(version: number) {
    await this.database.init();

    await this.database.useTransaction(async trx => {
      const transaction = new CacheTransactionContext<TChunk>(this.chunkId, trx);
      await transaction.initChunk(version);
      await transaction.commit();
    }, false);
  }

  async useTransaction<TReturn>(use: (trx: CacheTransactionContext<TChunk>) => TReturn | Promise<TReturn>, readonly: boolean): Promise<TReturn> {
    if (!this.initialising) throw Error('Chunk has not been initialised');
    await this.initialising;

    // Register a cancel trigger for canceling the transaction
    const cancel$ = new Subject<void>();
    this.transactions.add(cancel$);

    return await this.database.useTransaction(trx => {
      try {
        const transaction = new CacheTransactionContext<TChunk>(this.chunkId, trx);
        return use(transaction);
      } finally {

        // Transaction finished, remove cancel trigger
        cancel$.complete();
        this.transactions.delete(cancel$);
      }
    }, readonly, cancel$);
  }

}

class CacheTransactionContext<TChunk> {

  private changes = false;

  constructor(private chunkId: string, private adapter: CacheTransactionAdapter) {
  }

  async initChunk(version: number) {
    const currentVersion = await this.adapter.getChunkVersion(this.chunkId);
    if (currentVersion === version) return;

    if (version !== undefined) await this.adapter.deleteChunk(this.chunkId);
    await this.adapter.createChunk(this.chunkId, version);
  }

  //<editor-fold desc="Values">
  async readValue(id: string): Promise<CacheItemData<TChunk> | undefined> {
    return await this.adapter.readValue<TChunk>(this.chunkId, id);
  }

  async readAllValues(): Promise<CacheItemData<TChunk>[]> {
    return await this.adapter.readAllValues<TChunk>(this.chunkId);
  }

  async addValue(id: string, value: TChunk) {
    await this.adapter.addValue(this.chunkId, id, value);
    this.changes = true;
  }

  async updateValue(id: string, value: TChunk) {
    await this.adapter.updateValue(this.chunkId, id, value);
    this.changes = true;
  }

  async deleteValue(id: string) {
    await this.adapter.deleteValue(this.chunkId, id);
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
