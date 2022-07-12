import {StoreService} from "./store-service";
import {IStoreConfigService} from "./models/store-config-service";
import {dashCase} from "@consensus-labs/ts-tools";
import {CacheAdapter} from "./caching/caching-adapter";
import {CacheDatabaseContext} from "./caching/caching-interface";
import {CacheConfig} from "./caching/cache-config";


export abstract class CacheStoreService<TState> extends StoreService<TState> {

  databaseContext: CacheDatabaseContext;

  /**
   * Generated Id for the store
   * @protected
   */
  private readonly storeId: string;

  protected constructor(initialState: TState, databaseId: string, configService: IStoreConfigService, cacheAdapter: CacheAdapter) {
    super(initialState, configService);

    this.storeId = dashCase(this.constructor.name);

    this.databaseContext = new CacheDatabaseContext(cacheAdapter, databaseId);
  }

  protected cache<TChunk>(chunkId: string, version: number): CacheConfig<TState> {
    return new CacheConfig<TState>(`${this.storeId}_${chunkId}`, version, this.databaseContext, this.state$);
  }
}
