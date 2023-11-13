import {distinctUntilChanged, Observable} from "rxjs";
import {map} from "rxjs/operators";
import {CacheChunkContext, CacheDatabaseContext} from "./caching-interface";
import {CacheChunk} from "./cache-chunk";
import {IdMap, parseIdMap} from "../lib/id-map";
import {persistentCache} from "@juulsgaard/rxjs-tools";

export class CacheConfig<TState> {
  constructor(private chunkId: string, private version: number, private databaseContext: CacheDatabaseContext, private states$: Observable<Observable<TState>>) {
  }

  /**
   * Track cache as multiple units with an ID
   * @param chunks - The mapping for the cache chunks
   */
  withChunks<TChunk>(chunks: (state: TState) => TChunk[]): CacheChunkConfig<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId, this.version);

    const chunks$ = this.states$.pipe(
      map(state$ => state$.pipe(
        map(chunks),
        persistentCache(5000)
      ))
    );

    return new CacheChunkConfig<TChunk>(context, chunks$);
  }

  /**
   * Track cache as multiple units with an ID.
   * Uses a scope to limit the state changes that trigger a cache re-evaluation.
   * @param scope - The change detection scope for the cache
   * @param chunks - The mapping for the cache chunks
   */
  withScopedChunks<TScope, TChunk>(scope: (state: TState) => TScope, chunks: (state: TScope) => TChunk[]): CacheChunkConfig<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId, this.version);

    const chunks$ = this.states$.pipe(
      map(state$ => state$.pipe(
        map(scope),
        distinctUntilChanged(),
        map(chunks),
        persistentCache(5000)
      ))
    );

    return new CacheChunkConfig<TChunk>(context, chunks$);
  }

  /**
   * Track cache as single object
   * @param chunk - Mapping for the cache value
   * @param getId - Optionally give the value an ID - Will default to use a 'global' ID
   */
  singleChunk<TChunk>(chunk: (state: TState) => TChunk, getId?: (value: TChunk) => string): CacheChunk<TChunk> {
    getId ??= () => 'global';
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId, this.version);

    const chunks$ = this.states$.pipe(
      map(state$ => state$.pipe(
        map(chunk),
        distinctUntilChanged(),
        map(x => x ? [x] : []),
        persistentCache(5000)
      ))
    );

    return new CacheChunk<TChunk>(chunks$, context, getId);
  }
}

class CacheChunkConfig<TChunk> {

  constructor(private context: CacheChunkContext<TChunk>, private chunks$: Observable<Observable<TChunk[]>>) {
  }

  withId(getId: IdMap<TChunk>, getTags?: (chunk: TChunk) => string[]): CacheChunk<TChunk> {
    return new CacheChunk<TChunk>(this.chunks$, this.context, parseIdMap(getId), getTags);
  }
}
