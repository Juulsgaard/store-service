import {StoreService} from "./store-service";
import {IStoreConfigService} from "./models/store-config-service";
import {dashCase, SimpleObject} from "@juulsgaard/ts-tools";
import {CacheDatabaseContext} from "./caching/caching-interface";
import {CacheConfig} from "./caching/cache-config";
import {Observable, ReplaySubject, skip} from "rxjs";
import {CacheChunk} from "./caching/cache-chunk";
import {CacheCommandConfig} from "./configs/cache-command-config";


export abstract class CacheStoreService<TState extends SimpleObject> extends StoreService<TState> {

  /**
   * Generated Id for the store
   * @protected
   */
  private readonly storeId: string;

  private states$ = new ReplaySubject<Observable<TState>>();

  protected constructor(initialState: TState, configService: IStoreConfigService, private databaseContext: CacheDatabaseContext) {
    super(initialState, configService);

    this.storeId = dashCase(this.constructor.name);

    this.states$.next(this.state$);
  }

  override reset() {
    // Emit a new state start starts with the next state value
    // That value will be the default for the state, since super.reset() emits default
    this.states$.next(this.state$.pipe(skip(1)));
    super.reset();
  }

  protected cache(chunkId: string, version: number): CacheConfig<TState> {
    return new CacheConfig<TState>(`${this.storeId}_${chunkId}`, version, this.databaseContext, this.states$);
  }

  protected cacheCommand<TCache>(chunk: CacheChunk<TCache>): CacheCommandConfig<TState, TCache> {
    return new CacheCommandConfig<TState, TCache>(this.context, chunk);
  }
}
