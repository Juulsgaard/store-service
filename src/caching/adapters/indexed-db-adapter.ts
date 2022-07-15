import {CacheAdapter, CacheItemData, CacheTransactionAdapter} from "../caching-adapter";
import {sleep} from "@consensus-labs/ts-tools";
import {IDBFactory} from "fake-indexeddb";

export class IndexedDbAdapter implements CacheAdapter {

  private static readonly version = 1;
  private static readonly dbPrefix = 'cache_';

  private databases = new Map<string, Promise<IDBDatabase>>();

  constructor() {
    if (!indexedDB) {
      throw Error("Your browser doesn't support a stable version of IndexedDB")
    }
  }

  createDatabase(id: string): Promise<boolean> {
    if (this.databases.has(id)) return Promise.resolve(true);

    const db = new Promise<IDBDatabase>((resolve, reject) => {

      const request = indexedDB.open(`${IndexedDbAdapter.dbPrefix}${id}`, IndexedDbAdapter.version);
      request.onerror = err => reject(err);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => this.buildDatabase(request.result);
    });

    this.databases.set(id, db);
    return db.then(() => true);
  }

  buildDatabase(db: IDBDatabase) {
    db.createObjectStore("versions", {keyPath: 'chunkId'});

    const cacheStore = db.createObjectStore("chunks");
    cacheStore.createIndex('chunkId', 'chunkId');
    cacheStore.createIndex('valueId', 'valueId');
    cacheStore.createIndex('createdAt', 'createdAt');
    cacheStore.createIndex('updatedAt', 'updatedAt');
  }

  deleteDatabase(id: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(id);
      request.onerror = err => reject(err);
      request.onsuccess = () => {
        this.databases.delete(id);
        resolve(true);
      }
    });
  }

  startTransaction(databaseId: string, readonly: boolean): Promise<CacheTransactionAdapter> {
    const promise = this.databases.get(databaseId);
    if (!promise) throw Error("Database has not been created");

    return promise.then(db => {
      const transaction = db.transaction(['versions', 'chunks'], readonly ? 'readonly' : 'readwrite');
      return new IndexedDbTransactionAdapter(transaction, readonly);
    });
  }

}

class IndexedDbTransactionAdapter implements CacheTransactionAdapter {

  constructor(private transaction: IDBTransaction, public readonly readonly: boolean) {
  }

  private getValueKey(chunkId: string, id: string) {
    return `${chunkId}_${id}`;
  }

  getChunkVersion(chunkId: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('versions').get(chunkId) as IDBRequest<VersionData|undefined>;
      request.onsuccess = () => resolve(request.result?.version);
      request.onerror = err => reject(err)
    });
  }

  createChunk(chunkId: string, version: number): Promise<boolean> {
    if (this.readonly) throw Error(`Can't create chunks in read mode`);

    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('versions')
        .put({version, chunkId: chunkId} as VersionData);

      request.onsuccess = () => resolve(true);
      request.onerror = err => reject(err)
    });
  }

  deleteChunk(chunkId: string): Promise<boolean> {
    if (this.readonly) throw Error(`Can't delete chunks in read mode`);

    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('versions').delete(chunkId);

      request.onerror = err => reject(err)
      request.onsuccess = () => {
        const request = this.transaction.objectStore('chunks').index('chunkId').openCursor(chunkId);

        request.onerror = err => reject(err)
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve(true);
          cursor.delete();
          cursor.continue();
        }
      };
    });
  }


  readValue<TData>(chunkId: string, id: string): Promise<CacheItemData<TData> | undefined> {
    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('chunks').get(this.getValueKey(chunkId, id)) as IDBRequest<ValueData<TData>|undefined>;

      request.onerror = err => reject(err)
      request.onsuccess = () => {
        const data = request.result;
        if (!data) return resolve(undefined);
        resolve({createdAt: data.createdAt, updatedAt: data.updatedAt, data: data.data, id: data.valueId});
      };
    });
  }

  readAllValues<TData>(chunkId: string): Promise<CacheItemData<TData>[]> {
    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('chunks').index('chunkId').getAll(chunkId) as IDBRequest<ValueData<TData>[]>;

      request.onerror = err => reject(err)
      request.onsuccess = () => {
        const list = request.result;
        resolve(list.map(data => ({createdAt: data.createdAt, updatedAt: data.updatedAt, data: data.data, id: data.valueId})));
      };
    });
  }

  addValue<TData>(chunkId: string, id: string, data: TData): Promise<void> {
    if (this.readonly) throw Error(`Can't write values in read mode`);

    return new Promise((resolve, reject) => {
      const now = new Date();
      const request = this.transaction.objectStore('chunks').put(
        {chunkId: chunkId, valueId: id, createdAt: now, updatedAt: now, data} as ValueData<TData>,
        this.getValueKey(chunkId, id)
      );

      request.onerror = err => reject(err)
      request.onsuccess = () => resolve();
    });
  }

  deleteValue(chunkId: string, id: string): Promise<void> {
    if (this.readonly) throw Error(`Can't delete values in read mode`);

    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('chunks').delete(this.getValueKey(chunkId, id));

      request.onerror = err => reject(err)
      request.onsuccess = () => resolve();
    });
  }

  updateValue<TData>(chunkId: string, id: string, data: TData): Promise<void> {
    if (this.readonly) throw Error(`Can't update values in read mode`);

    return new Promise((resolve, reject) => {
      const request = this.transaction.objectStore('chunks').openCursor(this.getValueKey(chunkId, id));

      request.onerror = err => reject(err)
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          reject(Error("Element does not exist in cache"));
          return;
        }

        const oldVal = cursor.value as ValueData<TData>;

        const update = cursor.update({
          valueId: oldVal.valueId,
          chunkId: oldVal.chunkId,
          createdAt: oldVal.createdAt,
          updatedAt: new Date(),
          data: data
        } as ValueData<TData>);

        update.onerror = err => reject(err)
        update.onsuccess = () => resolve();
      };
    });
  }


  dispose(): Promise<void> {
    return sleep(0);
  }

  async revert(): Promise<void> {
    this.transaction.abort();
  }

  async commit(): Promise<void> {
    if (this.readonly) return;
    this.transaction.commit();
  }

}

interface VersionData {
  version: number;
  chunkId: string;
}

interface ValueData<T> {
  chunkId: string;
  valueId: string;
  createdAt: Date;
  updatedAt: Date;
  data: T;
}
