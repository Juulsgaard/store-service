import {distinctUntilChanged, EMPTY, from, Observable, switchMap, tap} from "rxjs";
import {catchError, concatMap, filter, map, pairwise} from "rxjs/operators";
import {arrToMap} from "@consensus-labs/ts-tools";
import {CacheChunkContext} from "./caching-interface";
import {CacheItemData} from "./caching-adapter";
import {CacheLoadOptions} from "../commands/cache-command";

interface Changes<TChunk> {
  added: { id: string, data: TChunk }[];
  updated: { id: string, data: TChunk }[];
  removed: { id: string }[];
}

export class CacheChunk<TChunk> {
  private ignoreValueChange = new Set<string>();

  constructor(private chunks$: Observable<Observable<TChunk[]>>, private context: CacheChunkContext<TChunk>, private getId: (chunk: TChunk) => string) {
    this.chunks$.pipe(
      tap(() => this.reset()),
      switchMap(state$ => state$.pipe(
        distinctUntilChanged(),
        map(x => arrToMap(x, getId)),
        pairwise(),
        map(([oldMap, newMap]) => this.mapChanges(oldMap, newMap)),
        filter(x => !!x.added.length || !!x.updated.length || !!x.removed.length),
        concatMap(x => from(this.applyChanges(x))),
        catchError(() => EMPTY)
      ))
    ).subscribe();
  }

  private reset() {
    this.ignoreValueChange.clear();
    this.context.reset();
  }

  private mapChanges(oldMap: Map<string, TChunk>, newMap: Map<string, TChunk>): Changes<TChunk> {

    const changes: Changes<TChunk> = {
      added: [],
      updated: [],
      removed: []
    };

    for (let [id, oldValue] of oldMap) {

      const newValue = newMap.get(id);

      if (!newValue) {
        changes.removed.push({id});
        continue;
      }

      if (oldValue === newValue) continue;
      if (this.ignoreValueChange.has(id)) continue;

      changes.updated.push({id, data: newValue});
    }

    for (let [id, newValue] of newMap) {
      if (oldMap.has(id)) continue;
      if (this.ignoreValueChange.has(id)) continue;
      changes.added.push({id, data: newValue});
    }

    this.ignoreValueChange.clear();
    return changes;
  }

  private async applyChanges(changes: Changes<TChunk>) {

    await this.context.useTransaction(async trx => {
      for (let {id, data} of changes.added) {
        await trx.addValue(id, data);
      }

      for (let {id, data} of changes.updated) {
        await trx.updateValue(id, data);
      }

      for (let {id} of changes.removed) {
        await trx.deleteValue(id);
      }

      await trx.commit();
    }, false);
  }

  /**
   * Load an item and mark is as loaded
   * Should only be used to populate a store
   * @param id
   * @param options
   */
  loadItem(id: string, options?: CacheLoadOptions): Observable<TChunk | undefined> {
    // Ignore the next time this value is updated in the store
    // This is to skip the change resulting from this cache load
    this.ignoreValueChange.add(id);

    if (!options?.maxAge) {
      return from(this.readItem(id)).pipe(
        map(x => x?.data)
      );
    }

    return from(this.readItem(id)).pipe(
      map(val => {
        if (val === undefined) return undefined;
        const age = Date.now() - (options?.absoluteAge ? val.createdAt : val.updatedAt).getTime();
        if (age > options.maxAge!) return undefined;
        return val.data;
      })
    );
  }

  /**
   * Load all items and mark them as loaded
   * Should only be used to populate a store
   * @param options
   */
  loadAll(options?: CacheLoadOptions): Observable<TChunk[] | undefined> {
    let values$: Observable<CacheItemData<TChunk>[] | undefined>;

    if (options?.maxAge) {
      values$ = from(this.readAll()).pipe(
        map(list => {

          // Get oldest date
          const oldest = list.reduce((state: number, x: CacheItemData<TChunk>) => {
              const time = (options.absoluteAge ? x.createdAt : x.updatedAt).getTime();
              if (time < state) return time;
              return state;
            },
            Date.now()
          );

          if (!oldest) return list;
          const age = Date.now() - oldest;
          if (age > options.maxAge!) return undefined;
          return list;
        })
      );
    } else {
      values$ = from(this.readAll());
    }

    return values$.pipe(
      tap(list => list?.forEach(x => this.ignoreValueChange.add(x.id))),
      map(list => list?.map(x => x.data))
    );
  }

  /**
   * Read a value from the cache
   * @param id
   */
  async readItem(id: string): Promise<CacheItemData<TChunk> | undefined> {
    return await this.context.useTransaction(trx => trx.readValue(id), true);
  }

  /**
   * Read all values from the cache
   */
  async readAll(): Promise<CacheItemData<TChunk>[]> {
    return this.context.useTransaction(trx => trx.readAllValues(), true);
  }
}
