import {distinctUntilChanged, EMPTY, from, merge, Observable, Subject, Subscription, switchMap, tap} from "rxjs";
import {catchError, concatMap, map, pairwise} from "rxjs/operators";
import {arrToMap} from "@consensus-labs/ts-tools";
import {CacheChunkContext} from "./caching-interface";
import {CacheItemData} from "./caching-adapter";
import {CacheLoadOptions} from "../commands/cache-command";

interface Changes<TChunk> {
  added?: { id: string, data: TChunk }[];
  updated?: { id: string, data: TChunk }[];
  removed?: { id: string }[];
  removedTags?: { id: string }[];
  ageChanged?: { id: string, newAge: Date }[];
}

export class CacheChunk<TChunk> {

  private ignoreValueChange = new Set<string>();

  private stateChanges$ = new Subject<Changes<TChunk>>();
  private manualChanges$ = new Subject<Changes<TChunk>>();
  private changeSub?: Subscription;

  constructor(
    private chunks$: Observable<Observable<TChunk[]>>,
    private context: CacheChunkContext<TChunk>,
    private getId: (chunk: TChunk) => string,
    private getTags?: (chunk: TChunk) => string[]
  ) {
    this.chunks$.pipe(
      // Reset every time a new state observable is emitted
      tap(() => this.reset()),
      switchMap(state$ => state$.pipe(
        distinctUntilChanged(),
        // Split the chunks based on ID
        map(x => arrToMap(x, getId)),
        // Get 2 consecutive states at a time
        pairwise(),
        // Find changes between the 2 states
        map(([oldMap, newMap]) => this.mapChanges(oldMap, newMap)),
        // Ignore errors
        catchError(e => {
          console.error('An error occurred computing changes in cache chunks', e);
          return EMPTY;
        })
      ))
    ).subscribe(this.stateChanges$);
  }

  private reset() {
    this.ignoreValueChange.clear();
    this.context.reset();

    this.changeSub?.unsubscribe();
    this.changeSub = merge(this.stateChanges$, this.manualChanges$).pipe(
      // Save the changes to cache
      concatMap(x => from(this.applyChanges(x))),
      // Ignore errors
      catchError(e => {
        console.error('An error occurred applying changes to cache', e);
        return EMPTY;
      })
    ).subscribe()
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
        changes.removed!.push({id});
        continue;
      }

      if (oldValue === newValue) continue;
      if (this.ignoreValueChange.has(id)) continue;

      changes.updated!.push({id, data: newValue});
    }

    for (let [id, newValue] of newMap) {
      if (oldMap.has(id)) continue;
      if (this.ignoreValueChange.has(id)) continue;
      changes.added!.push({id, data: newValue});
    }

    this.ignoreValueChange.clear();
    return changes;
  }

  private async applyChanges(changes: Changes<TChunk>) {

    await this.context.useTransaction(async trx => {
      for (let {id, data} of changes?.added ?? []) {
        await trx.addValue(id, data, this.getTags?.(data));
      }

      for (let {id, data} of changes?.updated ?? []) {
        await trx.updateValue(id, data);
      }

      for (let {id, newAge} of changes?.ageChanged ?? []) {
        await trx.updateValueAge(id, newAge);
      }

      for (let {id} of changes?.removed ?? []) {
        await trx.deleteValue(id);
      }

      for (let {id} of changes?.removedTags ?? []) {
        await trx.deleteTag(id);
      }

      await trx.commit();
    }, false);
  }

  //<editor-fold desc="Data Load">
  /**
   * Load an item and mark is as loaded
   * Should only be used to populate a store
   * @param id
   * @param options
   */
  loadItem(id: string, options?: CacheLoadOptions): Observable<TChunk | undefined> {

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
   * Ignore the next time this value is updated in the store
   * This is to skip the change resulting from this cache load
   * @param id
   */
  markAsLoaded(id: string) {
    this.ignoreValueChange.add(id);
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

  //</editor-fold>

  resetItemAge(id: string) {
    this.manualChanges$.next({ageChanged: [{id, newAge: new Date()}]});
  }

  clearTag(tag: string) {
    this.manualChanges$.next({removedTags: [{id: tag}]});
  }
}
