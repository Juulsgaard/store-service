import {StoreService} from "./store-service";
import {IStoreConfigService} from "./models/store-config-service";
import {dashCase} from "@consensus-labs/ts-tools";
import {CacheAdapter} from "./caching/caching-adapter";
import {CacheDatabaseContext} from "./caching/caching-interface";
import {CacheConfig} from "./caching/cache-config";
import {Observable, ReplaySubject, skip} from "rxjs";


export abstract class CacheStoreService<TState> extends StoreService<TState> {

  databaseContext: CacheDatabaseContext;

  /**
   * Generated Id for the store
   * @protected
   */
  private readonly storeId: string;

  private states$ = new ReplaySubject<Observable<TState>>();

  protected constructor(initialState: TState, databaseId: string, configService: IStoreConfigService, cacheAdapter: CacheAdapter) {
    super(initialState, configService);

    this.storeId = dashCase(this.constructor.name);

    this.databaseContext = new CacheDatabaseContext(cacheAdapter, databaseId);

    this.states$.next(this.state$);
  }

  protected cache<TChunk>(chunkId: string, version: number): CacheConfig<TState> {
    return new CacheConfig<TState>(`${this.storeId}_${chunkId}`, version, this.databaseContext, this.states$);
  }

  reset() {
    // Emit a new state start starts with the next state value
    // That value will be the default for the state, since super.reset() emits default
    this.states$.next(this.state$.pipe(skip(1)));
    super.reset();
  }
}
