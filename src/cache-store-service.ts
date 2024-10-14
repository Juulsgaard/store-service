import {StoreService} from "./store-service";
import {IStoreConfigService} from "./models/store-config-service";
import {dashCase, SimpleObject} from "@juulsgaard/ts-tools";
import {CacheDatabaseContext} from "./caching/caching-interface";
import {CacheConfig} from "./caching/cache-config";
import {BehaviorSubject, Observable} from "rxjs";
import {CacheChunk} from "./caching/cache-chunk";
import {CacheCommandConfig} from "./configs/cache-command-config";
import {inject, untracked} from "@angular/core";


export abstract class CacheStoreService<TState extends SimpleObject> extends StoreService<TState> {

  /**
   * Generated Id for the store
   * @protected
   */
  private readonly storeId: string;

  private readonly _states$: BehaviorSubject<BehaviorSubject<TState>>;
  private readonly states$: Observable<Observable<TState>>;

  private readonly databaseContext: CacheDatabaseContext;

  protected constructor(initialState: TState, databaseContext?: CacheDatabaseContext, configService?: IStoreConfigService) {
    super(initialState, configService);

    this.databaseContext = databaseContext ?? inject(CacheDatabaseContext);

    this.storeId = dashCase(this.constructor.name);

    const state = untracked(this.state);
    this._states$ = new BehaviorSubject(new BehaviorSubject(state));
    this.states$ = this._states$.asObservable();

    this.onDestroy.onDestroy(() => {
      this._states$.value.complete();
      this._states$.complete();
    });
  }

  override reset() {
    super.reset();

    this._states$.value.complete();
    const state = untracked(this.state);
    this._states$.next(new BehaviorSubject(state));
  }

  protected override applyState(state: TState): boolean {
    const applied = super.applyState(state);
    if (!applied) return applied;

    const newState = untracked(this.state);
    this._states$.value.next(newState);

    return applied;
  }

  protected cache(chunkId: string, version: number): CacheConfig<TState> {
    return new CacheConfig<TState>(`${this.storeId}_${chunkId}`, version, this.databaseContext, this.states$);
  }

  protected cacheCommand<TCache>(chunk: CacheChunk<TCache>): CacheCommandConfig<TState, TCache> {
    return new CacheCommandConfig<TState, TCache>(this.context, chunk);
  }
}
