import {Observable} from "rxjs";
import {map} from "rxjs/operators";
import {CacheChunkContext, CacheDatabaseContext} from "./caching-interface";
import {CacheChunk} from "./cache-chunk";

export class CacheConfig<TState> {
  constructor(private chunkId: string, private version: number, private databaseContext: CacheDatabaseContext, private states$: Observable<Observable<TState>>) {
  }

  withChunks<TChunk>(chunk: (state: TState) => TChunk[]): CacheChunkConfig<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId);

    context.init(this.version).catch(e => console.error('Failed to initialise Cache Chunk', e));

    const chunks$ = this.states$.pipe(map(state$ => state$.pipe(map(chunk))));

    return new CacheChunkConfig<TChunk>(context, chunks$);
  }

  singleChunk<TChunk>(chunk: (state: TState) => TChunk): CacheChunk<TChunk> {
    const context = this.databaseContext.getChunk<TChunk>(this.chunkId);

    context.init(this.version).catch(e => console.error('Failed to initialise Cache Chunk', e));

    const chunks$ = this.states$.pipe(map(state$ => state$.pipe(
      map(x => {
        const globalChunk = chunk(x);
        if (globalChunk) return [globalChunk];
        return [];
      })
    )));

    return new CacheChunk<TChunk>(chunks$, context, () => 'global');
  }
}

class CacheChunkConfig<TChunk> {

  constructor(private context: CacheChunkContext<TChunk>, private chunks$: Observable<Observable<TChunk[]>>) {
  }

  withId(getId: (chunk: TChunk) => string|(string|undefined)[], getTags?: (chunk: TChunk) => string[]): CacheChunk<TChunk> {
    return new CacheChunk<TChunk>(this.chunks$, this.context, chunk => {
      const id = getId(chunk);
      // Convert composite id, to string
      if (Array.isArray(id)) return id.filter(x => !!x).join('_');

      return id;
    }, getTags);
  }
}
