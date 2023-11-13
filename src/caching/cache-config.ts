import {Observable} from "rxjs";
import {map} from "rxjs/operators";
import {CacheChunkContext, CacheDatabaseContext} from "./caching-interface";
import {CacheChunk} from "./cache-chunk";
import {IdMap, parseIdMap} from "../lib/id-map";
import {persistentCache} from "@juulsgaard/rxjs-tools";

export class CacheConfig<TState> {
  constructor(private chunkId: string, private version: number, private databaseContext: CacheDatabaseContext, private states$: Observable<Observable<TState>>) {
  }

  withChunks<TChunk>(chunk: (state: TState) => TChunk[]): CacheChunkConfig<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId, this.version);

    const chunks$ = this.states$.pipe(
      map(state$ => state$.pipe(
        map(chunk),
        persistentCache(5000)
      ))
    );

    return new CacheChunkConfig<TChunk>(context, chunks$);
  }

  singleChunk<TChunk>(chunk: (state: TState) => TChunk): CacheChunk<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId, this.version);

    const chunks$ = this.states$.pipe(
      map(state$ => state$.pipe(
        map(x => {
          const globalChunk = chunk(x);
          if (globalChunk) return [globalChunk];
          return [];
        }),
        persistentCache(5000)
      ))
    );

    return new CacheChunk<TChunk>(chunks$, context, () => 'global');
  }
}

class CacheChunkConfig<TChunk> {

  constructor(private context: CacheChunkContext<TChunk>, private chunks$: Observable<Observable<TChunk[]>>) {
  }

  withId(getId: IdMap<TChunk>, getTags?: (chunk: TChunk) => string[]): CacheChunk<TChunk> {
    return new CacheChunk<TChunk>(this.chunks$, this.context, parseIdMap(getId), getTags);
  }
}
